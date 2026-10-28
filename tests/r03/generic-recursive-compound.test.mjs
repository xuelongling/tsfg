// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeGenericPackage, encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { validateGenericInstanceResult } from '../../compiler/generic-instance.mjs';
import { buildGenericHir, verifyGenericHir, printGenericHir, readGenericHir, lowerGenericHir } from '../../compiler/generic-hir.mjs';

const fixture=name=>readFile(new URL('./fixtures/'+name,import.meta.url));
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
 assert.equal(lowerGenericHir(cold),oracle.core);
 assert.equal(lowerGenericHir(cold),await fixture(`generic-recursive-${family}-core-v7.mlir`).then(b=>b.toString('utf8')));
 assert.equal(cold.functions.length,12);assert.equal(new Set(cold.functions.map(f=>f.id)).size,12);
 assert.equal((oracle.core.match(/"func.call"/g)??[]).length,10);
 assert.equal((oracle.core.match(/"tsfg_core.fuel"/g)??[]).length,12);
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
