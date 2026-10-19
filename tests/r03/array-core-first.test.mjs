// SPDX-License-Identifier: MIT
// Independent Core5 metadata migration retains the original ordered SSA traces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir } from '../../compiler/hir.mjs';
import { fixtures,fresh,context,coreOracle,sha } from './array-test-fixtures.mjs';
import { parseArrayCore,assertArrayCoreSemantics } from './array-core-structural-oracle.mjs';

test('25d eight whole facts and HIR controls precede complete public Core equality',async t=>{
  const rows=await fixtures();
  const oracle=await coreOracle();
  assert.equal(oracle.inheritedCoreProvenance.productionOutputSampled,false);assert.equal(oracle.inheritedCoreProvenance.productionImported,false);
  assert.equal(oracle.inheritedCoreProvenance.nativeCompileLinkCliExecuted,false);
  assert.equal(oracle.inheritedCoreProvenance.viewOperationLoweringCredit,false);
  assert.equal(oracle.inheritedCoreProvenance.formalCoreVersion,'0.9.0');assert.equal(oracle.inheritedCoreProvenance.formalWireVersion,9);
  assert.equal(oracle.cases.length,8);
  const prepared=[];
  const totals={functions:0,parameters:0,sites:0,aliases:0,elements:0,checkedReads:0,stores:0,resizes:0,constants:0,operations:0,registers:0};
  for(let i=0;i<rows.length;i++){
    const row=rows[i],c=oracle.cases[i];assert.equal(c.name,row.facts.name);
    assert.equal(c.factsPackageBytes,row.facts.packageBytes);assert.equal(c.factsPackageSHA256,row.facts.packageSHA256);
    assert.equal(c.hirBytes,row.hir.hirBytes);assert.equal(c.hirSHA256,row.hir.hirSHA256);
    assert.equal(Buffer.byteLength(c.core),c.coreBytes);assert.equal(sha(c.core),c.coreSHA256);
    const structure=parseArrayCore(c.core),counts=assertArrayCoreSemantics(c.core,c);
    for(const key of Object.keys(totals))totals[key]+=counts[key];
    assert.equal(structure.functions.length,c.semantic.length);
    for(let j=0;j<c.semantic.length;j++){
      const trace=c.semantic[j],fn=structure.functions[j];
      assert.equal(fn.operations.length,trace.counts.operations);
      assert.equal(fn.parameters.length,trace.counts.parameters);
      assert.deepEqual(fn.operations.map(op=>op.name),trace.lines.map(op=>op.operation));
      assert.deepEqual(fn.operations.map(op=>op.operands),trace.lines.map(op=>op.operands));
      assert.deepEqual(fn.operations.map(op=>op.results[0]??null),trace.lines.map(op=>op.result));
    }
    const bytes=Buffer.from(row.facts.packageText),before=Buffer.from(bytes),ctx=context(row,bytes);
    const facts=readArrayFactsCandidate(bytes);assert.deepEqual(facts,row.facts.package);
    assert.deepEqual(writeArrayFactsCandidate(facts),before);
    const built=buildHir(facts,ctx);assert.equal(built.status,'ok');assert.deepEqual(built.hir,row.hir.expectedHir);
    assert.deepEqual(verifyHir(fresh(row.hir.expectedHir),ctx),row.hir.expectedHir);
    assert.equal(printHir(built.hir,ctx),row.hir.hirText);
    assert.deepEqual(readHir(Buffer.from(row.hir.hirText),ctx),row.hir.expectedHir);
    assert.deepEqual(bytes,before);prepared.push({row,c,ctx});
  }
  assert.deepEqual(totals,{functions:10,parameters:8,sites:11,aliases:9,elements:27,checkedReads:12,
    stores:7,resizes:4,constants:45,operations:108,registers:85});
  t.diagnostic('25d ALL_EIGHT_INDEPENDENT_WHOLE_CONTROLS_COMPLETE; static compiler evidence only');
  for(const {row,c,ctx}of prepared)await t.test(c.name,()=>{
    const h=fresh(row.hir.expectedHir),before=fresh(h);
    const text=lowerHir(h,ctx);assert.equal(text,c.core);
    assertArrayCoreSemantics(text,c);assert.deepEqual(h,before);
  });
});
