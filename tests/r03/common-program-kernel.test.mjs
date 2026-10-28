// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {createCommonProgramPublication,analyzeCommonProgram,commonProgramPublicationScope,verifyCommonKernelGroup,
  verifyCommonKernelProof,printCommonKernelProof,readCommonKernelProof} from '../../compiler/common-program-analysis.mjs';
const programs=new Map();
for(const name of ['positive','reachable-managed','reference-value','mixed']) {
  const raw=await fs.readFile(new URL('./common-program-'+name+'.json',import.meta.url)),facts=readCommonProgramFacts(raw);
  const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:raw,expectedPackageId:facts.packageId});
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  programs.set(name,{hir,publication,request});
}
const fn=(hir,name)=>hir.functions.find(row=>row.name===name);
const upper=(analysis,name,hir)=>analysis.functions.find(row=>row.functionId===fn(hir,name).id).effective;
const global=(hir,name)=>hir.globals.find(row=>row.name===name).id;
function republish(publication,change) {
  const next=structuredClone(publication);change(next.contracts);
  for(const row of next.contracts){const {digest,...body}=row;row.digest=commonIdentity('published-contract',body);}
  next.expectedDigest=commonIdentity('publication',{scopeDigest:next.scopeDigest,contracts:next.contracts});return next;
}
for(const name of ['positive','mixed'])test('whole Program fixed kernel proof preserves unrelated ordinary code: '+name,()=>{
  const {hir,publication,request}=programs.get(name),analysis=analyzeCommonProgram(hir,publication),proof=verifyCommonKernelGroup(hir,publication,request);
  assert.equal(analysis.functions.length,name==='mixed'?7:4);assert.equal(proof.accesses.length,2);
  assert.equal(upper(analysis,'ordinary',hir).facets.ehControl,true);assert.equal(upper(analysis,'ordinary',hir).facets.mayThrow,false);
  assert.equal(upper(analysis,'ordinary',hir).facets.allocation,true);assert.equal(upper(analysis,'ordinary',hir).facets.managedReference,true);
  assert.equal(upper(analysis,'left',hir).facets.ehControl,false);assert.equal(upper(analysis,'left',hir).facets.allocation,false);
  const left=proof.accesses.find(row=>row.functionId===fn(hir,'left').id),right=proof.accesses.find(row=>row.functionId===fn(hir,'right').id);
  assert.deepEqual(left.reads,[global(hir,'leftTotal')]);assert.deepEqual(left.writes,[global(hir,'leftTotal')]);
  assert.deepEqual(right.reads,[global(hir,'rightTotal')]);assert.deepEqual(right.writes,[global(hir,'rightTotal')]);
  assert.deepEqual(proof.pairs[0].writeWrite,[]);assert.deepEqual(proof.pairs[0].writeRead,[]);assert.deepEqual(proof.pairs[0].readWrite,[]);
  assert.deepEqual(readCommonKernelProof(Buffer.from(printCommonKernelProof(proof,hir,publication,request)),hir,publication,request),proof);
});
test('body change retains fixed semantic scope and cannot replace original upper',()=>{
  const a=programs.get('positive'),b=programs.get('reachable-managed');
  assert.deepEqual(commonProgramPublicationScope(a.hir),commonProgramPublicationScope(b.hir));
  assert.equal(a.publication.scopeDigest,b.publication.scopeDigest);
  assert.throws(()=>analyzeCommonProgram(b.hir,a.publication),/** @param {any} error */ error=>error.code==='r03-common-program-contract'&&error.functionId===fn(b.hir,'left').id);
  assert.throws(()=>verifyCommonKernelGroup(b.hir,b.publication,b.request),/** @param {any} error */ error=>error.code==='r03-common-program-kernel-capability');
});
test('managed reference nested inside inline value is not a no-GC kernel parameter',()=>{
  const {hir,publication,request}=programs.get('reference-value');
  assert.throws(()=>verifyCommonKernelGroup(hir,publication,request),/** @param {any} error */ error=>error.code==='r03-common-program-kernel-capability'&&error.facets.includes('managedReference'));
});
test('fixed forbidden helper facet propagates despite current pure helper body',()=>{
  const {hir,publication,request}=programs.get('positive');
  const widened=republish(publication,contracts=>{for(const name of ['add','left'])contracts.find(row=>row.functionId===fn(hir,name).id).upper.facets.allocation=true;});
  const analysis=analyzeCommonProgram(hir,widened);assert.equal(analysis.functions.find(row=>row.functionId===fn(hir,'add').id).derived.facets.allocation,false);
  assert.equal(upper(analysis,'left',hir).facets.allocation,true);
  assert.throws(()=>verifyCommonKernelGroup(hir,widened,request),/** @param {any} error */ error=>error.code==='r03-common-program-kernel-capability');
});
test('fixed wider GlobalId upper creates WW WR RW conflicts at declaration anchors',()=>{
  const {hir,publication,request}=programs.get('positive'),right=global(hir,'rightTotal');
  const widened=republish(publication,contracts=>{for(const name of ['add','left'])for(const key of ['reads','writes']){
    const values=contracts.find(row=>row.functionId===fn(hir,name).id).upper.globals[key];values.push(right);values.sort();}});
  analyzeCommonProgram(hir,widened);
  assert.throws(()=>verifyCommonKernelGroup(hir,widened,request),/** @param {any} error */ error=>error.code==='r03-common-program-kernel-conflict'
    &&error.conflicts.writeWrite.includes(right)&&error.conflicts.writeRead.includes(right)&&error.conflicts.readWrite.includes(right)
    &&hir.functions.some(fn=>fn.sourcePath===error.primary.sourceId&&fn.range.start===error.primary.start&&fn.range.end===error.primary.end));
});
test('mixed finally retains pending return and ordinary access, outside kernel initialization',()=>{
  const {hir,publication}=programs.get('mixed'),analysis=analyzeCommonProgram(hir,publication);
  assert.deepEqual(upper(analysis,'ordinary',hir).globals,{reads:[global(hir,'rightTotal')],writes:[global(hir,'rightTotal')]});
  assert.equal(upper(analysis,'view',hir).facets.managedReference,true);assert.equal(upper(analysis,'view',hir).facets.allocation,true);
  const state=analysis.initializers.find(row=>row.functionId===hir.modules.find(row=>row.sourcePath==='/src/state.ts').initializer);
  assert.deepEqual(state.effective.globals.reads,[global(hir,'leftTotal')]);
  assert.deepEqual(state.effective.globals.writes,[global(hir,'leftTotal'),global(hir,'rightTotal')].sort());
});
test('missing fixed row, wrong stable identity and supplied proof mutation fail atomically',()=>{
  const {hir,publication,request}=programs.get('positive');
  const missing=structuredClone(publication);missing.contracts.pop();assert.throws(()=>analyzeCommonProgram(hir,missing));
  const wrong=structuredClone(publication);wrong.contracts[0].signatureHash='sha256:'+'0'.repeat(64);assert.throws(()=>analyzeCommonProgram(hir,wrong));
  const proof=structuredClone(verifyCommonKernelGroup(hir,publication,request));proof.accesses[0].writes=[];
  assert.throws(()=>verifyCommonKernelProof(proof,hir,publication,request),/** @param {any} error */ error=>error.code==='r03-common-program-kernel-proof');
  assert.deepEqual(verifyCommonKernelGroup(hir,publication,request).targets,request.targets);
});
