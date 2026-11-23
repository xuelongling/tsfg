// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {projectTypedArrayFacts} from '../../compiler/typed-array-project.mjs';
import {initialArrayPublication,prepareArrayCalls} from '../../compiler/array-call-context.mjs';
import {buildHir,buildInitialArrayPublication,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {originId} from '../../compiler/typed-array-schema.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {buildTypedLayouts} from '../../compiler/typed-layouts.mjs';
const expected=JSON.parse(await readFile(new URL('./testdata/typed-array-span-storage/source-expected.json',import.meta.url),'utf8'));
const packetHashes={positive:'4f54e484e19e751647e15fd7932571538e00ca5d60f20c2bf456b13600170778',
  negative:'313fc367bdf150c97012e2c96052322808cca96418c2aba7ea8a2d0659c3af4a'};

for(const [name,sourceHash,packetHash,ownerName] of [
  ['then returns','3157dd0efbe9ead0858a3dda6019984267784ea258f9409875819f10719dd16d','cd29101ad0f62a526e83977c5a66bed520a9f7c7df2c6e4ffd9067b9897db1e9','a'],
  ['else returns','fc0b625761f1febadf4a56d4de5bde31441a3067ec20a83de1de64f2b538ebf7','8a6bb7a6df84ad2d585607485851c1a5330ad032f5bb9b4eb59f7c06db9959ca','b'],
  ['both arms continue','8b0ce389f7eed19ed6997bd864192f52b9e22981ac035711337a8472d0c08c89','2f6790379277145a4bd665a45f5a63a30b588e235b4dce2844d80f51a7c6e13f',null],
  ['loop body returns','64810e8c6571887d37de42e1dc82ed141a0aced1e10de6fe66eadea74431eab0','15fff017e9f8552fab201ce567798c3db5a3436bc4e7dd8ba4a7e80b1054bd1e','a'],
  ['loop body reaches condition','dc6953c3647367ddb700fb7d958fed71667872a6801da9dcb9a0990be77dca7f','771077d86accd97100a49b84f5631dffcc2f62ac3eb681543537240741c36a6b',null],
]){
  test('actual ReadSpan joins continuing owners when '+name,async t=>{
    const bytes=await readFile(new URL('./testdata/typed-array-span-storage/'+sourceHash+'-package.json',import.meta.url));
    assert.equal(sha256(bytes),'sha256:'+packetHash);const facts=readTypedArrayFacts(bytes);
    const source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
    assert.equal(sha256(source.content),'sha256:'+sourceHash);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
    const publication=buildInitialArrayPublication(context);
    if(name.startsWith('loop body')){
      const projected=projectTypedArrayFacts(facts),fn=projected.functions[0];
      const continuing=name==='loop body reaches condition';
      const trace=(hir,fixed=publication)=>prepareArrayCalls(hir,fixed).ownerModel.functions.get(fn.id).operations;
      await t.test('post-loop resize uses only reachable lengths',()=>{
        const resize=trace(projected).find(row=>row.kind==='resize');
        assert.deepEqual([resize.proof.exactLength,resize.proof.nonStructural],[continuing?null:1,false]);
      });
      if(!continuing)await t.test('owner analysis excludes a terminating body resize from the initial exit',()=>{
        // An in-memory analysis variant reuses the real loop and resize
        // operations. The original owned package above stays unchanged.
        const loop=fn.body.find(row=>row.kind==='while');
        const resize=fn.body.find(row=>row.expression?.kind==='arrayResizeChecked');
        const sameLength={...resize,expression:{...resize.expression,
          value:{...resize.expression.value,token:'1',decimal:'1'}}};
        const effectsFor=replacement=>{
          const body=fn.body.flatMap(row=>row===loop?replacement:[row===resize?sameLength:row]);
          const variant={...projected,functions:[{...fn,body}]};
          return trace(variant,initialArrayPublication(variant)).filter(row=>row.kind==='resize').map(row=>row.proof);
        };
        const [early,after]=effectsFor([{...loop,body:[resize,...loop.body]}]);
        assert.deepEqual([early.newLength,early.nonStructural],[0,false]);
        assert.deepEqual([after.exactLength,after.newLength,after.nonStructural],[1,1,true]);

        const compareResize=left=>({...loop.condition,kind:'binary',operator:'===',left,right:resize.expression.value});
        const [,afterCondition]=effectsFor([{...loop,condition:compareResize(resize.expression)}]);
        assert.deepEqual([afterCondition.exactLength,afterCondition.newLength,afterCondition.nonStructural],[0,1,false]);

        const {binding}=fn.body.find(row=>row.kind==='local'&&row.binding.name==='owner');
        const target=resize.expression.target,receiver={...target.receiver,binding:binding.id};
        const conditionalRebind={kind:'if',condition:loop.condition,range:loop.range,then:[loop.body[0]],else:[]};
        const resizeAlias={...resize.expression,target:{...target,receiver}};
        const [,afterAlias]=effectsFor([conditionalRebind,{...loop,condition:compareResize(resizeAlias)}]);
        assert.deepEqual([afterAlias.exactLength,afterAlias.nonStructural],[null,false]);
      });
    }
    const built=buildHir(facts,context,publication);
    if(ownerName===null){
      assert.equal(built.status,'error');
      const diagnostic=built.diagnostics[0];
      assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
      assert.equal(source.content.slice(diagnostic.primary.start,diagnostic.primary.end),'b.length = 0');
      return;
    }
    assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    const hir=built.hir,fn=hir.functions.find(fn=>fn.name==='readAfterBranch');
    const plan=hir.readSpanPlan.functions.find(row=>row.functionId===fn.id);
    const read=plan.events.find(row=>row.kind==='view-read-complete');
    const array=fn.body.find(row=>row.kind==='local'&&row.binding.name===ownerName);
    assert.deepEqual(plan.views.find(row=>row.viewId===read.viewId).owner,
      {kind:'allocation',functionId:fn.id,allocationSite:array.initializer.allocationSite,callPath:[]});
    assert.match(lowerFormalHir(hir,context,publication),/tsfg_core\.domain\.array_resize/);
  });
}

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
async function retainedLoopBorrow() {
  const original=await readFile(new URL('./testdata/typed-array-span-storage/653c7cd0c53fdca77d41cad957328cc5d8796eb6af57ad736540c8f99203e8fa-package.json',import.meta.url));
  assert.equal(sha256(original),'sha256:'+loopReturnPackets['span-loop-return-positive']);
  const checkVariant=(edit,conflict)=>{
    const packet=structuredClone(readTypedArrayFacts(original)),payload=packet.payload;
    const {sourceRoot,rootFile,declarations,config}=payload;
    const file=payload.files.find(row=>row.path===rootFile),fn=payload.functions[0];
    const oldLength=file.content.length,use=edit(file,fn.body[2],fn.body[3],fn);
    fn.declarationRange.end+=file.content.length-oldLength;
    file.byteLength=Buffer.byteLength(file.content);file.utf16Length=file.content.length;
    file.sha256=sha256(file.content).slice(7);
    fn.id=sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath:fn.sourcePath,declarationRange:fn.declarationRange}));
    payload.exports[0].functionId=fn.id;
    const request={family:'tsfg.array-facts-request-candidate',version:8,input:{sourceRoot,rootFile,declarations,config,
      files:payload.files.map(({path,content,sha256})=>({path,content,sha256}))}};
    packet.requestId=sha256('tsfg.array-facts.request.v8\0'+canonical(request)+'\n');
    packet.packageId=sha256('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+canonical(payload));
    const factsBytes=Buffer.from(canonical(packet)+'\n'),facts=readTypedArrayFacts(factsBytes);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
    const publication=staticPublication(facts),built=buildHir(facts,context,publication);
    if(conflict){
      assert.equal(built.status,'error');
      const [diagnostic]=built.diagnostics;
      assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
      assert.equal(file.content.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length=0');
      assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&row.start===use.start&&row.end===use.end));
    }else{
      assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
      const printed=printHir(built.hir,context,publication);
      assert.deepEqual(readHir(Buffer.from(printed),context,publication),built.hir);
      const events=built.hir.readSpanPlan.functions[0].events;
      assert.ok(events.some(row=>row.kind==='array-resize-effect'));
      assert.ok(events.some(row=>row.kind==='view-read-complete'&&row.range.start===use.start&&row.range.end===use.end));
      assert.ok(lowerFormalHir(built.hir,context,publication).includes('"tsfg_core.domain.array_resize"'));
      return events;
    }
  };
  const shifted=(row,delta)=>{
    const result=structuredClone(row);
    const walk=value=>{
      if(!value||typeof value!=='object')return;
      if(Number.isSafeInteger(value.start)&&Number.isSafeInteger(value.end)){value.start+=delta;value.end+=delta;}
      else for(const child of Object.values(value))walk(child);
    };
    walk(result);return result;
  };
  return {checkVariant,shifted};
}
test('a terminating loop resize conflicts only with a Span use on its own path',async t=>{
  const {checkVariant,shifted}=await retainedLoopBorrow();
  for(const inBody of [false,true])await t.test(inBody?'same-path return uses the live Span':'post-loop return can only take the initial exit',()=>{
    checkVariant((file,loop,tail)=>{
      // Move the retained checked read into the selected return's new range.
      const returned=inBody?loop.body[1]:tail,{start,end}=returned.value.range,read=loop.condition.left;
      const replacement=file.content.slice(read.range.start,read.range.end),delta=replacement.length-(end-start);
      assert.equal(file.content.slice(start,end),'0');assert.equal(replacement,'s[0]');
      file.content=file.content.slice(0,start)+replacement+file.content.slice(end);
      returned.value=shifted(read,start-read.range.start);returned.range.end+=delta;
      if(inBody){
        loop.range.end+=delta;
        for(const range of [tail.range,tail.value.range]){range.start+=delta;range.end+=delta;}
      }
      return returned.value.range;
    },inBody);
  });
  for(const repeats of [false,true])await t.test(repeats?'loop inside the terminal arm keeps its own backedge':'outer loop cannot repeat a terminating arm',()=>{
    checkVariant((file,loop,tail)=>{
      const [resize,returned]=loop.body,originalSource=file.content;
      let content=originalSource.slice(0,resize.range.start);
      const append=row=>{
        const anchored=shifted(row,content.length-row.range.start);
        content+=originalSource.slice(row.range.start,row.range.end);return anchored;
      };
      const branchStart=content.length;content+='if(';
      const condition=append(loop.condition);content+='){';
      const nestedStart=content.length;
      if(repeats)content+='while(';
      const observed=append(repeats?loop.condition:loop.condition.left);
      content+=repeats?'){':';';
      const effect=append(resize);
      if(repeats)content+='}';
      const range={start:nestedStart,end:content.length};
      const body=repeats?[{kind:'while',range,condition:observed,body:[effect]}]:
        [{kind:'expression',range:{start:nestedStart,end:observed.range.end+1},value:observed},effect];
      body.push(append(returned));content+='}';
      loop.body=[{kind:'if',range:{start:branchStart,end:content.length},condition,then:body,else:[]}];
      content+='}';
      const delta=content.length-loop.range.end;
      file.content=content+originalSource.slice(loop.range.end);
      loop.range.end+=delta;
      for(const range of [tail.range,tail.value.range]){range.start+=delta;range.end+=delta;}
      return repeats?observed.left.range:observed.range;
    },repeats);
  });
});
test('ReadSpan excludes proven dead structural effects and uses',async t=>{
  const {checkVariant,shifted}=await retainedLoopBorrow();
  for(const {prefix,dead,loopBody,operator} of [
    {prefix:'if(false){',dead:true,loopBody:false,operator:null},
    {prefix:'if(true){}else{',dead:true,loopBody:false,operator:null},
    {prefix:'while(false){',dead:true,loopBody:true,operator:null},
    {prefix:'if(true){',dead:false,loopBody:false,operator:null},
    {prefix:'if(s[0]===1||true){}else{',dead:true,loopBody:false,operator:'||'},
    {prefix:'if(s[0]===1&&false){',dead:true,loopBody:false,operator:'&&'},
    {prefix:'if(s[0]===1||false){}else{',dead:false,loopBody:false,operator:'||'},
    {prefix:'if(s[0]===1&&true){',dead:false,loopBody:false,operator:'&&'},
  ])await t.test(prefix,()=>{
    const events=checkVariant((file,loop,tail)=>{
      const original=file.content,[resize]=loop.body,read=loop.condition.left;
      const start=loop.range.start,from=start+prefix.length,to=from+resize.range.end-resize.range.start+1;
      const effect=shifted(resize,from-resize.range.start);
      const token=prefix.includes('false')?'false':'true',at=start+prefix.indexOf(token);
      const literal={kind:'booleanLiteral',type:'bool',flowType:'bool',token,range:{start:at,end:at+token.length}};
      const left=operator?shifted(loop.condition,start+'if('.length-loop.condition.range.start):null;
      const condition=left?{kind:'binary',type:'bool',flowType:'bool',operator,left,right:literal,
        operatorRange:{start:left.range.end,end:at},range:{start:left.range.start,end:literal.range.end}}:literal;
      Object.assign(loop,{condition,range:{start,end:to}});
      if(loopBody)loop.body=[effect];
      else{
        loop.kind='if';delete loop.body;
        loop.then=prefix.includes('else')?[]:[effect];loop.else=prefix.includes('else')?[effect]:[];
      }
      const text=original.slice(read.range.start,read.range.end);
      file.content=original.slice(0,start)+prefix+original.slice(resize.range.start,resize.range.end)+'}return '+text+';}\n';
      tail.value=shifted(read,to+'return '.length-read.range.start);
      tail.range={start:to,end:tail.value.range.end+1};
      return tail.value.range;
    },!dead);
    if(operator&&dead)assert.ok(events.some(row=>row.kind==='view-read-complete'&&row.expressionPath[2]==='condition'));
  });
  for(const withAlias of [false,true])await t.test(withAlias?'an earlier live alias read still rejects resizing':
    'a dead final Span use does not extend a borrow past its resize',()=>{
    checkVariant((file,loop,tail,fn)=>{
      const original=file.content,[resize]=loop.body,read=loop.condition.left;
      const start=loop.range.start,aliasText=withAlias?'const v=s;':'',aliasReadText=withAlias?'v[0];':'';
      const effect=shifted(resize,start+aliasText.length-resize.range.start);
      const statement=original.slice(resize.range.start,resize.range.end),head='if(false){return ';
      const branchStart=effect.range.end+aliasReadText.length,readAt=branchStart+head.length;
      const value=shifted(read,readAt-read.range.start),end=value.range.end+2;
      const guardStart=branchStart+'if('.length,condition={kind:'booleanLiteral',type:'bool',flowType:'bool',
        token:'false',range:{start:guardStart,end:guardStart+'false'.length}};
      const oldTail=original.slice(tail.range.start);
      file.content=original.slice(0,start)+aliasText+statement+aliasReadText+head+
        original.slice(read.range.start,read.range.end)+';}'+oldTail;
      const returned=shifted(tail,end-tail.range.start);
      Object.assign(loop,effect);delete loop.body;delete loop.condition;
      Object.assign(tail,{kind:'if',range:{start:branchStart,end},condition,
        then:[{kind:'return',range:{start:readAt-'return '.length,end:value.range.end+1},value}],else:[]});
      delete tail.value;
      fn.body.push(returned);
      if(!withAlias)return value.range;
      const nameRange={start:start+'const '.length,end:start+'const v'.length},
        declarationRange={start:nameRange.start,end:start+'const v=s'.length};
      const binding=originId(fn.sourcePath,nameRange),receiver=read.receiver;
      const initializer=shifted(receiver,declarationRange.end-1-receiver.range.start);
      fn.bindings.push({id:binding,name:'v',kind:'local',writable:false,declaredType:receiver.type,nameRange,declarationRange,
        annotationRange:null,elementAnnotationRange:null});
      const live=shifted(read,effect.range.end-read.range.start);live.receiver.binding=binding;
      fn.body.splice(2,0,{kind:'constDeclaration',binding,range:declarationRange,initializer});
      fn.body.splice(4,0,{kind:'expression',range:{start:live.range.start,end:branchStart},value:live});
      return live.range;
    },withAlias);
  });
});
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
