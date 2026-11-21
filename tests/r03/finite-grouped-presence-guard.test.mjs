// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const bytes=await readFile(new URL('./testdata/finite-grouped-presence-guard/package.json',import.meta.url));
const facts=readTypedArrayFacts(bytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir;
const definition=buildFiniteCoreDomains(hir,context).definition;
const functions=new Map(hir.functions.map(fn=>[fn.name,fn]));

for(const [name,arm,absence,groups] of [
  ['plainUndefined','then','undefined',0],
  ['groupedUndefined','then','undefined',2],
  ['groupedNull','else','null',2],
]) {
  test(`owned ${name} returns the present payload on the selected Source edge`,()=>{
    const fn=functions.get(name);
    let condition=fn.body[0].condition,depth=0;
    while(condition.kind==='group'){condition=condition.operand;depth++;}
    assert.equal(depth,groups);
    assert.equal(condition.kind,'binary');
    assert.equal(condition.operator,arm==='then'?'!==':'===');
    assert.equal(condition.right.kind,absence);
    const proof=definition.expressions.find(row=>row.id===fn.id+'/body/0/'+arm+'/0/value');
    assert.deepEqual(proof.presenceProof,{
      type:sha256('tsfg.type\0'+absence),equal:false,range:condition.range});
  });
}

test('assignment inside a grouped condition arm still discards the incoming guard',()=>{
  const fn=functions.get('groupedReassigned');
  const use=definition.expressions.find(row=>row.id===fn.id+'/body/1/then/1/value');
  assert.equal(use.kind,'reference');
  assert.equal(use.presenceProof,undefined);
});

test('each emitted presence refinement binds to the inner comparison and its actual branch',()=>{
  const core=lowerFormalHir(hir,context);
  const functionBody=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
  for(const [name,selected] of /** @type {const} */ ([['plainUndefined',0],['groupedUndefined',0],['groupedNull',1]])) {
    const fn=functions.get(name);
    const lines=functionBody(fn).split('\n');
    const predicate=lines.find(line=>line.includes('"tsfg_core.domain.presence_equal"'));
    const refine=lines.find(line=>line.includes('"tsfg_core.domain.refine"'));
    const branchLine=lines.find(line=>line.includes('cf.cond_br'));
    const branch=/cf\.cond_br (%\w+), (\^\w+), (\^\w+)/u.exec(branchLine);
    assert.ok(predicate&&refine&&branch);
    const outer=fn.body[0].condition;
    let inner=outer,depth=0;
    while(inner.kind==='group'){inner=inner.operand;depth++;}
    const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
    assert.ok(predicate.includes(anchor(inner.range)));
    assert.ok(branchLine.includes(anchor(outer.range)));
    assert.ok(refine.includes(`\\"range\\":{\\"end\\":${inner.range.end},\\"start\\":${inner.range.start}}`));
    const views=new Map(lines.flatMap(line=>{
      const view=/(%\w+) = "tsfg_core.domain.view"\((%\w+)\).* : \(i1\) -> i1$/u.exec(line);
      return view?[[view[1],view[2]]]:[];
    }));
    let condition=branch[1],hops=0;
    while(views.has(condition)){condition=views.get(condition);hops++;}
    assert.equal(hops,depth);
    assert.equal(condition,predicate.trimStart().split(' ')[0]);
    assert.equal(lines.slice(0,lines.indexOf(refine)).filter(line=>/^\s*\^bb/u.test(line)).at(-1).trimStart().split(/[(:]/u)[0],
      branch[selected+2]);
    assert.ok(refine.endsWith(' -> i32'));
  }
  assert.doesNotMatch(functionBody(functions.get('groupedReassigned')),/"tsfg_core\.domain\.refine"/u);
});
