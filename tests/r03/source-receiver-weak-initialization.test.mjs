// SPDX-License-Identifier: MIT
// Literal typed SSA/model inputs for Source abstract-graph mathematics only.
// These fixtures are not Source AST/Facts admission or Runtime Program/State.
import test from 'node:test';
import assert from 'node:assert/strict';
import {i32TypeId,sha256} from '../../compiler/identity.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonReceiverActual} from '../../compiler/common-program-receiver-actual.mjs';
import {commonActualContextValues} from '../../compiler/common-program-actual-context.mjs';
import {commonRegions} from '../../compiler/common-program-regions.mjs';

const B='unit:receiver:B',D='unit:receiver:D',U='unit:receiver:U';
const CB='unit:construction:B',CD='unit:construction:D',CU='unit:construction:U';
const absence=sha256('tsfg.type\0undefined'),payload='payload:literal-receiver';
const frameView=owner=>'receiver:'+owner,cursorView=owner=>'initialization:'+owner;
const range={start:0,end:1};
/** @typedef {{id:string,sourceBinding:string,name:string,type:string,owner:string}} Field */
/** @typedef {{id:string,kind:string,name?:string,base?:string,fields:Field[],construction?:{id:string,functionId:string,initializationFields:string[]}}} TypeRow */
/** @typedef {{name:string,type:string}} Value */
/** @typedef {{name:string,operands:string[],result:string|null,view:string|null,properties:Record<string,string|number|boolean>,range:{start:number,end:number},successors:string[]}} Instruction */
/** @typedef {{name:string,parameters:Value[],instructions:Instruction[]}} Block */
const field=(owner,name)=>({id:owner+'/'+name,sourceBinding:owner+'/'+name,name,type:i32TypeId,owner});
/** @param {string} id @param {string} construction @param {Field[]} fields @param {string|null} [base] @returns {TypeRow} */
function reference(id,construction,fields=[],base=null){
  return {id,kind:'reference',fields,...(base?{base}:{}),construction:{id:construction,functionId:construction+'/body',initializationFields:fields.map(row=>row.id)}};
}

