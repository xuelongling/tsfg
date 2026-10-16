// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeGenericPackage, encodeGenericPackage, genericPackageId, genericDefinitionKey } from '../compiler/generic-package.mjs';
import { validateGenericInstanceResult, genericInstanceKey, genericPackageContext } from '../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir,
  genericHirFormat, genericLinkageName } from '../compiler/generic-hir.mjs';
import { lowerHir } from '../compiler/hir.mjs';
import { canonical } from '../compiler/identity.mjs';

const packageBytes = new Uint8Array(await readFile(new URL('../tests/r03/fixtures/generic-package-source-v1.json', import.meta.url)));
// Root extracts this exact fixture from the complete successful official Source test log.
// Absence is a failure, never a synthetic semantic substitute or a skipped positive.
const fixture = JSON.parse(await readFile(new URL('../tests/r03/fixtures/generic-instance-source-v1.json', import.meta.url), 'utf8'));
const pkg = decodeGenericPackage(packageBytes);
const clone = value => structuredClone(value);
const checked = () => validateGenericInstanceResult(packageBytes, fixture.result, fixture.requests);
const candidate = () => buildGenericHir(packageBytes, fixture.result, fixture.requests);
const badResult = (mutate, category = undefined) => {
  const result = clone(fixture.result), requests = clone(fixture.requests);
  mutate(result, requests);
  assert.throws(() => validateGenericInstanceResult(packageBytes, result, requests),
    category ? { code: 'generic-instance-' + category } : /generic-instance-/);
};
const badHir = (mutate, category = undefined) => {
  const hir = clone(candidate()); mutate(hir);
  assert.throws(() => verifyGenericHir(hir), category ? { code: 'generic-hir-' + category } : /generic-(hir|instance)-/);
};
const byName = name => new Set(pkg.payload.definitions.filter(def => def.name === name).map(def => def.key));

