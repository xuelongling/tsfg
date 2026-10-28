// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {lowerKernelGlobalCore,lowerHir} from '../../compiler/hir.mjs';
const e=JSON.parse(await readFile(new URL('./module-callable-immutable-global-first.json',import.meta.url),'utf8'));
const o=JSON.parse(await readFile(new URL('./kernel-global-core-oracle.json',import.meta.url),'utf8'));
const fresh=v=>JSON.parse(JSON.stringify(v));
/** Independent fixed-input hash recipe; never derives a successful SUT result. */
/** @param {any} v @returns {string} */
function jcs(v){return v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(jcs).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+jcs(v[k])).join(',')+'}';}
const hash=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
/** @param {any} context */
function resign(context){
  for(const r of context.contracts){const {digest,...body}=r;r.digest=hash('tsfg.module-published-call-contract.v1\0'+jcs(body));}
  context.expectedDigest=hash('tsfg.module-call-publication.v1\0'+jcs({scopeDigest:context.scopeDigest,contracts:context.contracts}));
  return context;
}
const request={targets:e.proofs[0].targets};
test('private GlobalId bridge preserves complete inputs and the ordinary Core capability boundary',()=>{
  const h=fresh(e.hir),context=fresh(e.context),before=jcs({h,context,request});
  assert.equal(lowerKernelGlobalCore(h,context,request),o.core);
  assert.equal(jcs({h,context,request}),before);
  assert.throws(()=>lowerHir(h),{code:'r03-d-capability'});
});
test('self-consistent wider fixed writes conflict even when actual callee and caller bodies still only read',()=>{
  const context=fresh(e.context),global=e.scope.globals[0].globalId;
  for(const name of ['leaf','entry']){
    const id=e.hir.functions.find(fn=>fn.name===name).id;
    context.contracts.find(r=>r.functionId===id).upper.writes=[global];
  }
  resign(context);
  assert.throws(()=>lowerKernelGlobalCore(e.hir,context,request),error=>{
    const x=/** @type {any} */(error);assert.equal(x.code,'r03-d-kernel-access-conflict');
    assert.deepEqual(x.conflicts,{writeWrite:[],writeRead:[],readWrite:[global]});
    assert.deepEqual(x.primary,{sourceId:'/src/app.ts',start:185,end:253});return true;
  });
});
test('self-consistent unknown fixed callee cannot confer kernel Host/effect trust',()=>{
  const context=fresh(e.context);
  for(const name of ['leaf','entry']){
    const id=e.hir.functions.find(fn=>fn.name===name).id;
    context.contracts.find(r=>r.functionId===id).upper={reads:[],writes:[],unknown:true};
  }
  resign(context);
  assert.throws(()=>lowerKernelGlobalCore(e.hir,context,request),{code:'r03-d-kernel-call-effects'});
});
test('every supplied proof facet remains a cold assertion rather than authority',()=>{
  /** @type {Array<(p:any)=>void>} */
  const changes=[p=>{p.inputIdentity=hash('wrong');},p=>{p.hirDigest=hash('wrong');},
    p=>{p.publishedDigest=hash('wrong');},p=>{p.targets.reverse();},p=>{p.accesses[0].reads=[];},
    p=>{p.accesses[1].publishedContractDigest=hash('wrong');},p=>{p.pairs[0].readRead=[];},
    p=>{p.pairs=[];},p=>{p.kernelPermitted=true;}];
  for(const mutate of changes){const proof=fresh(e.proofs[0].proof);mutate(proof);
    assert.throws(()=>lowerKernelGlobalCore(e.hir,e.context,request,proof),{code:'r03-d-kernel-access-proof'});}
});
test('fixed publication, original whole HIR and real root selection are mandatory',()=>{
  const context=fresh(e.context);context.expectedDigest=hash('wrong');
  assert.throws(()=>lowerKernelGlobalCore(e.hir,context,request),{code:'r03-d-module-call-effects-identity'});
  const h=fresh(e.hir);h.functions.find(fn=>fn.name==='entry').id=hash('wrong');
  assert.throws(()=>lowerKernelGlobalCore(h,e.context,request),{code:'r03-module-callable-reconstruct'});
  const leaf=e.hir.functions.find(fn=>fn.name==='leaf').id;
  assert.throws(()=>lowerKernelGlobalCore(e.hir,e.context,{targets:[leaf,request.targets[0]].sort()}),{code:'r03-d-kernel-access-identity'});
});
