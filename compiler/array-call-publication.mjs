// SPDX-License-Identifier: MIT
// Fixed owner-relative publication binds declarations, then consumes callee uppers at real callsites.
import descriptor from '../contracts/array-calls-candidate.schema.json' with {type:'json'};
import { canonical, own, sha256, scalarName } from './identity.mjs';
import { checkGenericJsonValueBudget, copyGenericJsonBytes, readGenericJson } from './generic-json.mjs';
import { arrayFactsLimits } from './array-facts-common.mjs';
import { verifyArrayHir, arrayHirType } from './array-hir-model.mjs';
import { analyzeArrayOwnerAccesses, compareArrayKeys as compare } from './array-call-model.mjs';

const schemaHash = 'sha256:a8b1b3db83b62af50ac9824535f0058f7a7c570f67fc2f1fc9117898d34da51b';
const policy = arrayFactsLimits, valuePolicy = Object.freeze({...policy,bytes:policy.bytes - 1});
const flags = ['read','write','structural'];
/** @param {string} [kind] @param {any} [details] @returns {never} */
export function arrayCallFailure(kind = '', details = undefined) {
  const code = 'r03-d-array-call-effects' + (kind ? '-' + kind : '');
  throw Object.assign(new TypeError(code + ': invalid fixed Array owner publication'),
    {code,ruleId:'r01-call-contract',phase:'analysis',...(details ?? {})});
}
const check = (value, kind = '') => { if (!value) arrayCallFailure(kind); };
check(sha256(canonical(descriptor) + '\n') === schemaHash, 'identity');
function budget(value) {
  try { checkGenericJsonValueBudget(value,valuePolicy); }
  catch (error) { arrayCallFailure(error?.code?.endsWith('-limit') ? 'limit' : ''); }
}
function record(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key)));
}
const hash = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
function shape(context) {
  record(context,['family','version','mode','scopeDigest','expectedDigest','contracts']);
  check(context.family === 'tsfg.array-publication-context-candidate' && context.version === 1 && context.mode === 'fixed');
  check(hash(context.scopeDigest) && hash(context.expectedDigest) && Array.isArray(context.contracts)
    && context.contracts.length >= 1 && context.contracts.length <= 16);
  for (const row of context.contracts) {
    record(row,['functionId','signatureHash','upper','digest']);
    check(hash(row.functionId) && hash(row.signatureHash) && hash(row.digest));
    record(row.upper,['parameters','local']); record(row.upper.local,flags);
    check(flags.every(flag => typeof row.upper.local[flag] === 'boolean'));
    check(Array.isArray(row.upper.parameters) && row.upper.parameters.length <= 8);
    for (const p of row.upper.parameters) {
      record(p,['index',...flags]);
      check(Number.isInteger(p.index) && !Object.is(p.index,-0) && p.index >= 0 && p.index <= 7
        && flags.every(flag => typeof p[flag] === 'boolean'));
    }
  }
}
function publication(hir, context) {
  budget(context); shape(context);
  const functions = [...hir.functions].sort((a,b) => compare(a.id,b.id)), records = new Map();
  check(context.contracts.length === functions.length,'identity');
  for (const [index,row] of context.contracts.entries()) {
    const fn = functions[index];
    check(row.functionId === fn.id && row.signatureHash === fn.signatureHash,'identity');
    const slots = fn.parameters.flatMap((p,i) => p.type === arrayHirType.id ? [i] : []);
    check(row.upper.parameters.length === slots.length
      && slots.every((slot,i) => row.upper.parameters[i].index === slot),'identity');
    const {digest,...body} = row;
    check(digest === sha256('tsfg.array-published-contract.v1\0' + canonical(body)),'identity');
    records.set(fn.id,row);
  }
  const scope = {profile:'array-owner-relative-fixed-v1',rootFile:hir.rootFile,
    functions:functions.map(fn => ({functionId:fn.id,name:fn.name,sourcePath:fn.sourcePath,
      signatureHash:fn.signatureHash,parameterTypes:fn.parameters.map(p => p.type === arrayHirType.id ? 'array.f64' : scalarName(p.type)),
      returnType:'f64'})),exports:hir.exports.map(row => ({name:row.name,functionId:row.functionId}))};
  const scopeDigest = sha256('tsfg.array-call-scope.v1\0' + canonical(scope));
  check(context.scopeDigest === scopeDigest && context.expectedDigest === sha256('tsfg.array-publication.v1\0'
    + canonical({scopeDigest,contracts:context.contracts})),'identity');
  return {records,scopeDigest};
}
function analyzeVerified(hir, context) {
  const {records,scopeDigest} = publication(hir,context);
  const flow = analyzeArrayOwnerAccesses(hir,records,arrayCallFailure);
  /** @type {Map<string,any>} */
  const byId = new Map(flow.functions.map(row => [row.functionId,row]));
  // All Effective coverage runs in original Source order, not FunctionId order.
  for (const fn of hir.functions) {
    const effective = byId.get(fn.id).effective, upper = records.get(fn.id).upper;
    const violate = facet => arrayCallFailure('contract',{functionId:fn.id,facet,primary:{sourceId:fn.sourcePath,...fn.range}});
    for (const p of upper.parameters) for (const flag of flags) {
      const key = flag === 'read' ? 'reads' : flag === 'write' ? 'writes' : 'structural';
      if (!p[flag] && effective[key].some(owner => owner.kind === 'parameter' && owner.index === p.index
        && owner.functionId === fn.id)) violate('parameter:' + p.index + ':' + flag);
    }
    for (const flag of flags) {
      const key = flag === 'read' ? 'reads' : flag === 'write' ? 'writes' : 'structural';
      if (!upper.local[flag] && effective[key].some(owner => owner.kind !== 'parameter')) violate('local:' + flag);
    }
  }
  const report = {format:{family:'tsfg.array-calls-candidate',version:1,schemaHash},
    inputIdentity:hir.inputIdentity,hirDigest:sha256(canonical(hir)),scopeDigest,
    publishedDigest:context.expectedDigest,contracts:context.contracts,...flow};
  budget(report); return own(JSON.parse(canonical(report)));
}
export function analyzeArrayCalls(hir, factsContext, publicationContext) {
  return analyzeVerified(verifyArrayHir(hir,factsContext),publicationContext);
}
export function verifyArrayCalls(report, hir, factsContext, publicationContext) {
  const checked = verifyArrayHir(hir,factsContext);
  budget(report);
  const expected = analyzeVerified(checked,publicationContext);
  check(canonical(report) === canonical(expected),'report'); return expected;
}
export function printArrayCalls(report, hir, factsContext, publicationContext) {
  return canonical(verifyArrayCalls(report,hir,factsContext,publicationContext)) + '\n';
}
export function readArrayCalls(bytes, hir, factsContext, publicationContext) {
  const checked = verifyArrayHir(hir,factsContext);
  let input;
  try { input = readGenericJson(copyGenericJsonBytes(bytes,policy),policy); }
  catch (error) { arrayCallFailure(error?.code?.endsWith('-limit') ? 'limit' : ''); }
  const expected = analyzeVerified(checked,publicationContext);
  check(canonical(input.value) === canonical(expected),'report');
  check(input.text === canonical(expected) + '\n','canonical'); return expected;
}
