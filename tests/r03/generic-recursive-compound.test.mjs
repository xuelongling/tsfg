// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedGenericCore } from './generic-core-package-capture.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';
import { readHir, printHir, verifyHir, lowerHir, lowerFormalHir, lowerOwnedHir } from '../../compiler/hir.mjs';
import { canonical } from '../../compiler/identity.mjs';
import { verifyProducedPacket } from '../../compiler/producer-packet.mjs';
import { expectedStringPacket, stringCases } from './formal-string-gold.mjs';

const fixture=name=>readFile(new URL('./fixtures/'+name,import.meta.url));

test('registered R04 pairing rejects a different checked generic input',async()=>{
 const generic=readGenericHir(await fixture('generic-recursive-conditional-hir-v7.json'));
 const { hir }=stringCases()[0];
 const packet=expectedStringPacket(hir);
 assert.doesNotThrow(()=>verifyProducedPacket(packet));
 assert.doesNotThrow(()=>verifyProducedPacket(packet,hir.inputIdentity));
 assert.doesNotThrow(()=>verifyProducedPacket(packet,hir.inputIdentity,hir.functions[0].id));
 assert.throws(()=>verifyProducedPacket(packet,hir.inputIdentity,generic.closure.roots[0]),/r04-producer-default-root/);
 assert.throws(()=>verifyProducedPacket(packet,generic.inputIdentity),/r04-producer-input-identity/);
 const wrongTarget=expectedStringPacket({...hir,target:{...hir.target,triple:'aarch64-pc-windows-msvc'}});
 assert.throws(()=>verifyProducedPacket(wrongTarget,hir.inputIdentity),/r04-producer-input-identity/);
});
for(const family of ['conditional','mapped']) test('official cold '+family+' chain/self/mutual closure preserves complete bool/f64 HIR and Core',async()=>{
 const [bytes,recordBytes,oracleBytes]=await Promise.all(['package','record','oracle'].map(kind=>fixture(`generic-recursive-${family}-${kind}-v7.json`)));
 const record=JSON.parse(recordBytes.toString('utf8')),oracle=JSON.parse(oracleBytes.toString('utf8'));
 // Decode occurs before any version/fixture comparison, so the original RED is
 // the actual compound-call relation refusal, rather than a schema-only check.
 const pkg=decodeGenericPackage(bytes);
 assert.deepEqual(pkg,oracle.package);
 assert.deepEqual(Buffer.from(encodeGenericPackage(pkg)),bytes);
 const facts=validateGenericInstanceResult(bytes,record.result,record.requests);
 assert.deepEqual(facts,oracle.result);assert.deepEqual(record.requests,oracle.requests);
 assert.equal(facts.instances.length,12);assert.equal(facts.roots[0],facts.roots[6]);
 const hir=buildGenericHir(bytes,record.result,record.requests);
 assert.deepEqual(hir,oracle.hir);
 assert.deepEqual(verifyGenericHir(hir),oracle.hir);
 const cold=readGenericHir(Buffer.from(printGenericHir(hir)));
 assert.deepEqual(cold,oracle.hir);
 assert.deepEqual(printGenericHir(cold),await fixture(`generic-recursive-${family}-hir-v7.json`).then(b=>b.toString('utf8')));
 const original=(await fixture(`generic-recursive-${family}-core-v7.mlir`)).toString('utf8');
 assert.equal(original,oracle.core);
 assert.equal(lowerGenericHir(cold),expectedGenericCore(original,cold.closure.roots[0]));
 assert.equal(cold.functions.length,12);assert.equal(new Set(cold.functions.map(f=>f.id)).size,12);
 assert.equal((oracle.core.match(/"func.call"/g)??[]).length,10);
 assert.equal((oracle.core.match(/"tsfg_core.fuel"/g)??[]).length,12);
});

for(const family of ['conditional','mapped']) test('owned HIR cold entry reproduces static Core for recursive '+family,async()=>{
 const bytes=await fixture(`generic-recursive-${family}-hir-v7.json`);
 const core=await fixture(`generic-recursive-${family}-core-v7.mlir`);
 const hir=readHir(bytes);
 const callerOwned=structuredClone(hir),verified=verifyHir(callerOwned);
 assert.deepEqual(verified,hir);
 assert.notEqual(verified,callerOwned);
 assert.ok(Object.isFrozen(verified.functions[0]));
 assert.equal(printHir(hir),bytes.toString('utf8'));
 const expected=expectedGenericCore(core.toString('utf8'),hir.closure.roots[0]);
 assert.equal(lowerOwnedHir(hir),expected);
 assert.equal(lowerFormalHir(hir),expected);
 assert.equal(lowerHir(hir),expected);
 const publication={};
 const wrongContext={code:'r03-d-call-effects',ruleId:'r01-call-contract',phase:'hir',
  message:'r03-d-call-effects: invalid module call publication context'};
 assert.throws(()=>readHir(bytes,undefined,publication),wrongContext);
 assert.throws(()=>verifyHir(hir,undefined,publication),wrongContext);
 assert.throws(()=>printHir(hir,undefined,publication),wrongContext);
 assert.throws(()=>lowerOwnedHir(hir,undefined,publication),wrongContext);
 assert.throws(()=>lowerFormalHir(hir,undefined,publication),wrongContext);
 assert.throws(()=>readHir(Buffer.concat([bytes,Buffer.from('\n')])),/generic-hir-canonical/);
 const predecessor=structuredClone(hir);
 predecessor.format.version=6;
 assert.throws(()=>verifyHir(predecessor),/generic-hir-identity/);
 assert.throws(()=>readHir(Buffer.from(canonical(predecessor)+'\n')),/generic-hir-identity/);
 const foreign=structuredClone(hir);
 foreign.functions[0].id='sha256:'+'0'.repeat(64);
 assert.throws(()=>verifyHir(foreign),/generic-hir-identity/);
 assert.throws(()=>lowerOwnedHir(foreign),/generic-hir-identity/);
});