test('real Source scalar instances retain typed facts and original package origins', () => {
  const input = clone(fixture.result), result = validateGenericInstanceResult(packageBytes, input, fixture.requests);
  assert.equal(result.packageId, pkg.packageId);
  assert.deepEqual(result, fixture.result);
  assert.ok(Object.isFrozen(result.instances[0].body));
  const first = input.instances[0], previous = result.instances[0].origin.start;
  first.origin.start++;
  assert.equal(result.instances[0].origin.start, previous);
  first.origin.start--;
});
test('concrete candidate HIR owns source metadata without original function text', () => {
  const hir = candidate();
  assert.deepEqual(hir.format, genericHirFormat);
  assert.deepEqual(hir.source, pkg.payload.source);
  assert.equal(Object.hasOwn(hir.source, 'content'), false);
  assert.equal(Object.hasOwn(hir, 'modules'), false);
  assert.ok(Object.isFrozen(hir.functions[0].parameters));
  for (const fn of hir.functions) {
    assert.equal(fn.linkageName, genericLinkageName(fn.instanceKey));
    assert.deepEqual(fn.body[0].range, fn.body[0].value.range);
    assert.ok(['bool', 'f64'].includes(fn.returnType.name));
  }
});
test('phantom type arguments retain different identities with the same concrete signature', () => {
  const hir = candidate(), definitions = byName('unused');
  const phantoms = hir.functions.filter(fn => definitions.has(fn.definition));
  assert.equal(phantoms.length, 2);
  assert.equal(phantoms[0].signatureHash, phantoms[1].signatureHash);
  assert.notEqual(phantoms[0].instanceKey, phantoms[1].instanceKey);
  assert.notEqual(phantoms[0].linkageName, phantoms[1].linkageName);
  assert.notEqual(phantoms[0].id, phantoms[1].id);
});
test('root order and duplicates survive while the instance worklist is deduplicated', () => {
  const result = checked(), hir = candidate();
  assert.ok(new Set(result.roots).size < result.roots.length);
  assert.deepEqual(hir.closure.roots.map(id => hir.functions.find(fn => fn.id === id).instanceKey), result.roots);
  assert.equal(new Set(hir.functions.map(fn => fn.instanceKey)).size, hir.functions.length);
  const edges = hir.functions.flatMap(fn => fn.body[0].value.kind === 'call' ? [fn.body[0].value.target] : []);
  assert.ok(edges.length > 0);
  assert.ok(edges.every(id => hir.closure.functions.includes(id)));
});
test('concrete candidate cold canonical round trip and source bounds survive', () => {
  const hir = candidate(), text = printGenericHir(hir);
  assert.deepEqual(readGenericHir(new TextEncoder().encode(text)), hir);
  assert.equal(text.at(-1), '\n');
  assert.throws(() => readGenericHir(new TextEncoder().encode(text.trim())), { code: 'generic-hir-canonical' });
  assert.throws(() => readGenericHir(Uint8Array.of(0xff)), { code: 'generic-hir-input' });
});
test('candidate HIR cannot masquerade as the formally registered 0.8 HIR', () => {
  assert.throws(() => lowerHir(candidate()), /r03-hir-invalid/);
});
test('result rejects foreign package or semantic profile and unknown session facts', () => {
  badResult(result => { result.packageId = 'sha256:' + 'f'.repeat(64); }, 'identity');
  badResult(result => { result.semanticProfile += '-foreign'; }, 'identity');
  badResult(result => { result.sessionId = 'not-owned'; }, 'schema');
  badResult(result => { result.instances[0].body.symbol = 1; }, 'schema');
});
test('result rejects changed instance identity, phantom arguments, duplicates and order', () => {
  badResult(result => { result.instances[0].key = '0'.repeat(64); }, 'identity');
  badResult(result => { result.instances[0].typeArguments[0].kind =
    result.instances[0].typeArguments[0].kind === 'number' ? 'boolean' : 'number'; }, 'identity');
  badResult(result => { result.instances.push(clone(result.instances[0])); }, 'identity');
  badResult(result => { result.instances.reverse(); }, 'identity');
});
test('result rejects wrong root request identity and private root definitions', () => {
  badResult(result => { result.roots[0] = '0'.repeat(64); }, 'root');
  badResult((_result, requests) => { requests[0].definition = 'f'.repeat(64); }, 'root');
  badResult((_result, requests) => { requests[0].typeArguments.push({ kind: 'boolean', parameter: 0 }); }, 'reference');
});
test('result rejects missing transitive callees and unrelated retained instances', () => {
  badResult(result => {
    const caller = result.instances.find(instance => instance.body.kind === 'call');
    result.instances = result.instances.filter(instance => instance.key !== caller.body.callee);
  }, 'reference');
  badResult((result, requests) => {
    const definitions = byName('unused');
    const removed = result.instances.find(instance => definitions.has(instance.definition) && instance.typeArguments[0].kind === 'number');
    const retained = requests.map((request, index) => ({ request, root: result.roots[index] })).filter(item => item.root !== removed.key);
    requests.splice(0, requests.length, ...retained.map(item => item.request));
    result.roots = retained.map(item => item.root);
  }, 'closure');
});
test('result rejects concrete type changes, foreign call targets and bad parameter references', () => {
  badResult(result => { result.instances[0].returnType = 'i32'; }, 'type');
  badResult(result => { result.instances.find(instance => instance.body.kind === 'call').body.callee = 'a'.repeat(64); }, 'reference');
  badResult(result => { result.instances.find(instance => instance.body.kind === 'parameter').body.parameter = 64; }, 'reference');
});
test('result rejects changed source origins and unknown fields at every typed boundary', () => {
  badResult(result => { result.instances[0].origin.start++; }, 'origin');
  badResult(result => { result.instances[0].parameters[0].origin.end--; }, 'origin');
  badResult(result => { result.instances[0].body.origin.start++; }, 'origin');
  badResult(result => { result.instances[0].parameters[0].extra = true; }, 'schema');
  badResult((_result, requests) => { requests[0].typeArguments[0].parameter = -0; }, 'schema');
});
test('result preflight rejects getters, cycles, sparse arrays and canonical byte budgets', () => {
  let invoked = false;
  badResult(result => {
    Object.defineProperty(result.instances[0], 'returnType', { enumerable: true, get() { invoked = true; return 'bool'; } });
  }, 'schema');
  assert.equal(invoked, false);
  badResult(result => { result.self = result; }, 'schema');
  badResult(result => { delete result.instances[0]; }, 'schema');
  badResult(result => { result.extra = 'x'.repeat(1048577); }, 'limit');
  badResult((result, requests) => {
    result.roots = Array(257).fill(result.roots[0]); requests.splice(0, requests.length, ...Array(257).fill(requests[0]));
  }, 'limit');
});
test('cold HIR rejects mixed format, forged linkage, ids and source-content substitution', () => {
  badHir(hir => { hir.format.version++; }, 'identity');
  badHir(hir => { hir.functions[0].linkageName += 'x'; }, 'identity');
  badHir(hir => { hir.functions[0].id = 'sha256:' + '0'.repeat(64); }, 'identity');
  badHir(hir => { hir.source.content = ''; }, 'schema');
});
test('cold HIR rejects split UTF16 surrogate boundaries and wrong source ranges', () => {
  assert.ok(candidate().source.surrogateStarts.length > 0);
  badHir(hir => { hir.functions[0].range.start = hir.source.surrogateStarts[0] + 1; }, 'origin');
  badHir(hir => { hir.functions[0].body[0].value.range.end = hir.source.length + 1; }, 'origin');
});
test('cold HIR rejects missing closure, changed call signatures and parameter binding types', () => {
  badHir(hir => { hir.closure.functions.pop(); }, 'closure');
  badHir(hir => { hir.functions.find(fn => fn.body[0].value.kind === 'call').body[0].value.signatureHash =
    'sha256:' + 'a'.repeat(64); }, 'reference');
  badHir(hir => { hir.functions.find(fn => fn.body[0].value.kind === 'reference').body[0].value.binding = 'p64'; }, 'reference');
});