// This builder only assembles literal records. It does not call a verifier,
// graph planner, solver, Source producer, Frontend or Runtime loader.
/** @param {TypeRow[]} ownedTypes @param {{id:string,sourceBinding:string,type:string}[]} [globals] */
function fixture(ownedTypes,globals=[]){
  const types=[{id:i32TypeId,kind:'scalar',name:'i32',fields:[]},{id:absence,kind:'undefined',fields:[]},...ownedTypes];
  const bindings=new Map(),fields=new Map(),functions=new Map(),plans=[];
  for(const type of types)for(const row of type.fields){fields.set(row.id,row);bindings.set(row.sourceBinding,{id:row.sourceBinding,type:row.type,role:'field'});}
  const hir={types:types.map(row=>({...row,sourceType:row.id})),functions:[],globals,environments:[],hostImports:[],hostContext:null,
    snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[]}};
  const model={hir,types:new Map(types.map(row=>[row.id,row])),fields,bindings,functions,globals:new Map(globals.map(row=>[row.id,row])),
    environments:new Map(),hosts:new Map(),slots:new Map(),spend:commonMeter(1000000),payload,
    callables:{summaries:new Map(),arrayElementInitialized:()=>false}};
  /** @param {string} id @param {string} returnType @param {string[]} [parameterTypes] @param {{ownerType?:string,frame?:boolean,lexicalParent?:string}} [options] */
  function plan(id,returnType,parameterTypes=[],options={}){
    const parameters=parameterTypes.map((type,index)=>({id:id+'/p'+index,type,frame:Boolean(options.frame&&index===0)}));
    const owner={id,returnType,parameters,kind:options.ownerType?'construction-body':'source',ownerType:options.ownerType??null,
      lexicalParent:options.lexicalParent??null,sourceBinding:id,sourcePath:'/literal-receiver.ts',signatureHash:'literal-signature:'+id};
    const blocks=[],registers=new Map();let next=0;
    const variable=type=>{const name='%v'+next++;registers.set(name,{view:type});return {name,type};};
    /** @param {string[]} [types] @returns {Block} */
    const block=(types=[])=>{const row={name:'bb'+blocks.length,parameters:types.map(variable),instructions:[]};blocks.push(row);return row;};
    const entry=block(parameterTypes),graph={blocks,registers},result={owner,parameters,returnType,entry,graph,block,variable};
    for(const parameter of parameters)bindings.set(parameter.id,{...parameter,role:'parameter'});
    functions.set(id,owner);hir.functions.push(owner);plans.push(result);return result;
  }
  return {model,plans,plan};
}
/** @param {ReturnType<ReturnType<typeof fixture>['plan']>} plan @param {Block} block @param {string} name @param {Value[]} args @param {string|null} view @param {Record<string,string|number|boolean>} properties @param {Block[]} [successors] */
function operation(plan,block,name,args,view,properties={},successors=[]){
  const value=view===null?null:plan.variable(view);
  block.instructions.push({name:name.startsWith('func.')||name.startsWith('cf.')?name:'tsfg_program.'+name,
    operands:args.map(row=>row.name),result:value?.name??null,view,properties,range:{...range},successors:successors.map(row=>row.name)});
  return value;
}
/** @param {Parameters<typeof operation>[0]} plan @param {Block} block @param {string} name @param {Value[]} args @param {string} view @param {Record<string,string|number|boolean>} [properties] @returns {Value} */
function emit(plan,block,name,args,view,properties={}){
  const value=operation(plan,block,name,args,view,properties);assert.ok(value);return value;
}
/** @param {Parameters<typeof operation>[0]} plan @param {Block} block @param {string} name @param {Value[]} args @param {Record<string,string|number|boolean>} [properties] */
function effect(plan,block,name,args,properties={}){operation(plan,block,name,args,null,properties);}
/** @param {Parameters<typeof operation>[0]} plan @param {Block} block @param {Value} value */
function returns(plan,block,value){effect(plan,block,'func.return',[value]);}
/** @param {Parameters<typeof operation>[0]} plan @param {Block} block @param {string} name @param {Value[]} args @param {string} view @param {Record<string,string|number|boolean>} [properties] @param {Block|null} [caught] */
function action(plan,block,name,args,view,properties={},caught=null){
  const normal=plan.block([view]),language=caught??plan.block([payload]);
  operation(plan,block,name,args,null,properties,[normal,language]);
  if(!caught)effect(plan,language,'return_throw',[language.parameters[0]]);
  return {block:normal,value:normal.parameters[0],language};
}
/** @param {Parameters<typeof operation>[0]} plan @param {Block} block @param {string} target @param {Value[]} args @param {string} view @param {Block|null} [caught] */
function invoke(plan,block,target,args,view,caught=null){
  return action(plan,block,'invoke',args,view,{function_id:target,signature_hash:'literal-signature:'+target},caught);
}
/** @param {ReturnType<typeof fixture>} input @param {string} owner */
function constructor(input,owner){
  const type=input.model.types.get(owner);assert.ok(type?.construction);
  return input.plan(type.construction.functionId,owner,[frameView(owner)],{ownerType:owner,frame:true});
}
/** @param {Parameters<typeof operation>[0]} plan */
function allocateAndBind(plan){
  const frame=plan.entry.parameters[0],allocated=emit(plan,plan.entry,'receiver_allocate',[frame],plan.returnType,{owner:plan.returnType});
  const selected=action(plan,plan.entry,'receiver_bind',[frame,allocated],plan.returnType,{owner:plan.returnType});
  return {...selected,frame};
}
/** @param {Parameters<typeof operation>[0]} plan @param {Block} block @param {Value} frame @param {Value|null} [selected] */
function finish(plan,block,frame,selected=null){
  const result=action(plan,block,'receiver_result',selected?[frame,selected]:[frame],plan.returnType,{owner:plan.returnType});
  returns(plan,result.block,result.value);return result.value;
}
/** @param {Parameters<typeof operation>[0]} plan @param {Block} block @param {string} owner @param {string} construction */
function create(plan,block,owner,construction){
  return emit(plan,block,'receiver_create',[],frameView(owner),{owner,construction,new_target:owner});
}
/** @param {Parameters<typeof operation>[0]} plan @param {Block} block @param {Value} frame @param {string} base @param {string} construction */
function superCall(plan,block,frame,base,construction){
  const child=emit(plan,block,'receiver_child',[frame],frameView(base),{owner:base});
  const constructed=invoke(plan,block,construction+'/body',[child],base);
  return action(plan,constructed.block,'receiver_bind',[frame,constructed.value],plan.returnType,{owner:plan.returnType});
}
function solve(input){return analyzeCommonGraphs(input,null,{borrowProof:false,storageAuthoring:true});}
function tags(value){return [...value.tags].sort();}
function root(result,construction,newTarget){
  const found=[...result.actual.contexts.values()].find(row=>row.constructionRoot?.constructionId===construction&&row.constructionRoot.newTarget===newTarget);
  assert.ok(found,'owned construction/newTarget root is present');return found;
}
function ownFrame(context,completion='normalFrames'){
  assert.equal(context.args[0].frames.size,1);const id=[...context.args[0].frames][0],state=context[completion].get(id);
  assert.ok(state,'completion retains its entry control frame');return state;
}
function observed(result,plan,value){
  const found=result.actual.observed.get(plan.owner.id+'/'+value.name);assert.ok(found);return found;
}
function installEmptyBase(input,owner){
  const plan=constructor(input,owner),selected=allocateAndBind(plan),cursor=emit(plan,selected.block,'initialize_begin',[selected.frame,selected.value],cursorView(owner),{owner});
  effect(plan,selected.block,'initialize_end',[cursor,selected.value],{owner});finish(plan,selected.block,selected.frame);return plan;
}

