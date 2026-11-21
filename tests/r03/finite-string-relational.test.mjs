// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';

test('official String relational facts lower via UTF-16 comparison then signed i32 against zero',async()=>{
  const factsBytes=await readFile(new URL('./testdata/typed-array-string-relational/source-package.json',import.meta.url));
  assert.equal(sha256(factsBytes),'sha256:e413251facbdf0d3681bf1605316397e8a09b6a7164d65ec3fc1bdb17369a2f3');
  const facts=readTypedArrayFacts(factsBytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);
  assert.equal(built.status,'ok');
  const {hir}=built;
  const core=lowerFormalHir(hir,context);
  for(const [name,operator] of [['less','lt'],['atMost','le'],['greater','gt'],['atLeast','ge'],['order','lt']]){
    const fn=hir.functions.find(row=>row.name===name);
    assert.ok(fn,name);
    const start=core.indexOf('func.func @"f'+fn.id.slice(7)+'"');
    assert.ok(start>=0,name);
    const end=core.indexOf('func.func @',start+1),body=core.slice(start,end<0?undefined:end);
    const compare=body.match(/(%\w+) = "tsfg_string\.compare"\(([^)]+)\).+ : \(!tsfg_string\.string, !tsfg_string\.string\) -> i32/u);
    assert.ok(compare,name);
    const zero=body.match(/(%\w+) = "tsfg_core\.constant"\(\) \{value = 0 : i32,.+-> i32/u);
    assert.ok(zero,name);
    assert.match(body,new RegExp('"tsfg_core\\.'+operator+'"\\('+compare[1]+', '+zero[1]+'\\).+ : \\(i32, i32\\) -> i1','u'));
    assert.ok(compare.index<zero.index,name);
    const range=fn.body[0].value.range;
    assert.ok(compare[0].includes('tsfg_source.start = '+range.start+' : i64, tsfg_source.end = '+range.end+' : i64'),name);
    if(name==='order'){
      assert.match(body,/array<i32: 55296, 56320>/u);
      assert.match(body,/array<i32: 57344>/u);
    } else {
      const parameters=body.slice(0,body.indexOf(')')).match(/%\w+(?=: !tsfg_string\.string)/gu);
      assert.deepEqual(compare[2].split(', '),parameters,name);
    }
  }
});
