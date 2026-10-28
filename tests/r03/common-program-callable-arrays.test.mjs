// SPDX-License-Identifier: MIT
// Normalized target/storage controls are separate from official Source credit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {signatureId} from '../../compiler/module-callable-common.mjs';

{
  const bytes=readFileSync(new URL('./testdata/common-loop-local-factory/readonly-callable-array-held-safe.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'c39788be0d847caf85e96865ce88de2eba980f7459e324ceb9d9c24e7f43cb16');
  const hir=projectCommonProgram(readCommonProgramFacts(bytes)),root=hir.functions.find(fn=>fn.name==='loopRead'),
    factory=hir.functions.find(fn=>fn.name==='makeOwnedReader'),reader=hir.functions.find(fn=>fn.name==='readOwned'&&fn.lexicalParent===factory.id),
    array=root.bindings.find(binding=>binding.name==='readers').type;
  test('genuine complete callable Array HIR derives all-writer code membership',()=>{
    assert.deepEqual(commonTargets(hir,commonMeter()).site(root.id,{start:2147,end:2159}),{top:false,functions:[reader.id]});
  });
  test('genuine complete callable Array HIR independently proves literal prefix initialization',()=>{
    const flow=commonTargets(hir,commonMeter());
    assert.equal(typeof flow.arrayElementInitialized,'function');
    assert.equal(flow.arrayElementInitialized(array,0),true);
    assert.equal(flow.arrayElementInitialized(array,1),false);
  });
}

const range={start:10,end:20},signature={parameters:[],returnType:'scalar'};
/** @returns {any} */
function model(mode='closed'){
  const local=(id,type='array')=>({kind:'bindingReference',binding:id,type,range}),
    ref=id=>({kind:'functionReference',functionId:id,type:'callable',range}),
    numeric=decimal=>({kind:'numericLiteral',type:'scalar',decimal,range}),
    literal=(elements,type='array')=>({kind:'arrayLiteral',type,elements,allocationSite:'allocation/'+type,range}),
    leaf=id=>({id,kind:'source',signatureHash:signatureId({parameters:[],returns:'scalar'}),parameters:[],bindings:[],captures:[],returnType:'scalar',body:[]}),
    read={kind:'checkedElementAccess',receiver:local('arr'),index:numeric('0'),type:'callable',range},
    invoke={kind:'indirectCall',expression:read,type:'scalar',signature,arguments:[],range},
    initial=literal([ref('A')]),other=literal([ref('B')]),
    root=/** @type {any} */({...leaf('root'),bindings:[{id:'arr',type:'array'}],body:[{kind:'constDeclaration',binding:'arr',initializer:initial},{kind:'expression',value:invoke}]}),
    writer=/** @type {any} */({...leaf('writer'),bindings:[{id:'other',type:'array'}],body:[{kind:'constDeclaration',binding:'other',initializer:other}]});
  /** @type {any} */ const hir={types:[{id:'scalar',kind:'scalar'},{id:'callable',kind:'function',...signature},{id:'array',kind:'array',elementType:'callable'},{id:'unknown',kind:'unknown'}],
    functions:[leaf('A'),leaf('B'),root,writer],globals:[],modules:[],closure:{roots:[{kind:'application',target:'root'}]},snapshot:{payload:{compatibilityWitnesses:[]}}};
  const effect=value=>root.body.splice(1,0,{kind:'expression',value});
  if(mode==='empty')other.elements=[];
  if(mode==='short'){initial.elements.push(ref('A'));}
  if(mode==='conditional'){writer.body=[{kind:'if',condition:numeric('0'),then:[{kind:'constDeclaration',binding:'other',initializer:literal([])}],else:[]}];}
  if(mode==='shrink-regrow')for(const value of ['0','1'])effect({kind:'lengthAssignment',type:'scalar',target:{kind:'lengthTarget',receiver:local('arr'),type:'scalar'},value:numeric(value),range});
  if(mode==='parameter')root.parameters=[{id:'input',type:'array'}];
  if(mode==='global')hir.globals.push({id:'global',sourceBinding:'global/binding',type:'array'});
  if(mode==='unknown-birth')root.body[0].initializer={kind:'call',callee:'arrayMaker',type:'array',arguments:[],range},hir.functions.push({...leaf('arrayMaker'),returnType:'array'});
  if(mode==='unknown-cast')effect({kind:'as',type:'array',expression:local('opaque','unknown'),range});
  if(mode==='erased')effect({kind:'as',type:'unknown',expression:local('arr'),range});
  if(mode==='view'||mode==='union'){
    hir.types.push({id:'view',kind:'array',elementType:'callable'});other.type='view';other.elements=[];writer.bindings[0].type='view';
    if(mode==='view')effect({kind:'as',type:'view',expression:local('arr'),range});
    else hir.types.push({id:'union',kind:'union',members:['array','view']});
  }
  if(mode==='span'){
    hir.types.push({id:'span',kind:'readSpan',elementType:'callable'});
    effect({kind:'call',callee:'intrinsic:readSpan',type:'span',arguments:[local('arr'),numeric('0'),numeric('0')],range});
  }
  if(mode==='nested-host'){
    hir.types.push({id:'holder',kind:'reference',fields:[{id:'items',sourceBinding:'items',type:'array'}],methods:[]},
      {id:'hostType',kind:'function',parameters:['holder'],returnType:'scalar'});
    root.parameters=[{id:'host',type:'hostType'}];
    effect({kind:'indirectCall',type:'scalar',expression:local('host','hostType'),signature:{parameters:['holder'],returnType:'scalar'},arguments:[local('box','holder')],range:{start:1,end:2}});
  }
  if(mode==='captured-host'){
    const closure=hir.functions.find(fn=>fn.id==='B');closure.lexicalParent='root';closure.captures=[{binding:'arr',read:true,write:false}];
    hir.types.push({id:'hostType',kind:'function',parameters:['callable'],returnType:'scalar'});root.parameters=[{id:'host',type:'hostType'}];
    effect({kind:'indirectCall',type:'scalar',expression:local('host','hostType'),signature:{parameters:['callable'],returnType:'scalar'},arguments:[ref('B')],range:{start:1,end:2}});
  }
  return {hir,root,writer,initial,other,local,ref,numeric,effect,read,range};
}
test('all Array writers widen code membership independently of the selected allocation',()=>{
  const {hir}=model(),flow=commonTargets(hir,commonMeter());
  assert.deepEqual(flow.site('root',range),{top:false,functions:['A','B']});
  assert.equal(flow.arrayElementInitialized('array',0),true);
});
function nestedCaptureModel(){
  const m=model(),innerType='innerArray',innerCallable='innerCallable';
  m.hir.types.push({id:innerCallable,kind:'function',parameters:['scalar'],returnType:'scalar'},
    {id:innerType,kind:'array',elementType:innerCallable});
  m.hir.functions.push({id:'C1',kind:'source',signatureHash:signatureId({parameters:['scalar'],returns:'scalar'}),
    parameters:[{id:'arg',type:'scalar'}],bindings:[],captures:[],returnType:'scalar',body:[]});
  const captured=m.hir.functions.find(fn=>fn.id==='B');captured.lexicalParent='root';
  captured.captures=[{binding:'inner',read:true,write:false}];
  captured.body=[{kind:'return',value:{kind:'arrayLength',receiver:m.local('inner',innerType),type:'scalar',range}}];
  m.root.bindings.push({id:'inner',type:innerType});
  // A TOP invocation would independently expose every closure and mask this
  // storage-only boundary. Retain the real erase after both local births.
  m.root.body=m.root.body.filter(row=>row.value?.kind!=='indirectCall');
  m.root.body.unshift({kind:'constDeclaration',binding:'inner',initializer:{kind:'arrayLiteral',type:innerType,
    elements:[{kind:'functionReference',functionId:'C1',type:innerCallable,range}],allocationSite:'inner',range}});
  return {m,innerType};
}
for(const mode of ['early','late','alias','nullable'])test('exposed callable Array writers expose captured arrays with a distinct signature: '+mode,()=>{
  const {m,innerType}=nestedCaptureModel();
  if(mode==='nullable'){
    m.hir.types.push({id:'undefined',kind:'undefined'},{id:'maybeCallable',kind:'union',members:['callable','undefined']});
    m.hir.types.find(type=>type.id==='array').elementType='maybeCallable';
  }
  if(mode==='alias'){
    m.hir.types.push({id:'exposedView',kind:'array',elementType:'callable'});
    m.hir.globals.push({id:'publishedArray',sourceBinding:'publishedArray',type:'exposedView'});
  }
  m.root.body.push({kind:'expression',value:{kind:'as',type:mode==='alias'?'exposedView':'unknown',expression:m.local('arr'),range}});
  if(mode==='early'){m.hir.functions=m.hir.functions.filter(fn=>fn!==m.writer);m.hir.functions.splice(m.hir.functions.indexOf(m.root),0,m.writer);}
  const flow=commonTargets(m.hir,commonMeter());
  assert.equal(flow.arrayElementInitialized('array',0),false,'outer storage is exposed');
  assert.equal(flow.arrayElementInitialized(innerType,0),false,'all writer captures must be exposed even after the family was first erased');
});
for(const nullable of [false,true])test('an already exposed callable field propagates a later writer capture: '+(nullable?'nullable':'direct'),()=>{
  const {m,innerType}=nestedCaptureModel();
  if(nullable)m.hir.types.push({id:'undefined',kind:'undefined'},{id:'maybeCallable',kind:'union',members:['callable','undefined']});
  const field={id:'holder/reader',sourceBinding:'holder/reader',type:nullable?'maybeCallable':'callable',initializer:m.ref('A')};
  m.hir.types.push({id:'holder',kind:'reference',fields:[field],methods:[],construction:{parameters:[],initializationFields:[field.id]}});
  m.hir.globals.push({id:'opaqueSink',sourceBinding:'opaqueSink',type:'unknown',writable:true});
  m.root.bindings.push({id:'box',type:'holder'});
  m.root.body.push({kind:'constDeclaration',binding:'box',initializer:{kind:'new',type:'holder',arguments:[],range}},
    {kind:'expression',value:{kind:'bindingAssignment',type:'unknown',target:{kind:'globalTarget',binding:'opaqueSink',type:'unknown'},value:m.local('box','holder'),range}});
  m.writer.parameters=[{id:'box',type:'holder'}];m.writer.signatureHash=signatureId({parameters:['holder'],returns:'scalar'});
  m.writer.body=[{kind:'expression',value:{kind:'fieldAssignment',type:field.type,target:{kind:'fieldTarget',
    receiver:m.local('box','holder'),property:field.id,type:field.type},value:m.ref('B'),range}}];
  const flow=commonTargets(m.hir,commonMeter());
  assert.equal(flow.arrayElementInitialized(innerType,0),false,'a late field writer cannot hide its captured Array behind the existing TOP slot');
});
test('erasing numeric Array storage does not expose unrelated closure captures',()=>{
  const {m,innerType}=nestedCaptureModel();
  m.hir.types.push({id:'numbers',kind:'array',elementType:'scalar'});m.root.bindings.push({id:'numbers',type:'numbers'});
  m.root.body.push({kind:'constDeclaration',binding:'numbers',initializer:{kind:'arrayLiteral',type:'numbers',elements:[m.numeric('0')],allocationSite:'numbers',range}},
    {kind:'expression',value:{kind:'as',type:'unknown',expression:m.local('numbers','numbers'),range}});
  const flow=commonTargets(m.hir,commonMeter());
  assert.equal(flow.arrayElementInitialized('numbers',0),false);
  assert.equal(flow.arrayElementInitialized(innerType,0),true,'a scalar element is not an unknown callable writer');
});
test('Array literals in unselected class initializers remain element code writers',()=>{
  const m=model();m.writer.body=[];
  m.hir.types.push({id:'holder',kind:'reference',fields:[{id:'holder/items',sourceBinding:'holder/items',type:'array',initializer:m.other}],methods:[]});
  const flow=commonTargets(m.hir,commonMeter());
  assert.deepEqual(flow.site('root',range),{top:false,functions:['A','B']});
});
test('fixed complete factory returns supply every element code arm without using the selected arm',()=>{
  const m=model();m.writer.body=[];
  m.hir.functions.push({id:'select',kind:'source',parameters:[],bindings:[],captures:[],returnType:'callable',body:[{kind:'return',value:m.ref('A')}]});
  m.initial.elements=[{kind:'call',callee:'select',type:'callable',arguments:[],range}];
  const inferred=commonTargets(m.hir,commonMeter()),records=new Map([...inferred.contracts].map(([id,callables])=>[id,{callables:structuredClone(callables)}]));
  assert.deepEqual(inferred.site('root',range),{top:false,functions:['A']});
  records.get('select').callables.returns.functions.push('B');
  assert.deepEqual(commonTargets(m.hir,commonMeter(),records).site('root',range),{top:false,functions:['A','B']});
});
for(const mode of ['empty','short','conditional'])test('every Array birth participates in the initialized prefix: '+mode,()=>{
  const {hir}=model(mode),flow=commonTargets(hir,commonMeter());
  assert.equal(flow.arrayElementInitialized('array',mode==='short'?1:0),false);
  if(mode==='short')assert.equal(flow.arrayElementInitialized('array',0),true);
});
for(const mode of ['shrink-regrow','parameter','global','unknown-birth','unknown-cast','erased','nested-host','captured-host'])test('unclosed Array families lose initialization: '+mode,()=>{
  const {hir}=model(mode),flow=commonTargets(hir,commonMeter());
  assert.equal(flow.arrayElementInitialized('array',0),false);
  if(mode!=='shrink-regrow')assert.equal(flow.site('root',range).top,true);
});
for(const mode of ['view','union'])test('verified overlapping Array views share the shortest birth in both directions: '+mode,()=>{
  const {hir}=model(mode),flow=commonTargets(hir,commonMeter());
  assert.equal(flow.arrayElementInitialized('array',0),false);assert.equal(flow.arrayElementInitialized('view',0),false);
});
test('verified structural field aliases join their actual Array storage types bidirectionally',()=>{
  const m=model();m.hir.types.push({id:'view',kind:'array',elementType:'callable'});m.other.type='view';m.other.elements=[];m.writer.bindings[0].type='view';
  for(const [id,type]of [['left','array'],['right','view']])m.hir.types.push({id,sourceType:id,kind:'reference',fields:[{id:id+'/items',sourceBinding:id+'/raw',type}],methods:[]});
  m.hir.snapshot.payload.compatibilityWitnesses.push({compatibility:{sourceType:'left',targetType:'right',members:[{source:'left/raw',target:'right/raw'}]}});
  const flow=commonTargets(m.hir,commonMeter());
  assert.equal(flow.arrayElementInitialized('array',0),false);assert.equal(flow.arrayElementInitialized('view',0),false);
});
test('ReadSpan aliases never acquire the direct Array index guarantee',()=>{
  const {hir}=model('span'),flow=commonTargets(hir,commonMeter());
  assert.equal(flow.arrayElementInitialized('array',0),true);assert.equal(flow.arrayElementInitialized('span',0),false);
  for(const index of [-1,0.5,NaN,undefined,1])assert.equal(flow.arrayElementInitialized('array',index),false);
});
test('a complete unobserved Host return arm exposes its captured Array family',()=>{
  const m=model(),select={id:'select',kind:'source',parameters:[],bindings:[],captures:[],returnType:'callable',body:[{kind:'return',value:m.ref('A')}]};
  m.hir.functions.push(select);const arm=m.hir.functions.find(fn=>fn.id==='B');arm.lexicalParent='root';arm.captures=[{binding:'arr',read:true,write:false}];
  m.effect({kind:'indirectCall',expression:{kind:'call',callee:'select',type:'callable',arguments:[],range:{start:2,end:3}},type:'scalar',signature,arguments:[],range:{start:1,end:2}});
  const inferred=commonTargets(m.hir,commonMeter()),records=new Map([...inferred.contracts].map(([id,callables])=>[id,{callables:structuredClone(callables),upper:{facets:{unknownHost:id==='B'}}}]));
  assert.equal(inferred.arrayElementInitialized('array',0),true);
  records.get('select').callables.returns.functions.push('B');
  const fixed=commonTargets(m.hir,commonMeter(),records);
  assert.equal(fixed.arrayElementInitialized('array',0),false);assert.equal(fixed.site('root',range).top,true);
});
for(const mode of ['assignment','module-initializer','throw','erased-local'])test('outward callable publication exposes its captured Array family: '+mode,()=>{
  const m=model(),closure=m.hir.functions.find(fn=>fn.id==='B');closure.lexicalParent='root';closure.captures=[{binding:'arr',read:true,write:false}];
  m.hir.globals.push({id:'published',sourceBinding:'published/raw',type:'callable'});
  if(mode==='assignment')m.effect({kind:'bindingAssignment',type:'callable',target:{kind:'globalTarget',global:'published',type:'callable'},value:m.ref('B'),range});
  else if(mode==='module-initializer')m.hir.modules.push({id:'module',initializer:'module/init',exports:[],initialization:[{kind:'initialize',binding:'published',initializer:m.ref('B')}]});
  else if(mode==='throw')m.root.body.splice(1,0,{kind:'throw',value:m.ref('B')});
  else {m.root.bindings.push({id:'opaque',type:'unknown'});m.root.body.splice(1,0,{kind:'constDeclaration',binding:'opaque',initializer:m.ref('B')});}
  assert.equal(commonTargets(m.hir,commonMeter()).arrayElementInitialized('array',0),false);
});
test('family scans and initialization queries charge before work and cancellation publishes no result',()=>{
  const {hir}=model();assert.throws(()=>commonTargets(hir,commonMeter(10)),/** @param {any} error */error=>error.code==='r03-common-program-limit');
  let remaining=1000000;const flow=commonTargets(hir,n=>{remaining-=n??1;if(remaining<0)throw Error('cancel');});remaining=0;
  assert.throws(()=>flow.arrayElementInitialized('array',0),/cancel/);
});
