// SPDX-License-Identifier: MIT
// The original packet is the positive Source case. Mutated owned-shape models
// below exercise proof algebra only; they are not re-signed Source2/HIR inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {commonNativeCatchBindings} from '../../compiler/common-program-native-language.mjs';
import {commonFixedStorageIsolation} from '../../compiler/common-program-fixed-storage.mjs';
const hir=projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./common-program-method-dispatch.json',import.meta.url))));
const type=(value,name)=>value.types.find(t=>t.name===name),method=(value,name)=>value.functions.find(f=>f.ownerType===type(value,name).id&&f.name==='m');
const run=value=>commonFixedStorageIsolation(value,()=>{}),open=value=>{const result=run(value);assert.equal(result.uncertain,true);assert.equal(result.affected.has(type(value,'Delta').id),true);};
const binding=(id,type)=>({kind:'bindingReference',binding:id,type,declaredType:type});

test('complete finite method language carriers independently close the original catch erasures',()=>{
  const result=run(hir);assert.equal(result.uncertain,false);assert.equal(result.affected.has(type(hir,'Delta').id),false);
});
test('every permitted method target participates even when an observed Derived receiver cannot select Peer',()=>{
  const value=structuredClone(hir),fn=method(value,'Peer');fn.body.push({kind:'throw',range:fn.range,value:binding(fn.parameters[0].id,fn.parameters[0].type)});open(value);
});
test('an unknown field writer cannot borrow a scalar declaration or cast as native evidence',()=>{
  const value=structuredClone(hir),fn=method(value,'Base'),field=type(value,'Base').fields[0],unknown=value.types.find(t=>t.kind==='unknown');
  fn.bindings.push({id:'probe-unknown',type:unknown.id});fn.body.push({kind:'expression',value:{kind:'fieldAssignment',operator:'=',type:field.type,
    target:{kind:'fieldTarget',property:field.id,type:field.type,receiver:{kind:'thisReference',type:fn.ownerType}},
    value:{kind:'as',type:field.type,expression:binding('probe-unknown',unknown.id)}}});open(value);
});
test('an unpaired structural field route cannot prove the method language carrier',()=>{
  const value=structuredClone(hir),from=type(value,'Peer'),to=type(value,'Base');let removed=0;
  for(const row of value.snapshot.payload.compatibilityWitnesses)if(row.compatibility.sourceType===from.sourceType&&row.compatibility.targetType===to.sourceType){
    const before=row.compatibility.members.length;row.compatibility.members=row.compatibility.members.filter(p=>p.target!==to.fields[0].sourceBinding);removed+=before-row.compatibility.members.length;}
  assert.ok(removed>0);open(value);
});
test('incomplete inherited initialization metadata cannot establish a field invariant',()=>{
  const value=structuredClone(hir);type(value,'Base').construction.initializationFields=[];open(value);
});
test('a missing direct callee cannot acquire a native language summary',()=>{
  const value=structuredClone(hir),fn=value.functions.find(f=>f.name==='entryBase');fn.body.find(r=>r.kind==='try').tryBlock.body[0].value.callee='unpaired-callee';open(value);
});

const helper=(value,name,parameterType,body)=>{const source=value.functions.find(f=>f.name==='add'),fn={...structuredClone(source),id:'probe-'+name,sourceBinding:'probe-binding-'+name,name,parameters:parameterType?[{id:'probe-arg-'+name,type:parameterType}]:[],bindings:[],body:[]};fn.body=body(fn);value.functions.push(fn);return fn;};
const call=(fn,args,type=fn.returnType)=>({kind:'call',callee:fn.id,arguments:args,type,declaredType:type,signature:{parameters:fn.parameters.map(p=>p.type),returnType:type}});
for(const native of [true,false])test('known-call language proof substitutes actual '+(native?'native literal':'managed payload without trusting the scalar parameter declaration'),()=>{
  const value=structuredClone(hir),scalar=type(value,'Delta').fields[0].type,fn=helper(value,'throw-argument',scalar,f=>[{kind:'throw',value:binding(f.parameters[0].id,scalar)}]),target=method(value,'Derived');
  const argument=native?{kind:'numericLiteral',type:scalar,token:'7',decimal:'7'}:{kind:'as',type:scalar,expression:binding(target.parameters[0].id,target.parameters[0].type)};
  target.body=[{kind:'return',value:call(fn,[argument])}];if(native)assert.equal(run(value).uncertain,false);else open(value);
});
test('a managed normal return inside try is not erased by catch composition before a caller throws it',()=>{
  const value=structuredClone(hir),box=type(value,'Box'),scalar=type(value,'Delta').fields[0].type,unknown=value.types.find(t=>t.kind==='unknown');
  const fn=helper(value,'return-box',null,()=>[{kind:'try',tryBlock:{body:[{kind:'return',value:{kind:'as',type:scalar,expression:{kind:'new',type:box.id,arguments:[]}}}]},
    catchClause:{binding:{id:'probe-caught',type:unknown.id},block:{body:[{kind:'return',value:{kind:'numericLiteral',type:scalar,token:'0',decimal:'0'}}]}}}]);
  method(value,'Derived').body=[{kind:'throw',value:call(fn,[])}];open(value);
});
test('a scalar asserted as a receiver is unpaired, not a new actual method tag',()=>{
  const value=structuredClone(hir),fn=value.functions.find(f=>f.name==='callBase'),invoke=fn.body[0].value,scalar=type(value,'Delta').fields[0].type;
  invoke.receiver={kind:'as',type:type(value,'Base').id,expression:{kind:'numericLiteral',type:scalar,token:'1',decimal:'1'}};open(value);
});

