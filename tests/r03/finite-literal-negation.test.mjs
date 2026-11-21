// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const factsBytes=await readFile(new URL('./testdata/finite-literal-negation/package.json',import.meta.url));
const facts=readTypedArrayFacts(factsBytes);
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const {hir}=built;
const plan=buildFiniteCoreDomains(hir,context).definition;
const functions=new Map(hir.functions.map(fn=>[fn.name,fn]));
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;

for(const name of ['arrayIf','arrayWhile','arrayShort','arrayFlag']) {
  test(`${name} keeps only reachable Array versions at the return`,()=>{
    const fn=functions.get(name);
    assert.ok(fn);
    const {reads,writes}=plan.arrayReaching;
    const local=writes.filter(row=>row.node.startsWith(fn.id+'/body/'));
    assert.equal(local.length,2);
    const selected=reads.find(row=>row.node===fn.id+'/body/2/value');
    assert.equal(selected?.status,'proven');
    const expected=local.filter(row=>name==='arrayFlag'||row.kind==='initial').map(row=>row.id).sort();
    assert.deepEqual(selected.versions,expected);
  });
}

test('field read keeps the first write when the second is unreachable',()=>{
  const fn=functions.get('fieldIf');
  assert.ok(fn);
  const {reads,writes}=plan.fieldReaching;
  assert.equal(fn.body[1].then[0].expression.kind,'fieldAssignment');
  const local=writes.filter(row=>row.node.startsWith(fn.id+'/body/'));
  assert.equal(local.length,2);
  assert.ok(local[0].node.startsWith(fn.id+'/body/0/'));
  const selected=reads.find(row=>row.node===fn.id+'/body/2/value');
  assert.deepEqual(selected?.reaching.flatMap(row=>row.versions),[local[0].id]);
});

test('Core uses anchored literals for known negation and keeps dynamic negation',()=>{
  const core=lowerFormalHir(hir,context);
  for(const name of ['arrayIf','arrayWhile','arrayShort','arrayFlag','fieldIf']) {
    const fn=functions.get(name);
    const statement=fn.body[1];
    const condition=name==='arrayShort'?statement.expression.left:statement.condition;
    const text=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
    if(name==='arrayFlag'){
      assert.ok(text.split('\n').some(line=>line.includes('"tsfg_core.bool_not"')&&line.includes(anchor(condition.range))));
    }else{
      const expected=name==='arrayShort'?1:0;
      const literal=text.split('\n').find(line=>line.includes('"tsfg_core.constant"')&&
        line.includes(`value = ${expected} : i1`)&&line.includes(anchor(condition.range)));
      assert.ok(literal);
      const result=/(%\w+) = "tsfg_core\.constant"/u.exec(literal)[1];
      assert.ok(text.includes('cf.cond_br '+result+','));
    }
  }
});
