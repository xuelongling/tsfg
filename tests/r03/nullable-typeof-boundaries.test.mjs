// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {importNullableCapturedResponse,nullableSnapshotFacts,matchesNullableSnapshot} from '../../compiler/nullable-frontend.mjs';
import {verifyNullableFacts} from '../../compiler/nullable-facts.mjs';
import {buildNullableHir,verifyNullableHir} from '../../compiler/nullable-hir.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerHir} from '../../compiler/hir.mjs';
import {raw,data,expected,fresh,jcs,sha,rejects,packetAttack,spliceSource,groupedContinuationAttack} from './nullable-typeof-fixtures.mjs';

test('typeof undefined rehashed DTOs cannot grant syntax symbol type or branch flow authority',async t=>{
 /** @type {[string,(packet:any,request?:any)=>void][]} */
 const vectors=[
  ['loose equality',p=>{p.payload.facts.functions[0].body[0].condition.operator='==';}],
  ['loose inequality',p=>{p.payload.facts.functions[1].body[0].condition.operator='!=';}],
  ['strict operator swap',p=>{p.payload.facts.functions[0].body[0].condition.operator='!==';}],
  ['condition kind',p=>{p.payload.facts.functions[0].body[0].condition.kind='presenceTest';}],
  ['bool type',p=>{p.payload.facts.functions[0].body[0].condition.type='i32';}],
  ['foreign tag',p=>{p.payload.facts.functions[0].body[0].condition.typeTest.tag='null';}],
  ['tag range',p=>{p.payload.facts.functions[0].body[0].condition.typeTest.tagRange.start++;}],
  ['typeof range',p=>{p.payload.facts.functions[0].body[0].condition.typeTest.typeofRange.end++;}],
  ['condition range',p=>{p.payload.facts.functions[0].body[0].condition.range.start++;}],
  ['operand raw range',p=>{p.payload.facts.functions[0].body[0].condition.operand.range.start++;}],
  ['operand foreign symbol',p=>{p.payload.facts.functions[0].body[0].condition.operand.symbol='s8';}],
  ['operand missing flow',p=>{delete p.payload.facts.functions[0].body[0].condition.operand.presenceFlow;}],
  ['operand invented flow',p=>{p.payload.facts.functions[0].body[0].condition.operand.presenceFlow.undefined=false;}],
  ['unrelated scalar matching flow',p=>{p.payload.facts.functions[0].body[0].thenBody[0].body[0].expression.presenceFlow={undefined:false,null:false};}],
  ['nullable returned missing proof',p=>{delete p.payload.facts.functions[1].body[0].thenBody[0].body[0].expression.presenceFlow;}],
  ['nullable early return wrong proof',p=>{p.payload.facts.functions[1].body[0].thenBody[0].body[0].expression.presenceFlow.undefined=true;}],
  ['keepNull removes null',p=>{p.payload.facts.functions[4].body[1].expression.left.presenceFlow.null=false;}],
  ['keepNull keeps undefined',p=>{p.payload.facts.functions[4].body[1].expression.left.presenceFlow.undefined=true;}],
  ['keepNull unrelated matching flow',p=>{p.payload.facts.functions[4].body[1].expression.right.presenceFlow={undefined:false,null:false};}],
  ['keepNull wrong coalesce operator',p=>{p.payload.facts.functions[4].body[1].expression.operator='||';}],
  ['invented else',p=>{p.payload.facts.functions[0].body[0].elseBody=[];}],
  ['extra condition key',p=>{p.payload.facts.functions[0].body[0].condition.proof=true;}],
  ['then swapped with tail',p=>{const f=p.payload.facts.functions[0];[f.body[0].thenBody[0].body[0],f.body[1]]=[f.body[1],f.body[0].thenBody[0].body[0]];}],
  ['symbol declaration mask',p=>{p.payload.facts.symbols[6].presence.undefined=false;}],
  ['foreign binding',p=>{p.payload.facts.functions[0].parameters[0].id='s9';}],
  ['source strict token changed',(p,r)=>{const f=r.input.files.find(f=>f.path===r.input.rootFile);f.content=f.content.replace('x===','x!==');}],
  ['source tag spelling',(p,r)=>{const f=r.input.files.find(f=>f.path===r.input.rootFile);f.content=f.content.replace('"undefined"','"not-a-tag"');}],
  ['unrelated continuation scalar',(p,r)=>{spliceSource(p,r,454,458,'b');p.payload.facts.functions[4].body[1].expression={kind:'reference',type:'i32',symbol:'s16',range:{start:453,end:455}};}],
 ];
 for(const [name,change] of vectors)await t.test(name,()=>rejects(packetAttack(change)));
 for(const i of [0,1,2,3])for(const op of ['==','!='])await t.test(`forbidden ${i} ${op}`,()=>rejects(packetAttack(p=>{p.payload.facts.functions[i].body[0].condition.operator=op;})));
 for(const i of [0,1,2,3])await t.test(`source and DTO loose ${i} repaired UTF16`,()=>rejects(packetAttack((p,r)=>{
  const span=expected.officialOracle.cases[i].operator.range,op=i===1||i===3?'!=':'==';
  spliceSource(p,r,span[0],span[1],op);p.payload.facts.functions[i].body[0].condition.operator=op;
 }),'capability'));
});

