// SPDX-License-Identifier: MIT
// Fixed lexical call bounds enter real flow; this is not a GlobalId effect model.
import { canonical, own, sha256 } from './identity.mjs';
import { verifyClosureHir } from './closure-hir.mjs';
import { solveClosureTargets } from './closure-target-solver.mjs';
import { compareBytes } from './closure-target-domain.mjs';
import { checkGenericJsonValueBudget, copyGenericJsonBytes, readGenericJson } from './generic-json.mjs';

/** @typedef {import('./closure-targets.mjs').ClosureTargetSet} TargetSet */
/** @typedef {{reads:string[], writes:string[], unknown:boolean}} LexicalEffects */
/** @typedef {{functionId:string, signatureHash:string, parameters:{binding:string,allowed:TargetSet}[],
 * returns:TargetSet|null, slotWrites:{binding:string,targets:TargetSet}[], effects:LexicalEffects,digest:string}} ClosureCallContract */
/** Internal, validated input only. No caller callback crosses the public boundary.
 * @typedef {{records:Map<string,ClosureCallContract>,
 * observe:(callee:string,index:number,targets:TargetSet,caller:string,path:(string|number)[],range:{start:number,end:number})=>void}} ClosureFixedFlow */
const limits = Object.freeze({ bytes:8388608, depth:128, jsonTokens:200000,
  stringBytes:1048576, allowNul:true, rejectPrototypeKeys:true });
const messages = { '':'invalid fixed closure call publication',
  identity:'fixed closure call publication identity differs',
  contract:'closure implementation exceeds fixed published upper bound',
  limit:'closure call analysis budget exceeded', report:'closure call report differs from complete recomputation',
  canonical:'closure call report must use canonical JSON plus LF' };
/** @param {string} [kind] @param {any} [details] @returns {never} */
function failure(kind = '', details = undefined) {
  const code = 'r03-d-closure-call-effects' + (kind ? '-' + kind : '');
  throw Object.assign(new TypeError(code + ': ' + messages[kind]),
    { code, ruleId:'r01-call-contract', phase:'analysis', ...(details === undefined ? {} : own(details)) });
}
function budget(value) {
  try { checkGenericJsonValueBudget(value, limits); }
  catch (error) { failure(error.code?.endsWith('-limit') ? 'limit' : ''); }
}
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const hash = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const assert = (value, kind = '') => { if (!value) failure(kind); };
const ordered = values => Array.isArray(values) && values.every((id,index) => hash(id)
  && (index === 0 || compareBytes(values[index - 1],id) < 0));
const topEffects = () => ({ reads:[], writes:[], unknown:true });
const emptyEffects = () => ({ reads:new Set(), writes:new Set(), unknown:false });
const coversTargets = (upper, lower) => upper.top || !lower.top && lower.functions.every(id => upper.functions.includes(id));
const coversEffects = (upper, lower) => upper.unknown || !lower.unknown
  && lower.reads.every(id => upper.reads.includes(id)) && lower.writes.every(id => upper.writes.includes(id));
