// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, verifyReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
const fixture = suffix => new URL('./fixtures/reference-source/multiple-sources.' + suffix, import.meta.url);
async function actual() {
  // Real public Program/checker capture PID21124; not Source admission or execution.
  const [bytes, text, main, base] = await Promise.all([
    readFile(fixture('facts.json')), readFile(fixture('binding.json'), 'utf8'),
    readFile(fixture('a-main.source.ts'), 'utf8'), readFile(fixture('z-base.source.ts'), 'utf8'),
  ]);
  assert.equal(sha256(bytes), 'sha256:593093a1772fff01f8c6c82802e50edf44b24f29042c2e3ace494957e6a93db7');
  const binding = JSON.parse(text), sources = new Map([['/original/a-main.ts', main], ['/original/z-base.ts', base]]);
  for (const origin of binding.sources.filter(source => !source.declaration)) {
    const source = sources.get(origin.path); assert.ok(source);
    assert.equal(sha256(source), origin.sha256); assert.equal(source.length, origin.utf16Length);
    assert.deepEqual(origin.surrogateStarts, [3]);
  }
  assert.equal(main.length, 400); assert.equal(base.length, 172);
  const facts = decodeReferenceFacts(bytes, binding), hir = buildReferenceHir(facts);
  return { bytes, binding, hir, sources };
}
test('official multiple-source classes retain forward inheritance canonical aliases and independent assignment result types', async () => {
  const { hir, sources } = await actual();
  assert.equal(hir.format.version, 5); assert.equal(hir.sources.length, 3);
  const [derived, base] = hir.classes;
  assert.equal(derived.name, 'Derived'); assert.equal(base.name, 'Base'); assert.equal(derived.base, base.id);
  assert.equal(derived.origin.source, '/original/a-main.ts'); assert.equal(base.origin.source, '/original/z-base.ts');
  const forward = derived.constructor.implicitForward;
  assert.equal(derived.constructor.kind, 'implicit-derived');
  assert.equal(forward.kind, 'ref.super.forward'); assert.equal(forward.target, base.constructor.id);
  const inherited = derived.constructor.signature.parameters[0], original = base.constructor.signature.parameters[0];
  assert.notEqual(inherited.symbol, original.symbol); assert.equal(inherited.inheritedFrom, original.symbol);
  assert.deepEqual(inherited.origin, original.origin);
  assert.equal(inherited.origin.source, base.origin.source);
  assert.equal(sources.get(inherited.origin.source).slice(inherited.origin.start, inherited.origin.end), 'seed: number');
  const [touch, make, rebind] = derived.methods;
  assert.equal(touch.overrideTarget, base.methods[0].id);
  const local = make.body[0].local.bindings[0], allocation = local.initializer.value;
  assert.equal(local.initializer.kind, 'ref.view'); assert.equal(allocation.kind, 'ref.construct');
  assert.equal(allocation.type, base.instanceType); assert.equal(allocation.staticTarget, base.constructor.id);
  assert.equal(allocation.receiver.kind, 'ref.class'); assert.equal(allocation.receiver.symbol, base.symbol);
  const call = make.body[1].expression;
  assert.equal(call.kind, 'ref.method.call'); assert.equal(call.staticTarget, base.methods[0].id);
  assert.equal(call.receiver.kind, 'local.read'); assert.equal(call.receiver.symbol, local.symbol);
  assert.equal(make.body[2].expression.value.symbol, local.symbol);
  assert.equal(rebind.signature.return, hir.types.find(type => type.kind === 'void').id);
  const assignment = rebind.body[1].expression;
  assert.equal(assignment.kind, 'local.write'); assert.equal(assignment.left.kind, 'local.location');
  assert.equal(assignment.type, derived.instanceType); assert.equal(assignment.left.type, base.instanceType);
  assert.equal(assignment.right.kind, 'ref.view'); assert.equal(assignment.right.value.type, derived.instanceType);
  assert.equal(assignment.compatibility.sourceType, derived.instanceType);
  assert.equal(assignment.compatibility.targetType, base.instanceType);
  const members = new Map(assignment.compatibility.members.map(edge => [edge.target, edge.source]));
  assert.equal(members.size, 2); assert.equal(members.get(base.fields[0].symbol), base.fields[0].symbol);
  assert.equal(members.get(base.methods[0].symbol), touch.symbol);
  assert.deepEqual(verifyReferenceHir(hir), hir);
  const persisted = Buffer.from(printReferenceHir(hir)), cold = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(cold, hir);
});
test('multiple-source facts and cold HIR reject a statement borrowed from another original file before hashing', async () => {
  const { bytes, binding, hir } = await actual();
  const rejectOrigin = run => assert.throws(run, error => error instanceof Error
    && Reflect.get(error, 'code') === 'reference-facts-origin');
  const corrupt = value => { value.classes[0].methods[1].body[1].origin.source = '/original/z-base.ts'; };
  const graph = JSON.parse(bytes.toString('utf8')); corrupt(graph);
  rejectOrigin(() => decodeReferenceFacts(Buffer.from(canonical(graph)), binding));
  const changed = structuredClone(hir); corrupt(changed);
  rejectOrigin(() => verifyReferenceHir(changed));
});