test('owned constructor ancestor roots and child invoke retain dynamic D newTarget',()=>{
  const input=fixture([reference(B,CB),reference(D,CD,[],B)]),base=installEmptyBase(input,B),derived=constructor(input,D),frame=derived.entry.parameters[0];
  const selected=superCall(derived,derived.entry,frame,B,CB),cursor=emit(derived,selected.block,'initialize_begin',[frame,selected.value],cursorView(D),{owner:D});
  effect(derived,selected.block,'initialize_end',[cursor,selected.value],{owner:D});
  const current=action(derived,selected.block,'receiver_get',[frame],D,{owner:D});finish(derived,current.block,frame,current.value);
  const entry=input.plan('entry:new-D',D),local=create(entry,entry.entry,D,CD),completed=invoke(entry,entry.entry,CD+'/body',[local],D);
  returns(entry,completed.block,completed.value);
  const result=solve(input),storage=result.actual.storageObservations;
  assert.equal(storage.coverage.complete,true);assert.deepEqual(storage.coverage.issues,[]);
  assert.deepEqual([...storage.results.keys()].sort(),[CB+'/'+B,CB+'/'+D,CD+'/'+D].sort());
  for(const [construction,newTarget]of [[CB,B],[CB,D],[CD,D]]){
    const context=root(result,construction,newTarget),bound=ownFrame(context);
    assert.equal(context.normal,true);assert.equal(context.language,false);assert.deepEqual(tags(context.returned),[newTarget]);
    assert.deepEqual(tags(bound.bound),[newTarget]);assert.equal(bound.unbound,false);
    assert.deepEqual(tags(context.args[0]),[]);assert.equal(context.args[0].refs.size,0,'control frame is not an entry object');
    assert.deepEqual([...storage.results.get(construction+'/'+newTarget).actualTypes],[newTarget]);
    for(const ref of context.returned.refs)assert.equal(result.actual.objects.get(ref).type,newTarget);
  }
  const caller=[...result.actual.contexts.values()].find(row=>row.root&&row.plan.owner.id===entry.owner.id);assert.ok(caller);
  assert.deepEqual(tags(caller.returned),[D]);
  assert.ok([...result.actual.contexts.values()].some(row=>!row.root&&row.plan.owner.id===base.owner.id&&tags(row.returned).includes(D)),'child frame crosses actual invoke context');
});

test('explicit base object result keeps U while its escaped allocated B retains initialized prefix',()=>{
  const prefix=field(B,'prefix'),global={id:'global:escaped-base',sourceBinding:'binding:escaped-base',type:B};
  const input=fixture([reference(B,CB,[prefix]),reference(U,CU)],[global]);installEmptyBase(input,U);
  const base=constructor(input,B),selected=allocateAndBind(base),cursor=emit(base,selected.block,'initialize_begin',[selected.frame,selected.value],cursorView(B),{owner:B});
  const one=emit(base,selected.block,'constant',[],i32TypeId,{decimal:'1',token:'1'}),copied=emit(base,selected.block,'value_copy',[one],i32TypeId,{type:i32TypeId}),
    next=emit(base,selected.block,'initialize_field',[cursor,selected.value,copied],cursorView(B),{owner:B,field:prefix.id});
  effect(base,selected.block,'initialize_end',[next,selected.value],{owner:B});effect(base,selected.block,'global_store',[selected.value],{global:global.id});
  const local=create(base,selected.block,U,CU),replacement=invoke(base,selected.block,CU+'/body',[local],U);
  finish(base,replacement.block,selected.frame,replacement.value);
  const result=solve(input),context=root(result,CB,B),bound=ownFrame(context),storage=result.actual.storageObservations;
  assert.equal(context.normal,true);assert.equal(context.language,false);assert.deepEqual(tags(context.returned),[U]);
  assert.deepEqual(tags(bound.bound),[B],'explicit return does not retag or replace the bound receiver');
  for(const ref of context.returned.refs)assert.equal(result.actual.objects.get(ref).type,U);
  const escaped=context.normalHeap.get('global:'+global.id);assert.ok(escaped);assert.deepEqual(tags(escaped),[B]);
  assert.deepEqual([...escaped.refs],[...bound.bound.refs]);
  for(const ref of escaped.refs){const stored=context.normalHeap.get(ref+'/field/'+prefix.id);assert.ok(stored);assert.deepEqual(tags(stored),[i32TypeId]);assert.equal(stored.number,1);}
  assert.deepEqual([...storage.results.get(CB+'/'+B).actualTypes],[U]);
  assert.deepEqual([...storage.fields.get(prefix.id).actualTypes],[i32TypeId]);assert.equal(storage.coverage.complete,true);
});