for(const location of ['module','field initializer'])test('complete field writer inventory includes '+location,()=>{
  const value=structuredClone(hir),owner=type(value,'Base'),field=owner.fields[0],scalar=field.type;
  const write={kind:'fieldAssignment',operator:'=',type:scalar,target:{kind:'fieldTarget',property:field.id,type:scalar,receiver:{kind:'new',type:owner.id,arguments:[]}},
    value:{kind:'as',type:scalar,expression:{kind:'arrayLiteral',type:method(value,'Base').parameters[0].type,elements:[]}}};
  if(location==='module')value.modules[0].initialization.push({kind:'expression',value:write});else type(value,'Box').fields[0].initializer=write;
  open(value);
});
test('removing the paired target witness cannot silently shrink the complete method upper',()=>{
  const value=structuredClone(hir),from=type(value,'Peer'),to=type(value,'Base'),before=value.snapshot.payload.compatibilityWitnesses.length;
  value.snapshot.payload.compatibilityWitnesses=value.snapshot.payload.compatibilityWitnesses.filter(row=>!(row.compatibility.sourceType===from.sourceType&&row.compatibility.targetType===to.sourceType));
  assert.ok(value.snapshot.payload.compatibilityWitnesses.length<before);open(value);
});

test('native stores preserve the proved carrier through a parenthesized inherited field target',()=>{
  const value=structuredClone(hir),fn=method(value,'Base'),field=type(value,'Base').fields[0];
  fn.body.unshift({kind:'expression',value:{kind:'fieldAssignment',operator:'=',type:field.type,target:{kind:'parentheses',type:field.type,declaredType:field.type,expression:{kind:'fieldTarget',property:field.id,type:field.type,receiver:{kind:'thisReference',type:fn.ownerType}}},value:{kind:'numericLiteral',type:field.type,token:'3',decimal:'3'}}});
  assert.equal(run(value).uncertain,false);
});
for(const escape of ['foreign','captured','exported object'])test(escape+' ownership cannot provide a closed field invariant',()=>{
  const value=structuredClone(hir);if(escape==='foreign')value.hostImports.push({id:'probe-foreign'});
  else if(escape==='captured')method(value,'Derived').captures=[{binding:'probe-captured',type:value.types.find(t=>t.kind==='unknown').id}];
  else value.closure.roots.push({kind:'entry',target:value.functions.find(f=>f.name==='makeReceiver').id});
  open(value);
});

