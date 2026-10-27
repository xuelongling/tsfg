// SPDX-License-Identifier: MIT
// Whole Source and normalized boundary controls have separate authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {i32TypeId} from '../../compiler/identity.mjs';
import {commonRegions,emptyRegionValue} from '../../compiler/common-program-regions.mjs';
import {closedLoopFactoryModel as closed} from './common-program-loop-models.mjs';

const pending=/** @param {any} error */error=>error.code==='r03-common-program-borrow-pending';
test('whole official Source consumes a self-held readonly closure through ReaderBox.reader',()=>{
  const bytes=readFileSync(new URL('./testdata/common-loop-local-factory/readonly-field-held-safe.json',import.meta.url)),
    hir=projectCommonProgram(readCommonProgramFacts(bytes)),publication=createCommonProgramPublication(hir),
    request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  assert.ok(emitCommonProgramCore(hir,publication,request).includes('tsfg_program.field_store'));
});
for(const mode of ['old-field','old-field-after-new'])test('a readonly whole closure keeps its own owner in an ordinary field: '+mode,()=>{
  const model=closed(mode);
  if(mode.endsWith('after-new')){
    const root=model.program.plans.find(p=>p.owner.id===model.root),created=model.factoryCalls[1],
      completed=root.graph.blocks.find(b=>b.name===created.successors[0]);
    assert.equal(completed.instructions.at(-1),model.readerCalls[0]);
    assert.equal(model.readerCalls[0].operands[0],model.oldLoad.name);
  }
  assert.ok(analyzeCommonGraphs(model.program,model.records).actual.borrows);
});
for(const mode of ['old-field','old-field-after-new'])test('a writable captured graph retains its conservative field boundary: '+mode,()=>{
  const model=closed(mode,true);assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
test('an unobserved global-read arm stays a hard boundary after a field load loses region roots',()=>{
  const model=closed('old-field'),{model:m,plans}=model.program,id='fieldReaderB',range={start:800,end:809},
    owner={id,name:id,sourceBinding:id,kind:'source',sourcePath:'/field-model.ts',range,signatureHash:'unit:signature',
      parameters:[],returnType:i32TypeId,lexicalParent:model.factory,lexicalEnvironment:null,activationEnvironment:null},
    graph=createCommonGraph(m,owner),entry=graph.newBlock(),zero=graph.emit(entry,'constant',[],i32TypeId,{decimal:'0',token:'0'},range),
    global={id:'fieldGlobal',sourceBinding:'fieldGlobal/binding',type:i32TypeId,writable:true};
  graph.terminal(entry,'func.return',[zero],[],{},range);
  m.functions.set(id,owner);plans.push({owner,graph,entry,parameters:[],returnType:i32TypeId});
  m.callables.summaries.set(id,{parameters:new Map()});m.globals.set(global.id,global);m.hir.globals.push(global);
  m.bindings.set(global.sourceBinding,{id:global.sourceBinding,type:i32TypeId,role:'global'});
  m.hir.functions=[...m.functions.values()];
  model.records.set(id,{upper:{parameters:[],captures:[],globals:{reads:[global.id],writes:[]},
    facets:{unknownHost:false,escape:false,await:false,lock:false}}});
  model.readerCalls[0].properties.targets.functions.push({function_id:id,signature_hash:'unit:signature'});
  assert.equal(model.readerCalls[0].operands[0],model.oldLoad.name);
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
test('a raw owner stored through a receiver with no actual refs cannot escape its factory',()=>{
  const model=closed('old-field'),{model:m,plans}=model.program,
    factory=plans.find(p=>p.owner.id===model.factory),block=factory.entry,range={start:820,end:829},
    unknown={id:'field:unknown',kind:'unknown'},holder={id:'field:unknown-holder',kind:'reference',fields:[],methods:[]},
    owner=block.instructions.find(op=>op.name==='tsfg_program.array_create'),
    field={id:'field:exposed-array',sourceBinding:'field:exposed-array',name:'array',type:owner.view},
    global={id:'field:unknown-global',sourceBinding:'field:unknown-global',type:unknown.id,writable:true};
  holder.fields.push(field);for(const t of [unknown,holder]){m.types.set(t.id,t);m.hir.types.push(t);}
  m.fields.set(field.id,field);m.bindings.set(field.sourceBinding,{id:field.sourceBinding,type:field.type,role:'field'});
  m.globals.set(global.id,global);m.hir.globals.push(global);
  m.bindings.set(global.sourceBinding,{id:global.sourceBinding,type:unknown.id,role:'global'});
  model.records.get(model.factory).upper.globals.reads.push(global.id);
  const returned=block.instructions.pop();block.terminated=false;
  const opaque=factory.graph.emit(block,'global_load',[],unknown.id,{global:global.id},range),
    receiver=factory.graph.emit(block,'view',[opaque],holder.id,{target:holder.id},range);
  factory.graph.emit(block,'field_store',[receiver,{name:owner.result,type:owner.view}],null,{field:field.id,initialize:false},range);
  block.instructions.push(returned);block.terminated=true;
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
test('an opaque stored owner needs outward raw invalidation even in a current receiver',()=>{
  const regions=commonRegions(()=>{}),heap=new Map(),aScope=regions.scope('array-origin','a'),bScope=regions.scope('holder-origin','b');
  regions.allocate(aScope,'a','raw/original-array','array',heap);
  const receiver=regions.allocate(bScope,'b','raw/current-holder','holder',heap),lost=emptyRegionValue();lost.opaque=true;
  assert.equal(regions.scopes.get(aScope).hardBlocked,false);
  const outward=regions.store(receiver,'field/array',lost,heap,true);
  if(outward)regions.hardRaw(new Set(['raw/original-array']));
  assert.equal(outward,true);assert.equal(regions.scopes.get(aScope).hardBlocked,true);
  assert.equal(regions.load(receiver,'field/array',heap).opaque,true,'outward marking cannot repair the stored relation');
});
