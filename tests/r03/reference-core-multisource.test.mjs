// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';

const fixture = suffix => new URL('./fixtures/reference-source/multiple-sources.' + suffix, import.meta.url);
const refPattern = '!tsfg_core\\.ref<"[^"]+">';
const valuePattern = '%[A-Za-z0-9_]+';

// Read only the public Core text, not the lowering model, emitter or SSA counter.
function functions(core) {
  return [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)]
    .map(([, header, body]) => ({ header, body,
      symbol: header.match(/^(@(?:"[^"]+"|[A-Za-z0-9_]+))\(/)?.[1],
      parameters: [...header.matchAll(new RegExp('(' + valuePattern + '):\\s*(' + refPattern + '|f64)', 'g'))]
        .map(([, value, type]) => ({ value, type })) }));
}
function operations(body, name) {
  return body.split('\n').flatMap(line => {
    const match = line.match(/^\s*(?:(%[A-Za-z0-9_]+)\s*=\s*)?"([^"]+)"\(([^)]*)\) \{(.*)\} : \(([^)]*)\) -> (.*)$/);
    if (!match || match[2] !== name) return [];
    return [{ value: match[1], operands: match[3] ? match[3].split(/,\s*/) : [],
      attributes: match[4], types: match[5] ? match[5].split(/,\s*/) : [], result: match[6] }];
  });
}
function only(items, message) {
  assert.equal(items.length, 1, message);
  return items[0];
}
function objectSource(value, views) {
  const seen = new Set();
  while (views.has(value)) {
    assert.ok(!seen.has(value), 'identity-preserving views cannot cycle');
    seen.add(value); value = views.get(value);
  }
  return value;
}
function viewMap(body) {
  return new Map(operations(body, 'tsfg_core.ref.view').map(value => [value.value, value.operands[0]]));
}
function callable(all, owner, item, kind) {
  const fn = only(all.filter(value => value.header.includes('tsfg_core.reference_owner = ' + JSON.stringify(owner.runtimeKey))
    && value.header.includes('tsfg_core.logical_name = ' + JSON.stringify(kind === 'constructor' ? 'constructor' : item.name))
    && value.header.includes('tsfg_core.reference_kind = ' + JSON.stringify(kind))), 'exact owned callable must remain in Core');
  assert.ok(fn.symbol);
  return fn;
}
function checkOrigin(fn, hir, item) {
  const index = hir.sources.findIndex(source => source.path === item.origin.source);
  assert.ok(index >= 0);
  for (const [name, value] of [['source_index', index], ['function_start', item.origin.start], ['function_end', item.origin.end]])
    assert.ok(fn.header.includes('tsfg_core.' + name + ' = ' + value + ' : i64'), 'callable keeps its actual original source/UTF16 anchor');
}
function memberKey(owner, kind, member) {
  // Independent public schema identity recipe, not a copied lowering model.
  return sha256(['tsfg.core-reference.member.v1', owner.runtimeKey, kind, member.origin.source,
    String(member.origin.start), String(member.origin.end), member.name].join('\0'));
}
function accessType(type) {
  const match = type.match(/^!tsfg_core\.ref<"([^"]+)">$/);
  assert.ok(match, 'reference access type must be explicit');
  return 'ref:' + match[1];
}

