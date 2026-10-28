// SPDX-License-Identifier: MIT
// Pure compact formatting of independent Source/spec oracle rawSHA256
// a74b1af2b8ac50dea556ec04ade46130d0bdb09047cbea6d36e885e6ffdac35a.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256} from '../../compiler/identity.mjs';
import expected from './testdata/typed-array-entry/universal-definition-abi-expected.json' with {type:'json'};

test('universal definition ABI matches all independently derived Source slots and physical bounds',async t=>{
  const expectedDomains=new Map(expected.domains.map(row=>[row.domainId,row]));
  let definitions=0,parameters=0,results=0;const observedDomains=new Set();
  for(const input of expected.caseInputs)await t.test(input.case,async()=>{
    const bytes=await readFile(new URL('../../'+input.packetPath,import.meta.url));
    assert.equal(bytes.length,input.packetBytes);assert.equal(sha256(bytes).slice(7),input.packetSHA256);
    const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
      factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
    assert.equal(built.status,'ok');const plan=buildFiniteCoreDomains(built.hir,context).definition,
      rows=expected.rows.filter(row=>row.case===input.case),domains=new Map(plan.domains.map(row=>[row.id,row]));
    assert.deepEqual(plan.abi.map(row=>row.functionId).sort(),rows.map(row=>row.functionId).sort());
    function slot(id,domainId) {
      assert.equal(id,domainId);observedDomains.add(id);const actual=domains.get(id),gold=expectedDomains.get(domainId);assert.ok(actual&&gold);
      for(const field of expected.comparison.comparePerSlot.filter(field=>field!=='domainId'))
        assert.deepEqual(actual[field],gold[field],input.case+' '+domainId+' '+field);
    }
    for(const row of rows) {
      const actual=plan.abi.find(value=>value.functionId===row.functionId);
      assert.deepEqual({parameters:actual.parameters,result:actual.result,id:actual.id},row.abi,row.entity);
      row.parameters.forEach((parameter,index)=>{slot(actual.parameters[index],parameter.domainId);parameters++;});
      if(row.result!==null){slot(actual.result,row.result);results++;}else assert.equal(actual.result,null);
      definitions++;
    }
  });
  assert.deepEqual({definitions,parameters,results},{definitions:22,parameters:29,results:11});
  assert.deepEqual([...observedDomains].sort(),[...expectedDomains.keys()].sort());
});
