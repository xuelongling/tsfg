// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, verifyReferenceHir } from '../../compiler/reference-hir.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
async function actual() {
  const fixture = suffix => new URL('./fixtures/reference-source/reference-identity' + suffix, import.meta.url);
  const bytes = await readFile(fixture('.facts.json'));
  assert.equal(sha256(bytes), 'sha256:208759e65db725db58affb620e87469f5a9ca1ead5786870f90d090e5771fb04');
  return { bytes, graph: JSON.parse(bytes.toString('utf8')),
    binding: JSON.parse(await readFile(fixture('.binding.json'), 'utf8')) };
}
const comparison = value => value.classes[2].methods[0].body[0].expression;
function rejected(callback, category, label) {
  // An identity/hash failure never satisfies the named structural rejection.
  assert.throws(callback, error => error instanceof Error && Object.hasOwn(error, 'code')
    && Reflect.get(error, 'code') === 'reference-facts-' + category, label);
}
function corruptions(input, hir, check) {
  const changed = (mutate, category, label) => {
    const value = structuredClone(input); mutate(value, comparison(value)); check(value, category, label);
  };
  changed((value, node) => { node.extraOperand = structuredClone(node.left); }, 'schema', 'unknown operand reference');
  changed((value, node) => { node.operator = '=='; }, 'expression', 'unsupported comparison operator');
  changed((value, node) => { node.type = 't:number'; }, 'expression', 'non-boolean comparison result');
  changed((value, node) => {
    // Replace one operand edge with the actual graph's numeric leaf. Retarget
    // only its local identity/range so duplicate-ID or containment checks cannot
    // hide a missing reference-category check. This is an invalid graph mutation.
    node.left = { ...structuredClone(value.classes[0].fields[0].initializer),
      id: node.left.id, origin: { ...node.left.origin } };
    node.left.numericLiteral.contextType = '';
    node.left.origin.end = node.left.origin.start + node.left.token.length;
  }, 'expression', 'primitive masquerading as a reference operand');
  changed((value, node) => {
    node.left = { ...node.left, ...(hir ? { kind: 'ref.class' } : {}),
      symbol: value.classes[0].symbol, type: value.classes[0].constructorType };
  }, 'expression', 'class constructor value masquerading as an instance operand');
  changed((value, node) => { node.left.symbol = 'missing-operand'; }, 'closure', 'dangling operand');
  changed((value, node) => { node.right.origin.start = node.left.origin.end - 1; }, 'origin', 'overlapping operands');
  changed((value, node) => { [node.left, node.right] = [node.right, node.left]; }, 'origin', 'reversed operands');
}
test('actual reference identity facts reject malformed shape result operands closure and source order', async () => {
  const data = await actual();
  corruptions(data.graph, false, (value, category, label) =>
    rejected(() => decodeReferenceFacts(Buffer.from(canonical(value)), data.binding), category, label));
});
test('cold reference identity HIR rejects malformed shape result operands closure and source order before hashing', async () => {
  const data = await actual(), hir = buildReferenceHir(decodeReferenceFacts(data.bytes, data.binding));
  corruptions(hir, true, (value, category, label) => rejected(() => verifyReferenceHir(value), category, label));
});
