// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {i32TypeId,sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-logical-not/package.json',import.meta.url));
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const {hir}=built;
const plan=buildFiniteCoreDomains(hir,context).definition;
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const branch=block=>/cf\.cond_br (%\w+), (\^bb\d+), (\^bb\d+)/u.exec(block);
const label=block=>/^\s*(\^bb\d+)/u.exec(block)?.[1];

for(const fn of hir.functions) {
  test(`${fn.name} keeps the strict absence proof with a negated boolean operand`,()=>{
    const early=fn.name==='early';
    const condition=fn.body[0].condition;
    const absence=early?condition.right:condition.left;
    const suffix=early?'/body/1/value/left':'/body/0/then/0/value/left';
    const read=plan.expressions.find(row=>row.id===fn.id+suffix);
    assert.deepEqual(read?.presenceProof,{equal:false,range:absence.range,type:sha256('tsfg.type\0null')});
    const domain=plan.nodes.find(row=>row.id===read.id).domainId;
    assert.deepEqual(plan.domains.find(row=>row.id===domain).actualTypes,[i32TypeId]);
  });
}

test('finite Core branches on the original negation and preserves short-circuit order',()=>{
  assert.equal(hir.functions.length,3);
  const core=lowerFormalHir(hir,context);
  for(const fn of hir.functions) {
    const early=fn.name==='early',condition=fn.body[0].condition;
    const [negation,absence]=early?[condition.left,condition.right]:[condition.right,condition.left];
    assert.equal(negation.operator,'!');
    if(fn.name==='grouped')assert.equal(negation.operand.kind,'group');
    const text=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
    const blocks=text.split(/\n\s*(?=\^bb\d+(?:\([^)]*\))?:\s*\n)/u);
    const negatedBlock=blocks.find(block=>block.includes('"tsfg_core.bool_not"')&&block.includes(anchor(negation.range)));
    const comparisonBlock=blocks.find(block=>block.includes('"tsfg_core.domain.presence_equal"')&&block.includes(anchor(absence.range)));
    assert.ok(negatedBlock&&comparisonBlock);
    const negatedValue=/(%\w+) = "tsfg_core\.bool_not"/u.exec(negatedBlock)?.[1];
    assert.equal(branch(negatedBlock)?.[1],negatedValue);
    if(early) assert.equal(branch(negatedBlock)?.[3],label(comparisonBlock));
    else assert.equal(branch(comparisonBlock)?.[2],label(negatedBlock));
  }
});
