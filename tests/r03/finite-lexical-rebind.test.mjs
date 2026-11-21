// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {i32TypeId} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-lexical-rebind/package.json',import.meta.url));
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const {hir}=built;
const plan=buildFiniteCoreDomains(hir,context).definition;
const functions=new Map(hir.functions.map(fn=>[fn.name,fn]));
const source=hir.sources.find(row=>row.path===hir.rootFile).content;
const textAt=range=>source.slice(range.start,range.end);
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const sameRange=(a,b)=>a.start===b.start&&a.end===b.end;

const cases=/** @type {const} */ ([['before',1],['nested',1],['joined',2]]);
for(const [name,expected] of cases) {
  test(`genuine ${name} narrows the original value up to the write or control-flow join`,()=>{
    const fn=functions.get(name);
    assert.ok(fn);
    const expressions=plan.expressions.filter(row=>row.functionId===fn.id);
    const additions=expressions.filter(row=>row.kind==='binary'&&/^y\+\([12] as i32\)$/u.test(textAt(row.range)));
    assert.equal(additions.length,expected);
    const reads=additions.map(row=>expressions.find(read=>read.id===row.id+'/left'));
    for(const read of reads) {
      assert.equal(textAt(read.range),'y');
      assert.ok(read.presenceProof);
      assert.equal(read.presenceProof.equal,false);
      assert.equal(textAt(read.presenceProof.range),'y!==null');
      const value=plan.nodes.find(row=>row.id===read.id);
      const domain=plan.domains.find(row=>row.id===value.domainId);
      assert.deepEqual(domain.actualTypes,[i32TypeId]);
    }
    const core=lowerFormalHir(hir,context);
    const lines=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0].split('\n');
    const proofInputs=reads.map(read=>{
      const guard=expressions.find(row=>row.kind==='binary'&&sameRange(row.range,read.presenceProof.range));
      const comparison=lines.find(line=>line.includes('"tsfg_core.domain.presence_equal"')&&line.includes(anchor(guard.range)));
      const refined=lines.find(line=>line.includes('"tsfg_core.domain.refine"')&&line.includes(anchor(read.range)));
      const input=/"tsfg_core\.domain\.presence_equal"\((%\w+),/u.exec(comparison)[1];
      const byProof=/"tsfg_core\.domain\.refine"\((%\w+)\)/u.exec(refined)[1];
      assert.equal(byProof,input);
      return input;
    });
    if(expected===2) {
      assert.notDeepEqual(reads[0].presenceProof.range,reads[1].presenceProof.range);
      assert.notEqual(proofInputs[0],proofInputs[1]);
    }
  });
}
