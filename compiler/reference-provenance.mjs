// SPDX-License-Identifier: MIT
import { budget, canonical, sha256 } from './reference-common.mjs';

// Bound each JSON preimage before canonical traversal. The environment is cold
// derived once per graph and is never an extra wire field or Source credential.
function digest(domain, payload) {
  budget(payload);
  return sha256(domain + '\0' + canonical(payload));
}
export const referenceEnvironmentDigest = graph => digest('tsfg.candidate.class-environment.v2', {
  profile: graph.semanticProfile, scope: graph.scope, sources: graph.sources, options: graph.options,
});
export const referenceAllocationKey = (environmentDigest, declaration) =>
  digest('tsfg.candidate.class-allocation-provenance.v2', { environmentDigest, declaration });
