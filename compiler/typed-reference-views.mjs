// SPDX-License-Identifier: MIT
// Source-selected member edges become physical access plans, never target offsets.
import {verifyHir} from './module-hir.mjs';
import {own,canonical} from './identity.mjs';
import {writeTypedLayoutModule} from './typed-layouts.mjs';
function require(value) {if(!value)throw new TypeError('r03-typed-view: invalid selected member view');}
/** @param {any} hir @param {any} context */
export function buildTypedReferenceViews(hir,context) {
  const owned=verifyHir(hir,context),types=new Map(owned.types.map(type=>[type.id,type]));
  const methods=new Map(owned.functions.filter(fn=>types.get(fn.ownerType)?.kind==='reference'&&types.get(fn.ownerType).methods?.includes(fn.id)).map(fn=>[fn.id,fn]));
  let remaining=100000;const spend=()=>require(--remaining>=0);
  const lineage=id=>{const result=[];while(id){spend();require(!result.includes(id));result.unshift(id);id=types.get(id).base;}return result;};
  const members=id=>{
    const fields=new Set(),functions=new Map();
    for(const owner of lineage(id)) {
      for(const field of types.get(owner).fields){spend();fields.add(field.id);}
      for(const id of types.get(owner).methods??[]){spend();const fn=methods.get(id);require(fn);if(fn.overrideTarget)functions.delete(fn.overrideTarget);functions.set(id,fn);}
    }
    return {fields,functions};
  };
  const views=new Map();
  for(const record of owned.compatibilityWitnesses) {
    const proof=record.compatibility;
    for(const actual of owned.types.filter(type=>type.kind==='reference')) {
      spend();if(!lineage(actual.id).includes(proof.sourceType))continue;
      const source=members(proof.sourceType),target=members(proof.targetType),effective=members(actual.id);
      const fields=[],functions=[];
      for(const pair of proof.members) {
        spend();if(source.fields.has(pair.source)) {
          require(target.fields.has(pair.target)&&effective.fields.has(pair.source));fields.push({...pair});
        }else {
          require(source.functions.has(pair.source)&&target.functions.has(pair.target));
          let selected;
          for(const fn of effective.functions.values()) {
            let current=fn;
            while(current){spend();if(current.id===pair.source){require(!selected);selected=fn.id;break;}current=methods.get(current.overrideTarget);}
          }
          require(selected);functions.push({source:selected,target:pair.target});
        }
      }
      const order=(a,b)=>a.target<b.target?-1:a.target>b.target?1:0;fields.sort(order);functions.sort(order);
      require(fields.length<=256&&functions.length<=256);
      const view={actualType:actual.id,targetType:proof.targetType,fields,methods:functions};
      const key=actual.id+'\0'+proof.targetType;
      require(!views.has(key)||canonical(views.get(key))===canonical(view));views.set(key,view);
      require(views.size<=4096);
    }
  }
  require(methods.size<=4096);
  return own({family:'tsfg.typed-reference-view-development',version:1,inputIdentity:owned.inputIdentity,
    methods:[...methods.values()].map(fn=>({id:fn.id,ownerType:fn.ownerType,signatureHash:fn.signatureHash,overrideTarget:fn.overrideTarget??null})).sort((a,b)=>a.id<b.id?-1:1),
    views:[...views.values()].sort((a,b)=>a.actualType<b.actualType?-1:a.actualType>b.actualType?1:a.targetType<b.targetType?-1:1)});
}
/** @param {any} hir @param {any} context */
export function writeTypedReferenceViews(hir,context) {
  const module=buildTypedReferenceViews(hir,context),layouts=writeTypedLayoutModule(hir,context),chunks=[Buffer.from('TSGVIEW1')];
  const id=value=>{require(/^sha256:[0-9a-f]{64}$/.test(value));chunks.push(Buffer.from(value.slice(7),'hex'));};
  const number=(value,width)=>{require(Number.isInteger(value)&&value>=0&&value<(width===2?65536:4294967296));const bytes=Buffer.alloc(width);bytes.writeUIntLE(value,0,width);chunks.push(bytes);};
  id(module.inputIdentity);number(layouts.length,4);chunks.push(layouts);number(module.methods.length,2);
  for(const method of module.methods){id(method.id);id(method.ownerType);id(method.signatureHash);number(method.overrideTarget?1:0,1);if(method.overrideTarget)id(method.overrideTarget);}
  number(module.views.length,2);
  for(const view of module.views) {
    id(view.actualType);id(view.targetType);
    for(const members of [view.fields,view.methods]){number(members.length,2);for(const pair of members){id(pair.source);id(pair.target);}}
  }
  const bytes=Buffer.concat(chunks);require(bytes.length<=2097152);return bytes;
}
