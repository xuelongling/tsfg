// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {buildTypedLayouts} from '../../compiler/typed-layouts.mjs';
const expected=JSON.parse(await readFile(new URL('./testdata/typed-array-span-storage/source-expected.json',import.meta.url),'utf8'));
const packetHashes={positive:'4f54e484e19e751647e15fd7932571538e00ca5d60f20c2bf456b13600170778',
  negative:'313fc367bdf150c97012e2c96052322808cca96418c2aba7ea8a2d0659c3af4a'};
async function actual(kind){
  const row=expected.inputs[kind],bytes=await readFile(new URL('./testdata/typed-array-span-storage/'+row.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),packetHashes[kind]);const facts=readTypedArrayFacts(bytes);
  const source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(source.content,row.sourceText);assert.equal(sha256(source.content).slice(7),row.sha256);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const none={read:false,write:false,structural:false};
  return {facts,context,publication:staticPublication(facts,{wrap:{parameters:{0:{...none,read:true}},local:none}})};
}
test('actual class storage, independent value copy and aggregate return retain their original Span families',async()=>{
  const {facts,context,publication}=await actual('positive'),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));const hir=built.hir;
  assert.deepEqual(verifyHir(hir,context,publication),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publication)),context,publication),hir);
  for(const name of ['local','copied','returned']){
    const fn=hir.functions.find(fn=>fn.name===name),state=hir.readSpanPlan.functions.find(row=>row.functionId===fn.id);
    const read=state.events.findLast(event=>event.kind==='view-read-complete');assert.ok(read,name+' final actual field read');
    const family=state.views.find(view=>view.viewId===read.viewId);assert.ok(family,name+' stored family');
    assert.equal(family.owner.kind,'allocation');assert.equal(family.owner.functionId,fn.id);
    const a=fn.body.find(row=>row.kind==='local'&&row.binding.name==='a');assert.ok(a);
    assert.equal(family.owner.allocationSite,a.initializer.allocationSite,name+' field read uses a');
    if(name==='copied'){
      const resize=state.events.find(event=>event.kind==='array-resize-effect');assert.ok(resize);
      assert.notEqual(resize.owner.allocationSite,family.owner.allocationSite,'h overwrite cannot rewrite copy plane');
    }
  }
  const core=lowerFormalHir(hir,context,publication);
  assert.ok(core.includes('"tsfg_core.domain.field_read"'));assert.ok(core.includes('"tsfg_core.domain.copy"'));
  assert.ok(core.includes('"tsfg_core.domain.array_resize"'),'dead h.span does not erase the actual b resize');
});
test('actual class alias storage keeps a live family across the forbidden structural write',async()=>{
  const {facts,context,publication}=await actual('negative'),built=buildHir(facts,context,publication);
  assert.equal(built.status,'error');assert.equal(built.hir,undefined);
  const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
  assert.equal(expected.inputs.negative.sourceText.slice(diagnostic.primary.start,diagnostic.primary.end),expected.negative.conflict.text);
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&
    expected.inputs.negative.sourceText.slice(row.start,row.end)===expected.negative.laterUse.text));
});

test('actual free function first value parameter copies its Span field plane',async()=>{
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-span-storage/call-copy-targets-expected.json',import.meta.url),'utf8'));
  const row=oracle.source[0],bytes=await readFile(new URL('./testdata/typed-array-span-storage/'+row.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),'4c556e2a65d83a704d860645b006c036a0648bce95fa5d8605f45f0ebcef3208');
  const facts=readTypedArrayFacts(bytes),file=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(file.content).slice(7),row.sha256);assert.equal(Buffer.byteLength(file.content),row.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const none={read:false,write:false,structural:false},publication=staticPublication(facts,{change:{parameters:{1:{...none,read:true}},local:none}});
  const built=buildHir(facts,context,publication);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const fn=built.hir.functions.find(fn=>fn.name===oracle.positive.function),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===fn.id);
  const read=state.events.findLast(event=>event.kind==='view-read-complete');assert.ok(read);
  const family=state.views.find(view=>view.viewId===read.viewId),a=fn.body.find(row=>row.kind==='local'&&row.binding.name==='a');
  assert.equal(family.owner.kind,'allocation');assert.equal(family.owner.functionId,fn.id);
  assert.equal(family.owner.allocationSite,a.initializer.allocationSite,'free parameter 0 cannot update the caller value plane');
  const resize=state.events.find(event=>event.kind==='array-resize-effect');assert.ok(resize);
  assert.notEqual(resize.owner.allocationSite,family.owner.allocationSite,'callee copy dies before caller B resize');
  assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
});

