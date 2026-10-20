// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import * as hir from '../../compiler/hir.mjs';
const expected=JSON.parse(await readFile(new URL('./module-callable-immutable-global-first.json',import.meta.url),'utf8'));
const actual=JSON.parse(await readFile(new URL('./module-callable-immutable-global-source-actual.json',import.meta.url),'utf8'));
const oracle=JSON.parse(await readFile(new URL('./kernel-global-core-oracle.json',import.meta.url),'utf8'));
test('actual complete Source/owned HIR/fixed GlobalId proof reaches real Core static bridge',async()=>{
  const imported=await importCapturedFrontendResponse(Buffer.from(actual.requestBytes),Buffer.from(actual.packetBytes),structuredClone(actual.sourceOrigin));
  assert.deepEqual(imported,{status:'ok',snapshot:expected.snapshot});
  const built=hir.buildHir(imported.snapshot);assert.deepEqual(built,{status:'ok',hir:expected.hir});
  const request={targets:expected.proofs[0].targets};
  assert.deepEqual(hir.verifyKernelParallelGroup(built.hir,expected.context,request),expected.proofs[0].proof);
  const lower=Reflect.get(hir,'lowerKernelGlobalCore');
  assert.equal(typeof lower,'function','missing real Core bridge after complete actual inputs and proof match');
  assert.equal(lower(built.hir,expected.context,request,expected.proofs[0].proof),oracle.core);
});
