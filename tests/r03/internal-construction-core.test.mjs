// SPDX-License-Identifier: MIT
// Literal admitted-inner-model/SSA preconditions only. These are compiler
// metadata equations, not Source/Facts, a Runtime Program/State or VM input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonConstructionPlans,requireCommonCoreConstructionPlans,commonPublicCoreRepresentation} from '../../compiler/common-program-construction-plans.mjs';
import {commonInternalConstructionPlans} from '../../compiler/common-program-internal-constructions.mjs';
import {commonConstructionPhysical} from '../../compiler/common-program-physical.mjs';
import {commonEffects,commonEffectsCover,commonFacets} from '../../compiler/common-program-effects.mjs';
import {commonPublicObservationContexts} from '../../compiler/common-program-observation-contexts.mjs';
import {printCommonFunction} from '../../compiler/common-program-print.mjs';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonMethods} from '../../compiler/common-program-methods.mjs';
import {commonMeter,sha256} from '../../compiler/common-program-common.mjs';
import {i32TypeId} from '../../compiler/identity.mjs';
import {signatureId} from '../../compiler/module-callable-common.mjs';

const B='literal:B',C='literal:C',D='literal:D',G='literal:G',callback='source:callback',factory='source:factory',
  range={start:1,end:2},origin={source:'/internal-construction.ts',...range};
const num=()=>({kind:'numericLiteral',type:i32TypeId,token:'1',decimal:'1',range});
const fn=(id,returnType,body)=>({id,name:id,kind:'source',ownerType:null,sourceBinding:id,returnType,parameters:[],bindings:[],body,
  receiverBinding:null,sourcePath:origin.source,range,nameRange:range,signatureHash:signatureId({parameters:[],returns:returnType}),
  captures:[],lexicalParent:null,lexicalEnvironment:null,activationEnvironment:null});
const nominal=(id,fields=[],base=null)=>({id,kind:'reference',fields,methods:[],...(base?{base}:{}),
  construction:{id:id+'/ctor',kind:base?'implicit-derived':'implicit-base',functionId:null,origin,parameters:[],
    initializationFields:fields.map(field=>field.id),signature:{parameters:[],returnType:id},implicitForward:base?{target:base+'/ctor'}:null}});
const create=type=>({kind:'new',type:type.id,callee:type.id,construction:type.construction.id,range,signature:type.construction.signature,arguments:[]});
const field=(owner,name,type,initializer)=>({id:owner+'/'+name,sourceBinding:owner+'/'+name,name,type,origin,initializer,readonly:false});
function fixture(cyclic=false) {
  const b=nominal(B),c=nominal(C),d=nominal(D,[],B),callee=fn(callback,i32TypeId,[{kind:'return',range,value:num()}]),
    invoke={kind:'call',type:i32TypeId,callee:callback,arguments:[],signature:{parameters:[],returnType:i32TypeId},range};
  b.fields.push(field(B,'permission',i32TypeId,invoke));
  if(cyclic){b.fields.push(field(B,'child',C,create(c)));c.fields.push(field(C,'child',B,create(b)));}
  else d.fields.push(field(D,'child',C,create(c)));
  for(const type of [b,c,d])type.construction.initializationFields=type.fields.map(field=>field.id);
  const caller=fn(factory,cyclic?B:D,[{kind:'return',range,value:create(cyclic?b:d)}]),
    rows=[{id:i32TypeId,kind:'scalar',name:'i32'},{id:sha256('tsfg.type\0undefined'),kind:'undefined'},
      {id:sha256('tsfg.type\0void'),kind:'void'},b,c,d],owners=[callee,caller],
    global={id:G,sourceBinding:'binding:G',name:'G',type:i32TypeId,writable:true,range},spend=commonMeter(1000000),
    fields=new Map(),bindings=new Map([[global.sourceBinding,{id:global.sourceBinding,type:i32TypeId,role:'global'}]]);
  for(const type of [b,c,d])for(const row of type.fields){fields.set(row.id,{...row,owner:type.id});bindings.set(row.sourceBinding,{id:row.sourceBinding,type:row.type,role:'field'});}
  const hir={types:rows,functions:owners,globals:[global],modules:[],environments:[],hostImports:[],hostContext:null,
    snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[]}},
    model={hir,types:new Map(rows.map(row=>[row.id,row])),fields,bindings,functions:new Map(owners.map(row=>[row.id,row])),globals:new Map([[G,global]]),
      environments:new Map(),hosts:new Map(),slots:new Map(),spend,callables:commonTargets(hir,spend),methods:commonMethods(hir,spend),
      schema:'literal:internal-core4',payload:'payload:literal:internal-core4',cell:id=>'cell:'+id,
      limits:{parameters:64,registersPerFunction:4096,blocksPerFunction:256,instructionsPerFunction:8192,bytes:8388608,work:1000000}};
  // Independent fixed permissions: callback's present body has no G write,
  // but every caller must retain this allowed fixed write through helpers.
  const upper=()=>({globals:{reads:[],writes:[G]},hostResources:{reads:[],writes:[]},parameters:[],captures:[],
    facets:Object.fromEntries(commonFacets.map(flag=>[flag,flag!=='unknownHost']))}),
    records=new Map(owners.map(owner=>[owner.id,{functionId:owner.id,signatureHash:owner.signatureHash,upper:upper(),
      callables:{parameters:[],returns:null,slotWrites:[]},digest:sha256('literal-fixed-record:'+owner.id)}]));
  return {model,hir,records,callee,caller,program:commonConstructionPlans(model,owners)};
}
const physical=(program,records,borrowProof=false)=>commonConstructionPhysical(program,records,{borrowProof,storageAuthoring:true});
const instructions=plan=>plan.graph.blocks.flatMap(block=>block.instructions);

