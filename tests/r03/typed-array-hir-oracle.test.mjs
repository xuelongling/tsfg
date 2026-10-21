// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildHir} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {verifyHir} from '../../compiler/module-hir.mjs';
const root=new URL('./testdata/typed-array-actual-v8/',import.meta.url);
async function packet(name){return JSON.parse(await readFile(new URL(name+'-package.json',root),'utf8'));}
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
function encoded(value){return Buffer.from(stable(value)+'\n');}
function build(value){const bytes=encoded(value);const result=buildHir(value,{family:'tsfg.array-facts-context-candidate',version:2,
  factsBytes:bytes,expectedPackageId:value.packageId});assert.equal(result.status,'ok',JSON.stringify(result.diagnostics));return result.hir;}
function nodes(value,kind){if(!value||typeof value!=='object')return [];return [...(value.kind===kind?[value]:[]),...Object.values(value).flatMap(child=>nodes(child,kind))];}

test('initialized undefined and assignment result keep their separate concrete types',async()=>{
  const hir=build(await packet('c4cd2bcc06fe4844f95fce28a0ba398afb1a8139f5c7bb594cc7a8474a223cb4'));
  const [local,store,returned]=hir.functions[0].body;
  const undefinedId=digest('tsfg.type\0undefined');
  assert.equal(local.initializer.elements[0].type,undefinedId);
  assert.equal(local.initializer.elements[1].decimal,'7');
  assert.equal(store.expression.type,undefinedId);
  assert.equal(store.expression.value.type,undefinedId);
  assert.equal(store.expression.target.type,returned.value.type);
  assert.equal(returned.value.kind,'arrayReadChecked');
  assert.notEqual(returned.value.type,undefinedId);
});
test('compound receiver index and RHS trees occur once and preserve call identities',async()=>{
  const hir=build(await packet('f2c9d4e124c4cc6331012390387c1e803adf0c4707ef653d9de4303066d75954'));
  const fn=hir.functions.find(row=>row.name==='update'),value=fn.body[0].value;
  assert.equal(value.kind,'arrayCompoundAssignment');assert.equal(value.operator,'+=');
  const calls=[value.target.receiver,value.target.index,value.value];
  assert.deepEqual(calls.map(call=>hir.functions.find(row=>row.id===call.target).name),['receiver','index','rhs']);
  assert.equal(nodes(value,'call').length,3);
  assert.equal(calls[2].arguments[0].decimal,'2');
  assert.ok(calls[0].range.end<calls[1].range.start&&calls[1].range.end<value.operatorRange.start
    &&value.operatorRange.end<=calls[2].range.start);
});
test('prefix and postfix preserve original result choice and checked target',async()=>{
  for(const [source,prefix] of [['1a80de3941d5c05dc0e4889e97267da169263bbfe70344e312cd0e74e964180d',false],
    ['36e5c6127928a4304093932d911892eba055e5057b83923cfdb6d5f1d353bd5c',true]]){
    const value=build(await packet(source)).functions[0].body[0].value;
    assert.equal(value.kind,'arrayUpdate');assert.equal(value.prefix,prefix);
    assert.equal(value.operator,'++');assert.equal(value.target.kind,'arrayElementTarget');
    assert.equal(nodes(value,'reference').length,2);
  }
});
test('String code units retain isolated surrogate NUL and concat operands',async()=>{
  const hir=build(await packet('619021d061e1003c598032e3bdaf00ece6600b52927d3718334a723a4c1e821e'));
  const body=hir.functions[0].body;
  assert.deepEqual(body[0].initializer.elements[1].codeUnits,[0xD800]);
  assert.equal(body[1].expression.value.kind,'stringConcat');
  assert.deepEqual(body[1].expression.value.left.codeUnits,[98]);
  assert.deepEqual(body[1].expression.value.right.codeUnits,[0]);
});
test('official structural projection and constructor parameter initialization survive ownership',async()=>{
  const hir=build(await packet('dddcc5ca1ceacd4dba3f824b236855267666a179c3b200cf44603f7e3a20e82f'));
  const fn=hir.functions.find(row=>row.name==='read'),element=fn.body[0].initializer.elements[0];
  const from=hir.types.find(type=>type.id===element.compatibility.sourceType);
  const to=hir.types.find(type=>type.id===element.compatibility.targetType);
  assert.notEqual(from.id,to.id);assert.equal(from.nominalKey.declarationPath[0],'Other');
  assert.equal(to.nominalKey.declarationPath[0],'Base');
  assert.deepEqual(element.compatibility.members,[{source:from.fields.find(row=>row.name==='n').id,target:to.fields[0].id}]);
  const box=build(await packet('38ac49ad717fc41a9c3fdc4178ac0284ce2e9f26794790d42bb41d6eeba66fe3'));
  const type=box.types.find(row=>row.kind==='reference'),ctor=box.functions.find(row=>row.id===type.constructor);
  assert.equal(type.fields[0].parameterBinding,ctor.parameters[1].id);
  assert.equal(ctor.parameters[0].implicit,true);
  const method=box.functions.find(row=>row.name==='next');
  assert.equal(method.ownerType,type.id);assert.equal(method.parameters[0].implicit,true);
  assert.equal(nodes(method.body,'reference').filter(row=>row.binding===method.parameters[0].id).length,2);
});