test('derived initializer language continuation keeps binding and escaped prefix, abandons cursor, and reads missing undefined',()=>{
  const prefix=field(D,'prefix'),missing=field(D,'missing'),global={id:'global:escaped-derived',sourceBinding:'binding:escaped-derived',type:D};
  const input=fixture([reference(B,CB),reference(D,CD,[prefix,missing],B)],[global]);installEmptyBase(input,B);
  const failing=input.plan('initializer:fail',absence),thrown=emit(failing,failing.entry,'undefined',[],absence);
  effect(failing,failing.entry,'return_throw',[thrown]);
  const derived=constructor(input,D),frame=derived.entry.parameters[0],selected=superCall(derived,derived.entry,frame,B,CB);
  const cursor=emit(derived,selected.block,'initialize_begin',[frame,selected.value],cursorView(D),{owner:D}),one=emit(derived,selected.block,'constant',[],i32TypeId,{decimal:'1',token:'1'}),
    copied=emit(derived,selected.block,'value_copy',[one],i32TypeId,{type:i32TypeId});
  emit(derived,selected.block,'initialize_field',[cursor,selected.value,copied],cursorView(D),{owner:D,field:prefix.id});
  effect(derived,selected.block,'global_store',[selected.value],{global:global.id});
  const caught=derived.block([payload]),unreached=invoke(derived,selected.block,failing.owner.id,[],absence,caught);
  effect(derived,unreached.block,'unreachable',[]);
  // The catch is outside the derived automatic initialization. No cursor is
  // resumed and no initialization permission is manufactured after the throw.
  const current=action(derived,caught,'receiver_get',[frame],D,{owner:D}),first=emit(derived,current.block,'field_load',[current.value],i32TypeId,{field:prefix.id}),
    absent=emit(derived,current.block,'field_load',[current.value],i32TypeId,{field:missing.id});
  finish(derived,current.block,frame,current.value);
  const result=solve(input),context=root(result,CD,D),bound=ownFrame(context);
  assert.equal(context.normal,true);assert.equal(context.language,false);assert.deepEqual(tags(context.returned),[D]);
  assert.deepEqual(tags(bound.bound),[D]);assert.equal(bound.unbound,false);assert.equal(bound.initializing,false);assert.equal(bound.aborted,true);
  assert.equal(bound.prefixMin,1);assert.equal(bound.prefixMax,1);
  assert.deepEqual(tags(observed(result,derived,first)),[i32TypeId]);assert.equal(observed(result,derived,first).number,1);
  assert.deepEqual(tags(observed(result,derived,absent)),[absence],'unwritten logical field is undefined, not Bottom or its declared view');
  const escaped=context.normalHeap.get('global:'+global.id);assert.ok(escaped);assert.deepEqual([...escaped.refs],[...bound.bound.refs]);
  for(const ref of escaped.refs)assert.equal(context.normalHeap.get(ref+'/field/'+prefix.id).number,1);
  const missingContribution=result.actual.storageObservations.fields.get(missing.id);assert.ok(missingContribution);
  assert.equal(missingContribution.actualTypes.size,0,'virtual absence is not a logical field-write contribution');assert.equal(missingContribution.unknown,false);
  assert.ok([...result.actual.contexts.values()].some(row=>!row.root&&row.plan.owner.id===failing.owner.id&&row.language&&!row.normal),'real invoke language completion feeds the catch');
  assert.deepEqual([...result.actual.storageObservations.fields.get(prefix.id).actualTypes],[i32TypeId]);
  assert.deepEqual([...result.actual.storageObservations.fields.get(missing.id).actualTypes],[],'no write contribution was invented for the missing field');
  assert.equal(result.actual.storageObservations.coverage.complete,true);
});

test('missing implicit pair, nonclosed entry and logical route gaps remain incomplete coverage',()=>{
  const prefix=field(B,'prefix'),input=fixture([reference(B,CB,[prefix]),reference(U,CU)]);installEmptyBase(input,U);
  // There is intentionally no CB/body plan. It is an unsampled constructor
  // pair, not an explicit complete observation of normal Bottom.
  const external=input.plan('entry:external-B',B,[B]);returns(external,external.entry,external.entry.parameters[0]);
  const entry=input.plan('entry:unclosed-route',i32TypeId),local=create(entry,entry.entry,U,CU),completed=invoke(entry,entry.entry,CU+'/body',[local],U),
    viewed=emit(entry,completed.block,'view',[completed.value],B),one=emit(entry,completed.block,'constant',[],i32TypeId,{decimal:'1',token:'1'});
  effect(entry,completed.block,'field_store',[viewed,one],{field:prefix.id});returns(entry,completed.block,one);
  const result=solve(input),storage=result.actual.storageObservations;
  assert.equal(storage.coverage.complete,false);
  assert.ok(storage.coverage.issues.includes('implicit constructor pair is not analyzed: '+CB+'/'+B));
  assert.ok(storage.coverage.issues.includes('entry parameter actual domain is not closed: '+external.owner.id+'/'+external.parameters[0].id));
  assert.ok(storage.coverage.issues.includes('logical property route is not closed: '+U+'/'+B+'/'+prefix.id));
  assert.equal(storage.results.has(CB+'/'+B),false,'missing sample is not a known-empty result row');
  assert.deepEqual([...storage.results.get(CU+'/'+U).actualTypes],[U]);
  assert.deepEqual([...storage.fields.get(prefix.id).actualTypes],[i32TypeId],'observed logical write remains available despite an independent coverage gap');
});

