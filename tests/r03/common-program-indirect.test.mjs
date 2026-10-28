// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildHir,printHir,readHir,lowerHir} from '../../compiler/hir.mjs';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,printCommonProgramHir,readCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {callableTargetDomain} from '../../compiler/callable-target-domain.mjs';
import {lexicalEnvironmentLayouts} from '../../compiler/lexical-environment-layouts.mjs';
import {signatureId} from '../../compiler/module-callable-common.mjs';
import {signatureId as sourceSignatureId} from '../../compiler/typed-array-schema.mjs';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {verifyCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {commonEffects,commonFacets} from '../../compiler/common-program-effects.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {commonProgramValues} from '../../compiler/common-program-values.mjs';
import {createCommonProgramPublication,verifyCommonKernelGroup} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
const facts=name=>readCommonProgramFacts(readFileSync(new URL('./'+name+'.json',import.meta.url)));
for(const name of ['common-indirect-valid','common-indirect-broad-valid','common-indirect-inline-valid'])test('actual Source2 cold/owned '+name,()=>{
  const p=facts(name),hir=projectCommonProgram(p);assert.equal(hir.functions.length,11);assert.equal(hir.environments.length,1);
  const factory=hir.functions.find(fn=>fn.name==='factory'),bump=hir.functions.find(fn=>fn.name==='bump');assert.equal(bump.lexicalParent,factory.id);
  assert.equal(bump.captures.length,1);assert.equal(hir.environments[0].owner,factory.id);assert.equal(bump.lexicalEnvironment,factory.activationEnvironment);
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  const derived=commonTargets(hir,commonMeter()),apply=hir.functions.find(fn=>fn.name==='apply');
  assert.equal(derived.contracts.get(apply.id).parameters[0].allowed.functions.length,name.includes('broad')?2:1);
});

test('actual Source2 physical pair and factory activations',()=>{
  const hir=projectCommonProgram(facts('common-indirect-valid')),physical=commonProgramPhysical(hir),factory=hir.functions.find(fn=>fn.name==='factory'),bump=hir.functions.find(fn=>fn.name==='bump');
  assert.equal(physical.plans.length,12);assert.equal(physical.carriers.layout(hir.types.find(t=>t.kind==='function').id).byteSize,40);
  const allocations=[...physical.values.actual.objects].filter(([,o])=>o.type==='env:'+factory.activationEnvironment);assert(allocations.length>=3);
  const bumpContexts=[...physical.values.actual.contexts.values()].filter(c=>c.plan.owner.id===bump.id);
  const factories=[...physical.values.actual.contexts.values()].filter(c=>c.plan.owner.id===factory.id&&!c.root);assert.equal(factories.length,2);assert.equal(new Set(factories.flatMap(c=>[...c.returned.pairs.values()].map(pair=>pair.environment))).size,2);
  assert(bumpContexts.length>=3);const environments=new Set(bumpContexts.flatMap(c=>[...c.args[0].refs]));assert(environments.size>=2);
});

test('actual Source2 fixed upper singleton kernels and complete Core3',()=>{
  const hir=projectCommonProgram(facts('common-indirect-valid')),publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  assert.equal(publication.format.version,2);verifyCommonKernelGroup(hir,publication,request);
  const core=emitCommonProgramCore(hir,publication,request);assert.match(core,/version = 3 : i32/);assert.match(core,/tsfg_program.invoke_indirect/);assert.match(core,/tsfg_program.env_alloc/);assert.match(core,/tsfg_program.make_closure/);
  assert.equal((core.match(/func.func @/g)??[]).length,12);
});
test('actual Source2 broad apply keeps full Published upper conflict',()=>{
  const hir=projectCommonProgram(facts('common-indirect-broad-valid')),publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  assert.throws(()=>verifyCommonKernelGroup(hir,publication,request),/** @param {any} e */e=>e.code==='r03-common-program-kernel-conflict');
});

test('real Source2 public build/read/lower boundary and fixed transfers',()=>{
 const first=facts('common-indirect-valid'),second=facts('common-indirect-broad-valid'),hir=projectCommonProgram(first),broad=projectCommonProgram(second);
 const context={family:'tsfg.common-program-context-candidate',version:2,factsBytes:readFileSync(new URL('./common-indirect-valid.json',import.meta.url)),expectedPackageId:first.packageId};
 assert.deepEqual(validateFrontendSnapshot(first),first);const built=buildHir(first,context);assert.equal(built.status,'ok',JSON.stringify(built));assert.deepEqual(built.hir,hir);assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
 const publication=createCommonProgramPublication(hir),upper=createCommonProgramPublication(broad),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
 assert.equal(publication.scopeDigest,upper.scopeDigest);assert.throws(()=>verifyCommonKernelGroup(broad,publication,request),/** @param {any} e */e=>e.code==='r03-common-program-callable-contract');
 assert.throws(()=>verifyCommonKernelGroup(hir,upper,request),/** @param {any} e */e=>e.code==='r03-common-program-kernel-conflict');
 assert.match(lowerHir(hir,context,{publication,request}),/tsfg_program.invoke_indirect/);
});

const rehashFacts=value=>{value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(value.payload));return value;};
const rehashPublication=value=>{for(const row of value.contracts){const {digest,...body}=row;row.digest=commonIdentity('published-contract',body);}value.expectedDigest=commonIdentity('publication',{scopeDigest:value.scopeDigest,contracts:value.contracts});return value;};
test('actual shadow Program captures direct outer Symbol while retaining inner block',()=>{
 const raw=facts('common-indirect-shadow-valid'),hir=projectCommonProgram(raw),factory=hir.functions.find(fn=>fn.name==='factory'),bump=hir.functions.find(fn=>fn.name==='bump');
 const outer=factory.body.find(row=>row.kind==='letDeclaration').binding,inner=factory.body.find(row=>row.kind==='block').body[0].binding;
 assert.notEqual(outer,inner);assert.equal(bump.captures[0].binding,outer);assert.equal(hir.environments[0].slots[0].binding,outer);
 const physical=commonProgramPhysical(hir);assert.equal(physical.plans.length,12);
 const changed=structuredClone(raw),wrong=changed.payload.functions.find(fn=>fn.name==='factory').bindings.filter(b=>b.name==='n').find(b=>b.id!==outer),nested=changed.payload.functions.find(fn=>fn.name==='bump');
 nested.captures[0].binding=wrong.id;for(const row of nested.body){const visit=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(key==='binding'&&child===outer)value[key]=wrong.id;else if(child&&typeof child==='object')visit(child);}};visit(row);}
 assert.throws(()=>verifyCommonProgramFacts(rehashFacts(changed)),/** @param {any} e */e=>['r03-common-program-binding','r03-common-program-capture'].includes(e.code));
});
for(const [label,mutate,code]of /** @type {[string,(p:any)=>void,string][]} */([
 ['function type identity',p=>{p.types.find(t=>t.kind==='function').id='sha256:'+'0'.repeat(64);},'function-type'],
 ['lexical owner',p=>{p.functions.find(fn=>fn.name==='factory').bindings[0].lexicalOwner=null;},'lexical'],
 ['parent cycle',p=>{const fn=p.functions.find(fn=>fn.name==='bump');fn.lexicalParent=fn.id;},'lexical'],
 ['capture occurrence',p=>{p.functions.find(fn=>fn.name==='bump').captures[0].occurrences[0].write=false;},'capture']
]))test('cold Source2 rejects false '+label,()=>{const changed=structuredClone(facts('common-indirect-valid'));mutate(changed.payload);assert.throws(()=>verifyCommonProgramFacts(rehashFacts(changed)),/** @param {any} e */e=>e.code==='r03-common-program-'+code);});
test('fixed capture permission cannot be hidden behind false managed facet',()=>{
 const hir=projectCommonProgram(facts('common-indirect-valid')),publication=structuredClone(createCommonProgramPublication(hir)),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
 publication.contracts.find(row=>row.functionId===request.targets[0]).upper.captures=[{slot:hir.environments[0].slots[0].key,read:true,write:false,structural:false}];
 assert.throws(()=>verifyCommonKernelGroup(hir,rehashPublication(publication),request),/** @param {any} e */e=>e.code==='r03-common-program-kernel-capability');
});
test('lowering-only normalized model saves callee SSA before an argument rebind',()=>{
 // A private SSA ordering probe, not a fabricated Source packet or Source type qualification.
 const type='callable-model',left='left',right='right',range={start:0,end:1},owner={id:'model',range},model={spend:commonMeter(),types:new Map([[type,{kind:'function'}]]),bindings:new Map([['f',{type}]]),functions:new Map([[left,{id:left,signatureHash:'left-sig',lexicalEnvironment:null}],[right,{id:right,signatureHash:'right-sig',lexicalEnvironment:null}]]),slots:new Map(),environments:new Map(),limits:{registersPerFunction:100,instructionsPerFunction:100,blocksPerFunction:10}},graph=createCommonGraph(model,owner),state={current:graph.newBlock(),cells:new Map(),environments:new Map()};
 const cell=graph.emit(state.current,'cell',[],'cell:f',{binding:'f'},range);state.cells.set('f',cell);/** @type {{callee:any,args:any[]}[]} */const calls=[];
 const values=commonProgramValues(model,graph,state,()=>{throw Error('unexpected direct call');},(expression,callee,args)=>{calls.push({callee,args});return args[0];});
 values.expression({kind:'indirectCall',type,range,expression:{kind:'bindingReference',binding:'f',type,range},signature:{parameters:[type],returnType:type},arguments:[{kind:'bindingAssignment',type,range,operator:'=',target:{kind:'bindingTarget',binding:'f',type,range},value:{kind:'functionReference',functionId:right,type,range}}]});
 const call=calls[0];assert.ok(call);const ops=state.current.instructions,loaded=ops.find(op=>op.name==='tsfg_program.load'),write=ops.find(op=>op.name==='tsfg_program.store');assert.equal(call.callee.name,loaded.result);assert(ops.indexOf(loaded)<ops.indexOf(write));assert.equal(ops.filter(op=>op.name==='tsfg_program.load').length,1);
});

