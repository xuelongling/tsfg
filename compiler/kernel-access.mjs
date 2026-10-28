import { familyOf } from './module-callable-common.mjs';
import { rejectUnknownModuleKernel } from './module-callable-publication.mjs';
// SPDX-License-Identifier: MIT
// A declared parallel group consumes fixed Published bounds, never narrower bodies.
import { analyzeModuleCalls } from './module-hir.mjs';
import { checkCallEffectsInputs } from './call-effects.mjs';
import { checkGenericJsonValueBudget } from './generic-json-budget.mjs';
import { copyGenericJsonBytes, readGenericJson } from './generic-json.mjs';
import { canonical, own } from './identity.mjs';

// Match the bounded JSON profile in 0023. Its HIR/context errors stay unchanged;
// this profile maps only the new request/proof boundary to kernel-access errors.
const policy = Object.freeze({ bytes: 8388608, depth: 128, jsonTokens: 200000,
  stringBytes: 1048576, allowNul: true, rejectPrototypeKeys: true });
const messages = {
  'r03-d-kernel-access': 'invalid explicit kernel parallel group',
  'r03-d-kernel-access-identity': 'kernel parallel group identity differs',
  'r03-d-kernel-access-limit': 'kernel parallel group budget exceeded',
  'r03-d-kernel-access-conflict': 'published global access sets conflict',
  'r03-d-kernel-access-proof': 'kernel parallel proof differs from verified inputs',
  'r03-d-kernel-access-canonical': 'kernel parallel proof is not canonical',
};
/** @param {string} [code] @param {any} [details] @returns {never} */
function failure(code = 'r03-d-kernel-access', details = undefined) {
  const error = Object.assign(new TypeError(code + ': ' + messages[code]),
    { code, ruleId: 'r01-kernel', phase: 'hir' });
  if (details !== undefined) {
    checkBudget(details);
    Object.assign(error, own(JSON.parse(canonical(details))));
  }
  throw error;
}
/** @param {any} value */
function checkBudget(value) {
  try { checkGenericJsonValueBudget(value, policy); }
  catch (error) {
    failure(/** @type {any} */ (error).code?.endsWith('-limit')
      ? 'r03-d-kernel-access-limit' : 'r03-d-kernel-access');
  }
}
const hash = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const exact = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === 1 && Object.hasOwn(value, 'targets');

/** Verify only scalar-GlobalId independence for explicitly concurrent kernel roots.
 * This is neither an execution permit nor a complete Query/Span/device certificate.
 * @param {any} hir @param {any} fixedPublicationContext @param {any} request */
