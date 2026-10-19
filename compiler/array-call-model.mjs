// SPDX-License-Identifier: MIT
// Array owner access algebra is relative to parameter slots, never GlobalId or runtime handles.
import { canonical, arrayTypeId, readSpanTypeId } from './identity.mjs';
export const compareArrayKeys = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const facets = ['owners','reads','writes','structural'];
const flags = [['reads','read'],['writes','write'],['structural','structural']];
const empty = () => Object.fromEntries(facets.map(key => [key,new Map()]));
const entries = set => [...set.entries()].sort(([a],[b]) => compareArrayKeys(a,b));
const parameter = (fn, index) => ({kind:'parameter',functionId:fn.id,index});

// Resolve syntax provenance before fixed coverage. This private trace cannot authorize a result:
// invalid/empty uppers must reach the Source-ordered lifetime/coverage diagnostics below.
function returnOrigins(hir, functions, fail) {
  const origins = new Map(), active = new Set();
  const trace = fn => {
    if (origins.has(fn.id)) return origins.get(fn.id);
    if (active.has(fn.id)) fail('identity'); active.add(fn.id);
    const bindings = new Map();
    fn.parameters.forEach((p,index) => {
      if (p.type === arrayTypeId || p.type === readSpanTypeId) bindings.set(p.id,parameter(fn,index));
    });
    const ownerOf = id => { const owner = bindings.get(id); if (!owner) fail('identity'); return owner; };
    const resolve = (value,expressionPath) => {
      if (value.kind === 'reference') return ownerOf(value.binding);
      if (value.kind === 'readSpanCreateChecked') return ownerOf(value.receiver.binding);
      if (value.kind === 'arrayCreate') return {kind:'allocation',functionId:fn.id,
        allocationSite:value.allocationSite,callPath:[]};
      if (value.kind !== 'arrayDirectCall') fail('identity');
      const callee = functions.get(value.target); if (!callee) fail('identity');
      const origin = trace(callee); if (!origin) fail('identity');
      if (origin.kind === 'parameter') return ownerOf(value.arguments[origin.index].binding);
      return {kind:'allocation',functionId:origin.functionId,allocationSite:origin.allocationSite,
        callPath:[{functionId:fn.id,expressionPath:[...expressionPath]},...origin.callPath]};
    };
    let origin = null;
    for (const [index,stmt] of fn.body.entries()) {
      if (stmt.kind === 'local') bindings.set(stmt.binding.id,resolve(stmt.initializer,['body',index,'initializer']));
      else if (stmt.kind === 'return' && fn.returnType.id === readSpanTypeId)
        origin = resolve(stmt.value,['body',index,'value']);
    }
    active.delete(fn.id); origins.set(fn.id,origin); return origin;
  };
  for (const fn of hir.functions) trace(fn);
  return origins;
}

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
  const origins = returnOrigins(hir,functions,fail);
  const bases = new Map(), callSites = new Map(), models = new Map();
  // One collection pass. Alias binding introduces no additional owner or meter insertion.
  for (const fn of hir.functions) {
    const base = empty(), bindings = new Map(), calls = [], lengths = new Map(), proofs = new Map();
    bases.set(fn.id,base); callSites.set(fn.id,calls); models.set(fn.id,{bindings,proofs});
    fn.parameters.forEach((p,index) => {
      if (p.type !== arrayTypeId && p.type !== readSpanTypeId) return;
      const owner = parameter(fn,index); insert(base.owners,owner); bindings.set(p.id,owner); lengths.set(owner,null);
    });
    const ownerOf = binding => {
      const owner = bindings.get(binding); if (!owner) fail('identity'); return owner;
    };
    const read = value => {
      if (value.kind === 'arrayReadChecked' || value.kind === 'readSpanReadChecked') insert(base.reads,ownerOf(value.receiver.binding));
    };
    const mutationProof = (stmt,index,store) => {
      const owner = ownerOf(stmt.target.receiver.binding), previous = lengths.get(owner) ?? null;
      const operand = store ? stmt.target.index : stmt.value;
      const n = operand.kind === 'constant' ? Number(operand.decimal) : null;
      const fresh = owner.kind === 'allocation' && owner.functionId === fn.id && owner.callPath.length === 0;
      const nonStructural = fresh && previous !== null && n !== null && (store ? n < previous : n === previous);
      proofs.set(index,{owner,exactLength:previous,[store ? 'index' : 'newLength']:n,nonStructural});
      lengths.set(owner,!fresh || n === null ? null : store ? previous === null ? null : Math.max(previous,n + 1) : n);
    };
    const ordinaryCall = (value,expressionPath) => {
      const callee = functions.get(value.target), contract = contracts.get(value.target), args = [];
      if (!callee || !contract) fail('identity');
      callee.parameters.forEach((p,slot) => {
        if (p.type !== arrayTypeId && p.type !== readSpanTypeId) return;
        charge();
        args.push({index:slot,binding:value.arguments[slot].binding,owner:ownerOf(value.arguments[slot].binding)});
      });
      const publishedLocal = Object.values(contract.upper.local).some(Boolean)
        ? {kind:'callLocal',functionId:fn.id,expressionPath:[...expressionPath]} : null;
      let returnedView = null, returnedOwner = null;
      if (callee.returnType.id === readSpanTypeId) {
        charge();
        const origin = origins.get(callee.id), fixed = contract.upper.returnOrigin;
        if (!origin) fail('identity');
        if (origin.kind === 'parameter') {
          // Success consumes the exact Published slot. Only a failing contract uses the
          // preliminary actual trace, so coverage wins over a spurious missing-binding error.
          const slot = fixed?.index === origin.index ? fixed.index : origin.index;
          returnedView = args.find(arg => arg.index === slot);
          if (!returnedView) fail('identity'); returnedOwner = returnedView.owner;
        } else returnedOwner = {kind:'allocation',functionId:origin.functionId,allocationSite:origin.allocationSite,
          callPath:[{functionId:fn.id,expressionPath:[...expressionPath]},...origin.callPath]};
      }
      calls.push({functionId:fn.id,expressionPath,range:{...value.range},target:value.target,
        signatureHash:value.signatureHash,arguments:args,consumedDigest:contract.digest,publishedLocal,returnedView});
      // Product borrow proofs intentionally forget passed view owners too; Source density
      // only tracks Array actuals and its complete facts remain authoritative.
      for (const arg of args) lengths.set(arg.owner,null);
      return returnedOwner;
    };
    for (const [index, stmt] of fn.body.entries()) {
      charge();
      if (stmt.kind === 'local') {
        let owner;
        if (stmt.initializer.kind === 'arrayCreate') {
          owner = {kind:'allocation',functionId:fn.id,allocationSite:stmt.initializer.allocationSite,callPath:[]};
          insert(base.owners,owner); lengths.set(owner,stmt.initializer.elements.length);
        } else if (stmt.initializer.kind === 'readSpanCreateChecked') {
          owner = ownerOf(stmt.initializer.receiver.binding); insert(base.reads,owner);
        } else if (stmt.initializer.kind === 'arrayDirectCall')
          owner = ordinaryCall(stmt.initializer,['body',index,'initializer']);
        else owner = ownerOf(stmt.initializer.binding);
        if (!owner) fail('identity');
        bindings.set(stmt.binding.id,owner);
      } else if (stmt.kind === 'arrayStoreDenseChecked') {
        read(stmt.value); mutationProof(stmt,index,true);
        insert(base.writes,ownerOf(stmt.target.receiver.binding));
        // Checked dense store may append. Caller constants never narrow this flag.
        insert(base.structural,ownerOf(stmt.target.receiver.binding));
      } else if (stmt.kind === 'arrayResizeChecked') {
        mutationProof(stmt,index,false); insert(base.structural,ownerOf(stmt.target.receiver.binding));
      }
      else {
        const value = stmt.kind === 'expression' ? stmt.expression : stmt.value;
        if (value.kind !== 'arrayDirectCall') { read(value); continue; }
        ordinaryCall(value,['body',index,stmt.kind === 'expression' ? 'expression' : 'value']);
      }
    }
  }
  // Each view-return function resolves exactly one source in addition to existing owner work.
  for (const fn of hir.functions) if (fn.returnType.id === readSpanTypeId) charge();
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
    derivedReturnOrigin:origins.get(fn.id),effectiveReturnOrigin:contracts.get(fn.id).upper.returnOrigin === null
      ? null : parameter(fn,contracts.get(fn.id).upper.returnOrigin.index),
    dependencies:[...new Set(callSites.get(fn.id).map(call => call.target))].sort(compareArrayKeys)
      .map(functionId => ({functionId,digest:contracts.get(functionId).digest})),
  }));
  const calls = [...callSites.values()].flat().sort((a,b) => compareArrayKeys(a.functionId,b.functionId)
    || compareArrayKeys(canonical(a.expressionPath),canonical(b.expressionPath)));
  return {functions:rows,calls,ownerModel:{functions:models}};
}
