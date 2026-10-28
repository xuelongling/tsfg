// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyKernelParallelGroup} from '../../compiler/hir.mjs';
import {capture,publication,canonical,hash,metrics,within} from './module-callable-budget-helpers.mjs';
const domain=(name,value)=>hash(name+'\0'+canonical(value));
// The same independently checked source supplies both fixed publications. The
// first 16 sorted kernel IDs read even shared globals and the last 16 odd ones.
// Each writes one separate high-ID global; no cross-kernel conflict is possible.
function contextFor(bundle,hir,size){
 const original=publication(bundle,hir),ids=hir.globals.map(g=>g.id).sort(),contracts=original.contracts.map((row,index)=>{
  const parity=index<16?0:1,reads=Array.from({length:size},(_,i)=>ids[2*i+parity]);
  const body={functionId:row.functionId,signatureHash:row.signatureHash,parameters:row.parameters,returns:row.returns,upper:{reads,writes:[ids.at(-32+index)],unknown:false}};
  return {...body,digest:domain('tsfg.module-published-call-contract.v1',body)};
 });
 const context={mode:'fixed',scopeDigest:original.scopeDigest,expectedDigest:domain('tsfg.module-call-publication.v1',{scopeDigest:original.scopeDigest,contracts}),contracts};
 assert.equal(new Set(contracts.flatMap(r=>r.upper.writes)).size,32);
 assert.ok(contracts.flatMap(r=>r.upper.writes).every(w=>!contracts.some(r=>r.upper.reads.includes(w))));
 within(context,'independent proof publication');return context;
}
// This is arithmetic over a prescribed 16+16 comparison schedule, not a second
// target solver or a call to a private meter. Every hash serializes to 73 bytes;
// the first item of an array has no comma. Pair skeletons have exactly 224 bytes.
function schedule(size){
 const h='sha256:'+'0'.repeat(64),rows=Array.from({length:32},()=>({functionId:h,publishedContractDigest:h,reads:Array(size).fill(h),writes:[h]}));
 const base={inputIdentity:h,hirDigest:h,publishedDigest:h,targets:Array(32).fill(h),accesses:rows,pairs:[]};
 let byteCount=metrics(base).bytes,tokens=metrics(base).tokens,work=0,completed=0,common=0;
 const reserve=(b,t)=>{if(byteCount+b>8388608||tokens+t>200000)return false;byteCount+=b;tokens+=t;return true;};
 const spend=n=>{work=Math.min(work+n,1000001);return work<=1000000;};
 for(let a=0;a<32;a++)for(let b=a+1;b<32;b++){
  if(!spend(1))return {event:'work',byteCount,tokens,work,completed,common};
  if(!reserve(224+(completed?1:0),18))return {event:'output',byteCount,tokens,work,completed,common};
  const same=(a<16)===(b<16);
  // RR comparisons consume one step per shared element, or 2*size-1
  // alternating disjoint elements. WW consumes 1, WR and RW size each.
  if(same){for(let i=0;i<size;i++){
   if(!spend(1))return {event:'work',byteCount,tokens,work,completed,common};
   if(!reserve(73+(i?1:0),1))return {event:'output',byteCount,tokens,work,completed,common};common++;
  }}else if(!spend(2*size-1))return {event:'work',byteCount,tokens,work,completed,common};
  if(!spend(1+2*size))return {event:'work',byteCount,tokens,work,completed,common};
  completed++;
 }
 return {event:'success',byteCount,tokens,work,completed,common};
}
function kernelLimit(error){assert.ok(error instanceof TypeError && 'code' in error && 'ruleId' in error && 'phase' in error);assert.ok(Object.hasOwn(error,'code')&&Object.hasOwn(error,'ruleId')&&Object.hasOwn(error,'phase'));assert.equal(error.code,'r03-d-kernel-access-limit');assert.equal(error.message,'r03-d-kernel-access-limit: kernel parallel group budget exceeded');assert.equal(error.ruleId,'r01-kernel');assert.equal(error.phase,'hir');return true;}
test('public proof work: real GlobalId upper bounds exhaust comparisons before output reserve',async()=>{
 const {bundle,hir}=await capture('proof-work-1466');assert.equal(hir.globals.length,1466);assert.equal(hir.closure.roots.length,32);
 const request={targets:hir.closure.roots.map(r=>r.target).sort()};within(request,'parallel proof request');
 const lower=schedule(400);assert.deepEqual(lower,{event:'success',byteCount:8174320,tokens:118193,work:698336,completed:496,common:96000});
 const proof=verifyKernelParallelGroup(hir,contextFor(bundle,hir,400),request);assert.equal(proof.pairs.length,496);assert.equal(proof.accesses.length,32);assert.equal(metrics(proof).bytes,lower.byteCount);within(proof,'legal large proof');
 for(let i=0;i<proof.pairs.length;i++){const pair=proof.pairs[i],left=request.targets.indexOf(pair.left),right=request.targets.indexOf(pair.right);assert.equal(pair.readRead.length,(left<16)===(right<16)?400:0);assert.deepEqual([pair.writeWrite,pair.writeRead,pair.readWrite],[[],[],[]]);}
 const upper=schedule(716);assert.equal(upper.event,'work');assert.ok(upper.work>1000000);assert.ok(upper.byteCount<8388608);assert.ok(upper.tokens<200000);assert.equal(upper.completed,379);assert.equal(upper.common,88784);
 console.log('TSFG_MODULE_CALLABLE_23D_PROOF_BUDGET '+canonical({lower,upper}));
 assert.throws(()=>verifyKernelParallelGroup(hir,contextFor(bundle,hir,716),request),kernelLimit);
});