test('cold facts reject repaired-identity corruptions at the real typed boundary',async t=>{
  const original=await packet('c4cd2bcc06fe4844f95fce28a0ba398afb1a8139f5c7bb594cc7a8474a223cb4');
  /** @type {[string,(p:any)=>void,RegExp][]} */
  const cases=[
    ['unknown operation',p=>{p.payload.functions[0].body[2].value.kind='uncheckedRead';},/r03-typed-array-kind/],
    ['wrong index type',p=>{p.payload.functions[0].body[2].value.index.flowType='i32';},/r03-typed-array-flow/],
    ['forged scalar flow',p=>{p.payload.functions[0].body[0].initializer.elements[1].flowType='u32';},/r03-typed-array-flow/],
    ['literal bits disagree',p=>{p.payload.functions[0].body[0].initializer.elements[1].decimal='8';},/r03-typed-array-literal/],
    ['wrong binding',p=>{p.payload.functions[0].body[2].value.receiver.binding=p.payload.functions[0].parameters[0].id;},/r03-typed-array-binding/],
    ['wrong operator',p=>{p.payload.functions[0].body[1].value.operator='+=';},/r03-typed-array-source/],
    ['wrong catalogue relation',p=>{p.payload.types.find(row=>row.kind==='array').elementType='u32';},/r03-typed-array-type/],
  ];
  for(const [name,mutate,pattern] of cases)await t.test(name,()=>{
    const value=structuredClone(original);mutate(value);
    value.packageId=digest('tsfg.array-facts.package.v8\0'+value.schemaHash+'\0'+stable(value.payload));
    assert.throws(()=>readTypedArrayFacts(encoded(value)),pattern);
  });
  const legacy=structuredClone(original);legacy.version=7;
  assert.throws(()=>readTypedArrayFacts(encoded(legacy)),/r03-typed-array-identity/);
  const duplicate=encoded(original).toString().replace('"version":8','"version":8,"version":8');
  assert.throws(()=>readTypedArrayFacts(Buffer.from(duplicate)),/r03-typed-array-input/);
});

test('selected cold contexts reject mutable accessors proxies wrong packets and HIR drift',async()=>{
  const value=await packet('c4cd2bcc06fe4844f95fce28a0ba398afb1a8139f5c7bb594cc7a8474a223cb4');
  const bytes=encoded(value),ctx={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:value.packageId};
  const hir=build(value);
  assert.equal(buildHir(value,{...ctx,expectedPackageId:digest('other')}).status,'error');
  let reads=0;const getter={...ctx};Object.defineProperty(getter,'factsBytes',{enumerable:true,get(){reads++;return bytes;}});
  assert.equal(buildHir(value,getter).status,'error');assert.equal(reads,0);
  assert.equal(buildHir(value,new Proxy(ctx,{})).status,'error');
  assert.equal(buildHir(value,{...ctx,extra:true}).status,'error');
  const drift=structuredClone(hir);drift.functions[0].body.pop();
  assert.throws(()=>verifyHir(drift,ctx),/r03-typed-array-hir-projection/);
  const substituted=structuredClone(value);substituted.payload.functions[0].body.pop();
  assert.equal(buildHir(substituted,ctx).status,'error');
});

test('cold reference witnesses reject forged mappings after packet identity is repaired',async t=>{
  const original=await packet('dddcc5ca1ceacd4dba3f824b236855267666a179c3b200cf44603f7e3a20e82f');
  /** @type {[string,(p:any)=>void][]} */
  const cases=[
    ['duplicate member',proof=>{proof.members.push(structuredClone(proof.members[0]));}],
    ['missing projection',proof=>{proof.members=[];}],
    ['forged source type',proof=>{proof.sourceType=proof.targetType;}],
    ['forged member',proof=>{proof.members[0].source=digest('not-a-member');}],
  ];
  for(const [name,mutate] of cases)await t.test(name,()=>{
    const value=structuredClone(original),proof=nodes(value.payload,'new')[0]?.compatibility
      ??value.payload.functions.find(fn=>fn.name==='read').body[0].initializer.elements[0].compatibility;
    mutate(proof);value.packageId=digest('tsfg.array-facts.package.v8\0'+value.schemaHash+'\0'+stable(value.payload));
    assert.throws(()=>readTypedArrayFacts(encoded(value)));
  });
});
