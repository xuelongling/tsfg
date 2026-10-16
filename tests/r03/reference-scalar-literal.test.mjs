// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir, verifyReferenceHir } from '../../compiler/reference-hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';

// Actual official Program/checker output: PID18816, 42 producer inputs, retained
// in M12-class-facts-checks-20261016/candidate-graphs-v2-final-green.
// Copied bytes and bindings prove correspondence only, not Source admission.
const fixture = name => new URL('./fixtures/reference-source/' + name, import.meta.url);
async function official(name, expectedSha) {
  const bytes = await readFile(fixture(name + '.facts.json'));
  assert.equal(sha256(bytes), expectedSha);
  const binding = JSON.parse(await readFile(fixture(name + '.binding.json'), 'utf8'));
  const source = await readFile(fixture(name + '.source.ts'), 'utf8');
  const sourceBinding = binding.sources.find(item => !item.declaration);
  assert.ok(sourceBinding);
  assert.equal(sha256(source), sourceBinding.sha256);
  assert.equal(source.length, sourceBinding.utf16Length);
  return decodeReferenceFacts(bytes, binding);
}
function coldRoundTrip(hir) {
  assert.deepEqual(verifyReferenceHir(hir), hir);
  const bytes = Buffer.from(printReferenceHir(hir));
  const cold = readReferenceHir(bytes);
  bytes.fill(0);
  assert.deepEqual(cold, hir);
  return cold;
}

test('official four-scalar metadata preserves storage, returns and nominal origins in cold HIR', async () => {
  const facts = await official('scalars', 'sha256:79b3dfcba9ba961ffe55b884a5dcb38d7c4200888cfc4f9a9274acc858491ab9');
  const policyBytes = await readFile(fixture('scalar-declaration-policy.json'));
  assert.equal(sha256(policyBytes), 'sha256:8cac85f33b9242571990a6fc4838827824a2444f6f29452a2f92c10970798db1');
  // This fixture is Root's fixed private descriptor, never graph-supplied policy.
  const policy = JSON.parse(policyBytes.toString('utf8'));
  const hir = buildReferenceHir(facts), item = hir.classes[0];
  const types = new Map(hir.types.map(type => [type.id, type]));
  assert.equal(item.name, 'Scalars');
  assert.deepEqual(item.fields.map(field => field.name), ['i', 'f', 'd', 'b']);
  assert.deepEqual(item.fields.map(field => types.get(field.type).scalar), ['i32', 'f32', 'f64', 'bool']);
  assert.equal(item.constructor.signature.parameters.length, 4);
  assert.equal(item.constructor.body.length, 4);
  assert.equal(item.methods.length, 4);
  assert.deepEqual(item.constructor.initializationBoundary, { kind: 'entry' });
  assert.deepEqual(item.constructor.initializationFields, item.fields.map(field => field.id));
  for (const [index, field] of item.fields.entries()) {
    assert.equal(field.initializer, null);
    assert.equal(field.initializerCompatibility, null);
    assert.equal(field.definiteAssertion, false);
    const parameter = item.constructor.signature.parameters[index];
    const store = item.constructor.body[index].expression;
    assert.equal(parameter.type, field.type);
    assert.equal(store.kind, 'ref.field.write');
    assert.equal(store.type, field.type);
    assert.equal(store.left.kind, 'ref.field.location');
    assert.equal(store.left.symbol, field.symbol);
    assert.equal(store.left.receiver.kind, 'ref.this');
    assert.equal(store.right.kind, 'ref.parameter');
    assert.equal(store.right.type, field.type);
    assert.equal(store.right.symbol, parameter.symbol);
    assert.deepEqual(store.compatibility, {
      assignable: true, members: [], origin: store.right.origin,
      sourceType: field.type, targetType: field.type,
    });
    const method = item.methods[index], returned = method.body[0];
    assert.equal(method.signature.return, field.type);
    assert.equal(method.body.length, 1);
    assert.equal(returned.kind, 'return');
    assert.equal(returned.expression.kind, 'ref.field.read');
    assert.equal(returned.expression.symbol, field.symbol);
    assert.equal(returned.expression.type, field.type);
    assert.deepEqual(returned.compatibility, {
      assignable: true, members: [], origin: returned.expression.origin,
      sourceType: field.type, targetType: field.type,
    });
  }
  const declaration = hir.sources.find(source => source.declaration && source.sha256 === policy.declaration.sha256);
  assert.ok(declaration);
  assert.equal(declaration.utf16Length, 17464);
  assert.deepEqual(declaration.surrogateStarts, []);
  assert.equal(policy.declaration.role, 'canonical-r01-scalars');
  assert.equal(policy.declaration.version, 'minimal-conversions-v5');
  for (const [index, scalar] of ['i32', 'f32'].entries()) {
    const type = types.get(item.fields[index].type);
    const anchors = policy.nominals.find(nominal => nominal.scalar === scalar);
    assert.ok(anchors);
    assert.equal(type.kind, 'scalar');
    assert.equal(type.literal, '');
    assert.deepEqual(type.nominal, {
      alias: { ...anchors.alias, source: declaration.path },
      brand: { ...anchors.brand, source: declaration.path },
      source: declaration.path, sha256: policy.declaration.sha256, version: policy.declaration.version,
    });
  }
  assert.equal(types.get(item.fields[2].type).kind, 'number');
  assert.equal(types.get(item.fields[2].type).nominal, null);
  assert.equal(types.get(item.fields[3].type).kind, 'boolean');
  assert.equal(types.get(item.fields[3].type).nominal, null);
  assert.deepEqual(hir.types, facts.graph.types);
  coldRoundTrip(hir);
});

