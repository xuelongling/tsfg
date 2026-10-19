// SPDX-License-Identifier: MIT
// Array owner access algebra is relative to parameter slots, never GlobalId or runtime handles.
import { canonical } from './identity.mjs';
import { arrayHirType } from './array-hir-model.mjs';
export const compareArrayKeys = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const facets = ['owners','reads','writes','structural'];
const flags = [['reads','read'],['writes','write'],['structural','structural']];
const empty = () => Object.fromEntries(facets.map(key => [key,new Map()]));
const entries = set => [...set.entries()].sort(([a],[b]) => compareArrayKeys(a,b));
const parameter = (fn, index) => ({kind:'parameter',functionId:fn.id,index});

/** Complete verified HIR and publication records are the only inputs.
 * @param {any} hir @param {Map<string, any>} contracts @param {(kind:string)=>never} fail */
export function analyzeArrayOwnerAccesses(hir, contracts, fail) {
  let work = 0;
  const charge = () => { if (++work > 16384) fail('limit'); };
  const insert = (set, owner) => { charge(); set.set(canonical(owner),owner); };
  const clone = source => {
    const target = empty();
    for (const key of facets) for (const [,owner] of entries(source[key])) insert(target[key],owner);
    return target;
  };
  /** @type {Map<string,any>} */
  const functions = new Map(hir.functions.map(fn => [fn.id,fn]));
  const bases = new Map(), callSites = new Map();
  // One collection pass. Alias binding introduces no additional owner or meter insertion.
  for (const fn of hir.functions) {
    const base = empty(), bindings = new Map(), calls = []; bases.set(fn.id,base); callSites.set(fn.id,calls);
    fn.parameters.forEach((p,index) => {
      if (p.type !== arrayHirType.id) return;
      const owner = parameter(fn,index); insert(base.owners,owner); bindings.set(p.id,owner);
    });
    const ownerOf = binding => {
      const owner = bindings.get(binding); if (!owner) fail('identity'); return owner;
    };
    const read = value => {
      if (value.kind === 'arrayReadChecked') insert(base.reads,ownerOf(value.receiver.binding));
    };
    for (const [index, stmt] of fn.body.entries()) {
      charge();
      if (stmt.kind === 'local') {
        let owner;
        if (stmt.initializer.kind === 'arrayCreate') {
          owner = {kind:'allocation',functionId:fn.id,allocationSite:stmt.initializer.allocationSite,callPath:[]};
          insert(base.owners,owner);
        } else owner = ownerOf(stmt.initializer.binding);
        bindings.set(stmt.binding.id,owner);
      } else if (stmt.kind === 'arrayStoreDenseChecked') {
        read(stmt.value);
        insert(base.writes,ownerOf(stmt.target.receiver.binding));
        // Checked dense store may append. Caller constants never narrow this flag.
        insert(base.structural,ownerOf(stmt.target.receiver.binding));
      } else if (stmt.kind === 'arrayResizeChecked') insert(base.structural,ownerOf(stmt.target.receiver.binding));
      else {
        const value = stmt.kind === 'expression' ? stmt.expression : stmt.value;
        if (value.kind !== 'arrayDirectCall') { read(value); continue; }
        const callee = functions.get(value.target), contract = contracts.get(value.target), args = [];
        if (!callee || !contract) fail('identity');
        callee.parameters.forEach((p,slot) => {
          if (p.type !== arrayHirType.id) return;
          charge();
          args.push({index:slot,binding:value.arguments[slot].binding,owner:ownerOf(value.arguments[slot].binding)});
        });
        const expressionPath = ['body',index,stmt.kind === 'expression' ? 'expression' : 'value'];
        const publishedLocal = Object.values(contract.upper.local).some(Boolean)
          ? {kind:'callLocal',functionId:fn.id,expressionPath:[...expressionPath]} : null;
        calls.push({functionId:fn.id,expressionPath,range:{...value.range},target:value.target,
          signatureHash:value.signatureHash,arguments:args,consumedDigest:contract.digest,publishedLocal});
      }
    }
  }
  const derived = new Map(), effective = new Map(), active = new Set();
  const solve = id => {
    if (derived.has(id)) return;
    if (active.has(id)) fail('identity'); active.add(id);
    const calls = callSites.get(id), targets = [...new Set(calls.map(call => call.target))].sort(compareArrayKeys);
    for (const target of targets) solve(target);
    const d = clone(bases.get(id)), e = clone(bases.get(id));
    for (const call of calls) {
      const actual = new Map(call.arguments.map(arg => [arg.index,arg.owner]));
      const mapOwner = owner => {
        if (owner.kind === 'parameter') {
          const mapped = owner.functionId === call.target && actual.get(owner.index);
          if (!mapped) fail('identity'); return mapped;
        }
        if (owner.kind !== 'allocation') fail('identity');
        return {kind:'allocation',functionId:owner.functionId,allocationSite:owner.allocationSite,
          callPath:[{functionId:id,expressionPath:[...call.expressionPath]},...owner.callPath]};
      };
      for (const key of facets) for (const [,owner] of entries(derived.get(call.target)[key])) {
        charge(); const mapped = mapOwner(owner); insert(d[key],mapped);
      }
      // Consume the fixed table directly. No temporary effect set changes normative meter charges.
      const published = contracts.get(call.target).upper;
      for (const upper of published.parameters) {
        const owner = actual.get(upper.index); if (!owner) fail('identity');
        charge(); insert(e.owners,owner);
        for (const [key,flag] of flags) if (upper[flag]) { charge(); insert(e[key],owner); }
      }
      if (call.publishedLocal) {
        charge(); insert(e.owners,call.publishedLocal);
        for (const [key,flag] of flags) if (published.local[flag]) { charge(); insert(e[key],call.publishedLocal); }
      }
    }
    active.delete(id); derived.set(id,d); effective.set(id,e);
  };
  for (const fn of hir.functions) solve(fn.id);
  const serialize = value => Object.fromEntries(facets.map(key => [key,entries(value[key]).map(([,owner]) => owner)]));
  const rows = [...hir.functions].sort((a,b) => compareArrayKeys(a.id,b.id)).map(fn => ({
    functionId:fn.id,derived:serialize(derived.get(fn.id)),effective:serialize(effective.get(fn.id)),
    dependencies:[...new Set(callSites.get(fn.id).map(call => call.target))].sort(compareArrayKeys)
      .map(functionId => ({functionId,digest:contracts.get(functionId).digest})),
  }));
  const calls = [...callSites.values()].flat().sort((a,b) => compareArrayKeys(a.functionId,b.functionId)
    || compareArrayKeys(canonical(a.expressionPath),canonical(b.expressionPath)));
  return {functions:rows,calls};
}