test('one derived receiver preserves initialized value or undefined after normal/language initializer paths join',()=>{
  const conditional=field(D,'conditional'),booleanId=sha256('tsfg.type\0bool');
  const input=fixture([reference(B,CB),reference(D,CD,[conditional],B),{id:booleanId,kind:'scalar',name:'bool',fields:[]}]);
  installEmptyBase(input,B);
  // A declared bool entry is genuinely both true and false. The helper has
  // distinct normal and language exits; neither path allocates a new receiver.
  const helper=input.plan('initializer:maybe',absence,[booleanId]),yes=helper.block(),no=helper.block();
  operation(helper,helper.entry,'cf.cond_br',[helper.entry.parameters[0]],null,{},[yes,no]);
  const normalValue=emit(helper,yes,'undefined',[],absence),languageValue=emit(helper,no,'undefined',[],absence);
  returns(helper,yes,normalValue);effect(helper,no,'return_throw',[languageValue]);
  const derived=input.plan(CD+'/body',D,[frameView(D),booleanId],{ownerType:D,frame:true}),frame=derived.entry.parameters[0],
    selected=superCall(derived,derived.entry,frame,B,CB),cursor=emit(derived,selected.block,'initialize_begin',[frame,selected.value],cursorView(D),{owner:D});
  const caught=derived.block([payload]),completed=invoke(derived,selected.block,helper.owner.id,[derived.entry.parameters[1]],absence,caught),joined=derived.block();
  const one=emit(derived,completed.block,'constant',[],i32TypeId,{decimal:'1',token:'1'}),copied=emit(derived,completed.block,'value_copy',[one],i32TypeId,{type:i32TypeId}),
    next=emit(derived,completed.block,'initialize_field',[cursor,selected.value,copied],cursorView(D),{owner:D,field:conditional.id});
  effect(derived,completed.block,'initialize_end',[next,selected.value],{owner:D});
  operation(derived,completed.block,'cf.br',[],null,{},[joined]);
  operation(derived,caught,'cf.br',[],null,{},[joined]);
  const current=action(derived,joined,'receiver_get',[frame],D,{owner:D}),loaded=emit(derived,current.block,'field_load',[current.value],i32TypeId,{field:conditional.id});
  finish(derived,current.block,frame,current.value);
  const result=solve(input),context=root(result,CD,D),bound=ownFrame(context),actual=observed(result,derived,loaded);
  assert.equal(context.normal,true);assert.equal(context.language,false);assert.deepEqual(tags(context.returned),[D]);
  assert.equal(bound.bound.refs.size,1,'both paths retain the same allocated derived receiver');
  assert.deepEqual(tags(bound.bound),[D]);assert.equal(bound.unbound,false);assert.equal(bound.initializing,false);assert.equal(bound.aborted,true);
  assert.equal(bound.prefixMin,0);assert.equal(bound.prefixMax,1);
  assert.deepEqual(tags(actual),[i32TypeId,absence].sort(),'the path without the field contributes actual undefined at the join');
  assert.equal(actual.unknown,false);
  for(const ref of bound.bound.refs){
    const stored=context.normalHeap.get(ref+'/field/'+conditional.id);assert.ok(stored);
    assert.deepEqual(tags(stored),[i32TypeId,absence].sort(),'normal completion snapshot retains both actual field alternatives');
  }
  assert.ok([...result.actual.contexts.values()].some(row=>!row.root&&row.plan.owner.id===helper.owner.id&&row.normal&&row.language),'the invoke summary contains both genuine exits');
  const written=result.actual.storageObservations.fields.get(conditional.id);assert.ok(written);
  assert.deepEqual([...written.actualTypes],[i32TypeId],'virtual absence must not become a logical field-write contribution');
  assert.equal(written.unknown,false);assert.equal(result.actual.storageObservations.coverage.complete,true);
});

// A finite syntactic SCC is conservatively repeated even though this particular
// bool literal chooses the nonrecursive exit. No unbounded execution is needed.
function weakBase(input,owner){
  const plan=constructor(input,owner),recursive=plan.block(),body=plan.block(),frame=plan.entry.parameters[0],
    boolean=sha256('tsfg.type\0bool');
  if(!input.model.types.has(boolean)){const row={id:boolean,kind:'scalar',name:'bool',fields:[],sourceType:boolean};input.model.types.set(boolean,row);input.model.hir.types.push(row);}
  const no=emit(plan,plan.entry,'boolean',[],boolean,{value:false});
  operation(plan,plan.entry,'cf.cond_br',[no],null,{},[recursive,body]);
  const never=invoke(plan,recursive,plan.owner.id,[frame],owner);returns(plan,never.block,never.value);
  const allocated=emit(plan,body,'receiver_allocate',[frame],owner,{owner}),selected=action(plan,body,'receiver_bind',[frame,allocated],owner,{owner});
  const cursor=emit(plan,selected.block,'initialize_begin',[frame,selected.value],cursorView(owner),{owner});
  return {plan,frame,...selected,cursor};
}

test('weak current default is visible before init, but a completed definite definition keeps only real values',()=>{
  const member=field(B,'member'),input=fixture([reference(B,CB,[member])]),current=weakBase(input,B),{plan,frame,block,value,cursor}=current;
  const before=emit(plan,block,'field_load',[value],i32TypeId,{field:member.id}),one=emit(plan,block,'constant',[],i32TypeId,{decimal:'1',token:'1'}),
    copied=emit(plan,block,'value_copy',[one],i32TypeId,{type:i32TypeId}),next=emit(plan,block,'initialize_field',[cursor,value,copied],cursorView(B),{owner:B,field:member.id}),
    after=emit(plan,block,'field_load',[value],i32TypeId,{field:member.id});
  effect(plan,block,'initialize_end',[next,value],{owner:B});finish(plan,block,frame);
  const result=solve(input),context=root(result,CB,B);
  for(const ref of context.returned.refs)assert.equal(result.actual.objects.get(ref).weak,true);
  assert.deepEqual(tags(observed(result,plan,before)),[absence]);
  assert.deepEqual(tags(observed(result,plan,after)),[i32TypeId]);
  for(const ref of context.returned.refs)assert.deepEqual(tags(context.normalHeap.get(ref+'/field/'+member.id)),[i32TypeId]);
});

