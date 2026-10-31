// SPDX-License-Identifier: MIT
// Literal typed HIR at the existing callable producer seam, not Source admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {signatureId} from '../../compiler/module-callable-common.mjs';
import {i32TypeId,sha256} from '../../compiler/identity.mjs';
const F='literal:callback',CF='literal:callback-factory',A='literal:A',B='literal:B',D='literal:D',voidId=sha256('tsfg.type\0void');
const range={start:0,end:1},callSignature={parameters:[],returnType:i32TypeId};
const ref=(id,type=F)=>({kind:'functionReference',type,functionId:id,range});
const binding=(id,type=F)=>({kind:'bindingReference',type,binding:id,range});
const num=()=>({kind:'numericLiteral',type:i32TypeId,token:'1',decimal:'1',range});
const statement=value=>({kind:'expression',range,value});
const returned=value=>({kind:'return',range,value});
const field=(owner,name,type,initializer=null)=>({id:owner+'/'+name,sourceBinding:owner+'/'+name,name,type,...(initializer?{initializer}:{})});
const parameter=(id,type)=>({id,type,name:id,kind:'parameter',writable:true});
function fn(id,returnType,body=[],parameters=[]){return {id,sourceBinding:id,name:id,kind:'source',ownerType:null,returnType,parameters,bindings:[],body,captures:[],lexicalParent:null,
  signatureHash:signatureId({parameters:parameters.map(p=>p.type),returns:returnType})};}
function nominal(id,fields=[],base=null){return {id,kind:'reference',fields,methods:[],...(base?{base}:{}),
  construction:{id:id+'/ctor',kind:base?'implicit-derived':'implicit-base',functionId:null,parameters:[],initializationFields:fields.map(f=>f.id),signature:{parameters:[],returnType:id}}};}
const construct=(id,args=[])=>({kind:'new',type:id,callee:id,range,signature:{parameters:args.map(arg=>arg.type),returnType:id},arguments:args});
const readField=(receiver,property,type=F)=>({kind:'fieldAccess',type,receiver,property,range});
const call=(callee,type,args=[])=>({kind:'call',callee,type,range,arguments:args,signature:{parameters:args.map(arg=>arg.type),returnType:type}});
function hir(owned,functions,globals=[]){return {types:[{id:i32TypeId,kind:'scalar',name:'i32'},{id:voidId,kind:'void'},
    {id:F,kind:'function',parameters:[],returnType:i32TypeId},{id:CF,kind:'function',parameters:[],returnType:F},...owned],functions,globals,modules:[],
    snapshot:{payload:{compatibilityWitnesses:[]}},closure:{roots:[]}};}
const targets=(input,records=null)=>commonTargets(input,commonMeter(1000000),records);
const expected=(value,ids,top=false)=>{assert.equal(value.top,top);assert.deepEqual(value.functions,[...ids].sort());};
const realFunctions=()=>[fn('real:f',i32TypeId,[returned(num())]),fn('real:g',i32TypeId,[returned(num())])];

test('self-recursive implicit initialization terminates callable production with a finite field return',()=>{
  const handler=field(A,'handler',F,ref('real:f')),loop=field(A,'loop',A,construct(A)),owner=nominal(A,[handler,loop]),
    main=fn('main',F,[returned(readField(construct(A),handler.id))]),result=targets(hir([owner],[main,...realFunctions()]));
  expected(result.contracts.get(main.id).returns,['real:f']);
  assert.equal(result.summaries.get(main.id).reached,true);
});

test('mutual implicit initialization revisits field and function-return deltas without poisoning finite targets',()=>{
  const aHandler=field(A,'handler',F,readField(construct(B),B+'/handler')),
    bHandler=field(B,'handler',F,call('producer',F)),a=nominal(A,[aHandler]),b=nominal(B,[field(B,'loop',A,construct(A)),bHandler]),
    main=fn('main',F,[returned(readField(construct(A),aHandler.id))]),producer=fn('producer',F,[returned(ref('real:f'))]),
    result=targets(hir([a,b],[main,producer,...realFunctions()]));
  expected(result.contracts.get(producer.id).returns,['real:f']);expected(result.contracts.get(main.id).returns,['real:f']);
  assert.equal(result.contracts.get(main.id).returns.top,false,'the outer monotone revisit resolves the initially empty producer return');
});