test('complete public records support acyclic private roots and private-to-public calls without new published rows',()=>{
  const {program,records,hir}=fixture(),result=physical(program,records),projection=commonPublicObservationContexts(result.values.actual.contexts,program.model.spend),
    representation=commonPublicCoreRepresentation(result,result.carriers);
  assert.equal(commonInternalConstructionPlans(program).length,0);assert.deepEqual(representation.internalConstructors,[]);
  assert.deepEqual(representation.functions.map(row=>row.id).sort(),[callback,factory].sort());assert.equal(records.size,2);assert.equal(hir.functions.length,2);
  const generated=[...result.values.actual.contexts.values()].filter(context=>context.plan.owner.analysisOnly);
  assert.ok(generated.some(context=>context.root&&context.plan.owner.ownerType===D));
  assert.ok(generated.some(context=>!context.root&&context.plan.owner.ownerType===B),'derived private root invokes its private base');
  assert.ok(generated.some(context=>!context.root&&context.plan.owner.ownerType===C),'derived own initializer invokes another private construction');
  const called=[...result.values.actual.contexts.values()].filter(context=>context.plan.owner.id===callback&&!context.root);
  assert.ok(called.some(context=>projection.has(context.id)),'public inline caller keeps its ordinary activation');
  assert.ok(called.some(context=>!projection.has(context.id)),'private-root-exclusive public activation remains excluded from public proof');
});