// Synthetic owned-shape witnesses exercise allocation/closure limits only.
// They are not a mock checker or evidence of official semantic acceptance.
function structuralBoundary() {
  const input = clone(pkg), leaf = input.payload.definitions.find(def => def.name === 'identity');
  const caller = input.payload.definitions.find(def => def.name === 'route');
  for (const definition of [leaf, caller]) {
    definition.typeParameters = Array.from({ length: 8 }, (_, index) => 'T' + index);
    definition.parameters[0].type = { kind: 'boolean', parameter: 0 };
    definition.returnType = { kind: 'boolean', parameter: 0 };
  }
  caller.body.typeArguments = Array.from({ length: 8 }, (_, parameter) => ({ kind: 'parameter', parameter }));
  // Legal owned origin correspondence: call-argument trivia can precede its call.
  caller.body.arguments[0].origin = { start: caller.origin.start + 1, end: caller.origin.start + 2 };
  input.payload.definitions = [leaf, caller].sort((a, b) => a.key < b.key ? -1 : 1);
  input.packageId = genericPackageId(input.payload);
  const bytes = encodeGenericPackage(input), context = genericPackageContext(input);
  const requests = [], instances = [], roots = [];
  for (let bits = 0; bits < 256; bits++) {
    const args = Array.from({ length: 8 }, (_, bit) => ({ kind: bits & (1 << bit) ? 'number' : 'boolean', parameter: 0 }));
    const leafKey = genericInstanceKey(context, leaf.key, args), callerKey = genericInstanceKey(context, caller.key, args);
    const parameter = original => ({ kind: 'parameter', type: 'bool', parameter: 0, callee: '',
      arguments: [], origin: original.origin });
    const base = definition => ({ key: definition === leaf ? leafKey : callerKey, definition: definition.key,
      typeArguments: args, origin: definition.origin, parameters: definition.parameters.map(p => ({
        name: p.name, type: 'bool', origin: p.origin })), returnType: 'bool' });
    instances.push({ ...base(leaf), body: parameter(leaf.body) });
    instances.push({ ...base(caller), body: { kind: 'call', type: 'bool', parameter: 0, callee: leafKey,
      arguments: [parameter(caller.body.arguments[0])], origin: caller.body.origin } });
    requests.push({ definition: caller.key, typeArguments: args }); roots.push(callerKey);
  }
  instances.sort((a, b) => a.key < b.key ? -1 : 1);
  return { bytes, requests, result: { packageId: input.packageId,
    semanticProfile: input.payload.semanticProfile, roots, instances } };
}
test('structural boundary accepts 256 roots and 512 concrete closure instances', () => {
  const data = structuralBoundary();
  const result = validateGenericInstanceResult(data.bytes, data.result, data.requests);
  assert.equal(result.roots.length, 256); assert.equal(result.instances.length, 512);
  const hir = buildGenericHir(data.bytes, data.result, data.requests);
  assert.equal(hir.functions.length, 512); assert.equal(hir.closure.functions.length, 512);
  assert.deepEqual(readGenericHir(new TextEncoder().encode(printGenericHir(hir))), hir);
});
test('structural boundary rejects root 257 and concrete instance 513 independently', () => {
  const data = structuralBoundary(), extraRoot = clone(data.result), requests = clone(data.requests);
  extraRoot.roots.push(extraRoot.roots[0]); requests.push(requests[0]);
  assert.throws(() => validateGenericInstanceResult(data.bytes, extraRoot, requests), { code: 'generic-instance-limit' });
  const extraInstance = clone(data.result); extraInstance.instances.push(extraInstance.instances[0]);
  assert.throws(() => validateGenericInstanceResult(data.bytes, extraInstance, data.requests), { code: 'generic-instance-limit' });
  const hir = clone(buildGenericHir(data.bytes, data.result, data.requests));
  hir.functions.push(hir.functions[0]);
  assert.throws(() => verifyGenericHir(hir), { code: 'generic-hir-limit' });
});
test('cold HIR preserves individual definition-contained origins outside parent call anchors', () => {
  const data = structuralBoundary(), hir = buildGenericHir(data.bytes, data.result, data.requests);
  const value = hir.functions.find(fn => fn.body[0].value.kind === 'call').body[0].value;
  assert.ok(value.arguments[0].range.start < value.range.start);
  assert.deepEqual(verifyGenericHir(hir), hir);
});
test('cold HIR rechecks original definition identity from source metadata, name and origin', () => {
  badHir(hir => { hir.source.digest = 'f'.repeat(64); }, 'identity');
  badHir(hir => { hir.functions[0].name += 'Renamed'; }, 'identity');
  badHir(hir => { hir.functions[0].range.start++; }, 'identity');
});

