// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reports=process.env.TSFG_VALUE_BOTTOM_REPORT_ROOT;
const index=reports?JSON.parse(await fs.readFile(path.join(reports,'index.json'),'utf8')):null;
const fixtures=[
  {name:'value-recursive',targets:[{key:'valueRecursiveBottom',name:'valueRecursive',members:['valueRecursive']}],pins:['3f3f35517e3bc0ec7707ceb9a0d7798beda22bd7446e3664fe30dae7ca9fbcd9','b4a3ed4a6ea8f4b31bdcef9aa140aa390666b6e3d92a01fe6e643c3cfd33e111','affdd7a4149ff82005e31598cea7756d18fc244f3474f21541854b61d5b09ec4']},
  {name:'value-bottom-normal',targets:[{key:'mutualBottomA',name:'mutualBottomA',members:['mutualBottomA','mutualBottomB']},{key:'mixedBottom',name:'mixedBottom',members:['mixedBottom','mutualBottomA','mutualBottomB']}],pins:['fb7f1184415ed7606db0a978274dcf7b148cecfd5788f75d6591e1b616791def','b33be5beef3887006127e4c29607ddb4a34efca53bbca143efbd69439c5a9f63','4bf68b04b1a16e97924c3290850243b2f6729fd749c810f335b6daeae3829b7d']}
];
const cases=new Map();

