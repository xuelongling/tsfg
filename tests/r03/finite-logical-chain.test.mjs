// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-logical-chain/package.json',import.meta.url));
assert.equal(sha256(factsBytes),'sha256:0b981ccc845bf2b5dd3f54af604183d57543836f291d4332dd35260b10f1409d');
const facts=readTypedArrayFacts(factsBytes);
assert.equal(facts.packageId,'sha256:eb468fa22fe5340cef5dff0fe8bc9f59a440f31843f1c98a5bee1ba40258cbb0');
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir,core=lowerFormalHir(hir,context),plan=buildFiniteCoreDomains(hir,context).definition;
const functions=new Map(hir.functions.map(fn=>[fn.name,fn]));
const source=hir.sources.find(row=>row.path===hir.rootFile).content;
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const key=range=>range.start+'/'+range.end;
const body=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
const cases=/** @type {const} */ ([
  ['grouped',{start:75,end:102},'(x!==null && y!==undefined)',[0,0,0]],
  ['early',{start:232,end:259},'(y===undefined || x===null)',[1,1,1]],
  ['partial',{start:379,end:411},'(y===undefined || x!==undefined)',[0,1,0]],
]);

function conditionNodes(value,leaves=[],groups=[]) {
  if(value.kind==='group') {
    groups.push(value);conditionNodes(value.operand,leaves,groups);
  }else if(value.kind==='binary'&&['&&','||'].includes(value.operator)) {
    conditionNodes(value.left,leaves,groups);conditionNodes(value.right,leaves,groups);
  }else leaves.push(value);
  return {leaves,groups};
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
    if(direct)return {condition:null,edges:[direct[1]],line};
  }
  return {condition:null,edges:[],line:''};
}

function comparisons(rows,leaves) {
  return leaves.map(leaf=>{
    const block=rows.find(row=>row.lines.some(line=>line.includes('"tsfg_core.domain.presence_equal"')&&line.includes(anchor(leaf.range))));
    assert.ok(block);
    const line=block.lines.find(line=>line.includes('"tsfg_core.domain.presence_equal"'));
    const matched=/(%\w+) = "tsfg_core\.domain\.presence_equal"\((%\w+), %\w+\)/u.exec(line);
    assert.ok(matched);
    return {block,line,result:matched[1],input:matched[2],leaf};
  });
}