test('cyclic public construction emits exactly its transitive helper definitions and separate complete directory',()=>{
  const {program,records,hir}=fixture(true),result=physical(program,records),emitted=requireCommonCoreConstructionPlans(program),
    representation=commonPublicCoreRepresentation(result,result.carriers),ids=new Set(emitted.map(plan=>plan.owner.id));
  assert.deepEqual(representation.internalConstructors.map(row=>row.owner),[B,C]);assert.equal(ids.size,4);
  assert.equal(representation.functions.length,2);assert.equal(records.size,2);assert.equal(hir.functions.length,2);
  for(const plan of emitted)for(const op of instructions(plan))if(op.name==='tsfg_program.invoke')assert.equal(ids.has(op.properties.function_id),true);
  for(const row of representation.internalConstructors){assert.equal(row.id,'analysis-construction:'+row.construction);assert.deepEqual(row.bindings,[]);
    assert.deepEqual(row.parameters,['receiver:'+row.owner]);assert.equal(records.has(row.id),false);assert.equal(representation.functions.some(fn=>fn.id===row.id),false);}
  for(const plan of emitted.filter(plan=>plan.owner.analysisOnly))assert.equal(instructions(plan).some(op=>op.name==='tsfg_program.fuel'),false);
  const text=emitted.map(plan=>printCommonFunction(plan,result.model,result.carriers)).join('\n');
  assert.equal((text.match(/role = "implicit-construction-helper"/g)??[]).length,2);
  assert.equal((text.match(/tsfg_program\.fuel/g)??[]).length,2,'public semantic entry fuel remains unchanged');
  assert.throws(()=>physical(fixture(true).program,records,true),error=>error instanceof Error&&'code' in error&&error.code==='r03-common-program-construction-borrow-open');
});

test('constructor effect SCCs compose the full fixed public upper and preserve real public dependencies',()=>{
  const {program,hir,records,callee,caller}=fixture(true),result=physical(program,records),effects=commonEffects(hir,program.model.spend,result),
    uppers=new Map([...records].map(([id,row])=>[id,row.upper])),body=effects.derive(caller,uppers),own=effects.derive(callee,uppers);
  assert.deepEqual(own.upper.globals.writes,[],'the callback body is strictly narrower than its fixed permission');
  assert.deepEqual(body.upper.globals.writes,[G],'cyclic helper composition consumes the broad fixed permission');
  assert.deepEqual([...new Set(body.calls.map(call=>call.target))],[callback]);
  assert.equal(body.calls.some(call=>call.target.startsWith('analysis-construction:')),false,'dependency digests only name real public contracts');
  assert.equal(commonEffectsCover(records.get(factory).upper,body.upper,program.model.spend),true);
  const narrow={...records.get(factory).upper,globals:{reads:[],writes:[]}};
  assert.equal(commonEffectsCover(narrow,body.upper,program.model.spend),false,'narrow caller cap is rejected by the unchanged containment boundary');
  const missing=new Map(uppers);missing.delete(callback);
  assert.throws(()=>effects.derive(caller,missing),error=>error instanceof Error&&'code' in error&&error.code==='r03-common-program-publication');
});

test('internal definition ownership cannot hide a real public identity',()=>{
  const {program}=fixture(true),target=program.construction.privateCoreCalls[0].target,plan=program.plans.find(plan=>plan.owner.id===target);
  assert.ok(plan);program.construction.publicFunctions.add(target);
  assert.throws(()=>commonInternalConstructionPlans(program),error=>error instanceof Error&&'code' in error&&error.code==='r03-common-program-construction');
});