test('real helper store of undefined is historical contribution, not the temporary birth default',()=>{
  const member=field(B,'member'),input=fixture([reference(B,CB,[member])]),helper=input.plan('helper:real-undefined',absence,[B]);
  const missing=emit(helper,helper.entry,'undefined',[],absence);effect(helper,helper.entry,'field_store',[helper.entry.parameters[0],missing],{field:member.id});returns(helper,helper.entry,missing);
  const current=weakBase(input,B),{plan,frame,block,value,cursor}=current,called=invoke(plan,block,helper.owner.id,[value],absence),
    one=emit(plan,called.block,'constant',[],i32TypeId,{decimal:'1',token:'1'}),copied=emit(plan,called.block,'value_copy',[one],i32TypeId,{type:i32TypeId}),
    next=emit(plan,called.block,'initialize_field',[cursor,value,copied],cursorView(B),{owner:B,field:member.id}),
    loaded=emit(plan,called.block,'field_load',[value],i32TypeId,{field:member.id});
  effect(plan,called.block,'initialize_end',[next,value],{owner:B});finish(plan,called.block,frame);
  const result=solve(input);assert.deepEqual(tags(observed(result,plan,loaded)),[i32TypeId,absence].sort());
});

test('weak abrupt initialization keeps the defined prefix and the next missing field',()=>{
  const prefix=field(B,'prefix'),missing=field(B,'missing'),input=fixture([reference(B,CB,[prefix,missing])]),current=weakBase(input,B),{plan,frame,block,value,cursor}=current,
    one=emit(plan,block,'constant',[],i32TypeId,{decimal:'1',token:'1'}),copied=emit(plan,block,'value_copy',[one],i32TypeId,{type:i32TypeId}),
    next=emit(plan,block,'initialize_field',[cursor,value,copied],cursorView(B),{owner:B,field:prefix.id});
  const failing=input.plan('helper:throw-after-prefix',absence),thrown=emit(failing,failing.entry,'undefined',[],absence);effect(failing,failing.entry,'return_throw',[thrown]);
  const caught=plan.block([payload]),never=invoke(plan,block,failing.owner.id,[],absence,caught);effect(plan,never.block,'unreachable',[]);
  const get=action(plan,caught,'receiver_get',[frame],B,{owner:B}),first=emit(plan,get.block,'field_load',[get.value],i32TypeId,{field:prefix.id}),
    absent=emit(plan,get.block,'field_load',[get.value],i32TypeId,{field:missing.id});finish(plan,get.block,frame);
  const result=solve(input),binding=ownFrame(root(result,CB,B));assert.equal(binding.aborted,true);
  assert.deepEqual(tags(observed(result,plan,first)),[i32TypeId]);assert.deepEqual(tags(observed(result,plan,absent)),[absence]);
  assert.equal(result.actual.storageObservations.fields.get(missing.id).actualTypes.size,0);
});

// The following pure data control contrasts cover history and union/replacement
// states directly. They do not claim a Source AST/Facts admission or layout.
function birthCase(oldTags=[]){
  const input=fixture([reference(B,CB,[field(B,'member')]),reference(D,CD,[field(D,'own')],B),reference(U,CU)]),objects=new Map(),
    a=commonAbstract({...input.model,objects}),r=commonReceiverActual({spend:input.model.spend,types:input.model.types,objects},a),world=r.store(),heap=new Map(),ref='same-weak-allocation';
  const id=r.create(world,{activation:'unit',site:'birth',owner:B,construction:CB,newTarget:D,derived:false,fields:[B+'/member'],repeated:true}),
    selected=a.literal(D);selected.refs.add(ref);objects.set(ref,{type:D,weak:true});
  const previous=a.empty();for(const tag of oldTags)previous.tags.add(tag);if(oldTags.length)heap.set(ref+'/field/'+D+'/own',previous);
  r.birth(world,id,ref,[B+'/member',D+'/own'],heap,true);r.reconcile(world,heap,a.literal(absence));
  const bound=r.bind(world,new Set([id]),selected);assert.ok(bound.normal);const frames=bound.normal.frames,cursors=r.begin(frames,new Set([id]));
  return {input,a,r,identity:commonActualContextValues(a,commonRegions(input.model.spend),input.model.spend),frames,cursors,selected,heap,ref,id};
}