export function verifyKernelParallelGroup(hir, fixedPublicationContext, request) {
  // Complete graph inspection precedes every mode/request selection. Preserve
  // 0023's HIR/context budget, ownership and diagnostic identities.
  checkCallEffectsInputs(hir, fixedPublicationContext);
  checkBudget(request);
  if (!exact(request) || !Array.isArray(request.targets)) failure();
  if (request.targets.length > 32) failure('r03-d-kernel-access-limit');
  if (request.targets.length < 2) failure();
  let previous = '';
  for (const target of request.targets) {
    if (!hash(target) || target <= previous) failure();
    previous = target;
  }
  if (fixedPublicationContext?.mode !== 'fixed') failure();
  const analysis = analyzeModuleCalls(hir, fixedPublicationContext);
  const kernels = new Set(hir.closure.roots.filter(root => root.kind === 'kernel').map(root => root.target));
  if (request.targets.some(target => !kernels.has(target))) failure('r03-d-kernel-access-identity');
  /** @type {Map<string, any>} */
  const contracts = new Map(analysis.contracts.map(record => [record.functionId, record]));
  /** @type {Map<string, any>} */
  const functions = new Map(hir.functions.map(fn => [fn.id, fn]));
  const targets = [...request.targets];
  if (familyOf(hir) === 'tsfg.module-callable-hir-candidate') rejectUnknownModuleKernel(hir, analysis, targets);
  const accesses = targets.map(functionId => {
    const record = contracts.get(functionId);
    return { functionId, publishedContractDigest: record.digest,
      reads: record.upper.reads, writes: record.upper.writes };
  });
  const proof = { inputIdentity: analysis.inputIdentity, hirDigest: analysis.hirDigest,
    publishedDigest: analysis.publishedDigest, targets, accesses, pairs: [] };
  checkBudget(proof);
  // The output grammar contains only fixed keys, arrays and checked ASCII hash
  // strings. Reserve its exact bytes/tokens before adding pairs or intersections;
  // the shared graph walker still checks the complete result before ownership.
  let bytes = Buffer.byteLength(canonical(proof));
  let tokens = 17 + 13 * targets.length + accesses.reduce((n, row) => n + row.reads.length + row.writes.length, 0);
  let work = 0;
  const spend = () => { if (++work > 1000000) failure('r03-d-kernel-access-limit'); };
  const reserve = (byteCount, tokenCount) => {
    if (bytes + byteCount > policy.bytes || tokens + tokenCount > policy.jsonTokens)
      failure('r03-d-kernel-access-limit');
    bytes += byteCount; tokens += tokenCount;
  };
  const intersection = (left, right) => {
    const result = [];
    for (let a = 0, b = 0; a < left.length && b < right.length;) {
      spend();
      if (left[a] < right[b]) a++;
      else if (left[a] > right[b]) b++;
      else {
        reserve(left[a].length + 2 + (result.length ? 1 : 0), 1);
        result.push(left[a]); a++; b++;
      }
    }
    return result;
  };
  for (let left = 0; left < targets.length; left++) for (let right = left + 1; right < targets.length; right++) {
    spend();
    const a = accesses[left], b = accesses[right];
    const pair = { left: a.functionId, right: b.functionId, readRead: [],
      writeWrite: [], writeRead: [], readWrite: [] };
    reserve(Buffer.byteLength(canonical(pair)) + (proof.pairs.length ? 1 : 0), 18);
    pair.readRead = intersection(a.reads, b.reads);
    pair.writeWrite = intersection(a.writes, b.writes);
    pair.writeRead = intersection(a.writes, b.reads);
    pair.readWrite = intersection(a.reads, b.writes);
    if (pair.writeWrite.length || pair.writeRead.length || pair.readWrite.length) {
      const first = functions.get(a.functionId), second = functions.get(b.functionId);
      // An access may exist only in a stable wider upper. Declaration locations
      // identify those contracts without inventing current-body access witnesses.
      failure('r03-d-kernel-access-conflict', {
        primary: { sourceId: first.sourcePath, ...first.range },
        related: [{ sourceId: second.sourcePath, ...second.range }],
        conflicts: { writeWrite: pair.writeWrite, writeRead: pair.writeRead, readWrite: pair.readWrite },
      });
    }
    proof.pairs.push(pair);
  }
  checkBudget(proof);
  // No caller or analysis graph is shared by the returned independently frozen DTO.
  return own(JSON.parse(canonical(proof)));
}

/** Cold proof verification recomputes the complete current fixed analysis.
 * A supplied proof can never authorize a target or substitute for its inputs.
 * @param {any} proof @param {any} hir @param {any} context @param {any} request */
export function verifyKernelParallelProof(proof, hir, context, request) {
  checkBudget(proof);
  const expected = verifyKernelParallelGroup(hir, context, request);
  if (canonical(proof) !== canonical(expected)) failure('r03-d-kernel-access-proof');
  return expected;
}
/** @param {any} proof @param {any} hir @param {any} context @param {any} request */
export function printKernelParallelProof(proof, hir, context, request) {
  return canonical(verifyKernelParallelProof(proof, hir, context, request)) + '\n';
}
// The existing value limit counts canonical JSON without LF. Its transport adds
// precisely one byte; the same value policy is reapplied before accepting a DTO.
const transportPolicy = Object.freeze({ ...policy, bytes: policy.bytes + 1 });
/** @param {Uint8Array} bytes @param {any} hir @param {any} context @param {any} request */
export function readKernelParallelProof(bytes, hir, context, request) {
  let input;
  try { input = readGenericJson(copyGenericJsonBytes(bytes, transportPolicy), transportPolicy); }
  catch (error) {
    failure(error?.code?.endsWith('-limit') ? 'r03-d-kernel-access-limit' : 'r03-d-kernel-access-canonical');
  }
  const expected = verifyKernelParallelProof(input.value, hir, context, request);
  if (input.text !== canonical(expected) + '\n') failure('r03-d-kernel-access-canonical');
  return expected;
}
