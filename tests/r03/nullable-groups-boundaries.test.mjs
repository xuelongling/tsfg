// SPDX-License-Identifier: MIT
// Hash repair below makes adversarial packets, never a substitute Source capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {importNullableCapturedResponse,nullableSnapshotFacts,verifyNullableSnapshot,matchesNullableSnapshot} from '../../compiler/nullable-frontend.mjs';
import {verifyNullableFacts} from '../../compiler/nullable-facts.mjs';
import {buildNullableHir,verifyNullableHir} from '../../compiler/nullable-hir.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerHir} from '../../compiler/hir.mjs';
const dir=new URL('./testdata/nullable-groups-v5/',import.meta.url);
const raw=name=>readFileSync(new URL(name,dir)),data=name=>JSON.parse(raw(name).toString());
const expected=data('expected.json'),fresh=value=>JSON.parse(JSON.stringify(value));
const sha=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {string} */
function jcs(value){return value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(jcs).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+jcs(value[k])).join(',')+'}';}
function rejects(action,category=undefined){assert.throws(action,caught=>{
 assert.ok(caught instanceof TypeError);
 const error=/** @type {TypeError & {code:string,ruleId:string}} */(caught);
 assert.equal(error.ruleId,'r01-input-boundary');assert.match(error.code,/^r03-nullable-/);
 if(category)assert.equal(error.code,'r03-nullable-'+category);return true;
});}
function groups(value,rows=[]){if(!value||typeof value!=='object')return rows;if(value.kind==='group')rows.push(value);for(const v of Object.values(value))if(v&&typeof v==='object')groups(v,rows);return rows;}
function packetAttack(change){const request=data('request.json'),packet=data('package.json');change(packet,request);
 const requestText=jcs(request),input={...request.input,files:request.input.files.map(({path,content})=>({path,content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)))};
 packet.payload.inputIdentity=sha(jcs(input));packet.payload.files=input.files.map(f=>({path:f.path,digest:sha(f.content),byteLength:Buffer.byteLength(f.content),length:f.content.length,positionUnit:'utf16'}));
 packet.requestId=sha('tsfg.nullable-facts.request.v5\0'+requestText);
 packet.packageId=sha('tsfg.nullable-facts.package.v5\0'+expected.context.sourceSchemaHash+'\0'+jcs(packet.payload));
 const responseText=jcs(packet),origin={...expected.context.expectedOrigin,requestSha256:sha(requestText),responseSha256:sha(responseText),testedInputSetHash:sha(jcs({rootFile:request.input.rootFile,files:request.input.files}))};
 return ()=>importNullableCapturedResponse(Buffer.from(requestText),Buffer.from(responseText),origin,{...expected.context,expectedPackageId:packet.packageId,expectedOrigin:origin});
}

test('nullable groups rehashed captured DTOs retain strict source type operand range and flow checks',async t=>{
 /** @type {[string,(packet:any,request?:any)=>void][]} */
 const vectors=[
  ['group kind',p=>{p.payload.facts.functions[0].body[0].expression.kind='reference';}],
  ['missing operand',p=>{delete p.payload.facts.functions[0].body[0].expression.operand;}],
  ['foreign operand',p=>{p.payload.facts.functions[0].body[0].expression.operand=p.payload.facts.functions[1].body[0].expression;}],
  ['wrong type',p=>{p.payload.facts.functions[0].body[0].expression.type='u32';}],
  ['wrong mask',p=>{p.payload.facts.functions[0].body[0].expression.presenceFlow.null=false;}],
  ['missing required return flow',p=>{delete p.payload.facts.functions[0].body[0].expression.presenceFlow;}],
  ['extra flow key',p=>{p.payload.facts.functions[0].body[0].expression.presenceFlow.proof=true;}],
  ['invented optional flow',p=>{p.payload.facts.functions[2].body[0].expression.operand.left.presenceFlow={undefined:false,null:false};}],
  ['scalar group unwanted matching flow',p=>{p.payload.facts.functions[1].body[0].expression.presenceFlow={undefined:false,null:false};}],
  ['nested nullable group unwanted matching flow',p=>{p.payload.facts.functions[0].body[0].expression.operand.presenceFlow={undefined:true,null:true};}],
  ['source open spelling',(p,r)=>{const f=r.input.files.find(f=>f.path===r.input.rootFile);f.content=f.content.slice(0,93)+'['+f.content.slice(94);}],
  ['source close spelling',(p,r)=>{const f=r.input.files.find(f=>f.path===r.input.rootFile);f.content=f.content.slice(0,101)+']'+f.content.slice(102);}],
 ];
 for(const [name,change] of vectors)await t.test(name,()=>rejects(packetAttack(change)));
 for(let i=0;i<12;i++)for(const variant of ['open','close','operand','extra'])await t.test(`group${i} ${variant}`,()=>rejects(packetAttack(p=>{
  const g=groups(p.payload.facts.functions)[i];
  if(variant==='open')g.range.start++;if(variant==='close')g.range.end--;
  if(variant==='operand')g.operand.range.start=g.range.start;if(variant==='extra')g.proof=true;
 })));
});

