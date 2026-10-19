// SPDX-License-Identifier: MIT
// Explicit integration entry: Root supplies its qualified actual Source capture.
// Raw publications are inputs; only pre-production frozen fixtures are expected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir } from '../../compiler/hir.mjs';
import { fixtures,fresh,context,deeplyFrozen,jcs,sha,pinnedContainer } from './array-test-fixtures.mjs';

test('25d eight actual official Source publications reach whole HIR and static Core',async t=>{
  const file=process.env.TSFG_ARRAY_SOURCE_CAPTURE;
  assert.ok(file,'explicit Source integration entry requires Root capture manifest');
  const expectedHash=process.env.TSFG_ARRAY_SOURCE_CAPTURE_SHA256;
  const expectedBytes=Number(process.env.TSFG_ARRAY_SOURCE_CAPTURE_BYTES);
  assert.match(expectedHash??'',/^[0-9a-f]{64}$/,'Root must bind the exact fresh final v7 manifest hash');
  assert.ok(Number.isInteger(expectedBytes)&&expectedBytes>0&&expectedBytes<=2097152,
    'Root must bind the exact fresh final v7 manifest byte count');
  const bytes=await readFile(file);assert.equal(bytes.length,expectedBytes);
  assert.equal(sha(bytes),expectedHash);
  const capture=JSON.parse(bytes.toString('utf8'));
  assert.equal(capture.schema,'r03.array-dense.actual-source-captures.v1');
  assert.equal(capture.atomicWireVersion,7);
  const state=capture.actual.state;
  assert.equal(state.qualified,true);assert.equal(state.observerOK,true);
  assert.equal(state.exit.code,0);assert.equal(state.close.code,0);
  assert.equal(capture.all8ByteExactToPreproductionIndependentOracle,true);
  const rows=await fixtures(),actuals=[];
  const core=await pinnedContainer('./legacy-v7-old8-core-oracle.json',806405,'0e976fb9f7e36ef4035b6b2019da6e35897bd81690245bedaa1ec455e2b77724');
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
