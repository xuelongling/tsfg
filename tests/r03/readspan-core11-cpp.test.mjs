// SPDX-License-Identifier: MIT
// Real IR-only CLI, complete independent Core inputs; never Source/VM execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pinnedContainer} from './array-test-fixtures.mjs';
import {parseArrayCore} from './array-core-structural-oracle.mjs';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
const gold=await pinnedContainer('./readspan-core11-oracle.json',77575,
  '6969a1ed0de2f71bb663565290b6c913c3c9957232b360dc31645e80554b77c4');
const cold=await pinnedContainer('./readspan-core11-length-oracle.json',146182,
  'da0b0c61f2f079c7afa200ec505dee59cedef3a2cc76d0fc410e8d1739993a7c');
/** @param {string} core @param {string} normalized */
async function whole(core,normalized){
  const first=await invokeCore(core,'--canonicalize');accepted(first);
  assert.deepEqual(parseArrayCore(first.stdout.toString('utf8')),parseArrayCore(normalized));
  const again=await invokeCore(first.stdout,'--canonicalize');accepted(again);assert.deepEqual(again.stdout,first.stdout);
  const optimized=await invokeCore(core,'--optimize');accepted(optimized);assert.deepEqual(optimized.stdout,first.stdout);
  const wire=await invokeCore(core,'--emit-bytecode');assert.equal(wire.close.code,3);assert.equal(wire.stdout.length,0);
  assert.equal(wire.stderr.toString('utf8'),'[r04-core-array-unsupported] Array candidate has no wire encoding\n');
}
for(const row of gold.cases)test('26e whole captured package real cold Core: '+row.name,
  ()=>whole(row.core,row.canonicalCore));
for(const row of cold.cases)test('26e independent cold length only: '+row.name,async()=>{
  if(row.expected.exit===0){await whole(row.core,row.normalizedInputCore);return;}
  const result=await invokeCore(row.core,'--canonicalize');rejected(result);
  if(row.expected.exactPrivateTag)assert.ok(result.stderr.toString('utf8').includes('['+row.expected.exactPrivateTag+']'));
});
const first=gold.cases[0],wide=gold.cases[3];
/** @param {string} name @param {string} input @param {string} tag */
function refuses(name,input,tag){assert.notEqual(input,first.core,name);test('26e exact cold boundary: '+name,async()=>{
  const result=await invokeCore(input,'--canonicalize');rejected(result);
  if(tag)assert.ok(result.stderr.toString('utf8').includes(tag),result.stderr.toString('utf8'));
});}
refuses('old10 identity',first.core.replace('version = 11 : i32, schema = "'+gold.schema+'", profile = "dense-f64-array-local-readspan-checked-v11"',
  'version = 10 : i32, schema = "sha256:7a1b9747e100cdc60119a37dbc31e477a5630f05b715a6f6a795a7573dd43f05", profile = "dense-f64-array-parameter-call-roots-checked-v10"'),'[core-ir-array-marker]');
refuses('new11 wrong schema',first.core.replace(gold.schema,'sha256:'+'0'.repeat(64)),'[core-ir-array-marker]');
refuses('view owner is view SSA',first.core.replace('"tsfg_array.view_create_checked"(%v1,','"tsfg_array.view_create_checked"(%v4,'),'');
refuses('start and length SSA exchanged',first.core.replace('"tsfg_array.view_create_checked"(%v1, %v2, %v3)','"tsfg_array.view_create_checked"(%v1, %v3, %v2)'),'[core-ir-array-shape]');
refuses('view read uses owner Array',first.core.replace('"tsfg_array.view_read_checked"(%v4,','"tsfg_array.view_read_checked"(%v1,'),'');
refuses('view read metadata false binding',first.core.replace('receiver_binding = "'+'sha256:46338d50412cef7b0f1587552e45d3789e42cfb665996a797d993a3845299a03'+'", receiver_range = array<i64: 112, 113>',
  'receiver_binding = "sha256:'+'0'.repeat(64)+'", receiver_range = array<i64: 112, 113>'),'[core-ir-array-identity]');
refuses('u32 start over domain',wide.core.replace('value = "4294967295"','value = "4294967296"'),'');
refuses('u32 checked read max excluded',wide.core.replaceAll('value = "4294967294"','value = "4294967295"'),'[core-ir-array-type]');
refuses('removed checked-create operation',first.core.replace('"tsfg_array.view_create_checked"','"tsfg_array.alias"'),'');

// Well-typed cold CFG metamorphs of the whole package, not new Source captures.
const split=first.core.indexOf('    %v5 = "tsfg_core.constant"');assert.ok(split>0);
const entry=first.core.slice(0,split),tail=first.core.slice(split);
refuses('dominating view crosses a CFG edge',entry+'    cf.br ^later\n  ^later:\n'+tail,'[core-ir-array-shape]');
refuses('view transferred through block argument',entry+'    cf.br ^later(%v4 : !tsfg_array.readspan_f64)\n  ^later(%v7: !tsfg_array.readspan_f64):\n'
  +tail.replace('"tsfg_array.view_read_checked"(%v4,','"tsfg_array.view_read_checked"(%v7,'),'[core-ir-array-shape]');