for(const [index,name,packet]of [[1,'shrinkA','0a5c9a989872aca2fd1d95f7531c36efed4b0e8f861d5e0c585bd08228bac552'],
  [2,'shrinkB','381f265d35d47add2b8eedb3d82d3ddb4d6a7b33075d36ad410417f452f746aa']]){
  test('actual selected targets preserve both possible stored Span owners before '+name,async()=>{
    const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-span-storage/call-copy-targets-expected.json',import.meta.url),'utf8'));
    const row=oracle.source[index],bytes=await readFile(new URL('./testdata/typed-array-span-storage/'+row.sha256+'-package.json',import.meta.url));
    assert.equal(sha256(bytes).slice(7),packet);const facts=readTypedArrayFacts(bytes);
    const file=facts.payload.files.find(file=>file.path===facts.payload.rootFile);assert.equal(sha256(file.content).slice(7),row.sha256);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
    const none={read:false,write:false,structural:false},publication=staticPublication(facts,{set:{local:none}});
    const built=buildHir(facts,context,publication);assert.equal(built.status,'error');assert.equal(built.hir,undefined);
    const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
    assert.equal(diagnostic.primary.start,oracle.negative.anchors[name]);
    assert.equal(file.content.slice(diagnostic.primary.start,diagnostic.primary.end),(name==='shrinkA'?'a':'b')+'.length=0');
    assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&file.content.slice(row.start,row.end)==='h.span[0]'));
  });
}

async function returnActual(index,packet,rules={}){
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-span-storage/return-guards-expected.json',import.meta.url),'utf8'));
  const row=oracle.source[index],bytes=await readFile(new URL('./testdata/typed-array-span-storage/'+row.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),packet);const facts=readTypedArrayFacts(bytes);
  const file=facts.payload.files.find(file=>file.path===facts.payload.rootFile);assert.equal(sha256(file.content).slice(7),row.sha256);
  assert.equal(Buffer.byteLength(file.content),row.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  return {oracle,file,context,publication:staticPublication(facts,rules),facts};
}
test('actual aggregate return keeps its contained Span live through the callee mutation',async()=>{
  const {oracle,file,context,publication,facts}=await returnActual(0,'3cd4657c3ba3ebf92e13324584b0a0e8073ce77794380c20d35e36b73913afa8');
  const built=buildHir(facts,context,publication);assert.equal(built.status,'error');assert.equal(built.hir,undefined);
  const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,oracle.cases.liveConflict.expected);
  assert.equal(diagnostic.primary.start,oracle.cases.liveConflict.rangeStart);
  assert.equal(file.content.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length=0');
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&file.content.slice(row.start,row.end)==='h'));
});
test('actual local aggregate Span return retains its actual managed Array owner',async()=>{
  const {oracle,context,publication,facts}=await returnActual(1,'aca22df55b6f43ec9a258c74a1e674c3fb5e0d4dba77fe1b65fb9c2f50809762');
  assert.equal(oracle.cases.localOwnerPending.permanentLanguageBan,false);
  const built=buildHir(facts,context,publication);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir,wrap=hir.functions.find(fn=>fn.name==='wrap'),caller=hir.functions.find(fn=>fn.name==='run');
  const state=hir.readSpanPlan.functions.find(row=>row.functionId===caller.id),read=state.events.findLast(row=>row.kind==='view-read-complete');
  assert.ok(read);const family=state.views.find(row=>row.viewId===read.viewId);
  const allocation=wrap.body.find(row=>row.kind==='local'&&row.binding.name==='a');
  assert.equal(family.owner.kind,'allocation');assert.equal(family.owner.functionId,wrap.id);
  assert.equal(family.owner.allocationSite,allocation.initializer.allocationSite);
  assert.equal(family.owner.callPath[0].functionId,caller.id,'the root belongs to the actual normal call outcome');
  const layouts=buildTypedLayouts(hir,context,{publicationContext:publication}),span=hir.types.find(row=>row.kind==='readSpan');
  const representation=layouts.entries.find(row=>row.typeId===span.id).layout;
  assert.equal(representation.referenceCount,1);assert.deepEqual(representation.variants[0].references,[{slot:0,kind:'array',typeId:span.elementType}]);
  assert.deepEqual(verifyHir(hir,context,publication),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publication)),context,publication),hir);
});
test('actual void return excludes a later lexical field write from successful caller state',async()=>{
  const none={read:false,write:false,structural:false};
  const {context,publication,facts}=await returnActual(2,'f0aebccf2e8473d87c52209a74551db0551b0fb16afc5c5fe1fcbd0f88c98ac2',
    {keep:{parameters:{1:{...none,read:true}},local:none}});
  const built=buildHir(facts,context,publication);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const fn=built.hir.functions.find(row=>row.name==='run'),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===fn.id);
  const read=state.events.findLast(event=>event.kind==='view-read-complete');assert.ok(read);
  const family=state.views.find(row=>row.viewId===read.viewId),a=fn.body.find(row=>row.kind==='local'&&row.binding.name==='a');
  assert.equal(family.owner.kind,'allocation');assert.equal(family.owner.functionId,fn.id);
  assert.equal(family.owner.allocationSite,a.initializer.allocationSite);
  const resize=state.events.find(event=>event.kind==='array-resize-effect');assert.ok(resize);
  assert.notEqual(resize.owner.allocationSite,family.owner.allocationSite);
  assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
});

