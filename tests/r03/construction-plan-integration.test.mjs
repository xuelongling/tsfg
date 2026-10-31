// SPDX-License-Identifier: MIT
// Real typed model -> one plan inventory -> one actual solver -> carriers.
// These literal records do not assert whole Source/Facts or Core admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonConstructionPlans,requireCommonCoreConstructionPlans,commonPublicCoreRepresentation,combineCommonConstructionCoverage} from '../../compiler/common-program-construction-plans.mjs';
import {commonConstructionPhysical} from '../../compiler/common-program-physical.mjs';
import {planCommonFunction} from '../../compiler/common-program-control.mjs';
import {printCommonFunction} from '../../compiler/common-program-print.mjs';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonMethods} from '../../compiler/common-program-methods.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonPublicObservationContexts} from '../../compiler/common-program-observation-contexts.mjs';
import {i32TypeId,sha256} from '../../compiler/identity.mjs';
import {signatureId} from '../../compiler/module-callable-common.mjs';
const B='literal:B',D='literal:D',F='literal:F',absent=sha256('tsfg.type\0undefined'),voidId=sha256('tsfg.type\0void'),range={start:0,end:1},origin={source:'/plan-literal.ts',...range};
const num=()=>({kind:'numericLiteral',type:i32TypeId,token:'1',decimal:'1',range});
const field=(owner,name,initializer=null)=>({id:owner+'/'+name,sourceBinding:owner+'/'+name,name,type:i32TypeId,origin:range,...(initializer?{initializer}:{})});
function nominal(id,fields=[],base=null,parameters=[]){return {id,kind:'reference',fields,methods:[],...(base?{base}:{}),
  construction:{id:id+'/ctor',kind:base?'implicit-derived':'implicit-base',functionId:null,origin,parameters,initializationFields:fields.map(f=>f.id),
    signature:{parameters:parameters.map(p=>p.type),returnType:id},implicitForward:base?{target:base+'/ctor'}:null}};}
const parameter=(id,type)=>({id,name:id,type,kind:'parameter',writable:true,range,nameRange:range});
function owner(id,returnType,body,parameters=[],ownerType=null){return {id,name:id,kind:ownerType?'construction-body':'source',ownerType,sourceBinding:id,returnType,parameters,bindings:[],body,
  receiverBinding:ownerType?'this:'+id:null,sourcePath:origin.source,range,nameRange:range,signatureHash:signatureId({parameters:parameters.map(p=>p.type),returns:returnType}),captures:[],lexicalParent:null,lexicalEnvironment:null,activationEnvironment:null};}
const create=(type,args=[])=>({kind:'new',type:type.id,callee:type.id,construction:type.construction.id,range,signature:type.construction.signature,arguments:args});
const returned=value=>({kind:'return',range,value});
function model(owned,owners){
  const rows=[{id:i32TypeId,kind:'scalar',name:'i32'},{id:absent,kind:'undefined'},{id:voidId,kind:'void'},...owned],
    spend=commonMeter(1000000),types=new Map(rows.map(row=>[row.id,row])),fields=new Map(),bindings=new Map();
  for(const type of rows)for(const row of type.fields??[]){fields.set(row.id,{...row,owner:type.id});bindings.set(row.sourceBinding,{id:row.sourceBinding,type:row.type,role:'field'});}
  for(const fn of owners){for(const p of fn.parameters)bindings.set(p.id,{...p,role:'parameter',owner:fn.id});
    if(fn.ownerType)bindings.set(fn.receiverBinding,{id:fn.receiverBinding,type:fn.ownerType,role:'receiver',range});}
  const hir={types:rows,functions:owners,globals:[],modules:[],environments:[],hostImports:[],hostContext:null,
    snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[]}};
  return {hir,types,fields,bindings,functions:new Map(owners.map(fn=>[fn.id,fn])),globals:new Map(),environments:new Map(),hosts:new Map(),slots:new Map(),
    spend,callables:commonTargets(hir,spend),methods:commonMethods(hir,spend),schema:'literal:private4',payload:'payload:literal:private4',cell:id=>'cell:'+id,
    limits:{parameters:64,registersPerFunction:4096,blocksPerFunction:256,instructionsPerFunction:8192,bytes:8388608,work:1000000}};
}
const physical=program=>commonConstructionPhysical(program,null,{borrowProof:false,storageAuthoring:true});
const instructions=plan=>plan.graph.blocks.flatMap(block=>block.instructions);
function assertDefined(program){const ids=new Set(program.plans.map(plan=>plan.owner.id));assert.equal(ids.size,program.plans.length);
  for(const plan of program.plans)for(const op of instructions(plan))if(op.name==='tsfg_program.invoke')assert.equal(ids.has(op.properties.function_id),true);}

