// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,verifyHir,printHir,readHir,analyzeModuleCalls,verifyModuleCalls,printModuleCalls,readModuleCalls,verifyKernelParallelGroup} from '../../compiler/hir.mjs';
import {cases,bytes,canonical,clone,hash,assertError,assertFrozen} from './module-callable-fixtures.mjs';
const actual=JSON.parse(await readFile(new URL('./module-callable-source-actual.json',import.meta.url),'utf8'));
assert.equal(actual.manifestSha256,'sha256:7e3d309d72de57098d14c4068b340f90c47a822d6f406e52ceadf2a78751e326');
assert.deepEqual(actual.captures.map(x=>x.name).sort(),cases.map(x=>x.name).sort());
// Expected semantics remain the preimplementation whole oracle. Only actual
// Source custody changes, requiring a new full-HIR digest and its references.
function expectedFor(frozen,origin){
 const expected=clone(frozen);expected.sourceOrigin=clone(origin);expected.snapshot.sourceOrigin=clone(origin);
 if(expected.hir){expected.hir.snapshot.sourceOrigin=clone(origin);const hirDigest=hash(bytes(expected.hir));
  for(const variant of [expected,expected.ownFixedTop].filter(Boolean)){
   if(variant.analysis)variant.analysis.hirDigest=hirDigest;
   for(const row of variant.proofs??[])if(row.proof)row.proof.hirDigest=hirDigest;
  }
 }
 return expected;
}
function checkAnalysis(fixture,variant){
 const report=analyzeModuleCalls(clone(fixture.hir),clone(variant.context));assert.deepEqual(report,variant.analysis);assertFrozen(report);
 assert.deepEqual(verifyModuleCalls(clone(variant.analysis),clone(fixture.hir),clone(variant.context)),variant.analysis);
 assert.equal(printModuleCalls(clone(variant.analysis),clone(fixture.hir),clone(variant.context)),bytes(variant.analysis).toString());
 assert.deepEqual(readModuleCalls(bytes(variant.analysis),clone(fixture.hir),clone(variant.context)),variant.analysis);
 for(const row of variant.proofs){if(row.error)assert.throws(()=>verifyKernelParallelGroup(clone(fixture.hir),clone(variant.context),{targets:row.targets}),error=>assertError(error,row.error));else{const proof=verifyKernelParallelGroup(clone(fixture.hir),clone(variant.context),{targets:row.targets});assert.deepEqual(proof,row.proof);assertFrozen(proof);}}
}
for(const frozen of cases)test('actual public Source packet to whole Product '+frozen.name,async()=>{
 const capture=actual.captures.find(x=>x.name===frozen.name),origin=actual.origins[frozen.name],packetBytes=Buffer.from(capture.bytes);
 // Actual producer bytes must match the independent frozen packet before any
 // actual packet becomes an input. They never supply expected semantics.
 assert.equal(hash(packetBytes),capture.sha256);assert.equal(origin.responseSha256,capture.sha256);
 assert.equal(capture.bytes,bytes(frozen.packet).toString());assert.deepEqual(JSON.parse(capture.bytes),frozen.packet);
 assert.equal(origin.requestSha256,hash(bytes(frozen.request)));
 const expected=expectedFor(frozen,origin),imported=await importCapturedFrontendResponse(bytes(frozen.request),packetBytes,clone(origin));
 assert.equal(imported.status,'ok',canonical(imported));assert.deepEqual(imported.snapshot,expected.snapshot);assertFrozen(imported.snapshot);
 assert.deepEqual(validateFrontendSnapshot(clone(expected.snapshot)),expected.snapshot);
 const built=buildHir(imported.snapshot);
 if(expected.buildError){assert.equal(built.status,'error');assert.equal(built.diagnostics.length,1);for(const[k,v]of Object.entries(expected.buildError))assert.deepEqual(built.diagnostics[0][k],v,k);return;}
 assert.equal(built.status,'ok',canonical(built));assert.deepEqual(built.hir,expected.hir);assertFrozen(built.hir);
 assert.deepEqual(verifyHir(clone(expected.hir)),expected.hir);assert.equal(printHir(clone(expected.hir)),bytes(expected.hir).toString());assert.deepEqual(readHir(bytes(expected.hir)),expected.hir);
 if(expected.analysisError){assert.throws(()=>analyzeModuleCalls(clone(expected.hir),clone(expected.context)),error=>assertError(error,expected.analysisError));return;}
 checkAnalysis(expected,expected);if(expected.ownFixedTop)checkAnalysis(expected,expected.ownFixedTop);
});