test('actual conditional helper retains the skipped call field state',async()=>{
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-span-storage/conditional-call-expected.json',import.meta.url),'utf8'));
  const bytes=await readFile(new URL('./testdata/typed-array-span-storage/'+oracle.source.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),'90014315a72b663af845336f600eb319c83cc90be9d900206afb5518f8253bd3');
  const facts=readTypedArrayFacts(bytes),file=facts.payload.files.find(row=>row.path===facts.payload.rootFile);
  assert.equal(sha256(file.content).slice(7),oracle.source.sha256);assert.equal(Buffer.byteLength(file.content),oracle.source.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const none={read:false,write:false,structural:false},publication=staticPublication(facts,{set:{local:none}});
  const built=buildHir(facts,context,publication);assert.equal(built.status,'error');assert.equal(built.hir,undefined);
  const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
  assert.equal(diagnostic.primary.start,oracle.mutationStart);
  assert.equal(file.content.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length=0');
  assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&row.start===oracle.lastUseStart&&file.content.slice(row.start,row.end)==='h.span[0]'));
});

test('actual both normal conditional arms replace the prior stored Span family',async()=>{
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-span-storage/conditional-both-expected.json',import.meta.url),'utf8'));
  const bytes=await readFile(new URL('./testdata/typed-array-span-storage/'+oracle.source.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),'f9bb4b524b58c9325aed9c6e95925092b477b373389b1ade92174dc12e4a6190');
  const facts=readTypedArrayFacts(bytes),file=facts.payload.files.find(row=>row.path===facts.payload.rootFile);
  assert.equal(sha256(file.content).slice(7),oracle.source.sha256);assert.equal(Buffer.byteLength(file.content),oracle.source.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const none={read:false,write:false,structural:false},publication=staticPublication(facts,{set:{local:none}});
  const built=buildHir(facts,context,publication);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const fn=built.hir.functions.find(row=>row.name==='run'),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===fn.id);
  const reads=state.events.filter(row=>row.kind==='view-read-complete'&&row.range.start===oracle.lastUseStart);
  const owners=reads.map(read=>state.views.find(view=>view.viewId===read.viewId).owner.allocationSite).sort();
  const sites=fn.body.filter(row=>row.kind==='local'&&['b','c'].includes(row.binding.name)).map(row=>row.initializer.allocationSite).sort();
  assert.deepEqual(owners,sites,'joined field contains only B/C; no A or invented allocation');
  assert.equal(state.events.find(row=>row.kind==='array-resize-effect').range.start,oracle.mutationStart);
  assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
});

