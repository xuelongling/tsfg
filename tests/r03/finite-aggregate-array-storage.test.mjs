// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir,verifyHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteArrayReaching} from '../../compiler/finite-array-reaching.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';

// Complete official Source3d547f public-v8 packets, captured after freezing
// the source and independent expectation. Diagnostics are not borrow licenses.
/** @type {Array<[string,string,string,boolean]>} */
const cases=[
  ['create','bde2ef6459ed24d9bde47953374163048b07bae59855f160af347e5670c4d55f',
    '060d4b8dca924037c6dcee2b446dd7ff62e8c953861a291c58f089141167aa2c',false],
  ['live-conflict','e257475d7699a00b425dc5959ec6d91e1680232e28c1a3c9a1893e8381f21282',
    '6bacb38ff23428e90abba5377ebb28aee752ed90ddbe762a8cfc6681684187fc',true],
  ['store','28158edebd49f64438bceba1edf046762f4805e53a1b4416a84cc87d8d50122f',
    '4e12cab560da7ed6c0eafc57aa70629037cf2416f88dcabe19d46d42f3d1cb39',false],
  ['store-live-conflict','d99d7e1bca153213a17bd5c8b442b12ac85bde665fa1b44db972c838ec8490a0',
    '71dc3d6478e4b97270a2dfe4dffaed8e486a784c861975df44d44c62be4c116c',true]
];
/** @param {string} fixture @param {string} packetHash @param {string} sourceHash */
async function actual(fixture,packetHash,sourceHash){
  const bytes=await readFile(new URL(fixture,import.meta.url));
  assert.equal(sha256(bytes).slice(7),packetHash);
  const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(row=>row.path===facts.payload.rootFile);
  assert.ok(source);assert.equal(sha256(source.content).slice(7),sourceHash);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts);
  return {facts,source:source.content,context,publication,built:buildHir(facts,context,publication)};
}
for(const row of cases)test('official aggregate Array '+row[0]+' retains its actual owner',async t=>{
  const [name,packetHash,sourceHash,conflict]=row;
  const {facts,source,context,publication,built}=await actual('./testdata/typed-array-aggregate-storage/'+name+'-package.json',String(packetHash),String(sourceHash));
  if(conflict){
    assert.equal(built.status,'error');assert.equal(built.hir,undefined);
    const diagnostic=built.diagnostics[0];assert.equal(diagnostic.code,'r03-d-readspan-structural-conflict');
    assert.equal(source.slice(diagnostic.primary.start,diagnostic.primary.end),'a.length=0');
    assert.ok(diagnostic.related.some(row=>row.kind==='borrow-last-use'&&source.slice(row.start,row.end)==='hs[0].span[0]'));
    return;
  }
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  assert.deepEqual(verifyHir(built.hir,context,publication),built.hir);
  const core=lowerFormalHir(built.hir,context,publication);
  assert.ok(core.includes('field_reaching = '),'selected Holder has real field versions');
  assert.ok(core.includes('"tsfg_core.domain.array_read"'));
  if(name==='store')assert.ok(core.includes('"tsfg_core.domain.array_store"'));
  assert.throws(()=>buildFiniteCoreDomains(built.hir,context,{publicationContext:publication,work:1}),/work limit/);
  if(process.env.TSFG_CORE_IR_EXE)await t.test('independent actual Core accepts the complete Source result',async()=>{
    accepted(await invokeCore(core));
    if(name==='create'){
      // Adversarial Core input only: do not mutate the official Source packet
      // or turn a missing field source into a closed-storage permission.
      const unproved=core.replace(/, field_reaching = "(?:[^"\\]|\\.)*"/g,'');
      assert.notEqual(unproved,core);const result=await invokeCore(unproved);rejected(result);
      assert.match(result.stderr.toString('utf8'),/lifetime|memory/);
    }
  });
});

test('existing direct Span Array selected reads keep their legal storage closure',async()=>{
  const source='f0f4a3e0a384a08fdfe7532a6bd86e63f52e3f6c3704cf53a60f0dfee2629979';
  const {context,publication,built}=await actual('./testdata/typed-array-span-array-slots/'+source+'-package.json',
    '512d8c5d1d5c481f27d7d9af0a13ef5e205f6289b37abf305acc1c225faf399e',source);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  if(process.env.TSFG_CORE_IR_EXE)accepted(await invokeCore(lowerFormalHir(built.hir,context,publication)));
});

