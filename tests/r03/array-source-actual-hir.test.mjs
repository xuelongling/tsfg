// SPDX-License-Identifier: MIT
// Root supplies one manifest extracted from an actually qualified Source Go run.
// Its bytes are independently pinned; expected packages/HIR stay the frozen oracles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate, writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';
import { fixtures, fresh, context, deeplyFrozen, jcs, sha } from './array-test-fixtures.mjs';

test('25b four actual official Source packages reach complete owned HIR through public APIs',async t=>{
  const file=process.env.TSFG_ARRAY_SOURCE_CAPTURE,expectedSHA=process.env.TSFG_ARRAY_SOURCE_CAPTURE_SHA256;
  assert.ok(file,'Root must supply an actual Source capture manifest');
  assert.match(expectedSHA??'',/^[0-9a-f]{64}$/);
  const bytes=await readFile(file);assert.equal(sha(bytes),expectedSHA);
  const capture=JSON.parse(bytes.toString('utf8'));
  assert.equal(capture.family,'tsfg.r03.array-source-captures');assert.equal(capture.version,1);
  assert.match(capture.producer.baseOid,/^[0-9a-f]{40}$/);
  assert.equal(typeof capture.producer.dirty,'boolean');
  assert.match(capture.producer.inputSetHash,/^sha256:[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(capture.producer.pid)&&capture.producer.pid>0);
  assert.equal(capture.producer.qualified,true);
  assert.equal(capture.producer.exitCode,0);assert.equal(capture.producer.closeCode,0);
  const rows=await fixtures();
  assert.deepEqual(capture.cases.map(c=>c.name),rows.map(r=>r.facts.name));
  // Finish every actual whole-Source equality before the first HIR call.
  for(let i=0;i<rows.length;i++){
    const actual=capture.cases[i],row=rows[i];
    assert.equal(actual.requestText,row.facts.requestText);
    assert.equal(actual.packageText,row.facts.packageText);
    assert.equal(sha(actual.requestText),row.facts.requestSHA256);
    assert.equal(sha(actual.packageText),row.facts.packageSHA256);
    const facts=readArrayFactsCandidate(Buffer.from(actual.packageText));
    assert.deepEqual(facts,row.facts.package);
    assert.deepEqual(writeArrayFactsCandidate(facts),Buffer.from(actual.packageText));
  }
  t.diagnostic('25b ACTUAL_SOURCE_ALL_FOUR_WHOLE_PACKETS_MATCH_FROZEN_ORACLE; first public HIR follows');
  for(let i=0;i<rows.length;i++)await t.test(rows[i].facts.name,()=>{
    const actual=capture.cases[i],row=rows[i],actualBytes=Buffer.from(actual.packageText);
    const input=readArrayFactsCandidate(actualBytes),ctx=context(row,Buffer.from(actualBytes));
    const before=jcs(input),built=buildHir(input,ctx);
    assert.equal(built.status,'ok');
    assert.deepEqual(built.hir,row.hir.expectedHir);deeplyFrozen(built.hir);
    assert.equal(printHir(built.hir,ctx),row.hir.hirText);
    const cold=verifyHir(fresh(row.hir.expectedHir),ctx);deeplyFrozen(cold);
    assert.deepEqual(cold,row.hir.expectedHir);
    assert.deepEqual(readHir(Buffer.from(row.hir.hirText),ctx),row.hir.expectedHir);
    assert.equal(jcs(input),before);
    actualBytes.fill(0);assert.deepEqual(built.hir,row.hir.expectedHir);
  });
});
// This validates actual private facts -> HIR only. Core/Runtime/trap/VM remain OPEN.