test('official numeric-literal metadata remains unresolved through cold HIR round trip', async () => {
  const facts = await official('constructor', 'sha256:55aed6fff72963bd12591ca45eca19d53dfebdb07f48eb6b05fa2d6c0dd4ec5d');
  const hir = buildReferenceHir(facts), field = hir.classes[0].fields[0];
  const literal = field.initializer;
  assert.equal(literal.kind, 'scalar.literal.unresolved');
  assert.equal(literal.token, '1');
  assert.equal(literal.type, 'nl1');
  assert.deepEqual(literal.origin, { source: '/original/main.ts', start: 39, end: 40 });
  assert.deepEqual(literal.numericLiteral, {
    state: 'unresolved', officialType: literal.type, defaultScalar: 'i32', contextType: field.type,
  });
  const narrow = hir.types.find(type => type.id === literal.type);
  assert.ok(narrow);
  assert.equal(narrow.kind, 'number-literal');
  assert.equal(narrow.literal, '1');
  assert.equal(narrow.scalar, '');
  assert.equal(narrow.nominal, null);
  const context = hir.types.find(type => type.id === literal.numericLiteral.contextType);
  assert.ok(context);
  assert.equal(context.scalar, 'f64');
  assert.notEqual(literal.type, field.type);
  assert.equal(Object.hasOwn(literal, 'bits'), false);
  assert.equal(Object.hasOwn(literal, 'resolvedScalar'), false);
  assert.equal(Object.hasOwn(literal.numericLiteral, 'bits'), false);
  assert.equal(Object.hasOwn(literal.numericLiteral, 'resolvedScalar'), false);
  assert.deepEqual(field.initializerCompatibility, {
    assignable: true, members: [], origin: literal.origin, sourceType: literal.type, targetType: field.type,
  });
  assert.notEqual(literal, facts.graph.classes[0].fields[0].initializer);
  assert.deepEqual(coldRoundTrip(hir).classes[0].fields[0].initializer, literal);
  const literalFacts = await official('literal-facts', 'sha256:c414558cf0f8af41632dfcfc9d4c3ea4073f83f09a8d4b365c25aed417867423');
  const literals = buildReferenceHir(literalFacts), owner = literals.classes[0];
  const source = await readFile(fixture('literal-facts.source.ts'), 'utf8');
  assert.equal(owner.name, 'Literals');
  assert.equal(owner.fields.length, 7);
  assert.equal(owner.methods.length, 0);
  assert.equal(owner.constructor.kind, 'implicit-base');
  assert.deepEqual(owner.constructor.body, []);
  assert.deepEqual(owner.constructor.initializationFields, owner.fields.map(value => value.id));
  const expected = [
    ['integer','1','i32','1'], ['decimal','1.0','f64','1'],
    ['exponent','1e0','f64','1'], ['hexadecimal','0x1','i32','1'],
    ['hexadecimalE','0xDEAD','i32','57005'],
    ['exactLarge','9007199254740992','i32','9007199254740992'],
    ['roundedLarge','9007199254740993','i32','9007199254740992'],
  ];
  const occurrences = owner.fields.map(value => value.initializer);
  assert.equal(new Set(occurrences).size, 7);
  assert.equal(new Set(occurrences.map(value => value.id)).size, 7);
  assert.equal(new Set(occurrences.slice(0,4).map(value => value.type)).size, 1);
  assert.equal(occurrences[5].type, occurrences[6].type);
  assert.notEqual(occurrences[5].token, occurrences[6].token);
  for (const [index, [name, token, defaultScalar, officialText]] of expected.entries()) {
    const slot = owner.fields[index], value = slot.initializer;
    assert.equal(slot.name, name);
    assert.equal(slot.ordinal, index);
    assert.equal(value.kind, 'scalar.literal.unresolved');
    assert.equal(value.token, token);
    assert.deepEqual(value.numericLiteral, {
      state: 'unresolved', officialType: value.type, defaultScalar, contextType: slot.type,
    });
    const type = literals.types.find(candidate => candidate.id === value.type);
    assert.ok(type);
    assert.equal(type.kind, 'number-literal'); assert.equal(type.scalar, '');
    assert.equal(type.nominal, null); assert.equal(type.literal, officialText);
    assert.notEqual(value.type, slot.type);
    const contextType = literals.types.find(candidate => candidate.id === slot.type);
    assert.ok(contextType); assert.equal(contextType.scalar, 'f64');
    const start = source.indexOf('= ' + token + ';') + 2;
    assert.ok(start >= 2);
    assert.deepEqual(value.origin, { source: '/original/main.ts', start, end: start + token.length });
    for (const record of [value, value.numericLiteral]) {
      assert.equal(Object.hasOwn(record, 'bits'), false);
      assert.equal(Object.hasOwn(record, 'resolvedScalar'), false);
    }
    assert.deepEqual(slot.initializerCompatibility, {
      assignable: true, members: [], origin: value.origin, sourceType: value.type, targetType: slot.type,
    });
  }
  const cold = coldRoundTrip(literals);
  assert.equal(new Set(cold.classes[0].fields.map(value => value.initializer)).size, 7);
});
