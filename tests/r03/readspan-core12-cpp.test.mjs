// SPDX-License-Identifier: MIT
// IR-only existing CLI; no guest execution or Source producer invocation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pinnedContainer} from './array-test-fixtures.mjs';
import {parseArrayCoreProofValue} from './array-core-structural-oracle.mjs';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
const oracle=await pinnedContainer('./readspan-core12-oracle.json',474847,
  'ea662dcd137a240a947c1fc3c57d9a17dbed31661e99338a4d76950e5dce9ba0');
assert.equal(oracle.cases.length,17);
for(const row of oracle.cases)test('26f cold complete Core12 plus canonical proofs: '+row.name,async()=>{
  const expected=parseArrayCoreProofValue(row.canonicalCore),first=await invokeCore(row.core,'--canonicalize');accepted(first);
  assert.deepEqual(parseArrayCoreProofValue(first.stdout.toString('utf8')),expected);
  const supplied=await invokeCore(row.canonicalCore,'--canonicalize');accepted(supplied);assert.deepEqual(parseArrayCoreProofValue(supplied.stdout.toString('utf8')),parseArrayCoreProofValue(first.stdout.toString('utf8')));
  const fixed=await invokeCore(first.stdout,'--canonicalize');accepted(fixed);assert.deepEqual(fixed.stdout,first.stdout);
  const optimized=await invokeCore(row.core,'--optimize');accepted(optimized);assert.deepEqual(optimized.stdout,first.stdout);
});
/** @param {string} original @param {string} before @param {string} after */
function mutate(original,before,after){assert.ok(original.includes(before));const next=original.replace(before,after);assert.notEqual(next,original);return next;}
/** @param {string} input @param {string} tag */
async function refuses(input,tag){const result=await invokeCore(input,'--canonicalize');
  assert.equal(result.close.code,3,result.stderr.toString('utf8'));assert.equal(result.stdout.length,0);
  assert.ok(result.stderr.toString('utf8').includes(tag),result.stderr.toString('utf8'));}
test('26f exact formal readonly, full publication, consumed identity and unused lifetime boundaries',async t=>{
  const row=oracle.cases.find(row=>row.name==='after');assert.ok(row);
  const zero='sha256:'+'0'.repeat(64);
  /** @type {Array<[string,string,string]>} */
  const cases=[
    ['formal View cannot become writable',mutate(row.core,'writable = false','writable = true'),'[core-ir-array-metadata]'],
    ['View element is strictly inside its nominal annotation',mutate(row.core,'element_annotation_range = array<i64: 28, 31>','element_annotation_range = array<i64: 19, 31>'),'[core-ir-array-source]'],
    ['a consumed digest is not a caller supplied authority',mutate(row.core,'consumed_digest = "sha256:1316061d9f9eb270157c566663e0adcf6595fc141062cfdd9a190392d6c812c0"','consumed_digest = "'+zero+'"'),'[core-ir-array-publication]'],
    ['unused formal must not invent an entry last use',mutate(row.canonicalCore,'last_use = array<i64>','last_use = array<i64: 0>'),'[core-ir-readspan-lifetime]'],
    ['whole fixed table cannot be removed for a View domain',mutate(row.core,'tsfg_array.publication = {','tsfg_array.publication_wrong = {'),'[core-ir-array-metadata]'],
    ['ReturnUse cannot pretend a literal is a direct call',mutate(row.core,'tsfg_array.value = {kind = "floating"','tsfg_array.value = {kind = "arrayDirectCall"'),'[core-ir-array-shape]'],
  ];
  for(const [name,input,tag] of cases)await t.test(name,()=>refuses(input,tag));
});