function bottomOracle(report,target,context){
  const {hir,module,oracle}=context,functions=new Map(hir.functions.map(row=>[row.name,row]));
  const expected=target.members.map(name=>'value_'+functions.get(name).id.slice(7)).sort();
  assert.equal(report.functions,expected.length);assert.deepEqual(report.controlFlows.map(row=>row.function).sort(),expected);
  assert.deepEqual(report.irStages.functions.slice().sort(),expected);assert.equal(report.irStages.selection,'exact-closure');
  assert.equal(report.irStages.requiresPostExportFinalization,true);assert.equal(report.irStages.mlir,'converted-intermediate');assert.equal(report.irStages.llvm,'finalized');
  assert.equal(report.physicalCFG.length,expected.length);
  assert.doesNotMatch(report.llvm,/\b(?:undef|poison|unreachable)\b/);
  const graphs=new Map(report.controlFlows.map(row=>[row.function,row]));
  for(const name of target.members){
    const fn=functions.get(name),symbol='value_'+fn.id.slice(7),graph=graphs.get(symbol),mixed=name==='mixedBottom';
    const actual=module.representation.functions.find(row=>row.id===fn.id),domain=module.representation.domains.find(row=>row.id===actual.result);
    const physical=report.physicalCFG.find(row=>row.functionId===fn.id);assert.ok(physical);assert.equal(physical.resultCarrier,actual.result);assert.equal(physical.emptyNormalResult,!mixed);
    if(mixed){assert.equal(domain,undefined);assert.equal(hir.types.find(row=>row.id===actual.result).name,'i32');assert.deepEqual(graph.resultType,{integer:32});}
    else{
      assert.deepEqual(domain,{id:actual.result,actualTypes:[],representation:'bottom',tagBytes:0,alignment:1,byteSize:0,referenceCount:0});
      assert.equal(hir.types.find(row=>row.id===fn.returnType).name,'i32','the declared view remains separate from the actual empty result');
      assert.equal(graph.resultType,'void');
    }
    const start=module.text.indexOf('  func.func @"program_'+fn.id.slice(7)+'"');assert.ok(start>=0);
    const body=module.text.slice(start,module.text.indexOf('\n  }',start));
    const originalBlocks=[0,...Array.from(body.matchAll(/^\s*\^bb(\d+)[(:]/gm),match=>Number(match[1]))];
    const invokes=body.split('\n').filter(line=>line.includes('"tsfg_program.invoke"'));assert.equal(invokes.length,1);
    const edges=invokes[0].match(/\[\^bb(\d+),\s*\^bb(\d+)\]/);assert.ok(edges);
    assert.deepEqual(physical.blocks.slice().sort((a,b)=>a-b),originalBlocks.filter(id=>id!==Number(edges[1])&&id!==Number(edges[2])).sort((a,b)=>a-b),'only the empty normal and existing exceptional continuation are excluded from physical emission');
    const nodes=new Map(graph.instructions.map(row=>[row.id,row])),blocks=new Map(graph.blocks.map(row=>[row.id,row]));
    const dominates=(before,after)=>before.block===after.block?before.id<after.id:blocks.get(after.block).dominators.includes(before.block);
    const reaches=(from,to)=>{const pending=[from],seen=new Set();while(pending.length){const at=pending.pop();if(at===to)return true;if(seen.has(at))continue;seen.add(at);pending.push(...blocks.get(at).successors);}return false;};
    const allowed=event=>{
      const comparison=graph.instructions.find(row=>row.predicate==='ne'&&row.scalarOperands[0].id===event.id&&row.scalarOperands[1].width===32&&row.scalarOperands[1].bits==='0');assert.ok(comparison);
      const branch=graph.instructions.find(row=>row.kind==='br'&&row.condition===comparison.id);assert.ok(branch);assert.ok(dominates(event,branch));
      const successors=blocks.get(branch.block).successors;assert.equal(successors.length,2);return {yes:successors[0],no:successors[1]};
    };
    const direct=graph.instructions.filter(row=>row.callee?.startsWith('value_'));assert.equal(direct.length,1);const call=direct[0],callee=graphs.get(call.callee);assert.ok(callee);
    const calleeName=mixed?'mutualBottomA':name==='mutualBottomA'?'mutualBottomB':name==='mutualBottomB'?'mutualBottomA':'valueRecursive';
    assert.equal(call.callee,'value_'+functions.get(calleeName).id.slice(7));assert.equal(call.returnType,'void');assert.equal(callee.resultType,'void');
    assert.deepEqual(call.argumentTypes,callee.parameterTypes);assert.deepEqual(call.argumentTypes,[{pointer:0},{pointer:0},{fields:[{integer:32}]}]);
    assert.deepEqual(call.scalarOperands.slice(0,2).map(row=>row.id),[0,1]);
    assert.ok(graph.instructions.every(row=>row.scalarOperands.every(operand=>operand.id!==call.id)),'a void call never supplies a fabricated normal SSA operand');
    assert.deepEqual(graph.parameterTypes,[{pointer:0},{pointer:0},{fields:[{integer:32}]},...(mixed?[{integer:8}]:[])]);
    assert.equal(graph.entryPlanes.length,1);const plane=graph.entryPlanes[0];assert.equal(plane.argument,2);assert.equal(plane.freshEachActivation,true);
    const allocation=nodes.get(plane.allocation),stored=nodes.get(plane.store);assert.equal(allocation.kind,'alloca');assert.equal(allocation.block,0);assert.equal(allocation.slot,plane.slot);assert.equal(stored.pointer,allocation.id);assert.equal(stored.value,2);assert.ok(dominates(allocation,stored));
    const original=oracle.functions.find(row=>row.name===name),site=oracle.occurrences.find(row=>row.kind==='call'&&row.name===calleeName&&row.range.start>=original.range.start&&row.range.end<=original.range.end);assert.ok(site);
    const entry=graph.instructions.find(row=>row.eventKind===0&&row.eventFunction===callee.sourceIndex);assert.ok(entry);assert.deepEqual(entry.eventSource,oracle.functions.find(row=>row.name===calleeName).range);
    const enterGuard=allowed(entry);assert.ok(blocks.get(call.block).dominators.includes(enterGuard.yes));assert.equal(reaches(enterGuard.no,call.block),false);
    const fuel=graph.instructions.filter(row=>row.eventKind===1);assert.equal(fuel.length,1);assert.deepEqual(fuel[0].eventSource,original.range);const fuelGuard=allowed(fuel[0]);assert.ok(blocks.get(call.block).dominators.includes(fuelGuard.yes));assert.equal(reaches(fuelGuard.no,call.block),false);
    const post=graph.instructions.find(row=>row.eventKind===2&&row.eventFunction===graph.sourceIndex&&row.eventSource.start===site.range.start&&row.eventSource.end===site.range.end&&dominates(call,row));assert.ok(post);const postGuard=allowed(post);
    const returns=graph.instructions.filter(row=>row.kind==='ret');assert.equal(returns.length,mixed?2:1);
    const failed=mixed?returns.find(row=>row.scalarOperands[0]?.width===32&&row.scalarOperands[0].bits==='0'):returns[0];assert.ok(failed);
    assert.ok(reaches(postGuard.yes,failed.block));assert.ok(reaches(postGuard.no,failed.block),'both postcall outcomes retain the original failure unwind');
    if(mixed){
      const normal=returns.find(row=>row!==failed);assert.equal(nodes.get(normal.value).kind,'load');assert.equal(nodes.get(normal.value).width,32);
      assert.equal(reaches(call.block,normal.block),false,'the bottom branch cannot return a normal scalar');
      assert.equal(reaches(0,normal.block),true,'the genuine initialized field branch still returns');
      const fieldLoad=nodes.get(normal.value),address=nodes.get(fieldLoad.pointer);assert.equal(address.kind,'getelementptr');assert.deepEqual(address.scalarOperands.slice(1).map(row=>row.bits),['0','0']);
      const rootSlots=(id,seen=new Set())=>{
        if(seen.has(id))return [];seen.add(id);const row=nodes.get(id);if(!row)return [];
        if(row.kind==='alloca')return [row.slot];
        if(row.kind==='getelementptr')return rootSlots(row.pointer,seen);
        if(row.kind==='phi')return [...new Set(row.incoming.flatMap(value=>rootSlots(value,seen)))];
        if(row.kind==='load'&&row.pointerResult)return [...new Set(graph.instructions.filter(store=>store.kind==='store'&&store.pointer===row.pointer).flatMap(store=>rootSlots(store.value,seen)))];
        return [];
      };
      assert.deepEqual(rootSlots(address.id),[plane.slot],'the normal value loads the original parameter plane');
      const field=hir.types.find(row=>row.name==='Delta').fields[0],officialField=oracle.classes.find(row=>row.name==='Delta').fields[0];assert.equal(field.name,'n');assert.equal(officialField.name,'n');assert.deepEqual({start:field.origin.start,end:field.origin.end},officialField.range);assert.ok(body.includes(field.id));
      const read=report.fieldReads.filter(row=>row.function===symbol);assert.equal(read.length,1);assert.deepEqual(read[0].indices,[0,0]);assert.equal(read[0].rootSlot,plane.slot);
      const flagStore=graph.instructions.find(row=>row.kind==='store'&&row.value===3),flagLoad=graph.instructions.find(row=>row.kind==='load'&&row.width===8&&row.pointer===flagStore.pointer);assert.ok(flagLoad);
      const condition=graph.instructions.find(row=>row.predicate==='ne'&&row.scalarOperands[0].id===flagLoad.id&&row.scalarOperands[1].width===8&&row.scalarOperands[1].bits==='0');assert.ok(condition);
      const branch=graph.instructions.find(row=>row.kind==='br'&&row.condition===condition.id);assert.ok(branch);const successors=blocks.get(branch.block).successors;
      assert.equal(reaches(successors[0],call.block),true);assert.equal(reaches(successors[1],call.block),false);assert.equal(reaches(successors[0],normal.block),false);assert.equal(reaches(successors[1],normal.block),true);
    }else{
      assert.equal(failed.scalarOperands.length,0);assert.equal('value' in failed,false);
      assert.ok(graph.instructions.filter(row=>reaches(postGuard.yes,row.block)).every(row=>row.kind!=='alloca'&&row.kind!=='store'),'empty normal continuation adds no value storage or write');
    }
  }
  assert.equal(report.directCalls,expected.length);assert.equal(report.sourceFuelSites,expected.length);
}

for(const fixture of fixtures){
  const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/formal-value-llvm-v3/'+fixture.name+'/'+name,import.meta.url))));
  raw.forEach((bytes,index)=>assert.equal(sha(bytes),fixture.pins[index]));
  const source=raw[2].toString('utf8'),oracle=JSON.parse(raw[1].toString('utf8')),hir=projectCommonProgram(readCommonProgramFacts(raw[0])),publication=createCommonProgramPublication(hir);
  const module=commonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()}),context={hir,module,oracle};cases.set(fixture.name,context);
  test('complete bottom-normal Source '+fixture.name+' preserves actual domains and all original functions',()=>{
    assert.equal(oracle.sourceSha256,sha(raw[2]));assert.deepEqual(oracle.sourceRange,{start:0,end:source.length});assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,source);assert.equal(hir.functions.length,oracle.functions.length);
    for(const original of oracle.functions){const fn=hir.functions.find(row=>row.sourceBinding===original.id);assert.ok(fn);assert.equal(fn.name,original.name);assert.deepEqual(fn.range,original.range);}
    for(const occurrence of oracle.occurrences){if(occurrence.kind==='literal')assert.equal(source.slice(occurrence.range.start,occurrence.range.end),occurrence.text);if(occurrence.kind==='return')assert.equal(source.slice(occurrence.expressionRange.start,occurrence.expressionRange.end),occurrence.expressionText);}
  });
  for(const target of fixture.targets)test('actual no-payload bottom lowering '+target.key,{skip:reports?false:'TSFG_VALUE_BOTTOM_REPORT_ROOT is not supplied'},async()=>{
    assert.ok(path.isAbsolute(reports));const directory=index[target.key];assert.ok(path.isAbsolute(directory));
    const observed=JSON.parse(await fs.readFile(path.join(directory,'observed.json'),'utf8'));assert.equal(observed.qualified,true);assert.equal(observed.exit.code,0);assert.equal(observed.close.code,0);assert.deepEqual(observed.first,[]);
    assert.equal(await fs.readFile(path.join(directory,'raw/stderr.bin'),'utf8'),'');const report=JSON.parse(await fs.readFile(path.join(directory,'raw/stdout.bin'),'utf8'));
    for(const flag of['passed','completeCoreRetained','mlirRoundTrip','sameFinalizedLLVMFromMLIR'])assert.equal(report[flag],true);
    assert.equal(report.functionId,hir.functions.find(row=>row.name===target.name).id);assert.equal(report.coreDigest,'sha256:'+sha(module.text));assert.equal(report.inputIdentity,hir.inputIdentity);assert.equal(report.executionAuthority,false);assert.equal(report.resourceProof,null);
    bottomOracle(report,target,context);
    const wrongABI=structuredClone(report);wrongABI.controlFlows.find(row=>row.resultType==='void').resultType={integer:32};assert.throws(()=>bottomOracle(wrongABI,target,context));
    const wrongCFG=structuredClone(report);wrongCFG.physicalCFG.find(row=>row.emptyNormalResult).blocks.push(1);assert.throws(()=>bottomOracle(wrongCFG,target,context));
    const fabricated=structuredClone(report),graph=fabricated.controlFlows.find(row=>row.resultType==='void');graph.instructions.find(row=>row.kind==='ret').scalarOperands=[{id:-1,width:32,bits:'0'}];assert.throws(()=>bottomOracle(fabricated,target,context));
    if(target.name==='mixedBottom'){
      const wrongRoot=structuredClone(report),mixed=wrongRoot.controlFlows.find(row=>row.parameterTypes.length===4),nodes=new Map(mixed.instructions.map(row=>[row.id,row]));
      const returned=mixed.instructions.find(row=>row.kind==='ret'&&row.value>=0),load=nodes.get(returned.value),address=nodes.get(load.pointer),entry=mixed.entryPlanes[0],block=mixed.blocks.find(row=>row.id===returned.block);
      const other=mixed.instructions.find(row=>row.kind==='alloca'&&row.slot!==entry.slot&&block.dominators.includes(row.block));assert.ok(other);address.pointer=other.id;assert.throws(()=>bottomOracle(wrongRoot,target,context));
    }
  });
}