// These are Source effect-domain premises only. Views retain payload owners;
// the fixture supplies neither actual tags nor an M12 route/admission proof.
function replacementEffects({argument=false,returnAlias=true,definition='assignment',fresh=false}={}) {
  const U='literal:ReplacementU',baseId='source:replacement-base',derivedId='source:replacement-derived',callerId='source:replacement-caller',
    param=(id,type)=>({id,name:id,kind:'parameter',type,writable:true,range,nameRange:range}),
    s=param(baseId+'/s',i32TypeId),p=param(callerId+'/p',U),v=param(derivedId+'/v',i32TypeId),
    binding=parameter=>({kind:'bindingReference',binding:parameter.id,type:parameter.type,range}),
    cast=(value,type)=>({kind:'as',type,expression:value,operator:'as',range,annotationRange:range,operatorRange:range}),
    base=nominal(B),derived=nominal(D,[],B),actual=nominal(U,[],D),
    first=field(D,'payload',i32TypeId,num()),target={kind:'fieldTarget',type:i32TypeId,receiver:{kind:'thisReference',type:D,range},property:first.id,range},
    trigger=field(D,'trigger',i32TypeId,{kind:'fieldAssignment',type:i32TypeId,operator:'=',target,value:num(),range});
  derived.fields=definition==='assignment'?[first,trigger]:[field(D,'payload',i32TypeId,definition==='literal'?num():null)];
  const baseOwner={...fn(baseId,B,argument&&returnAlias?[{kind:'return',range,value:cast(binding(s),B)}]
      :!argument&&!fresh?[{kind:'return',range,value:{kind:'globalReference',global:G,type:U,range}}]:[]),
      kind:'construction-body',ownerType:B,receiverBinding:'this:'+baseId,parameters:argument?[s]:[],
      signatureHash:signatureId({parameters:argument?[i32TypeId]:[],returns:B})};
  base.construction.kind='explicit';base.construction.functionId=baseId;
  base.construction.parameters=argument?[{symbol:s.id,type:i32TypeId,origin}]:[];base.construction.signature={parameters:argument?[i32TypeId]:[],returnType:B};
  derived.construction.parameters=argument?[{symbol:D+'/s',inheritedFrom:s.id,type:i32TypeId,origin}]:[];
  derived.construction.signature={parameters:argument?[i32TypeId]:[],returnType:D};
  const owners=[baseOwner];
  if(definition==='parameter-property'){
    const property={...derived.fields[0],parameterBinding:v.id};derived.fields=[property];derived.construction.kind='explicit';derived.construction.functionId=derivedId;
    derived.construction.implicitForward=null;
    derived.construction.parameters=[{symbol:v.id,type:i32TypeId,origin}];derived.construction.signature={parameters:[i32TypeId],returnType:D};
    owners.push({...fn(derivedId,D,[{kind:'expression',range,value:{kind:'superConstruct',type:sha256('tsfg.type\0void'),callee:B,
      construction:base.construction.id,signature:base.construction.signature,arguments:[],range}}]),kind:'construction-body',ownerType:D,
      receiverBinding:'this:'+derivedId,parameters:[v],signatureHash:signatureId({parameters:[i32TypeId],returns:D})});
  }
  for(const type of [base,derived,actual])type.construction.initializationFields=type.fields.map(row=>row.id);
  actual.construction.parameters=derived.construction.parameters.map((row,index)=>({...row,symbol:U+'/parameter/'+index,inheritedFrom:row.symbol}));
  actual.construction.signature={parameters:[...derived.construction.signature.parameters],returnType:U};
  const value={...create(derived),arguments:argument?[cast(binding(p),i32TypeId)]:definition==='parameter-property'?[num()]:[]},
    caller={...fn(callerId,D,[{kind:'return',range,value}]),parameters:argument?[p]:[],signatureHash:signatureId({parameters:argument?[U]:[],returns:D})};
  owners.push(caller);
  const hir={types:[{id:i32TypeId,kind:'scalar',name:'i32'},{id:sha256('tsfg.type\0void'),kind:'void'},base,derived,actual],functions:owners,
    globals:argument?[]:[{id:G,sourceBinding:'binding:'+G,type:U,writable:true}],modules:[],environments:[],hostImports:[],hostContext:null,
    snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[]}},spend=commonMeter(1000000),effects=commonEffects(hir,spend),
    upper=owner=>({globals:{reads:argument||fresh?[]:[G],writes:owner.id===baseId?[]:argument||fresh?[]:[G]},hostResources:{reads:[],writes:[]},captures:[],
      parameters:effects.ownerParameters(owner).map((_,index)=>({index,read:true,write:owner.id===callerId,structural:false})),
      facets:Object.fromEntries(commonFacets.map(flag=>[flag,flag!=='unknownHost']))}),uppers=new Map(owners.map(owner=>[owner.id,upper(owner)]));
  return {U,hir,spend,effects,uppers,caller,baseOwner,baseType:base,derivedOwner:owners.find(owner=>owner.id===derivedId),cast,binding,param};
}

