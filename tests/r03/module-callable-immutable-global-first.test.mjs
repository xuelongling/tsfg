// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerHir,analyzeModuleCalls,
  verifyModuleCalls,printModuleCalls,readModuleCalls,verifyKernelParallelGroup} from '../../compiler/hir.mjs';

// Expected semantics are independently frozen from the complete original input.
// Actual Source bytes are supplied later by Root, never used to generate gold.
// This test performs only in-process protocol/analysis calls, no Source/Core/VM child.
// Independent preimage hashing deliberately does not import production serializers.
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '['+value.map(jcs).join(',')+']';
  if (value!==null&&typeof value==='object') return '{'+Object.keys(value).sort()
    .map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}';
  return JSON.stringify(value)??assert.fail('non-JSON oracle');
}
/** @param {string|Uint8Array} value */
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
/** @param {any} value */
const bytes=value=>Buffer.from(jcs(value)+'\n');
/** @param {any} value */
const clone=value=>structuredClone(value);
/** @param {any} value */
function frozen(value) {
  if(value===null||typeof value!=='object')return;
  assert.ok(Object.isFrozen(value));Object.values(value).forEach(frozen);
}
async function expected() {
  const raw=await readFile(new URL('./module-callable-immutable-global-first.json',import.meta.url));
  const value=JSON.parse(raw.toString('utf8'));
  assert.deepEqual(raw,bytes(value));
  // Root binds real custody before the first Product execution. A recipe alone is
  // complete independent protocol data, not a claim of actual producer qualification.
  assert.equal(value.status,'FINAL_INDEPENDENT_WHOLE_BOUND_BEFORE_PRODUCT_EXECUTION');
  return {raw,value};
}

 test('independent immutable global FIRST keeps complete original wire and fixed identities',async()=>{
  const {value:o}=await expected(),input=o.request.input,payload=o.packet.payload;
  assert.equal(o.request.version,2);assert.equal(o.packet.version,2);
  assert.equal(o.request.schemaHash,'sha256:8d66ba7464ea05c317fc413cf61dbc906c34c1ef38f4c7fcc916038e7dbe388e');
  assert.equal(o.packet.schemaHash,o.request.schemaHash);
  assert.equal(payload.inputIdentity,hash('tsfg.module-callable-facts.input.v2\0'+jcs(input)));
  assert.equal(o.packet.requestId,hash('tsfg.module-callable-facts.request.v2\0'+jcs(o.request)));
  const {packageId,...body}=o.packet;
  assert.equal(packageId,hash('tsfg.module-callable-facts.package.v2\0'+jcs(body)));
  assert.equal(o.sourceOrigin.requestSha256,hash(bytes(o.request)));
  assert.equal(o.sourceOrigin.responseSha256,hash(bytes(o.packet)));
  assert.deepEqual(payload.files,input.files.map(f=>({path:f.path,digest:hash(f.content),
    byteLength:Buffer.byteLength(f.content),length:f.content.length,positionUnit:'utf16'})));
  input.files.forEach(f=>assert.equal('sha256:'+f.sha256,hash(f.content)));
  assert.equal(input.files[0].content.length,254);assert.equal(Buffer.byteLength(input.files[0].content),256);
  assert.equal(Buffer.byteLength(input.files[1].content),1214);
  const symbols=payload.facts.symbols;
  assert.deepEqual(symbols.map(s=>s.id),['s1','s2','s3','s4','s5','s6','s7','s8']);
  assert.deepEqual(symbols.filter(s=>s.kind==='global').map(s=>[s.id,s.name,s.type,s.writable]),
    [['s1','shared','bool',true],['s3','op','function',false]]);
  const module=payload.facts.modules[0],alias=module.initialization[1];
  assert.equal(alias.symbol.id,'s3');assert.equal(alias.initializer.target,'s2');
  assert.equal(alias.initializer.kind,'functionReference');
  const rawCall=payload.facts.functions.find(f=>f.name==='entry').body[0].expression;
  assert.equal(rawCall.kind,'indirectCall');assert.equal(rawCall.name,'op');
  assert.equal(rawCall.callee.symbol,'s3');assert.deepEqual(rawCall.range,{start:172,end:182});
  assert.equal(o.hir.globals.length,1);assert.equal(o.hir.globals[0].name,'shared');
  const leaf=o.hir.functions.find(f=>f.name==='leaf'),entry=o.hir.functions.find(f=>f.name==='entry');
  const call=entry.body[0].value;
  assert.equal(call.kind,'call');assert.equal(call.name,'op');assert.equal(call.target,leaf.id);
  assert.deepEqual(call.range,rawCall.range);assert.equal(Object.hasOwn(call,'callee'),false);
  assert.deepEqual(o.hir.modules[0].bindings.map(b=>b.name),['entry','leaf','op','peer','shared']);
  assert.equal(o.hir.modules[0].bindings.find(b=>b.name==='op').target,leaf.id);
  assert.equal(o.hir.functions.find(f=>f.kind==='module-initialization').body.length,1);
  const shared=o.hir.globals[0].id;
  for(const row of o.context.contracts)assert.deepEqual(row.upper,{reads:[shared],writes:[],unknown:false});
  for(const row of o.context.contracts){const {digest,...record}=row;
    assert.equal(digest,hash('tsfg.module-published-call-contract.v1\0'+jcs(record)));}
  assert.equal(o.context.scopeDigest,hash('tsfg.module-call-scope.v1\0'+jcs(o.scope)));
  assert.equal(o.context.expectedDigest,hash('tsfg.module-call-publication.v1\0'
    +jcs({scopeDigest:o.context.scopeDigest,contracts:o.context.contracts})));
  assert.equal(o.analysis.hirDigest,hash(bytes(o.hir)));
  assert.deepEqual(o.analysis.unknownChains,[]);
  assert.deepEqual(o.proofs[0].proof.pairs[0].readRead,[shared]);
  for(const key of ['writeWrite','writeRead','readWrite'])assert.deepEqual(o.proofs[0].proof.pairs[0][key],[]);
});

 test('fresh actual immutable global FIRST roundtrips full cold HIR publication and RR proof',async()=>{
  const {raw,value:o}=await expected();
  const actualRaw=await readFile(new URL('./module-callable-immutable-global-source-actual.json',import.meta.url));
  const actual=JSON.parse(actualRaw.toString('utf8'));
  // Root's real captured streams must equal the already frozen whole packet.
  assert.equal(actual.requestBytes,bytes(o.request).toString('utf8'));
  assert.equal(actual.packetBytes,bytes(o.packet).toString('utf8'));
  assert.deepEqual(actual.sourceOrigin,o.sourceOrigin);
  assert.equal(hash(Buffer.from(actual.packetBytes)),o.sourceOrigin.responseSha256);
  const snapshotBefore=jcs(o.snapshot),hirBefore=jcs(o.hir),contextBefore=jcs(o.context);
  const imported=await importCapturedFrontendResponse(Buffer.from(actual.requestBytes),
    Buffer.from(actual.packetBytes),clone(actual.sourceOrigin));
  assert.equal(imported.status,'ok',jcs(imported));assert.deepEqual(imported.snapshot,o.snapshot);frozen(imported.snapshot);
  assert.deepEqual(validateFrontendSnapshot(clone(o.snapshot)),o.snapshot);
  const built=buildHir(imported.snapshot);assert.equal(built.status,'ok',jcs(built));
  assert.deepEqual(built.hir,o.hir);frozen(built.hir);
  assert.deepEqual(verifyHir(clone(o.hir)),o.hir);
  assert.equal(printHir(clone(o.hir)),bytes(o.hir).toString('utf8'));
  const cold=readHir(bytes(o.hir));assert.deepEqual(cold,o.hir);frozen(cold);
  const report=analyzeModuleCalls(cold,clone(o.context));assert.deepEqual(report,o.analysis);frozen(report);
  assert.deepEqual(verifyModuleCalls(clone(o.analysis),cold,clone(o.context)),o.analysis);
  assert.equal(printModuleCalls(clone(o.analysis),cold,clone(o.context)),bytes(o.analysis).toString('utf8'));
  assert.deepEqual(readModuleCalls(bytes(o.analysis),cold,clone(o.context)),o.analysis);
  const proof=verifyKernelParallelGroup(cold,clone(o.context),{targets:clone(o.proofs[0].targets)});
  assert.deepEqual(proof,o.proofs[0].proof);frozen(proof);
  assert.throws(()=>lowerHir(cold),error=>{const e=/** @type {any} */(error);
    for(const[k,v]of Object.entries(o.lowerError))assert.deepEqual(e[k],v);return true;});
  assert.equal(jcs(o.snapshot),snapshotBefore);assert.equal(jcs(o.hir),hirBefore);assert.equal(jcs(o.context),contextBefore);
  assert.deepEqual(await readFile(new URL('./module-callable-immutable-global-first.json',import.meta.url)),raw);
  assert.deepEqual(await readFile(new URL('./module-callable-immutable-global-source-actual.json',import.meta.url)),actualRaw);
});

 test('fresh actual nominal i32 alias whole preserves scalar identity and empty fixed effects',async()=>{
  const {raw,value:all}=await expected(),o=all.i32;
  assert.equal(o.status,'FINAL_INDEPENDENT_WHOLE_BOUND_BEFORE_PRODUCT_EXECUTION');
  const actualRaw=await readFile(new URL('./module-callable-immutable-global-source-actual.json',import.meta.url));
  const actual=JSON.parse(actualRaw.toString('utf8')).i32;
  assert.equal(actual.requestBytes,bytes(o.request).toString('utf8'));
  assert.equal(actual.packetBytes,bytes(o.packet).toString('utf8'));
  assert.deepEqual(actual.sourceOrigin,o.sourceOrigin);
  assert.equal(o.request.version,2);assert.equal(o.packet.version,2);
  assert.equal(o.request.schemaHash,'sha256:8d66ba7464ea05c317fc413cf61dbc906c34c1ef38f4c7fcc916038e7dbe388e');
  assert.equal(o.packet.schemaHash,o.request.schemaHash);
  assert.equal(o.packet.payload.inputIdentity,hash('tsfg.module-callable-facts.input.v2\0'+jcs(o.request.input)));
  assert.equal(o.packet.requestId,hash('tsfg.module-callable-facts.request.v2\0'+jcs(o.request)));
  const {packageId,...packetBody}=o.packet;
  assert.equal(packageId,hash('tsfg.module-callable-facts.package.v2\0'+jcs(packetBody)));
  assert.equal(o.sourceOrigin.requestSha256,hash(bytes(o.request)));
  assert.equal(o.sourceOrigin.responseSha256,hash(bytes(o.packet)));
  assert.equal(o.request.input.files[0].content.length,202);
  assert.equal(Buffer.byteLength(o.request.input.files[0].content),204);
  assert.equal(Buffer.byteLength(o.request.input.files[1].content),1214);
  o.request.input.files.forEach(f=>assert.equal('sha256:'+f.sha256,hash(f.content)));
  const symbols=o.packet.payload.facts.symbols;
  assert.deepEqual(symbols.map(s=>s.id),['s1','s2','s3','s4','s5','s6','s7']);
  assert.equal(symbols[0].name,'leaf');assert.equal(symbols[1].name,'op');
  assert.equal(symbols[1].type,'function');assert.equal(symbols[1].writable,false);
  assert.equal(o.packet.payload.facts.modules[0].initialization[0].initializer.target,'s1');
  const rawCall=o.packet.payload.facts.functions.find(f=>f.name==='entry').body[0].expression;
  assert.equal(rawCall.kind,'indirectCall');assert.equal(rawCall.callee.symbol,'s2');
  const scalar='sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727';
  const type={parameters:['i32'],returns:'i32'};
  const signature=hash('tsfg.module-callable-signature.candidate.v1\0'+jcs(type));
  for(const name of ['leaf','entry','peer']){
    const fn=o.hir.functions.find(f=>f.name===name);
    assert.equal(fn.id,hash('tsfg.module-callable-function.candidate.v1\0'
      +jcs({path:'/src/app.ts',name,signatureHash:signature})));
    assert.equal(fn.signatureHash,signature);assert.equal(fn.returnType,scalar);
    assert.equal(fn.parameters[0].type,scalar);
  }
  assert.deepEqual(o.hir.globals,[]);
  assert.deepEqual(o.hir.functions.find(f=>f.kind==='module-initialization').body,[]);
  const leaf=o.hir.functions.find(f=>f.name==='leaf'),entry=o.hir.functions.find(f=>f.name==='entry');
  assert.equal(entry.body[0].value.target,leaf.id);assert.equal(entry.body[0].value.name,'op');
  assert.deepEqual(entry.body[0].value.range,rawCall.range);
  assert.equal(o.hir.modules[0].bindings.find(b=>b.name==='op').target,leaf.id);
  for(const row of o.context.contracts){assert.deepEqual(row.upper,{reads:[],writes:[],unknown:false});
    const {digest,...body}=row;assert.equal(digest,hash('tsfg.module-published-call-contract.v1\0'+jcs(body)));}
  assert.equal(o.context.scopeDigest,hash('tsfg.module-call-scope.v1\0'+jcs(o.scope)));
  assert.equal(o.context.expectedDigest,hash('tsfg.module-call-publication.v1\0'
    +jcs({scopeDigest:o.context.scopeDigest,contracts:o.context.contracts})));
  const snapshotBefore=jcs(o.snapshot),hirBefore=jcs(o.hir),contextBefore=jcs(o.context);
  const imported=await importCapturedFrontendResponse(Buffer.from(actual.requestBytes),
    Buffer.from(actual.packetBytes),clone(actual.sourceOrigin));
  assert.deepEqual(imported,{status:'ok',snapshot:o.snapshot});frozen(imported);
  assert.deepEqual(validateFrontendSnapshot(clone(o.snapshot)),o.snapshot);
  const built=buildHir(imported.snapshot);assert.deepEqual(built,{status:'ok',hir:o.hir});frozen(built.hir);
  assert.deepEqual(verifyHir(clone(o.hir)),o.hir);
  assert.equal(printHir(clone(o.hir)),bytes(o.hir).toString('utf8'));
  const cold=readHir(bytes(o.hir));assert.deepEqual(cold,o.hir);frozen(cold);
  const report=analyzeModuleCalls(cold,clone(o.context));assert.deepEqual(report,o.analysis);frozen(report);
  assert.deepEqual(verifyModuleCalls(clone(o.analysis),cold,clone(o.context)),o.analysis);
  assert.equal(printModuleCalls(clone(o.analysis),cold,clone(o.context)),bytes(o.analysis).toString('utf8'));
  assert.deepEqual(readModuleCalls(bytes(o.analysis),cold,clone(o.context)),o.analysis);
  const proof=verifyKernelParallelGroup(cold,clone(o.context),{targets:clone(o.proofs[0].targets)});
  assert.deepEqual(proof,o.proofs[0].proof);frozen(proof);
  for(const key of ['readRead','writeWrite','writeRead','readWrite'])assert.deepEqual(proof.pairs[0][key],[]);
  assert.throws(()=>lowerHir(cold),error=>{const e=/** @type {any} */(error);
    for(const[k,v]of Object.entries(o.lowerError))assert.deepEqual(e[k],v);return true;});
  assert.equal(jcs(o.snapshot),snapshotBefore);assert.equal(jcs(o.hir),hirBefore);assert.equal(jcs(o.context),contextBefore);
  assert.deepEqual(await readFile(new URL('./module-callable-immutable-global-first.json',import.meta.url)),raw);
  assert.deepEqual(await readFile(new URL('./module-callable-immutable-global-source-actual.json',import.meta.url)),actualRaw);
});
