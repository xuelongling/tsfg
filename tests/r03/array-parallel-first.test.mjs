// SPDX-License-Identifier: MIT
// Frozen actual Source/whole-HIR preservation precedes the missing new static consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as hir from '../../compiler/hir.mjs';
const bytes=await readFile(new URL('./array-parallel-oracle.json',import.meta.url));
assert.equal(bytes.length,206539);
assert.equal(createHash('sha256').update(bytes).digest('hex'),'036c7b905e5a17aa03bca4e4cac8aedcc4dbefcf0093f5ab8f140222b234bd40');
const row=JSON.parse(bytes.toString()).cases[0];
const context={family:'tsfg.array-facts-context-candidate',version:1,
  expectedPackageId:JSON.parse(row.source.packetText).packageId,factsBytes:Buffer.from(row.source.packetText)};
test('37b actual captured Source and prior whole analysis reach the missing Array call parallel consumer',()=>{
  const built=hir.buildHir(JSON.parse(row.source.packetText),context,row.context);
  assert.equal(built.status,'ok');assert.deepEqual(built.hir,row.hir);
  assert.deepEqual(hir.analyzeArrayCalls(built.hir,context,row.context),row.baselineAnalysis);
  assert.equal(typeof hir.verifyArrayCallParallelGroup,'function','real public static consumer is required');
  assert.deepEqual(hir.verifyArrayCallParallelGroup(built.hir,context,row.context,row.request),row.expectedProof);
});