test('public lowerHir preserves real multiple-source construction dispatch projection and independent local slot types', async () => {
  const [bytes, bindingText, main, baseText] = await Promise.all([
    readFile(fixture('facts.json')), readFile(fixture('binding.json'), 'utf8'),
    readFile(fixture('a-main.source.ts'), 'utf8'), readFile(fixture('z-base.source.ts'), 'utf8'),
  ]);
  // Actual profile4 official Program/checker capture; no Source admission/execution.
  assert.equal(sha256(bytes), 'sha256:593093a1772fff01f8c6c82802e50edf44b24f29042c2e3ace494957e6a93db7');
  const binding = JSON.parse(bindingText), originals = new Map([['/original/a-main.ts', main], ['/original/z-base.ts', baseText]]);
  assert.equal(binding.sources.length, 3); assert.equal(main.length, 400); assert.equal(baseText.length, 172);
  for (const source of binding.sources.filter(item => !item.declaration)) {
    assert.ok(originals.has(source.path)); assert.equal(sha256(originals.get(source.path)), source.sha256);
    assert.equal(originals.get(source.path).length, source.utf16Length); assert.deepEqual(source.surrogateStarts, [3]);
  }
  const owned = buildReferenceHir(decodeReferenceFacts(bytes, binding)), persisted = Buffer.from(printReferenceHir(owned));
  const cold = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(cold, owned); assert.equal(cold.format.version, 5);
  assert.equal(cold.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v5');
  for (const owner of cold.classes) assert.equal(owner.constructor.access, 'public');
  const core = lowerHir(cold), again = lowerHir(readReferenceHir(Buffer.from(printReferenceHir(cold))));
  assert.equal(core, again, 'fresh cold lowering must be byte deterministic');
  const derived = cold.classes.find(item => item.name === 'Derived'), base = cold.classes.find(item => item.name === 'Base');
  assert.ok(derived); assert.ok(base); assert.equal(derived.base, base.id);
  const touch = derived.methods.find(item => item.name === 'touch'), baseTouch = base.methods.find(item => item.name === 'touch');
  const make = derived.methods.find(item => item.name === 'make'), rebind = derived.methods.find(item => item.name === 'rebind');
  assert.ok(touch); assert.ok(baseTouch); assert.ok(make); assert.ok(rebind);
  assert.equal(touch.overrideTarget, baseTouch.id); assert.equal(base.fields[0].initializer, null);
  const all = functions(core);
  assert.equal(all.length, 6, 'two constructors and all four own methods must remain');
  const baseCtor = callable(all, base, base.constructor, 'constructor');
  const derivedCtor = callable(all, derived, derived.constructor, 'constructor');
  const makeFn = callable(all, derived, make, 'method'), rebindFn = callable(all, derived, rebind, 'method');
  const touchFn = callable(all, derived, touch, 'method'), baseTouchFn = callable(all, base, baseTouch, 'method');
  for (const [fn, item] of [[baseCtor, base.constructor], [derivedCtor, derived.constructor],
    [makeFn, make], [rebindFn, rebind], [touchFn, touch], [baseTouchFn, baseTouch]]) checkOrigin(fn, cold, item);
  assert.equal(baseCtor.parameters.length, 2); assert.equal(derivedCtor.parameters.length, 2);
  const baseType = baseCtor.parameters[0].type, derivedType = derivedCtor.parameters[0].type;
  assert.notEqual(baseType, derivedType); accessType(baseType); accessType(derivedType);
  assert.equal(baseCtor.parameters[1].type, 'f64'); assert.equal(derivedCtor.parameters[1].type, 'f64');

  // make allocates one actual Base. Its local/view, virtual call and returned
  // value retain that object; constructing or aliasing never allocates a second.
  const allocations = all.flatMap(fn => operations(fn.body, 'tsfg_core.ref.alloc'));
  const allocation = only(allocations, 'the entire real program contains one explicit new');
  assert.equal(allocation.result, baseType); assert.deepEqual(allocation.operands, []);
  assert.ok(allocation.attributes.includes('class = ' + JSON.stringify(base.runtimeKey)));
  const makeCall = only(operations(makeFn.body, 'func.call'), 'new has exactly one explicit zero-result constructor call');
  assert.ok(makeCall.attributes.includes('callee = ' + baseCtor.symbol));
  assert.deepEqual(makeCall.operands, [allocation.value, makeFn.parameters[1].value]); assert.equal(makeCall.result, '()');
  const virtual = only(operations(makeFn.body, 'tsfg_core.ref.call'), 'local alias invokes one virtual touch');
  const makeViews = viewMap(makeFn.body);
  assert.equal(objectSource(virtual.operands[0], makeViews), allocation.value);
  assert.equal(virtual.operands[1], makeFn.parameters[1].value); assert.equal(virtual.result, 'f64');
  assert.ok(virtual.attributes.includes('dispatch = "virtual"'));
  const returned = only(operations(makeFn.body, 'func.return'), 'make returns its actual constructed local');
  assert.equal(objectSource(returned.operands[0], makeViews), allocation.value); assert.deepEqual(returned.types, [baseType]);
  assert.match(makeFn.header, new RegExp('\\) -> ' + refPattern + ' attributes'));

  // The implicit Derived constructor initializes its existing object through the
  // direct Base boundary. It cannot allocate a replacement or rebind Base params.
  assert.equal(derived.constructor.kind, 'implicit-derived');
  assert.equal(derived.constructor.implicitForward.target, base.constructor.id);
  const baseReceiver = only(operations(derivedCtor.body, 'tsfg_core.ref.base'), 'implicit super has one receiver base view');
  assert.deepEqual(baseReceiver.operands, [derivedCtor.parameters[0].value]); assert.equal(baseReceiver.result, baseType);
  const superCall = only(operations(derivedCtor.body, 'func.call'), 'implicit constructor forwards once to direct Base');
  assert.ok(superCall.attributes.includes('callee = ' + baseCtor.symbol));
  assert.deepEqual(superCall.operands, [baseReceiver.value, derivedCtor.parameters[1].value]); assert.equal(superCall.result, '()');
  assert.equal(operations(derivedCtor.body, 'tsfg_core.ref.alloc').length, 0);

  const fieldKey = memberKey(base, 'field', base.fields[0]);
  const baseMethodKey = memberKey(base, 'method', baseTouch), overrideKey = memberKey(derived, 'method', touch);
  assert.ok(virtual.attributes.includes('method = ' + JSON.stringify(baseMethodKey)));
  assert.ok(core.includes('member = ' + JSON.stringify(overrideKey) + ', name = "touch", override = ' + JSON.stringify(baseMethodKey)));
  assert.ok(core.includes('base = ' + JSON.stringify(base.runtimeKey)));
  const baseStore = only(operations(baseCtor.body, 'tsfg_core.ref.field.write'), 'Base constructor stores the incoming seed once');
  assert.deepEqual(baseStore.operands, [baseCtor.parameters[0].value, baseCtor.parameters[1].value]);
  assert.ok(baseStore.attributes.includes('field = ' + JSON.stringify(fieldKey))); assert.ok(baseStore.attributes.includes('initialize = false'));
  const inheritedRead = only(operations(touchFn.body, 'tsfg_core.ref.field.read'), 'override body reads the actual inherited Base field');
  assert.ok(inheritedRead.attributes.includes('field = ' + JSON.stringify(fieldKey)));
  assert.deepEqual(inheritedRead.operands, [touchFn.parameters[0].value]); assert.equal(inheritedRead.result, 'f64');
  assert.deepEqual(only(operations(touchFn.body, 'func.return')).operands, [inheritedRead.value]);
  assert.equal(operations(baseTouchFn.body, 'tsfg_core.ref.field.write').length, 1);

  // The real void rebind discards its assignment result. Check HIR's official
  // Derived result independently of Base storage; do not claim a Core return
  // consumer that is absent from this fixture.
  const assignment = rebind.body[1].expression;
  assert.equal(assignment.kind, 'local.write'); assert.equal(assignment.type, derived.instanceType);
  assert.equal(assignment.left.type, base.instanceType); assert.equal(assignment.right.kind, 'ref.view');
  assert.equal(assignment.right.value.type, derived.instanceType);
  assert.equal(assignment.compatibility.sourceType, derived.instanceType);
  assert.equal(assignment.compatibility.targetType, base.instanceType);
  assert.equal(rebindFn.parameters.length, 3);
  assert.equal(rebindFn.parameters[0].type, derivedType); assert.equal(rebindFn.parameters[1].type, baseType);
  assert.equal(rebindFn.parameters[2].type, derivedType);
  const storageView = only(operations(rebindFn.body, 'tsfg_core.ref.view')
    .filter(value => value.operands[0] === rebindFn.parameters[2].value), 'rebind uses the original Derived replacement');
  assert.deepEqual(storageView.types, [derivedType]); assert.equal(storageView.result, baseType);
  const views = [...core.matchAll(/\{key = "([^"]+)", members = \[([^\]]*)\], source = "(ref:[^"]+)", target = "(ref:[^"]+)"\}/g)];
  const projection = only(views.filter(value => value[3] === accessType(derivedType) && value[4] === accessType(baseType)),
    'Core carries one complete actual Derived-to-Base projection');
  const edges = [...projection[2].matchAll(/\{source = "([^"]+)", target = "([^"]+)"\}/g)].map(([, source, target]) => /** @type {[string, string]} */ ([target, source]));
  assert.deepEqual(new Map(edges), new Map([[fieldKey, fieldKey], [baseMethodKey, overrideKey]]));
  assert.equal(edges.length, 2);
  assert.equal(only(operations(rebindFn.body, 'func.return')).operands.length, 0);
  assert.doesNotMatch(core, /"tsfg_core\.constant"/, 'this real program requires no numeric literal settlement');
});

test('public lowerHir returns a consumed Derived local assignment independently of its Base storage view', async () => {
  const input = name => new URL('./fixtures/reference-source/local-assignment-result.' + name, import.meta.url);
  const [bytes, bindingBytes, sourceBytes] = await Promise.all([
    readFile(input('facts.json')), readFile(input('binding.json')), readFile(input('source.ts')),
  ]);
  // Real profile4 official Source capture. The cold reader supplies every fact;
  // the source below only checks input identity and is never parsed for lowering.
  assert.equal(bytes.length, 10465);
  assert.equal(sha256(bytes), 'sha256:2510da5b02fb93613ebcf4fbd3e43fb64436f144b3be7df1ce2602795dfb4552');
  assert.equal(sha256(bindingBytes), 'sha256:ff8fb1658531ce3e21e34351e0726705e2baaed1c4e456f86caa19007292b1f4');
  assert.equal(sourceBytes.length, 256);
  const source = sourceBytes.toString('utf8'), binding = JSON.parse(bindingBytes.toString('utf8'));
  assert.equal(source.length, 254);
  assert.equal(sha256(sourceBytes), 'sha256:6ce81dad2249085bd202b96db82e48d5c6c7f95decc27f4c1242a905b8ca23c3');
  const origin = only(binding.sources.filter(value => !value.declaration));
  assert.equal(origin.path, '/original/main.ts'); assert.equal(origin.sha256, sha256(sourceBytes));
  assert.equal(origin.utf16Length, source.length); assert.deepEqual(origin.surrogateStarts, [3]);
  const owned = buildReferenceHir(decodeReferenceFacts(bytes, binding));
  const persisted = Buffer.from(printReferenceHir(owned)), cold = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(cold, owned); assert.equal(cold.format.version, 5);
  assert.equal(cold.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v5');
  for (const owner of cold.classes) assert.equal(owner.constructor.access, 'public');
  const base = cold.classes.find(value => value.name === 'Base'), derived = cold.classes.find(value => value.name === 'Derived');
  assert.ok(base); assert.ok(derived); assert.equal(derived.base, base.id);
  const replace = only(derived.methods.filter(value => value.name === 'replace'));
  const local = only(replace.body.filter(value => value.kind === 'local')).local;
  const slot = only(local.bindings), returnedStatement = only(replace.body.filter(value => value.kind === 'return'));
  const returnedView = returnedStatement.expression, assignment = returnedView.value;
  assert.equal(local.kind, 'let'); assert.equal(slot.type, base.instanceType);
  assert.equal(assignment.kind, 'local.write'); assert.equal(assignment.type, derived.instanceType);
  assert.equal(assignment.left.kind, 'local.location'); assert.equal(assignment.left.type, base.instanceType);
  assert.equal(assignment.left.symbol, slot.symbol); assert.equal(assignment.right.kind, 'ref.view');
  assert.equal(assignment.right.sourceType, derived.instanceType); assert.equal(assignment.right.targetType, base.instanceType);
  assert.equal(assignment.right.value.type, derived.instanceType);
  assert.equal(assignment.right.value.symbol, replace.signature.parameters[1].symbol);
  assert.equal(assignment.compatibility.sourceType, derived.instanceType);
  assert.equal(assignment.compatibility.targetType, base.instanceType);
  assert.deepEqual(assignment.compatibility.members, [{ source: base.fields[0].symbol, target: base.fields[0].symbol }]);
  assert.equal(returnedView.kind, 'ref.view'); assert.equal(returnedView.sourceType, derived.instanceType);
  assert.equal(returnedView.targetType, derived.instanceType);
  const returnWitness = returnedStatement.compatibility;
  assert.equal(returnWitness.sourceType, derived.instanceType); assert.equal(returnWitness.targetType, derived.instanceType);
  assert.equal(returnWitness.assignable, true); assert.deepEqual(returnedView.members, returnWitness.members);
  assert.equal(returnWitness.members.length, 2);
  for (const symbol of [base.fields[0].symbol, replace.symbol])
    assert.equal(returnWitness.members.filter(edge => edge.source === symbol && edge.target === symbol).length, 1);

  const core = lowerHir(cold);
  assert.equal(core, lowerHir(readReferenceHir(Buffer.from(printReferenceHir(cold)))), 'fresh cold consumed-result lowering is deterministic');
  const all = functions(core);
  assert.equal(all.length, 3);
  const fn = callable(all, derived, replace, 'method'), baseCtor = callable(all, base, base.constructor, 'constructor');
  checkOrigin(fn, cold, replace);
  assert.equal(fn.parameters.length, 3);
  const [receiver, other, replacement] = fn.parameters, baseType = baseCtor.parameters[0].type;
  const derivedType = receiver.type;
  assert.notEqual(baseType, derivedType); assert.equal(other.type, baseType); assert.equal(replacement.type, derivedType);
  assert.ok(fn.header.includes(') -> ' + derivedType + ' attributes'));
  const conversionOps = operations(fn.body, 'tsfg_core.ref.view');
  const storage = only(conversionOps.filter(value => value.operands[0] === replacement.value && value.result === baseType),
    'Base storage uses the original Derived replacement through its own checked view');
  assert.deepEqual(storage.types, [derivedType]);
  const result = only(operations(fn.body, 'func.return'), 'replace has one consumed assignment return');
  assert.equal(result.operands.length, 1); assert.deepEqual(result.types, [derivedType]);
  assert.notEqual(result.operands[0], storage.value, 'return cannot use the Base storage SSA');
  const conversions = new Map(conversionOps.map(value => [value.value, value]));
  const resultViews = viewMap(fn.body);
  assert.equal(objectSource(result.operands[0], resultViews), replacement.value, 'returned object is the original replacement');
  let value = result.operands[0];
  const seen = new Set();
  while (conversions.has(value)) {
    assert.ok(!seen.has(value)); seen.add(value);
    const conversion = conversions.get(value);
    assert.notEqual(value, storage.value, 'return path must never pass through the Base slot view');
    assert.deepEqual(conversion.types, [derivedType]); assert.equal(conversion.result, derivedType);
    value = only(conversion.operands);
  }
  assert.equal(value, replacement.value);
  const fieldKey = memberKey(base, 'field', base.fields[0]), methodKey = memberKey(derived, 'method', replace);
  const views = [...core.matchAll(/\{key = "([^"]+)", members = \[([^\]]*)\], source = "(ref:[^"]+)", target = "(ref:[^"]+)"\}/g)];
  const returnProjection = only(views.filter(view => view[3] === accessType(derivedType) && view[4] === accessType(derivedType)),
    'Core retains the complete Derived return view');
  const edges = [...returnProjection[2].matchAll(/\{source = "([^"]+)", target = "([^"]+)"\}/g)]
    .map(([, source, target]) => /** @type {[string, string]} */ ([target, source]));
  assert.equal(edges.length, 2); assert.deepEqual(new Map(edges), new Map([[fieldKey, fieldKey], [methodKey, methodKey]]));
  assert.doesNotMatch(core, /"tsfg_core\.ref\.alloc"/, 'assigning and returning existing references never allocates');
});