test('acyclic public canonical Core stays exact while private constructor roots share one actual/carrier inventory',()=>{
  const p=parameter('B:p',i32TypeId),property={...field(B,'parameter'),parameterBinding:p.id},base=nominal(B,[property],null,[{symbol:p.id,type:i32TypeId,origin}]),
    missing=field(D,'missing'),derived=nominal(D,[missing],B,[{symbol:'D:logical:p',type:i32TypeId,inheritedFrom:p.id,origin}]),
    ctor=owner('source:B',B,[],[p],B),entry=owner('source:entry',D,[returned(create(derived,[num()]))]);
  base.construction.kind='explicit';base.construction.functionId=ctor.id;
  const input=model([base,derived],[ctor,entry]),program=commonConstructionPlans(input,input.hir.functions),publicBaseline=input.hir.functions.map(fn=>planCommonFunction(input,fn));
  assertDefined(program);assert.equal(program.plans.length,3);assert.equal(program.corePlans.length,2);assert.equal(program.model.hir,input.hir);
  assert.equal(input.functions.size,2);assert.equal(input.types.get(D).construction.functionId,null);
  assert.deepEqual(program.corePlans.map(plan=>plan.graph.blocks),publicBaseline.map(plan=>plan.graph.blocks),'every public operation/anchor/fuel byte stays in the original canonical normal form');
  assert.deepEqual(requireCommonCoreConstructionPlans(program),program.corePlans);
  for(const plan of program.corePlans)assert.deepEqual(instructions(plan).filter(op=>op.name==='tsfg_program.fuel').map(op=>({properties:op.properties,range:op.range})),[{properties:{event:1},range}]);
  for(const plan of program.plans.filter(plan=>program.construction.privateIds.has(plan.owner.id)))assert.equal(instructions(plan).some(op=>op.name==='tsfg_program.fuel'),false);
  const result=physical(program),record=commonPublicCoreRepresentation(result,result.carriers);
  assert.equal(result.values.actual.storageObservations.coverage.complete,true);assert.equal(result.values.capacity.storageObservations.coverage.complete,true);
  assert.deepEqual([...result.values.actual.storageObservations.results.keys()].sort(),[B+'/ctor/'+B,B+'/ctor/'+D,D+'/ctor/'+D].sort());
  assert.deepEqual(record.functions.map(row=>row.id).sort(),[ctor.id,entry.id].sort());assert.equal(record.bindings.length,input.bindings.size);
  assert.ok(result.carriers.record().bindings.some(row=>!program.construction.publicBindings.has(row.id)),'private parameter capacities exist only in analysis');
  for(const row of record.bindings)assert.equal(program.construction.publicBindings.has(row.id),true);
  assert.deepEqual([...result.references.keys()].sort(),[ctor.id,entry.id].sort());assert.deepEqual([...result.escaping.keys()].sort(),[ctor.id,entry.id].sort());
  for(const context of result.values.actual.contexts.values())if(context.root&&context.plan.owner.id===entry.id)assert.deepEqual([...context.returned.tags],[D]);
  const text=program.corePlans.map(plan=>printCommonFunction(plan,result.model,result.carriers)).join('\n');
  assert.equal(text.includes('analysis-construction:'),false);assert.equal((text.match(/tsfg_program\.fuel/g)??[]).length,2);
});