for(const indirect of [false,true])test('owned model preserves ReadSpan return owner through '+(indirect?'indirect':'direct')+' call',()=>{
 // An isolated owned effect-transfer model, not a Source package or execution.
 const range={start:0,end:1},span='span',array='array',scalar='i32-model',callable='callable',borrow={id:'borrow',name:'borrow',kind:'source',returnType:span,parameters:[{id:'s',type:span}],bindings:[],captures:[],body:[],range,sourcePath:'/model.ts'},caller={id:'caller',kind:'source',returnType:span,parameters:[{id:'a',type:array}],bindings:[],captures:[],body:[],range,sourcePath:'/model.ts'};
 const argument={kind:'call',callee:'intrinsic:readSpan',type:span,range,arguments:[{kind:'bindingReference',binding:'a',type:array,range}]},value={kind:indirect?'indirectCall':'call',callee:'borrow',expression:{kind:'functionReference',functionId:'borrow',type:callable,range},type:span,range,arguments:[argument]};caller.body=[{kind:'return',value,range}];
 const hir={types:[{id:scalar,kind:'scalar'},{id:span,kind:'readSpan',elementType:scalar},{id:array,kind:'array',elementType:scalar},{id:callable,kind:'function',parameters:[span],returnType:span}],functions:[borrow,caller],globals:[],environments:[],snapshot:{payload:{compatibilityWitnesses:[]}}},physical={model:{callables:{site:()=>({top:false,functions:['borrow']})}},references:new Map(),escaping:new Map()},effects=commonEffects(hir,commonMeter(),physical),upper={captures:[],globals:{reads:[],writes:[]},parameters:[{index:0,read:true,write:false,structural:false}],facets:Object.fromEntries(commonFacets.map(key=>[key,key==='managedReference']))};
 assert.throws(()=>effects.derive(caller,new Map([['borrow',upper]])),/** @param {any} e */e=>e.code==='r03-common-program-readspan-return-escape');
});