for(const port of ['normal return','array output','field output','language throw'])test('external managed egress through '+port+' invalidates the closed writer premise',()=>{
  const value=structuredClone(hir),base=type(value,'Base'),scalar=type(value,'Delta').fields[0].type,object={kind:'new',type:base.id,arguments:[]};
  let parameter=null,voidType=value.types.find(t=>t.kind==='void');if(!voidType){voidType={id:'probe-void',sourceType:'void',kind:'void'};value.types.push(voidType);}
  if(port==='array output'){const array=structuredClone(value.types.find(t=>t.kind==='array'));array.id='probe-base-array';array.sourceType='probe-source-array';array.elementType=base.id;value.types.push(array);parameter=array.id;}
  if(port==='field output'){const holder=structuredClone(type(value,'Box')),field=holder.fields[0];holder.id='probe-holder';holder.sourceType='probe-source-holder';field.id='probe-child-field';field.sourceBinding='probe-child-binding';field.name='child';field.type=base.id;field.initializer={kind:'nullLiteral',type:value.types.find(t=>t.kind==='null')?.id??scalar};holder.construction.id='probe-holder-construction';holder.construction.initializationFields=[field.id];holder.construction.signature.returnType=holder.id;value.types.push(holder);parameter=holder.id;}
  const fn=helper(value,'escape-'+port,parameter,f=>{
    if(port==='normal return')return [{kind:'return',value:{kind:'as',type:scalar,expression:object}}];
    if(port==='language throw')return [{kind:'throw',value:object}];
    const target=port==='array output'?{kind:'elementTarget',type:base.id,receiver:binding(f.parameters[0].id,parameter),index:{kind:'numericLiteral',type:scalar,token:'0',decimal:'0'}}:
      {kind:'fieldTarget',type:base.id,property:'probe-child-field',receiver:binding(f.parameters[0].id,parameter)};
    return [{kind:'expression',value:{kind:port==='array output'?'elementAssignment':'fieldAssignment',operator:'=',type:base.id,target,value:object}}];
  });fn.returnType=port==='normal return'?scalar:voidType.id;value.closure.roots.push({kind:'entry',target:fn.id});open(value);
});

test('literal-index store evidence is discarded by an intervening known call',()=>{
  const value=structuredClone(hir),array=method(value,'Base').parameters[0].type,scalar=type(value,'Delta').fields[0].type;
  const touch=helper(value,'touch',null,()=>[{kind:'return',value:{kind:'numericLiteral',type:scalar,token:'0',decimal:'0'}}]);
  const fn=helper(value,'array-call-boundary',array,f=>{const receiver=binding(f.parameters[0].id,array),index={kind:'numericLiteral',type:scalar,token:'0',decimal:'0'};
    return [{kind:'expression',value:{kind:'elementAssignment',operator:'=',type:scalar,target:{kind:'elementTarget',type:scalar,receiver,index},value:{kind:'numericLiteral',type:scalar,token:'2',decimal:'2'}}},
      {kind:'expression',value:call(touch,[])},{kind:'return',value:{kind:'checkedElementAccess',type:scalar,receiver,index}}];
  });value.closure.roots.push({kind:'entry',target:fn.id});open(value);
});

test('an unobserved implicit field materializer cannot leak an owning language payload',()=>{
  const value=structuredClone(hir),base=type(value,'Base'),fn=helper(value,'initializer-throw',null,()=>[{kind:'throw',value:{kind:'new',type:base.id,arguments:[]}}]),owner=structuredClone(type(value,'Box'));
  owner.id='probe-unused-owner';owner.sourceType='probe-unused-source';owner.name='Unused';owner.fields[0].id='probe-unused-field';owner.fields[0].sourceBinding='probe-unused-binding';owner.fields[0].initializer=call(fn,[]);
  owner.construction.id='probe-unused-ctor';owner.construction.initializationFields=[owner.fields[0].id];owner.construction.signature.returnType=owner.id;value.types.push(owner);open(value);
});


test('native proof prepays its index work before allocating entry maps',()=>{
  const sentinel=new Error('prepay-exhausted');let indexed=false;
  const types=new Proxy(hir.types,{get(target,key,receiver){if(key==='map')indexed=true;return Reflect.get(target,key,receiver);}});
  assert.throws(()=>commonNativeCatchBindings({...hir,types},()=>{throw sentinel;},()=>false),error=>error===sentinel);assert.equal(indexed,false);
});
for(const operation of ['managed result','managed operand','unary managed operand','compound global managed operand'])test('native operations reject '+operation+' despite a known value or scalar spelling',()=>{
  const value=structuredClone(hir),scalar=type(value,'Delta').fields[0].type,string={kind:'stringLiteral',type:'string',codeUnits:[120]},cast={kind:'as',type:scalar,expression:string};
  if(!value.types.some(t=>t.id==='string'))value.types.push({id:'string',sourceType:'string',kind:'string'});
  const binary={kind:'binary',operator:'+',type:operation==='managed result'?'string':scalar,left:operation==='managed result'?string:cast,right:operation==='managed result'?string:{kind:'numericLiteral',type:scalar,token:'1',decimal:'1'}};
  if(operation==='compound global managed operand'){
    const global=value.globals[0],poison=helper(value,'poison-global',null,()=>[{kind:'expression',value:{kind:'bindingAssignment',operator:'+=',type:scalar,target:{kind:'globalTarget',global:global.id,type:scalar},value:cast}},{kind:'return',value:{kind:'numericLiteral',type:scalar,token:'0',decimal:'0'}}]);
    method(value,'Derived').body=[{kind:'expression',value:call(poison,[])},{kind:'throw',value:{kind:'globalReference',global:global.id,type:scalar}}];
  }else method(value,'Derived').body=[{kind:'throw',value:operation==='unary managed operand'?{kind:'unary',operator:'+',type:scalar,expression:cast}:binary}];
  open(value);
});

