// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteFieldReaching} from '../../compiler/finite-field-reaching.mjs';
import {sha256} from '../../compiler/identity.mjs';

async function pair() {
  const file='2b95554986d9aff742030c402a842c1de3113e4d8199b4bc169bf94a1daa2717';
  const bytes=await readFile(new URL('./testdata/typed-array-source514/'+file+'-package.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok');return {hir:built.hir,context};
}

test('real Pair Source return materializes a copy after checked read and pure views',async()=>{
  const {hir,context}=await pair(),source=hir.sources.find(row=>row.path==='/src/main.ts');
  assert.equal(sha256(source.content),'sha256:2b95554986d9aff742030c402a842c1de3113e4d8199b4bc169bf94a1daa2717');
  const fn=hir.functions.find(row=>row.name==='f'),core=lowerFormalHir(hir,context),
    body=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0],
    lines=body.split('\n'),read=lines.findIndex(row=>row.includes('"tsfg_core.domain.array_read"')),
    copy=lines.findIndex(row=>row.includes('"tsfg_core.domain.copy"')),
    returned=lines.findIndex(row=>row.includes('"func.return"'));
  assert.ok(read>=0&&copy>read&&returned>copy);
  assert.equal(lines.filter(row=>row.includes('"tsfg_core.domain.copy"')).length,1);
  const result=/^\s*(%\w+) =/.exec(lines[copy]);assert.ok(result);assert.ok(lines[returned].includes(result[1]));
});

test('value parameter mutations and returned copies cannot replace caller field versions',async()=>{
  const {hir}=await pair(),value=hir.types.find(row=>row.kind==='value'),field=value.fields[0],fn=hir.functions[0],range={start:0,end:0},
    ref=binding=>({kind:'reference',binding,type:value.id,range}),literal={kind:'constant',type:field.type,range},
    parameter=id=>({...fn.parameters[0],id,type:value.id}),target={actualType:value.id,fieldId:field.id,fieldType:field.type},
    assign=receiver=>({kind:'expression',expression:{kind:'fieldAssignment',type:field.type,range,target:{receiver,property:field.id},value:literal}}),
    change={...fn,id:fn.id+'/change',parameters:[parameter('p')],returnType:{id:field.type},
      body:[assign(ref('p')),{kind:'return',value:literal}]},
    pass={...fn,id:fn.id+'/pass',parameters:[parameter('p')],returnType:{id:value.id},body:[{kind:'return',value:ref('p')}]},
    call=(target,type)=>({kind:'call',target,type,range,arguments:[ref('a')]}),
    read=receiver=>({kind:'fieldAccess',receiver,property:field.id,type:field.type,range}),
    caller={...fn,parameters:[parameter('a')],body:[assign(ref('a')),
      {kind:'expression',expression:call(change.id,field.type)},
      {kind:'local',range,binding:{id:'b',type:value.id},initializer:call(pass.id,value.id)},
      {kind:'local',range,binding:{id:'captured',type:field.type},initializer:read(ref('b'))},
      assign(ref('b')),{kind:'return',value:read(ref('a'))}]},
    fields=[fn.id+'/body/0/expression',fn.id+'/body/3/initializer',fn.id+'/body/4/expression',fn.id+'/body/5/value',change.id+'/body/0/expression']
      .map(id=>({id,targets:[target]})),
    reaching=buildFiniteFieldReaching({...hir,exports:[],functions:[caller,change,pass]},
      {fields,calls:[],nodes:[],domains:[]},()=>{});
  for(const node of [fn.id+'/body/3/initializer',fn.id+'/body/5/value']) {
    const access=reaching.reads.find(row=>row.node===node);assert.equal(access.reaching.length,1);
    assert.deepEqual(access.reaching[0].versions,[fn.id+'/body/0/expression/field-version/'+value.id+'/'+field.id]);
  }
  assert.ok(reaching.writes.some(row=>row.id.startsWith(change.id+'/')),'callee retains its independent successful write');
});

test('value arguments snapshot before later argument side effects',async()=>{
  const {hir}=await pair(),value=hir.types.find(row=>row.kind==='value'),field=value.fields[0],fn=hir.functions[0],range={start:0,end:0},
    parameter=(id,type)=>({...fn.parameters[0],id,type}),ref=binding=>({kind:'reference',binding,type:value.id,range}),
    literal={kind:'constant',type:field.type,range},
    assignment={kind:'fieldAssignment',type:field.type,range,target:{receiver:ref('a'),property:field.id},value:literal},
    helper={...fn,id:fn.id+'/read-first-argument',parameters:[parameter('p',value.id),parameter('later',field.type)],
      returnType:{id:field.type},body:[{kind:'return',value:{kind:'fieldAccess',receiver:ref('p'),property:field.id,type:field.type,range}}]},
    caller={...fn,parameters:[parameter('a',value.id)],body:[{kind:'expression',expression:assignment},
      {kind:'local',binding:{id:'result',type:field.type},initializer:{kind:'call',target:helper.id,type:field.type,range,
        arguments:[ref('a'),assignment]}}]},
    target={actualType:value.id,fieldId:field.id,fieldType:field.type},
    fields=[fn.id+'/body/0/expression',fn.id+'/body/1/initializer/arguments/1',helper.id+'/body/0/value'].map(id=>({id,targets:[target]})),
    reaching=buildFiniteFieldReaching({...hir,exports:[],functions:[caller,helper]},
      {fields,calls:[],nodes:[],domains:[]},()=>{}),read=reaching.reads.find(row=>row.node===helper.id+'/body/0/value');
  assert.equal(read.reaching.length,1);
  assert.deepEqual(read.reaching[0].versions,[fn.id+'/body/0/expression/field-version/'+value.id+'/'+field.id]);
});

