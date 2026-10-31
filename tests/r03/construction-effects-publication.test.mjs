// SPDX-License-Identifier: MIT
// Existing fixed facts are read and validated; no frontend aggregate is
// generated, restamped or published, and no Core/Runtime/VM is constructed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';

test('existing safe-lastuse full facts author a complete publication within the original default effects budget',()=>{
  const facts=readCommonProgramFacts(readFileSync(new URL('./testdata/common-readspan-closures/safe-lastuse.json',import.meta.url))),
    hir=projectCommonProgram(facts),publication=createCommonProgramPublication(hir);
  assert.equal(hir.functions.length,13);
  assert.equal(hir.types.filter(type=>type.construction?.kind==='implicit-base').length,2);
  assert.equal(publication.mode,'fixed');assert.equal(publication.contracts.length,13);
  assert.deepEqual(publication.contracts.map(row=>row.functionId),hir.functions.map(row=>row.id));
  assert.equal(publication.contracts.some(row=>row.functionId.startsWith('analysis-construction:')),false);
  for(const [index,row]of publication.contracts.entries())assert.equal(row.signatureHash,hir.functions[index].signatureHash);
});

for(const name of ['later-use-conflict','never-called','mutable-safe','mutable-conflict','parameter-safe','parameter-conflict','parameter-index1-conflict','consumer-safe-index1'])
  test('existing '+name+' full facts author a complete publication without changing the original budget',()=>{
    const facts=readCommonProgramFacts(readFileSync(new URL('./testdata/common-readspan-closures/'+name+'.json',import.meta.url))),
      hir=projectCommonProgram(facts),publication=createCommonProgramPublication(hir);
    assert.equal(publication.mode,'fixed');assert.equal(publication.contracts.length,hir.functions.length);
    assert.deepEqual(publication.contracts.map(row=>row.functionId),hir.functions.map(row=>row.id));
    assert.equal(publication.contracts.some(row=>row.functionId.startsWith('analysis-construction:')),false);
    for(const [index,row]of publication.contracts.entries())assert.equal(row.signatureHash,hir.functions[index].signatureHash);
  });