test('a checked field receiver must complete before the next Array read',async()=>{
  const [,packetHash,sourceHash]=cases[0];
  const {built}=await actual('./testdata/typed-array-aggregate-storage/create-package.json',packetHash,sourceHash);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built,fn=hir.functions.find(row=>row.name==='run');
  assert.ok(fn);
  const returned=fn.body.at(-1),field=returned.value.receiver;
  const construction=fn.body.find(row=>row.kind==='local'&&row.binding.name==='h').initializer;
  assert.equal(returned.value.kind,'arrayReadChecked');
  assert.equal(field.kind,'fieldAccess');
  assert.equal(field.receiver.kind,'arrayReadChecked');
  const inside=field.receiver.index,outside=construction.arguments[0].arguments[2];
  assert.equal(inside.decimal,'0');
  assert.equal(outside.decimal,'1');
  assert.equal(inside.type,outside.type);

  // Exercise the analysis component with the original field read and checked
  // Array operands. The inserted statement is a model, not a new Source capture.
  const offset=fn.body.length-1,root=fn.id+'/body/',read=root+offset+'/expression/receiver';
  const tail=root+(offset+1)+'/value/receiver/receiver';
  for(const {index,expected} of [
    {index:inside,expected:['proven','proven']},
    {index:outside,expected:['missing','pending']},
  ]){
    const expression={...field,receiver:{...field.receiver,index}};
    const model={...hir,functions:hir.functions.map(row=>row!==fn?row:{
      ...fn,body:[...fn.body.slice(0,-1),{kind:'expression',expression,range:field.range},returned],
    })};
    const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>true);
    const rows=[read,tail].map(node=>reaching.reads.find(row=>row.node===node));
    assert.deepEqual(rows.map(row=>row?.status),expected);
    if(index===inside)assert.deepEqual(rows[1].versions,rows[0].versions);
    else assert.deepEqual(rows[1].versions,[]);
  }
});

test('a checked field store completes its receiver before its value and the following Array read',async()=>{
  const [,packetHash,sourceHash]=cases[0];
  const {built}=await actual('./testdata/typed-array-aggregate-storage/create-package.json',packetHash,sourceHash);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built,fn=hir.functions.find(row=>row.name==='run');
  assert.ok(fn);
  const returned=fn.body.at(-1),field=returned.value.receiver;
  const construction=fn.body.find(row=>row.kind==='local'&&row.binding.name==='h').initializer;
  assert.equal(field.kind,'fieldAccess');
  assert.equal(field.receiver.kind,'arrayReadChecked');
  const inside=field.receiver.index,outside=construction.arguments[0].arguments[2];
  assert.equal(inside.decimal,'0');
  assert.equal(outside.decimal,'1');
  assert.equal(inside.type,outside.type);
  const owner=hir.types.find(type=>type.id===field.receiver.type);
  assert.equal(owner?.kind,'reference');
  assert.ok(owner.fields.some(member=>member.id===field.property&&!member.readonly&&member.type===field.type));

  // Insert a modeled store using the retained writable field, checked receiver,
  // and matching value type. The capture itself contains no such assignment.
  const offset=fn.body.length-1,root=fn.id+'/body/';
  const reads=[root+offset+'/expression/target/receiver',root+offset+'/expression/value/receiver',
    root+(offset+1)+'/value/receiver/receiver'];
  for(const {receiver,value,expected} of [
    {receiver:inside,value:inside,expected:['proven','proven','proven']},
    {receiver:outside,value:inside,expected:['missing','pending','pending']},
    {receiver:inside,value:outside,expected:['proven','missing','pending']},
  ]){
    const expression={kind:'fieldAssignment',type:field.type,range:field.range,
      target:{...field,kind:'fieldTarget',receiver:{...field.receiver,index:receiver}},
      value:{...field,receiver:{...field.receiver,index:value}}};
    const model={...hir,functions:hir.functions.map(row=>row!==fn?row:{
      ...fn,body:[...fn.body.slice(0,-1),{kind:'expression',expression,range:field.range},returned],
    })};
    const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>true);
    const rows=reads.map(node=>reaching.reads.find(row=>row.node===node));
    assert.deepEqual(rows.map(row=>row?.status),expected);
    if(receiver===inside&&value===inside){
      assert.deepEqual(rows[1].versions,rows[0].versions);
      assert.deepEqual(rows[2].versions,rows[0].versions);
    }else assert.deepEqual(rows[2].versions,[]);
  }
});

