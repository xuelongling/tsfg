// SPDX-License-Identifier: MIT
// Field backing is a finite definition bound, separate from declared TypeIds.
import {verifyHir} from './module-hir.mjs';
import {buildTypedLayouts} from './typed-layouts.mjs';
import {buildFiniteCoreDomains} from './finite-actual-domains.mjs';
import {writeTypedReferenceViews} from './typed-reference-views.mjs';
import {canonical,sha256,own} from './identity.mjs';
const require=(condition,message)=>{if(!condition)throw new TypeError('r03-field-backing: '+message);};

export function buildTypedFieldBacking(input,context) {
  const hir=verifyHir(input,context),declared=buildTypedLayouts(hir,context),
    definition=buildFiniteCoreDomains(hir,context).definition,
    nodes=new Map(definition.nodes.map(node=>[node.id,node])),domains=new Map(definition.domains.map(domain=>[domain.id,domain]));
  const cells=[];
  for(const entry of declared.entries) {
    if(entry.cell?.kind!=='reference')continue;
    const fields=[];let complete=true;
    for(const field of entry.cell.fields) {
      const node=nodes.get('field/'+entry.typeId+'/'+field.id),domain=node&&domains.get(node.domainId);
      if(!domain?.actualTypes.length){complete=false;break;}
      require(!node.pending?.length,'unproved actual field domain');
      require(domain.id===sha256('tsfg.actual-domain.v1\0'+canonical(domain.actualTypes)),'invalid domain identity');
      fields.push({fieldId:field.id,semanticTypeId:field.typeId,domainId:domain.id,members:domain.actualTypes});
    }
    // A type with no definition-bound storage proof is not allocatable through
    // this module; it is still present as a declared static view in authority.
    if(complete)cells.push({typeId:entry.typeId,runtimeKey:entry.cell.runtimeKey,fields});
  }
  return own({family:'tsfg.typed-field-backing-development',version:1,cells});
}

export function writeTypedFieldBacking(hir,context) {
  const plan=buildTypedFieldBacking(hir,context),authority=writeTypedReferenceViews(hir,context),chunks=[Buffer.from('TSGFLD01')];
  const word=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);chunks.push(b);},
    id=value=>{require(/^sha256:[0-9a-f]{64}$/.test(value),'invalid identity');chunks.push(Buffer.from(value.slice(7),'hex'));};
  const size=Buffer.alloc(4);size.writeUInt32LE(authority.length);chunks.push(size,authority);word(plan.cells.length);
  for(const cell of plan.cells){id(cell.typeId);word(cell.fields.length);
    for(const field of cell.fields){id(field.fieldId);id(field.domainId);word(field.members.length);field.members.forEach(id);}}
  const bytes=Buffer.concat(chunks);require(bytes.length<=2097152,'exchange limit');return bytes;
}
