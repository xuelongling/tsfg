// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {i32TypeId,sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-predicate-paths/package.json',import.meta.url));
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const {hir}=built;
const plan=buildFiniteCoreDomains(hir,context).definition;
const source=hir.sources.find(row=>row.path===hir.rootFile).content;
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const cases=new Map([['direct',1],['early',1],['nested',1],['double',2],['ordered',0]]);

for(const fn of hir.functions) {
  test(`${fn.name} refines the value on the selected predicate path`,()=>{
    const early=fn.name==='early',ordered=fn.name==='ordered';
    const suffix=early?'/body/1/value/left':'/body/0/then/0/value/left';
    const read=plan.expressions.find(row=>row.id===fn.id+suffix);
    const proof=read?.presenceProof;
    assert.ok(proof);
    assert.equal(proof.equal,false);
    assert.equal(proof.type,sha256('tsfg.type\0null'));
    assert.equal(source.slice(proof.range.start,proof.range.end),
      fn.name==='direct'||fn.name==='nested'?'x===null':'x!==null');
    const inputs=ordered?[read,plan.expressions.find(row=>row.id===fn.id+'/body/0/condition/right/left')]:[read];
    for(const input of inputs) {
      assert.deepEqual(input?.presenceProof,proof);
      const domain=plan.nodes.find(row=>row.id===input.id).domainId;
      assert.deepEqual(plan.domains.find(row=>row.id===domain).actualTypes,[i32TypeId]);
    }
  });
}

test('finite Core keeps the original predicate operations and comparison anchors',()=>{
  assert.deepEqual(new Set(hir.functions.map(fn=>fn.name)),new Set(cases.keys()));
  const core=lowerFormalHir(hir,context);
  for(const fn of hir.functions) {
    const text=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
    assert.equal([...text.matchAll(/"tsfg_core\.bool_not"/gu)].length,cases.get(fn.name));
    const lines=text.split('\n');
    const comparison=lines.find(line=>line.includes('"tsfg_core.domain.presence_equal"'));
    assert.ok(comparison);
    const refinements=lines.filter(line=>line.includes('"tsfg_core.domain.refine"'));
    assert.ok(refinements.length);
    const rows=plan.expressions.filter(row=>row.functionId===fn.id&&row.presenceProof);
    for(const row of rows) {
      assert.ok(comparison.includes(anchor(row.presenceProof.range)));
      assert.ok(refinements.some(line=>line.includes(anchor(row.range))));
    }
    if(fn.name==='ordered') {
      const ordered=lines.find(line=>line.includes('"tsfg_core.gt"'));
      const refined=/(%\w+) = "tsfg_core\.domain\.refine"/u.exec(refinements[0])?.[1];
      assert.ok(refined&&ordered.includes(`"tsfg_core.gt"(${refined},`));
    }
  }
});
