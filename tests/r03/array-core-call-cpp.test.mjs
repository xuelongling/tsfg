// SPDX-License-Identifier: MIT
import {pinnedContainer} from './array-test-fixtures.mjs';
// Actual existing IR-only CLI; Root supplies the newly linked binary in its heavy window.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
import {parseArrayCore,parseArrayCoreProofValue} from './array-core-structural-oracle.mjs';
const o=JSON.parse(await readFile(new URL('./array-core-call-oracle.json',import.meta.url),'utf8'));
const current=await pinnedContainer('./array-core12-legacy-oracle.json',1058670,'5d508df006d7191686dd950744d7bf212466fe562f33c5708e041a9b07ece535');
const frozen=current.cases.find(/** @param {any} row */ row=>row.name==='actual-source-scalar-ordinary-call');assert.ok(frozen);o.core=frozen.core;

const roots='[{block = 0 : i64, instruction = 3 : i64, array_registers = [1 : i64], view_registers = []}]';
/** @param {string} value @param {string} [core] */
function withRoots(value,core=o.core){const start=core.indexOf('  func.func @"entry"');
  assert.ok(start>0);return core.slice(0,start)+core.slice(start).replace(' attributes {',
    ' attributes {tsfg_array.call_roots = '+value+', ');}
const expected=parseArrayCoreProofValue(frozen.canonicalCore);
/** @param {string|Buffer} bytes @param {string} tag */
async function refuses(bytes,tag){const r=await invokeCore(bytes,'--canonicalize');
  assert.equal(r.close.code,3,r.stderr.toString('utf8'));assert.equal(r.stdout.length,0);
  assert.ok(r.stderr.toString('utf8').includes(tag),r.stderr.toString('utf8'));}
test('actual complete Array call Core independently derives live owner roots and canonical fixed point',async()=>{
  for(const input of [o.core,withRoots(roots)]){
    const first=await invokeCore(input,'--canonicalize');accepted(first);
    assert.deepEqual(parseArrayCoreProofValue(first.stdout.toString('utf8')),expected);
    const reread=await invokeCore(first.stdout,'--canonicalize');accepted(reread);assert.deepEqual(reread.stdout,first.stdout);
    const optimize=await invokeCore(input,'--optimize');accepted(optimize);assert.deepEqual(optimize.stdout,first.stdout);
  }
});
test('cold IR cannot substitute call identity, source order or the live caller owner',async t=>{
  /** @type {Array<[string,string,string]>} */
  const negatives=[
    ['target ID',o.core.replace('callee = @"leaf", tsfg_core.function_id = "'+o.hir.functions[0].id+'"',
      'callee = @"leaf", tsfg_core.function_id = "sha256:'+'0'.repeat(64)+'"'),'[core-ir-array-call]'],
    ['signature',o.core.replace('tsfg_core.signature_hash = "'+o.hir.functions[0].signatureHash+'", source_callee',
      'tsfg_core.signature_hash = "sha256:'+'0'.repeat(64)+'", source_callee'),'[core-ir-array-call]'],
    ['wrong existing symbol',o.core.replace('callee = @"leaf"','callee = @"entry"'),'[core-ir-array-call]'],
    ['source callee',o.core.replace('source_callee = "'+o.hir.functions[0].sourceBinding+'"',
      'source_callee = "'+o.hir.functions[1].sourceBinding+'"'),'[core-ir-array-call]'],
    ['call callee anchor',o.core.replace('callee_range = array<i64: 136, 140>','callee_range = array<i64: 137, 140>'),'[core-ir-array-source]'],
    ['call statement order',o.core.replace('statement_range = array<i64: 136, 143>','statement_range = array<i64: 109, 143>'),'[core-ir-array-source]'],
    ['return uses discarded call',o.core.replace('"func.return"(%v4)','"func.return"(%v2)'),'[core-ir-array-shape]'],
    ['missing live owner',withRoots('[]'),'[core-ir-array-roots]'],
    ['scalar instead of owner',withRoots(roots.replace('array_registers = [1 : i64]','array_registers = [0 : i64]')),'[core-ir-array-roots]'],
    ['call result as root',withRoots(roots.replace('array_registers = [1 : i64]','array_registers = [2 : i64]')),'[core-ir-array-roots]'],
    ['duplicate owner',withRoots(roots.replace('array_registers = [1 : i64]','array_registers = [1 : i64, 1 : i64]')),'[core-ir-array-roots]'],
    ['wrong root instruction',withRoots(roots.replace('instruction = 3','instruction = 4')),'[core-ir-array-roots]'],
  ];
  for(const [name,input,tag]of negatives)await t.test(name,()=>refuses(input,tag));
});
test('Array ordinary call does not authorize formal wire execution',async()=>{
  const r=await invokeCore(o.core,'--emit-bytecode');assert.equal(r.close.code,3);assert.equal(r.stdout.length,0);
  assert.equal(r.stderr.toString('utf8').replace(/\r\n/g,'\n'),'[r04-core-array-unsupported] Array candidate has no wire encoding\n');
});

