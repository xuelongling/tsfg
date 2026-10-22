// SPDX-License-Identifier: MIT
// Private fixed-table validation and owner preparation; callers supply complete verified HIR.
import { canonical, own, sha256 } from './identity.mjs';
import {arrayAnalysisTypes} from './array-analysis-types.mjs';
import {finiteCallables} from './finite-callables.mjs';
import { checkGenericJsonValueBudget } from './generic-json.mjs';
import { typedArrayJsonPolicy as arrayFactsLimits } from './typed-array-schema.mjs';
import { analyzeArrayOwnerAccesses, compareArrayKeys as compare } from './array-call-model.mjs';

const policy = Object.freeze({...arrayFactsLimits,rejectPrototypeKeys:true}), valuePolicy = Object.freeze({...policy,bytes:policy.bytes - 1});
const flags = ['read','write','structural'];
/** @param {string} [kind] @param {any} [details] @returns {never} */
export function arrayCallFailure(kind = '', details = undefined) {
  const code = 'r03-d-array-call-effects' + (kind ? '-' + kind : '');
  throw Object.assign(new TypeError(code + ': invalid fixed Array owner publication'),
    {code,ruleId:'r01-call-contract',phase:'analysis',...(details ?? {})});
}
const check = (value, kind = '') => { if (!value) arrayCallFailure(kind); };
export function arrayCallBudget(value) {
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
  check(context.family === 'tsfg.array-publication-context-candidate' && context.version === 5 && context.mode === 'fixed');
  check(hash(context.scopeDigest) && hash(context.expectedDigest) && Array.isArray(context.contracts)
    && context.contracts.length >= 1 && context.contracts.length <= 16);
  for (const row of context.contracts) {
    record(row,['functionId','signatureHash','upper','digest']);
    check(hash(row.functionId) && hash(row.signatureHash) && hash(row.digest));
    record(row.upper,['parameters','local','returnOrigin']); record(row.upper.local,flags);
    const origin = row.upper.returnOrigin;
    if (origin !== null) {
      record(origin,['kind','index']);
      check(origin.kind === 'parameter' && Number.isInteger(origin.index) && !Object.is(origin.index,-0)
        && origin.index >= 0 && origin.index <= 7);
    }
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
  arrayCallBudget(context); shape(context);
  const type=arrayAnalysisTypes(hir);
  const functions = finiteCallables(hir).sort((a,b) => compare(a.id,b.id)), records = new Map();
  check(context.contracts.length === functions.length,'identity');
  for (const [index,row] of context.contracts.entries()) {
    const fn = functions[index];
    check(row.functionId === fn.id && row.signatureHash === fn.signatureHash,'identity');
    const slots = fn.parameters.flatMap((p,i) => type.isOwner(p.type) ? [i] : []);
    check(row.upper.parameters.length === slots.length
      && slots.every((slot,i) => row.upper.parameters[i].index === slot),'identity');
    // Readonly view W/S is capability grammar, independently of body coverage.
    for (const p of row.upper.parameters) if (type.isView(fn.parameters[p.index].type)&&!type.isArray(fn.parameters[p.index].type))
      check(!p.write && !p.structural,'identity');
    const origin = row.upper.returnOrigin;
    check(type.isView(fn.returnType.id) ? origin === null
      || type.isOwner(fn.parameters[origin.index]?.type) : origin === null,'identity');
    const {digest,...body} = row;
    check(digest === sha256('tsfg.array-published-contract.v5\0' + canonical(body)),'identity');
    records.set(fn.id,row);
  }
  const scope = {profile:'typed-array-owner-relative-fixed-v5',rootFile:hir.rootFile,
    functions:functions.map(fn => ({functionId:fn.id,name:fn.name,sourcePath:fn.sourcePath,
      signatureHash:fn.signatureHash,parameterTypes:fn.parameters.map(p => p.type),
      returnType:fn.returnType.id})),exports:hir.exports.map(row => ({name:row.name,functionId:row.functionId}))};
  const scopeDigest = sha256('tsfg.array-call-scope.v5\0' + canonical(scope));
  check(context.scopeDigest === scopeDigest && context.expectedDigest === sha256('tsfg.array-publication.v5\0'
    + canonical({scopeDigest,contracts:context.contracts})),'identity');
  return {records,scopeDigest};
}
function returnEscape(fn,operation) {
  const diagnostic = own({code:'r03-d-readspan-return-escape',ruleId:'r01-span',phase:'hir',
    message:'ReadSpan return may escape a local Array owner',
    primary:{sourceId:fn.sourcePath,...(operation?.range??fn.returnAnnotationRange??fn.range)}});
  throw Object.freeze(Object.assign(new TypeError(diagnostic.message),diagnostic));
}
export function prepareArrayCalls(hir, context,selectedTools=undefined,authority=undefined) {
  const type=arrayAnalysisTypes(hir);
  const {records,scopeDigest} = publication(hir,context);
  const {ownerModel,ownerTools,...flow} = analyzeArrayOwnerAccesses(hir,records,arrayCallFailure,selectedTools,authority);
  const ownerLeaves=owner=>ownerTools.leaves(owner);
  /** @type {Map<string,any>} */
  const byId = new Map(flow.functions.map(row => [row.functionId,row]));
  // All Effective coverage runs in original Source order, not FunctionId order.
  for (const fn of finiteCallables(hir)) {
    const row = byId.get(fn.id), effective = row.effective, upper = records.get(fn.id).upper;
    const leaves=Object.fromEntries(['reads','writes','structural'].map(key=>[key,effective[key].flatMap(ownerLeaves)]));
    const violate = facet => arrayCallFailure('contract',{functionId:fn.id,facet,primary:{sourceId:fn.sourcePath,...fn.range}});
    if (type.isView(fn.returnType.id)) {
      const origin = row.derivedReturnOrigin;
      if (ownerLeaves(origin).some(owner=>owner.kind!=='parameter')) returnEscape(fn,
        ownerModel.functions.get(fn.id).operations.find(operation=>operation.kind==='return'
          &&ownerLeaves(operation.owner).some(owner=>owner.kind!=='parameter')));
      if (ownerTools.compare(ownerTools.key(origin),ownerTools.key(row.effectiveReturnOrigin))!==0) violate('returnOrigin');
    }
    for (const p of upper.parameters) for (const flag of flags) {
      const key = flag === 'read' ? 'reads' : flag === 'write' ? 'writes' : 'structural';
      if (!p[flag] && leaves[key].some(owner => {ownerTools.charge();return owner.kind === 'parameter' && owner.index === p.index
        && owner.functionId === fn.id;})) violate('parameter:' + p.index + ':' + flag);
    }
    for (const flag of flags) {
      const key = flag === 'read' ? 'reads' : flag === 'write' ? 'writes' : 'structural';
      if (!upper.local[flag] && leaves[key].some(owner => {ownerTools.charge();return owner.kind !== 'parameter';})) violate('local:' + flag);
    }
  }
  return {records,scopeDigest,publishedDigest:context.expectedDigest,flow,ownerModel,ownerTools};
}
