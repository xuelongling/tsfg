// SPDX-License-Identifier: MIT
// Pure Graph5 factory/callback metadata, following return-origins-contexts.
// No Source, Program, publication authoring, Frontend, Runtime or VM is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commonReturnOrigins } from '../../compiler/common-program-return-origins.mjs';
import { readCommonReturnOriginGraph } from '../../compiler/common-program-return-origin-graph.mjs';

function setup(returnType) {
  let remaining = 100000;
  const spend = (units = 1) => {
    assert.ok(Number.isSafeInteger(units) && units >= 0 && units <= remaining);
    remaining -= units;
  };
  const types = new Map([['i32', { kind: 'scalar', fields: [] }], ['undefined', { kind: 'undefined', fields: [] }]]);
  const graph = commonReturnOrigins(spend, { contracts: new Map(), environments: new Map(),
    actualType: type => types.get(type) ?? null,
    rootProtocol: { lexicalEnvironment: null, activationEnvironment: null } });
  /** @type {Parameters<typeof readCommonReturnOriginGraph>[1]} */
  const directory = { functionId: 'F', types,
    functions: new Map([['F', { kind: 'source', parameterTypes: [], returnType, lexicalEnvironment: null, activationEnvironment: null }]]),
    constructions: new Map(), globals: new Map(), fields: new Set(), environments: new Map() };
  const snapshot = normal => {
    const raw = graph.snapshot(normal, new Set());
    const typed = readCommonReturnOriginGraph(raw, directory, spend);
    assert.ok(typed.status === 'typed');
    assert.ok(remaining > 0 && remaining < 100000);
    return typed.graph;
  };
  return { graph, snapshot };
}

for (const [type, category] of [['i32', 'other'], ['undefined', 'undefined']]) {
  test('literal ' + type + ' copy retains its typed Data and Heap equations', () => {
    const { graph, snapshot } = setup(type), original = graph.literal(category, type), before = graph.checkpoint();
    const copied = graph.copy(original, type, 'literal:copy'), after = graph.checkpoint(), value = snapshot(copied);
    assert.notEqual(after.heap, before.heap);
    assert.equal(after.control, before.control);
    assert.equal(value.normal.length, 1);
    assert.equal(value.language.length, 0);
    const id = value.normal[0], copy = value.nodes[id];
    assert.ok(copy.kind === 'copy');
    assert.equal(copy.type, type); assert.equal(copy.site, 'literal:copy');
    assert.equal(copy.bases.length, 1); assert.equal(copy.control, 0);
    assert.deepEqual(value.nodes[copy.bases[0]], { kind: 'literal', type, category });
    const heaps = value.heaps.filter(row => row.kind === 'copy');
    assert.equal(heaps.length, 1);
    assert.equal(heaps[0].value, id); assert.equal(heaps[0].previous, copy.heap);
    assert.equal(value.heaps[copy.heap].kind, 'entry');
    assert.deepEqual(value.exits.normal, [{ heap: value.heaps.indexOf(heaps[0]), control: copy.control }]);
  });
}

test('a discarded literal copy remains in the next copy complete Heap prefix', () => {
  const { graph, snapshot } = setup('i32'), original = graph.literal('other', 'i32');
  graph.copy(original, 'i32', 'first:discarded');
  const last = graph.copy(original, 'i32', 'second:return'), value = snapshot(last);
  const copies = value.nodes.flatMap((row, id) => row.kind === 'copy' ? [{ row, id }] : []);
  const heapCopies = value.heaps.flatMap((row, id) => row.kind === 'copy' ? [{ row, id }] : []);
  assert.equal(copies.length, 2); assert.equal(heapCopies.length, 2);
  const first = copies.find(value => value.row.site === 'first:discarded');
  const second = copies.find(value => value.row.site === 'second:return');
  assert.ok(first && second); assert.notEqual(first.id, second.id);
  assert.deepEqual(first.row.bases, second.row.bases);
  const firstHeap = heapCopies.find(value => value.row.value === first.id);
  const secondHeap = heapCopies.find(value => value.row.value === second.id);
  assert.ok(firstHeap && secondHeap);
  assert.equal(firstHeap.row.previous, first.row.heap);
  assert.equal(value.heaps[first.row.heap].kind, 'entry');
  assert.equal(second.row.heap, firstHeap.id); assert.equal(secondHeap.row.previous, firstHeap.id);
  assert.equal(first.row.control, second.row.control);
  assert.deepEqual(value.normal, [second.id]);
  assert.deepEqual(value.exits.normal, [{ heap: secondHeap.id, control: second.row.control }]);
});
