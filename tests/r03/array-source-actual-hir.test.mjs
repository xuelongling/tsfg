// SPDX-License-Identifier: MIT
// Explicit integration entry: Root supplies its qualified actual Source capture.
// Raw publications are inputs; only pre-production frozen fixtures are expected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir } from '../../compiler/hir.mjs';
import { fixtures,fresh,context,deeplyFrozen,jcs,sha,pinned } from './array-test-fixtures.mjs';

test('25d eight actual official Source publications reach whole HIR and static Core',async t=>{
  const file=process.env.TSFG_ARRAY_SOURCE_CAPTURE;
  assert.ok(file,'explicit Source integration entry requires Root capture manifest');
  assert.equal(process.env.TSFG_ARRAY_SOURCE_CAPTURE_SHA256,'85d8da3bc98ac3259d7882ab968f71209d4108b39ce781b16ac9355292884f94');
  const bytes=await readFile(file);assert.equal(bytes.length,702488);
  assert.equal(sha(bytes),'85d8da3bc98ac3259d7882ab968f71209d4108b39ce781b16ac9355292884f94');
  const capture=JSON.parse(bytes.toString('utf8'));
  assert.equal(capture.schema,'r03.array-dense.actual-source-captures.v1');
  assert.equal(capture.atomicWireVersion,3);
  const state=capture.actual.state;
  assert.equal(state.qualified,true);assert.equal(state.observerOK,true);
  assert.equal(state.exit.code,0);assert.equal(state.close.code,0);
  assert.equal(capture.all8ByteExactToPreproductionIndependentOracle,true);
  const rows=await fixtures(),actuals=[];
  const core=await pinned('./array-core-oracle-v3.json',122335,'44c460f568aebd9dba7b25dab00857a47fe431a3f7cc4679a6d1d09a427552d5');
  assert.deepEqual(capture.cases.map(c=>c.name),rows.map(r=>r.facts.name));
  for(let i=0;i<rows.length;i++){
    const row=rows[i],record=capture.cases[i],raw=await readFile(record.raw.path);
    assert.equal(record.sourcePID,capture.actual.pid);
    assert.equal(record.requestBytes,row.facts.requestBytes);assert.equal(record.requestSHA256,row.facts.requestSHA256);
    assert.equal(raw.length,row.facts.packageBytes);assert.equal(sha(raw),row.facts.packageSHA256);
    assert.deepEqual(raw,Buffer.from(row.facts.packageText),'actual Source bytes equal independent whole expected');
    actuals.push(raw);
  }
  t.diagnostic('25d ACTUAL_SOURCE_ALL_EIGHT_WHOLE_PACKETS_MATCH_INDEPENDENT_ORACLE');
  for(let i=0;i<rows.length;i++)await t.test(rows[i].facts.name,()=>{
    const row=rows[i],raw=actuals[i],before=Buffer.from(raw),input=readArrayFactsCandidate(raw),ctx=context(row,Buffer.from(raw));
    const inputBefore=jcs(input);assert.deepEqual(input,row.facts.package);
    assert.deepEqual(writeArrayFactsCandidate(input),before);
    const built=buildHir(input,ctx);assert.equal(built.status,'ok');
    assert.deepEqual(built.hir,row.hir.expectedHir);deeplyFrozen(built.hir);
    assert.equal(printHir(built.hir,ctx),row.hir.hirText);
    assert.deepEqual(verifyHir(fresh(row.hir.expectedHir),ctx),row.hir.expectedHir);
    assert.deepEqual(readHir(Buffer.from(row.hir.hirText),ctx),row.hir.expectedHir);
    assert.equal(lowerHir(built.hir,ctx),core.cases[i].core);
    assert.equal(jcs(input),inputBefore);assert.deepEqual(raw,before);
    raw.fill(0);assert.deepEqual(built.hir,row.hir.expectedHir);
  });
});
// This static compiler path supplies no guest/VM/trap/heap/Host execution credit.
