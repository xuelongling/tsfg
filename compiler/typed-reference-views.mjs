// SPDX-License-Identifier: MIT
// Source-selected member edges become physical access plans, never target offsets.
import {verifyHir} from './module-hir.mjs';
import {own} from './identity.mjs';
import {typedReferenceAuthority} from './typed-reference-authority.mjs';
import {writeTypedLayoutModule} from './typed-layouts.mjs';
function require(value) {if(!value)throw new TypeError('r03-typed-view: invalid selected member view');}
/** @param {any} hir @param {any} context @param {{publicationContext?:any}} [options] */
export function buildTypedReferenceViews(hir,context,options={}) {
  const owned=verifyHir(hir,context,options.publicationContext);
  const {methods,views}=typedReferenceAuthority(owned);
  return own({family:'tsfg.typed-reference-view-development',version:1,inputIdentity:owned.inputIdentity,
    methods:[...methods.values()].map(fn=>({id:fn.id,ownerType:fn.ownerType,signatureHash:fn.signatureHash,overrideTarget:fn.overrideTarget??null})).sort((a,b)=>a.id<b.id?-1:1),
    views:[...views.values()].sort((a,b)=>a.actualType<b.actualType?-1:a.actualType>b.actualType?1:a.targetType<b.targetType?-1:1)});
}
/** @param {any} hir @param {any} context @param {{publicationContext?:any}} [options] */
export function writeTypedReferenceViews(hir,context,options={}) {
  const module=buildTypedReferenceViews(hir,context,options),layouts=writeTypedLayoutModule(hir,context,options),chunks=[Buffer.from('TSGVIEW1')];
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
