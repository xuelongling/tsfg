// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {finitePresenceShortCircuit} from '../../compiler/finite-numeric-use.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-logical-call/package.json',import.meta.url));
assert.equal(sha256(factsBytes),'sha256:ab8ed50b6fc1ba40e882045acec66ad8d128770ca4f8595b216537304db714a2');
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir,plan=buildFiniteCoreDomains(hir,context).definition;
const core=lowerFormalHir(hir,context);
const functionNamed=name=>hir.functions.find(fn=>fn.name===name);
const fnBody=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;

for(const [name,rhsEdge] of /** @type {const} */ ([['selected',0],['early',1],['fallback',0]])) {
  test(`${name} uses the original comparison on each side of a single short-circuit call`,()=>{
    const fn=functionNamed(name),target=functionNamed('gate');
    const text=fnBody(fn),[{condition,then},after]=fn.body;
    const {left:{left:first,right:call},right:last}=condition;
    assert.equal(call.target,target.id);
    const blocks=text.split(/\n\s*(?=\^bb\d+(?:\([^)]*\))?:\s*\n)/u);
    const locate=(operation,range)=>{
      const block=blocks.find(block=>block.split('\n').some(line=>line.includes(operation)&&line.includes(anchor(range))));
      assert.ok(block,operation+' at '+anchor(range));
      return block;
    };
    const begin=locate('"tsfg_core.domain.presence_equal"',first.range);
    const middle=locate('"func.call"',call.range);
    const end=locate('"tsfg_core.domain.presence_equal"',last.range);
    assert.equal(text.match(/"func.call"/gu)?.length,1);
    assert.match(middle,new RegExp('tsfg_core.function_id = "'+target.id+'"','u'));
    assert.match(fnBody(target),/"tsfg_core\.fuel"\(\) \{event = 1 : i32/u);
    assert.equal(new Set([begin,middle,end]).size,3);
    const blockId=block=>/^\s*(\^bb\d+)/u.exec(block)?.[1];
    const branches=block=>/cf\.cond_br %\w+, (\^bb\d+), (\^bb\d+)/u.exec(block)?.slice(1);
    assert.equal(branches(begin)?.[rhsEdge],blockId(middle));
    assert.equal(branches(middle)?.[rhsEdge],blockId(end));
    assert.equal(branches(begin)?.[1-rhsEdge],branches(middle)?.[1-rhsEdge]);
    assert.equal(branches(middle)?.[1-rhsEdge],branches(end)?.[1-rhsEdge]);
    assert.deepEqual(blocks.filter(block=>branches(block)?.includes(blockId(middle))),[begin]);
    assert.deepEqual(blocks.filter(block=>branches(block)?.includes(blockId(end))),[middle]);
    const callResult=/(%\w+) = "func.call"/u.exec(middle)?.[1];
    const branchValue=/cf\.cond_br (%\w+)/u.exec(middle)?.[1];
    assert.ok(callResult);
    assert.equal(branchValue,callResult);

    const actuals=plan.domains.find(domain=>domain.id===plan.abi.find(row=>row.functionId===fn.id).result).actualTypes;
    const kinds=name==='fallback'?['i32','null','undefined']:['i32'];
    assert.deepEqual(actuals,kinds.map(kind=>sha256('tsfg.type\0'+kind)).sort());
    const narrowedReturn=name==='early'?after:then[0];
    const returned=/"func.return"\((%\w+)\)/u.exec(text.split('\n').find(line=>
      line.includes('"func.return"')&&line.includes(anchor(narrowedReturn.range)))??'')?.[1];
    assert.ok(returned);
    const refinements=new Map([...text.matchAll(/(%\w+) = "tsfg_core\.domain\.refine"\((%\w+)\)[^\n]*presence_proof = ("(?:\\.|[^"\\])*")/gu)]
      .map(row=>[row[1],{input:row[2],proof:JSON.parse(JSON.parse(row[3]))}]));
    const widened=/"tsfg_core\.domain\.view"\((%\w+)\)/u.exec(text.split('\n')
      .find(line=>line.trimStart().startsWith(returned+' = '))??'')?.[1];
    const narrowed=refinements.get(widened??returned);
    assert.ok(narrowed);
    assert.deepEqual(narrowed.proof,{type:sha256('tsfg.type\0undefined'),equal:false,range:last.range});
    const previous=refinements.get(narrowed.input);
    assert.ok(previous);
    assert.deepEqual(previous.proof,{type:sha256('tsfg.type\0null'),equal:false,range:first.range});
    if(name==='fallback') {
      const fallback=plan.expressions.find(row=>row.id===fn.id+'/body/1/value');
      assert.ok(fallback);
      assert.equal(fallback.presenceProof,undefined);
      const previousValue=/(%\w+) = "tsfg_core\.domain\.presence_equal"\((%\w+),/u.exec(begin)?.[2];
      assert.ok(previousValue);
      assert.ok(text.split('\n').some(line=>line.includes('"func.return"('+previousValue+')')&&line.includes(anchor(after.range))));
    }
  });
}

test('a call argument that assigns a caller binding keeps the ordinary SSA merge',()=>{
  const condition=structuredClone(functionNamed('selected').body[0].condition);
  const call=condition.left.right,argument=call.arguments[0];
  call.arguments[0]={...argument,kind:'assignment',target:argument,value:argument};
  assert.equal(finitePresenceShortCircuit(condition,()=>{}),null);
});

test('method dispatch keeps the ordinary condition path',()=>{
  const condition=structuredClone(functionNamed('selected').body[0].condition);
  const call=condition.left.right;
  call.receiver=call.arguments[0];
  assert.equal(finitePresenceShortCircuit(condition,()=>{}),null);
});