for(const family of ['conditional','mapped']) test('owned HIR cold entry reads the native byte range for recursive '+family,async t=>{
 const bytes=await fixture(`generic-recursive-${family}-hir-v7.json`);
 const core=await fixture(`generic-recursive-${family}-core-v7.mlir`);
 for(const key of ['byteLength',Symbol.iterator]) await t.test(String(key),()=>{
  const backing=Buffer.alloc(bytes.length+4,0xff);
  const view=backing.subarray(2,2+bytes.length);
  view.set(bytes);
  Object.defineProperty(view,key,{get(){assert.fail('caller byte property was read');}});
  const hir=readHir(view);
  assert.equal(printHir(hir),bytes.toString('utf8'));
  assert.equal(lowerOwnedHir(hir),expectedGenericCore(core.toString('utf8'),hir.closure.roots[0]));
 });
});

for(const family of ['conditional','mapped']) test('recursive '+family+' facts reject broken cyclic edges, identities and budgets before HIR',async()=>{
 const bytes=await fixture(`generic-recursive-${family}-package-v7.json`);
 const original=JSON.parse((await fixture(`generic-recursive-${family}-record-v7.json`)).toString('utf8'));
 const clone=()=>structuredClone(original);
 const reject=(record,code)=>assert.throws(()=>buildGenericHir(bytes,record.result,record.requests),e=>e instanceof Error && Reflect.get(e,'code')===code);
 /** @type {Array<[string,(record: typeof original)=>void]>} */
 const changes=[
  ['generic-instance-reference',r=>{r.result.instances.find(i=>i.body.kind==='call').body.callee='f'.repeat(64);}],
  ['generic-instance-reference',r=>{const self=r.result.instances.find(i=>i.body.callee===i.key);self.body.callee=r.result.instances.find(i=>i.key!==self.key).key;}],
  ['generic-instance-reference',r=>{const self=r.result.instances.find(i=>i.body.callee===i.key);self.body.arguments[0].parameter=1;}],
  ['generic-instance-type',r=>{const self=r.result.instances.find(i=>i.body.callee===i.key);self.body.type=self.body.type==='bool'?'f64':'bool';}],
  ['generic-instance-identity',r=>{r.result.instances[0].typeArguments[0].kind=r.result.instances[0].typeArguments[0].kind==='boolean'?'number':'boolean';}],
  ['generic-instance-reference',r=>{r.result.instances=r.result.instances.filter(i=>i.body.kind!=='parameter');}],
  ['generic-instance-limit',r=>{r.result.instances=Array(513).fill(r.result.instances[0]);}],
  ['generic-instance-limit',r=>{r.requests=Array(257).fill(r.requests[0]);r.result.roots=Array(257).fill(r.result.roots[0]);}],
  ['generic-instance-identity',r=>{r.result.semanticProfile='tsfg-owned-scalar-generics-host-v6';}],
  ['generic-instance-schema',r=>{r.result.unknown=true;}],
 ];
 for(const [code,mutate] of changes){const r=clone();mutate(r);reject(r,code);}
 const hir=buildGenericHir(bytes,original.result,original.requests);
 const missing=structuredClone(hir);missing.functions.pop();assert.throws(()=>verifyGenericHir(missing));
 const wrong=structuredClone(hir);wrong.functions.find(f=>f.body[0].value.kind==='call').body[0].value.signatureHash='sha256:'+'0'.repeat(64);assert.throws(()=>verifyGenericHir(wrong));
 assert.deepEqual(JSON.parse((await fixture(`generic-recursive-${family}-record-v7.json`)).toString('utf8')),original);
});

test('private7 descriptor and every original private6 package retain an exact version boundary',async()=>{
 const descriptor=await fixture('generic-descriptor-v7.json');
 const expected='2e9d1e07016b6f8ce5f48bf8a3508491eaf1ce7e6fd43bf497c133f65c8dff94';
 assert.equal(createHash('sha256').update(descriptor).digest('hex'),expected);
 for(const family of ['mapped-call','conditional-call','mapped-signature','conditional-signature','number-add']){
  const bytes=await fixture(`generic-${family}-package-v6.json`);
  assert.throws(()=>decodeGenericPackage(bytes),e=>e instanceof Error && Reflect.get(e,'code')==='generic-package-schema');
 }
});
