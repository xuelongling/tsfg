// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,readHir,printHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
const root=new URL('./testdata/typed-array-holder-parameter/',import.meta.url);
const expected=JSON.parse(await readFile(new URL('source-expected.json',root),'utf8'));
const hashes={positive:'0fa3c2e29ec2edd6fa1aebbdd3b72456710a7eb17f55fc56fa2d8ad58f3f6393',
  conflict:'266ba35f12440da93cdfa0a86f1c74591eddd56f3358edbbdde051b8e91d458d'};
async function actual(kind){
  const oracle=expected[kind],bytes=await readFile(new URL(oracle.sourceSha256+'-package.json',root));
  assert.equal(sha256(bytes).slice(7),hashes[kind]);const facts=readTypedArrayFacts(bytes);
  const source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(source.content).slice(7),oracle.sourceSha256);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const local={read:true,write:false,structural:false};
  const publication=staticPublication(facts,{first:{local}});
  return {oracle,facts,source,context,publication};
}
test('actual Holder parameter read consumes its own caller field context',async()=>{
  const {facts,source,context,publication,oracle}=await actual('positive');
  assert.equal(source.content.slice(oracle.formalSpanRead.start,oracle.formalSpanRead.end),'h.span');
  const built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const caller=built.hir.functions.find(fn=>fn.name==='run'),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===caller.id);
  const use=state.events.find(event=>event.kind==='view-stored-call-use');assert.ok(use,'callee field use is a consumed actual event');
  assert.equal(use.range.start,oracle.formalSpanRead.start);
  const family=state.views.find(view=>view.viewId===use.viewId),a=caller.body.find(row=>row.kind==='local'&&row.binding.name==='a');
  assert.equal(family.owner.kind,'allocation');assert.equal(family.owner.functionId,caller.id);
  assert.equal(family.owner.allocationSite,a.initializer.allocationSite,'actual h.span is the caller a family, not a new owner');
  assert.deepEqual(verifyHir(built.hir,context,publication),built.hir);
  assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
});
test('actual Holder parameter read rejects the callee resize of its shared caller owner',async()=>{
  const {facts,source,context,publication,oracle}=await actual('conflict');
  const built=buildHir(facts,context,publication);assert.equal(built.status,'error');
  const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
  assert.equal(diagnostic.primary.start,oracle.primary.start);assert.equal(diagnostic.primary.end,oracle.primary.end);
  assert.equal(source.content.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length=0');
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&
    row.start===oracle.relatedSpanRead.start&&row.end===oracle.relatedSpanRead.end+3));
});
const recursiveExpected=JSON.parse(await readFile(new URL('recursive-source-expected.json',root),'utf8'));
const recursivePackets={safe:'5c2cd02ca01fe427207dc48fd530a0399521088e14ec4d428f3b544dd5283d79',
  recursiveConflict:'e39c05d5a7862eef67016c7f65eb36ebe913a70cc47682ddfbbafe7b3e693e4d',
  nestedEffect:'289e69005d8b45382591928d47e3f6586befdd2e2cbffc7319c4efb11293f2c7'};
async function recursiveActual(kind){
  const oracle=recursiveExpected[kind],bytes=await readFile(new URL(oracle.sourceSha256+'-package.json',root));
  assert.equal(sha256(bytes).slice(7),recursivePackets[kind]);const facts=readTypedArrayFacts(bytes);
  const source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(source.content).slice(7),oracle.sourceSha256);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts,{first:{local:{read:true,write:false,structural:false}},trim:{local:{read:false,write:false,structural:false}}});
  return {oracle,source,built:buildHir(facts,context,publication)};
}
test('HOLDER25s safe recursive field context retains its missing proof instead of false completion',async()=>{
  const {built}=await recursiveActual('safe');
  // This is the current proof capability, not a language ban on recursion.
  assert.equal(built.status,'error');assert.equal(built.diagnostics[0].code,'r03-d-readspan-context-pending');
  assert.match(built.diagnostics[0].message,/recursive.*summary|summary.*recursive/);
});
test('HOLDER25s recursive stored B use cannot disappear behind another completed caller context',async()=>{
  const {built,oracle}=await recursiveActual('recursiveConflict');assert.equal(built.status,'error');
  const diagnostic=built.diagnostics[0];
  if(diagnostic.code==='r03-d-readspan-structural-conflict'){
    assert.deepEqual({start:diagnostic.primary.start,end:diagnostic.primary.end},oracle.primary);
    assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&row.start===oracle.lastUse.start&&row.end===oracle.lastUse.end));
  }else{
    assert.equal(diagnostic.code,'r03-d-readspan-context-pending');assert.match(diagnostic.message,/recursive.*summary|summary.*recursive/);
  }
});
test('HOLDER25s nested effect-only helper retains its own mutation and later field-use anchors',async()=>{
  const {built,source,oracle}=await recursiveActual('nestedEffect');assert.equal(built.status,'error');
  const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
  assert.deepEqual({start:diagnostic.primary.start,end:diagnostic.primary.end},oracle.primary);
  assert.equal(source.content.slice(diagnostic.primary.start,diagnostic.primary.end),'b.length=0');
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&row.start===oracle.lastUse.start&&row.end===oracle.lastUse.end));
});
test('INHERITED25t inherited-only Span fields retain the recursive context dependency',async()=>{
  const oracle=JSON.parse(await readFile(new URL('inherited-recursive-source-expected.json',root),'utf8'));
  const bytes=await readFile(new URL(oracle.source.sha256+'-package.json',root));
  assert.equal(sha256(bytes).slice(7),'039f421a429d6080976a405bc3fa8230fb181b30a8bf2a2f530ce9779db54292');
  const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(source.content).slice(7),oracle.source.sha256);assert.equal(Buffer.byteLength(source.content),oracle.source.bytes);
  const base=facts.payload.types.find(type=>type.name==='H'),derived=facts.payload.types.find(type=>type.name==='D');
  assert.equal(derived.base,base.id,'the actual inherited field remains declared by H');
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts,{first:{local:{read:true,write:false,structural:false}}});
  const built=buildHir(facts,context,publication);assert.equal(built.status,'error');
  const diagnostic=built.diagnostics[0];
  if(diagnostic.code==='r03-d-readspan-structural-conflict'){
    assert.deepEqual({start:diagnostic.primary.start,end:diagnostic.primary.end},oracle.primary);
    assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&row.start===oracle.lastUse.start&&row.end===oracle.lastUse.end));
  }else{
    assert.equal(diagnostic.code,'r03-d-readspan-context-pending');assert.match(diagnostic.message,/recursive.*summary|summary.*recursive/);
  }
});
