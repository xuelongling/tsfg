// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {finiteNormalBody,finiteNormalFlow} from '../../compiler/finite-numeric-use.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-loop-own-guard/package.json',import.meta.url));
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir;
const functions=new Map(hir.functions.map(fn=>[fn.name,fn]));
const plan=buildFiniteCoreDomains(hir,context).definition;
const cases=/** @type {const} */ ([
  ['fillsAbsent','undefined',0,'1/value',2],
  ['fillsNull','null',0,'1/value',2],
  ['readsThenClears','undefined',1,'1/body/0/expression/value',1],
]);

function comparison(condition) {
  while(condition.kind==='group')condition=condition.operand;
  return condition;
}

for(const [name,absence,index,use] of cases) {
  test(`checked ${name} carries the current loop test to its selected edge`,()=>{
    const fn=functions.get(name),loop=fn.body[index];
    const result=plan.expressions.find(row=>row.id===fn.id+'/body/'+use);
    assert.deepEqual(result.presenceProof,{
      type:sha256('tsfg.type\0'+absence),equal:false,range:comparison(loop.condition).range});
  });
}

function guardsAtExpressions(fn,body) {
  const seen=new Map(),charge=()=>{};
  finiteNormalBody(body,'body',fn,{flow:finiteNormalFlow(false,charge,new Map()),charge,voidResult:false,
    expression(_value,path,_fn,guards){seen.set(path,guards);return path;},
    binding(_fn,id){return id;},copy(){}});
  return seen;
}

test('a write discards the loop guard for the next use in the same body',()=>{
  const fn=functions.get('readsThenClears'),[local,loop,result]=fn.body,binding=fn.parameters[0].id;
  const read=loop.body[0].expression.value;
  const observed=guardsAtExpressions(fn,[local,{...loop,body:[...loop.body,{kind:'expression',expression:read}]},result]);
  assert.equal(observed.get('body/1/body/0/expression').get(binding).equal,false);
  assert.equal(observed.get('body/1/body/2/expression').has(binding),false);
});

test('an existing proof for the same binding remains the authority across a stable loop comparison',()=>{
  const fn=functions.get('fillsAbsent'),[loop,returned]=fn.body,binding=fn.parameters[0].id;
  const outer={kind:'if',condition:{...comparison(loop.condition),range:{start:0,end:1}},
    then:[{kind:'return'}],else:[]};
  const read={kind:'expression',expression:returned.value};
  const observed=guardsAtExpressions(fn,[outer,{...loop,body:[read]},returned]);
  const entry=observed.get('body/1/condition').get(binding);
  assert.equal(entry.equal,false);
  assert.deepEqual(entry.range,outer.condition.range);
  assert.equal(observed.get('body/1/body/0/expression').get(binding),entry);
  assert.equal(observed.get('body/2/value').get(binding),entry);
});

test('the selected loop edge refines the same header SSA tested in the original comparison',()=>{
  const core=lowerFormalHir(hir,context);
  const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
  for(const [name,,index,,selected] of cases) {
    const fn=functions.get(name),loop=fn.body[index];
    const text=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
    const tested=/(%\w+) = "tsfg_core\.domain\.presence_equal"\((%\w+), %\w+\)[^\n]+/u.exec(text);
    const refine=/"tsfg_core\.domain\.refine"\((%\w+)\)/u.exec(text);
    const args=/^\s*\^bb\d+\(([^)]*)\):\r?\n\s*"tsfg_core\.fuel"\(\) \{event = 2 :/mu.exec(text);
    const branch=/cf\.cond_br (%\w+), (\^\w+), (\^\w+)[^\n]*/u.exec(text);
    assert.ok(tested&&refine&&args&&branch,name);
    assert.ok(args[1].split(', ').some(arg=>arg.startsWith(tested[2]+': ')),name);
    assert.equal(refine[1],tested[2],name);
    assert.ok(tested[0].includes(anchor(comparison(loop.condition).range)),name);
    assert.ok(branch[0].includes(anchor(loop.condition.range)),name);
    const views=new Map([...text.matchAll(/(%\w+) = "tsfg_core\.domain\.view"\((%\w+)\)[^\n]* : \(i1\) -> i1$/gmu)]
      .map(row=>[row[1],row[2]]));
    let predicate=branch[1];
    while(views.has(predicate))predicate=views.get(predicate);
    assert.equal(predicate,tested[1],name);
    const block=text.slice(0,refine.index).split('\n').filter(line=>/^\s*\^bb/u.test(line)).at(-1);
    assert.equal(block.trimStart().split(/[(:]/u)[0],branch[selected+1],name);
  }
});
