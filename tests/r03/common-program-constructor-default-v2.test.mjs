// SPDX-License-Identifier: MIT
// Qualified original Source2 bytes remain a separate external contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,printCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {commonProgramPlan} from '../../compiler/common-program-plan.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';

test('the qualified original Source2 contract keeps its bytes and semantic identities',async()=>{
  const bytes=await fs.readFile(new URL('./common-program-m12-witness-forward.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:afd0be537e1412223cd9954f9144358001d80e4e8f5bd3af9b1c3cbfaba94b48');
  const facts=readCommonProgramFacts(bytes),hir=projectCommonProgram(facts);
  assert.equal(facts.version,2);assert.equal(hir.format.version,2);
  const previousFunctions=hir.functions.map(({methodMinimumArgumentCount,...fn})=>{
    assert.equal(methodMinimumArgumentCount,null);
    return fn;
  });
  // The inverse matches the complete projection frozen from the 77f0330 reader.
  assert.equal(sha256(canonical({...hir,functions:previousFunctions})+'\n'),'sha256:fb9f4888b3f95eb779257173915548439b9dc624044aeec033dceed834ff40f5');
  assert.equal(sha256(printCommonProgramHir(hir)),'sha256:2ca50e4af6268fb5342a72e521eb8d242c0185d4c1031e3dc8f9e30d997643da');
  assert.ok(commonProgramPlan(hir).plans.length>=10);
});