test('real private callable-site evidence gap is ANDed with both solver coverage results',()=>{
  const real=owner('source:callback',i32TypeId,[returned(num())]),signature={parameters:[],returnType:i32TypeId},
    initial={kind:'indirectCall',type:i32TypeId,range,expression:{kind:'functionReference',type:F,functionId:real.id,range},signature,arguments:[]},
    declared=nominal(B,[field(B,'value',initial)]),entry=owner('source:entry',B,[returned(create(declared))]),
    input=model([{id:F,kind:'function',parameters:[],returnType:i32TypeId},declared],[real,entry]);
  const program=commonConstructionPlans(input,input.hir.functions);assert.equal(program.coverage.complete,false);
  assert.ok(program.coverage.issues.some(issue=>issue.includes('implicit initializer callable site')));
  // Independent coverage-only DTOs isolate AND from the real solver's separate
  // opaque-call gap. These are not claimed solver or Source-admission results.
  const cleanCoverage={capacity:{storageObservations:{coverage:{complete:true,issues:[]}}},actual:{storageObservations:{coverage:{complete:true,issues:[]}}}};
  combineCommonConstructionCoverage(program,cleanCoverage);
  assert.equal(cleanCoverage.capacity.storageObservations.coverage.complete,false);assert.equal(cleanCoverage.actual.storageObservations.coverage.complete,false);
  const result=physical(program);
  for(const pass of [result.values.capacity,result.values.actual]){
    assert.equal(pass.storageObservations.coverage.complete,false);
    for(const issue of program.coverage.issues)assert.equal(pass.storageObservations.coverage.issues.includes(issue),true);
  }
});

test('recursive public constructor use emits the finite transitive Core helper closure without expanding the public directory',()=>{
  const left=nominal(B),right=nominal(D);left.fields.push({...field(B,'next',create(right)),type:D});right.fields.push({...field(D,'next',create(left)),type:B});
  left.construction.initializationFields=left.fields.map(f=>f.id);right.construction.initializationFields=right.fields.map(f=>f.id);
  const entry=owner('source:entry',B,[returned(create(left))]),input=model([left,right],[entry]),program=commonConstructionPlans(input,input.hir.functions);
  assertDefined(program);assert.equal(program.plans.length,3);assert.equal(program.corePlans.length,1);assert.equal(program.construction.cyclicTypes.size,2);
  assert.ok(program.construction.privateCoreCalls.length>0);
  const result=physical(program);assert.equal(result.values.actual.storageObservations.coverage.complete,true);
  const context=[...result.values.actual.contexts.values()].find(row=>row.root&&row.plan.owner.id===entry.id);assert.ok(context);assert.equal(context.normal,false);
  const emitted=requireCommonCoreConstructionPlans(result),helperIds=[B,D].map(type=>'analysis-construction:'+type+'/ctor'),
    expectedIds=[entry.id,...helperIds],emittedIds=new Set(emitted.map(plan=>plan.owner.id)),record=commonPublicCoreRepresentation(result,result.carriers);
  assert.deepEqual(emitted.map(plan=>plan.owner.id),expectedIds,'only the public plan and its exact transitive helper closure are emitted');
  assert.deepEqual(emitted.filter(plan=>plan.owner.analysisOnly).map(plan=>plan.owner.ownerType),[B,D]);
  for(const plan of emitted)for(const op of instructions(plan))if(op.name==='tsfg_program.invoke')assert.equal(emittedIds.has(op.properties.function_id),true);
  assert.deepEqual(record.functions.map(row=>row.id),[entry.id],'internal definitions do not become public function rows');
  assert.deepEqual(record.internalConstructors.map(row=>({id:row.id,owner:row.owner,construction:row.construction})),
    [B,D].map(type=>({id:'analysis-construction:'+type+'/ctor',owner:type,construction:type+'/ctor'})));
});

