// SPDX-License-Identifier: MIT
// Explicit access proofs consume existing verified call mappings and fixed Published bounds.
import { analyzeArrayCalls } from './array-call-publication.mjs';
import { canonical, own } from './identity.mjs';
import {createArrayOwnerTools} from './array-owner-trace.mjs';
import { typedArrayJsonPolicy as arrayFactsLimits } from './typed-array-schema.mjs';
import { checkGenericJsonValueBudget, copyGenericJsonBytes, readGenericJson } from './generic-json.mjs';

const policy = Object.freeze({ ...arrayFactsLimits, bytes: arrayFactsLimits.bytes - 1,rejectPrototypeKeys:true });
const messages = {
  '': 'invalid explicit Array call parallel group',
  identity: 'Array call parallel group identity differs',
  conflict: 'published Array owner access sets may conflict',
  capability: 'callee local resource domain is not covered by this proof',
  limit: 'Array parallel proof budget exceeded',
  proof: 'Array parallel proof differs from verified inputs',
  canonical: 'Array parallel proof is not canonical',
};
/** @param {string} [kind] @param {any} [details] @returns {never} */
function failure(kind = '', details = undefined) {
  const code = 'r03-d-array-parallel' + (kind ? '-' + kind : '');
  throw Object.assign(new TypeError(code + ': ' + messages[kind]),
    { code, ruleId: 'r01-kernel', phase: 'analysis' },
    details === undefined ? {} : own(JSON.parse(canonical(details))));
}
/** @param {any} value */
function budget(value) {
  try { checkGenericJsonValueBudget(value, policy); }
  catch (error) { failure(error?.code?.endsWith('-limit') ? 'limit' : ''); }
}
const hash = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const site = value => Array.isArray(value) && value.length === 3 && value[0] === 'body'
  && Number.isInteger(value[1]) && !Object.is(value[1], -0) && value[1] >= 0 && value[1] < 50
  && ['expression', 'value', 'initializer'].includes(value[2]);

/** Callee-entry accesses only, after original argument evaluation. This is not
 * a scheduling/reordering permission, whole-kernel proof or cross-activation claim.
 * @param {any} hir @param {any} factsContext @param {any} fixedPublicationContext @param {any} request */
