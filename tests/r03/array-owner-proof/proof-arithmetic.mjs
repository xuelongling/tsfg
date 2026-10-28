// SPDX-License-Identifier: MIT
// Independent finite owner-set arithmetic; imports only the independent literal grammar.
import assert from 'node:assert/strict';
import {jcs,hash,arrayId,viewId} from './literal-core.mjs';
export const schemaHash='sha256:69efbb1de3c034ede07d63c0ea0a03a57a08a84add8287e65772587b7cb5d9ab';
export const arraySchema='sha256:39a7877720fab4c3e7fc78d28f2232576865ab3c949e064ef7cc1e979548976b';
const order=(a,b)=>Buffer.compare(Buffer.from(jcs(a)),Buffer.from(jcs(b)));
export const ownerSet=values=>[...new Map(values.map(o=>[jcs(o),o])).values()].sort(order);
const alias=(a,b)=>jcs(a)===jcs(b)||(a.kind==='parameter'&&b.kind==='parameter');
export const diagnostic=(kind,primary=null,related=[])=>({code:'core-ir-array-owner-'+kind,
  detail:({input:'invalid Array owner proof request',limit:'Array owner proof budget exceeded',
    identity:'Array owner proof identity differs',site:'Array owner proof site does not name an actual caller call',
    fixed:'fixed Array publication is required',local:'selected callee local resource domain is not covered by this proof',
    conflict:'published Array owner access sets may conflict',proof:'Array owner proof differs from verified Core inputs',
    canonical:'Array owner proof transport is not canonical'})[kind],phase:'analysis',primary,related,ruleId:'r01-kernel',
  ...(['fixed','local'].includes(kind)?{code:'core-ir-array-owner-capability'}:{})});
export function measure(x) {
  let members=0,tokens=0,depth=0,maxStringBytes=0;
  function visit(v,d){
    if(v!==null&&typeof v==='object'){
      depth=Math.max(depth,d+1);tokens+=2;
      if(Array.isArray(v))v.forEach(e=>visit(e,d+1));
      else for(const [k,e]of Object.entries(v)){members++;tokens++;maxStringBytes=Math.max(maxStringBytes,Buffer.byteLength(k));visit(e,d+1);}
    }else{tokens++;if(typeof v==='string')maxStringBytes=Math.max(maxStringBytes,Buffer.byteLength(v));}
  }
  visit(x,0);return{bytes:Buffer.byteLength(jcs(x)),tokens,members,depth,maxStringBytes};
}
export function boundedDiagnostic(error){
  const counts=measure(error);
  return counts.bytes>8388608||counts.tokens>200000||counts.members>65536||counts.depth>128
    ?{error:diagnostic('limit'),diagnosticBeforeOutputGate:error,diagnosticCounts:counts}:{error};
}
export function envelope(model,context,whole,functionId,sites) {
  return {family:'tsfg.array-owner-core-request-candidate',version:'1',schemaHash,mode:'derive',coreText:whole.text,
    request:{functionId,sites},upstream:{inputIdentity:model.inputIdentity,scopeDigest:context?.scopeDigest??null,
      publishedDigest:context?.expectedDigest??null,hirDigest:hash(jcs(model)),requestDigest:hash(jcs({functionId,sites})),jsProofDigest:null},proof:null};
}
export function deriveLiteral(model,context,whole,functionId,sites) {
  const caller=whole.traces.find(f=>f.functionId===functionId);assert.ok(caller);
  if(!context)return{error:diagnostic('fixed'),work:0};
  const contract=new Map(context.contracts.map(r=>[r.functionId,r]));
  const calls=sites.map(s=>{assert.equal(s.block,0);const c=caller.calls.find(c=>c.instruction===s.instruction);assert.ok(c);return c;});
  const location=c=>({sourceId:model.rootFile,start:c.range.start,end:c.range.end});
  for(const c of calls)if(Object.values(contract.get(c.target).upper.local).some(Boolean))
    return{...boundedDiagnostic(diagnostic('local',location(c))),work:0};
  let work=caller.operations.length;
  const accesses=calls.map((c,index)=>{
    const upper=contract.get(c.target).upper;const owners=[],reads=[],writes=[],structural=[];
    c.fullTypes.forEach((t,slot)=>{work++;if(![arrayId,viewId].includes(t)){assert.equal(c.actualOwners[slot],null);return;}
      const o=c.actualOwners[slot];assert.ok(o);owners.push(o);
      const row=upper.parameters.find(r=>r.index===slot);assert.ok(row);
      if(row.read)reads.push(o);if(row.write)writes.push(o);if(row.structural)structural.push(o);});
    return{site:sites[index],target:c.target,consumedDigest:c.consumedDigest,
      owners:ownerSet(owners),reads:ownerSet(reads),writes:ownerSet(writes),structural:ownerSet(structural)};
  });
  const proof={family:'tsfg.array-owner-core-proof-candidate',version:'1',schemaHash,
    scope:'callee-entry-owner-access-same-caller-activation',binding:{arraySchema,
      coreTextDigest:hash('tsfg.array-owner-core-text.v1\0'+whole.text),inputIdentity:model.inputIdentity,
      publishedDigest:context.expectedDigest,scopeDigest:context.scopeDigest,sourcePath:model.rootFile,target:'windows-x86_64-msvc'},
    functionId,sites,accesses,pairs:[]};
  const intersections=[['readRead','reads','reads'],['writeWrite','writes','writes'],['writeRead','writes','reads'],
    ['readWrite','reads','writes'],['structuralLeft','structural','owners'],['structuralRight','owners','structural']];
  for(let i=0;i<calls.length;i++)for(let k=i+1;k<calls.length;k++){
    work++;const pair={left:sites[i],right:sites[k]};
    for(const[name,left,right]of intersections){const matches=[];
      for(const a of accesses[i][left])for(const b of accesses[k][right]){work++;if(alias(a,b))matches.push({left:a,right:b});}
      pair[name]=matches.sort((a,b)=>order(a.left,b.left)||order(a.right,b.right));}
    proof.pairs.push(pair);
    if(intersections.slice(1).some(([name])=>pair[name].length))return{...boundedDiagnostic(diagnostic('conflict',location(calls[i]),[location(calls[k])])),
      firstConflict:{indices:[i,k],pair},accesses,work};
  }
  const counts=measure(proof);
  if(counts.members>65536||counts.tokens>200000||counts.bytes>8388608||counts.depth>128)
    return{error:diagnostic('limit'),theoreticalCounts:counts,work,unpublishedProof:proof};
  return{proof,counts,work};
}