// Explicit cold owned-facts metamorphic coverage; the original actual Source case stays separate.
const p=JSON.parse(await readFile(new URL('./array-core-call-scalar-alias-oracle.json',import.meta.url),'utf8'));
const frozenPair=current.cases.find(/** @param {any} row */ row=>row.name==='owned-facts-scalar-alias-ordinary-call');assert.ok(frozenPair);p.core=frozenPair.core;
const pairRoots='[{block = 0 : i64, instruction = 6 : i64, array_registers = [3 : i64, 4 : i64], view_registers = []}]';
const pairExpected=parseArrayCoreProofValue(frozenPair.canonicalCore);
test('owned-facts four scalar actuals retain literal order, full u32 and both live alias SSA roots',async()=>{
  assert.equal(p.provenance.sourceExecution,false);assert.equal(p.provenance.productionImportedForExpected,false);
  for(const input of [p.core,withRoots(pairRoots,p.core)]){
    const first=await invokeCore(input,'--canonicalize');accepted(first);
    assert.deepEqual(parseArrayCoreProofValue(first.stdout.toString('utf8')),pairExpected);
    const reread=await invokeCore(first.stdout,'--canonicalize');accepted(reread);assert.deepEqual(reread.stdout,first.stdout);
    const optimized=await invokeCore(input,'--optimize');accepted(optimized);assert.deepEqual(optimized.stdout,first.stdout);
  }
});
test('same-type scalar substitution and owner/alias root collapse reject before output',async t=>{
  const call='"func.call"(%v5, %v0, %v1, %v6)';
  const literals=p.core.split('\n').filter(/** @param {string} line */ line=>line.includes('%v5 = "tsfg_core.constant"')||line.includes('%v6 = "tsfg_core.constant"'));
  assert.equal(literals.length,2);
  /** @type {Array<[string,string,string]>} */
  const negatives=[
    ['same-type f64 argument order',p.core.replace(call,'"func.call"(%v0, %v5, %v1, %v6)'),'[core-ir-array-call]'],
    ['same-type f64 actual replaced',p.core.replace(call,'"func.call"(%v0, %v0, %v1, %v6)'),'[core-ir-array-call]'],
    ['same-type u32 argument order',p.core.replace(call,'"func.call"(%v5, %v0, %v6, %v1)'),'[core-ir-array-call]'],
    ['same-type u32 max actual replaced',p.core.replace(call,'"func.call"(%v5, %v0, %v1, %v1)'),'[core-ir-array-call]'],
    ['literal evaluation order',p.core.replace(literals.join('\n'),[...literals].reverse().join('\n')),'[core-ir-array-type]'],
    ['missing alias root',withRoots(pairRoots.replace('[3 : i64, 4 : i64]','[3 : i64]'),p.core),'[core-ir-array-roots]'],
    ['missing original root',withRoots(pairRoots.replace('[3 : i64, 4 : i64]','[4 : i64]'),p.core),'[core-ir-array-roots]'],
    ['collapsed owner duplicate',withRoots(pairRoots.replace('[3 : i64, 4 : i64]','[3 : i64, 3 : i64]'),p.core),'[core-ir-array-roots]'],
    ['alias replaced by scalar',withRoots(pairRoots.replace('[3 : i64, 4 : i64]','[3 : i64, 5 : i64]'),p.core),'[core-ir-array-roots]'],
    ['alias replaced by discarded call result',withRoots(pairRoots.replace('[3 : i64, 4 : i64]','[3 : i64, 7 : i64]'),p.core),'[core-ir-array-roots]'],
    ['noncanonical reverse root set',withRoots(pairRoots.replace('[3 : i64, 4 : i64]','[4 : i64, 3 : i64]'),p.core),'[core-ir-array-roots]'],
    ['alias root point omitted',withRoots('[]',p.core),'[core-ir-array-roots]'],
  ];
  for(const [name,input,tag]of negatives){assert.notEqual(input,p.core,name+' mutation reaches actual bytes');
    await t.test(name,()=>refuses(input,tag));}
});

test('cold complete local-owner Core cannot introduce a coherent cyclic call',async()=>{
  const contracts=parseArrayCore(o.core).attributes['tsfg_array.publication'].contracts;
  const leaf=contracts.find(/** @param {any} row */ row=>row.function_id===o.hir.functions[0].id),entry=contracts.find(/** @param {any} row */ row=>row.function_id===o.hir.functions[1].id);assert.ok(leaf&&entry);
  const from='callee = @"leaf", tsfg_core.function_id = "'+o.hir.functions[0].id+'", tsfg_core.signature_hash = "'
    +o.hir.functions[0].signatureHash+'", source_callee = "'+o.hir.functions[0].sourceBinding+'", consumed_digest = '+JSON.stringify(leaf.digest);
  const to='callee = @"entry", tsfg_core.function_id = "'+o.hir.functions[1].id+'", tsfg_core.signature_hash = "'
    +o.hir.functions[1].signatureHash+'", source_callee = "'+o.hir.functions[1].sourceBinding+'", consumed_digest = '+JSON.stringify(entry.digest);
  const input=o.core.replace(from,to);assert.notEqual(input,o.core);
  await refuses(input,'[core-ir-array-call]');
});
