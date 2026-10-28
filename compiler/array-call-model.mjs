// SPDX-License-Identifier: MIT
// Derived owner effects and fixed Published effects are deliberately independent.
import {canonical} from './identity.mjs';
import {classifyArrayCallGraph} from './array-call-graph.mjs';
import {traceArrayOwners,createArrayOwnerTools,parameterArrayOwner} from './array-owner-trace.mjs';
import {finiteCallables} from './finite-callables.mjs';
export const compareArrayKeys=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
const facets=['owners','reads','writes','structural'];
const flags=[['reads','read'],['writes','write'],['structural','structural']];
const empty=()=>Object.fromEntries(facets.map(key=>[key,new Map()]));

/** Complete verified typed HIR and separately fixed publication records only. */
export function analyzeArrayOwnerAccesses(hir,contracts,fail,selectedTools=undefined,authority=undefined) {
  let work=0;
  const charge=selectedTools?.charge??(()=>{if(++work>16384)fail('limit');});
  const ownerTools=selectedTools??createArrayOwnerTools(charge);
  const {key:ownerKey,map:mapArrayOwner}=ownerTools;
  const entries=(set,sorted=true)=>{const rows=[];for(const row of set){charge();rows.push(row);}
    return sorted?rows.sort(([a],[b])=>ownerTools.compare(a,b)):rows;};
  const insert=(set,owner)=>{set.set(ownerKey(owner),owner);};
  const clone=source=>{
    const target=empty();for(const key of facets)for(const [,owner]of entries(source[key],false))insert(target[key],owner);
    return target;
  };
  const callables=finiteCallables(hir),{bases,callSites,models,origins}=traceArrayOwners(hir,contracts,fail,charge,insert,empty,ownerTools,authority);
  const calls=[...callSites.values()].flat();
  const arms=new Map(calls.map(call=>[call,call.targets.map(arm=>{charge();return {...call,...arm};})]));
  const graph=classifyArrayCallGraph(callables.map(fn=>fn.id),calls.flatMap(call=>arms.get(call).map(arm=>({caller:call.functionId,target:arm.target}))));
  const derived=new Map(),effective=new Map();
  for(const fn of callables){derived.set(fn.id,clone(bases.get(fn.id)));effective.set(fn.id,clone(bases.get(fn.id)));}
  const scan=id=>{
    let grew=false;const target=derived.get(id);
    for(const site of callSites.get(id))for(const call of arms.get(site))for(const key of facets) {
      const snapshot=entries(derived.get(call.target)[key],false);
      for(const [,owner]of snapshot) {
        const mapped=mapArrayOwner(owner,call,id,fail),keyId=ownerKey(mapped);
        if(!target[key].has(keyId))grew=true;charge();target[key].set(keyId,mapped);
      }
    }
    return grew;
  };
  for(const componentIndex of graph.calleeFirst) {
    const component=graph.components[componentIndex];
    if(!component.cyclic){scan(component.members[0]);continue;}
    const callers=new Map(component.members.map(id=>[id,new Set()]));
    for(const id of component.members)for(const site of callSites.get(id))for(const call of arms.get(site))
      if(callers.has(call.target))callers.get(call.target).add(id);
    const queue=[...component.members],scheduled=new Set(queue);
    while(queue.length) {
      charge();const id=queue.shift();scheduled.delete(id);if(!scan(id))continue;
      for(const caller of [...callers.get(id)].sort(compareArrayKeys))if(!scheduled.has(caller)){scheduled.add(caller);queue.push(caller);}
    }
  }
  // Effective consumes the fixed table once, never a recursively inferred callee summary.
  for(const fn of callables)for(const site of callSites.get(fn.id))for(const call of arms.get(site)) {
    const target=effective.get(fn.id),published=contracts.get(call.target).upper;
    for(const upper of published.parameters) {
      const actual=call.arguments.find(argument=>argument.index===upper.index);if(!actual)fail('identity');
      insert(target.owners,actual.owner);
      for(const [key,flag]of flags)if(upper[flag])insert(target[key],actual.owner);
    }
    if(call.publishedLocal) {
      insert(target.owners,call.publishedLocal);
      for(const [key,flag]of flags)if(published.local[flag])insert(target[key],call.publishedLocal);
    }
  }
  const serialize=value=>Object.fromEntries(facets.map(key=>[key,entries(value[key]).map(([,owner])=>owner)]));
  const rows=[...callables].sort((a,b)=>compareArrayKeys(a.id,b.id)).map(fn=>({
    functionId:fn.id,derived:serialize(derived.get(fn.id)),effective:serialize(effective.get(fn.id)),
    derivedReturnOrigin:origins.get(fn.id),effectiveReturnOrigin:contracts.get(fn.id).upper.returnOrigin===null
      ?null:parameterArrayOwner(fn,contracts.get(fn.id).upper.returnOrigin.index),
    dependencies:[...new Set(callSites.get(fn.id).flatMap(call=>call.targets.map(arm=>arm.target)))].sort(compareArrayKeys)
      .map(functionId=>({functionId,digest:contracts.get(functionId).digest})),
  }));
  calls.sort((a,b)=>compareArrayKeys(a.functionId,b.functionId)||compareArrayKeys(canonical(a.expressionPath),canonical(b.expressionPath)));
  return {functions:rows,calls,ownerModel:{functions:models},ownerTools};
}