test('weak prior undefined remains while Base allocated D and Derived own initialization carries birth metadata',()=>{
  for(const oldTags of [[],[absence],[i32TypeId]]){
    const input=fixture([reference(B,CB),reference(D,CD,[field(D,'own')],B)]),objects=new Map(),a=commonAbstract(input.model),
      r=commonReceiverActual({spend:input.model.spend,types:input.model.types,objects},a),frames=r.store(),heap=new Map(),ref='weak:D',own=field(D,'own'),selected=a.literal(D);
    selected.refs.add(ref);objects.set(ref,{type:D,weak:true});
    const previous=a.empty();for(const tag of oldTags)previous.tags.add(tag);if(oldTags.length)heap.set(ref+'/field/'+own.id,previous);
    // The Base frame is a child of the already existing Derived frame.
    const parent=r.create(frames,{activation:'unit',site:'parent',owner:D,construction:CD,newTarget:D,derived:true,fields:[own.id],repeated:true}),
      child=r.child(frames,new Set([parent]),{activation:'unit',site:'base',owner:B,construction:CB,derived:false,fields:[],repeated:true});
    const childId=[...child][0];r.birth(frames,childId,ref,[own.id],heap,true);r.reconcile(frames,heap,a.literal(absence));
    const binding=r.bind(frames,new Set([parent]),selected);assert.ok(binding.normal);const next=binding.normal.frames,cursors=r.begin(next,new Set([parent]));
    const value=a.literal(i32TypeId);r.write(next,ref+'/field/'+own.id,value);r.define(next,cursors,selected,own.id);r.reconcile(next,heap,a.literal(absence));
    assert.deepEqual(tags(heap.get(ref+'/field/'+own.id)),[...new Set([...oldTags,i32TypeId])].sort());
    const control=a.empty();control.frames.add(parent);const copied=r.select(next,[control],heap);assert.equal(r.same(r.clone(copied),copied,commonActualContextValues(a,commonRegions(input.model.spend),input.model.spend)),true);
  }
});

test('a union selection or existing replacement U never receives a fresh definite cleanup',()=>{
  const {a,r,frames,cursors,selected,heap,ref}=birthCase(),one=a.literal(i32TypeId),other='replacement:U';
  selected.refs.add(other);selected.tags.add(U);heap.set(other+'/field/'+B+'/member',a.literal(absence));
  r.write(frames,ref+'/field/'+B+'/member',one);r.define(frames,cursors,selected,B+'/member');r.reconcile(frames,heap,a.literal(absence));
  assert.deepEqual(tags(heap.get(ref+'/field/'+B+'/member')),[i32TypeId,absence].sort());
  const replacement=a.literal(U);replacement.refs.add(other);r.define(frames,cursors,replacement,B+'/member');r.reconcile(frames,heap,a.literal(absence));
  assert.deepEqual(tags(heap.get(other+'/field/'+B+'/member')),[absence]);
});

test('birth defaults participate in copied/joined context identity, retained roots and feedback',()=>{
  const {a,r,identity,frames,cursors,selected,heap,ref,id}=birthCase([absence]),slot=ref+'/field/'+B+'/member',real=a.literal(i32TypeId);
  real.region={roots:new Set(['relation:historical']),opaque:false,empty:false,number:7};r.write(frames,slot,real);
  const before=r.clone(frames);r.define(frames,cursors,selected,B+'/member');
  assert.equal(r.same(frames,before,identity),false,'pending default is an independent control fact even if the heap has real undefined');
  const control=a.empty();control.frames.add(id);const projected=r.select(frames,[control],heap);
  assert.equal(r.same(projected,frames,identity),true);assert.equal(r.same(r.clone(projected),projected,identity),true);
  assert.equal(r.join(projected,before),true);assert.equal(r.same(projected,before,identity),true);
  r.feedback(frames,value=>{value.region={...value.region,opaque:true};});
  const retained=r.retained(frames,[control]);assert.ok(retained.some(value=>value.region.roots.has('relation:historical')&&value.region.opaque));
  assert.equal(r.same(frames,before,identity),false,'feedback transforms owned real contribution, not a discarded copy');
});

test('an existing strong fresh definition still overwrites its own earlier current-object store',()=>{
  const member=field(B,'member'),input=fixture([reference(B,CB,[member])]),plan=constructor(input,B),selected=allocateAndBind(plan),
    cursor=emit(plan,selected.block,'initialize_begin',[selected.frame,selected.value],cursorView(B),{owner:B}),
    missing=emit(plan,selected.block,'undefined',[],absence);
  effect(plan,selected.block,'field_store',[selected.value,missing],{field:member.id});
  const one=emit(plan,selected.block,'constant',[],i32TypeId,{decimal:'1',token:'1'}),copied=emit(plan,selected.block,'value_copy',[one],i32TypeId,{type:i32TypeId}),
    next=emit(plan,selected.block,'initialize_field',[cursor,selected.value,copied],cursorView(B),{owner:B,field:member.id}),
    loaded=emit(plan,selected.block,'field_load',[selected.value],i32TypeId,{field:member.id});
  effect(plan,selected.block,'initialize_end',[next,selected.value],{owner:B});finish(plan,selected.block,selected.frame);
  const result=solve(input);assert.deepEqual(tags(observed(result,plan,loaded)),[i32TypeId]);
  for(const ref of root(result,CB,B).returned.refs)assert.equal(result.actual.objects.get(ref).weak,false);
});

