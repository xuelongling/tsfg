// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, readReferenceHir, printReferenceHir } from '../../compiler/reference-hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';
const fixture = name => new URL('./fixtures/reference-source/' + name, import.meta.url);
async function actual(name, digest) {
  const bytes = await readFile(fixture(name + '.facts.json')); assert.equal(sha256(bytes), 'sha256:' + digest);
  const binding = JSON.parse(await readFile(fixture(name + '.binding.json'), 'utf8'));
  const source = await readFile(fixture(name + '.source.ts'));
  const declarations = await readFile(fixture('minimal-scalars-v2.d.ts'));
  assert.equal(sha256(source), binding.sources[0].sha256);
  assert.equal(source.toString('utf8').length, binding.sources[0].utf16Length);
  assert.equal(sha256(declarations), binding.sources[1].sha256);
  assert.equal(declarations.toString('utf8').length, binding.sources[1].utf16Length);
  return { bytes, binding };
}
test('official implicit-derived bytes preserve logical forwarding and successful-base initialization', async () => {
  const { bytes, binding } = await actual('implicit-derived', '162e8e77789a86d5e9c295d93066fb34e366189d0cf1bc43d9280141f13a5bca');
  const facts = decodeReferenceFacts(bytes, binding), hir = buildReferenceHir(facts);
  const [base, derived] = hir.classes, baseConstructor = base.constructor, constructor = derived.constructor;
  assert.equal(derived.base, base.id); assert.equal(constructor.kind, 'implicit-derived');
  assert.equal(baseConstructor.implicitForward, null);
  assert.equal(constructor.body.length, 0); assert.equal(constructor.superCall, '');
  const parameter = constructor.signature.parameters[0], inherited = baseConstructor.signature.parameters[0];
  assert.notEqual(parameter.symbol, inherited.symbol); assert.equal(parameter.inheritedFrom, inherited.symbol);
  assert.equal(inherited.inheritedFrom, ''); assert.deepEqual(parameter.origin, inherited.origin);
  assert.ok(parameter.origin.end < derived.origin.start);
  const ownSymbol = hir.symbols.find(symbol => symbol.id === parameter.symbol);
  const baseSymbol = hir.symbols.find(symbol => symbol.id === inherited.symbol);
  assert.equal(ownSymbol.kind, 'implicit-parameter'); assert.equal(baseSymbol.kind, 'parameter');
  assert.deepEqual(ownSymbol.declaration, baseSymbol.declaration);
  assert.equal(baseConstructor.body[0].expression.right.symbol, inherited.symbol);
  const forward = constructor.implicitForward;
  assert.equal(forward.kind, 'ref.super.forward'); assert.equal(forward.target, baseConstructor.id);
  assert.deepEqual(forward.baseSignature, baseConstructor.signature); assert.deepEqual(forward.origin, derived.origin);
  assert.equal(forward.parameters.length, 1);
  assert.equal(forward.parameters[0].source, parameter.symbol); assert.equal(forward.parameters[0].target, inherited.symbol);
  assert.equal(forward.parameters[0].compatibility.assignable, true);
  assert.equal(forward.parameters[0].compatibility.sourceType, parameter.type);
  assert.equal(forward.parameters[0].compatibility.targetType, inherited.type);
  assert.deepEqual(forward.parameters[0].compatibility.origin, derived.origin);
  assert.equal(constructor.initializationPhase, 'after-successful-super');
  assert.deepEqual(constructor.initializationBoundary, { kind: 'successful-forward', target: baseConstructor.id });
  assert.deepEqual(constructor.initializationFields, [derived.fields[0].id]);
  assert.equal(derived.fields[0].initializer.token, '2');
  assert.deepEqual(readReferenceHir(Buffer.from(printReferenceHir(hir))), hir);
});
test('official construct bytes preserve allocation class signature arguments and reference views', async () => {
  const { bytes, binding } = await actual('construct', 'e0dcbfba0174a9e5f02f36018bde40ddcb9e7afe7ae51450c7d0e3a81a5d82f3');
  const facts = decodeReferenceFacts(bytes, binding), hir = buildReferenceHir(facts);
  const [counter, factory] = hir.classes;
  assert.equal(counter.name, 'Counter'); assert.equal(factory.name, 'Factory');
  const freshView = factory.fields[0].initializer;
  assert.equal(freshView.kind, 'ref.view'); assert.equal(freshView.sourceType, counter.instanceType);
  assert.equal(freshView.targetType, counter.instanceType);
  const fresh = freshView.value;
  assert.equal(fresh.kind, 'ref.construct'); assert.equal(fresh.dispatch, 'direct-constructor');
  assert.equal(fresh.staticTarget, counter.constructor.id); assert.equal(fresh.type, counter.instanceType);
  assert.equal(fresh.receiver.kind, 'ref.class'); assert.equal(fresh.receiver.symbol, counter.symbol);
  assert.equal(fresh.receiver.type, counter.constructorType);
  assert.deepEqual(fresh.resolvedSignature, counter.constructor.signature);
  assert.equal(fresh.arguments[0].kind, 'scalar.literal.unresolved'); assert.equal(fresh.arguments[0].token, '5');
  assert.equal(fresh.argumentCompatibility[0].assignable, true);
  const make = factory.methods[0], returned = make.body[0].expression;
  assert.equal(make.name, 'make'); assert.equal(returned.kind, 'ref.view');
  assert.equal(returned.value.kind, 'ref.construct'); assert.equal(returned.value.staticTarget, counter.constructor.id);
  assert.equal(returned.value.receiver.kind, 'ref.class'); assert.equal(returned.value.receiver.symbol, counter.symbol);
  assert.equal(returned.value.arguments[0].kind, 'ref.parameter');
  assert.equal(returned.value.arguments[0].symbol, make.signature.parameters[0].symbol);
  assert.notEqual(fresh.id, returned.value.id);
  assert.deepEqual(fresh.origin, { source: '/original/main.ts', start: 135, end: 149 });
  assert.deepEqual(returned.value.origin, { source: '/original/main.ts', start: 190, end: 207 });
  assert.deepEqual(readReferenceHir(Buffer.from(printReferenceHir(hir))), hir);
});