function meter() {
  let work = 0, members = 0;
  return { step() { if (++work > 1000000) failure('limit'); },
    member() { if (++members > 65536) failure('limit'); } };
}
function declarations(hir, count) {
  /** @type {Map<string,any>} */
  const functions = new Map(hir.functions.map(fn => [fn.id,fn]));
  /** @type {Map<string,any>} */
  const bindings = new Map(), callableTypes = new Set(hir.types.filter(type => type.kind === 'function').map(type => type.id));
  const add = binding => { count.member(); bindings.set(binding.id,binding); };
  const body = items => { for (const item of items) {
    count.step(); if (item.kind === 'local') add(item.binding);
    for (const key of ['body','thenBody','elseBody']) if (item[key]) body(item[key]);
  } };
  for (const fn of hir.functions) { fn.parameters.forEach(add); body(fn.body); }
  return { functions, bindings, callable:type => callableTypes.has(type) };
}
function prepare(hir, context) {
  // Complete descriptor-safe inspection precedes even mode selection or hashing.
  budget(context);
  const checked = verifyClosureHir(hir), count = meter(), table = declarations(checked,count);
  assert(exact(context,['roots','publication']));
  assert(Array.isArray(context.roots) && context.roots.length > 0
    && context.roots.length <= table.functions.size && new Set(context.roots).size === context.roots.length
    && context.roots.every(id => hash(id)));
  assert(context.roots.every(id => table.functions.has(id)), 'identity');
  const roots = [...context.roots].sort(compareBytes), publication = context.publication;
  assert(exact(publication,['mode','scopeDigest','expectedDigest','contracts']) && publication.mode === 'fixed'
    && hash(publication.scopeDigest) && hash(publication.expectedDigest) && Array.isArray(publication.contracts));
  const rows = publication.contracts;
  const sortedFunctions = [...table.functions.values()].sort((a,b) => compareBytes(a.id,b.id));
  const target = (value,type) => {
    assert(exact(value,['top','functions']) && typeof value.top === 'boolean' && ordered(value.functions));
    for (const id of value.functions) {
      count.member(); assert(table.functions.has(id) && table.functions.get(id).signature === type, 'identity');
    }
  };
  // Shape/order is global. A later malformed row cannot hide behind an early body error.
  let last = '';
  for (const row of rows) {
    count.member();
    assert(exact(row,['functionId','signatureHash','parameters','returns','slotWrites','effects','digest'])
      && hash(row.functionId) && hash(row.signatureHash) && hash(row.digest)
      && (!last || compareBytes(last,row.functionId) < 0) && Array.isArray(row.parameters) && Array.isArray(row.slotWrites)
      && exact(row.effects,['reads','writes','unknown']) && typeof row.effects.unknown === 'boolean'
      && ordered(row.effects.reads) && ordered(row.effects.writes));
    last = row.functionId;
    for (const param of row.parameters) assert(exact(param,['binding','allowed']) && hash(param.binding));
    let previous = '';
    for (const slot of row.slotWrites) {
      assert(exact(slot,['binding','targets']) && hash(slot.binding)
        && (!previous || compareBytes(previous,slot.binding) < 0)); previous = slot.binding;
    }
    if (row.effects.unknown) assert(row.effects.reads.length === 0 && row.effects.writes.length === 0);
  }
  assert(rows.length === sortedFunctions.length,'identity');
  /** @type {Map<string,ClosureCallContract>} */
  const records = new Map();
  for (const [index,row] of rows.entries()) {
    const fn = sortedFunctions[index];
    assert(row.functionId === fn.id && row.signatureHash === fn.signatureHash,'identity');
    const parameters = fn.parameters.filter(p => table.callable(p.type));
    assert(row.parameters.length === parameters.length,'identity');
    for (const [i,param] of row.parameters.entries()) {
      assert(param.binding === parameters[i].id,'identity'); target(param.allowed,parameters[i].type);
    }
    if (table.callable(fn.returnType)) target(row.returns,fn.returnType);
    else assert(row.returns === null);
    for (const slot of row.slotWrites) {
      const binding = table.bindings.get(slot.binding);
      assert(binding,'identity'); assert(binding.writable && table.callable(binding.type)); target(slot.targets,binding.type);
    }
    for (const key of ['reads','writes']) for (const id of row.effects[key]) {
      count.member(); const binding = table.bindings.get(id); assert(binding,'identity');
      if (key === 'writes') assert(binding.writable);
    }
    if (!row.effects.unknown) {
      const writes = row.effects.writes.filter(id => table.callable(table.bindings.get(id).type));
      assert(canonical(writes) === canonical(row.slotWrites.map(slot => slot.binding)));
    }
    const { digest, ...preimage } = row;
    assert(digest === sha256('tsfg.closure-published-call-contract.v1\0' + canonical(preimage)),'identity');
    records.set(row.functionId,row);
  }
  const scope = { roots, functions:sortedFunctions.map(fn => ({functionId:fn.id,signatureHash:fn.signatureHash,lexicalParent:fn.lexicalParent})),
    bindings:[...table.bindings.values()].sort((a,b) => compareBytes(a.id,b.id))
      .map(binding => ({binding:binding.id,owner:binding.owner,type:binding.type,writable:binding.writable})) };
  budget(scope);
  const scopeDigest = sha256('tsfg.closure-call-scope.v1\0' + canonical(scope));
  assert(scopeDigest === publication.scopeDigest && publication.expectedDigest
    === sha256('tsfg.closure-call-publication.v1\0' + canonical({scopeDigest,contracts:rows})),'identity');
  return { hir:checked, hirHash:sha256(canonical(checked) + '\n'), roots, records, count, table,
    scopeDigest, publishedDigest:publication.expectedDigest, contracts:rows };
}
function effectDomain(count) {
  const merge = (into, value) => {
    count.step(); if (into.unknown) return false;
    if (value.unknown) { into.unknown = true; into.reads.clear(); into.writes.clear(); return true; }
    let changed = false;
    for (const key of ['reads','writes']) for (const id of value[key]) {
      count.step(); if (!into[key].has(id)) { count.member(); into[key].add(id); changed = true; }
    }
    return changed;
  };
  const wire = value => value.unknown ? topEffects()
    : {reads:[...value.reads].sort(compareBytes),writes:[...value.writes].sort(compareBytes),unknown:false};
  return {merge,wire};
}
function effectsFor(input, legacy, effective) {
  const {count,table,records} = input, domain = effectDomain(count), derived = new Map(), active = new Map();
  const local = fn => {
    const result = emptyEffects();
    for (const capture of fn.captures) if (table.bindings.has(capture.binding)) {
      for (const key of ['reads','writes']) if (capture[key === 'reads' ? 'read' : 'write'])
        domain.merge(result,{reads:key === 'reads' ? [capture.binding] : [],writes:key === 'writes' ? [capture.binding] : [],unknown:false});
    }
    return result;
  };
  for (const fn of legacy.functions) {
    const value = local(table.functions.get(fn.id));
    if (fn.unknownEffects) domain.merge(value,topEffects()); derived.set(fn.id,value);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const call of legacy.calls) {
      count.step(); const caller = derived.get(call.function);
      if (call.targets.top) changed = domain.merge(caller,topEffects()) || changed;
      for (const id of call.targets.functions) changed = domain.merge(caller,derived.get(id)) || changed;
    }
  }
  for (const fn of effective.functions) active.set(fn.id,local(table.functions.get(fn.id)));
  const dependencies = new Map(effective.functions.map(fn => [fn.id,new Set()]));
  for (const call of effective.calls) {
    count.step(); const caller = active.get(call.function);
    if (call.targets.top) domain.merge(caller,topEffects());
    for (const id of call.targets.functions) {
      count.step(); domain.merge(caller,records.get(id).effects);
      if (!dependencies.get(call.function).has(id)) { count.member(); dependencies.get(call.function).add(id); }
    }
  }
  return { effects:effective.functions.map(fn => ({functionId:fn.id,
    derived:derived.has(fn.id) ? domain.wire(derived.get(fn.id)) : topEffects(),effective:domain.wire(active.get(fn.id))})),
  dependencies:effective.functions.map(fn => ({functionId:fn.id,callees:[...dependencies.get(fn.id)].sort(compareBytes)
    .map(id => ({functionId:id,digest:records.get(id).digest}))})) };
}
function analyze(input) {
  const {hir,roots,hirHash,records,count} = input;
  const derivedTargets = solveClosureTargets(hir,roots,hirHash);
  /** @type {Map<string,any>} */
  const observations = new Map();
  /** @type {ClosureFixedFlow} */
  const fixed = { records, observe(callee,index,targets,caller,path,range) {
    count.step(); const key = canonical([callee,caller,path,index]);
    if (!observations.has(key)) { count.member(); observations.set(key,{callee,index,caller,path:[...path],range,
      targets:{top:false,functions:[]}}); }
    const seen = observations.get(key).targets;
    seen.top ||= targets.top;
    for (const id of targets.functions) { count.step(); if (!seen.functions.includes(id)) { count.member(); seen.functions.push(id); } }
    seen.functions.sort(compareBytes);
  } };
  const selected = solveClosureTargets(hir,roots,hirHash,fixed);
  const {format,hirHash:ignoredHash,roots:ignoredRoots,precision,...effectiveTargets} = selected;
  const information = effectsFor(input,derivedTargets,effectiveTargets);
  const effects = new Map(information.effects.map(row => [row.functionId,row.effective]));
  const incoming = new Map();
  for (const observation of observations.values()) {
    count.step(); if (!incoming.has(observation.callee)) incoming.set(observation.callee,[]);
    incoming.get(observation.callee).push(observation);
  }
  // Check after convergence: never authorize an early partial summary.
  for (const fn of effectiveTargets.functions) {
    const row = records.get(fn.id), declaration = input.table.functions.get(fn.id);
    const parameterUppers = new Map(row.parameters.map(p => [p.binding,p.allowed]));
    const slotUppers = new Map(row.slotWrites.map(slot => [slot.binding,slot.targets]));
    const reject = (facet,range) => failure('contract',{functionId:fn.id,facet,
      primary:{path:hir.source.path,start:range.start,end:range.end}});
    if (roots.includes(fn.id)) for (const parameter of declaration.parameters) if (input.table.callable(parameter.type)) {
      const upper = parameterUppers.get(parameter.id);
      if (!coversTargets(upper,{top:true,functions:[]})) reject('parameters',parameter.range);
    }
    const calls = (incoming.get(fn.id) ?? []).sort((a,b) => {
      count.step(); return compareBytes(canonical(a.path),canonical(b.path)) || a.index - b.index || compareBytes(a.caller,b.caller);
    });
    for (const observation of calls) {
      count.step(); const parameter = declaration.parameters[observation.index];
      if (!coversTargets(parameterUppers.get(parameter.id),observation.targets))
        reject('parameters',observation.range);
    }
    if (fn.returns !== null && !coversTargets(row.returns,fn.returns)) reject('returns',declaration.definitionRange);
    if (!row.effects.unknown) for (const write of fn.writes) {
      count.step(); const upper = slotUppers.get(write.binding);
      if (!upper || !coversTargets(upper,write.targets)) reject('slotWrites',declaration.definitionRange);
    }
    if (!coversEffects(row.effects,effects.get(fn.id))) reject('effects',declaration.definitionRange);
  }
  const report = { format:{family:'tsfg.closure-calls-candidate',version:1},inputIdentity:hir.inputIdentity,hirHash,roots,
    scopeDigest:input.scopeDigest,publishedDigest:input.publishedDigest,contracts:input.contracts,
    derivedTargets,effectiveTargets,...information };
  budget(report);
  // Expand legal aliases by JSON position before freezing the independent value.
  return own(JSON.parse(canonical(report)));
}
/** Analyze only the explicit roots' may-reachable owned code, not an ABI or environment instance. */
export function analyzeClosureCalls(hir,context) { return analyze(prepare(hir,context)); }
/** Cold verification always binds explicit caller context and completely recomputes. */
export function verifyClosureCalls(report,hir,context) {
  budget(report); const input = prepare(hir,context);
  if (report?.hirHash !== input.hirHash) failure('identity');
  const expected = analyze(input);
  if (canonical(report) !== canonical(expected)) failure('report');
  return expected;
}
export function printClosureCalls(report,hir,context) { return canonical(verifyClosureCalls(report,hir,context)) + '\n'; }
export function readClosureCalls(bytes,hir,context) {
  budget(context); let input;
  try { input = readGenericJson(copyGenericJsonBytes(bytes,limits),limits); budget(input.value); }
  catch (error) {
    if (error.code?.startsWith('r03-d-closure-call-effects')) throw error;
    failure(error.code?.endsWith('-limit') ? 'limit' : error.code?.endsWith('-canonical') ? 'canonical' : '');
  }
  const report = verifyClosureCalls(input.value,hir,context);
  if (input.text !== canonical(report) + '\n') failure('canonical');
  return report;
}
