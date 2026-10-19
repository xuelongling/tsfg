// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerHir,analyzeModuleCalls,verifyModuleCalls,printModuleCalls,readModuleCalls,verifyKernelParallelGroup} from '../../compiler/hir.mjs';
import {cases,sample,bytes,canonical,clone,assertError,assertFrozen,failure} from './module-callable-fixtures.mjs';
// All expected full objects were frozen by an independent preimplementation
// source-recipe builder. These tests never record a compiler output as expected.
for(const fixture of cases){
 test('whole independent module callable '+fixture.name,async()=>{
  const imported=await importCapturedFrontendResponse(bytes(fixture.request),bytes(fixture.packet),clone(fixture.sourceOrigin));
  assert.equal(imported.status,'ok',canonical(imported));assert.deepEqual(imported.snapshot,fixture.snapshot);assertFrozen(imported.snapshot);
  assert.deepEqual(validateFrontendSnapshot(clone(fixture.snapshot)),fixture.snapshot);
  const built=buildHir(clone(fixture.snapshot));
  if(fixture.buildError){assert.equal(built.status,'error');assert.equal(built.diagnostics.length,1);for(const[k,v]of Object.entries(fixture.buildError))assert.deepEqual(built.diagnostics[0][k],v,k);return;}
  assert.equal(built.status,'ok',canonical(built));assert.deepEqual(built.hir,fixture.hir);
  assert.deepEqual(verifyHir(clone(fixture.hir)),fixture.hir);
  assert.equal(printHir(clone(fixture.hir)),bytes(fixture.hir).toString());
  assert.deepEqual(readHir(bytes(fixture.hir)),fixture.hir);
  assert.throws(()=>lowerHir(clone(fixture.hir)),e=>assertError(e,failure('r03-d-capability','module callable Core lowering is not implemented','r01-ts-baseline','lowering')));
  if(fixture.analysisError){assert.throws(()=>analyzeModuleCalls(clone(fixture.hir),clone(fixture.context)),e=>assertError(e,fixture.analysisError));return;}
  const actual=analyzeModuleCalls(clone(fixture.hir),clone(fixture.context));assert.deepEqual(actual,fixture.analysis);assertFrozen(actual);
  assert.deepEqual(verifyModuleCalls(clone(fixture.analysis),clone(fixture.hir),clone(fixture.context)),fixture.analysis);
  assert.equal(printModuleCalls(clone(fixture.analysis),clone(fixture.hir),clone(fixture.context)),bytes(fixture.analysis).toString());
  assert.deepEqual(readModuleCalls(bytes(fixture.analysis),clone(fixture.hir),clone(fixture.context)),fixture.analysis);
  for(const row of fixture.proofs){if(row.error)assert.throws(()=>verifyKernelParallelGroup(clone(fixture.hir),clone(fixture.context),{targets:row.targets}),e=>assertError(e,row.error));else{const proof=verifyKernelParallelGroup(clone(fixture.hir),clone(fixture.context),{targets:row.targets});assert.deepEqual(proof,row.proof);assertFrozen(proof);}}
 });
}
test('fixed declaration scope and publication stay equal when implementation narrows or exceeds',()=>{
 const wide=sample('fixed-wide'),narrow=sample('fixed-narrow'),exceed=sample('fixed-exceed');
 assert.deepEqual(wide.scope,narrow.scope);assert.deepEqual(wide.context,narrow.context);assert.deepEqual(wide.context,exceed.context);
 assert.notDeepEqual(wide.hir,narrow.hir);assert.notEqual(wide.analysis.hirDigest,narrow.analysis.hirDigest);
 assert.notDeepEqual(wide.analysis.derivedTargets,narrow.analysis.derivedTargets);
 for(const fixture of [wide,narrow]){
  const entry=fixture.hir.functions.find(f=>f.name==='entry');
  const row=fixture.analysis.effectiveTargets.calls.find(c=>c.functionId===entry.id&&c.kind==='indirectCall');assert.equal(row.targets.functions.length,2);
  const result=analyzeModuleCalls(clone(fixture.hir),clone(wide.context));assert.deepEqual(result,fixture.analysis);
 }
});
test('unknown locality and pure own fixed Top use complete independent reports and chains',()=>{
 const f=sample('unknown-locality'),v=f.ownFixedTop;
 const report=analyzeModuleCalls(clone(f.hir),clone(v.context));assert.deepEqual(report,v.analysis);
 for(const row of v.proofs){if(row.error)assert.throws(()=>verifyKernelParallelGroup(clone(f.hir),clone(v.context),{targets:row.targets}),e=>assertError(e,row.error));else assert.deepEqual(verifyKernelParallelGroup(clone(f.hir),clone(v.context),{targets:row.targets}),row.proof);}
 const pure=f.hir.functions.find(x=>x.name==='pure'),chain=report.unknownChains.find(x=>x.functionId===pure.id);
 assert.equal(chain.reason,'published-upper');assert.equal(chain.chain[0].expressionPath,null);
 assert.equal(report.effectiveTargets.functions.find(x=>x.functionId===pure.id).unknownEffects,false);
 assert.equal(f.proofs.filter(x=>x.proof).length,3);
});