test('owned target model transfers callable arguments to every effective method and constructor',()=>{
 const i32='i32-model',callable='unary-model',range={start:0,end:1},sig=signatureId({parameters:[],returns:i32}),leaf={id:'leaf',kind:'source',signatureHash:sig,parameters:[],bindings:[],returnType:i32,body:[]},base={id:'base',kind:'reference',sourceType:'base',fields:[],methods:['mBase']},derived={id:'derived',kind:'reference',sourceType:'derived',fields:[],methods:['mDerived'],base:'base',construction:{functionId:'ctor'}};
 const method=(id,owner,overrideTarget)=>({id,kind:'method',sourceBinding:id,ownerType:owner,name:'m',overrideTarget,signatureHash:id,parameters:[{id:id+'-f',type:callable}],returnType:i32,body:[{kind:'return',range,value:{kind:'indirectCall',type:i32,range,expression:{kind:'bindingReference',binding:id+'-f',type:callable,range},signature:{parameters:[],returnType:i32},arguments:[]}}]});
 const ctor={id:'ctor',kind:'construction-body',sourceBinding:'ctor',parameters:[{id:'ctor-f',type:callable}],returnType:'derived',body:[]},caller={id:'caller',kind:'source',parameters:[{id:'b',type:'base'}],returnType:i32,body:[{kind:'expression',value:{kind:'call',callee:'mBase',receiver:{kind:'bindingReference',binding:'b',type:'base',range},type:i32,range,arguments:[{kind:'functionReference',functionId:'leaf',type:callable,range}]}},{kind:'expression',value:{kind:'new',type:'derived',range,arguments:[{kind:'functionReference',functionId:'leaf',type:callable,range}]}}]};
 const hir={types:[{id:i32,kind:'scalar'},{id:callable,kind:'function',parameters:[],returnType:i32},base,derived],functions:[leaf,method('mBase','base',undefined),method('mDerived','derived','mBase'),ctor,caller],globals:[],environments:[],closure:{roots:[{kind:'application',target:'caller'}]},snapshot:{payload:{compatibilityWitnesses:[]}}},result=commonTargets(hir,commonMeter());
 for(const id of ['mBase','mDerived','ctor'])assert.deepEqual(result.contracts.get(id).parameters[0].allowed,{top:false,functions:['leaf']});
});