test('official implicit-middle bytes keep direct constructor targets and inherited logical signatures', async () => {
  const { bytes, binding } = await actual('implicit-middle', 'fbb28a45bce47cb4a636cad783581b5bca535c5883a6dd679eea7b922fbaebd4');
  const hir = buildReferenceHir(decodeReferenceFacts(bytes, binding));
  const [base, middle, leaf] = hir.classes;
  assert.deepEqual(hir.classes.map(value => value.name), ['Base','Middle','Leaf']);
  assert.equal(middle.base, base.id); assert.equal(leaf.base, middle.id);
  const inherited = base.constructor.signature.parameters[0];
  const logical = middle.constructor.signature.parameters[0];
  assert.equal(middle.constructor.kind, 'implicit-derived');
  assert.deepEqual(middle.constructor.body, []); assert.equal(middle.constructor.superCall, '');
  assert.equal(logical.inheritedFrom, inherited.symbol);
  assert.notEqual(logical.symbol, inherited.symbol); assert.deepEqual(logical.origin, inherited.origin);
  assert.ok(logical.origin.end < middle.origin.start);
  const symbol = hir.symbols.find(value => value.id === logical.symbol);
  assert.ok(symbol); assert.equal(symbol.kind, 'implicit-parameter');
  // A symbol names the identifier; a class parameter owns its complete typed
  // declaration. Logical forwarding preserves each real Base anchor separately.
  const source = await readFile(fixture('implicit-middle.source.ts'), 'utf8');
  const baseSymbol = hir.symbols.find(value => value.id === inherited.symbol);
  assert.ok(baseSymbol); assert.equal(baseSymbol.kind, 'parameter');
  for (const parameter of [inherited, logical]) {
    assert.deepEqual(parameter.origin, { source: '/original/main.ts', start: 51, end: 63 });
    assert.equal(source.slice(parameter.origin.start, parameter.origin.end), 'seed: number');
  }
  for (const parameterSymbol of [baseSymbol, symbol]) {
    assert.equal(parameterSymbol.name, 'seed');
    assert.deepEqual(parameterSymbol.declaration, { source: '/original/main.ts', start: 51, end: 55 });
    assert.equal(source.slice(parameterSymbol.declaration.start, parameterSymbol.declaration.end), 'seed');
  }
  assert.notDeepEqual(symbol.declaration, logical.origin);
  const forward = middle.constructor.implicitForward;
  assert.equal(forward.kind, 'ref.super.forward'); assert.equal(forward.target, base.constructor.id);
  assert.deepEqual(forward.baseSignature, base.constructor.signature);
  assert.deepEqual(forward.parameters, [{ source: logical.symbol, target: inherited.symbol,
    compatibility: { assignable: true, members: [], origin: middle.origin,
      sourceType: logical.type, targetType: inherited.type } }]);
  assert.deepEqual(middle.constructor.initializationBoundary, { kind: 'successful-forward', target: base.constructor.id });
  assert.deepEqual(middle.constructor.initializationFields, [middle.fields[0].id]);
  assert.equal(middle.fields[0].initializer.kind, 'scalar.literal.unresolved');
  assert.equal(middle.fields[0].initializer.token, '2');
  const call = leaf.constructor.body[0].expression;
  assert.equal(call.kind, 'ref.super.construct'); assert.equal(call.staticTarget, middle.constructor.id);
  assert.notEqual(call.staticTarget, base.constructor.id);
  assert.equal(call.receiver.kind, 'ref.super'); assert.equal(call.receiver.symbol, middle.symbol);
  assert.equal(call.receiver.type, middle.constructorType);
  assert.deepEqual(call.resolvedSignature, middle.constructor.signature);
  assert.equal(call.resolvedSignature.parameters[0].symbol, logical.symbol);
  assert.equal(call.arguments[0].kind, 'ref.parameter');
  assert.equal(call.arguments[0].symbol, leaf.constructor.signature.parameters[0].symbol);
  assert.deepEqual(leaf.constructor.initializationBoundary, { kind: 'successful-return', expressionId: call.id });
  assert.deepEqual(leaf.constructor.initializationFields, []);
  const returned = leaf.methods[0].body[0].expression;
  assert.equal(returned.kind, 'ref.view'); assert.equal(returned.targetType, middle.instanceType);
  const construct = returned.value;
  assert.equal(construct.kind, 'ref.construct'); assert.equal(construct.staticTarget, middle.constructor.id);
  assert.notEqual(construct.staticTarget, base.constructor.id);
  assert.equal(construct.type, middle.instanceType);
  assert.equal(construct.receiver.kind, 'ref.class'); assert.equal(construct.receiver.symbol, middle.symbol);
  assert.equal(construct.receiver.type, middle.constructorType);
  assert.deepEqual(construct.resolvedSignature, middle.constructor.signature);
  assert.equal(construct.arguments[0].symbol, leaf.methods[0].signature.parameters[0].symbol);
  assert.deepEqual(readReferenceHir(Buffer.from(printReferenceHir(hir))), hir);
});
