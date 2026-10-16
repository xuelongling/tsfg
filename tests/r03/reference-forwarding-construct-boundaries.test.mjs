// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, verifyReferenceHir } from '../../compiler/reference-hir.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
async function actual(name, digest) {
  const fixture = suffix => new URL('./fixtures/reference-source/' + name + suffix, import.meta.url);
  const bytes = await readFile(fixture('.facts.json'));
  assert.equal(sha256(bytes), 'sha256:' + digest);
  return { graph: JSON.parse(bytes.toString('utf8')),
    binding: JSON.parse(await readFile(fixture('.binding.json'), 'utf8')), bytes };
}
const implicit = () => actual('implicit-derived', 'a248aa75dcbe62cb056dbed051c29cd3e1cf7880d108ea12f4fd707ff15601cb');
const construct = () => actual('construct', '0730b2873b09937dc20fafab733a1ac65157b1e2e738e8823a5b1cbc6d356545');
function rejection(callback, category, label) {
  assert.throws(callback, error => error instanceof Error && Object.hasOwn(error, 'code')
    && Reflect.get(error, 'code') === 'reference-facts-' + category, label);
}
function changedFacts(actual, mutate, category, label) {
  const graph = structuredClone(actual.graph); mutate(graph);
  rejection(() => decodeReferenceFacts(Buffer.from(canonical(graph)), actual.binding), category, label);
}
function changedHir(hir, mutate, category, label) {
  const value = structuredClone(hir); mutate(value);
  // Every assertion names a structural cause. A final factsDigest mismatch
  // ('identity') cannot satisfy any of these expected rejection predicates.
  rejection(() => verifyReferenceHir(value), category, label);
}
test('actual implicit facts reject corrupt target base signature logical provenance origin and witness', async () => {
  const data = await implicit();
  changedFacts(data, graph => { graph.classes[1].constructor.implicitForward.target = 'missing.ctor'; }, 'forwarding', 'direct base target');
  changedFacts(data, graph => { graph.classes[1].constructor.implicitForward.baseSignature.return = graph.classes[1].instanceType; }, 'forwarding', 'base signature');
  changedFacts(data, graph => { graph.classes[1].constructor.signature.parameters[0].inheritedFrom = 'c1.ctor.p9'; }, 'forwarding', 'logical inherited origin symbol');
  changedFacts(data, graph => { graph.classes[1].constructor.signature.parameters[0].origin.end--; }, 'forwarding', 'actual inherited parameter anchor');
  changedFacts(data, graph => { graph.classes[1].constructor.implicitForward.origin.start++; }, 'forwarding', 'forward origin');
  changedFacts(data, graph => { graph.classes[1].constructor.implicitForward.parameters[0].compatibility.assignable = false; }, 'witness', 'official compatibility witness');
});
test('cold implicit HIR rejects extra forward references and fabricated successful-forward boundaries before hashing', async () => {
  const data = await implicit(), hir = buildReferenceHir(decodeReferenceFacts(data.bytes, data.binding));
  changedHir(hir, value => { value.classes[1].constructor.implicitForward.kind = 'ref.fake.forward'; }, 'forwarding', 'forward operation');
  changedHir(hir, value => { value.classes[1].constructor.implicitForward.extraReference = 'foreign'; }, 'schema', 'unknown forward wrapper reference');
  changedHir(hir, value => { value.classes[1].constructor.implicitForward.parameters[0].source = 'foreign'; }, 'forwarding', 'logical parameter source');
  changedHir(hir, value => { value.classes[1].constructor.initializationBoundary.target = value.classes[1].constructor.id; }, 'initialization', 'wrong successful forward target');
  changedHir(hir, value => { value.classes[1].constructor.initializationBoundary.extraReference = 'foreign'; }, 'schema', 'unknown initialization boundary reference');
});
test('actual construct facts reject mismatched receiver constructor target and result classes', async () => {
  const data = await construct();
  changedFacts(data, graph => { graph.classes[1].fields[0].initializer.staticTarget = graph.classes[1].constructor.id; }, 'call', 'constructor target');
  changedFacts(data, graph => { graph.classes[1].fields[0].initializer.type = graph.classes[1].instanceType; }, 'call', 'allocation result class');
  changedFacts(data, graph => { graph.classes[1].fields[0].initializer.receiver.symbol = graph.classes[1].symbol; }, 'closure', 'constructor receiver symbol');
  changedFacts(data, graph => { graph.classes[1].fields[0].initializer.receiver.type = graph.classes[1].constructorType; }, 'closure', 'constructor receiver type');
});
test('cold construct HIR rejects extra view and operation references and class-value reclassification before hashing', async () => {
  const data = await construct(), hir = buildReferenceHir(decodeReferenceFacts(data.bytes, data.binding));
  changedHir(hir, value => { value.classes[1].fields[0].initializer.extraReference = 'foreign'; }, 'schema', 'unknown view reference');
  changedHir(hir, value => { value.classes[1].fields[0].initializer.value.extraReference = 'foreign'; }, 'schema', 'unknown construct reference');
  changedHir(hir, value => { value.classes[1].fields[0].initializer.value.receiver.kind = 'ref.parameter'; }, 'closure', 'class constructor reclassified as parameter');
});
