// SPDX-License-Identifier: MIT
// Typed inner model literals. No external HIR/Facts admission or public FnIDs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonImplicitConstructionPlans} from '../../compiler/common-program-implicit-construction-plans.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {commonMethods} from '../../compiler/common-program-methods.mjs';
import {classifyArrayCallGraph} from '../../compiler/array-call-graph.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {i32TypeId,sha256} from '../../compiler/identity.mjs';
const absent=sha256('tsfg.type\0undefined'),voidId=sha256('tsfg.type\0void'),range={start:0,end:1},path='/implicit-literal.ts';
const origin={source:path,...range},B='literal:B',D='literal:D',U='literal:U',V='literal:V';
const number=value=>({kind:'numericLiteral',type:i32TypeId,token:String(value),decimal:String(value),range});
const field=(owner,name,type=i32TypeId,initializer=null)=>({id:owner+'/'+name,sourceBinding:owner+'/'+name,owner,name,type,origin:range,
  ...(initializer?{initializer}:{})});
function nominal(id,fields=[],base=null,kind='reference',parameters=[]){
  const construction={id:id+'/ctor',kind:base?'implicit-derived':'implicit-base',parameters,signature:{parameters:parameters.map(p=>p.type),returnType:id},
    functionId:null,origin,initializationFields:fields.map(f=>f.id),implicitForward:base?{target:base+'/ctor',parameters:parameters.map(p=>({source:p.symbol,target:p.inheritedFrom}))}:null};
  return {id,kind,fields,methods:[],...(base?{base}:{}),construction};
}
function source(id,returnType,parameters=[],body=[],ownerType=null){
  return {id,name:id,kind:ownerType?'construction-body':'source',returnType,parameters,bindings:[],body,ownerType,
    receiverBinding:ownerType?'this:'+id:null,sourceBinding:id,sourcePath:path,range,nameRange:range,signatureHash:'sig:'+id,
    lexicalParent:null,lexicalEnvironment:null,activationEnvironment:null,captures:[]};
}
const parameter=(id,type)=>({id,name:id,kind:'parameter',type,writable:true,range,nameRange:range});
const constructionParameter=(symbol,type,inheritedFrom='')=>({symbol,type,inheritedFrom,origin});
const construct=type=>({kind:'new',type:type.id,callee:type.id,construction:type.construction.id,range,signature:type.construction.signature,arguments:[]});
function model(owned,owners=[],globals=[]){
  const rows=[{id:i32TypeId,kind:'scalar',name:'i32'},{id:absent,kind:'undefined'},{id:voidId,kind:'void'},...owned],spend=commonMeter(1000000),
    types=new Map(rows.map(row=>[row.id,row])),functions=new Map(owners.map(row=>[row.id,row])),fields=new Map(),bindings=new Map();
  for(const type of rows)for(const row of type.fields??[]){fields.set(row.id,row);bindings.set(row.sourceBinding,{...row,id:row.sourceBinding,role:'field'});}
  for(const fn of owners){for(const p of fn.parameters)bindings.set(p.id,{...p,role:'parameter',owner:fn.id});
    if(fn.ownerType)bindings.set(fn.receiverBinding,{id:fn.receiverBinding,type:fn.ownerType,role:'receiver',range});}
  for(const global of globals)bindings.set(global.sourceBinding,{id:global.sourceBinding,type:global.type,role:'global',range});
  const hir={types:rows,functions:owners,globals,modules:[],environments:[],hostImports:[],hostContext:null,
    snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[]}},sites=new Map(),summaries=new Map(),
    siteKey=(id,at)=>id+'/'+at.start+':'+at.end;
  // The no-callable cases have no code-domain obligations. Test5 explicitly
  // supplies or removes one typed ancestor parameter upper; none is inferred.
  const callables={sites,summaries,siteKey,domain:{top:()=>({top:true,ids:new Set()})},site:()=>({top:true,functions:[]}),
    signature:()=> 'literal-call-signature',arrayElementInitialized:()=>false};
  return {hir,types,functions,fields,bindings,globals:new Map(globals.map(row=>[row.id,row])),environments:new Map(),hosts:new Map(),slots:new Map(),
    spend,callables,methods:commonMethods(hir,spend),payload:'payload:implicit-literal',cell:id=>'cell:'+id,
    limits:{parameters:64,registersPerFunction:4096,blocksPerFunction:256,instructionsPerFunction:8192}};
}
const prepare=(input,owners=input.hir.functions)=>commonImplicitConstructionPlans(input,owners);
const analyze=program=>analyzeCommonGraphs(program,null,{borrowProof:false,storageAuthoring:true});
function root(result,construction,newTarget){
  const context=[...result.actual.contexts.values()].find(row=>row.constructionRoot?.constructionId===construction&&row.constructionRoot.newTarget===newTarget);assert.ok(context);return context;
}
function binding(context,completion='normalFrames'){
  const index=context.plan.parameters.findIndex(p=>p.frame),id=[...context.args[index].frames][0],value=context[completion].get(id);assert.ok(value);return value;
}