test('nullable groups importer refuses repaired envelopes identities and explicit old version substitution',async t=>{
 for(const key of ['version','schemaHash','family','requestId','packageId'])await t.test(key,()=>{
  const packet=data('package.json');packet[key]=key==='version'?4:'sha256:'+'0'.repeat(64);
  const bytes=Buffer.from(jcs(packet)),origin={...expected.context.expectedOrigin,responseSha256:sha(bytes)};
  rejects(()=>importNullableCapturedResponse(raw('request.json'),bytes,origin,{...expected.context,expectedOrigin:origin,expectedPackageId:packet.packageId}));
 });
 const origin={...expected.context.expectedOrigin,testedInputSetHash:'sha256:'+'0'.repeat(64)};
 rejects(()=>importNullableCapturedResponse(raw('request.json'),raw('package.json'),origin,{...expected.context,expectedOrigin:origin}),'identity');
 for(const key of ['sourceVersion','sourceSchemaHash','expectedPackageId','expectedOrigin']){
  const context=fresh(expected.context);delete context[key];rejects(()=>importNullableCapturedResponse(raw('request.json'),raw('package.json'),fresh(expected.context.expectedOrigin),context),'schema');
 }
 for(const version of [3,4,6]){const c={...expected.context,sourceVersion:version};rejects(()=>importNullableCapturedResponse(raw('request.json'),raw('package.json'),fresh(expected.context.expectedOrigin),c),'context');}
 const unknown=fresh(expected.context);unknown.extra=true;rejects(()=>buildNullableHir(fresh(expected.snapshot),unknown),'schema');
 for(const version of [3,4])rejects(()=>verifyNullableFacts({path:expected.snapshot.source.path,content:expected.snapshot.source.content},data('package.json').payload.facts,expected.snapshot.exports,version),'schema');
});

test('nullable groups every public cold HIR seam rejects copied group DTO tampering',async t=>{
 for(let i=0;i<12;i++)for(const variant of ['type','range','operand','extra'])await t.test(`HIR group${i} ${variant}`,()=>{
  const value=fresh(expected.hir),g=groups(value.functions)[i];
  if(variant==='type')g.type='sha256:'+'0'.repeat(64);
  if(variant==='range')g.range.start++;if(variant==='operand')g.operand=expected.hir.functions[1].body[0].value;
  if(variant==='extra')g.presenceFlow={null:false,undefined:false};
  for(const action of [()=>verifyHir(value,fresh(expected.context)),()=>printHir(value,fresh(expected.context)),()=>readHir(Buffer.from(jcs(value)+'\n'),fresh(expected.context)),()=>lowerHir(value,fresh(expected.context))])rejects(action);
 });
});

test('nullable groups snapshots must match exact original capture and source identities',()=>{
 for(const mutate of [s=>{s.source.hash='sha256:'+'0'.repeat(64);},s=>{s.functions[0].body[0].expression.operand.range.start++;},s=>{s.format.version=4;},s=>{s.capture.response+=' ';},s=>{s.sourceOrigin.producerDirty=false;}]){
  const snapshot=fresh(expected.snapshot);mutate(snapshot);
  rejects(()=>nullableSnapshotFacts(snapshot,fresh(expected.context)));
  rejects(()=>verifyNullableSnapshot(snapshot,fresh(expected.context)));
  assert.equal(matchesNullableSnapshot(snapshot,fresh(expected.context)),false);
  const result=buildHir(snapshot,fresh(expected.context));assert.equal(result.status,'error');assert.ok(!Object.hasOwn(result,'hir'));
 }
 const hir=fresh(expected.hir);hir.functions[0].id='sha256:'+'0'.repeat(64);rejects(()=>verifyNullableHir(hir,fresh(expected.context)),'identity');
 for(const action of [()=>buildNullableHir(fresh(expected.snapshot)),()=>verifyNullableHir(fresh(expected.hir)),()=>verifyHir(fresh(expected.hir)),()=>lowerHir(fresh(expected.hir))])rejects(action,'schema');
});

test('nullable groups safe contexts bytes graphs canonical form and frozen ownership',()=>{
 let reads=0;const context={...expected.context};Object.defineProperty(context,'expectedPackageId',{get(){reads++;throw Error('getter');}});
 rejects(()=>buildNullableHir(fresh(expected.snapshot),context),'schema');assert.equal(reads,0);
 const proxy=new Proxy({}, {ownKeys(){reads++;throw Error('proxy');}});rejects(()=>verifyNullableHir(proxy,fresh(expected.context)),'schema');assert.equal(reads,0);
 const cycle=fresh(expected.hir);cycle.self=cycle;rejects(()=>verifyNullableHir(cycle,fresh(expected.context)));
 for(const bytes of [Buffer.from(jcs(expected.hir)),Buffer.from(jcs(expected.hir)+'\n\n'),Buffer.from(' '+jcs(expected.hir)+'\n'),Buffer.from([0xff]),new Proxy(Buffer.from('{}'),{})])rejects(()=>readHir(bytes,fresh(expected.context)));
 const hir=verifyHir(fresh(expected.hir),fresh(expected.context));assert.ok(Object.isFrozen(hir));assert.ok(Object.isFrozen(hir.functions[0].body[0].value.operand));
 const supplied=fresh(expected.hir),owned=verifyNullableHir(supplied,fresh(expected.context));supplied.functions[0].body[0].value.operand.range.start++;
 assert.deepEqual(owned,expected.hir);assert.notDeepEqual(supplied,owned);
 for(const action of [()=>verifyHir(fresh(expected.hir),fresh(expected.context),{}),()=>readHir(Buffer.from(jcs(expected.hir)+'\n'),fresh(expected.context),{}),()=>lowerHir(fresh(expected.hir),fresh(expected.context),{})])rejects(action,'context');
});

