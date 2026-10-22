// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import expected from './testdata/typed-array-entry/universal-definition-abi-expected.json' with {type:'json'};

test('ordinary Core carries every independent Source callable and its ordered binding/type contract',async t=>{
  let count=0,parameters=0;
  for(const input of expected.caseInputs)await t.test(input.case,async()=>{
    const bytes=await readFile(new URL('../../'+input.packetPath,import.meta.url));
    assert.equal(sha256(bytes).slice(7),input.packetSHA256);
    const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
      factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
    assert.equal(built.status,'ok');
    const text=lowerFormalHir(built.hir,context),attribute=/tsfg_core\.callable_contracts = ("(?:[^"\\]|\\.)*")/.exec(text);
    assert.ok(attribute,'real Core module header, not detached metadata');
    const raw=JSON.parse(attribute[1]),rows=JSON.parse(raw),gold=expected.rows.filter(row=>row.case===input.case);
    assert.equal(raw,canonical(rows));assert.deepEqual(rows.map(row=>row.id),gold.map(row=>row.functionId).sort());
    for(const row of rows) {
      const oracle=gold.find(value=>value.functionId===row.id);
      assert.equal(row.signatureHash,oracle.sourceSignature.signatureHash);
      assert.deepEqual(row.parameters.map(({id,type})=>({id,type})),oracle.parameters.map(value=>({id:value.binding,type:value.declaredOwnedType})));
      assert.ok(text.includes('tsfg_core.function_id = "'+row.id+'"'));
      assert.ok(built.hir.sources.some(source=>source.path===row.sourcePath&&row.range.start>=0&&row.range.end<=source.content.length));
      if(row.role==='construction-body') {
        assert.equal(row.construction,oracle.constructionId);assert.equal(oracle.abi.result,null);
        assert.equal(row.parameters[0].type,row.ownerType);
      }
      parameters+=row.parameters.length;count++;
    }
  });
  assert.deepEqual({count,parameters},{count:22,parameters:29});
});