test('shared target snapshots and lexical slot copies prepay work before iteration',()=>{
 const ids=new Set(['a','b','c']),original=ids[Symbol.iterator].bind(ids);let iterated=false;ids[Symbol.iterator]=()=>{iterated=true;return original();};const domain=callableTargetDomain(new Set(['a','b','c']),commonMeter(2),()=>{throw Error('identity');},(a,b)=>a<b?-1:1);
 assert.throws(()=>domain.copy({top:false,ids}),/** @param {any} e */e=>e.code==='r03-common-program-limit');assert.equal(iterated,false);
 let copied=false;const slots=new Proxy([{key:'a'},{key:'b'},{key:'c'}],{get(target,key,receiver){if(key==='0')copied=true;return Reflect.get(target,key,receiver);}});
 assert.throws(()=>lexicalEnvironmentLayouts(new Map([['f',{lexicalParent:null}]]),new Map([['f',slots]]),commonMeter(2),()=>{throw Error('invalid layout');},()=>'',()=>0),/** @param {any} e */e=>e.code==='r03-common-program-limit');assert.equal(copied,false);
});

test('owned target model merges only live branch states',()=>{
 // Isolated owned target-flow semantics, not a Source packet or execution proof.
 const i32='scalar',callable='function',range={start:0,end:1},sig=signatureId({parameters:[],returns:i32});
 const ref=id=>({kind:'functionReference',functionId:id,type:callable,range}),assign={kind:'expression',value:{kind:'bindingAssignment',type:callable,range,target:{binding:'f'},value:ref('right')}};
 const exit={kind:'return',range,value:{kind:'literal',type:i32,range}},leaf=id=>({id,kind:'source',signatureHash:sig,parameters:[],returnType:i32,body:[]});
 for(const [then,otherwise,expected]of [[ [assign],[assign],['right'] ],[ [exit],[assign],['right'] ],[ [assign],[exit],['right'] ],[ [assign],[],['left','right'] ]]){
  const root={...leaf('root'),body:[{kind:'letDeclaration',binding:'f',initializer:ref('left')},{kind:'if',condition:{kind:'literal',type:'bool',range},then,else:otherwise},{kind:'expression',value:{kind:'indirectCall',type:i32,range,expression:{kind:'bindingReference',binding:'f',type:callable,range},signature:{parameters:[],returnType:i32},arguments:[]}}]};
  const hir={types:[{id:i32,kind:'scalar'},{id:callable,kind:'function',parameters:[],returnType:i32}],functions:[leaf('left'),leaf('right'),root],closure:{roots:[{kind:'application',target:'root'}]},snapshot:{payload:{compatibilityWitnesses:[]}}};
  assert.deepEqual(commonTargets(hir,commonMeter()).site('root',range),{top:false,functions:expected});
 }
});

