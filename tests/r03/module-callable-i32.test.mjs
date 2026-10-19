// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,verifyHir,printHir,readHir,analyzeModuleCalls,verifyModuleCalls,printModuleCalls,readModuleCalls,verifyKernelParallelGroup} from '../../compiler/hir.mjs';
import {bytes,canonical,clone,hash,assertFrozen} from './module-callable-fixtures.mjs';
const fixture=JSON.parse(await readFile(new URL('./module-callable-i32-oracle.json',import.meta.url),'utf8'));
// Full expected objects are independently assembled before this run from the
// two handwritten bodies, documented IDs, and fresh official Source anchors.
test('i32 callback profile has exact owned HIR, finite targets, pure effects and parallel proof',async()=>{
 assert.equal(hash(bytes(fixture.request)),fixture.sourceOrigin.requestSha256);assert.equal(hash(bytes(fixture.packet)),fixture.sourceOrigin.responseSha256);
 const imported=await importCapturedFrontendResponse(bytes(fixture.request),bytes(fixture.packet),clone(fixture.sourceOrigin));
 assert.equal(imported.status,'ok',canonical(imported));assert.deepEqual(imported.snapshot,fixture.snapshot);assertFrozen(imported.snapshot);
 assert.deepEqual(validateFrontendSnapshot(clone(fixture.snapshot)),fixture.snapshot);
 const built=buildHir(imported.snapshot);assert.equal(built.status,'ok',canonical(built));assert.deepEqual(built.hir,fixture.hir);assertFrozen(built.hir);
 assert.deepEqual(verifyHir(clone(fixture.hir)),fixture.hir);assert.equal(printHir(clone(fixture.hir)),bytes(fixture.hir).toString());assert.deepEqual(readHir(bytes(fixture.hir)),fixture.hir);
 const report=analyzeModuleCalls(clone(fixture.hir),clone(fixture.context));assert.deepEqual(report,fixture.analysis);assertFrozen(report);
 assert.deepEqual(verifyModuleCalls(clone(fixture.analysis),clone(fixture.hir),clone(fixture.context)),fixture.analysis);
 assert.equal(printModuleCalls(clone(fixture.analysis),clone(fixture.hir),clone(fixture.context)),bytes(fixture.analysis).toString());
 assert.deepEqual(readModuleCalls(bytes(fixture.analysis),clone(fixture.hir),clone(fixture.context)),fixture.analysis);
 const proof=verifyKernelParallelGroup(clone(fixture.hir),clone(fixture.context),{targets:fixture.proof.targets});assert.deepEqual(proof,fixture.proof);assertFrozen(proof);
});
