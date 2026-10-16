// SPDX-License-Identifier: MIT
import { budget, record, check, same, own, factsFormat, bindingFor, readJson, referenceLimits } from './reference-common.mjs';
import { verifyReferenceGraph } from './reference-facts-shape.mjs';
export { referenceLimits } from './reference-common.mjs';
// These candidate checks establish owned structural correspondence. Expected
// bindings and hashes are not official transport identity or Source admission.
export function decodeReferenceFacts(bytes, expectedBinding, { limits = referenceLimits } = {}) {
  const graph = readJson(bytes, limits);
  verifyReferenceGraph(graph, expectedBinding);
  return own({ format: factsFormat, binding: bindingFor(graph), graph });
}
export function verifyReferenceFacts(facts) {
  budget(facts); record(facts, ['format','binding','graph']); check(same(facts.format, factsFormat), 'profile');
  verifyReferenceGraph(facts.graph, facts.binding); return own(facts);
}
