// SPDX-License-Identifier: MIT
// Whole Source is independent of the normalized lifetime boundary controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {closedLoopFactoryModel as closed} from './common-program-loop-models.mjs';
import {i32TypeId} from '../../compiler/identity.mjs';

const pending=/** @param {any} error */error=>error.code==='r03-common-program-borrow-pending';
test('whole official Source consumes its self-held readonly closure after feedback and exit',()=>{
  const source=readFileSync(new URL('./testdata/common-loop-local-factory/loop-carried-held-safe.json',import.meta.url)),
    hir=projectCommonProgram(readCommonProgramFacts(source)),publication=createCommonProgramPublication(hir),
    request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  assert.ok(emitCommonProgramCore(hir,publication,request).includes('tsfg_program.invoke_indirect'));
});
for(const mode of ['old-cell','old-cell-after-new','live-break'])test('readonly closed original owner survives local transport: '+mode,()=>{
  const model=closed(mode);
  if(mode==='old-cell-after-new'){
    const root=model.program.plans.find(p=>p.owner.id===model.root),created=model.factoryCalls[1],
      completed=root.graph.blocks.find(b=>b.name===created.successors[0]);
    assert.equal(completed.instructions.at(-1),model.readerCalls[0]);
    assert.equal(model.readerCalls[0].operands[0],model.oldLoad.name);
  }
  const flow=analyzeCommonGraphs(model.program,model.records);
  assert.ok(flow.actual.borrows);
  const contexts=[...flow.actual.contexts.values()].filter(c=>!c.root&&c.plan.owner.id===model.factory&&c.regionScope);
  assert.ok(contexts.length>0);
  for(const c of contexts)for(const pair of c.returned.pairs.values())assert.equal(flow.actual.objects.get(pair.environment).weak,true);
});
for(const mode of ['old-cell','old-cell-after-new','live-break'])test('writable captured storage retains its conservative capability boundary: '+mode,()=>{
  const model=closed(mode,true);assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
for(const effect of ['write','structural','unknownHost'])test('full returned reader upper cannot authorize readonly holding: '+effect,()=>{
  const model=closed('live-break'),upper=model.records.get(model.reader).upper;
  if(effect==='unknownHost')upper.facets.unknownHost=true;
  else upper.captures.push({slot:model.ownerSlot,read:true,write:effect==='write',structural:effect==='structural'});
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
test('an unconnected allowed return code cannot disappear from the sealed reader table',()=>{
  const model=closed('live-break');model.records.get(model.factory).callables.returns.functions.push('not-observed-reader');
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
test('an uncalled cyclic reader still needs complete return-code eligibility',()=>{
  const model=closed('live-break'),root=model.program.plans.find(p=>p.owner.id===model.root),
    reader=model.program.plans.find(p=>p.owner.id===model.reader),range={start:700,end:709};
  // Transport the returned closure through the live exit without calling it.
  // Its independent allowed code has a real CFG cycle, despite a readonly upper.
  for(const call of model.readerCalls){
    const block=root.graph.blocks.find(b=>b.instructions.includes(call));block.instructions.pop();block.terminated=false;
    for(const target of call.successors)root.graph.blocks.find(b=>b.name===target).incoming--;
    if(block.name===model.done)root.graph.emit(block,'view',[{...block.parameters[0]}],'unit:Callable',{target:'unit:Callable'},range);
    const zero=root.graph.emit(block,'constant',[],i32TypeId,{decimal:'0',token:'0'},range),next=root.graph.blocks.find(b=>b.name===call.successors[0]);
    root.graph.branch(block,next,[zero],range);
  }
  reader.entry.instructions.length=0;reader.entry.terminated=false;
  reader.graph.branch(reader.entry,reader.entry,reader.entry.parameters.map(p=>({...p})),range);
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