test('typeof undefined copied HIR cannot move gets predicates types or original source anchors',async t=>{
 /** @type {[string,(hir:any)=>void][]} */
 const vectors=[
  ['predicate complement',h=>{h.functions[1].body[0].condition.tag=1;}],
  ['equality tag',h=>{h.functions[0].body[0].condition.tag=0;}],
  ['typeTest source range',h=>{h.functions[2].body[0].condition.range.end--;}],
  ['tag raw range',h=>{h.functions[0].body[0].condition.tagRange.start++;}],
  ['predicate binding',h=>{h.functions[0].body[0].condition.operand.binding='s8';}],
  ['remove proved get',h=>{h.functions[1].body[0].thenBody[0].body[0].value=h.functions[1].body[0].thenBody[0].body[0].value.operand;}],
  ['put get on fallback',h=>{h.functions[0].body[0].thenBody[0].body[0].value=h.functions[0].body[1].value;}],
  ['keepNull declaration type',h=>{h.functions[4].parameters[0].type=h.functions[0].parameters[0].type;}],
  ['keepNull remove lazy fallback',h=>{h.functions[4].body[1].value=h.functions[0].body[1].value;}],
  ['keepNull invent narrowed storage',h=>{h.functions[4].body[1].value.left.type=h.functions[0].parameters[0].type;}],
  ['invent source typeof metadata',h=>{h.functions[0].body[0].condition.typeofRange={start:42,end:50};}],
  ['format',h=>{h.format.version=5;}],
  ['identity',h=>{h.functions[0].id='sha256:'+'0'.repeat(64);}],
 ];
 for(const [name,mutate] of vectors)await t.test(name,()=>{
  const h=fresh(expected.hir);mutate(h);
  for(const action of [()=>verifyHir(h,expected.context),()=>printHir(h,expected.context),()=>readHir(Buffer.from(jcs(h)+'\n'),expected.context),()=>lowerHir(h,expected.context)])rejects(action);
 });
});

test('typeof continuation groups require the exact source-bound symbol and branch proof',async t=>{
 /** @type {[string,(packet:any,request?:any)=>void][]} */
 const vectors=[
  ['unrelated symbol with forged mask0',(p,r)=>{
   spliceSource(p,r,92,93,'b');const leaf=p.payload.facts.functions[0].body[1].expression.operand.operand;leaf.symbol='s8';
  }],
  ['unrelated symbol without flow',(p,r)=>{
   spliceSource(p,r,92,93,'b');const leaf=p.payload.facts.functions[0].body[1].expression.operand.operand;leaf.symbol='s8';delete leaf.presenceFlow;
  }],
  ['wrong nullable leaf flow',p=>{p.payload.facts.functions[0].body[1].expression.operand.operand.presenceFlow.undefined=true;}],
  ['missing nullable leaf flow',p=>{delete p.payload.facts.functions[0].body[1].expression.operand.operand.presenceFlow;}],
  ['invented outer matching flow',p=>{p.payload.facts.functions[0].body[1].expression.presenceFlow={undefined:false,null:false};}],
  ['outer group range',p=>{p.payload.facts.functions[0].body[1].expression.range.start++;}],
  ['inner group range',p=>{p.payload.facts.functions[0].body[1].expression.operand.range.end--;}],
  ['raw leaf range',p=>{p.payload.facts.functions[0].body[1].expression.operand.operand.range.start--;}],
 ];
 for(const [name,change] of vectors)await t.test(name,()=>rejects(groupedContinuationAttack(change)));
});