const loopPackets={
  'span-loop-condition-conflict':'c3bf41b85df0ee48c5e26f99333a2b5220f237e025821a644f16f0142b8141aa',
  'span-loop-condition-independent-owner':'2d0f557641169d4bb3bc6fb56f0b5b3cc3328c1f87e3cc60ccc82f813e8742c5'
};
for(const [name,hash]of Object.entries(loopPackets))test('actual '+name+' retains the repeated condition lifetime',async()=>{
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-span-storage/loop-condition-expected.json',import.meta.url),'utf8'));
  const row=oracle.cases.find(row=>row.name===name);
  const bytes=await readFile(new URL('./testdata/typed-array-span-storage/'+row.source.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),hash);
  const facts=readTypedArrayFacts(bytes),file=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(file.content).slice(7),row.source.sha256);assert.equal(Buffer.byteLength(file.content),row.source.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts),built=buildHir(facts,context,publication);
  if(name==='span-loop-condition-conflict'){
    assert.equal(built.status,'error');assert.equal(built.hir,undefined);
    const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
    assert.equal(diagnostic.primary.start,row.mutationStart);
    assert.equal(file.content.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length=0');
    assert.ok(diagnostic.related.some(at=>at.kind==='borrow-last-use'&&at.start===row.lastUseStart
      &&file.content.slice(at.start,at.end)==='h.span[0]'));
  }else{
    assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    const fn=built.hir.functions.find(fn=>fn.name==='run'),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===fn.id);
    const use=state.events.find(event=>event.kind==='view-read-complete'&&event.range.start===row.lastUseStart);
    const view=state.views.find(view=>view.viewId===use.viewId),resize=state.events.find(event=>event.kind==='array-resize-effect');
    assert.notEqual(view.owner.allocationSite,resize.owner.allocationSite);
    assert.equal(resize.range.start,row.mutationStart);
    assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
  }
});

const loopReturnPackets={
  'span-loop-return-positive':'ca0c0243c0f1ecbd483568697f50495c5ed78c0c26fd26564d72b937ea14329a',
  'span-loop-fallthrough-conflict':'b6152ab91e1b3530a70e5fab6795f925110dda303f95b9b84f0e9ad26eadc69a'
};
for(const [name,hash]of Object.entries(loopReturnPackets))test('actual '+name+' derives backedges without aggregate storage',async()=>{
  const oracle=JSON.parse(await readFile(new URL('./testdata/typed-array-span-storage/loop-return-expected.json',import.meta.url),'utf8'));
  const row=oracle.cases.find(row=>row.name===name);
  const bytes=await readFile(new URL('./testdata/typed-array-span-storage/'+row.sha256+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),hash);
  const facts=readTypedArrayFacts(bytes),file=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(file.content).slice(7),row.sha256);assert.equal(Buffer.byteLength(file.content),row.bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts),built=buildHir(facts,context,publication);
  if(name==='span-loop-fallthrough-conflict'){
    assert.equal(built.status,'error');assert.equal(built.hir,undefined);
    const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
    assert.equal(diagnostic.primary.start,row.mutationStart);
    assert.ok(diagnostic.related.some(at=>at.kind==='borrow-last-use'&&at.start===row.lastUseStart
      &&file.content.slice(at.start,at.end)==='s[0]'));
  }else{
    assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    const fn=built.hir.functions.find(fn=>fn.name==='run'),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===fn.id);
    const use=state.events.find(event=>event.kind==='view-read-complete'&&event.range.start===row.lastUseStart);
    const resize=state.events.find(event=>event.kind==='array-resize-effect');assert.ok(use.sequence<resize.sequence);
    assert.equal(resize.range.start,row.mutationStart);
    assert.deepEqual(readHir(Buffer.from(printHir(built.hir,context,publication)),context,publication),built.hir);
  }
});
