// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {finiteNormalBody,finiteNormalFlow} from '../../compiler/finite-numeric-use.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-logical-while/package.json',import.meta.url));
assert.equal(sha256(factsBytes),'sha256:574d2819750046d5552c790552bd1805affe5230fcc137069530c89d3c329237');
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir,plan=buildFiniteCoreDomains(hir,context).definition;
const core=lowerFormalHir(hir,context);
const functionNamed=name=>hir.functions.find(fn=>fn.name===name);
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const fnBody=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
const label=block=>/^\s*(\^bb\d+)/u.exec(block)?.[1];
const branch=block=>/cf\.cond_br %\w+, (\^bb\d+), (\^bb\d+)/u.exec(block)?.slice(1);

for(const [name,edge] of /** @type {const} */ ([['body',0],['exit',1]])) {
  test(`${name} proves the selected return from the same current loop-header value`,()=>{
    const fn=functionNamed(name);
    const index=fn.body.findIndex(row=>row.kind==='while'),loop=fn.body[index];
    const returned=name==='body'?loop.body[0]:fn.body[index+1];
    const currentProof=plan.expressions.find(row=>
      row.id===fn.id+'/body/'+(name==='body'?index+'/body/0/value':(index+1)+'/value'));
    const {left,right}=loop.condition;
    assert.deepEqual(currentProof?.presenceProof,{
      type:sha256('tsfg.type\0undefined'),equal:false,range:right.range});

    const text=fnBody(fn);
    const blocks=text.split(/\n\s*(?=\^bb\d+(?:\([^)]*\))?:\s*\n)/u);
    const locate=(operation,range)=>{
      const block=blocks.find(block=>block.split('\n').some(line=>line.includes(operation)&&line.includes(anchor(range))));
      assert.ok(block,operation+' at '+anchor(range));
      return block;
    };
    const header=locate('"tsfg_core.domain.presence_equal"',left.range);
    const rhs=locate('"tsfg_core.domain.presence_equal"',right.range);
    const result=locate('"func.return"',returned.range);
    assert.equal(branch(header)?.[edge],label(rhs));
    assert.equal(branch(rhs)?.[edge],label(result));
    assert.equal(branch(rhs)?.[1-edge],branch(header)?.[1-edge]);
    assert.match(header,/"tsfg_core\.fuel"\(\) \{event = 2 : i32/u);
    assert.equal(text.match(/"tsfg_core\.fuel"\(\) \{event = 2 : i32/gu)?.length,1);
    const tested=/(%\w+) = "tsfg_core\.domain\.presence_equal"\((%\w+),/u.exec(header)?.[2];
    assert.ok(tested);
    const firstProof=/(%\w+) = "tsfg_core\.domain\.refine"\((%\w+)\)/u.exec(rhs);
    assert.equal(firstProof?.[2],tested);
    const lastTest=/"tsfg_core\.domain\.presence_equal"\((%\w+),/u.exec(rhs);
    assert.equal(lastTest?.[1],firstProof?.[1]);
    assert.ok(result.includes('"tsfg_core.domain.refine"('+lastTest?.[1]+')'));
    if(name==='exit') {
      const backedge=blocks.find(block=>label(block)===branch(header)?.[0]);
      assert.ok(backedge);
      const edgeLine=backedge.split('\n').find(line=>line.includes('cf.br '+label(header)+'('));
      assert.ok(edgeLine);
      const actual=/(%\w+):/u.exec(header)?.[1];
      assert.equal(actual,tested);
      assert.doesNotMatch(edgeLine,new RegExp('cf\\.br \\^bb\\d+\\('+tested+' :','u'));
    }
  });
}

test('a loop calls its predicate only after the first successful guard',()=>{
  const fn=functionNamed('called'),loop=fn.body[0];
  const {left:{left:first,right:call},right:last}=loop.condition;
  const blocks=fnBody(fn).split(/\n\s*(?=\^bb\d+(?:\([^)]*\))?:\s*\n)/u);
  const header=blocks.find(block=>block.includes('"tsfg_core.domain.presence_equal"')&&block.includes(anchor(first.range)));
  const predicate=blocks.find(block=>block.includes('"func.call"')&&block.includes(anchor(call.range)));
  const lastBlock=blocks.find(block=>block.includes('"tsfg_core.domain.presence_equal"')&&block.includes(anchor(last.range)));
  assert.ok(header&&predicate&&lastBlock);
  assert.deepEqual(blocks.filter(block=>block.includes('"func.call"')),[predicate]);
  assert.equal(branch(header)?.[0],label(predicate));
  assert.equal(branch(predicate)?.[0],label(lastBlock));
  assert.equal(branch(predicate)?.[1],branch(header)?.[1]);
  assert.equal(branch(lastBlock)?.[1],branch(header)?.[1]);
  const guard=plan.expressions.find(row=>row.id===fn.id+'/body/0/body/0/value');
  assert.deepEqual(guard?.presenceProof,{type:sha256('tsfg.type\0undefined'),equal:false,range:last.range});
});

test('an exit that may skip the last guard keeps only the outer proof',()=>{
  const fn=functionNamed('common'),outer=fn.body[0];
  const result=plan.expressions.find(row=>row.id===fn.id+'/body/2/value');
  assert.deepEqual(result?.presenceProof,{type:sha256('tsfg.type\0null'),equal:false,range:outer.condition.range});
  const domain=plan.domains.find(row=>row.id===plan.abi.find(abi=>abi.functionId===fn.id).result);
  assert.deepEqual(domain.actualTypes,['i32','undefined'].map(kind=>sha256('tsfg.type\0'+kind)).sort());
});

test('two short-circuit exits keep the shared outer guard, and only the body gets both',()=>{
  const fn=functionNamed('called'),[loop,fallback]=fn.body;
  const {left:{left:checksNull,right:call},right:checksUndefined}=loop.condition;
  const prior={...checksNull,operator:'==='};
  const condition={...loop.condition,left:checksUndefined,right:call};
  const reads=new Map(),charge=()=>{};
  finiteNormalBody([{kind:'if',condition:prior,then:[fallback],else:[]},
    {...loop,condition},loop.body[0]],'body',fn,{
    flow:finiteNormalFlow(false,charge,new Map()),charge,voidResult:false,
    expression(_value,path,_fn,guards){reads.set(path,guards);return path;},
    binding(_fn,id){return id;},copy(){},
  });
  const binding=checksNull.left.binding;
  const onExit=reads.get('body/2/value').get(binding);
  assert.deepEqual(onExit.range,prior.range);
  assert.equal(onExit.equal,false);
  const inBody=reads.get('body/1/body/0/value').get(binding);
  assert.deepEqual(inBody.range,checksUndefined.range);
  assert.equal(inBody.previous,onExit);
});
