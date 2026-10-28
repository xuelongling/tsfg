// SPDX-License-Identifier: MIT
// Select actual-reference storage from verified owned types, independently of
// their declared views. Scalar/value representations keep their canonical path.
import {verifyHir} from './module-hir.mjs';
import {writeTypedReferenceViews} from './typed-reference-views.mjs';
import {own} from './identity.mjs';
/** @param {any} hir @param {any} context */
export function buildTypedReferenceDomains(hir,context) {
  const owned=verifyHir(hir,context),types=new Map(owned.types.map(type=>[type.id,type]));
  let work=100000;
  const reference=id=>{
    if(--work<0)throw new TypeError('r03-reference-domain: limit');
    const type=types.get(id);
    return type.kind==='reference'||type.kind==='null'||type.kind==='undefined'
      ||type.kind==='union'&&type.members.every(reference);
  };
  return own({family:'tsfg.reference-domain-development',version:1,inputIdentity:owned.inputIdentity,
    arrays:owned.types.filter(type=>type.kind==='array'&&reference(type.elementType))
      .map(type=>({typeId:type.id,elementType:type.elementType,storage:'actual-reference-v1'})).sort((a,b)=>a.typeId<b.typeId?-1:1)});
}
/** @param {any} hir @param {any} context */
export function writeTypedReferenceDomains(hir,context) {
  const plan=buildTypedReferenceDomains(hir,context),views=writeTypedReferenceViews(hir,context);
  const header=Buffer.alloc(14);header.write('TSREFD01');header.writeUInt32LE(views.length,8);header.writeUInt16LE(plan.arrays.length,12);
  const ids=plan.arrays.flatMap(row=>[row.typeId,row.elementType].map(id=>Buffer.from(id.slice(7),'hex')));
  const bytes=Buffer.concat([header,views,...ids]);
  if(bytes.length>2097152)throw new TypeError('r03-reference-domain: module size limit');
  return bytes;
}
