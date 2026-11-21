// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {finiteNormalBody,finiteNormalFlow} from '../../compiler/finite-numeric-use.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-loop-presence-guard/package.json',import.meta.url));
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir;
const functions=new Map(hir.functions.map(fn=>[fn.name,fn]));
const plan=buildFiniteCoreDomains(hir,context).definition;

for(const name of ['stableLoop','conditionReads']) {
  test(`checked ${name} keeps the presence guard for a binding the loop never writes`,()=>{
    const fn=functions.get(name),guard=fn.body[0].condition;
    const proof={type:sha256('tsfg.type\0undefined'),equal:false,range:guard.range};
    assert.deepEqual(plan.expressions.find(row=>row.id===fn.id+'/body/2/value').presenceProof,proof);
    if(name==='conditionReads') {
      const uses=plan.expressions.filter(row=>row.id.startsWith(fn.id+'/body/1/condition/')&&row.kind==='reference');
      assert.equal(uses.filter(row=>row.presenceProof).length,1);
      assert.deepEqual(uses.find(row=>row.presenceProof).presenceProof,proof);
    }
  });
}

test('a possible loop write removes the incoming presence guard',()=>{
  const fn=functions.get('loopMayRewrite');
  const uses=plan.expressions.filter(row=>row.id.startsWith(fn.id+'/body/3/')&&row.kind==='reference');
  assert.ok(uses.length);
  assert.ok(uses.every(row=>row.presenceProof===undefined));
});

function loopGuardUses(fn,body) {
  const observed=new Map(),charge=()=>{};
  finiteNormalBody(body,'body',fn,{flow:finiteNormalFlow(false,charge,new Map()),charge,voidResult:false,
    expression(_value,path,_fn,guards){observed.set(path,guards);return path;},
    binding(_fn,id){return id;},copy(){}});
  return observed;
}

test('condition, body and exit can use the inherited guard until a condition write invalidates it',()=>{
  const fn=functions.get('stableLoop'),binding=fn.parameters[0].id,read=fn.body[2].value;
  const condition={kind:'assignment',target:{binding},value:{kind:'undefined'}};
  const loop={kind:'while',condition,body:[{kind:'expression',expression:read}]};
  const uses=['body/1/condition','body/1/body/0/expression','body/2/value'];
  const unchanged=loopGuardUses(fn,[fn.body[0],{...loop,condition:fn.body[1].condition},fn.body[2]]);
  assert.ok(uses.every(path=>unchanged.get(path).has(binding)));
  const observed=loopGuardUses(fn,[fn.body[0],loop,fn.body[2]]);
  assert.ok(uses.every(path=>!observed.get(path).has(binding)));
});

test('a guard proved inside the body stays inside the body',()=>{
  const fn=functions.get('stableLoop'),binding=fn.parameters[0].id,read=fn.body[2].value;
  const loop={kind:'while',condition:{kind:'boolean',value:false},body:[
    fn.body[0],{kind:'expression',expression:read}]};
  const observed=loopGuardUses(fn,[loop,fn.body[2]]);
  assert.ok(observed.get('body/0/body/1/expression').has(binding));
  assert.equal(observed.get('body/1/value').size,0);
});

test('loop refinement uses the original SSA operand and the header retains mutable carriers',()=>{
  const core=lowerFormalHir(hir,context);
  const body=name=>core.split('  func.func @"f'+functions.get(name).id.slice(7)+'"')[1].split('\n  }')[0];
  for(const name of ['stableLoop','conditionReads']) {
    const text=body(name);
    const compared=/"tsfg_core\.domain\.presence_equal"\((%\w+), %\w+\)/u.exec(text);
    assert.ok(compared,name);
    const origin=compared[1],refinements=[...text.matchAll(/"tsfg_core\.domain\.refine"\((%\w+)\)/gu)];
    assert.equal(refinements.length,name==='conditionReads'?2:1,name);
    assert.ok(refinements.every(row=>row[1]===origin),name);
    const header=/^\s*(\^bb\d+)\([^)]*\):\r?\n\s*"tsfg_core\.fuel"\(\) \{event = 2 :/mu.exec(text);
    assert.ok(header,name);
    const edges=[...text.matchAll(/cf\.br (\^bb\d+)\(([^)]+)\) \{tsfg_source\.start = /gu)].filter(row=>row[1]===header[1]);
    assert.equal(edges.length,2,name);
    const [entry,back]=edges;
    assert.match(entry[2],/^%\w+ : i1$/u);
    assert.match(back[2],/^%\w+ : i1$/u);
    assert.notEqual(entry[2],back[2],name);
  }
});