test('unused cyclic constructors do not reject or alter an already supported public scalar Core plan',()=>{
  const left=nominal(B),right=nominal(D);left.fields.push({...field(B,'next',create(right)),type:D});right.fields.push({...field(D,'next',create(left)),type:B});
  left.construction.initializationFields=left.fields.map(f=>f.id);right.construction.initializationFields=right.fields.map(f=>f.id);
  const array='literal:Array<i32>',entry=owner('source:scalar',i32TypeId,[returned(num())]),input=model([left,right,{id:array,kind:'array',elementType:i32TypeId}],[entry]),program=commonConstructionPlans(input,input.hir.functions),baseline=planCommonFunction(input,entry);
  assert.deepEqual(program.corePlans[0].graph.blocks,baseline.graph.blocks);assert.equal(program.construction.privateCoreCalls.length,0);
  assert.equal(requireCommonCoreConstructionPlans(program).length,1);
  const result=physical(program),record=commonPublicCoreRepresentation(result,result.carriers);
  assert.deepEqual(record.functions.map(row=>row.id),[entry.id]);assert.equal(record.bindings.length,input.bindings.size+1);
  assert.equal(record.bindings.some(row=>row.id==='element:'+array),true,'the original complete Array element storage directory is public metadata');
  const context=[...result.values.actual.contexts.values()].find(row=>row.root&&row.plan.owner.id===entry.id);assert.ok(context);assert.equal(context.normal,true);assert.equal(context.returned.number,1);
});

test('a dead cyclic new after return does not change an earlier acyclic public construction into a private Core call',()=>{
  const loop=nominal(B);loop.fields.push({...field(B,'next',create(loop)),type:B});loop.construction.initializationFields=loop.fields.map(f=>f.id);
  const finite=nominal(D),entry=owner('source:dead',i32TypeId,[{kind:'expression',range,value:create(finite)},returned(num()),{kind:'expression',range,value:create(loop)}]),
    input=model([loop,finite],[entry]),program=commonConstructionPlans(input,input.hir.functions),baseline=planCommonFunction(input,entry);
  assertDefined(program);assert.deepEqual(program.corePlans[0].graph.blocks,baseline.graph.blocks);
  assert.equal(program.construction.privateCoreCalls.length,0);assert.equal(requireCommonCoreConstructionPlans(program).length,1);
});

test('public observation keeps normal/language identities from public roots and excludes private-only activations',()=>{
  const context=(id,functionId,root,callers,analysisOnly=false)=>({id,root,callers:new Set(callers),plan:{owner:{id:functionId,analysisOnly}}}),
    rows=[context('root:public','source:root',true,[]),context('root:private','analysis:constructor',true,[],true),
      context('callee:shared','source:same-callee',false,['root:public','root:private']),context('callee:private-only','source:same-callee',false,['root:private']),
      context('callee:child','source:child',false,['callee:shared']),context('cycle:left','source:left',false,['root:public','cycle:right']),
      context('cycle:right','source:right',false,['cycle:left']),context('private:from-public','analysis:constructor',false,['root:public'],true),
      context('callee:behind-private','source:child',false,['private:from-public']),context('unreachable','source:child',false,[]),
      context('root:without-record','source:missing-record',true,[])],contexts=new Map(rows.map(row=>[row.id,row])),
    selected=commonPublicObservationContexts(contexts,commonMeter(1000000)),expected=['root:public','callee:shared','callee:child','cycle:left','cycle:right','root:without-record'].sort();
  assert.deepEqual([...selected].sort(),expected);
  assert.equal(contexts.size,rows.length,'projection leaves the complete solved context catalogue intact');
  const events=rows.flatMap(row=>['normal','language'].map(completion=>({contextId:row.id,functionId:row.plan.owner.id,completion}))),
    observed=events.filter(event=>selected.has(event.contextId));
  for(const id of expected)assert.deepEqual(observed.filter(event=>event.contextId===id).map(event=>event.completion),['normal','language']);
  assert.equal(observed.some(event=>event.contextId==='callee:private-only'),false);
  assert.equal(observed.some(event=>event.contextId==='callee:shared'),true,'function identity alone does not collapse distinct activations');
  assert.equal(observed.some(event=>event.contextId==='root:without-record'),true,'a missing public record must remain subject to real validation');
});