for(const [name,groupRange,groupText] of cases) {
  test(`genuine ${name} preserves parent SSA, grouped source ranges and exact result variants`,()=>{
    const fn=functions.get(name);
    assert.ok(fn);
    const text=body(fn),rows=blocks(text),{leaves,groups}=conditionNodes(fn.body[0].condition);
    assert.equal(leaves.length,3);
    assert.equal(groups.length,1);
    assert.deepEqual(groups[0].range,groupRange);
    assert.equal(source.slice(groupRange.start,groupRange.end),groupText);
    assert.equal([...text.matchAll(/"tsfg_core\.domain\.presence_equal"/gu)].length,3);
    const compared=comparisons(rows,leaves),byRange=new Map(compared.map(row=>[key(row.leaf.range),row]));
    const parameters=[...text.split('\n')[0].matchAll(/(%\w+): /gu)].map(row=>row[1]);
    assert.equal(compared[0].input,parameters[0]);
    assert.equal(compared[1].input,parameters[1]);
    const refines=[...text.matchAll(/(%\w+) = "tsfg_core\.domain\.refine"\((%\w+)\)[^\n]*presence_proof = ("(?:\\.|[^"\\])*")[^\n]* -> ([^\n]+)/gu)]
      .map(row=>({result:row[1],input:row[2],proof:JSON.parse(JSON.parse(row[3])),type:row[4]}));
    assert.ok(refines.length>=2);
    for(const refined of refines) {
      const comparison=byRange.get(key(refined.proof.range));
      assert.ok(comparison);
      assert.equal(refined.input,comparison.input);
      assert.deepEqual(refined.proof,{equal:false,range:comparison.leaf.range,
        type:sha256('tsfg.type\0'+comparison.leaf.right.kind)});
    }
    const parent=refines.find(row=>row.result===compared[2].input);
    assert.ok(parent);
    assert.equal(parent.input,compared[0].input);
    assert.deepEqual(parent.proof.range,leaves[0].range);
    const returned=name==='early'?fn.body[1]:fn.body[0].then[0];
    const returnedLine=text.split('\n').find(line=>line.includes('"func.return"')&&line.includes(anchor(returned.range)));
    assert.ok(returnedLine);
    const returnedValue=/"func.return"\((%\w+)\)/u.exec(returnedLine);
    assert.ok(returnedValue);
    const final=refines.find(row=>row.result===returnedValue[1]);
    assert.ok(final);
    assert.deepEqual(final.proof.range,leaves[name==='partial'?0:2].range);
    const expected=[sha256('tsfg.type\0i32'),...(name==='partial'?[sha256('tsfg.type\0undefined')]:[])].sort();
    const result=plan.domains.find(row=>row.id===plan.abi.find(row=>row.functionId===fn.id).result);
    assert.deepEqual(result.actualTypes,expected);
    assert.equal(final.type,name==='partial'?`!tsfg_core.domain<"${result.id}">`:'i32');
    const fuel=text.split('\n').filter(line=>line.includes('"tsfg_core.fuel"'));
    assert.equal(fuel.length,1);
    assert.ok(fuel[0].includes('event = 1 : i32'));
    assert.ok(fuel[0].includes(anchor(fn.range)));
  });
}

for(const [name,,,edges] of cases) {
  test(`${name} keeps the selected short-circuit edges and only the common guard at a join`,()=>{
    const fn=functions.get(name);
    assert.ok(fn);
    const text=body(fn),rows=blocks(text),{leaves,groups}=conditionNodes(fn.body[0].condition);
    const compared=comparisons(rows,leaves),branches=compared.map(row=>branch(row.block));
    const parents=name==='grouped'?[groups[0].operand.range,fn.body[0].condition.range,fn.body[0].condition.range]
      :[fn.body[0].condition.range,groups[0].operand.range,fn.body[0].condition.range];
    for(const [index,comparison] of compared.entries()) {
      assert.equal(branches[index].edges.length,2);
      assert.ok(branches[index].line.includes(anchor(parents[index])));
      let selected=branches[index].condition;
      assert.notEqual(selected,comparison.result);
      while(selected!==comparison.result) {
        const line=comparison.block.lines.find(line=>line.trimStart().startsWith(selected+' = '));
        assert.ok(line);
        const view=/"tsfg_core\.domain\.view"\((%\w+)\).* : \(i1\) -> i1$/u.exec(line);
        assert.ok(view);selected=view[1];
      }
      if(index===2)continue;
      const target=compared[index+1].block.name;
      assert.equal(branches[index].edges[edges[index]],target);
      const predecessors=rows.flatMap(block=>branch(block).edges.flatMap((targetName,index)=>
        targetName===target?[{from:block.name,index}]:[]));
      assert.deepEqual(predecessors,[{from:comparison.block.name,index:edges[index]}]);
    }
    if(name==='partial') {
      const selected=branches[1].edges[0];
      assert.equal(selected,branches[2].edges[0]);
      const join=rows.find(row=>row.name===selected);
      assert.ok(join);
      assert.ok(join.lines.some(line=>line.includes('"func.return"')&&line.includes(anchor(fn.body[0].then[0].range))));
      const predecessors=rows.flatMap(block=>branch(block).edges.flatMap((target,index)=>
        target===selected?[{from:block.name,index}]:[]));
      assert.deepEqual(new Set(predecessors.map(row=>row.from+'/'+row.index)),
        new Set([compared[1].block.name+'/0',compared[2].block.name+'/0']));
      assert.equal(branches[0].edges[1],branches[2].edges[1]);
    }else {
      const failure=branches[0].edges[1-edges[0]];
      for(const [index,decision] of branches.entries())assert.equal(decision.edges[1-edges[index]],failure);
      const returned=name==='early'?fn.body[1]:fn.body[0].then[0];
      const result=rows.find(row=>row.lines.some(line=>line.includes('"func.return"')&&line.includes(anchor(returned.range))));
      assert.ok(result);
      const selected=rows.find(row=>row.name===branches[2].edges[edges[2]]);
      assert.ok(selected);
      if(selected!==result) {
        const forwarded=branch(selected);
        assert.equal(forwarded.condition,null);
        assert.deepEqual(forwarded.edges,[result.name]);
      }
    }
  });
}
