// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, verifyReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
const pins = {
  'locals-const': '32b102d37534052fc90d305ee8d4a1092696f32c6b072520f7a0de43683cfaf5',
  'locals-let': '4dc738d2bc0d7b9a8cd6c63d57de76d914af97ae8257b3bf5cf7d31ba465ee51',
};
async function actual(name) {
  const url = suffix => new URL('./fixtures/reference-source/' + name + suffix, import.meta.url);
  const bytes = await readFile(url('.facts.json'));
  assert.equal(sha256(bytes), 'sha256:' + pins[name]);
  const binding = JSON.parse(await readFile(url('.binding.json'), 'utf8'));
  return { graph: JSON.parse(bytes.toString('utf8')), bytes, binding };
}
function rejected(callback, category, label) {
  assert.throws(callback, error => error instanceof Error && Object.hasOwn(error, 'code')
    && Reflect.get(error, 'code') === 'reference-facts-' + category, label);
}
function both(data, mutate, category, label) {
  const graph = structuredClone(data.graph); mutate(graph, false);
  rejected(() => decodeReferenceFacts(Buffer.from(canonical(graph)), data.binding), category, label + ' decode');
  const hir = structuredClone(buildReferenceHir(decodeReferenceFacts(data.bytes, data.binding))); mutate(hir, true);
  // A digest mismatch is not a substitute for any named structural cause.
  rejected(() => verifyReferenceHir(hir), category, label + ' cold');
}
const share = value => value.classes[0].methods[0];
const binding = value => share(value).body[0].local.bindings[0];

test('actual locals reject cross-method self and early references and const rebinding before cold hashing', async () => {
  const data = await actual('locals-const');
  // A structural alpha variant of real facts proves that generated ID prefixes
  // are not scope authority. It is never stored or credited as official output.
  const renamed = structuredClone(data.graph);
  const symbols = new Map(renamed.classes[0].methods.map((method, index) =>
    [method.body[0].local.bindings[0].symbol, 'opaque-binding-' + index]));
  function rename(value) {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (typeof value[key] === 'string') value[key] = symbols.get(value[key]) ?? value[key];
      else rename(value[key]);
    }
  }
  rename(renamed);
  const hir = buildReferenceHir(decodeReferenceFacts(Buffer.from(canonical(renamed)), data.binding));
  assert.equal(share(hir).body[1].expression.left.receiver.symbol, 'opaque-binding-0');
  assert.equal(share(hir).body[2].expression.value.symbol, 'opaque-binding-0');
  assert.deepEqual(readReferenceHir(Buffer.from(printReferenceHir(hir))), hir);
  const corruptions = {
    'cross-method alias': value => {
      share(value).body[1].expression.left.receiver.symbol = value.classes[0].methods[1].body[0].local.bindings[0].symbol;
    },
    'initializer self reference': (value, isHir) => {
      const local = binding(value), initializer = isHir ? local.initializer.value : local.initializer;
      initializer.symbol = local.symbol; if (isHir) initializer.kind = 'local.read';
    },
    'use before declaration': value => {
      const body = share(value).body; [body[0],body[1]] = [body[1],body[0]];
    },
  };
  for (const [label, mutate] of Object.entries(corruptions)) both(data, mutate, 'scope', label);
  both(data, value => {
    const local = value.symbols.find(symbol => symbol.id === binding(value).symbol);
    value.symbols.push({ ...local, id: 'orphan-local' });
  }, 'closure', 'orphan local symbol');
  both(data, value => {
    value.classes[0].methods[1].body[0].local.bindings[0].symbol = binding(value).symbol;
  }, 'closure', 'declaration borrowed from another callable');
  both(await actual('locals-let'), value => { share(value).body[0].local.kind = 'const'; }, 'mutability', 'const rebind');
});

test('cold local unions and location contexts reject hidden references and reclassified operands', async () => {
  const data = await actual('locals-const');
  both(data, value => { binding(value).extraReference = 'foreign'; }, 'schema', 'unknown binding reference');
  both(data, value => { share(value).body[0].local.extraReference = 'foreign'; }, 'schema', 'unknown local union reference');
  both(data, value => { share(value).body[0].expression = structuredClone(share(value).body[1].expression); },
    'body', 'local statement with executable expression');
  const hir = buildReferenceHir(decodeReferenceFacts(data.bytes, data.binding));
  const changed = (mutate, category, label) => {
    const value = structuredClone(hir); mutate(value);
    rejected(() => verifyReferenceHir(value), category, label);
  };
  changed(value => { binding(value).initializer.extraReference = 'foreign'; }, 'schema', 'hidden initializer view reference');
  changed(value => { share(value).body[1].expression.left.receiver.kind = 'local.location'; }, 'location', 'location used as receiver');
  changed(value => { share(value).body[2].expression.value.kind = 'ref.parameter'; }, 'closure', 'local reclassified as parameter');
  const letData = await actual('locals-let');
  const letHir = structuredClone(buildReferenceHir(decodeReferenceFacts(letData.bytes, letData.binding)));
  share(letHir).body[1].expression.left.kind = 'local.read';
  rejected(() => verifyReferenceHir(letHir), 'location', 'write with a read operand');
});

// The official checker returns the RHS type for simple assignment; the declared
// storage slot remains a separate compatibility target. Digest rejection alone
// must not conceal a malformed expression result on either public boundary.
test('actual local assignment rejects an unrelated result type before cold hashing', async t => {
  const data = await actual('locals-let');
  const booleanType = data.graph.types.find(type => type.kind === 'boolean');
  assert.ok(booleanType);
  await t.test('facts reject a reference assignment reported as boolean', () => {
    const graph = structuredClone(data.graph);
    share(graph).body[1].expression.type = booleanType.id;
    rejected(() => decodeReferenceFacts(Buffer.from(canonical(graph)), data.binding), 'expression', 'assignment result');
  });
  await t.test('cold HIR rejects the result cause before its digest', () => {
    const hir = structuredClone(buildReferenceHir(decodeReferenceFacts(data.bytes, data.binding)));
    share(hir).body[1].expression.type = booleanType.id;
    rejected(() => verifyReferenceHir(hir), 'expression', 'cold assignment result');
  });
});