test('recursive derived construction preserves parameter-property propagation and fixed callable observations',()=>{
  const p=parameter('ctor:p',F),cb={...field(A,'callback',F),parameterBinding:p.id},
    a=nominal(A,[field(A,'loop',D,construct(D,[ref('real:g')])),cb]),d=nominal(D,[],A),ctor=fn('ctor:A',A,[],[p]);
  ctor.kind='construction-body';ctor.name='constructor';ctor.ownerType=A;a.construction.kind='explicit';
  a.construction.functionId=ctor.id;a.construction.parameters=[{symbol:p.id,type:F}];a.construction.signature.parameters=[F];
  d.construction.parameters=[{symbol:'D:logical:p',type:F,inheritedFrom:p.id}];d.construction.signature.parameters=[F];
  const main=fn('main',F,[returned(readField(construct(A,[ref('real:f')]),cb.id))]),input=hir([a,d],[main,ctor,...realFunctions()]),result=targets(input);
  expected(result.contracts.get(ctor.id).parameters[0].allowed,['real:f','real:g']);expected(result.contracts.get(main.id).returns,['real:f','real:g']);
  const records=new Map(input.functions.map(row=>[row.id,{upper:{facets:{unknownHost:false}},callables:{parameters:row.id===ctor.id?[{index:0,allowed:{top:false,functions:['real:f','real:g']}}]:[],
    returns:row.id===main.id?{top:false,functions:['real:f','real:g']}:null,slotWrites:[]}}]));
  const fixed=targets(input,records);expected(fixed.contracts.get(main.id).returns,['real:f','real:g']);
  expected(fixed.contracts.get(ctor.id).parameters[0].allowed,['real:f','real:g']);
  const narrow=new Map(records),published=records.get(ctor.id);assert.ok(published);
  narrow.set(ctor.id,{...published,callables:{...published.callables,parameters:[{index:0,allowed:{top:false,functions:['real:f']}}]}});
  assert.throws(()=>targets(input,narrow),error=>error instanceof Error&&'code'in error&&error.code==='r03-common-program-callable-contract',
    'a recursive backedge argument still reaches fixed parameter observation validation');
});

test('recursive initializer retains captured-local writes and existing opaque global escape behavior',()=>{
  const x='main:x',global={id:'global:factory',sourceBinding:'global:factory-binding',type:CF},
    child=fn('child',F,[returned(binding(x))]),publish={kind:'bindingAssignment',type:CF,operator:'=',range,
      target:{kind:'globalTarget',type:CF,global:global.id,binding:global.sourceBinding,range},value:ref(child.id,CF)},
    assign={kind:'bindingAssignment',type:F,operator:'=',range,target:{kind:'bindingTarget',binding:x,type:F,range},value:ref('real:g')},
    owner=nominal(A,[field(A,'loop',A,construct(A)),field(A,'assigned',F,assign),field(A,'published',CF,publish)]),
    main=fn('main',CF,[{kind:'letDeclaration',binding:x,range,initializer:ref('real:f')},statement(construct(A)),returned(ref(child.id,CF))]),
    indirect={kind:'indirectCall',type:F,range:{start:20,end:21},expression:{kind:'globalReference',type:CF,global:global.id,range},arguments:[],signature:{parameters:[],returnType:F}},
    reader=fn('reader',F,[returned(indirect)]);
  main.bindings=[{...parameter(x,F),kind:'local'}];child.lexicalParent=main.id;child.captures=[{binding:x,read:true,write:false}];
  const result=targets(hir([owner],[main,child,reader,...realFunctions()],[global]));
  expected(result.contracts.get(child.id).returns,['real:f','real:g']);expected(result.contracts.get(main.id).returns,[child.id]);
  expected(result.site(reader.id,indirect.range),[],true);expected(result.contracts.get(reader.id).returns,[],true);
});

test('recursive local-state feedback reaches both targets; nonrecursive initialization keeps strong-update precision',()=>{
  for(const recursive of [false,true]){
    const x='main:x',site={start:100,end:101},use={kind:'indirectCall',type:i32TypeId,range:site,expression:binding(x),arguments:[],signature:callSignature},
      assign={kind:'bindingAssignment',type:F,operator:'=',range,target:{kind:'bindingTarget',binding:x,type:F,range},value:ref('real:g')},
      owner=nominal(A,[...(recursive?[field(A,'loop',A,construct(A))]:[]),field(A,'use',i32TypeId,use),field(A,'assigned',F,assign)]),
      main=fn('main',F,[{kind:'letDeclaration',binding:x,range,initializer:ref('real:f')},statement(construct(A)),returned(binding(x))]);
    main.bindings=[{...parameter(x,F),kind:'local'}];const result=targets(hir([owner],[main,...realFunctions()]));
    expected(result.site(main.id,site),recursive?['real:f','real:g']:['real:f']);
    expected(result.contracts.get(main.id).returns,recursive?['real:f','real:g']:['real:g']);
  }
});
