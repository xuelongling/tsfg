// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir, verifyReferenceHir } from '../../compiler/reference-hir.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
const fixture = name => new URL('./fixtures/reference-source/' + name, import.meta.url);
async function officialCounter() {
  const bytes = await readFile(fixture('constructor.facts.json'));
  assert.equal(sha256(bytes), 'sha256:55aed6fff72963bd12591ca45eca19d53dfebdb07f48eb6b05fa2d6c0dd4ec5d');
  const binding = JSON.parse(await readFile(fixture('constructor.binding.json'), 'utf8'));
  return { bytes, binding };
}
const encode = value => Buffer.from(canonical(value));
const rejects = (callback, code) => assert.throws(callback, error => error instanceof Error && Object.hasOwn(error, 'code') && Reflect.get(error, 'code') === 'reference-facts-' + code);
test('official Counter bytes build cold owned constructor and scalar-method HIR', async () => {
  // Real official Program/checker capture, serialized after projection returned.
  // This test only consumes copied bytes; no Source session or process is used.
  const { bytes, binding } = await officialCounter();
  const facts = decodeReferenceFacts(bytes, binding);
  bytes.fill(0); binding.scope = 'changed-after-decode';
  assert.equal(facts.binding.scope, 'class:test');
  assert.ok(Object.isFrozen(facts.graph.classes[0].constructor.body[0].expression));
  const hir = buildReferenceHir(facts), counter = hir.classes[0];
  assert.notEqual(hir.classes, facts.graph.classes);
  assert.notEqual(counter.constructor.body, facts.graph.classes[0].constructor.body);
  assert.deepEqual(counter.constructor.initializationBoundary, { kind: 'entry' });
  assert.equal(counter.constructor.initializationPhase, 'before-body');
  assert.deepEqual(counter.constructor.initializationFields, ['c1.f0']);
  assert.equal(counter.fields[0].initializer.kind, 'scalar.literal.unresolved');
  assert.equal(counter.fields[0].initializer.token, '1');
  assert.equal(counter.fields[0].initializer.numericLiteral.state, 'unresolved');
  assert.equal(counter.fields[0].initializer.numericLiteral.contextType, counter.fields[0].type);
  assert.notEqual(counter.fields[0].initializer.type, counter.fields[0].type);
  assert.equal(counter.fields[0].type, 't:number');
  const initialize = counter.constructor.body[0].expression;
  assert.equal(initialize.kind, 'ref.field.write');
  assert.equal(initialize.left.kind, 'ref.field.location');
  assert.equal(initialize.left.symbol, 'c1.f0.symbol');
  assert.equal(initialize.left.receiver.kind, 'ref.this');
  assert.equal(initialize.right.kind, 'ref.parameter');
  assert.equal(initialize.right.symbol, 'c1.ctor.p0');
  const add = counter.methods[0];
  assert.equal(add.name, 'add'); assert.equal(add.body.length, 2);
  assert.equal(add.body[0].expression.kind, 'ref.field.write');
  assert.equal(add.body[0].expression.right.kind, 'scalar.add');
  assert.equal(add.body[0].expression.right.left.kind, 'ref.field.read');
  assert.equal(add.body[0].expression.right.right.symbol, 'c1.m0.p0');
  assert.equal(add.body[1].kind, 'return');
  assert.equal(add.body[1].expression.kind, 'ref.field.read');
  assert.deepEqual(add.body[1].expression.origin, { source: '/original/main.ts', start: 160, end: 170 });
  const persisted = Buffer.from(printReferenceHir(hir));
  const cold = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(cold, hir);
  assert.equal(cold.format.family, 'tsfg.reference-hir-candidate');
  assert.equal(Object.hasOwn(cold, 'frontendSource'), false);
});
test('Counter facts reject binding, witness, closure, origin and byte budget corruption', async () => {
  const { bytes, binding } = await officialCounter();
  const change = callback => { const graph = JSON.parse(bytes.toString('utf8')); callback(graph); return encode(graph); };
  rejects(() => decodeReferenceFacts(bytes, { ...binding, scope: 'other' }), 'binding');
  rejects(() => decodeReferenceFacts(change(graph => { graph.classes[0].constructor.body[0].expression.compatibility.assignable = false; }), binding), 'witness');
  rejects(() => decodeReferenceFacts(change(graph => { graph.symbols.push({ ...graph.symbols[0], id: 'extra' }); }), binding), 'closure');
  rejects(() => decodeReferenceFacts(change(graph => { graph.classes[0].methods[0].body[1].expression.symbol = 'missing'; }), binding), 'closure');
  rejects(() => decodeReferenceFacts(change(graph => { graph.classes[0].methods[0].body[1].expression.origin.end = 176; }), binding), 'origin');
  rejects(() => decodeReferenceFacts(Buffer.concat([bytes, Buffer.from(' ')]), binding), 'canonical');
  rejects(() => decodeReferenceFacts(Buffer.from('{"classes":[],"classes":[]}'), binding), 'json');
  rejects(() => decodeReferenceFacts(bytes, binding, { limits: { bytes: 1 } }), 'limit');
});
test('cold reference HIR rejects unknown operation data and fabricated initialization boundaries', async () => {
  const { bytes, binding } = await officialCounter();
  const hir = buildReferenceHir(decodeReferenceFacts(bytes, binding));
  const changed = callback => { const value = structuredClone(hir); callback(value); return value; };
  rejects(() => verifyReferenceHir(changed(value => { value.classes[0].methods[0].body[1].expression.extraReference = 'foreign'; })), 'schema');
  rejects(() => verifyReferenceHir(changed(value => { value.classes[0].constructor.initializationBoundary.kind = 'already-initialized'; })), 'initialization');
  rejects(() => verifyReferenceHir(changed(value => { value.classes[0].constructor.body[0].expression.left.kind = 'ref.field.read'; })), 'permission');
  rejects(() => verifyReferenceHir(changed(value => { value.context.factsDigest = 'sha256:' + '0'.repeat(64); })), 'identity');
});

