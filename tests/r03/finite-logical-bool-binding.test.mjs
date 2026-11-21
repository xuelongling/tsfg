// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {finitePresenceShortCircuit} from '../../compiler/finite-numeric-use.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-logical-bool-binding/package.json',import.meta.url));
assert.equal(sha256(factsBytes),'sha256:7a23aff354c9fccd2af617bb5428a431b1936945ecd6135e5192d92641392470');
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir,plan=buildFiniteCoreDomains(hir,context).definition;
const core=lowerFormalHir(hir,context);
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const blockLabel=block=>/^\s*(\^bb\d+)/u.exec(block)?.[1];
const branch=block=>/cf\.cond_br (%\w+), (\^bb\d+), (\^bb\d+)/u.exec(block);

const cases=/** @type {const} */ ([
  ['selected','/body/0/then/0/value/left',0,'null'],
  ['iterate','/body/0/body/0/value/left',0,'undefined'],
  ['early','/body/1/value',1,'null'],
]);
for(const [name,path,edge,missing] of cases) {
  test(`${name} preserves the boolean binding, selected edges and original missing-value proof`,()=>{
    const fn=hir.functions.find(row=>row.name===name),condition=fn.body[0].condition;
    const {left,right}=condition;
    const leaves=name==='iterate'?[left.left,left.right,right]:[left,right];
    const flag=leaves.findIndex(leaf=>leaf.kind==='reference');
    assert.notEqual(flag,-1);
    const testRange=leaves[leaves.length-1-(name==='early'?1:0)].range;
    const proof=plan.expressions.find(row=>row.id===fn.id+path)?.presenceProof;
    assert.deepEqual(proof,{type:sha256('tsfg.type\0'+missing),equal:false,range:testRange});
    const text=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
    const blocks=text.split(/\n\s*(?=\^bb\d+(?:\([^)]*\))?:\s*\n)/u);
    const positions=leaves.map((leaf,index)=>index===flag?undefined:blocks.find(block=>
      block.split('\n').some(line=>line.includes('"tsfg_core.domain.presence_equal"')&&line.includes(anchor(leaf.range)))));
    if(flag===0)positions[flag]=blocks[0];
    else {
      assert.ok(positions[flag-1]);
      const label=branch(positions[flag-1])?.[2+edge];
      positions[flag]=blocks.find(block=>blockLabel(block)===label);
    }
    assert.ok(positions.every(Boolean));
    assert.equal(new Set(positions).size,positions.length);
    const header=name==='iterate'?positions[0]:blocks[0];
    const parameter=/(%\w+): i1/u.exec(header.split('\n').find(line=>line.includes(': i1'))??'')?.[1];
    assert.ok(parameter);
    assert.equal(branch(positions[flag])?.[1],parameter);
    for(const [index,block] of positions.slice(0,-1).entries()) {
      assert.equal(branch(block)?.[2+edge],blockLabel(positions[index+1]));
    }
    const result=plan.domains.find(row=>row.id===plan.abi.find(row=>row.functionId===fn.id).result);
    assert.deepEqual(result.actualTypes,[sha256('tsfg.type\0i32')]);
  });
}

test('plain boolean operands keep the existing condition path when there is no presence test',()=>{
  const {condition}=hir.functions.find(row=>row.name==='selected').body[0];
  assert.equal(finitePresenceShortCircuit({...condition,right:condition.left},()=>{}),null);
});

test('a flow-boolean reference with a union declaration keeps the ordinary path',()=>{
  const {condition}=hir.functions.find(row=>row.name==='selected').body[0];
  const {left,right}=condition;
  assert.notEqual(left.type,right.left.declaredType);
  const narrowed={...left,declaredType:right.left.declaredType};
  assert.equal(finitePresenceShortCircuit({...condition,left:narrowed},()=>{}),null);
});
