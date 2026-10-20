// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
import {parseKernelCore} from './kernel-global-core-structural.mjs';
const o=JSON.parse(await readFile(new URL('./kernel-global-core-oracle.json',import.meta.url),'utf8'));
const fresh=v=>JSON.parse(JSON.stringify(v));
/** Independent published-input recipe, not a call to the JS producer. */
/** @param {any} v @returns {string} */
function jcs(v){return v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(jcs).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+jcs(v[k])).join(',')+'}';}
const hash=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
const originalPayload=JSON.stringify(jcs(o.payload));
/** @param {any} payload @param {string} [raw] */
function packet(payload,raw=jcs(payload)){
  assert.equal(o.core.split(originalPayload).length,2,'replace only exact frozen payload');
  return o.core.replace(originalPayload,JSON.stringify(raw));
}
/** @param {(p:any)=>void} mutate */
function changed(mutate){const p=fresh(o.payload);mutate(p);return packet(p);}
/** @param {any} p */
function resign(p){
  for(const r of p.context.contracts){const {digest,...body}=r;r.digest=hash('tsfg.module-published-call-contract.v1\0'+jcs(body));}
  p.context.expectedDigest=hash('tsfg.module-call-publication.v1\0'+jcs({scopeDigest:p.context.scopeDigest,contracts:p.context.contracts}));
  p.proof.publishedDigest=p.context.expectedDigest;
  for(const a of p.proof.accesses)a.publishedContractDigest=p.context.contracts.find(r=>r.functionId===a.functionId).digest;
}
/** @param {string} id @param {(body:string)=>string} mutate */
function functionBody(id,mutate){
  const start=o.core.indexOf('  func.func @"f'+id.slice(7)+'"');assert.ok(start>=0);
  const next=o.core.indexOf('  func.func @',start+1),end=next<0?o.core.length:next;
  const before=o.core.slice(start,end),after=mutate(before);assert.notEqual(after,before);
  return o.core.slice(0,start)+after+o.core.slice(end);
}
/** @param {string} input @param {RegExp} [diagnostic] */
async function refuse(input,diagnostic){const r=await invokeCore(input);rejected(r);if(diagnostic)assert.match(r.stderr.toString('utf8'),diagnostic);}
const leaf=o.payload.scope.functions.find(f=>f.name==='leaf'),entry=o.payload.scope.functions.find(f=>f.name==='entry');
const global=o.payload.scope.globals[0].globalId;
test('cold C++ retains complete private identities/payload and every independently frozen scalar CFG edge',async()=>{
  const first=await invokeCore(o.core);accepted(first);
  assert.deepEqual(parseKernelCore(first.stdout.toString('utf8')),parseKernelCore(o.core));
  const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
  const optimized=await invokeCore(o.core,'--optimize');accepted(optimized);assert.deepEqual(optimized.stdout,first.stdout);
});
test('private GlobalId proof candidate has exact wire refusal without encoding any packet',async()=>{
  for(const mode of ['--emit-bytecode','--emit-nullable-candidate']){
    const r=await invokeCore(o.core,mode);assert.equal(r.close.code,3);assert.equal(r.stdout.length,0);
    assert.equal(r.stderr.toString('utf8'),'[r04-core-kernel-unsupported] GlobalId proof candidate has no wire encoding\n');
  }
});
test('original private function/signature identities are checked before scalar projection',async()=>{
  await refuse(functionBody(leaf.functionId,s=>s.replace('tsfg_core.function_id = '+JSON.stringify(leaf.functionId),'tsfg_core.function_id = '+JSON.stringify(hash('forged')))),/core-ir-kernel-metadata.*private function identity/);
  await refuse(functionBody(leaf.functionId,s=>s.replace('tsfg_core.signature_hash = '+JSON.stringify(leaf.signatureHash),'tsfg_core.signature_hash = '+JSON.stringify(hash('forged')))),/core-ir-kernel-metadata.*private signature identity/);
  await refuse(functionBody(entry.functionId,s=>s.replace('callee = @"f'+leaf.functionId.slice(7)+'"','callee = @"f'+entry.functionId.slice(7)+'"')),/core-ir-kernel-identity/);
  await refuse(functionBody(entry.functionId,s=>s.replace('tsfg_core.function_id = '+JSON.stringify(leaf.functionId),'tsfg_core.function_id = '+JSON.stringify(entry.functionId))),/core-ir-kernel-identity/);
  await refuse(functionBody(entry.functionId,s=>s.replace('tsfg_core.signature_hash = '+JSON.stringify(leaf.signatureHash)+', tsfg_source.start','tsfg_core.signature_hash = '+JSON.stringify(hash('call-signature'))+', tsfg_source.start')),/core-ir-kernel-identity/);
});
test('actual typed SSA, CFG, Fuel and initialization remain full cold scalar obligations',async()=>{
  await refuse(functionBody(leaf.functionId,s=>s.replace('"func.return"(%v2)','"func.return"(%v99)')));
  await refuse(functionBody(leaf.functionId,s=>s.replace('cf.br ^bb3(%v0 : i1)','cf.br ^bb3')));
  await refuse(functionBody(leaf.functionId,s=>s.replace(/^    "tsfg_core.fuel".*\n/m,'')));
  await refuse(o.core.replace('initialize = true','initialize = false'));
  await refuse(o.core.replace('initializer = 0 : i64','initializer = 1 : i64'));
});
test('self-consistent wider fixed callee/caller writes conflict while actual bodies and supplied proof remain read-only',async()=>{
  const p=fresh(o.payload);
  for(const id of [leaf.functionId,entry.functionId])p.context.contracts.find(r=>r.functionId===id).upper.writes=[global];
  resign(p);
  // Keep narrow supplied accesses on purpose: an implementation that substitutes
  // Derived for fixed Published could incorrectly accept this exact packet.
  assert.deepEqual(p.proof.accesses.map(a=>a.writes),[[],[]]);
  await refuse(packet(p),/core-ir-kernel-conflict/);
});
test('hidden actual global store exceeds fixed Published even in a conditional CFG block',async()=>{
  const core=functionBody(leaf.functionId,s=>s.replace('  ^bb1:\n','  ^bb1:\n    "tsfg_core.global_store"(%v0) {global = 0 : i64, initialize = false, tsfg_source.start = 87 : i64, tsfg_source.end = 102 : i64} : (i1) -> ()\n'));
  await refuse(core,/core-ir-kernel-contract/);
});
test('self-consistent unknown callee/caller bounds never confer kernel permission',async()=>{
  const p=fresh(o.payload);for(const id of [leaf.functionId,entry.functionId])p.context.contracts.find(r=>r.functionId===id).upper={reads:[],writes:[],unknown:true};resign(p);
  await refuse(packet(p),/core-ir-kernel-unknown/);
});
test('capability31 is a real Host effect rather than purity, including calls in a nonentry CFG block',async()=>{
  // Cold metamorphic Core, not a claimed Source run. The Host declaration uses
  // the ordinary accepted nominal identity recipe and the existing DTS source.
  const signature=hash('tsfg.signature\0(i32)->i32'),name='counter';
  const id=hash('tsfg.host\0/src/minimal-integers-v3.d.ts\0'+name+'\0'+signature);
  let core=functionBody(leaf.functionId,s=>s.replace('  ^bb1:\n','  ^bb1:\n    %host0 = "tsfg_core.constant"() {value = 1 : i32, tsfg_source.start = 87 : i64, tsfg_source.end = 102 : i64} : () -> i32\n    %host1 = "tsfg_core.authorized_host"(%host0) {host = 0 : i64, tsfg_source.start = 87 : i64, tsfg_source.end = 102 : i64} : (i32) -> i32\n'));
  core=core.replace('tsfg_core.hosts = []','tsfg_core.hosts = [{id = '+JSON.stringify(id)+', source = 1 : i64, name = '+JSON.stringify(name)+', capability = 31 : i64, signature = '+JSON.stringify(signature)+', start = 0 : i64, end = 1 : i64}]');
  await refuse(core,/core-ir-kernel-contract/);
  const p=fresh(o.payload);for(const fn of [leaf.functionId,entry.functionId])p.context.contracts.find(r=>r.functionId===fn).upper={reads:[],writes:[],unknown:true};resign(p);
  await refuse(core.replace(originalPayload,JSON.stringify(jcs(p))),/core-ir-kernel-unknown/);
});
test('every supplied access/pair/record assertion is independently recomputed',async()=>{
  /** @type {Array<(p:any)=>void>} */
  const edits=[p=>p.proof.accesses[0].reads=[],p=>p.proof.accesses[1].writes=[global],
    p=>p.proof.accesses[1].publishedContractDigest=hash('wrong'),p=>p.proof.pairs[0].readRead=[],
    p=>p.proof.pairs[0].writeWrite=[global],p=>p.proof.pairs=[],p=>p.proof.accesses.reverse()];
  for(const edit of edits)await refuse(changed(edit),/core-ir-kernel-proof/);
});
test('complete fixed publication, actual named roots and explicit private identity cannot be substituted',async()=>{
  await refuse(changed(p=>p.context.contracts.pop()),/core-ir-kernel-metadata/);
  await refuse(changed(p=>p.context.contracts[0].digest=hash('wrong')),/core-ir-kernel-metadata/);
  await refuse(changed(p=>p.proof.inputIdentity=hash('wrong')),/core-ir-kernel-metadata/);
  await refuse(changed(p=>p.proof.targets=[leaf.functionId,entry.functionId].sort()),/core-ir-kernel-metadata/);
  await refuse(o.core.replace('name = "entry", function = 3 : i64','name = "entry", function = 2 : i64'),/core-ir-kernel-metadata.*named root target/);
  await refuse(o.core.replace('tsfg_core.kernel_global = {','tsfg_core.reference = true, tsfg_core.kernel_global = {'),/core-ir-kernel-metadata/);
  await refuse(o.core.replace('schema = "sha256:e54b773b72d9f18816cab1a0d6f9f49ddb5167f9db85f590df0b25e9e2cbe131"','schema = '+JSON.stringify(hash('wrong'))),/core-ir-kernel-metadata/);
});
test('canonical payload/budget boundaries are finite and hirDigest is provenance only',async()=>{
  await refuse(packet(o.payload,JSON.stringify(o.payload,null,2)),/core-ir-kernel-metadata/);
  let nested=null;for(let i=0;i<130;i++)nested=[nested];
  await refuse(changed(p=>p.extra=nested),/core-ir-kernel-metadata/);
  await refuse(o.core+' '.repeat(8388609-o.core.length),/core-ir-kernel-budget/);
  const p=fresh(o.payload);p.proof.hirDigest=hash('opaque-provenance-only');
  const r=await invokeCore(packet(p));accepted(r);
  assert.equal(JSON.parse(parseKernelCore(r.stdout.toString('utf8')).attributes['tsfg_core.kernel_global'].payload).proof.hirDigest,p.proof.hirDigest);
});