test('nullable groups Core CFG keeps one left SSA value and nests RHS only in absence successors',()=>{
 const core=lowerHir(fresh(expected.hir),fresh(expected.context));
 const chunks=core.split('  func.func @').slice(1),byName=new Map(chunks.map(c=>[c.slice(1,c.indexOf('"',1)),c]));
 assert.deepEqual([...byName.keys()],expected.corePlan.functionNames);
 for(const name of ['nullable','fallback'])assert.equal((byName.get(name).match(/"func.return"/g)||[]).length,1);
 const choose=byName.get('choose');const parts=choose.split(/\n  \^bb(\d+)(?:\([^\n]*\))?:\n/),blocks=new Map([['0',parts[0]]]);
 for(let i=1;i<parts.length;i+=2)blocks.set(parts[i],parts[i+1]);
 const branch=blocks.get('0').match(/cf\.cond_br (%v\d+), \^bb(\d+), \^bb(\d+)/);
 const [condition,present,absent]=branch.slice(1);assert.ok(blocks.get('0').includes(condition+' = "tsfg_nullable.tag_test"(%v0)'));
 assert.match(blocks.get(present),/"tsfg_nullable\.get"\(%v0\)/);assert.ok(!blocks.get(present).includes('"func.call"'));
 assert.ok(!blocks.get('0').includes('"func.call"'));assert.ok(!blocks.get(absent).includes('"func.call"'));
 const nested=blocks.get(absent).match(/cf\.cond_br %v\d+, \^bb(\d+), \^bb(\d+)/);assert.ok(nested);
 assert.match(blocks.get(nested[1]),/"tsfg_nullable\.get"\(%v1\)/);
 assert.ok(!blocks.get(nested[2]).includes('"func.call"'));
 const join=blocks.get(nested[1]).match(/cf\.br \^bb(\d+)/)[1];assert.equal(blocks.get(nested[2]).match(/cf\.br \^bb(\d+)/)[1],join);
 assert.match(blocks.get(join),/callee = @"fallback"/);assert.equal((choose.match(/callee = @"fallback"/g)||[]).length,1);
 assert.equal((choose.match(/"tsfg_nullable\.tag_test"\(%v0\)/g)||[]).length,1);
 assert.equal((choose.match(/"tsfg_nullable\.tag_test"\(%v1\)/g)||[]).length,1);
 const entry=byName.get('entry');assert.deepEqual([...entry.matchAll(/callee = @"([^"]+)"/g)].map(m=>m[1]),['nullable','onlyNull','choose']);
 assert.deepEqual([...entry.matchAll(/-> !tsfg_nullable\.i32<(\d)>/g)].map(m=>Number(m[1])),[3,3,1,2]);
});

test('nullable groups source-owned anchors and existing guard grammar stay bounded',()=>{
 const action=packetAttack(p=>{p.payload.facts.functions[0].body[0].expression.range.start++;});
 assert.throws(action,caught=>{const e=/** @type {any} */(caught);assert.equal(e.code,'r03-nullable-range');assert.deepEqual(e.primary,{sourceId:'/src/main.ts',start:0,end:105});return true;});
 const hir=fresh(expected.hir);hir.functions[0].body[0].value.range.start++;
 assert.throws(()=>verifyHir(hir,fresh(expected.context)),caught=>{const e=/** @type {any} */(caught);assert.equal(e.code,'r03-nullable-range');assert.deepEqual(e.primary,{sourceId:'/src/main.ts',start:93,end:102});return true;});
 const old=JSON.parse(readFileSync(new URL('./nullable-presence-hir-first.json',import.meta.url),'utf8')).cases[2].expectedSnapshot;
 const source={path:old.source.path,content:old.source.content},facts={status:'ok',inputs:old.inputs.map(f=>f.path),functions:old.functions,symbols:old.symbols};
 // Structural helper control only: this is the original Source4 capture, never relabeled as a Source5 package.
 assert.doesNotThrow(()=>verifyNullableFacts(source,fresh(facts),fresh(old.exports),5));
 const changed=fresh(facts),left=changed.functions[0].body[0].condition.left;
 changed.functions[0].body[0].condition.left={kind:'group',type:'i32',operand:left,range:left.range};
 rejects(()=>verifyNullableFacts(source,changed,fresh(old.exports),5));
 const context=fresh(expected.context);delete context.expectedOrigin;
 rejects(()=>readHir(Buffer.from('invalid JSON'),context),'schema');
});
