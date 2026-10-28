// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import capture from './testdata/typed-array-entry/void-return.json' with {type:'json'};

test('actual ordinary void return evaluates its original call exactly once before zero-result return',async t=>{
  for(const sample of capture.cases)await t.test(sample.name,async()=>{
    const bytes=await readFile(new URL('./testdata/typed-array-entry/'+sample.file,import.meta.url));
    assert.equal(bytes.length,sample.packageBytes);assert.equal(sha256(bytes).slice(7),sample.packageSHA256);
    const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
      factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
    assert.equal(built.status,'ok');const hir=built.hir,run=hir.functions.find(fn=>fn.name==='run'),
      effect=hir.functions.find(fn=>fn.name==='effect'),statement=run.body[0];
    assert.equal(statement.kind,'return');assert.equal(statement.value.kind,'call');
    assert.equal(statement.value.target,effect.id);
    const core=lowerFormalHir(hir,context),symbol='f'+run.id.slice(7),
      body=core.split('  func.func @"'+symbol+'"')[1].split('\n  }')[0],
      calls=body.split('\n').filter(line=>line.includes('"func.call"')),
      returns=body.split('\n').filter(line=>line.includes('"func.return"'));
    assert.equal(calls.length,1);assert.equal(returns.length,1);
    assert.ok(calls[0].includes('callee = @"f'+effect.id.slice(7)+'"'));
    assert.match(calls[0],/^\s+"func.call"\(/,'void call has no fabricated SSA result');
    assert.match(returns[0],/"func.return"\(\).*: \(\) -> \(\)/);
    assert.ok(body.indexOf(calls[0])<body.indexOf(returns[0]));
    for(const [line,range] of [[calls[0],statement.value.range],[returns[0],statement.range]]) {
      assert.ok(line.includes('tsfg_source.start = '+range.start+' : i64'));
      assert.ok(line.includes('tsfg_source.end = '+range.end+' : i64'));
    }
    if(sample.arrayEffect) {
      const effectBody=core.split('  func.func @"f'+effect.id.slice(7)+'"')[1].split('\n  }')[0];
      assert.equal(effectBody.split('"tsfg_core.domain.array_read"').length-1,1);
      assert.equal(effectBody.split('"tsfg_core.domain.array_store"').length-1,1);
      assert.ok(effectBody.indexOf('"tsfg_core.domain.array_read"')<effectBody.indexOf('"tsfg_core.domain.array_store"'));
    }
  });
});
