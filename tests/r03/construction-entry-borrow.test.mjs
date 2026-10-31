// SPDX-License-Identifier: MIT
// Typed normalized compiler graphs; not official Frontend or Runtime inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {readspanConstructionThrowModel} from './common-program-readspan-closure-models.mjs';
import {commonBorrowConstructorModel} from './common-program-borrow-models.mjs';
test('construction throw retains captured local owner obligations',()=>{
  const {program,records}=readspanConstructionThrowModel();
  assert.throws(()=>analyzeCommonGraphs(program,records),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-borrow-pending');
});
test('normalized construction receiver entry is analyzed, not vacuously accepted',()=>{
  const {program,records}=commonBorrowConstructorModel();
  const result=analyzeCommonGraphs(program,records);
  const entries=[...result.actual.contexts.values()].filter(c=>c.root&&c.plan.owner.id==='entry');
  assert.equal(entries.length,1);
  assert.equal(entries[0].normal,true);
});
test('catalogued construction entry is seeded exactly once per new_target',()=>{
  const {program,records}=commonBorrowConstructorModel();
  Object.assign(program.model.types.get('unit:Box'),{construction:{id:'unit:Construction',functionId:'entry',initializationFields:[]}});
  const result=analyzeCommonGraphs(program,records);
  const entries=[...result.actual.contexts.values()].filter(c=>c.root&&c.plan.owner.id==='entry');
  assert.equal(entries.length,1);
  assert.deepEqual(entries[0].constructionRoot,{constructionId:'unit:Construction',owner:'unit:Box',newTarget:'unit:Box'});
  assert.equal(entries[0].normal,true);
});
