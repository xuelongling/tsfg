// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
const pins = {
  constructor: '55aed6fff72963bd12591ca45eca19d53dfebdb07f48eb6b05fa2d6c0dd4ec5d',
  readonly: 'e23ce59ef86efb20301e81f68f51424be0ba697e18ddeb697791ca96d6d7db0f',
  inheritance: '295cc685221122ebbfd8ebc9dc4f16ac2879d19013aba0f029672f747f561493'
};
async function actualGraph(name) {
  const base = new URL('./fixtures/reference-source/' + name, import.meta.url);
  const bytes = await readFile(new URL(base.href + '.facts.json'));
  assert.equal(sha256(bytes), 'sha256:' + pins[name]);
  return { graph: JSON.parse(bytes.toString('utf8')),
    binding: JSON.parse(await readFile(new URL(base.href + '.binding.json'), 'utf8')) };
}
function rejected(graph, binding, category) {
  // Exercise the public facts decoder directly. No HIR context digest participates
  // in this rejection, and every mutation remains a canonical owned JSON graph.
  assert.throws(() => decodeReferenceFacts(Buffer.from(canonical(graph)), binding),
    error => error instanceof Error && Object.hasOwn(error, 'code')
      && Reflect.get(error, 'code') === 'reference-facts-' + category);
}
test('cold facts reject overlapping binary operand anchors inside a valid parent range', async () => {
  const { graph, binding } = await actualGraph('constructor');
  const add = graph.classes[0].methods[0].body[0].expression.right;
  assert.equal(add.kind, 'binary'); assert.equal(add.left.origin.start, 133); assert.equal(add.left.origin.end, 143);
  // Both children still lie within binary[133,151), but overlap on [138,143).
  add.right.origin = { ...add.right.origin, start: 138, end: 143 };
  rejected(graph, binding, 'origin');
});
test('cold facts reject reversed assignment evaluation anchors inside a valid parent range', async () => {
  const { graph, binding } = await actualGraph('constructor');
  const store = graph.classes[0].methods[0].body[0].expression;
  assert.equal(store.kind, 'assignment'); assert.deepEqual([store.origin.start, store.origin.end], [120,151]);
  // Move the complete LHS field/receiver after the complete RHS binary tree.
  // All parent containment and scalar conversion witnesses remain consistent.
  store.left.origin = { ...store.left.origin, start: 141, end: 151 };
  store.left.receiver.origin = { ...store.left.receiver.origin, start: 141, end: 145 };
  store.right.origin = { ...store.right.origin, start: 120, end: 138 };
  store.right.left.origin = { ...store.right.left.origin, start: 120, end: 130 };
  store.right.left.receiver.origin = { ...store.right.left.receiver.origin, start: 120, end: 124 };
  store.right.right.origin = { ...store.right.right.origin, start: 133, end: 138 };
  store.compatibility.origin = { ...store.right.origin };
  rejected(graph, binding, 'origin');
});
test('cold facts reject corrupt inheritance dispatch and incomplete official view projections before HIR hashing', async () => {
  let actual = await actualGraph('inheritance');
  actual.graph.classes[1].base = 'missing-class'; rejected(actual.graph, actual.binding, 'inheritance');
  actual = await actualGraph('inheritance');
  actual.graph.classes[1].methods[0].overrideTarget = actual.graph.classes[0].methods[0].id;
  rejected(actual.graph, actual.binding, 'override');
  actual = await actualGraph('inheritance');
  actual.graph.classes[1].methods[1].body[0].expression.staticTarget = actual.graph.classes[1].methods[0].id;
  rejected(actual.graph, actual.binding, 'call');
  actual = await actualGraph('readonly');
  actual.graph.classes[1].fields[2].initializerCompatibility.members = [];
  rejected(actual.graph, actual.binding, 'witness');
});