test('scalar views preserve replacement argument owners and scalar formal/capture entry roots',()=>{
  for(const returnAlias of [true,false]){
    const {effects,uppers,caller,spend}=replacementEffects({argument:true,returnAlias}),body=effects.derive(caller,uppers).upper,
      fixed=uppers.get(caller.id),narrow={...fixed,parameters:fixed.parameters.map(row=>({...row,write:false}))};
    assert.equal(body.parameters[0].write,true,'an as-i32 operand still owns its actual U payload');
    assert.equal(commonEffectsCover(fixed,body,spend),true);assert.equal(commonEffectsCover(narrow,body,spend),false);
  }
  const globalView=replacementEffects(),global=globalView.hir.globals[0];global.type=i32TypeId;
  globalView.baseOwner.body=[{kind:'return',range,value:globalView.cast({kind:'globalReference',global:G,type:i32TypeId,range},B)}];
  const globalSpend=commonMeter(1000000),globalEffects=commonEffects(globalView.hir,globalSpend),globalBody=globalEffects.derive(globalView.caller,globalView.uppers).upper,
    globalFixed=globalView.uppers.get(globalView.caller.id);
  assert.deepEqual(globalBody.globals.writes,[G],'a scalar global view cannot prove its payload primitive');
  assert.equal(commonEffectsCover(globalFixed,globalBody,globalSpend),true);
  assert.equal(commonEffectsCover({...globalFixed,globals:{...globalFixed.globals,writes:[]}},globalBody,globalSpend),false);
  const input=replacementEffects({argument:true}),{U,hir,param,cast,binding}=input,
    scalarParam=param('source:scalar-formal/s',i32TypeId),slot='slot:scalar-capture',capturedBinding='binding:scalar-capture',
    write=receiver=>({kind:'fieldAssignment',type:i32TypeId,operator:'=',target:{kind:'fieldTarget',type:i32TypeId,
      receiver:cast(receiver,U),property:D+'/payload',range},value:num(),range}),
    scalar={...fn('source:scalar-formal',i32TypeId,[{kind:'return',range,value:write(binding(scalarParam))}]),parameters:[scalarParam],
      signatureHash:signatureId({parameters:[i32TypeId],returns:i32TypeId})},
    parentParam=param('source:capture-parent/p',U),parent={...fn('source:capture-parent',i32TypeId,[
      {kind:'letDeclaration',binding:capturedBinding,initializer:cast(binding(parentParam),i32TypeId),range},
      {kind:'functionDeclaration',functionId:'source:scalar-capture',range},{kind:'return',range,value:num()}]),parameters:[parentParam],
      bindings:[{...param(capturedBinding,i32TypeId),kind:'let',writable:true}],activationEnvironment:'environment:scalar-capture',
      signatureHash:signatureId({parameters:[U],returns:i32TypeId})},
    captured={...fn('source:scalar-capture',i32TypeId,[{kind:'return',range,value:write({kind:'bindingReference',binding:capturedBinding,type:i32TypeId,range})}]),
      lexicalParent:parent.id,lexicalEnvironment:parent.activationEnvironment,captures:[{binding:capturedBinding,read:true,write:false}]},
    extended={...hir,functions:[...hir.functions,scalar,parent,captured],environments:[{id:parent.activationEnvironment,owner:parent.id,parent:null,
      slots:[{binding:capturedBinding,key:slot,type:i32TypeId,writable:true,kind:'let'}]}]},spend=commonMeter(1000000);
  const localOnly=field(B,'local-only',i32TypeId,num()),baseType=input.baseType;
  baseType.fields.push(localOnly);baseType.construction.initializationFields.push(localOnly.id);
  input.baseOwner.body.unshift({kind:'expression',range,value:{kind:'fieldAssignment',type:i32TypeId,operator:'=',
    target:{kind:'fieldTarget',type:i32TypeId,receiver:{kind:'thisReference',type:B,range},property:localOnly.id,range},value:num(),range}});
  const effects=commonEffects(extended,spend),
    rows=new Map([...input.uppers]),scalarUpper={...effects.blank(scalar),parameters:[{index:0,read:true,write:true,structural:false}],
      facets:Object.fromEntries(commonFacets.map(flag=>[flag,flag!=='unknownHost']))},
    captureUpper={...effects.blank(captured),captures:[{slot,read:true,write:true,structural:false}],facets:scalarUpper.facets};
  rows.set(scalar.id,scalarUpper);rows.set(parent.id,effects.blank(parent));rows.set(captured.id,captureUpper);
  const scalarBody=effects.derive(scalar,rows).upper,captureBody=effects.derive(captured,rows).upper;
  assert.equal(scalarBody.parameters[0].write,true);assert.equal(commonEffectsCover(scalarUpper,scalarBody,spend),true);
  assert.equal(commonEffectsCover({...scalarUpper,parameters:[{index:0,read:true,write:false,structural:false}]},scalarBody,spend),false);
  assert.equal(captureBody.captures.find(row=>row.slot===slot).write,true);assert.equal(commonEffectsCover(captureUpper,captureBody,spend),true);
  assert.equal(commonEffectsCover({...captureUpper,captures:[{slot,read:true,write:false,structural:false}]},captureBody,spend),false);
  const baseBody=effects.derive(input.baseOwner,rows).upper;
  assert.equal(baseBody.parameters[0].write,false,'the hidden constructor Frame is not an input object owner');
});