test('official readonly conversions retain alias identity across distinct field ordinals', async () => {
  const bytes = await readFile(fixture('readonly.facts.json'));
  assert.equal(sha256(bytes), 'sha256:e23ce59ef86efb20301e81f68f51424be0ba697e18ddeb697791ca96d6d7db0f');
  const binding = JSON.parse(await readFile(fixture('readonly.binding.json'), 'utf8'));
  const facts = decodeReferenceFacts(bytes, binding);
  const hir = buildReferenceHir(facts);
  const [readView, mutable, holder] = hir.classes;
  assert.equal(readView.name, 'ReadView'); assert.equal(mutable.name, 'Mutable'); assert.equal(holder.name, 'Holder');
  assert.equal(readView.fields[0].ordinal, 0); assert.equal(mutable.fields[1].ordinal, 1);
  const projection = [{ source: mutable.fields[1].symbol, target: readView.fields[0].symbol }];
  const isView = (view, sourceType, targetType, sourceKind) => {
    assert.equal(view.kind, 'ref.view');
    assert.equal(view.sourceType, sourceType); assert.equal(view.targetType, targetType);
    assert.equal(view.value.kind, sourceKind);
    assert.equal(view.value.type, sourceType);
    assert.deepEqual(view.members, projection);
    assert.deepEqual(view.origin, view.value.origin);
  };
  isView(mutable.fields[2].initializer, mutable.thisType, readView.instanceType, 'ref.this');
  assert.equal(mutable.fields[2].initializer.value.symbol, mutable.symbol);
  isView(mutable.methods[0].body[0].expression, mutable.thisType, readView.instanceType, 'ref.this');
  const store = holder.constructor.body[0].expression;
  isView(store.right, mutable.instanceType, readView.instanceType, 'ref.parameter');
  assert.equal(store.right.value.symbol, holder.constructor.signature.parameters[0].symbol);
  const mutation = holder.constructor.body[1].expression;
  assert.equal(mutation.kind, 'ref.field.write');
  assert.equal(mutation.left.symbol, mutable.fields[1].symbol);
  assert.equal(mutation.left.receiver.symbol, store.right.value.symbol);
  assert.equal(mutation.left.permission.writable, true);
  // An initialization boundary never invents a value for this absent initializer.
  assert.equal(holder.fields[0].initializer, null);
  assert.equal(holder.fields[0].definiteAssertion, false);
  assert.deepEqual(holder.constructor.initializationFields, [holder.fields[0].id]);
  const transfer = holder.methods[1].body[0].expression;
  assert.equal(transfer.kind, 'ref.view');
  assert.equal(transfer.value.kind, 'ref.method.call');
  isView(transfer.value.arguments[0], mutable.instanceType, readView.instanceType, 'ref.parameter');
  const read = holder.methods[2].body[0].expression;
  assert.equal(read.kind, 'ref.field.read'); assert.equal(read.permission.readonly, true);
  assert.equal(read.permission.writeUse, false);
  assert.deepEqual(readReferenceHir(Buffer.from(printReferenceHir(hir))), hir);
});
test('Counter facts reject malformed numeric token representations', async () => {
  const { bytes, binding } = await officialCounter();
  for (const token of ['0x', '1abc']) {
    const graph = JSON.parse(bytes.toString('utf8'));
    graph.classes[0].fields[0].initializer.token = token;
    rejects(() => decodeReferenceFacts(encode(graph), binding), 'representation');
  }
});