for(const missing of ['kernel role','required root','entry record'])test('scalar spelling without '+missing+' cannot acquire kernel native input authority',()=>{
 const value=structuredClone(hir),fn=value.functions.find(f=>f.name==='right');
 if(missing==='kernel role')value.closure.roots.find(r=>r.target===fn.id).kind='application';
 else if(missing==='required root')value.closure.requiredRoots=value.closure.requiredRoots.filter(r=>r.target!==fn.id);
 else value.snapshot.payload.entryCompatibilityRoots=value.snapshot.payload.entryCompatibilityRoots.filter(r=>r.functionId!==fn.sourceBinding);
 open(value);
});
test('an admitted scalar kernel entry cannot override a managed internal call argument',()=>{
 const value=structuredClone(hir),right=value.functions.find(f=>f.name==='right'),scalar=right.parameters[0].type;
 const string={kind:'stringLiteral',type:'string',codeUnits:[120]};if(!value.types.some(t=>t.id==='string'))value.types.push({id:'string',sourceType:'string',kind:'string'});
 method(value,'Derived').body=[{kind:'throw',value:call(right,[{kind:'as',type:scalar,expression:string}])}];open(value);
});

for(const payload of ['managed','unknown','native'])test('explicit actual '+payload+' survives a callee purethrow catch and rethrow',()=>{
 const value=structuredClone(hir),scalar=type(value,'Delta').fields[0].type,unknown=value.types.find(t=>t.kind==='unknown'),target=method(value,'Derived');
 const bounce=helper(value,'catch-rethrow',scalar,f=>[{kind:'try',tryBlock:{body:[{kind:'throw',value:binding(f.parameters[0].id,scalar)}]},catchClause:{binding:{id:'probe-rethrow-catch',type:unknown.id},block:{body:[{kind:'throw',value:binding('probe-rethrow-catch',unknown.id)}]}}}]);
 const argument=payload==='native'?{kind:'numericLiteral',type:scalar,token:'7',decimal:'7'}:payload==='managed'?{kind:'as',type:scalar,expression:binding(target.parameters[0].id,target.parameters[0].type)}:{kind:'checkedElementAccess',type:scalar,receiver:binding(target.parameters[0].id,target.parameters[0].type),index:{kind:'numericLiteral',type:scalar,token:'0',decimal:'0'}};
 target.body=[{kind:'return',value:call(bounce,[argument])}];if(payload==='native')assert.equal(run(value).uncertain,false);else open(value);
});

test('an unknown actual returned by a callee catch cannot establish a global native writer',()=>{
 const value=structuredClone(hir),scalar=type(value,'Delta').fields[0].type,unknown=value.types.find(t=>t.kind==='unknown'),target=method(value,'Derived'),array=target.parameters[0].type,global=value.globals[0];
 const bounce=helper(value,'catch-return',scalar,f=>[{kind:'try',tryBlock:{body:[{kind:'throw',value:binding(f.parameters[0].id,scalar)}]},catchClause:{binding:{id:'probe-return-catch',type:unknown.id},block:{body:[{kind:'return',value:{kind:'as',type:scalar,expression:binding('probe-return-catch',unknown.id)}}]}}}]);
 const poison=helper(value,'catch-global-writer',array,f=>[{kind:'expression',value:{kind:'bindingAssignment',operator:'=',type:scalar,target:{kind:'globalTarget',type:scalar,global:global.id},value:call(bounce,[{kind:'checkedElementAccess',type:scalar,receiver:binding(f.parameters[0].id,array),index:{kind:'numericLiteral',type:scalar,token:'0',decimal:'0'}}])}},{kind:'return',value:{kind:'numericLiteral',type:scalar,token:'0',decimal:'0'}}]);
 target.body=[{kind:'expression',value:call(poison,[binding(target.parameters[0].id,array)])},{kind:'throw',value:{kind:'globalReference',global:global.id,type:scalar}}];open(value);
});
