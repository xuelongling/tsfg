// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';

const fixture = name => new URL('./fixtures/reference-source/locals-const.' + name, import.meta.url);

// Read the public Core representation, following only identity-preserving views.
// This checks alias dataflow without depending on emitter helpers or SSA names.
function objectSource(value, views) {
  const seen = new Set();
  while (views.has(value)) {
    assert.ok(!seen.has(value), 'view dataflow must not contain a cycle');
    seen.add(value); value = views.get(value);
  }
  return value;
}

test('public lowerHir preserves cold Box aliases field mutation and reference return in typed Core', async () => {
  // Actual profile5 Source capture; no Source admission or execution is implied.
  const [bytes, bindingText, source] = await Promise.all([
    readFile(fixture('facts.json')), readFile(fixture('binding.json'), 'utf8'), readFile(fixture('source.ts'), 'utf8'),
  ]);
  assert.equal(sha256(bytes), 'sha256:32b102d37534052fc90d305ee8d4a1092696f32c6b072520f7a0de43683cfaf5');
  const binding = JSON.parse(bindingText), origin = binding.sources.find(item => !item.declaration);
  assert.ok(origin); assert.equal(origin.path, '/original/main.ts');
  assert.equal(sha256(source), origin.sha256); assert.equal(source.length, 352);
  assert.equal(origin.utf16Length, source.length);
  const facts = decodeReferenceFacts(bytes, binding), owned = buildReferenceHir(facts);
  const persisted = Buffer.from(printReferenceHir(owned));
  const cold = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(cold, owned); assert.equal(cold.format.version, 5);
  assert.equal(cold.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v5');
  assert.equal(cold.classes[0].constructor.access, 'public');
  assert.equal(cold.classes[0].fields[0].initializer, null, 'this fixture requires no unresolved literal');

  // Existing exported production seam: an entry refusal is distinct from C++ RED.
  const core = lowerHir(cold);
  assert.equal(typeof core, 'string');
  assert.match(core, /!tsfg_core\.ref<[^>]+>/);
  assert.ok(core.includes('sha256:7fd6fbdd9c80a7d4431b28ec21f67f468728f508466b8141b009ec9805861f44'),
    'Core retains the actual Box allocation class identity');
  assert.doesNotMatch(core, /"tsfg_core\.ref\.alloc"/, 'aliasing an existing parameter must not allocate');
  const functions = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)];
  assert.equal(functions.length, 4, 'constructor and all three owned methods remain in Core');
  const shares = functions.filter(fn => /tsfg_core\.logical_name = "share"/.test(fn[1]));
  assert.equal(shares.length, 1);
  const [, header, body] = shares[0];
  const parameters = [...header.matchAll(/(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<[^>]+>|f64)/g)];
  assert.equal(parameters.length, 2, 'share has an explicit this receiver and other argument');
  assert.ok(parameters.every(parameter => parameter[2].startsWith('!tsfg_core.ref<')));
  const receiver = parameters[0][1], other = parameters[1][1];
  const views = new Map([...body.matchAll(/(%[A-Za-z0-9_]+)\s*=\s*"tsfg_core\.ref\.view"\((%[A-Za-z0-9_]+)\)/g)]
    .map(match => [match[1], match[2]]));
  const reads = [...body.matchAll(/(%[A-Za-z0-9_]+)\s*=\s*"tsfg_core\.ref\.field\.read"\((%[A-Za-z0-9_]+)\)/g)];
  const writes = [...body.matchAll(/"tsfg_core\.ref\.field\.write"\((%[A-Za-z0-9_]+),\s*(%[A-Za-z0-9_]+)\)/g)];
  const returns = [...body.matchAll(/"func\.return"\((%[A-Za-z0-9_]+)\)/g)];
  assert.equal(reads.length, 1); assert.equal(writes.length, 1); assert.equal(returns.length, 1);
  assert.equal(objectSource(reads[0][2], views), receiver, 'read this.value once');
  assert.equal(objectSource(writes[0][1], views), other, 'write through alias targets the original other object');
  assert.equal(writes[0][2], reads[0][1], 'the field write uses the value read from this');
  assert.equal(objectSource(returns[0][1], views), other, 'return alias preserves the same object identity');
});
