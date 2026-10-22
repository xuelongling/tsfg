// SPDX-License-Identifier: MIT
// Precondition: a complete validated owned catalogue. This computes member
// authority only; callers retain their full facts/HIR admission boundary.
import {canonical} from './identity.mjs';
export function typedReferenceAuthority(owned,charge=undefined) {
  let remaining=100000;
  const require=value=>{if(!value)throw new TypeError('r03-typed-view: invalid selected member view');};
  const spend=charge??(()=>require(--remaining>=0));
  const types=new Map(owned.types.map(type=>[type.id,type]));
  const methods=new Map(owned.functions.filter(fn=>types.get(fn.ownerType)?.kind==='reference'
    &&types.get(fn.ownerType).methods?.includes(fn.id)).map(fn=>[fn.id,fn]));
  const lineages=new Map();
  const lineage=id=>{
    spend();if(lineages.has(id))return lineages.get(id);
    const original=id,result=[],seen=new Set();
    while(id){spend();require(!seen.has(id));seen.add(id);result.push(id);id=types.get(id).base;}
    result.reverse();const value={ordered:result,ids:seen};lineages.set(original,value);return value;
  };
  const catalogues=new Map();
  const members=id=>{
    spend();if(catalogues.has(id))return catalogues.get(id);
    const fields=new Set(),functions=new Map();
    for(const owner of lineage(id).ordered) {
      for(const field of types.get(owner).fields){spend();fields.add(field.id);}
      for(const id of types.get(owner).methods??[]){spend();const fn=methods.get(id);require(fn);
        if(fn.overrideTarget)functions.delete(fn.overrideTarget);functions.set(id,fn);}
    }
    const result={fields,functions};catalogues.set(id,result);return result;
  };
  const override=(actual,member)=>{
    let selected;
    for(const fn of members(actual).functions.values()) {
      let current=fn;
      while(current){spend();if(current.id===member){require(!selected);selected=fn.id;break;}current=methods.get(current.overrideTarget);}
    }
    return selected;
  };
  const views=new Map();
  for(const record of owned.compatibilityWitnesses) {
    const proof=record.compatibility;
    for(const actual of owned.types.filter(type=>type.kind==='reference')) {
      spend();if(!lineage(actual.id).ids.has(proof.sourceType))continue;
      const source=members(proof.sourceType),target=members(proof.targetType),effective=members(actual.id);
      const fields=[],functions=[];
      for(const pair of proof.members) {
        spend();if(source.fields.has(pair.source)) {
          require(target.fields.has(pair.target)&&effective.fields.has(pair.source));fields.push({...pair});
        }else {
          require(source.functions.has(pair.source)&&target.functions.has(pair.target));
          const selected=override(actual.id,pair.source);require(selected);functions.push({source:selected,target:pair.target});
        }
      }
      const order=(a,b)=>{spend();return a.target<b.target?-1:a.target>b.target?1:0;};fields.sort(order);functions.sort(order);
      require(fields.length<=256&&functions.length<=256);
      const view={actualType:actual.id,targetType:proof.targetType,fields,methods:functions},key=actual.id+'\0'+proof.targetType;
      // Every member was charged above before these bounded canonical comparisons.
      require(!views.has(key)||canonical(views.get(key))===canonical(view));views.set(key,view);require(views.size<=4096);
    }
  }
  const selections=new Map();
  const possibleMethods=(viewType,member)=>{
    spend();const key=viewType+'\0'+member;if(selections.has(key))return selections.get(key);
    const targets=new Set(),pending=[viewType];
    while(pending.length) {
      spend();const type=types.get(pending.pop());require(type);
      if(type.kind==='union'){for(const id of type.members){spend();pending.push(id);}continue;}
      require(type.kind==='reference');
      for(const actual of owned.types)if(actual.kind==='reference') {
        spend();const selected=lineage(actual.id).ids.has(type.id)?override(actual.id,member)
          :views.get(actual.id+'\0'+type.id)?.methods.find(pair=>{spend();return pair.target===member;})?.source;
        if(selected){spend();targets.add(selected);}
      }
    }
    require(targets.size>0);const result=[...targets].sort((a,b)=>{spend();return a<b?-1:a>b?1:0;});
    selections.set(key,result);return result;
  };
  require(methods.size<=4096);return {methods,views,possibleMethods};
}
