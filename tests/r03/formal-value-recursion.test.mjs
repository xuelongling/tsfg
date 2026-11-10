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

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reports=process.env.TSFG_VALUE_RECURSION_REPORT_ROOT;
const index=reports?JSON.parse(await fs.readFile(path.join(reports,'index.json'),'utf8')):null;
const cases=new Map();
const fixtures=[
  {name:'value-mutual-recursive',target:'valueMutualA',members:['valueMutualA','valueMutualB'],pins:['d7bcc0c161d1a3a05b6301421db034c8e688db6ce8e3e9ce28568707d2ff044a','a718dc14be1746357f1ad8802df122f7b516e8ee71400a13170c10a4209c482b','18e94325c0781a23b542f064fda51101470bdb58b4d0d36f95637b38db6b84b2']},
  {name:'value-recursive-aggregate',target:'valueRecursiveAggregate',members:['valueRecursiveAggregate'],pins:['e9a43d289ed264f6a2f3f2a69da7c47f6dba7f1149e1d30703ed4ad633ba4005','62d420c6a23e7896f534534b2e3e5d3d1f59fd6759660194b42dd58bcb3cb597','0fc29d9054daf1946a9d036d7ca968a250b08a4473291d3eb6531d2312ce6152']}
];

function graphFacts(graph){
  const nodes=new Map(graph.instructions.map(row=>[row.id,row])),blocks=new Map(graph.blocks.map(row=>[row.id,row]));
  const dominates=(before,after)=>before.block===after.block?before.id<after.id:blocks.get(after.block).dominators.includes(before.block);
  const reaches=(from,to)=>{
    const todo=[from],seen=new Set();
    while(todo.length){const at=todo.pop();if(at===to)return true;if(seen.has(at))continue;seen.add(at);todo.push(...blocks.get(at).successors);}
    return false;
  };
  const allowed=event=>{
    const compare=graph.instructions.find(row=>row.predicate==='ne'&&row.scalarOperands[0].id===event.id&&row.scalarOperands[1].width===32&&row.scalarOperands[1].bits==='0');assert.ok(compare,'callback success tests its actual i32 result');
    const branch=graph.instructions.find(row=>row.kind==='br'&&row.condition===compare.id);assert.ok(branch);assert.ok(dominates(event,branch));
    const successors=blocks.get(branch.block).successors;assert.equal(successors.length,2);
    return {yes:successors[0],no:successors[1]};
  };
  const rootSlots=(id,seen=new Set())=>{
    if(seen.has(id))return [];seen.add(id);const row=nodes.get(id);if(!row)return [];
    if(row.kind==='alloca')return [row.slot];
    if(row.kind==='getelementptr')return rootSlots(row.pointer,seen);
    if(row.kind==='phi')return [...new Set(row.incoming.flatMap(value=>rootSlots(value,seen)))];
    if(row.kind==='load'&&row.pointerResult)return [...new Set(graph.instructions.filter(store=>store.kind==='store'&&store.pointer===row.pointer).flatMap(store=>rootSlots(store.value,seen)))];
    return [];
  };
  return {nodes,blocks,dominates,reaches,allowed,rootSlots};
}

