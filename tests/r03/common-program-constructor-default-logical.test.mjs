// SPDX-License-Identifier: MIT
// Typed lowering unit seam only. These models are not official Source packets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {planCommonFunction} from '../../compiler/common-program-control.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {sha256,i32TypeId,boolTypeId} from '../../compiler/identity.mjs';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {signatureId} from '../../compiler/module-callable-common.mjs';

const range={start:1,end:20},undefinedId=sha256('tsfg.type\0undefined');
function planned(derived=false){
  const p=id=>({id,name:id,kind:'parameter',type:i32TypeId,range,writable:true}),parameters=[p('a'),p('b')],raw='raw:i32-or-undefined';
  const call=callee=>({kind:'call',callee,type:i32TypeId,range,signature:{parameters:[],returnType:i32TypeId},arguments:[]});
  const owner={id:'ctor',signatureHash:'ctor',name:'constructor',kind:'construction-body',ownerType:'T',parameters,bindings:[],returnType:'T',range,
    parameterInitialization:{minimumArgumentCount:0,hasParameterExpressions:true,steps:[
      {binding:'a',argumentType:raw,range,initializer:call('parameterEffect')},
      {binding:'b',argumentType:raw,range,initializer:{kind:'bindingReference',binding:'a',type:i32TypeId,range}}
    ]},body:[]};
  const fields=[{id:'ordinary',type:i32TypeId,origin:range,initializer:call('fieldEffect')},{id:'property',type:i32TypeId,origin:range,parameterBinding:'b'}];
  const type={id:'T',kind:'reference',...(derived?{base:'Base'}:{}),fields,construction:{id:'T.ctor',signature:{parameters:[i32TypeId,i32TypeId],returnType:'T',minimumArgumentCount:0},
    initializationFields:fields.map(field=>field.id),parameters:parameters.map(p=>({symbol:p.id,type:p.type})),functionId:owner.id}};
  const functions=new Map(['fieldEffect','parameterEffect'].map(id=>[id,{id,signatureHash:id,returnType:i32TypeId,parameters:[]}]));functions.set(owner.id,owner);
  const catalog=[type,{id:i32TypeId,kind:'scalar',name:'i32'},{id:boolTypeId,kind:'scalar',name:'bool'},
    {id:undefinedId,kind:'undefined'},{id:raw,kind:'union',members:[i32TypeId,undefinedId]}];
  const model={types:new Map(catalog.map(row=>[row.id,row])),
    functions,bindings:new Map(parameters.map(p=>[p.id,p])),fields:new Map(fields.map(field=>[field.id,field])),environments:new Map(),slots:new Map(),
    spend:commonMeter(100000),limits:{parameters:64},payload:'payload',cell:id=>'cell:'+id};
  return planCommonFunction(model,owner);
}
const ops=plan=>plan.graph.blocks.flatMap(block=>block.instructions);
test('base own fields precede conditional left-to-right parameters and parameter properties',()=>{
  const plan=planned(),all=ops(plan),blocks=new Map(plan.graph.blocks.map(block=>[block.name,block]));
  assert.equal(plan.parameters[1].type,'raw:i32-or-undefined');assert.equal(plan.parameters[2].type,'raw:i32-or-undefined');
  const field=all.find(op=>op.name==='tsfg_program.invoke'&&op.properties.function_id==='fieldEffect');
  const normal=blocks.get(field.successors[0]),firstCondition=normal.instructions.findIndex(op=>op.name==='tsfg_program.strict_equal');
  assert.ok(firstCondition>=0);assert.ok(normal.instructions.findIndex(op=>op.name==='tsfg_program.initialize_field')<firstCondition);
  assert.equal(all.filter(op=>op.name==='tsfg_program.strict_equal').length,2);
  assert.equal(all.filter(op=>op.name==='tsfg_program.invoke'&&op.properties.function_id==='parameterEffect').length,1);
  assert.equal(all.filter(op=>op.name==='tsfg_program.undefined').length,2);
  const stores=all.filter(op=>op.name==='tsfg_program.store');assert.deepEqual(stores.map(op=>op.properties.binding),['a','b']);
  assert.ok(stores.every(op=>op.properties.initialize));
  const read=all.find(op=>op.name==='tsfg_program.load'&&op.properties.binding==='a');assert.ok(read);
  const property=all.find(op=>op.name==='tsfg_program.initialize_field'&&op.properties.field==='property');assert.ok(property);
  const secondJoin=plan.graph.blocks.find(block=>block.instructions.includes(stores[1]));
  assert.ok(secondJoin.instructions.indexOf(stores[1])<secondJoin.instructions.indexOf(property));
});
test('derived parameter phase precedes body while its receiver remains unbound',()=>{
  const all=ops(planned(true));
  assert.equal(all.filter(op=>op.name==='tsfg_program.receiver_allocate').length,0);
  assert.equal(all.filter(op=>op.name==='tsfg_program.initialize_begin').length,0);
  assert.equal(all.filter(op=>op.name==='tsfg_program.strict_equal').length,2);
  const invoke=all.find(op=>op.name==='tsfg_program.invoke');assert.equal(invoke.properties.function_id,'parameterEffect');
  assert.ok(all.some(op=>op.name==='tsfg_program.return_throw'));
});
test('constructor default callable writes obey the existing fixed parameter storage upper',()=>{
  const model=target=>{
    const scalar='scalar',callable='callable',reference=id=>({kind:'functionReference',functionId:id,type:callable,range}),
      leaf=id=>({id,kind:'source',parameters:[],bindings:[],captures:[],returnType:scalar,body:[]}),parameter={id:'parameter',type:callable,name:'reader',kind:'parameter'},
      ctor={...leaf('ctor'),kind:'construction-body',ownerType:'Owner',parameters:[parameter],returnType:'Owner',
        parameterInitialization:{minimumArgumentCount:0,hasParameterExpressions:true,steps:[{binding:parameter.id,range,argumentType:'raw',initializer:reference(target)}]}},
      owner={id:'Owner',kind:'reference',fields:[{id:'field',sourceBinding:'field',type:callable,parameterBinding:parameter.id}],methods:[],
        construction:{id:'Owner.ctor',functionId:ctor.id,parameters:[{symbol:parameter.id,type:callable}],signature:{parameters:[callable],returnType:'Owner',minimumArgumentCount:0},initializationFields:['field']}},
      entry={...leaf('entry'),body:[{kind:'expression',value:{kind:'new',type:owner.id,callee:owner.id,arguments:[],range}}]};
    return {types:[{id:scalar,kind:'scalar'},{id:callable,kind:'function',parameters:[],returnType:scalar},{id:'undefined',kind:'undefined'},{id:'raw',kind:'union',members:[callable,'undefined']},owner],
      functions:[leaf('left'),leaf('right'),ctor,entry],globals:[],modules:[],environments:[],closure:{roots:[{kind:'kernel',target:entry.id}]},snapshot:{payload:{compatibilityWitnesses:[]}}};
  };
  const original=commonTargets(model('left'),commonMeter()),upper=original.contracts.get('ctor').parameters[0].allowed;
  assert.deepEqual(upper,{top:false,functions:['left']});
  const records=new Map([...original.contracts].map(([id,callables])=>[id,{callables:structuredClone(callables)}]));
  assert.throws(()=>commonTargets(model('right'),commonMeter(),records),error=>error instanceof TypeError&&'code'in error&&error.code==='r03-common-program-callable-contract');
});
test('later constructor defaults retain supplied and initialized earlier callable targets',()=>{
  const scalar='scalar',callable='callable',signature={parameters:[],returnType:scalar},
    reference=id=>({kind:'functionReference',functionId:id,type:callable,range}),
    leaf=id=>({id,kind:'source',parameters:[],bindings:[],captures:[],returnType:scalar,body:[],signatureHash:signatureId({parameters:[],returns:scalar})}),
    parameters=['a','b'].map(id=>({id,type:callable,name:id,kind:'parameter'})),
    ctor={...leaf('ctor'),kind:'construction-body',ownerType:'Owner',parameters,returnType:'Owner',
      parameterInitialization:{minimumArgumentCount:1,hasParameterExpressions:true,steps:[
        {binding:'a',range,argumentType:callable},
        {binding:'b',range,argumentType:'raw',initializer:{kind:'bindingAssignment',type:callable,range,target:{kind:'bindingTarget',binding:'a',type:callable},value:reference('other')}}
      ]},body:[{kind:'expression',value:{kind:'indirectCall',expression:{kind:'bindingReference',binding:'a',type:callable,range},signature,arguments:[],type:scalar,range}}]},
    owner={id:'Owner',kind:'reference',fields:[],methods:[],construction:{id:'Owner.ctor',functionId:ctor.id,
      parameters:parameters.map(p=>({symbol:p.id,type:p.type})),signature:{parameters:[callable,callable],returnType:'Owner',minimumArgumentCount:1},initializationFields:[]}},
    entry={...leaf('entry'),body:[[reference('left'),reference('left')],[reference('left')]].map(args=>({kind:'expression',value:{kind:'new',type:owner.id,callee:owner.id,arguments:args,range}}))},
    hir={types:[{id:scalar,kind:'scalar'},{id:callable,kind:'function',parameters:[],returnType:scalar},{id:'undefined',kind:'undefined'},{id:'raw',kind:'union',members:[callable,'undefined']},owner],
      functions:[leaf('left'),leaf('other'),ctor,entry],globals:[],modules:[],environments:[],closure:{roots:[{kind:'kernel',target:entry.id}]},snapshot:{payload:{compatibilityWitnesses:[]}}};
  const targets=commonTargets(hir,commonMeter());
  assert.deepEqual(targets.site(ctor.id,range),{top:false,functions:['left','other']});
  const records=new Map([...targets.contracts].map(([id,callables])=>[id,{callables:structuredClone(callables)}]));
  assert.deepEqual(commonTargets(hir,commonMeter(),records).site(ctor.id,range),{top:false,functions:['left','other']});
});
