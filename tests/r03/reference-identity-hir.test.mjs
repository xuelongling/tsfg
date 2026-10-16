// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, readReferenceHir, printReferenceHir } from '../../compiler/reference-hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';
const fixture = name => new URL('./fixtures/reference-source/' + name, import.meta.url);
test('official reference identity bytes preserve same-class equality inequality and structurally comparable distinct classes', async () => {
  const bytes = await readFile(fixture('reference-identity.facts.json'));
  assert.equal(sha256(bytes), 'sha256:e77f6989002d5398c2b9603ead12c60edee8b60db08c23a0b8d59ec88a33d82f');
  const binding = JSON.parse(await readFile(fixture('reference-identity.binding.json'), 'utf8'));
  const source = await readFile(fixture('reference-identity.source.ts'));
  const declarations = await readFile(fixture('minimal-scalars-v2.d.ts'));
  assert.equal(sha256(source), 'sha256:62f36fbe8a4e05ebad433b4bba17d9f70398a6b04597b5ac29dbd2c5483702f9');
  assert.equal(sha256(source), binding.sources[0].sha256);
  assert.equal(source.toString('utf8').length, binding.sources[0].utf16Length);
  assert.equal(sha256(declarations), binding.sources[1].sha256);
  const facts = decodeReferenceFacts(bytes, binding), hir = buildReferenceHir(facts);
  const [leftClass, rightClass, compare] = hir.classes;
  assert.equal(leftClass.name, 'Left'); assert.equal(rightClass.name, 'Right'); assert.equal(compare.name, 'Compare');
  assert.notEqual(leftClass.runtimeKey, rightClass.runtimeKey);
  const [same, different, across] = compare.methods;
  assert.deepEqual(compare.methods.map(method => method.name), ['same','different','across']);
  for (const [index, method] of compare.methods.entries()) {
    const operation = method.body[0].expression, original = facts.graph.classes[2].methods[index].body[0].expression;
    assert.equal(operation.kind, 'ref.identity'); assert.equal(operation.type, 't:boolean');
    assert.equal(operation.operator, index === 1 ? '!==' : '===');
    assert.equal(operation.left.kind, 'ref.parameter'); assert.equal(operation.right.kind, 'ref.parameter');
    assert.equal(operation.left.symbol, method.signature.parameters[0].symbol);
    assert.equal(operation.right.symbol, method.signature.parameters[1].symbol);
    assert.notEqual(operation.left.id, operation.right.id);
    assert.deepEqual(operation.left.origin, original.left.origin); assert.deepEqual(operation.right.origin, original.right.origin);
    assert.deepEqual(operation.origin, original.origin);
    assert.equal(method.signature.return, 't:boolean');
    assert.equal(method.body[0].compatibility.sourceType, 't:boolean');
    assert.equal(method.body[0].compatibility.targetType, 't:boolean');
  }
  assert.equal(same.body[0].expression.left.type, leftClass.instanceType);
  assert.equal(same.body[0].expression.right.type, leftClass.instanceType);
  assert.equal(different.body[0].expression.operator, '!==');
  assert.equal(across.body[0].expression.left.type, leftClass.instanceType);
  assert.equal(across.body[0].expression.right.type, rightClass.instanceType);
  // Both actual operands remain in HIR. Different allocation provenance never
  // computes a comparison result or turns ordinary comparison into nominal typing.
  assert.equal(across.body[0].expression.kind, 'ref.identity');
  assert.deepEqual(readReferenceHir(Buffer.from(printReferenceHir(hir))), hir);
});