// The synthetic bodies isolate constructor operand order from Source production
// and model only the Array facts consumed by this analysis.
for(const kind of ['construct','superConstruct'])for(const {name,indices,expected} of [
  {name:'first fails',indices:[1,0],expected:['missing','pending','pending','pending']},
  {name:'second fails',indices:[0,1],expected:['proven','missing','pending','pending']},
  {name:'both complete',indices:[0,0],expected:['proven','proven','pending','proven']},
])test('construction arguments '+kind+' '+name,()=>{
  const range={start:0,end:1};
  const constant=decimal=>({kind:'constant',type:'i32',decimal:String(decimal),range});
  const array={kind:'arrayCreate',type:'array',elements:[constant(7)],range};
  const reference={kind:'reference',type:'array',binding:'slots',range};
  const read=(receiver,index)=>({kind:'arrayReadChecked',type:'i32',receiver,index:constant(index),range});
  const statement=expression=>({kind:'expression',expression,range});
  const superCall=kind==='superConstruct';
  const call={kind,type:superCall?'void':'Derived',callee:superCall?'Base':'Derived',
    arguments:indices.map(index=>read(reference,index)),range};
  const body=[
    {kind:'local',binding:{id:'slots',type:'array'},initializer:array,range},
    statement(call),statement(read(reference,0)),statement(read(array,0)),
  ];
  const fn={id:'body',sourcePath:'model.ts',parameters:[],body,
    ...(superCall?{role:'construction-body',ownerType:'Derived',construction:'derived',
      parameters:[{id:'this',type:'Derived'}]}:{})};
  const model={functions:[fn],exports:superCall?[]:[{functionId:fn.id}],types:[
    {id:'i32',kind:'scalar',constructor:undefined},{id:'void',kind:'void',constructor:undefined},
    {id:'array',kind:'array',element:'i32',constructor:undefined},
    {id:'Derived',kind:'reference',constructor:'body',construction:{initialization:[]}},
  ],intrinsics:{readSpan:{id:'readSpan'}}};
  const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>true);
  const paths=['1/expression/arguments/0','1/expression/arguments/1','2/expression','3/expression'];
  const rows=paths.map(path=>reaching.reads.find(row=>row.node==='body/body/'+path));
  const first='body/body/0/initializer/initial/0/array-version',fresh='body/body/3/expression/receiver/initial/0/array-version';
  assert.deepEqual(rows.map(row=>row?.status),expected);
  assert.deepEqual(rows.map(row=>row?.versions),expected.map((status,index)=>status==='proven'?[index===3?fresh:first]:[]));
  assert.ok(reaching.writes.some(row=>row.id===fresh),'lexical inventory includes the later fresh array');
});

const edges=[
  ['external-store','2da94f8faf2ccfce063ba3a4b37023cb0d0a00056604f83257d5771b7c493423',
    '6ff21b20fca958a1e7e7dd834368c008b5d5bc7ffcd02a9a7c7b362671cb91a2'],
  ['selected-return','48b781c24069dc159ffe9802388625abd0612a99e1032e3d526ec631b6dd28a4',
    '4fbfbac18168871bdeab56c370a09ecf7542b7e700253cc833a812137b46e640'],
  ['value-snapshot','e31423fa1b98e6ef87f55e582fcd6d7993052e7a63b8f35b21bfa93c478bc9c0',
    '79474a74f0bbdb30ae436af9430fcee9e3b4bf86a6808fb2865e0a703f30de37']
];
for(const [name,packetHash,sourceHash]of edges)test('official selected aggregate '+name+' keeps its storage boundary',async()=>{
  const {context,publication,built}=await actual('./testdata/typed-array-aggregate-storage/'+name+'-package.json',packetHash,sourceHash);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const core=lowerFormalHir(built.hir,context,publication);
  if(name==='value-snapshot'){
    assert.ok(core.includes('field_reaching = '),'stored value copy retains its original field versions');
    const fn=built.hir.functions.find(row=>row.name==='run'),state=built.hir.readSpanPlan.functions.find(row=>row.functionId===fn.id);
    const read=state.events.findLast(row=>row.kind==='view-read-complete');assert.ok(read);
    const view=state.views.find(row=>row.viewId===read.viewId),a=fn.body.find(row=>row.kind==='local'&&row.binding.name==='a');
    assert.equal(view.owner.kind,'allocation');assert.equal(view.owner.functionId,fn.id);
    assert.equal(view.owner.allocationSite,a.initializer.allocationSite,'overwriting h.span cannot alter its stored value copy');
  }
  if(process.env.TSFG_CORE_IR_EXE){
    const result=await invokeCore(core);
    if(name==='external-store'){
      // This Source is language-legal. The unclosed external destination is a
      // current capability limit, not a permanent prohibition on managed storage.
      rejected(result);assert.match(result.stderr.toString('utf8'),/lifetime is unproved/);
    }else accepted(result);
  }
});