test('mixed carriers copy the active value plane and share the active reference plane',async()=>{
  const {hir}=await pair(),value=hir.types.find(row=>row.kind==='value'),box=hir.types.find(row=>row.kind==='reference'),
    field=value.fields[0],boxField=box.fields[0],fn=hir.functions[0],range={start:0,end:0},mixed='constraint-mixed-value-reference',
    union={id:mixed,kind:'union',members:[value.id,box.id]},ref=binding=>({kind:'reference',binding,type:mixed,range}),
    targets=[{actualType:value.id,fieldId:field.id,fieldType:field.type},{actualType:box.id,fieldId:boxField.id,fieldType:boxField.type}],
    store=binding=>({kind:'expression',expression:{kind:'fieldAssignment',type:field.type,range,target:{receiver:ref(binding),property:field.id},
      value:{kind:'constant',type:field.type,range}}}),
    helper={...fn,id:fn.id+'/mixed-write',parameters:[{...fn.parameters[0],id:'p',type:mixed}],body:[store('p')]},
    caller={...fn,parameters:[{...fn.parameters[0],id:'a',type:mixed}],body:[store('a'),
      {kind:'local',binding:{id:'b',type:mixed},initializer:ref('a')},store('b'),
      {kind:'expression',expression:{kind:'call',target:helper.id,arguments:[ref('b')],type:field.type,range}},
      {kind:'return',value:{kind:'fieldAccess',receiver:ref('a'),property:field.id,type:field.type,range}}]},
    fields=[fn.id+'/body/0/expression',fn.id+'/body/2/expression',fn.id+'/body/4/value',helper.id+'/body/0/expression'].map(id=>({id,targets})),
    reaching=buildFiniteFieldReaching({...hir,exports:[],types:[...hir.types,union],functions:[caller,helper]},
      {fields,calls:[],nodes:[],domains:[]},()=>{}),read=reaching.reads.find(row=>row.node===fn.id+'/body/4/value');
  assert.equal(read.reaching.length,2);
  for(const row of read.reaching)assert.deepEqual(row.versions,[(row.actualType===value.id?fn.id+'/body/0/expression':helper.id+'/body/0/expression')
    +'/field-version/'+row.actualType+'/'+row.field]);
});

// These are bounded constraint units over the real Pair/Box catalogue. They
// exercise production memory equations; they are not invented Source facts or
// a claim that the C++ IR adapter/VM executed this program.
test('value field planes preserve snapshots while contained reference writes remain shared',async()=>{
  const {hir}=await pair(),value=hir.types.find(row=>row.kind==='value'),box=hir.types.find(row=>row.kind==='reference'),
    n=value.fields.find(row=>row.name==='n')??value.fields[0],child=value.fields.find(row=>row.id!==n.id),
    boxN=box.fields[0],fn=hir.functions[0],range={start:0,end:0};
  const ref=(binding,type=value.id)=>({kind:'reference',binding,type,range});
  const literal={kind:'constant',type:n.type,range},select=(actual,field)=>({actualType:actual,fieldId:field.id,fieldType:field.type});
  const selections=[];
  const store=(index,receiver,field,rhs,actual=value.id)=>{
    selections.push({id:fn.id+'/body/'+index+'/expression',targets:[select(actual,field)]});
    return {kind:'expression',expression:{kind:'fieldAssignment',type:field.type,range,target:{receiver,property:field.id},value:rhs}};
  };
  const read=(index,receiver,field,actual=value.id)=>{
    selections.push({id:fn.id+'/body/'+index+'/initializer',targets:[select(actual,field)]});
    return {kind:'local',range,binding:{id:'read'+index,type:field.type},initializer:{kind:'fieldAccess',receiver,property:field.id,type:field.type,range}};
  };
  const body=[store(0,ref('a'),n,literal),store(1,ref('a'),child,ref('box',box.id)),
    {kind:'local',range,binding:{id:'b',type:value.id},initializer:ref('a')},
    store(3,ref('b'),n,literal),read(4,ref('a'),n),read(5,ref('b'),n),
    store(6,ref('a'),n,literal),read(7,ref('b'),n)];
  const fromB={kind:'fieldAccess',receiver:ref('b'),property:child.id,type:child.type,range},
    fromA={...fromB,receiver:ref('a')};
  body.push(store(8,fromB,boxN,literal,box.id),read(9,fromA,boxN,box.id));
  selections.push({id:fn.id+'/body/8/expression/target/receiver',targets:[select(value.id,child)]},
    {id:fn.id+'/body/9/initializer/receiver',targets:[select(value.id,child)]});
  const parameter=(id,type)=>({...fn.parameters[0],id,type});
  const unit={...hir,exports:[],functions:[{...fn,parameters:[parameter('a',value.id),parameter('box',box.id)],body}]};
  const reaching=buildFiniteFieldReaching(unit,{calls:[],fields:selections,nodes:[],domains:[]},()=>{});
  const version=index=>fn.id+'/body/'+index+'/expression/field-version/';
  for(const [index,write] of [[4,0],[5,3],[7,3],[9,8]]) {
    const access=reaching.reads.find(row=>row.node===fn.id+'/body/'+index+'/initializer');assert.ok(access);
    assert.equal(access.reaching.length,1,'read '+index);assert.equal(access.reaching[0].versions.length,1);
    assert.ok(access.reaching[0].versions[0].startsWith(version(write)));
  }
});