export function verifyArrayCallParallelGroup(hir, factsContext, fixedPublicationContext, request) {
  budget(request);
  // Full existing facts/HIR/publication and borrow checks precede any new selection.
  // Their errors and work meter remain authoritative; no supplied report is trusted.
  const analysis = analyzeArrayCalls(hir, factsContext, fixedPublicationContext);
  let work=0;const charge=()=>{if(++work>1000000)failure('limit');};
  const ownerTools=createArrayOwnerTools(charge),mayAlias=ownerTools.mayAlias;
  const uniqueOwners=values=>[...new Map(values.map(owner=>[ownerTools.key(owner),owner]))]
    .sort(([a],[b])=>ownerTools.compare(a,b)).map(([,owner])=>owner);
  if (!exact(request, ['functionId', 'sites']) || !hash(request.functionId) || !Array.isArray(request.sites)) failure();
  if (request.sites.length > 32) failure('limit');
  if (request.sites.length < 2) failure();
  let previous = -1;
  for (const selected of request.sites) {
    if (!exact(selected, ['expressionPath', 'consumedDigest']) || !site(selected.expressionPath)
        || !hash(selected.consumedDigest) || selected.expressionPath[1] <= previous) failure();
    previous = selected.expressionPath[1];
  }
  const caller = hir.functions.find(fn => fn.id === request.functionId);
  if (!caller) failure('identity');
  const calls = analysis.calls.filter(call => call.functionId === caller.id);
  const contracts = new Map(analysis.contracts.map(record => [record.functionId, record]));
  const accesses = [], selectedCalls = [];
  for (const selected of request.sites) {
    const call = calls.find(value => canonical(value.expressionPath) === canonical(selected.expressionPath));
    if (!call || call.consumedDigest !== selected.consumedDigest) failure('identity');
    const selectedContracts=call.targets.map(arm=>{charge();const contract=contracts.get(arm.target);
      if(contract?.digest!==arm.consumedDigest)failure('identity');return contract;});
    const contract = contracts.get(call.target);
    if (contract.digest !== call.consumedDigest) failure('identity');
    // The existing local wildcard is not an externally identified argument owner.
    // Preserve this specific gap rather than pretending its regions are disjoint.
    if (selectedContracts.some(record=>Object.values(record.upper.local).some(Boolean))) failure('capability', {
      primary: { sourceId: caller.sourcePath, ...call.range }, functionId: call.target, facet: 'local',
    });
    const owners = uniqueOwners(call.arguments.map(argument => argument.owner));
    const access = { expressionPath: call.expressionPath, target: call.target,
      consumedDigest: contract.digest, owners, reads: [], writes: [], structural: [] };
    for (const [key, flag] of [['reads', 'read'], ['writes', 'write'], ['structural', 'structural']]) {
      access[key] = uniqueOwners(call.arguments.filter(argument =>
        selectedContracts.some(record=>record.upper.parameters.find(parameter=>parameter.index===argument.index)?.[flag]))
        .map(argument => argument.owner));
    }
    accesses.push(access); selectedCalls.push(call);
  }
  const proof = { kind: 'array-call-owner-parallel-proof-v1', inputIdentity: analysis.inputIdentity,
    hirDigest: analysis.hirDigest, scopeDigest: analysis.scopeDigest, publishedDigest: analysis.publishedDigest,
    functionId: caller.id, sites: request.sites, accesses, pairs: [] };
  budget(proof);
  let bytes = Buffer.byteLength(canonical(proof));
  const reserve = extra => { if (bytes + extra > policy.bytes) failure('limit'); bytes += extra; };
  const overlaps = (left, right) => {
    const result = [];
    for (const a of left) for (const b of right) {
      charge();
      if (!mayAlias(a, b)) continue;
      const value = { left: a, right: b };
      reserve(Buffer.byteLength(canonical(value)) + (result.length ? 1 : 0));
      result.push(value);
    }
    return result;
  };
  for (let left = 0; left < accesses.length; left++) for (let right = left + 1; right < accesses.length; right++) {
    const a = accesses[left], b = accesses[right];
    const pair = { left: a.expressionPath, right: b.expressionPath,
      readRead: [], writeWrite: [], writeRead: [], readWrite: [], structuralLeft: [], structuralRight: [] };
    reserve(Buffer.byteLength(canonical(pair)) + (proof.pairs.length ? 1 : 0));
    pair.readRead = overlaps(a.reads, b.reads);
    pair.writeWrite = overlaps(a.writes, b.writes);
    pair.writeRead = overlaps(a.writes, b.reads);
    pair.readWrite = overlaps(a.reads, b.writes);
    // Structural mutation also conflicts with an owned argument whose Published
    // read flag is false: passing a ReadSpan still holds its source for the call.
    pair.structuralLeft = overlaps(a.structural, b.owners);
    pair.structuralRight = overlaps(a.owners, b.structural);
    const { readRead, left: leftSite, right: rightSite, ...conflicts } = pair;
    if (Object.values(conflicts).some(values => values.length)) {
      budget(conflicts);
      failure('conflict', { primary: { sourceId: caller.sourcePath, ...selectedCalls[left].range },
        related: [{ sourceId: caller.sourcePath, ...selectedCalls[right].range }], conflicts });
    }
    proof.pairs.push(pair);
  }
  budget(proof);
  return own(JSON.parse(canonical(proof)));
}

/** @param {any} proof @param {any} hir @param {any} facts @param {any} publication @param {any} request */
export function verifyArrayParallelProof(proof, hir, facts, publication, request) {
  budget(proof);
  const expected = verifyArrayCallParallelGroup(hir, facts, publication, request);
  if (canonical(proof) !== canonical(expected)) failure('proof');
  return expected;
}
/** @param {any} proof @param {any} hir @param {any} facts @param {any} publication @param {any} request */
export function printArrayParallelProof(proof, hir, facts, publication, request) {
  return canonical(verifyArrayParallelProof(proof, hir, facts, publication, request)) + '\n';
}
/** @param {Uint8Array} bytes @param {any} hir @param {any} facts @param {any} publication @param {any} request */
export function readArrayParallelProof(bytes, hir, facts, publication, request) {
  let input;
  try { input = readGenericJson(copyGenericJsonBytes(bytes, arrayFactsLimits), arrayFactsLimits); }
  catch (error) { failure(error?.code?.endsWith('-limit') ? 'limit' : ''); }
  const expected = verifyArrayParallelProof(input.value, hir, facts, publication, request);
  if (input.text !== canonical(expected) + '\n') failure('canonical');
  return expected;
}