function recursiveOracle(report,fixture,hir,oracle){
  const symbol=name=>'value_'+hir.functions.find(row=>row.name===name).id.slice(7);
  const expected=fixture.members.map(symbol).sort();
  assert.equal(report.functions,expected.length);assert.deepEqual(report.controlFlows.map(row=>row.function).sort(),expected);
  assert.deepEqual({...report.irStages,functions:[...report.irStages.functions].sort()},{mlir:'converted-intermediate',llvm:'finalized',requiresPostExportFinalization:true,finalizer:'tsfg::materializeNativeFloating',selection:'exact-closure',functions:expected});
  const graphs=new Map(report.controlFlows.map(row=>[row.function,row]));
  const aggregate=fixture.target==='valueRecursiveAggregate',valueABI={fields:aggregate?[{integer:32},'f64']:[{integer:32}]};
  for(const name of fixture.members){
    const graph=graphs.get(symbol(name)),flow=graphFacts(graph),{nodes,blocks,dominates,reaches,allowed}=flow;
    const original=oracle.functions.find(row=>row.name===name);
    assert.deepEqual(graph.parameterTypes,[{pointer:0},{pointer:0},valueABI,{integer:8}]);
    assert.deepEqual(graph.resultType,aggregate?valueABI:{integer:32});
    assert.equal(graph.entryPlanes.length,1);const plane=graph.entryPlanes[0];
    assert.equal(plane.argument,2);assert.deepEqual(plane.type,valueABI);assert.equal(plane.freshEachActivation,true);
    const allocation=nodes.get(plane.allocation),entryStore=nodes.get(plane.store);
    assert.equal(allocation.kind,'alloca');assert.equal(allocation.element,'aggregate');assert.equal(allocation.block,0);assert.equal(allocation.slot,plane.slot);
    assert.equal(entryStore.kind,'store');assert.equal(entryStore.block,0);assert.equal(entryStore.pointer,allocation.id);assert.equal(entryStore.value,2);assert.ok(dominates(allocation,entryStore));
    const calls=graph.instructions.filter(row=>row.callee?.startsWith('value_'));assert.equal(calls.length,1);const call=calls[0];
    const calleeName=aggregate?name:name==='valueMutualA'?'valueMutualB':'valueMutualA',callee=graphs.get(symbol(calleeName));
    assert.equal(call.callee,callee.function);assert.deepEqual(call.argumentTypes,callee.parameterTypes);assert.deepEqual(call.returnType,callee.resultType);
    assert.deepEqual(call.scalarOperands.slice(0,2).map(row=>row.id),[0,1],'state and event parameters belong to this activation');
    const callSite=oracle.occurrences.find(row=>row.kind==='call'&&row.name===calleeName&&row.range.start>=original.range.start&&row.range.end<=original.range.end);assert.ok(callSite);
    const entered=graph.instructions.find(row=>row.eventKind===0&&row.eventFunction===callee.sourceIndex);assert.ok(entered);
    assert.deepEqual(entered.eventSource,oracle.functions.find(row=>row.name===calleeName).range);
    const enterGuard=allowed(entered);assert.ok(dominates(entered,call));assert.ok(blocks.get(call.block).dominators.includes(enterGuard.yes));assert.equal(reaches(enterGuard.no,call.block),false,'denied depth entry cannot call recursively');
    const fuel=graph.instructions.filter(row=>row.eventKind===1);assert.equal(fuel.length,1);assert.deepEqual(fuel[0].eventSource,original.range);
    const fuelGuard=allowed(fuel[0]);assert.ok(blocks.get(call.block).dominators.includes(fuelGuard.yes));assert.equal(reaches(fuelGuard.no,call.block),false);
    const completed=graph.instructions.find(row=>row.eventKind===2&&row.eventFunction===graph.sourceIndex&&row.eventSource.start===callSite.range.start&&row.eventSource.end===callSite.range.end&&dominates(call,row));assert.ok(completed);
    const completeGuard=allowed(completed);
    const returns=graph.instructions.filter(row=>row.kind==='ret');assert.ok(returns.length>=2);
    assert.ok(returns.some(row=>reaches(completeGuard.no,row.block)),'failed recursive call propagates through the frame failure return');
    assert.ok(report.copies.filter(row=>row.function===graph.function).every(row=>row.separateStorage&&row.sourceBeforeFreshAllocation&&row.sourceSlots.every(slot=>slot!==row.targetSlot)));
    if(aggregate){
      const resultStores=graph.instructions.filter(row=>row.kind==='store'&&row.value===call.id);assert.equal(resultStores.length,1);const resultStore=resultStores[0],resultPlane=nodes.get(resultStore.pointer);
      assert.equal(resultPlane.kind,'alloca');assert.equal(resultPlane.element,'aggregate');assert.notEqual(resultPlane.slot,plane.slot);
      for(const operation of[resultPlane,resultStore]){assert.ok(dominates(completed,operation));assert.ok(blocks.get(operation.block).dominators.includes(completeGuard.yes));assert.equal(reaches(completeGuard.no,operation.block),false);}
      const nine=oracle.occurrences.find(row=>row.kind==='literal'&&row.text==='9');assert.ok(nine);
      const fieldWrites=graph.instructions.filter(row=>row.kind==='store'&&nodes.get(row.pointer)?.kind==='getelementptr');
      const after=fieldWrites.find(row=>row.scalarOperands[0].width===32&&row.scalarOperands[0].bits===nine.text);assert.ok(after);
      assert.ok(dominates(resultStore,after));assert.ok(blocks.get(after.block).dominators.includes(completeGuard.yes));assert.equal(reaches(completeGuard.no,after.block),false,'failure bypasses caller mutation of the returned aggregate');
      const copies=report.copies.filter(row=>row.function===graph.function),assigned=copies.find(row=>row.sourceSlots.includes(resultPlane.slot));assert.ok(assigned);
      const nineWrite=report.fieldWrites.find(row=>row.function===graph.function&&row.constantBits==='9');assert.ok(nineWrite);assert.equal(nineWrite.rootSlot,assigned.targetSlot);assert.notEqual(nineWrite.rootSlot,plane.slot);
      assert.deepEqual(flow.rootSlots(after.pointer),[nineWrite.rootSlot]);
      const returnedSlots=new Set([nineWrite.rootSlot]),pending=[nineWrite.rootSlot];
      while(pending.length){const slot=pending.pop();for(const copy of copies.filter(row=>row.sourceSlots.includes(slot))){if(!returnedSlots.has(copy.targetSlot)){returnedSlots.add(copy.targetSlot);pending.push(copy.targetSlot);}}}
      assert.ok(returns.some(row=>dominates(after,row)&&nodes.get(row.value)?.kind==='load'&&flow.rootSlots(nodes.get(row.value).pointer).some(slot=>returnedSlots.has(slot))),'normal return loads the recursively returned plane after its caller mutation');
      assert.deepEqual(report.fieldWrites.filter(row=>row.function===graph.function).map(row=>row.constantBits),['7','9']);
      assert.deepEqual(report.layouts.types.find(row=>row.name==='RecursiveFloating').fields.map(row=>row.offset),[0,8]);
      assert.deepEqual(graph.floatingEnvironment,{...graph.floatingEnvironment,active:true,callerEnvironmentReadOnce:true,callbackRestoreAndStrictReestablish:true,allReturnsRestoreCaller:true});
      assert.ok(graph.floatingEnvironment.callbacks>0);assert.ok(graph.floatingEnvironment.returns>=2);
    }
  }
  assert.equal(report.directCalls,expected.length);assert.equal(report.sourceFuelSites,expected.length);
}

