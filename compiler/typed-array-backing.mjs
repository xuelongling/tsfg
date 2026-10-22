// SPDX-License-Identifier: MIT
// Allocation identity, static access type and finite physical capacity are
// distinct. This consumes owner/elements equations, never source evaluation.
import {verifyHir} from './module-hir.mjs';
import {buildFiniteCoreDomains} from './finite-actual-domains.mjs';
import {writeTypedReferenceViews} from './typed-reference-views.mjs';
import {canonical,sha256,own} from './identity.mjs';
const require=(value,message)=>{if(!value)throw new TypeError('r03-array-backing: '+message);};

export function buildTypedArrayBacking(input,context) {
  const hir=verifyHir(input,context),definition=buildFiniteCoreDomains(hir,context).definition,
    types=new Map(hir.types.map(type=>[type.id,type])),nodes=new Map(definition.nodes.map(row=>[row.id,row])),
    domains=new Map(definition.domains.map(row=>[row.id,row])),groups=new Map(),ownerViews=new Map();
  let work=100000;
  for(const node of definition.nodes)if(['array','readSpan'].includes(types.get(node.viewType)?.kind))for(const owner of node.arrayOwners) {
    require(work-->0,'view work limit');if(!ownerViews.has(owner))ownerViews.set(owner,new Set());ownerViews.get(owner).add(node.viewType);
  }
  for(const row of definition.nodes) {
    if(!row.id.endsWith('/elements'))continue;
    const owner=row.id.slice(0,-9),typeId=nodes.get(owner)?.viewType??owner.split('/entry-owner/')[1],type=types.get(typeId);
    if(type?.kind!=='array')continue;
    const domain=domains.get(row.domainId);require(domain&&!row.pending.length,'unproved element domain');
    let group=groups.get(typeId);
    if(!group){group={typeId,elementType:type.elementType,members:new Set(),views:new Set([typeId])};groups.set(typeId,group);}
    for(const member of domain.actualTypes)group.members.add(member);
    for(const view of ownerViews.get(owner)??[])group.views.add(view);
  }
  const arrays=[...groups.values()].map(row=>{
    const members=[...row.members].sort();require(members.length<=256&&row.views.size<=4096,'variant/view limit');
    return {typeId:row.typeId,elementType:row.elementType,domainId:sha256('tsfg.actual-domain.v1\0'+canonical(members)),members,views:[...row.views].sort()};
  }).sort((a,b)=>a.typeId<b.typeId?-1:1);
  require(arrays.length<=4096,'array limit');
  return own({family:'tsfg.typed-array-backing-development',version:1,inputIdentity:hir.inputIdentity,arrays});
}

export function writeTypedArrayBacking(hir,context) {
  const plan=buildTypedArrayBacking(hir,context),authority=writeTypedReferenceViews(hir,context),chunks=[Buffer.from('TSGARR01')];
  const word=n=>{require(Number.isInteger(n)&&n>=0&&n<=65535,'word limit');const b=Buffer.alloc(2);b.writeUInt16LE(n);chunks.push(b);},
    id=value=>{require(/^sha256:[0-9a-f]{64}$/.test(value),'identity');chunks.push(Buffer.from(value.slice(7),'hex'));};
  const size=Buffer.alloc(4);size.writeUInt32LE(authority.length);chunks.push(size,authority);word(plan.arrays.length);
  for(const row of plan.arrays){id(row.typeId);id(row.elementType);id(row.domainId);word(row.members.length);row.members.forEach(id);word(row.views.length);row.views.forEach(id);}
  const bytes=Buffer.concat(chunks);require(bytes.length<=2097152,'exchange limit');return bytes;
}
