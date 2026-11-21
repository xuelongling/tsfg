// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {finiteNormalBody,finiteNormalFlow} from '../../compiler/finite-numeric-use.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-stacked-presence/package.json',import.meta.url));
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir;
const functions=new Map(hir.functions.map(fn=>[fn.name,fn]));
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
function comparison(condition) {
  while(condition.kind==='group')condition=condition.operand;
  return condition;
}

const cases=/** @type {const} */ ([
  ['nested',['undefined','null']],['early',['null','undefined']],['single',['undefined']],['written',[]],
]);
for(const [name,absence] of cases) {
  test(`checked Source preserves the actual presence operands in ${name}`,()=>{
    const fn=functions.get(name);
    assert.ok(fn);
    const text=lowerFormalHir(hir,context).split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
    const comparisons=[...text.matchAll(/"tsfg_core\.domain\.presence_equal"\((%\w+), %\w+\)[^\n]*/gu)];
    const refines=[...text.matchAll(/(%\w+) = "tsfg_core\.domain\.refine"\((%\w+)\)[^\n]*presence_proof = ("(?:\\.|[^"\\])*")[^\n]* -> ([^\n]+)/gu)];
    assert.equal(refines.length,absence.length);
    assert.equal(comparisons.length,name==='nested'||name==='early'?2:1);
    const conditions=name==='nested'?[fn.body[0].condition,fn.body[0].then[0].condition]
      :name==='early'?[fn.body[0].condition,fn.body[1].condition]:[fn.body[name==='single'?0:1].condition];
    for(const [index,matched] of comparisons.entries()) {
      const range=comparison(conditions[index]).range;
      assert.ok(matched[0].includes(anchor(range)));
      if(index>=refines.length)continue;
      assert.equal(refines[index][2],matched[1]);
      assert.deepEqual(JSON.parse(JSON.parse(refines[index][3])),
        {equal:false,range,type:sha256('tsfg.type\0'+absence[index])});
    }
    if(refines.length)assert.equal(refines.at(-1)[4],'i32');
    if(refines.length===2)assert.equal(comparisons[1][1],refines[0][1]);
  });
}

test('a stable loop can combine a second absence test and a backedge write clears the first',()=>{
  const fn=functions.get('early'),[first,second,returned]=fn.body,binding=fn.parameters[0].id;
  const assignment=functions.get('written').body[1].then[0].expression;
  const write={kind:'expression',expression:{...assignment,target:{...assignment.target,binding}}};
  const loop={kind:'while',condition:second.condition,body:[]};
  const observed=body=>{
    const guards=new Map(),charge=()=>{};
    finiteNormalBody(body,'body',fn,{flow:finiteNormalFlow(false,charge,new Map()),charge,voidResult:false,
      expression(_value,path,_fn,active){guards.set(path,active.get(binding));return path;},
      binding(_fn,id){return id;},copy(){}});
    return guards;
  };
  const stable=observed([first,loop,returned]);
  assert.equal(stable.get('body/1/condition').type,sha256('tsfg.type\0null'));
  assert.equal(stable.get('body/2/value').type,sha256('tsfg.type\0undefined'));
  assert.equal(stable.get('body/2/value').excluded,stable.get('body/1/condition').type);
  const written=observed([first,{...loop,body:[write]},returned]);
  assert.equal(written.get('body/1/condition'),undefined);
  assert.equal(written.get('body/2/value').excluded,undefined);
});
