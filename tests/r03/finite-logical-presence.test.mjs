// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-logical-presence/package.json',import.meta.url));
assert.equal(sha256(factsBytes),'sha256:22cf2cde14966d03c5c08620483a9262d65cbb82fde1e03df410f8b7bf20fad8');
const facts=readTypedArrayFacts(factsBytes);
assert.equal(facts.packageId,'sha256:3a57f29318ce7e363525fc9ed05da8b0a2de4762fbc10d184c3e6b6b65c4b4f8');
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir,core=lowerFormalHir(hir,context);
const functions=new Map(hir.functions.map(fn=>[fn.name,fn]));
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const body=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];

for(const [name,absence] of /** @type {const} */ ([
  ['both',['null','undefined']],['early',['undefined','null']],['single',['undefined']],
])) {
  test(`genuine ${name} keeps each original presence operand, proof range and entry fuel`,()=>{
    const fn=functions.get(name);
    assert.ok(fn);
    const text=body(fn),condition=fn.body[0].condition;
    const conditions=name==='single'?[condition]:[condition.left,condition.right];
    const comparisons=[...text.matchAll(/(%\w+) = "tsfg_core\.domain\.presence_equal"\((%\w+), %\w+\)[^\n]*/gu)];
    const refines=[...text.matchAll(/(%\w+) = "tsfg_core\.domain\.refine"\((%\w+)\)[^\n]*presence_proof = ("(?:\\.|[^"\\])*")[^\n]* -> ([^\n]+)/gu)];
    assert.equal(comparisons.length,absence.length);
    assert.equal(refines.length,absence.length);
    for(const [index,refined] of refines.entries()) {
      const range=conditions[index].range;
      assert.ok(comparisons[index][0].includes(anchor(range)));
      assert.equal(refined[2],comparisons[index][2]);
      assert.deepEqual(JSON.parse(JSON.parse(refined[3])),
        {equal:false,range,type:sha256('tsfg.type\0'+absence[index])});
    }
    if(refines.length===2)assert.equal(comparisons[1][2],refines[0][1]);
    assert.equal(refines.at(-1)[4],'i32');
    const returned=name==='early'?fn.body[1]:fn.body[0].then[0];
    const resultLine=text.split('\n').find(line=>line.includes('"func.return"('+refines.at(-1)[1]+')'));
    assert.ok(resultLine);
    assert.ok(resultLine.includes(anchor(returned.range)));
    assert.ok(resultLine.includes(': (i32) -> ()'));
    const fuel=text.split('\n').filter(line=>line.includes('"tsfg_core.fuel"'));
    assert.equal(fuel.length,1);
    assert.ok(fuel[0].includes('event = 1 : i32'));
    assert.ok(fuel[0].includes(anchor(fn.range)));
  });
}

function blocks(text) {
  const rows=[{name:'entry',lines:[]}];
  for(const line of text.split('\n')) {
    const label=/^\s*(\^bb\d+)(?:\([^)]*\))?:\s*$/u.exec(line);
    if(label)rows.push({name:label[1],lines:[]});
    else rows.at(-1).lines.push(line);
  }
  return rows;
}

function branch(block) {
  for(const line of block.lines) {
    const conditional=/^\s*cf\.cond_br (%\w+), (\^bb\d+), (\^bb\d+)/u.exec(line);
    if(conditional)return {condition:conditional[1],edges:[conditional[2],conditional[3]],line};
    const direct=/^\s*cf\.br (\^bb\d+)/u.exec(line);
    if(direct)return {condition:null,edges:[direct[1]]};
  }
  return {condition:null,edges:[]};
}

for(const [name,rhsEdge] of /** @type {const} */ ([['both',0],['early',1]])) {
  test(`${name} evaluates the second comparison only on the selected short-circuit edge`,()=>{
    const fn=functions.get(name);
    assert.ok(fn);
    const text=body(fn),rows=blocks(text);
    const compared=rows.filter(block=>block.lines.some(line=>line.includes('"tsfg_core.domain.presence_equal"')));
    assert.equal(compared.length,2);
    const [left,right]=compared;
    const leftBranch=branch(left),rightBranch=branch(right);
    assert.equal(leftBranch.edges.length,2);
    assert.equal(rightBranch.edges.length,2);
    const condition=fn.body[0].condition;
    assert.ok(leftBranch.line.includes(anchor(condition.range)));
    assert.ok(rightBranch.line.includes(anchor(condition.range)));
    assert.equal(leftBranch.edges[rhsEdge],right.name);
    assert.equal(leftBranch.edges[1-rhsEdge],rightBranch.edges[1-rhsEdge]);
    const predecessors=rows.flatMap(block=>branch(block).edges.flatMap((target,index)=>
      target===right.name?[{from:block.name,index}]:[]));
    assert.deepEqual(predecessors,[{from:left.name,index:rhsEdge}]);
    for(const block of compared) {
      const comparedResult=/(%\w+) = "tsfg_core\.domain\.presence_equal"/u.exec(block.lines.join('\n'))[1];
      let selected=branch(block).condition;
      assert.notEqual(selected,comparedResult,'the cold field analysis must see a Boolean view');
      while(selected!==comparedResult) {
        const view=block.lines.find(line=>line.trimStart().startsWith(selected+' = '));
        assert.ok(view);
        const operand=/"tsfg_core\.domain\.view"\((%\w+)\).* : \(i1\) -> i1$/u.exec(view);
        assert.ok(operand);
        selected=operand[1];
      }
    }
  });
}
