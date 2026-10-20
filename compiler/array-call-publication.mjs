// SPDX-License-Identifier: MIT
// Existing report adapters share complete selected HIR preparation without public verifier recursion.
import descriptor from '../contracts/array-calls-candidate.schema.json' with {type:'json'};
import { canonical, own, sha256 } from './identity.mjs';
import { copyGenericJsonBytes, readGenericJson } from './generic-json.mjs';
import { arrayFactsLimits } from './array-facts-common.mjs';
import { prepareArrayAnalysis } from './array-hir.mjs';
import { arrayCallFailure, arrayCallBudget } from './array-call-context.mjs';
export { arrayCallFailure };

const schemaHash = 'sha256:391d1e7e87f7b3b83dc15fe6a1732c843f97777a1d807259aeb989a26b7622eb';
const policy = arrayFactsLimits;
const check = (value, kind = '') => { if (!value) arrayCallFailure(kind); };
check(sha256(canonical(descriptor) + '\n') === schemaHash, 'identity');
function reportFor(selected) {
  const {hir,prepared} = selected;
  const report = {format:{family:'tsfg.array-calls-candidate',version:8,schemaHash},
    inputIdentity:hir.inputIdentity,hirDigest:sha256(canonical(hir)),scopeDigest:prepared.scopeDigest,
    publishedDigest:prepared.publishedDigest,contracts:[...prepared.records.values()],...prepared.flow};
  arrayCallBudget(report); return own(JSON.parse(canonical(report)));
}
export function analyzeArrayCalls(hir, factsContext, publicationContext) {
  return reportFor(prepareArrayAnalysis(hir,factsContext,publicationContext));
}
export function verifyArrayCalls(report, hir, factsContext, publicationContext) {
  const selected = prepareArrayAnalysis(hir,factsContext,publicationContext);
  arrayCallBudget(report);
  const expected = reportFor(selected);
  check(canonical(report) === canonical(expected),'report'); return expected;
}
export function printArrayCalls(report, hir, factsContext, publicationContext) {
  return canonical(verifyArrayCalls(report,hir,factsContext,publicationContext)) + '\n';
}
export function readArrayCalls(bytes, hir, factsContext, publicationContext) {
  const selected = prepareArrayAnalysis(hir,factsContext,publicationContext);
  let input;
  try { input = readGenericJson(copyGenericJsonBytes(bytes,policy),policy); }
  catch (error) { arrayCallFailure(error?.code?.endsWith('-limit') ? 'limit' : ''); }
  const expected = reportFor(selected);
  check(canonical(input.value) === canonical(expected),'report');
  check(input.text === canonical(expected) + '\n','canonical'); return expected;
}
