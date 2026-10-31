// SPDX-License-Identifier: MIT
// Explicit first-publication proposal from typed actual observations. No fixed
// publication consumer, solver, physical-slot projection or admission receipt.
import {commonFailure} from './common-program-common.mjs';

/** @typedef {{id:string,kind:string,base?:string,fields?:readonly {id:string}[],construction?:{id:string}}} StorageType */
/** @typedef {{actualTypes:ReadonlySet<string>,unknown:boolean}} StorageObservation */
/** @typedef {{fields:ReadonlyMap<string,StorageObservation>,results:ReadonlyMap<string,StorageObservation>,coverage:{complete:boolean,issues:readonly string[]}}} StorageObservations */
/** @typedef {{actualTypes:string[],unknown:boolean}} StorageUpper */
/** @typedef {{fields:(StorageUpper & {fieldId:string})[],results:(StorageUpper & {construction:string,newTarget:string})[]}} ProposedStorage */

/**
 * hir already owns unique type/field/construction declarations and acyclic
 * base links. Observations are internal typed data, not raw JSON or evidence of
 * exhaustive execution. Missing samples are unknown even under full coverage.
 * @param {{types:readonly StorageType[]}} hir
 * @param {StorageObservations} observations
 * @param {(units?:number)=>void} spend
 * @returns {ProposedStorage}
 */
export function commonProposeConstructionStorage(hir,observations,spend) {
  spend(hir.types.length+1);
  /** @type {Map<string,StorageType>} */ const types=new Map();
  /** @type {Set<string>} */ const fieldIds=new Set();
  /** @type {StorageType[]} */ const newTargets=[];
  for(const type of hir.types){
    spend(type.id.length+1);types.set(type.id,type);spend(type.fields?.length??0);
    for(const field of type.fields??[]){spend(field.id.length+1);fieldIds.add(field.id);}
    if((type.kind==='reference'||type.kind==='value')&&type.construction){spend();newTargets.push(type);}
  }
  /** @type {Map<string,{construction:string,newTarget:string}>} */ const pairs=new Map();
  for(const newTarget of newTargets){
    let owner=newTarget;
    while(true){
      spend();const construction=owner.construction;
      if(!construction)commonFailure('construction-storage','owned constructor ancestry has no construction');
      spend(construction.id.length+newTarget.id.length+1);
      const key=construction.id+'/'+newTarget.id;
      pairs.set(key,{construction:construction.id,newTarget:newTarget.id});
      if(owner.base===undefined)break;
      spend(owner.base.length+1);const base=types.get(owner.base);
      if(!base)commonFailure('construction-storage','construction ancestor is outside the owned catalogue');owner=base;
    }
  }
  // Owned semantic IDs have a fixed ASCII spelling. Code-point order is the
  // ordinary string relation, independent of host locale or insertion order.
  const compare=(left,right)=>{spend(left.length+right.length+1);return left<right?-1:left>right?1:0;};
  /** @param {StorageObservation|undefined} observation @returns {StorageUpper} */
  const upper=observation=>{
    if(observation===undefined){spend(2);return {actualTypes:[],unknown:true};}
    spend(observation.actualTypes.size+2);
    /** @type {string[]} */ const actualTypes=[];
    for(const tag of observation.actualTypes){
      spend(tag.length+1);if(!types.has(tag))commonFailure('construction-storage','observed actual tag is outside the owned catalogue');actualTypes.push(tag);
    }
    actualTypes.sort(compare);
    return {actualTypes,unknown:!observations.coverage.complete||observation.unknown};
  };
  spend(fieldIds.size);const orderedFields=[...fieldIds];orderedFields.sort(compare);
  /** @type {ProposedStorage['fields']} */ const fields=[];
  for(const fieldId of orderedFields){spend(fieldId.length+2);const selected=upper(observations.fields.get(fieldId));fields.push({fieldId,...selected});}
  spend(pairs.size);const orderedPairs=[...pairs.values()];
  orderedPairs.sort((left,right)=>compare(left.construction,right.construction)||compare(left.newTarget,right.newTarget));
  /** @type {ProposedStorage['results']} */ const results=[];
  for(const {construction,newTarget}of orderedPairs){
    spend(construction.length+newTarget.length+3);const selected=upper(observations.results.get(construction+'/'+newTarget));
    results.push({construction,newTarget,...selected});
  }
  return {fields,results};
}
