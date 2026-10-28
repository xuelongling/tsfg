// SPDX-License-Identifier: MIT
import {pinnedContainer} from './array-test-fixtures.mjs';
// Existing actual IR-only CLI; independent whole Core, typed SSA and roots.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
import {parseArrayCore,parseArrayCoreProofValue} from './array-core-structural-oracle.mjs';
const o=JSON.parse(await readFile(new URL('./array-core-parameter-oracle.json',import.meta.url),'utf8'));
const current=await pinnedContainer('./readspan-core12-oracle.json',474847,'ea662dcd137a240a947c1fc3c57d9a17dbed31661e99338a4d76950e5dce9ba0');
for(const row of o.cases){const frozen=current.cases.find(/** @param {any} value */ value=>value.name===row.name);assert.ok(frozen);row.core=frozen.core;row.canonicalCore=frozen.canonicalCore;}

/** @param {any[]} records */
const attr=records=>'['+records.map(r=>'{block = '+r.block+' : i64, instruction = '+r.instruction
  +' : i64, array_registers = ['+r.registers.map(/** @param {number} n */ n=>n+' : i64').join(', ')+'], view_registers = []}').join(', ')+']';
/** @param {any} row @param {number} index @param {any[]} records */
function roots(row,index,records){const marker='  func.func @'+JSON.stringify(row.hir.functions[index].name);
  const at=row.core.indexOf(marker);assert.ok(at>=0);
  return row.core.slice(0,at)+row.core.slice(at).replace(' attributes {',
    ' attributes {tsfg_array.call_roots = '+attr(records)+', ');}
/** @param {string} input @param {string} tag */
async function refuses(input,tag){const r=await invokeCore(input,'--canonicalize');
  assert.equal(r.close.code,3,r.stderr.toString('utf8'));assert.equal(r.stdout.length,0);
  assert.ok(r.stderr.toString('utf8').includes(tag),r.stderr.toString('utf8'));}
for(const row of o.cases)test('cold complete Array parameter Core: '+row.name,async()=>{
  const expected=parseArrayCoreProofValue(row.canonicalCore);
  const first=await invokeCore(row.core,'--canonicalize');accepted(first);
  assert.deepEqual(parseArrayCoreProofValue(first.stdout.toString('utf8')),expected);
  const fixed=await invokeCore(first.stdout,'--canonicalize');accepted(fixed);assert.deepEqual(fixed.stdout,first.stdout);
  const optimized=await invokeCore(row.core,'--optimize');accepted(optimized);assert.deepEqual(optimized.stdout,first.stdout);
  for(let index=0;index<row.roots.length;index++)if(row.roots[index].length){
    const supplied=await invokeCore(roots(row,index,row.roots[index]),'--canonicalize');accepted(supplied);
    assert.deepEqual(supplied.stdout,first.stdout);}
  const wire=await invokeCore(row.core,'--emit-bytecode');assert.equal(wire.close.code,3);assert.equal(wire.stdout.length,0);
  assert.equal(wire.stderr.toString('utf8').replace(/\r\n/g,'\n'),'[r04-core-array-unsupported] Array candidate has no wire encoding\n');
});
test('cold Array actuals require original nominal type, binding, order and SSA',async t=>{
  const a=o.cases[0],core=a.core,call='"func.call"(%v5, %v0, %v4, %v1)';
  /** @type {Array<[string,string,string]>} */
  const cases=[
    ['same-type alias swapped',core.replace(call,'"func.call"(%v4, %v0, %v5, %v1)'),'[core-ir-array-call]'],
    ['different owner substituted',core.replace(call,'"func.call"(%v8, %v0, %v4, %v1)'),'[core-ir-array-call]'],
    ['disconnected same-owner alias',core.replace(call,'"func.call"(%v4, %v0, %v4, %v1)'),'[core-ir-array-call]'],
    ['actual binding absent',core.replace('arguments = [{kind = "reference", binding = "'+a.hir.functions[1].body[1].binding.id+'"',
      'arguments = [{kind = "reference", binding = "sha256:'+'0'.repeat(64)+'"'),'[core-ir-array-call]'],
    ['element annotation outside Array',core.replace('element_annotation_range = array<i64: 27, 30>',
      'element_annotation_range = array<i64: 27, 33>'),'[core-ir-array-source]'],
    ['private helper export pair forged',o.cases[1].core.replace('tsfg_array.exports = [{name = "entry"',
      'tsfg_array.exports = [{name = "fill"'),'[core-ir-array-identity]'],
    ['missing original Array root',roots(a,1,[{block:0,instruction:8,registers:[5,8]},a.roots[1][1]]),'[core-ir-array-roots]'],
    ['missing independent alias root',roots(a,1,[{block:0,instruction:8,registers:[4,8]},a.roots[1][1]]),'[core-ir-array-roots]'],
    ['root replaced by discarded scalar',roots(a,1,[{block:0,instruction:8,registers:[4,5,9]},a.roots[1][1]]),'[core-ir-array-roots]'],
    ['parameter root omitted at recursion',roots(o.cases[2],0,[]),'[core-ir-array-roots]'],
    ['return uses scalar argument instead of call result',o.cases[2].core.replace('"func.return"(%v3)','"func.return"(%v1)'),'[core-ir-array-source]'],
    ['entry fuel missing',o.cases[2].core.replace('event = 1 : i32','event = 2 : i32'),'[core-ir-array-shape]'],
  ];
  for(const [name,input,tag]of cases){assert.ok(o.cases.every(/** @param {any} r */ r=>input!==r.core),name);await t.test(name,()=>refuses(input,tag));}
});
test('cold SCC excludes the complete transitive outgoing allocation domain',async()=>{
  // Cold malformed-input control only: an additional range-consistent outgoing
  // edge is not claimed as captured Source. It must reach the SCC policy guard.
  const row=o.cases[2],entry=row.hir.functions[1],spin=row.hir.functions[0];
  const publication=parseArrayCore(row.core).attributes['tsfg_array.publication'];
  const target=publication.contracts.find(/** @param {any} value */ value=>value.function_id===entry.id);assert.ok(target);
  // New required consumption metadata comes from the same independently frozen fixed table; the original SCC fault stays unchanged.
  const edge='    %v4 = "func.call"() {callee = @"entry", tsfg_core.function_id = '+JSON.stringify(entry.id)
    +', tsfg_core.signature_hash = '+JSON.stringify(entry.signatureHash)+', source_callee = '+JSON.stringify(entry.sourceBinding)
    +', consumed_digest = '+JSON.stringify(target.digest)+', callee_range = array<i64: 50, 51>, arguments = [], statement_range = array<i64: 50, 53>, tsfg_source.start = 50 : i64, tsfg_source.end = 53 : i64} : () -> f64';
  let input=row.core.replace('    %v3 = "func.call"(%v0, %v1)',edge+'\n    %v3 = "func.call"(%v0, %v1)');
  const start=input.indexOf('  func.func @"entry"');const head=input.slice(0,start),tail=input.slice(start);
  input=head+tail.split('\n').filter(/** @param {string} line */ line=>!line.includes('%v2 = "tsfg_core.constant"')&&!line.includes('%v3 = "func.call"')).join('\n');
  assert.ok(input.includes(JSON.stringify(spin.id)));
  await refuses(input,'cyclic outgoing domain contains an allocation');
});