test('all implicit base/derived/value ancestor roots use private plans and preserve dynamic newTarget/default undefined',()=>{
  const first=field(B,'first',i32TypeId,number(1)),missing=field(B,'missing'),own=field(D,'own',i32TypeId,number(2)),
    base=nominal(B,[first,missing]),derived=nominal(D,[own],B),value=nominal(V,[],null,'value'),input=model([base,derived,value]),
    program=prepare(input),result=analyze(program);
  assert.equal(input.hir.functions.length,0);assert.equal(input.functions.size,0);assert.equal(input.hir.types.find(t=>t.id===D).construction.functionId,null);
  assert.equal(program.model.hir,input.hir);assert.equal(program.plans.length,3);assert.equal(program.privateTargets.size,3);assert.equal(program.coverage.complete,true);
  assert.deepEqual(program.roots.map(row=>[row.construction,row.newTarget]),[[B+'/ctor',B],[B+'/ctor',D],[D+'/ctor',D],[V+'/ctor',V]]);
  for(const row of program.roots){
    assert.ok(row.target.startsWith('analysis-construction:'));
    const context=root(result,row.construction,row.newTarget);assert.equal(context.normal,true);assert.equal(context.language,false);
    assert.deepEqual([...context.returned.tags],[row.newTarget]);
    for(const ref of context.returned.refs)assert.equal(result.actual.objects.get(ref).type,row.newTarget);
  }
  const context=root(result,D+'/ctor',D),bound=binding(context);assert.deepEqual([...bound.bound.tags],[D]);assert.equal(bound.prefixMax,1);
  for(const ref of bound.bound.refs){
    assert.equal(context.normalHeap.get(ref+'/field/'+first.id).number,1);assert.equal(context.normalHeap.get(ref+'/field/'+own.id).number,2);
    assert.deepEqual([...context.normalHeap.get(ref+'/field/'+missing.id).tags],[absent]);
  }
  assert.deepEqual([...result.actual.storageObservations.fields.get(missing.id).actualTypes],[absent],'default own definition is a real undefined contribution');
  assert.equal(result.actual.storageObservations.coverage.complete,true);
});

test('implicit derived forwards real parameter property input and preserves explicit base replacement U',()=>{
  const p=parameter('B:p',i32TypeId),f={...field(B,'parameter'),parameterBinding:p.id},own=field(D,'own',i32TypeId,number(2)),
    u=nominal(U),base=nominal(B,[f],null,'reference',[constructionParameter(p.id,i32TypeId)]),
    derived=nominal(D,[own],B,'reference',[constructionParameter('D:logical:p',i32TypeId,p.id)]),
    fn=source('B:explicit',B,[p],[{kind:'return',range,value:construct(u)}],B);
  base.construction.kind='explicit';base.construction.functionId=fn.id;base.construction.implicitForward=null;
  const input=model([base,derived,u],[fn]),program=prepare(input),result=analyze(program),context=root(result,D+'/ctor',D),bound=binding(context);
  assert.deepEqual([...context.returned.tags],[U]);assert.deepEqual([...bound.bound.tags],[U]);
  for(const ref of context.returned.refs){assert.equal(result.actual.objects.get(ref).type,U);assert.equal(context.normalHeap.get(ref+'/field/'+own.id).number,2);}
  const baseWithD=root(result,B+'/ctor',D),allocated=binding(baseWithD);assert.deepEqual([...allocated.bound.tags],[D]);
  for(const ref of allocated.bound.refs)assert.deepEqual([...baseWithD.normalHeap.get(ref+'/field/'+f.id).tags],[i32TypeId]);
  assert.deepEqual([...result.actual.storageObservations.fields.get(f.id).actualTypes],[i32TypeId]);
  assert.deepEqual([...result.actual.storageObservations.results.get(D+'/ctor/'+D).actualTypes],[U]);
  assert.equal(result.actual.storageObservations.coverage.complete,false,'missing U/D logical property route is an explicit independent open bound');
});