test('owned target publication includes uncalled private function returns',()=>{
 const scalar='scalar',callable='callable',range={start:0,end:1},leaf={id:'leaf',kind:'source',parameters:[],returnType:scalar,body:[]},root={...leaf,id:'root'};
 const hidden={...leaf,id:'hidden',returnType:callable,body:[{kind:'return',range,value:{kind:'functionReference',functionId:'leaf',type:callable,range}}]};
 const hir={types:[{id:scalar,kind:'scalar'},{id:callable,kind:'function',parameters:[],returnType:scalar}],functions:[leaf,root,hidden],closure:{roots:[{kind:'application',target:'root'}]},snapshot:{payload:{compatibilityWitnesses:[]}}};
 const derived=commonTargets(hir,commonMeter());assert.deepEqual(derived.contracts.get('hidden').returns,{top:false,functions:['leaf']});
 const fixed=new Map([...derived.contracts].map(([id,callables])=>[id,{callables}]));assert.doesNotThrow(()=>commonTargets(hir,commonMeter(),fixed));
});
test('actual nested environment keeps managed facet without observed invocation',()=>{
 const hir=projectCommonProgram(facts('common-indirect-valid')),bump=hir.functions.find(fn=>fn.name==='bump');assert(bump.lexicalEnvironment);
 const physical={model:{callables:commonTargets(hir,commonMeter())},references:new Map(),escaping:new Map()},effects=commonEffects(hir,commonMeter(),physical);
 assert.equal(effects.derive(bump,new Map()).upper.facets.managedReference,true);
});
for(const label of ['absent source','false declaration range'])test('cold Source2 rejects indirect signature '+label,()=>{
 const p=structuredClone(facts('common-indirect-valid')),call=p.payload.functions.find(fn=>fn.name==='apply').body[0].value;assert.equal(call.kind,'indirectCall');
 if(label==='absent source')call.signature.sourcePath='/src/forged.ts';else call.signature.declarationRange.end--;
 call.signature.id=sourceSignatureId(call.signature.sourcePath,call.signature.declarationRange);
 assert.throws(()=>verifyCommonProgramFacts(rehashFacts(p)),/** @param {any} e */e=>e.code==='r03-common-program-signature');
});
