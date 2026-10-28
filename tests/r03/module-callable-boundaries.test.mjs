// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {verifyHir,readHir,analyzeModuleCalls,verifyModuleCalls,printModuleCalls,readModuleCalls,verifyKernelParallelGroup} from '../../compiler/hir.mjs';
import {sample,bytes,canonical,clone,hash,assertError,assertFrozen,base,analysis,repairContext,failure} from './module-callable-fixtures.mjs';
const fixture=sample('first-rr');
const check=(run,expected)=>assert.throws(run,e=>assertError(e,expected));
async function importRaw(requestBytes,responseBytes,origin=fixture.sourceOrigin){const fixed={...clone(origin),requestSha256:hash(requestBytes),responseSha256:hash(responseBytes)};return importCapturedFrontendResponse(requestBytes,responseBytes,fixed);}
function diagnostic(actual,expected){assert.equal(actual.status,'error');assert.equal(actual.diagnostics.length,1);for(const[k,v]of Object.entries(expected))assert.deepEqual(actual.diagnostics[0][k],v,k);}
function repairedPacket(mutator){const packet=clone(fixture.packet);mutator(packet);const{packageId,...body}=packet;packet.packageId=hash('tsfg.module-callable-facts.package.v2\0'+canonical(body));return packet;}
test('strict entire request/package canonical transport rejects BOM, spaces, missing LF, trailing bytes and duplicate keys',async()=>{
 for(const bad of [Buffer.from('\ufeff'+bytes(fixture.packet)),Buffer.from(' '+bytes(fixture.packet)),Buffer.from(canonical(fixture.packet)),Buffer.from(bytes(fixture.packet)+' '),Buffer.from(bytes(fixture.packet).toString().replace('{','{"family":"duplicate",'))]){
  const actual=await importRaw(bytes(fixture.request),bad);diagnostic(actual,base('canonical','module callable candidate must use canonical JSON plus LF'));
 }
 const request=Buffer.from(' '+bytes(fixture.request));diagnostic(await importRaw(request,bytes(fixture.packet)),base('canonical','module callable candidate must use canonical JSON plus LF'));
});
test('independent source manifest, original AST annotation and complete registry are checked after repaired outer digest',async()=>{
 for(const change of [p=>{p.payload.files[0].length++;},p=>{p.payload.annotations[0].nameRange.end++;},p=>{p.payload.facts.symbols.pop();}]){
  const packet=repairedPacket(change),actual=await importRaw(bytes(fixture.request),bytes(packet));
  assert.equal(actual.status,'error');assert.match(actual.diagnostics[0].code,/^r03-module-callable-(source|identity)$/);
 }
});
test('snapshot and HIR reject stale origin, partial function universe and body tampering',()=>{
 const snapshot=clone(fixture.snapshot);snapshot.sourceOrigin.responseSha256=hash('different');check(()=>validateFrontendSnapshot(snapshot),base('identity','module callable candidate identity differs'));
 for(const change of [h=>h.functions.pop(),h=>{const f=h.functions.find(f=>f.name==='entry');f.body.pop();},h=>{h.closure.functions=[];}]){const hir=clone(fixture.hir);change(hir);check(()=>verifyHir(hir),base('reconstruct','module callable HIR differs from complete reconstruction'));}
 const text=Buffer.from(' '+bytes(fixture.hir));check(()=>readHir(text),base('canonical','module callable candidate must use canonical JSON plus LF'));
});
test('whole reports are recomputed against explicit current HIR and fixed context',()=>{
 for(const change of [r=>{r.functions[0].dependencies=[];r.functions[0].effective.unknown=true;},r=>{r.derivedTargets.calls=[];},r=>{r.initializationOrder.reverse();},r=>{r.hirDigest=hash('stale');}]){const report=clone(fixture.analysis);change(report);check(()=>verifyModuleCalls(report,clone(fixture.hir),clone(fixture.context)),analysis('-report','module call report differs from complete recomputation'));}
 const context=clone(fixture.context);context.expectedDigest=hash('wrong');check(()=>analyzeModuleCalls(clone(fixture.hir),context),analysis('-identity','fixed module call publication identity differs'));
 const other=sample('unknown-locality'),report=clone(other.analysis);check(()=>verifyModuleCalls(report,clone(other.hir),clone(other.ownFixedTop.context)),analysis('-report','module call report differs from complete recomputation'));
 check(()=>readModuleCalls(Buffer.from(' '+bytes(fixture.analysis)),clone(fixture.hir),clone(fixture.context)),analysis('-canonical','module call report must use canonical JSON plus LF'));
 check(()=>printModuleCalls(clone(fixture.analysis),clone(sample('fixed-narrow').hir),clone(sample('fixed-narrow').context)),analysis('-report','module call report differs from complete recomputation'));
});
test('fixed rows reject wrong function/signature/global domains, ordering and forged repaired scope',()=>{
 for(const change of [c=>{c.contracts[0].functionId=hash('foreign-function');},c=>{c.contracts[0].signatureHash=hash('wrong-signature');},c=>{c.scopeDigest=hash('wrong-scope');},c=>{c.contracts[0].upper.reads=[hash('lexical-p0-is-not-global')];}]){const c=clone(fixture.context);change(c);repairContext(c);check(()=>analyzeModuleCalls(clone(fixture.hir),c),analysis('-identity','fixed module call publication identity differs'));}
 const c=clone(fixture.context);c.contracts.reverse();repairContext(c);check(()=>analyzeModuleCalls(clone(fixture.hir),c),analysis('','invalid fixed module call publication'));
});
test('actual callable arguments and returned values must satisfy fixed finite domains',()=>{
 const f=sample('first-rr'),context=clone(f.context),identity=f.hir.functions.find(x=>x.name==='identity');
 context.contracts.find(x=>x.functionId===identity.id).parameters[0].allowed.functions=[];repairContext(context);
 const entry=f.hir.functions.find(x=>x.name==='entry'),argument=entry.body[0].initializer.arguments[0];
 check(()=>analyzeModuleCalls(clone(f.hir),context),{...analysis('-contract','module implementation exceeds fixed published upper bound'),functionId:identity.id,facet:'parameters',primary:{sourceId:entry.sourcePath,...argument.range}});
});
test('public outputs own and freeze the complete graphs independently',async()=>{
 const request=bytes(fixture.request),packet=bytes(fixture.packet),origin=clone(fixture.sourceOrigin),result=await importCapturedFrontendResponse(request,packet,origin);assert.equal(result.status,'ok');request.fill(0);packet.fill(0);origin.responseSha256=hash('changed');assert.deepEqual(result.snapshot,fixture.snapshot);assertFrozen(result.snapshot);
 const h=clone(fixture.hir),c=clone(fixture.context),report=analyzeModuleCalls(h,c);h.functions[0].body=[];c.contracts[0].upper.unknown=true;assert.deepEqual(report,fixture.analysis);assertFrozen(report);
 const loaded=readHir(bytes(fixture.hir));assert.notEqual(loaded.snapshot,fixture.snapshot);assertFrozen(loaded);
 const parsed=readModuleCalls(bytes(fixture.analysis),clone(fixture.hir),clone(fixture.context));assertFrozen(parsed);assert.notEqual(parsed.contracts,fixture.context.contracts);
});
test('descriptor-safe complete graph inspection never invokes getters before family/context/request dispatch',()=>{
 let reads=0;const getter={get(){reads++;throw Error('must not execute');},enumerable:true};
 const h=clone(fixture.hir);Object.defineProperty(h.snapshot.request.input,'untrusted',getter);check(()=>verifyHir(h),base('input','invalid module callable candidate'));
 const c=clone(fixture.context);Object.defineProperty(c.contracts[0].upper,'untrusted',getter);check(()=>analyzeModuleCalls(clone(fixture.hir),c),analysis('','invalid fixed module call publication'));
 const request={targets:fixture.proofs[0].targets};Object.defineProperty(request,'untrusted',getter);check(()=>verifyKernelParallelGroup(clone(fixture.hir),clone(fixture.context),request),failure('r03-d-kernel-access','invalid explicit kernel parallel group','r01-kernel','hir'));
 const proxy=new Proxy(clone(fixture.hir),{get(){reads++;throw Error('proxy must not execute');},ownKeys(){reads++;throw Error('proxy must not enumerate');}});check(()=>verifyHir(proxy),base('input','invalid module callable candidate'));
 assert.equal(reads,0);
});
test('whole graph string/depth budgets precede malformed shape and target count is bounded',()=>{
 for(const value of ['x'.repeat(1048577),Array.from({length:129}).reduce(x=>({child:x}),null)]){const h=clone(fixture.hir);h.extra=value;check(()=>verifyHir(h),base('limit','module callable candidate budget exceeded'));}
 const targets=Array.from({length:33},(_,i)=>hash('parallel-'+i)).sort();check(()=>verifyKernelParallelGroup(clone(fixture.hir),clone(fixture.context),{targets}),failure('r03-d-kernel-access-limit','kernel parallel group budget exceeded','r01-kernel','hir'));
});