test('strong helper store consumes its current missing default before the scheduled field definition',()=>{
  const member=field(B,'member'),input=fixture([reference(B,CB,[member])]),helper=input.plan('helper:strong-before-define',i32TypeId,[B]),
    two=emit(helper,helper.entry,'constant',[],i32TypeId,{decimal:'2',token:'2'});
  effect(helper,helper.entry,'field_store',[helper.entry.parameters[0],two],{field:member.id});returns(helper,helper.entry,two);
  const plan=constructor(input,B),selected=allocateAndBind(plan),cursor=emit(plan,selected.block,'initialize_begin',[selected.frame,selected.value],cursorView(B),{owner:B}),
    completed=invoke(plan,selected.block,helper.owner.id,[selected.value],i32TypeId),
    before=emit(plan,completed.block,'field_load',[selected.value],i32TypeId,{field:member.id}),
    three=emit(plan,completed.block,'constant',[],i32TypeId,{decimal:'3',token:'3'}),copied=emit(plan,completed.block,'value_copy',[three],i32TypeId,{type:i32TypeId}),
    next=emit(plan,completed.block,'initialize_field',[cursor,selected.value,copied],cursorView(B),{owner:B,field:member.id});
  effect(plan,completed.block,'initialize_end',[next,selected.value],{owner:B});finish(plan,completed.block,selected.frame);
  const result=solve(input),actual=observed(result,plan,before);
  for(const ref of root(result,CB,B).returned.refs)assert.equal(result.actual.objects.get(ref).weak,false);
  assert.deepEqual(tags(actual),[i32TypeId]);assert.equal(actual.number,2,'helper-return read precedes the separate scheduled definition');
});

test('nested ordinary arguments retain exactly their reachable birth data, not a nonlive birth',()=>{
  const {a,r,frames,heap,ref,selected}=birthCase(),real=a.literal(i32TypeId);real.refs.add('real:reachable');
  r.write(frames,ref+'/field/'+B+'/member',real);r.reconcile(frames,heap,a.literal(absence));
  const container=a.literal(U);container.refs.add('container');heap.set('container/field/nested',selected);
  const cold=r.create(frames,{activation:'cold',site:'birth',owner:B,construction:CB,newTarget:B,derived:false,fields:[B+'/member'],repeated:true}),coldValue=a.literal(i32TypeId);
  coldValue.refs.add('real:nonlive');heap.set('cold-object/field/'+B+'/member',coldValue);r.birth(frames,cold,'cold-object',[B+'/member'],heap,true);
  const chosen=r.select(frames,[container],heap),retained=r.retained(chosen,[container],heap),live=r.retained(frames,[container],heap);
  assert.ok(retained.some(value=>value.refs.has('real:reachable')),'selected nested provenance retains its real Value');
  assert.ok(live.some(value=>value.refs.has('real:reachable')));assert.equal(live.some(value=>value.refs.has('real:nonlive')),false,'feedback must not treat the entire world as live');
});

test('unknown plus one known receiver does not consume a pending default through the new strong-store path',()=>{
  const member=field(B,'member'),boolean=sha256('tsfg.type\0bool'),unknown='unit:unknown',global={id:'global:unknown',sourceBinding:'binding:unknown',type:unknown},
    input=fixture([reference(B,CB,[member]),{id:boolean,kind:'scalar',name:'bool',fields:[]},{id:unknown,kind:'unknown',fields:[]}],[global]),
    helper=input.plan('helper:maybe-target',i32TypeId,[B]),two=emit(helper,helper.entry,'constant',[],i32TypeId,{decimal:'2',token:'2'});
  effect(helper,helper.entry,'field_store',[helper.entry.parameters[0],two],{field:member.id});returns(helper,helper.entry,two);
  const plan=input.plan(CB+'/body',B,[frameView(B),boolean],{ownerType:B,frame:true}),selected=allocateAndBind(plan),
    cursor=emit(plan,selected.block,'initialize_begin',[selected.frame,selected.value],cursorView(B),{owner:B}),yes=plan.block(),no=plan.block(),joined=plan.block([B]);
  operation(plan,selected.block,'cf.cond_br',[plan.entry.parameters[1]],null,{},[yes,no]);operation(plan,yes,'cf.br',[selected.value],null,{},[joined]);
  const foreign=emit(plan,no,'global_load',[],unknown,{global:global.id}),viewed=emit(plan,no,'view',[foreign],B);
  operation(plan,no,'cf.br',[viewed],null,{},[joined]);
  const completed=invoke(plan,joined,helper.owner.id,[joined.parameters[0]],i32TypeId),loaded=emit(plan,completed.block,'field_load',[selected.value],i32TypeId,{field:member.id}),
    three=emit(plan,completed.block,'constant',[],i32TypeId,{decimal:'3',token:'3'}),copied=emit(plan,completed.block,'value_copy',[three],i32TypeId,{type:i32TypeId}),
    next=emit(plan,completed.block,'initialize_field',[cursor,selected.value,copied],cursorView(B),{owner:B,field:member.id});
  effect(plan,completed.block,'initialize_end',[next,selected.value],{owner:B});finish(plan,completed.block,selected.frame);
  const result=solve(input),argument=observed(result,plan,joined.parameters[0]);assert.equal(argument.unknown,true);assert.equal(argument.refs.size,1);
  assert.deepEqual(tags(observed(result,plan,loaded)),[i32TypeId,absence].sort());
});
