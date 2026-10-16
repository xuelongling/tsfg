// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
async function actual(name, digest) {
  const fixture = suffix => new URL('./fixtures/reference-source/' + name + suffix, import.meta.url);
  const bytes = await readFile(fixture('.facts.json'));
  assert.equal(sha256(bytes), 'sha256:' + digest);
  return { graph: JSON.parse(bytes.toString('utf8')),
    binding: JSON.parse(await readFile(fixture('.binding.json'), 'utf8')) };
}
function rejects(graph, binding, categories) {
  assert.throws(() => decodeReferenceFacts(Buffer.from(canonical(graph)), binding),
    error => error instanceof Error && Object.hasOwn(error, 'code')
      && categories.includes(Reflect.get(error, 'code')));
}
test('actual inherited methods reject a missing official override edge', async () => {
  const { graph, binding } = await actual('inheritance', 'ebbe24c92fc6110f06ffd1e68e7e4472c3d4f9f6a7c8ff9bacbc5ea2037a9d3b');
  const method = graph.classes[1].methods[0];
  assert.equal(method.name, 'touch'); assert.equal(method.overrideTarget, 'c1.m1');
  method.overrideTarget = '';
  // Keep binding and all other facts unchanged. Reject the missing official edge;
  // neither a guessed edge nor a final HIR hash is an acceptable substitute.
  rejects(graph, binding, ['reference-facts-override', 'reference-facts-unsupported']);
});
test('embedded official options reject excessive JSON depth before canonicalization or provenance hashing', async () => {
  const { graph, binding } = await actual('constructor', 'fb61582d651684bc7330f4f5674d6276c20013fd44af06d809220d8fab30785a');
  const options = JSON.parse(graph.options.officialOptions);
  /** @type {unknown} */
  let nested = 0;
  for (let depth = 0; depth < 256; depth++) nested = [nested];
  options.readerBudgetNegative = nested;
  graph.options.officialOptions = canonical(options);
  assert.ok(Buffer.byteLength(graph.options.officialOptions) < 4096);
  assert.equal(options.strict, true); assert.equal(options.noEmit, true); assert.equal(options.noLib, true);
  assert.equal(options.module, graph.options.module); assert.equal(options.target, graph.options.target);
  graph.options.officialOptionsSha256 = sha256(graph.options.officialOptions);
  binding.options = structuredClone(graph.options);
  // Synchronize the existing provenance hash only to expose the embedded reader
  // defect. This is a negative graph, never an official Source success fixture.
  for (const item of graph.classes) item.runtimeKey = sha256(canonical({
    domain: 'tsfg.candidate.class-allocation-provenance', profile: graph.semanticProfile,
    scope: graph.scope, sources: graph.sources, declaration: item.origin, options: graph.options
  }));
  rejects(graph, binding, ['reference-facts-limit']);
});
