// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import * as hir from '../../compiler/hir.mjs';

const fixture=JSON.parse(await readFile(new URL('./kernel-parallel-first.json',import.meta.url),'utf8'));
test('explicit scalar kernel group reports shared Published reads and excludes initializer writes',()=>{
 assert.deepEqual(hir.verifyHir(fixture.hir),fixture.hir);
 assert.deepEqual(hir.analyzeModuleCalls(fixture.hir,fixture.context),fixture.expectedAnalysis);
 const verify=Reflect.get(hir,'verifyKernelParallelGroup');
 // BASE missing this public consumer is an API gap, never a semantic RED.
 assert.equal(typeof verify,'function','public kernel parallel-group consumer must exist');
 assert.deepEqual(verify(fixture.hir,fixture.context,fixture.request),fixture.expectedProof);
});