test('typeof undefined explicit schemas origins versions and frozen snapshot are complete',()=>{
 for(const version of [3,4,5])rejects(()=>verifyNullableFacts({path:expected.snapshot.source.path,content:expected.snapshot.source.content},fresh(expected.facts),fresh(expected.exports),version));
 for(const version of [3,4,5,7]){const c={...expected.context,sourceVersion:version};rejects(()=>importNullableCapturedResponse(raw('request.json'),raw('package.json'),c.expectedOrigin,c));}
 for(const key of ['version','schemaHash','family','requestId','packageId']){
  const p=data('package.json');p[key]=key==='version'?5:'wrong';const bytes=Buffer.from(jcs(p)),origin={...expected.context.expectedOrigin,responseSha256:sha(bytes)};
  rejects(()=>importNullableCapturedResponse(raw('request.json'),bytes,origin,{...expected.context,expectedOrigin:origin}));
 }
 for(const key of ['sourceVersion','sourceSchemaHash','expectedPackageId','expectedOrigin']){const c=fresh(expected.context);delete c[key];rejects(()=>buildNullableHir(fresh(expected.snapshot),c));}
 for(const mutate of [s=>{s.format.version=5;},s=>{s.sourceOrigin.producerDirty=false;},s=>{s.source.hash='wrong';},s=>{s.functions[4].body[1].expression.left.presenceFlow.null=false;},s=>{s.capture.response+=' ';}]){
  const s=fresh(expected.snapshot);mutate(s);rejects(()=>nullableSnapshotFacts(s,expected.context));assert.equal(matchesNullableSnapshot(s,expected.context),false);
  const result=buildHir(s,expected.context);assert.equal(result.status,'error');assert.ok(!Object.hasOwn(result,'hir'));
 }
 for(const action of [()=>buildNullableHir(fresh(expected.snapshot)),()=>verifyNullableHir(fresh(expected.hir)),()=>lowerHir(fresh(expected.hir))])rejects(action,'schema');
});

test('typeof undefined safe graph budgets precede fields and failures publish no partial value',()=>{
 let reads=0;const c=fresh(expected.context);Object.defineProperty(c,'expectedOrigin',{get(){reads++;throw Error('getter');}});
 rejects(()=>buildNullableHir(fresh(expected.snapshot),c),'schema');assert.equal(reads,0);
 const proxy=new Proxy({}, {ownKeys(){reads++;throw Error('proxy');}});rejects(()=>verifyNullableHir(proxy,expected.context),'schema');assert.equal(reads,0);
 const unsafe=fresh(expected.snapshot);Object.defineProperty(unsafe,'functions',{get(){reads++;throw Error('getter');}});
 const result=buildHir(unsafe,expected.context);assert.equal(result.status,'error');assert.ok(!Object.hasOwn(result,'hir'));assert.equal(reads,0);
 const deep=fresh(expected.hir);let at=deep;for(let i=0;i<130;i++)at=at.self={};rejects(()=>verifyHir(deep,expected.context),'limit');
 const huge=fresh(expected.snapshot);huge.symbols=Array(4097).fill(huge.symbols[0]);rejects(()=>buildNullableHir(huge,expected.context),'limit');
 const cycle=fresh(expected.hir);cycle.self=cycle;rejects(()=>verifyHir(cycle,expected.context));
 for(const bytes of [Buffer.from(jcs(expected.hir)),Buffer.from(jcs(expected.hir)+'\n\n'),Buffer.from(' '+jcs(expected.hir)+'\n'),Buffer.from([0xff]),new Proxy(Buffer.from('{}'),{})])rejects(()=>readHir(bytes,expected.context));
 const supplied=fresh(expected.hir),owned=verifyNullableHir(supplied,expected.context);supplied.functions[0].body[0].condition.tag=0;
 assert.deepEqual(owned,expected.hir);assert.ok(Object.isFrozen(owned.functions[0].body[1].value.operand));
 for(const action of [()=>verifyHir(fresh(expected.hir),expected.context,{}),()=>readHir(Buffer.from(jcs(expected.hir)+'\n'),expected.context,{}),()=>lowerHir(fresh(expected.hir),expected.context,{})])rejects(action,'context');
});