test('full original closure rejects the managed member after a bottom normal edge',{skip:reports?false:'TSFG_VALUE_BOTTOM_REPORT_ROOT is not supplied'},async()=>{
  const {hir,module,oracle}=cases.get('value-bottom-normal'),selected=hir.functions.find(row=>row.name==='bottomManaged'),original=oracle.functions.find(row=>row.name==='bottomManaged');
  const calls=oracle.occurrences.filter(row=>row.kind==='call'&&row.range.start>=original.range.start&&row.range.end<=original.range.end);
  assert.ok(calls.find(row=>row.name==='mutualBottomA').range.end<calls.find(row=>row.name==='allocating').range.start);
  const directory=index.bottomManaged;assert.ok(path.isAbsolute(directory));const observed=JSON.parse(await fs.readFile(path.join(directory,'observed.json'),'utf8')),config=JSON.parse(await fs.readFile(path.join(directory,'config.json'),'utf8'));
  assert.equal(observed.qualified,true);assert.equal(observed.exit.code,3);assert.equal(observed.close.code,3);assert.deepEqual(observed.first,[]);assert.equal(config.args.length,2);assert.equal(config.args[1],selected.id);
  const input=config.args[0],guard=config.sourceGuards.find(row=>row.path===input);assert.ok(guard);const keys=['dev','ino','mode','nlink','size','mtimeNs','ctimeNs','birthtimeNs'];
  const stat8=async()=>{const s=await fs.stat(input,{bigint:true});return Object.fromEntries(keys.map(key=>[key,String(s[key])]));};
  assert.deepEqual(await stat8(),guard.current8);assert.equal(sha(await fs.readFile(input)),sha(module.text));assert.deepEqual(await stat8(),guard.current8);
  assert.equal((await fs.readFile(path.join(directory,'raw/stdout.bin'))).length,0);const stderr=await fs.readFile(path.join(directory,'raw/stderr.bin'),'utf8');assert.match(stderr,/\[core-ir-value-llvm-capability\] operation in the selected closure has no fixed-value lowering/);
  const anchor=stderr.match(/\(\/src\/main\.ts:(\d+):(\d+)\)/),callee=oracle.functions.find(row=>row.name==='allocating');assert.ok(anchor);assert.ok(Number(anchor[1])>=callee.range.start&&Number(anchor[2])<=callee.range.end&&Number(anchor[1])<Number(anchor[2]));
});