for(const fixture of fixtures){
  const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/formal-value-llvm-v3/'+fixture.name+'/'+name,import.meta.url))));
  raw.forEach((bytes,index)=>assert.equal(sha(bytes),fixture.pins[index],'original complete genuine Source input'));
  const source=raw[2].toString('utf8'),oracle=JSON.parse(raw[1].toString('utf8')),hir=projectCommonProgram(readCommonProgramFacts(raw[0]));
  const publication=createCommonProgramPublication(hir),core=emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()});
  cases.set(fixture.name,{hir,core,oracle});
  test('complete recursive Source '+fixture.name+' retains all official functions and anchors',()=>{
    assert.equal(oracle.sourceSha256,sha(raw[2]));assert.deepEqual(oracle.sourceRange,{start:0,end:source.length});assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,source);assert.equal(hir.functions.length,oracle.functions.length);
    for(const original of oracle.functions){const fn=hir.functions.find(row=>row.sourceBinding===original.id);assert.ok(fn);assert.equal(fn.name,original.name);assert.deepEqual(fn.range,original.range);}
    for(const occurrence of oracle.occurrences){if(occurrence.kind==='literal')assert.equal(source.slice(occurrence.range.start,occurrence.range.end),occurrence.text);if(occurrence.kind==='return')assert.equal(source.slice(occurrence.expressionRange.start,occurrence.expressionRange.end),occurrence.expressionText);}
  });
  test('actual recursive call topology, ABI, planes and checkpoints '+fixture.target,{skip:reports?false:'TSFG_VALUE_RECURSION_REPORT_ROOT is not supplied'},async()=>{
    assert.ok(path.isAbsolute(reports));const directory=index[fixture.target];assert.ok(path.isAbsolute(directory));
    const observed=JSON.parse(await fs.readFile(path.join(directory,'observed.json'),'utf8'));assert.equal(observed.qualified,true);assert.deepEqual(observed.first,[]);assert.equal(observed.exit.code,0);assert.equal(observed.close.code,0);
    assert.equal(await fs.readFile(path.join(directory,'raw/stderr.bin'),'utf8'),'');const report=JSON.parse(await fs.readFile(path.join(directory,'raw/stdout.bin'),'utf8'));
    for(const flag of['passed','completeCoreRetained','mlirRoundTrip','sameFinalizedLLVMFromMLIR'])assert.equal(report[flag],true);
    assert.equal(report.functionId,hir.functions.find(row=>row.name===fixture.target).id);assert.equal(report.coreDigest,'sha256:'+sha(core));assert.equal(report.inputIdentity,hir.inputIdentity);assert.equal(report.executionAuthority,false);assert.equal(report.resourceProof,null);
    recursiveOracle(report,fixture,hir,oracle);
    const changedABI=structuredClone(report);changedABI.controlFlows[0].instructions.find(row=>row.callee?.startsWith('value_')).argumentTypes[2]={pointer:0};assert.throws(()=>recursiveOracle(changedABI,fixture,hir,oracle));
    const changedGuard=structuredClone(report),graph=changedGuard.controlFlows[0],event=graph.instructions.find(row=>row.eventKind===0);graph.instructions.find(row=>row.predicate==='ne'&&row.scalarOperands[0].id===event.id).predicate='eq';assert.throws(()=>recursiveOracle(changedGuard,fixture,hir,oracle));
    if(fixture.target==='valueRecursiveAggregate'){
      const wrongPlane=structuredClone(report);wrongPlane.controlFlows[0].entryPlanes[0].allocation=wrongPlane.controlFlows[0].entryPlanes[0].store;assert.throws(()=>recursiveOracle(wrongPlane,fixture,hir,oracle));
      const wrongRoot=structuredClone(report);wrongRoot.fieldWrites.find(row=>row.constantBits==='9').rootSlot=wrongRoot.controlFlows[0].entryPlanes[0].slot;assert.throws(()=>recursiveOracle(wrongRoot,fixture,hir,oracle));
    }
  });
}
  test('complete recursive capability rejection valueRecursiveGc',{skip:reports?false:'TSFG_VALUE_RECURSION_REPORT_ROOT is not supplied'},async()=>{
    const target='valueRecursiveGc';
    assert.ok(path.isAbsolute(reports));const directory=index[target];assert.ok(path.isAbsolute(directory));const observed=JSON.parse(await fs.readFile(path.join(directory,'observed.json'),'utf8'));
    assert.equal(observed.qualified,true);assert.equal(observed.exit.code,3);assert.equal(observed.close.code,3);assert.deepEqual(observed.first,[]);assert.equal((await fs.readFile(path.join(directory,'raw/stdout.bin'))).length,0);
    const stderr=await fs.readFile(path.join(directory,'raw/stderr.bin'),'utf8');assert.match(stderr,/\[core-ir-value-llvm-capability\]/);assert.match(stderr,/operation in the selected closure has no fixed-value lowering/);
    const config=JSON.parse(await fs.readFile(path.join(directory,'config.json'),'utf8'));assert.equal(config.args.length,2);assert.ok(path.isAbsolute(config.args[0]));
      const {hir,core,oracle}=cases.get('value-mutual-recursive'),selected=hir.functions.find(row=>row.name===target),expectedCore=sha(core);
      const original=oracle.functions.find(row=>row.name===target),calls=oracle.occurrences.filter(row=>row.kind==='call'&&row.range.start>=original.range.start&&row.range.end<=original.range.end);
      assert.ok(calls.find(row=>row.name===target).range.end<calls.find(row=>row.name==='allocating').range.start,'the managed callee follows the active recursive edge in genuine Source');
      const expectedRange=oracle.functions.find(row=>row.name==='allocating').range;
    assert.equal(config.args[1],selected.id,'the rejection selects this complete package function');
    const guard=config.sourceGuards.find(row=>row.path===config.args[0]);assert.ok(guard);
    const keys=['dev','ino','mode','nlink','size','mtimeNs','ctimeNs','birthtimeNs'],stat8=async()=>{const s=await fs.stat(config.args[0],{bigint:true});return Object.fromEntries(keys.map(key=>[key,String(s[key])]));};
    assert.deepEqual(await stat8(),guard.current8);assert.equal(sha(await fs.readFile(config.args[0])),expectedCore,'the actual rejected input is the complete genuine Core');assert.deepEqual(await stat8(),guard.current8);
    const anchor=stderr.match(/\(\/src\/main\.ts:(\d+):(\d+)\)/);assert.ok(anchor);assert.ok(Number(anchor[1])>=expectedRange.start&&Number(anchor[2])<=expectedRange.end&&Number(anchor[1])<Number(anchor[2]));
  });