// Re-identify structural data after a logical path change; this is not a new
// official Source checking witness. The original fixture remains untouched.
function structuralPathFixture(path) {
  const input = clone(pkg), result = clone(fixture.result), requests = clone(fixture.requests);
  input.payload.source.path = path;
  const definitions = new Map(input.payload.definitions.map(def => [def.key,
    genericDefinitionKey(def, input.payload)]));
  for (const definition of input.payload.definitions) {
    definition.key = definitions.get(definition.key);
    const visit = value => {
      if (value.kind === 'call') value.definition = definitions.get(value.definition);
      value.arguments.forEach(visit);
    };
    visit(definition.body);
  }
  input.payload.definitions.sort((a, b) => a.key < b.key ? -1 : 1);
  input.packageId = genericPackageId(input.payload);
  const context = genericPackageContext(input), instances = new Map();
  for (const instance of result.instances) {
    instance.definition = definitions.get(instance.definition);
    const key = genericInstanceKey(context, instance.definition, instance.typeArguments);
    instances.set(instance.key, key); instance.key = key;
  }
  for (const instance of result.instances) {
    const visit = value => {
      if (value.kind === 'call') value.callee = instances.get(value.callee);
      value.arguments.forEach(visit);
    };
    visit(instance.body);
  }
  result.packageId = input.packageId; result.roots = result.roots.map(key => instances.get(key));
  result.instances.sort((a, b) => a.key < b.key ? -1 : 1);
  requests.forEach(request => { request.definition = definitions.get(request.definition); });
  return { bytes: encodeGenericPackage(input), result, requests };
}
test('structural logical source path containing a colon survives package and concrete cold HIR', () => {
  const data = structuralPathFixture('/original/name:copy.ts');
  assert.equal(decodeGenericPackage(data.bytes).payload.source.path, '/original/name:copy.ts');
  const hir = buildGenericHir(data.bytes, data.result, data.requests);
  assert.equal(hir.source.path, '/original/name:copy.ts');
  assert.deepEqual(readGenericHir(new TextEncoder().encode(printGenericHir(hir))), hir);
});
const boundedWireFailure = text => {
  const bytes = new TextEncoder().encode(text);
  assert.ok(bytes.byteLength <= 8388608);
  assert.throws(() => readGenericHir(bytes), { code: 'generic-hir-limit' });
};
test('cold JSON preflight bounds container depth before whole-graph parsing', () => {
  boundedWireFailure('['.repeat(161) + '0' + ']'.repeat(161));
  // A malformed suffix would make whole-graph JSON.parse report input first.
  boundedWireFailure('['.repeat(161) + '!');
});
test('cold JSON preflight bounds one million token events before whole-graph parsing', () => {
  const prefix = '[' + '0,'.repeat(1000000);
  boundedWireFailure(prefix + '0]');
  boundedWireFailure(prefix + '!');
});
test('cold JSON preflight bounds strings before whole-graph parsing', () => {
  const oversized = '"' + 'x'.repeat(1048577) + '"';
  boundedWireFailure(oversized);
  boundedWireFailure(oversized + '!');
});
test('cold JSON shared reader preserves canonical, duplicate-key and syntax failures', () => {
  const text = printGenericHir(candidate()), utf8 = value => new TextEncoder().encode(value);
  assert.throws(() => readGenericHir(utf8('\ufeff' + text)), { code: 'generic-hir-canonical' });
  assert.throws(() => readGenericHir(utf8('{"a":0,"a":1}')), { code: 'generic-hir-input' });
  assert.throws(() => readGenericHir(utf8('{"a":')), { code: 'generic-hir-input' });
});