test('every own field definition writes a replacement receiver while fresh-only construction has no external write',()=>{
  for(const definition of ['literal','default','parameter-property'])for(const fresh of [false,true]){
    const {effects,uppers,caller,derivedOwner,spend}=replacementEffects({definition,fresh}),owner=derivedOwner??caller,
      body=effects.derive(owner,uppers).upper,fixed=uppers.get(owner.id),narrow={...fixed,globals:{...fixed.globals,writes:[]}};
    assert.deepEqual(body.globals.writes,fresh?[]:[G],definition+' defines a field on the selected receiver');
    assert.equal(commonEffectsCover(fixed,body,spend),true);
    assert.equal(commonEffectsCover(narrow,body,spend),fresh,'read-only replacement bound must reject the define/store itself');
  }
});

test('explicit base initializer backedges terminate while consuming the complete fixed public constructor upper',()=>{
  const base=nominal(B),ctorId='source:recursive-explicit-base',callerId='source:recursive-explicit-caller',
    ctor={...fn(ctorId,B,[]),kind:'construction-body',ownerType:B,receiverBinding:'this:'+ctorId};
  base.construction.kind='explicit';base.construction.functionId=ctorId;
  base.fields=[field(B,'child',B,create(base))];base.construction.initializationFields=base.fields.map(row=>row.id);
  const caller=fn(callerId,B,[{kind:'return',range,value:create(base)}]),
    hir={types:[base],functions:[ctor,caller],globals:[{id:G,sourceBinding:'binding:'+G,type:B,writable:true}],
      modules:[],environments:[],hostImports:[],hostContext:null,
      snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[]}},
    spend=commonMeter(1000000),effects=commonEffects(hir,spend),
    fixed=owner=>({...effects.blank(owner),globals:{reads:[],writes:[G]},
      facets:Object.fromEntries(commonFacets.map(flag=>[flag,flag!=='unknownHost']))}),
    uppers=new Map([[ctorId,fixed(ctor)],[callerId,fixed(caller)]]),body=effects.derive(caller,uppers);
  assert.deepEqual(ctor.body,[],'the present public constructor body does not supply the fixed G write');
  assert.deepEqual(body.upper.globals.writes,[G],'the explicit backedge consumes the archived upper, not a body-derived substitute');
  assert.deepEqual([...new Set(body.calls.map(call=>call.target))],[ctorId]);
  assert.equal(body.calls.some(call=>call.target.startsWith('analysis-construction:')),false);
  assert.equal(commonEffectsCover(uppers.get(callerId),body.upper,spend),true);
  assert.equal(commonEffectsCover({...uppers.get(callerId),globals:{reads:[],writes:[]}},body.upper,spend),false);
  const missing=new Map(uppers);missing.delete(ctorId);
  assert.throws(()=>effects.derive(caller,missing),error=>error instanceof Error&&'code' in error&&error.code==='r03-common-program-publication');
});
