// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {selectedCaptureModel} from './common-program-selected-capture-models.mjs';
test('normalized selected capture B modification preserves unrelated live A Span',()=>{
  const {program,records}=selectedCaptureModel();analyzeCommonGraphs(program,records);
});
for(const name of ['selected-b-safe','selected-b-conflict','alternative-env-conflict','parent-selected-b-safe','mutable-selected-b-safe'])test('official whole Program selected capture effects '+name,()=>{
  const hir=projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./testdata/common-selected-captures/'+name+'.json',import.meta.url)))),
    publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  if(name.endsWith('conflict'))assert.throws(()=>emitCommonProgramCore(hir,publication,request),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict'&&e.primary.sourceId===hir.rootFile);
  else assert.match(emitCommonProgramCore(hir,publication,request),/tsfg_program.env_load/);
});
for(const mode of ['selected','may'])test('normalized selected capture effects preserve actual owner overlap: '+mode,()=>{
  const {program,records}=selectedCaptureModel(mode);
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict');
});
for(const boundary of ['unmatched-target','TOP','unknownHost'])test('normalized selected capture keeps the full fixed boundary: '+boundary,()=>{
  const {program,records}=selectedCaptureModel(),{model,plans}=program,reader=plans.find(p=>p.owner.id==='leftFactory/reader'),
    call=plans.find(p=>p.owner.id==='chooser').graph.blocks.flatMap(b=>b.instructions).find(op=>op.name==='tsfg_program.invoke_indirect');
  if(boundary==='TOP')call.properties.targets.top=true;
  else if(boundary==='unknownHost')records.get(reader.owner.id).upper.facets.unknownHost=true;
  else{
    // Isolate the unconnected target: the known B arm has no live captured
    // Span read that could independently justify a conservative entry conflict.
    const read=reader.graph.blocks.flatMap(b=>b.instructions).find(op=>op.name==='tsfg_program.array_read');
    read.name='tsfg_program.constant';read.operands=[];read.properties={decimal:'1',token:'1'};
    const owner={...reader.owner,id:'unconnectedReader',name:'unconnectedReader',sourceBinding:'unconnectedReader'},
      parameters=reader.parameters.map(p=>({...p,id:'unconnectedReader/lexical'}));
    plans.push({...reader,owner,parameters});model.functions.set(owner.id,owner);
    for(const p of parameters)model.bindings.set(p.id,{...p,role:'parameter'});
    records.set(owner.id,{upper:JSON.parse(JSON.stringify(records.get(reader.owner.id).upper))});
    model.callables.summaries.set(owner.id,{parameters:new Map()});model.hir.functions=[...model.functions.values()];
    call.properties.targets.functions.push({function_id:owner.id,signature_hash:'unit:signature'});
  }
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
function environmentFixture(spend=commonMeter()){
  const parent={id:'P',parent:null,slots:[{key:'slot'}]},child={id:'C',parent:'P',slots:[]},
    model={spend,types:new Map([['array',{id:'array',kind:'array',elementType:'i32'}]]),environments:new Map([['P',parent],['C',child]])},a=commonAbstract(model),
    refs=(tag,ids)=>{const value=a.literal(tag);for(const id of ids)value.refs.add(id);return value;},
    objects=new Map([['p1',{type:'env:P',weak:true}],['p2',{type:'env:P',weak:true}],['missing',{type:'env:P',weak:true}],['child',{type:'env:C',weak:true}]]),
    heap=new Map([['p1/slot/slot',refs('array',['A'])],['p2/slot/slot',refs('array',['B'])],['child/parent',refs('env:P',['p1'])]]);
  return {a,refs,objects,heap,read:(value,start='P')=>a.environmentSlot(value,start,'P','slot',heap,objects)};
}
test('typed environment query follows parent and preserves weak alternatives',()=>{
  const f=environmentFixture(),parent=f.read(f.refs('env:C',['child']),'C'),both=f.read(f.refs('env:P',['p1','p2']));
  assert.equal(parent.complete,true);assert.deepEqual([...parent.value.refs],['A']);
  assert.equal(both.complete,true);assert.deepEqual([...both.value.refs].sort(),['A','B']);
});
test('typed environment query keeps known values when another address is missing',()=>{
  const f=environmentFixture(),value=f.read(f.refs('env:P',['p1','missing']));
  assert.equal(value.complete,false);assert.deepEqual([...value.value.refs],['A']);
  value.value.refs.clear();assert.deepEqual([...f.heap.get('p1/slot/slot').refs],['A']);
});
test('typed environment query separates stored unknown from an absent address',()=>{
  const f=environmentFixture(),unknown=f.a.empty();unknown.unknown=true;f.heap.set('p1/slot/slot',unknown);
  const value=f.read(f.refs('env:P',['p1']));assert.equal(value.complete,true);assert.equal(value.valid,true);assert.equal(value.value.unknown,true);
  assert.equal(f.read(f.refs('env:P',['missing'])).complete,false);
});
test('typed environment query rejects a mismatched parent type without dropping known references',()=>{
  const f=environmentFixture();f.heap.set('child/parent',f.refs('env:wrong',['p1']));
  const value=f.read(f.refs('env:C',['child']),'C');assert.equal(value.valid,false);assert.equal(value.complete,false);assert.deepEqual([...value.value.refs],['A']);
});
for(const reason of ['budget','cancel'])test('typed environment query propagates '+reason+' before traversal',()=>{
  let armed=false;const aborted=new Error(reason),meter=commonMeter(1),f=environmentFixture((n=1)=>{if(!armed)return;if(reason==='cancel')throw aborted;meter(n);});
  const selected=f.refs('env:P',['p1']);armed=true;
  assert.throws(()=>f.read(selected),/** @param {any} e */e=>reason==='cancel'?e===aborted:e.code==='r03-common-program-limit');
});
