// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';

const fixturePins=[
  {
    "name": "value-copy",
    "target": "valueCopy",
    "pins": [
      "d6d8c22c2db575dd467bfe4509cb0032f521344cef705ad07a25c81db50d17b4",
      "3ddb4bea17823c4ffbcebd537179a4bc2c492e332f4790133c05dac4c8559f62",
      "86c74797d0aa570daf19c4b57c5430886a8220e3bbe20f616b2b93c6876c06f8"
    ]
  },
  {
    "name": "copy-original",
    "target": "valueCopyOriginal",
    "pins": [
      "729eb8f7697eb465ce58eadbc3325ea5545f237a22730c1f2b18e7936803183c",
      "bad4edc897d1c96df7a66f834e14482d0d305d03daa6af80aeb5eea6273de97b",
      "1f456076088999673403a2a6c4606d9800f9910694d1d720278a39fd453d7b7c"
    ]
  },
  {
    "name": "nested-read",
    "target": "nestedRead",
    "pins": [
      "09c227a7ead0ec8a9cbd4dd848e24eea39477504cccbb4498a2223e60071bc55",
      "e6c3143701c43e9cdc546302b052daf19037f7e1cca838a4ee53b5bc600351d2",
      "507ff4aba623e674a5804ea0cd9bc6d1289d106a30d271d9e07a3036792870fc"
    ]
  },
  {
    "name": "nested-copy",
    "target": "nestedCopy",
    "pins": [
      "4658114fa36765e51c9f478286e6833b950b9187856e73447f1f1b83eef5f58f",
      "9e02198058989157f4850c0f2fda63684f4b55d949a039c2180e9f796ea91fbc",
      "4da1721475d14ed27168c4b82d58d7af1c429f507d3651aaa8c2716e2da612b7"
    ]
  },
  {
    "name": "value-equal",
    "target": "valueEqual",
    "pins": [
      "f25afc5417a47d1acbb8339af1f60fd26ed58fbc17fa52b94f0704736039e90c",
      "507296b789b34e9ad65beaa3a97e7d7230c02c0727094e1e7a2b1bb7f39293b1",
      "458c6b11c10be17369bd0a615fc14d71444d539944fda572486a005feaf16725"
    ]
  },
  {
    "name": "value-not-equal",
    "target": "valueNotEqual",
    "pins": [
      "6681db4eecd02908342bd46689f9348c18e634295da6b25cc12518cf1a9960ed",
      "ef81d692ac8caff900d9dc8ef98500bcbe227f3ce67445c94df49709595ba291",
      "258fdc6bdafb044862598c0ce348e5d6a7a7cff8c340f120d01aec72ee7a2ea4"
    ]
  },
  {
    "name": "value-call",
    "target": "valueCall",
    "pins": [
      "adb489686527ea53dca235560a40d623f0f2ebc73b5c60989b0e18147e1bdfbc",
      "40985331520bc36110ccc40cd4d7f07c1aa3dd5570aca7e7505a6cac0617481a",
      "0bb04e7d6ed58c824ec43cc97d77571f1080be46801704f18ee72210048b67da"
    ]
  },
  {
    "name": "value-branch",
    "target": "valueBranch",
    "pins": [
      "877f503c1b181c236595b7e49ca10669fed43d78c04098721a0b46210e55636b",
      "d9901bee2bba8d69829f1f70663ecf389ea2efc6b3cb21abbabffcc65164478d",
      "3b479493fdd07250a594414b8e3a8e55c3c3b861f8cfe752bfab4dfb9d4329d0"
    ]
  },
  {
    "name": "gc-callee",
    "target": "valueGcCall",
    "pins": [
      "d846f9778687754c56787e21c76dd55ef4230df3c5da9142ae0f8c3ee3a6419e",
      "760cbaf0f6c3954c916b1287c523f306c132311b827d8138878fc303754293f2",
      "0bc0ac4c7418a0b72dafd876e686bd46577b750cf46d5fe32597026c960cf4a9"
    ]
  },
  {
    "name": "empty-asserted",
    "target": "emptyAssertedRead",
    "pins": [
      "be366462699f228fc9bada1163b8052830d2ccea1529efa6a072cf11eea21725",
      "3713f279410da552d824c097723fe09e30a9e3ac92f738250aeca72db8d2dc67",
      "ecbf8ea240d795a55dbed1447184e62badc5e58eccf1523a1fbf05a259f8f443"
    ]
  },
  {
    "name": "poison-unknown",
    "target": "poisonUnknownWrite",
    "pins": [
      "ef69fca7a4fba47ffe5b136b64067743163095eea011543c3a6e1af89319ea16",
      "05a86f852ef4a528f3eec5c803a79d7e148528607cae66e9f687aba45e035f09",
      "2794fe6fe2b41cf1f13066c409d451b3efac81ff3d289919924e1ea8c28447f2"
    ]
  },
  {
    "name": "padded-equal",
    "target": "paddedEqual",
    "pins": [
      "e0f79f06ae6bcbeccc3bb017b05cbbb9bc2eddbfd86d686f322eb90135204aae",
      "36a46c73a6e9fd39c614b7d1b760246d294ecb42e1904fe389d3179491c92626",
      "e04579d374ff1f3b3b1ccefe80d6e50ff2bd595f959125378ad852cdb1ac7a79"
    ]
  },
  {
    "name": "value-loop",
    "target": "valueLoop",
    "pins": [
      "992a671fc350a47930d676c27f38081cc960e2186bac4adf502306abab9c91b0",
      "54330cc8405d86a1bcb16a6dafbeaddff807679fd3493b5085a795483acf97d4",
      "76b6fc6061d4521920956ac5bb1e916b82a84ba3b6163b179169eb4f5a660934"
    ]
  },
  {
    "name": "value-recursive",
    "target": "valueRecursive",
    "pins": [
      "3f3f35517e3bc0ec7707ceb9a0d7798beda22bd7446e3664fe30dae7ca9fbcd9",
      "b4a3ed4a6ea8f4b31bdcef9aa140aa390666b6e3d92a01fe6e643c3cfd33e111",
      "affdd7a4149ff82005e31598cea7756d18fc244f3474f21541854b61d5b09ec4"
    ]
  }
,
{
  "name": "value-loop-copy",
  "target": "valueLoopCopy",
  "pins": [
    "b4211f9bffd6ef3f4c208842c2f753bb37ec666328b681a84b5cac838c0da35b",
    "d22e18af011dfb838a79695941bb3f168f9f8aba45562e3bf3e937e0af0ddf3f",
    "5812345fd0b3dfcc6c4ad2de5e11e4925e8d21a2d628d9771c45413eee531e9f"
  ]
},
{
  "name": "value-loop-receiver",
  "target": "valueLoopReceiver",
  "pins": [
    "5f647f29886d2469f82db55394a33fe02a88f6f92d5b6643db939a284c977ba0",
    "44bba394485afbf80ecc7a5bb7f1a4427310ec6c1138f2b92abddb67b3480aa4",
    "5c246396f3b8b5cd382a6f886cb6e359efd0e7adabdfca3fd50eb03c0448bab8"
  ]
},
{
  "name": "nested-loop-copy",
  "target": "nestedLoopCopy",
  "pins": [
    "8ecfac4d35c87fc40149c0fad385ca1d8c8ec9b1c484a9b79b1a64d12e4cb425",
    "c790d8302cc9687917634b56b229c8aa50975d4fbb98b1bbdd2c26a45ad5750c",
    "a2821ddc029e4895f758df5159868caf74040e32abee08267559f4b07601c302"
  ]
},
{
  "name": "value-loop-call",
  "target": "valueLoopCall",
  "pins": [
    "07e93daacc8607786fd03e49a5e24ba184a90e42ee6da7be79b12d97d8de9ade",
    "0f07161044000e22a562d0bbf8892384dd81c4b4d25b9719b11fbfa09704df8e",
    "328bedd2a6be960b66badf7f57371ced6bc74705bd00851dbba82a46c10e811e"
  ]
}
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reports=process.env.TSFG_VALUE_LLVM_REPORT_ROOT;
const coreRoot=process.env.TSFG_VALUE_LLVM_CORE_ROOT;
const reportIndex=reports?JSON.parse(await fs.readFile(path.join(reports,'index.json'),'utf8')):null;
test('actual typed return-origin certificates retain unknown, callee, field, copy and receiver boundaries',
  {skip:reports?false:'TSFG_VALUE_LLVM_REPORT_ROOT is not supplied'},async()=>{
    const directory=reportIndex.originCertificates,observed=JSON.parse(await fs.readFile(path.join(directory,'observed.json'),'utf8'));
    assert.equal(observed.qualified,true);assert.deepEqual(observed.first,[]);assert.equal(observed.exit.code,0);assert.equal(observed.close.code,0);
    const control=JSON.parse(await fs.readFile(path.join(directory,'raw/stdout.bin'),'utf8'));assert.equal(control.passed,true);assert.equal(control.SourceProducer,false);assert.equal(control.executionAuthority,false);
    assert.equal(control.controls.length,8);assert.ok(control.controls.every(row=>row.passed&&row.work>0&&row.work<=200000));
  });
function receiverOrder(graph){
  const nodes=new Map(graph.instructions.map(row=>[row.id,row])),blocks=new Map(graph.blocks.map(row=>[row.id,row]));
  const dominates=(a,b)=>a.block===b.block?a.id<b.id:blocks.get(b.block).dominators.includes(a.block);
  const calls=graph.instructions.filter(row=>row.callee);assert.equal(calls.length,1);const call=calls[0];
  const fromCall=(id,seen=new Set())=>{if(id===call.id)return true;if(seen.has(id))return false;seen.add(id);return (nodes.get(id)?.incoming??[]).some(next=>fromCall(next,seen));};
  const stores=graph.instructions.filter(row=>row.kind==='store'&&nodes.get(row.pointer)?.kind==='getelementptr'&&fromCall(row.value));assert.equal(stores.length,1);
  const written=stores[0],pointer=nodes.get(written.pointer),receiver=nodes.get(pointer.pointer);assert.equal(receiver.kind,'load');assert.equal(receiver.pointerResult,true);
  const rebound=graph.instructions.filter(row=>row.kind==='store'&&row.pointer===receiver.pointer&&nodes.get(row.value)?.element==='aggregate'&&nodes.get(row.value).repeating&&dominates(row,call));
  assert.equal(rebound.length,1);assert.ok(dominates(receiver,rebound[0]));assert.ok(dominates(rebound[0],call));assert.ok(dominates(call,written));
  return {pointer,rebound:rebound[0]};
}
function loopStorage(report,fixture,fn){
  const graph=report.controlFlows.find(row=>row.function==='value_'+fn.id.slice(7));assert.ok(graph);
  const loops=fixture.name==='nested-loop-copy'?2:1;assert.equal(graph.backedges,loops);assert.equal(graph.everyCycleHasFuel,true);
  assert.equal(report.sourceFuelSites,report.functions+loops);assert.equal(report.resourceProof,null);assert.match(report.storageLifetime,/fresh at each dynamic definition/);
  const nodes=new Map(graph.instructions.map(row=>[row.id,row])),blocks=new Map(graph.blocks.map(row=>[row.id,row]));
  const reaches=(from,to,blocked=new Set())=>{const todo=[from],seen=new Set();while(todo.length){const at=todo.pop();if(blocked.has(at)||seen.has(at))continue;if(at===to)return true;seen.add(at);todo.push(...blocks.get(at).successors);}return false;};
  const cyclic=id=>blocks.get(id).successors.some(next=>reaches(next,id));
  const flag=graph.instructions.find(row=>row.kind==='store'&&row.value===3&&nodes.get(row.pointer)?.element==='scalar');assert.ok(flag);
  const conditionLoad=graph.instructions.find(row=>row.kind==='load'&&row.pointer===flag.pointer&&cyclic(row.block));assert.ok(conditionLoad);
  const condition=graph.instructions.find(row=>row.kind==='icmp'&&row.predicate==='ne'&&row.operands.includes(conditionLoad.id));assert.ok(condition);
  const branch=graph.instructions.find(row=>row.kind==='br'&&row.condition===condition.id);assert.ok(branch);
  const normalReturn=graph.instructions.find(row=>row.kind==='ret'&&row.value>=0);assert.ok(normalReturn);
  const dynamic=graph.instructions.filter(row=>row.kind==='alloca'&&row.repeating);
  const effects=graph.instructions.filter(row=>row.kind==='store'&&nodes.get(row.pointer)?.kind==='getelementptr');
  assert.ok(reaches(branch.block,normalReturn.block,new Set([...dynamic,...effects].map(row=>row.block))),'original condition has a zero-body path to the normal return');
  if(fixture.name!=='value-loop'){assert.ok(dynamic.some(row=>row.element==='aggregate'));assert.equal(graph.hoistedCopyNegativeRejected,true);assert.ok(report.copies.some(row=>row.repeating&&row.sourceBeforeFreshAllocation));}
  if(fixture.name==='nested-loop-copy')assert.ok(dynamic.some(row=>row.element==='scalar'),'inner binding is created on each outer iteration');
  if(fixture.name==='value-loop-receiver'){
    const selected=receiverOrder(graph),counter=structuredClone(graph);counter.instructions.find(row=>row.id===selected.pointer.id).pointer=selected.rebound.value;
    assert.throws(()=>receiverOrder(counter),'replacing the retained receiver with the rebound plane must fail');
  }
  if(fixture.name==='value-loop-call'){
    const call=graph.instructions.find(row=>row.callee);assert.ok(call);
    const stored=graph.instructions.find(row=>row.kind==='store'&&row.value===call.id&&nodes.get(row.pointer)?.element==='aggregate');assert.ok(stored);
    assert.equal(nodes.get(stored.pointer).repeating,true);
    const normal=graph.instructions.find(row=>row.kind==='phi'&&row.incoming.includes(stored.pointer));assert.ok(normal);
    assert.ok(graph.instructions.some(row=>row.kind==='load'&&row.pointer===normal.id),'normal block argument retains the fresh result plane');
  }
}
for(const fixture of fixturePins){
  const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/formal-value-llvm-v3/'+fixture.name+'/'+name,import.meta.url))));
  raw.forEach((bytes,index)=>assert.equal(sha(bytes),fixture.pins[index],'frozen official Source input'));
  const oracle=JSON.parse(raw[1].toString('utf8')),text=raw[2].toString('utf8');
  assert.equal(oracle.sourceSha256,sha(raw[2]));assert.deepEqual(oracle.sourceRange,{start:0,end:text.length});
  if(fixture.name==='empty-asserted'){
    test('native empty value remains rejected at the complete Common Source boundary',()=>assert.throws(()=>readCommonProgramFacts(raw[0]),error=>error instanceof TypeError&&'code' in error&&error.code==='r03-common-program-source'));
    continue;
  }
  const hir=projectCommonProgram(readCommonProgramFacts(raw[0])),publication=createCommonProgramPublication(hir);
  const request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  const core=emitCommonProgramCore(hir,publication,request),original=oracle.functions.find(row=>row.name===fixture.target);
  assert.ok(original);const selected=hir.functions.filter(row=>row.sourceBinding===original.id);assert.equal(selected.length,1);const fn=selected[0];
  test('complete genuine '+fixture.name+' keeps official identities, fields and UTF16 anchors',async()=>{
    assert.equal(hir.functions.length,oracle.functions.length);assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,text);
    assert.deepEqual(fn.range,original.range);assert.equal(fn.name,fixture.target);
    for(const row of oracle.classes){
      const type=hir.types.find(type=>type.name===row.name);assert.ok(type);assert.equal(type.kind,row.kind);assert.deepEqual(type.origin.range,row.range);
      assert.deepEqual(type.fields.map(field=>field.name),row.fields.map(field=>field.name));
      type.fields.forEach((field,index)=>assert.deepEqual({start:field.origin.start,end:field.origin.end},row.fields[index].range));
    }
    if(coreRoot){assert.ok(path.isAbsolute(coreRoot));const directory=path.join(coreRoot,fixture.name);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'core.mlir'),core,{flag:'wx'});}
  });
  const expectedReject=['gc-callee','poison-unknown'].includes(fixture.name);
  test('actual '+fixture.name+' fixed-value compiler data and independent LLVM reader',
    {skip:reports?false:'TSFG_VALUE_LLVM_REPORT_ROOT is not supplied'},async()=>{
      assert.ok(path.isAbsolute(reports));const directory=reportIndex[fixture.name];assert.ok(path.isAbsolute(directory));
      const observed=JSON.parse(await fs.readFile(path.join(directory,'observed.json'),'utf8'));
      assert.equal(observed.qualified,true);assert.deepEqual(observed.first,[]);assert.equal(observed.exit.code,expectedReject?3:0);assert.equal(observed.close.code,observed.exit.code);
      const stdout=await fs.readFile(path.join(directory,'raw/stdout.bin')),stderr=await fs.readFile(path.join(directory,'raw/stderr.bin'),'utf8');
      if(expectedReject){assert.equal(stdout.length,0);assert.match(stderr,/\[core-ir-value-llvm-capability\]/);return;}
      assert.equal(stderr,'');const report=JSON.parse(stdout.toString('utf8'));
      assert.equal(report.passed,true);assert.equal(report.completeCoreRetained,true);assert.equal(report.mlirRoundTrip,true);assert.equal(report.executionAuthority,false);
      assert.equal(report.functionId,fn.id);assert.equal(report.coreDigest,'sha256:'+sha(core));assert.equal(report.inputIdentity,hir.inputIdentity);
      assert.equal(report.callbacks,report.events.length);assert.equal(report.stackmaps,report.callbacks+report.functions);
      assert.equal(new Set(report.events.map(row=>row.interval)).size,report.events.length);
      assert.equal(report.events.filter(row=>row.kind===1).length,report.sourceFuelSites);
      if(fixture.name.includes('loop'))loopStorage(report,fixture,fn);else assert.equal(report.sourceFuelSites,report.functions);
      assert.ok(report.events.every(row=>row.start>=0&&row.end>row.start&&row.end<=text.length));
      const valueType=fixture.name.startsWith('nested')||fixture.name==='value-equal'||fixture.name==='value-not-equal'?'Nested':fixture.name==='padded-equal'?'Padded':'Delta';
      const expected=valueType==='Nested'?{bytes:8,alignment:4,offsets:[0,4]}:valueType==='Padded'?{bytes:16,alignment:8,offsets:[0,8]}:{bytes:4,alignment:4,offsets:[0]};
      const layout=report.layouts.types.find(row=>row.name===valueType);assert.ok(layout);
      assert.deepEqual([layout.byteSize,layout.alignment,layout.fields.map(row=>row.offset)],[expected.bytes,expected.alignment,expected.offsets]);
      for(const native of report.nativeLayouts)assert.deepEqual([native.byteSize,native.alignment,native.offsets],[expected.bytes,expected.alignment,expected.offsets]);
      assert.ok(report.copies.every(row=>row.separateStorage&&row.sourceSlot!==row.targetSlot));
      if(fixture.name==='value-copy'||fixture.name==='copy-original'||fixture.name==='nested-copy'){
        assert.ok(report.copies.length>=1);assert.ok(report.fieldWrites.length>=1);
        const copy=report.copies[0];assert.ok(report.fieldWrites.every(row=>row.rootSlot===copy.targetSlot));
        if(fixture.name==='copy-original')assert.ok(report.fieldReads.every(row=>row.rootSlot===copy.sourceSlot));
      }
      const expectedWrites=fixture.name==='nested-copy'?['7','9']:fixture.name==='value-copy'||fixture.name==='copy-original'?['7']:fixture.name==='value-branch'?['4']:null;
      if(expectedWrites)assert.deepEqual(report.fieldWrites.map(row=>row.constantBits),expectedWrites,'actual LLVM field stores retain genuine Source literal bits');
      if(fixture.name==='value-call'){assert.equal(report.functions,2);assert.equal(report.directCalls,1);assert.equal(report.events.filter(row=>row.kind===0).length,1);}
      if(fixture.name==='value-recursive'){assert.equal(report.controlFlows[0].resultType,'void');assert.equal(report.physicalCFG[0].emptyNormalResult,true);assert.deepEqual(report.physicalCFG[0].blocks,[0]);}
      if(['value-equal','value-not-equal','padded-equal'].includes(fixture.name)){assert.equal(report.fieldComparisons,2);assert.equal(report.fieldWrites.length,0);assert.ok(report.fieldReads.length>=4);}
    });
}
