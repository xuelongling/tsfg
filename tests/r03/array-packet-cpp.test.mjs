// SPDX-License-Identifier: MIT
// Real static IR-only CLI. Complete independent packets precede all SUT calls;
// source was statically authored earlier under Root's explicit scheduling rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=await readFile(new URL('./array-packet/oracle/array-packet-oracle.json',import.meta.url));
assert.equal(raw.length,528940);
assert.equal(sha(raw),'e34430e945218708e3773ec8ebec671c2c602e09b2cbc79412ea2900f0782d37');
const gold=JSON.parse(raw.toString('utf8'));
assert.equal(gold.cases.length,9);
assert.equal(gold.cases.filter(c=>c.kind==='original-complete-whole-Core').length,7);
const inputs=[];
for(const row of gold.cases){
 const original=row.originalCore;
 assert.ok(['tests/r03/array-core-parameter-oracle.json','tests/r03/readspan-core11-oracle.json',
  'tests/r03/readspan-core11-length-oracle.json'].includes(original.fixture));
 const fixture=await readFile(new URL('../../'+original.fixture,import.meta.url));
 assert.equal(fixture.length,original.fixtureBytes);assert.equal(sha(fixture),original.fixtureSHA256);
 const source=JSON.parse(fixture.toString('utf8')).cases.find(c=>c.name===original.caseName);assert.ok(source);
 let core=source.core;assert.equal(Buffer.byteLength(core),original.bytes);assert.equal(sha(core),original.sha256);
 if(original.markerMigration){
  assert.equal(original.markerMigration.onlyMarker,true);
  for(const change of original.markerMigration.substitutions){
   assert.equal(core.split(change.before).length,2);core=core.replace(change.before,change.after);
  }
  assert.equal(Buffer.byteLength(core),original.markerMigration.core11Bytes);
  assert.equal(sha(core),original.markerMigration.core11SHA256);
 }
 const expected=await readFile(new URL('./array-packet/'+row.packetFile,import.meta.url));
 assert.equal(expected.length,row.packetBytes);assert.equal(sha(expected),row.packetSHA256);
 inputs.push({row,core,expected});
}
for(const item of inputs)test('37g complete private packet: '+item.row.name,async()=>{
 const result=await invokeCore(item.core,'--emit-array-candidate');accepted(result);
 assert.deepEqual(result.stdout,item.expected,'whole module, all original identities/SSA/ranges and canonical proof bytes');
});
const first=inputs[0],view=inputs[3],wide=inputs[6];
/** @param {string} core @param {string} binding @param {string} key @param {string} value */
function supplied(core,binding,key,value){
 const anchor='tsfg_array.source_binding = "'+binding+'"';assert.equal(core.split(anchor).length,2);
 return core.replace(anchor,anchor+', '+key+' = '+value);
}
/** @param {Array<{block:number,instruction:number,registers:number[]}>} rows */
const roots=rows=>'['+rows.map(r=>'{block = '+r.block+' : i64, instruction = '+r.instruction
 +' : i64, registers = ['+r.registers.map(n=>n+' : i64').join(', ')+']}').join(', ')+']';
const functions=first.row.decoded.payload.functions;
let normalized=supplied(first.core,functions[0].sourceBinding,'tsfg_array.call_roots','[]');
normalized=supplied(normalized,functions[1].sourceBinding,'tsfg_array.call_roots',roots(functions[1].callRoots));
test('37g optional empty or exact canonical call-root assertions encode the same full packet',async()=>{
 const result=await invokeCore(normalized,'--emit-array-candidate');accepted(result);assert.deepEqual(result.stdout,first.expected);
});
const rootID=functions[1].sourceBinding;
const collapsed=structuredClone(functions[1].callRoots);collapsed[0].registers.splice(1,1);
const reversed=structuredClone(functions[1].callRoots);reversed[0].registers.reverse();
const zero='sha256:'+'0'.repeat(64);
/** @type {Array<[string,string,string]>} */
const bad=[
 ['missing complete live-before roots',supplied(first.core,rootID,'tsfg_array.call_roots','[]'),'[core-ir-array-roots]'],
 ['collapsed independent alias SSA root',supplied(first.core,rootID,'tsfg_array.call_roots',roots(collapsed)),'[core-ir-array-roots]'],
 ['noncanonical root ordering',supplied(first.core,rootID,'tsfg_array.call_roots',roots(reversed)),'[core-ir-array-roots]'],
 ['coherent table and function wrong identity',first.core.split(functions[0].functionId).join(zero),'[core-ir-array-identity]'],
 ['unknown function attribute',supplied(first.core,functions[0].sourceBinding,'unmodeled','true'),'[core-ir-array-metadata]'],
 ['old private Core10 marker',view.core.replace('version = 11 : i32','version = 10 : i32'),'[core-ir-array-marker]'],
 ['wrong Core11 schema',view.core.replace('sha256:4099a1f8633db0326e39bf81f514e63e6287a2589f2128ac7a23e65404e82b06',zero),'[core-ir-array-marker]'],
 ['literal checked-index excluded endpoint',wide.core.replaceAll('value = "4294967294"','value = "4294967295"'),'[core-ir-array-type]'],
];
/** @param {string} name @param {string|Buffer} input @param {string} tag */
function refuses(name,input,tag){test('37g rejects before packet publication: '+name,async()=>{
 const result=await invokeCore(input,'--emit-array-candidate');
 assert.equal(result.close.code,3,result.stderr.toString('utf8'));assert.equal(result.stdout.length,0);
 if(tag)assert.ok(result.stderr.toString('utf8').includes(tag),result.stderr.toString('utf8'));
});}
for(const [name,input,tag]of bad){assert.notEqual(input,name.includes('marker')||name.includes('schema')?view.core:first.core);refuses(name,input,tag);}
const cold=JSON.parse(await readFile(new URL('./readspan-core11-length-oracle.json',import.meta.url),'utf8'));
for(const item of cold.cases)if(item.expected.exit!==0)
 refuses('existing independent cold '+item.name,item.core,item.expected.exactPrivateTag?'['+item.expected.exactPrivateTag+']':'');
const limit=8388608;
/** @param {number} size @param {number} last */
function padded(size,last){const result=Buffer.alloc(size,10);Buffer.from(first.core).copy(result);result[size-1]=last;return result;}
test('37g exactly8MiB complete input retains the same entire private packet',async()=>{
 const result=await invokeCore(padded(limit,32),'--emit-array-candidate');accepted(result);assert.deepEqual(result.stdout,first.expected);
});
refuses('valid8MiB+1 before parse',padded(limit+1,32),'[core-ir-array-budget]');
refuses('malformed8MiB+1 before parse',padded(limit+1,63),'[core-ir-array-budget]');
test('37g explicit Array command cannot relabel String or nullable complete modules',async()=>{
 const strings=JSON.parse(await readFile(new URL('./string-core-oracle.json',import.meta.url),'utf8'));
 const nullable=JSON.parse(await readFile(new URL('./nullable-presence-core-first.json',import.meta.url),'utf8'));
 for(const core of [strings.cases[0].core,nullable.cases[0].expectedCore]){
  const result=await invokeCore(core,'--emit-array-candidate');
  assert.equal(result.close.code,3,result.stderr.toString('utf8'));assert.equal(result.stdout.length,0);
  assert.ok(result.stderr.toString('utf8').includes('[r04-core-array-required]'));
 }
});
// Existing whole Array/ReadSpan and String/nullable CLI suites retain their
// canonicalize/optimize/formal-wire refusal contracts; no packet instruction executes.
