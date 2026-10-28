// SPDX-License-Identifier: MIT
// Independent Source/spec oracle e8f1073d17d4ccab3a32b2fc0509b84d61e8d6276cf26e351269100a5dcb07ca.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {finiteCallables} from '../../compiler/finite-callables.mjs';
import {sha256} from '../../compiler/identity.mjs';
import expected from './testdata/typed-array-entry/whole-callable-effects-expected.json' with {type:'json'};

function attribute(line,key) {
  const value=new RegExp(key+' = ("(?:[^"\\\\]|\\\\.)*")').exec(line);
  assert.ok(value,key);return JSON.parse(value[1]);
}
test('ordinary finite producer retains the independent whole callable effect and selected-callee closure',async t=>{
  let definitions=0,edges=0,directWrites=0,requiredWrites=0;
  for(const sample of expected.cases)await t.test(String(sample.input),async()=>{
    const input=expected.inputs[sample.input],bytes=await readFile(new URL('../../'+input.path,import.meta.url));
    assert.equal(sha256(bytes).slice(7),input.packageSHA256);
    const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
      factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
    const hir=built.hir,callables=finiteCallables(hir),plan=buildFiniteCoreDomains(hir,context).definition,core=lowerFormalHir(hir,context),
      constructors=new Map(callables.filter(fn=>fn.role==='construction-body').map(fn=>[fn.construction,fn.id]));
    assert.deepEqual(callables.map(fn=>fn.id).sort(),sample.callables.map(fn=>fn.id).sort());
    for(const row of sample.callables) {
      const fn=callables.find(fn=>fn.id===row.id);assert.equal(fn.role??'function',row.role);
      const body=core.split('  func.func @"f'+row.id.slice(7)+'"')[1].split('\n  }')[0],callees=new Set();
      for(const line of body.split('\n')) {
        if(line.includes('"func.call"'))callees.add(attribute(line,'tsfg_core.function_id'));
        else if(line.includes('"tsfg_core.domain.method_call"'))for(const target of JSON.parse(attribute(line,'dispatch')))callees.add(target.functionId);
        else if(line.includes('"tsfg_core.domain.construct"')||line.includes('"tsfg_core.domain.super"')) {
          const target=constructors.get(attribute(line,'construction'));assert.ok(target);callees.add(target);
        }
      }
      assert.deepEqual([...callees].sort(),row.callees);
      const writes=/"tsfg_core\.domain\.field_(?:store|define|initialize)"/.test(body);
      assert.equal(writes,row.directWritesFields,row.id);
      const summary=plan.fieldReaching.effects.find(effect=>effect.functionId===row.id);assert.ok(summary);
      if(row.writesFields)assert.equal(summary.writesFields,true,'producer cannot omit a required field write');
      // The old Source effect ledger conservatively treats constructor markers
      // as barriers. This test does not invent exact C++ execution from it.
      definitions++;edges+=callees.size;directWrites+=Number(writes);requiredWrites+=Number(row.writesFields);
    }
  });
  assert.deepEqual({definitions,edges,directWrites,requiredWrites},{definitions:16,edges:7,directWrites:6,requiredWrites:7});
  assert.equal(expected.counts.memoryExpectations,17,'independent unexecuted memory boundaries remain explicit');
});
