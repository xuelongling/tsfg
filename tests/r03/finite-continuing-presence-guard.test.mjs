// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {finiteNormalBody,finiteNormalFlow} from '../../compiler/finite-numeric-use.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-continuing-presence-guard/package.json',import.meta.url));
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir;
const plan=buildFiniteCoreDomains(hir,context).definition;
const functions=new Map(hir.functions.map(fn=>[fn.name,fn]));

for(const [name,absence] of [['presentAfterReturn','undefined'],['presentElseReturns','null'],['nestedReturn','undefined']]) {
  test(`checked ${name} narrows the value on the only continuing path`,()=>{
    const fn=functions.get(name);
    let condition=fn.body[0].condition;
    while(condition.kind==='group')condition=condition.operand;
    const use=plan.expressions.find(row=>row.id===fn.id+'/body/1/value');
    assert.deepEqual(use.presenceProof,{type:sha256('tsfg.type\0'+absence),equal:false,range:condition.range});
  });
}

test('writes and two continuing arms do not carry a stale presence guard',()=>{
  for(const name of ['reassignedAfterGuard','bothRewrite']) {
    const fn=functions.get(name),row=fn.body.length-1;
    const use=plan.expressions.find(item=>item.id===fn.id+'/body/'+row+'/value');
    assert.equal(use.kind,'reference');
    assert.equal(use.presenceProof,undefined);
  }
});

function guardsAtExpressions(fn,body) {
  const seen=new Map(),charge=()=>{};
  finiteNormalBody(body,'body',fn,{flow:finiteNormalFlow(false,charge,new Map()),charge,voidResult:false,
    expression(_value,path,_fn,guards){seen.set(path,guards);return path;},
    binding(_fn,id){return id;},copy(){}});
  return seen;
}

test('the same guard survives an unchanged join and loop',()=>{
  const fn=functions.get('presentAfterReturn');
  const condition={kind:'boolean',value:false},use={kind:'expression',expression:fn.body[1].value};
  const seen=guardsAtExpressions(fn,[fn.body[0],{kind:'if',condition,then:[],else:[]},use,
    {kind:'while',condition,body:[]},fn.body[1]]);
  assert.ok(seen.get('body/2/expression').has(fn.parameters[0].id));
  assert.ok(seen.get('body/4/value').has(fn.parameters[0].id));
});

test('a continuing block retains no guard for its local binding outside its scope',()=>{
  const fn=functions.get('reassignedAfterGuard');
  const local=fn.body[0],guard=fn.body[1],use=fn.body.at(-1).value;
  const seen=guardsAtExpressions(fn,[{kind:'block',body:[local,guard,{kind:'expression',expression:use}]},
    {kind:'expression',expression:local.initializer}]);
  assert.ok(seen.get('body/0/body/2/expression').has(local.binding.id));
  assert.equal(seen.get('body/1/expression').size,0);
});

test('the continuation refines the same SSA value tested on the incoming edge',()=>{
  const core=lowerFormalHir(hir,context);
  const functionBody=name=>core.split('  func.func @"f'+functions.get(name).id.slice(7)+'"')[1].split('\n  }')[0];
  for(const name of ['presentAfterReturn','presentElseReturns','nestedReturn']) {
    const body=functionBody(name);
    const tested=/"tsfg_core\.domain\.presence_equal"\((%\w+), %\w+\)/u.exec(body);
    const refine=/"tsfg_core\.domain\.refine"\((%\w+)\)/u.exec(body);
    assert.ok(tested&&refine,name);
    assert.equal(refine[1],tested[1]);
    const join=/cf\.br (\^bb\d+) \{tsfg_source\.start =/u.exec(body);
    assert.ok(join,name);
    assert.ok(body.indexOf(refine[0])>body.indexOf(join[1]+':'),name);
  }
  const rewritten=functionBody('bothRewrite');
  assert.doesNotMatch(rewritten,/"tsfg_core\.domain\.refine"/u);
  const carried=[...rewritten.matchAll(/cf\.br (\^bb\d+)\(([^)]+)\) \{/gu)];
  assert.equal(carried.length,2);
  assert.equal(carried[0][1],carried[1][1]);
  const [yes,no]=carried.map(row=>row[2].split(':',1)[0].trim().split(', '));
  assert.equal(yes.length,2);
  assert.equal(no.length,2);
  assert.equal(yes[0],no[0],'an unrelated binding keeps the existing join parameter');
  assert.notEqual(yes[1],no[1],'different incoming definitions remain distinct');
});