// This bounded structural witness pads independent parameter display names.
// No extra functions, executable semantics or official checker claims are added.
test('cold HIR print and read agree at the exact 8MiB wire limit including final LF', () => {
  const data = structuralBoundary(), hir = clone(buildGenericHir(data.bytes, data.result, data.requests));
  const limit = 8388608, utf8 = new TextEncoder();
  let remaining = limit - 1 - Buffer.byteLength(canonical(hir), 'utf8');
  assert.ok(remaining > 0);
  for (const fn of hir.functions) {
    const parameter = fn.parameters[0];
    const added = Math.min(remaining, 1048576 - Buffer.byteLength(parameter.name, 'utf8'));
    parameter.name += 'x'.repeat(added); remaining -= added;
    if (remaining === 0) break;
  }
  assert.equal(remaining, 0);
  const text = printGenericHir(hir);
  assert.equal(Buffer.byteLength(text, 'utf8'), limit);
  assert.equal(readGenericHir(utf8.encode(text)).functions.length, 512);
  const spare = hir.functions.find(fn => Buffer.byteLength(fn.parameters[0].name, 'utf8') < 1048576);
  spare.parameters[0].name += 'x';
  // The object budget fits; adding the mandatory LF must reject at the print gate.
  assert.equal(Buffer.byteLength(canonical(verifyGenericHir(hir)), 'utf8'), limit);
  assert.throws(() => printGenericHir(hir), { code: 'generic-hir-limit' });
  assert.throws(() => readGenericHir(utf8.encode(canonical(hir) + '\n')), { code: 'generic-hir-limit' });
});