test('implicit derived initializer language exit preserves escaped selected object and exact written prefix',()=>{
  const global={id:'escaped:D',sourceBinding:'global:D',type:D},escape=field(D,'escape',D,{kind:'bindingAssignment',type:D,operator:'=',range,
      target:{kind:'globalTarget',type:D,global:global.id,binding:global.sourceBinding,range},value:{kind:'thisReference',type:D,range}}),
    prefix=field(D,'prefix',i32TypeId,number(1)),failed=field(D,'failed',i32TypeId,{kind:'call',type:i32TypeId,callee:'fail',range,signature:{parameters:[],returnType:i32TypeId},arguments:[]}),
    helper=source('fail',i32TypeId,[],[{kind:'throw',range,value:number(9)}]),input=model([nominal(B),nominal(D,[escape,prefix,failed],B)],[helper],[global]),
    program=prepare(input),result=analyze(program),context=root(result,D+'/ctor',D),bound=binding(context,'languageFrames');
  assert.equal(context.normal,false);assert.equal(context.language,true);assert.deepEqual([...bound.bound.tags],[D]);
  assert.equal(bound.unbound,false);assert.equal(bound.aborted,true);assert.equal(bound.initializing,false);assert.equal(bound.prefixMin,2);assert.equal(bound.prefixMax,2);
  const escaped=context.languageHeap.get('global:'+global.id);assert.ok(escaped);assert.deepEqual([...escaped.refs],[...bound.bound.refs]);
  for(const ref of escaped.refs){assert.equal(context.languageHeap.get(ref+'/field/'+prefix.id).number,1);assert.deepEqual([...context.languageHeap.get(ref+'/field/'+failed.id).tags],[absent]);}
  assert.deepEqual([...result.actual.storageObservations.fields.get(prefix.id).actualTypes],[i32TypeId]);
  assert.equal(result.actual.storageObservations.fields.get(failed.id).actualTypes.size,0,'virtual absence after language failure is not a field definition');
  assert.equal(result.actual.storageObservations.coverage.complete,true);
});

test('mutually recursive implicit new uses finite graph calls and the existing SCC solver',()=>{
  const left=nominal('recursive:L'),right=nominal('recursive:R');
  left.fields.push(field(left.id,'next',right.id,construct(right)));right.fields.push(field(right.id,'next',left.id,construct(left)));
  left.construction.initializationFields=left.fields.map(f=>f.id);right.construction.initializationFields=right.fields.map(f=>f.id);
  const program=prepare(model([left,right])),edges=[];
  assert.equal(program.plans.length,2);assert.equal(program.privateTargets.size,2);
  for(const plan of program.plans)for(const block of plan.graph.blocks)for(const op of block.instructions)if(op.name==='tsfg_program.invoke')edges.push({caller:plan.owner.id,target:op.properties.function_id});
  assert.equal(edges.length,2);assert.ok(classifyArrayCallGraph(program.plans.map(p=>p.owner.id),edges).components.some(row=>row.cyclic));
  const result=analyze(program);assert.equal(result.actual.storageObservations.coverage.complete,true);
  for(const row of program.roots){const context=root(result,row.construction,row.newTarget);assert.equal(context.normal,false);assert.equal(context.language,false);assert.equal(context.returned.tags.size,0);}
});

test('private callable parameter upper comes from actual forwarded ancestor evidence; missing evidence stays open',()=>{
  const F='callable:F',p=parameter('B:callback',F),base=nominal(B,[],null,'reference',[constructionParameter(p.id,F)]),
    derived=nominal(D,[],B,'reference',[constructionParameter('D:logical:callback',F,p.id)]),fn=source('B:callable',B,[p],[],B),target=source('real:target',voidId);
  base.construction.kind='explicit';base.construction.functionId=fn.id;
  const input=model([base,derived,{id:F,kind:'function',parameters:[],returnType:voidId}],[fn,target]),upper={top:false,ids:new Set([target.id])};
  input.callables.summaries.set(fn.id,{parameters:new Map([[0,upper]])});
  const program=prepare(input),id=program.privateTargets.get(D),privateOwner=program.model.functions.get(id),selected=program.model.callables.summaries.get(id).parameters.get(0);
  assert.deepEqual([...selected.ids],[target.id]);assert.equal(selected.top,false);assert.notEqual(selected.ids,upper.ids);assert.equal(program.coverage.complete,true);
  assert.deepEqual(program.callableSources.get(privateOwner.parameters[0].id),{functionId:fn.id,parameter:0});
  assert.equal(input.functions.has(id),false);assert.equal(input.hir.functions.length,2);
  input.callables.summaries.delete(fn.id);const missing=prepare(input),unresolved=missing.model.callables.summaries.get(missing.privateTargets.get(D)).parameters.get(0);
  assert.equal(missing.coverage.complete,false);assert.ok(missing.coverage.issues.some(issue=>issue.includes('callable parameter upper is unresolved')));
  assert.equal(unresolved.top,true);assert.equal(unresolved.ids.size,0,'opaque unresolved data is not claimed to be a finite empty upper');
});
