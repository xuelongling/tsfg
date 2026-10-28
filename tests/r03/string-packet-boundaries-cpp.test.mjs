// SPDX-License-Identifier: MIT
// Only the static --emit-string-candidate seam; never execute packet instructions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async name=>readFile(new URL('./'+name,import.meta.url));
const o=JSON.parse((await read('string-core-oracle.json')).toString('utf8'));
const raw=await read('string-packet-oracle.json');
assert.equal(raw.length,119782);
assert.equal(sha(raw),'438c68d9a1bcc15ec494e3328e0125b1cc972f0e7ca405277562f5caae7e2485');
const gold=JSON.parse(raw.toString('utf8'));
for(const name of ['lossless','concat'])test('complete independent String packet: '+name,async()=>{
 const c=o.cases.find(c=>c.name===name),g=gold.cases.find(c=>c.name===name);assert.ok(c&&g);
 const expected=await read(g.packetFile);
 assert.equal(expected.length,g.packetBytes);assert.equal(sha(expected),g.packetSHA256);
 assert.equal(sha(c.core),g.originalCore.sha256);assert.equal(Buffer.byteLength(c.core),g.originalCore.bytes);
 const actual=await invokeCore(c.core,'--emit-string-candidate');accepted(actual);
 assert.deepEqual(actual.stdout,expected,'entire module; every identity/unit/SSA/range remains original');
});
const asi=o.cases.find(c=>c.name==='asi'),concat=o.cases.find(c=>c.name==='concat');assert.ok(asi&&concat);
const zero='sha256:'+'0'.repeat(64);
const id=asi.semantic[0].functionId;
assert.equal(asi.core.split(id).length-1,2,'original table and function both contain the one ID');
const lossless=o.cases.find(c=>c.name==='lossless');assert.ok(lossless);
const bigPackage=lossless.core.replace(/code_units = array<i32(?:: [^>]+)?>/g,
 'code_units = array<i32: '+Array(5000).fill('65').join(', ')+'>');
assert.equal((bigPackage.match(/code_units = /g)||[]).length,14);
/** @type {Array<[string,string,string]>} */
const bad=[
 ['coherent table and function wrong identity',asi.core.split(id).join(zero),'[core-ir-string-identity]'],
 ['well-formed wrong signature digest',asi.core.split(asi.semantic[0].signatureHash).join(zero),'[core-ir-string-identity]'],
 ['well-formed wrong type digest',asi.core.split(asi.semantic[0].typeId).join(zero),'[core-ir-string-identity]'],
 ['uint16 range violation',asi.core.replace('array<i32: 65>','array<i32: 65536>'),'[core-ir-string-type]'],
 ['literal count budget',asi.core.replace('array<i32: 65>','array<i32: '+Array(16385).fill('65').join(', ')+'>'),'[core-ir-string-budget]'],
 ['literal-only package count budget',bigPackage,'[core-ir-string-budget]'],
 ['ordered concat actual operands',concat.core.replace('"tsfg_string.concat"(%v0, %v1)','"tsfg_string.concat"(%v1, %v0)'),'[core-ir-string-shape]'],
 ['return must use concat SSA',concat.core.replace('"func.return"(%v2)','"func.return"(%v0)'),'[core-ir-string-shape]'],
 ['function declaration outside source',asi.core.replace('tsfg_core.function_end = 74 : i64','tsfg_core.function_end = 77 : i64'),'[core-ir-string-source]'],
 ['unsupported facts profile',asi.core.replace('facts_version = 1 : i32','facts_version = 3 : i32'),'[core-ir-string-marker]'],
];
for(const [name,input,tag]of bad)test('private String output refuses before any byte: '+name,async()=>{
 assert.notEqual(input,name.includes('concat')?concat.core:asi.core,'mutation changes input');
 const actual=await invokeCore(input,'--emit-string-candidate');
 assert.equal(actual.close.code,3,actual.stderr.toString('utf8'));assert.equal(actual.stdout.length,0);
 assert.ok(actual.stderr.toString('utf8').includes(tag),'exact semantic gate '+tag+': '+actual.stderr.toString('utf8'));
});
test('String private command cannot relabel a scalar or nullable module',async()=>{
 const scalar=JSON.parse((await read('string-core-default-scalar.json')).toString('utf8'));
 const nullable=JSON.parse((await read('nullable-presence-core-first.json')).toString('utf8'));
 for(const input of [scalar.core,nullable.cases[0].expectedCore]){
  const actual=await invokeCore(input,'--emit-string-candidate');
  assert.equal(actual.close.code,3,actual.stderr.toString('utf8'));assert.equal(actual.stdout.length,0);
  assert.ok(actual.stderr.toString('utf8').includes('[r04-core-string-required]'));
 }
});
// Existing String tests retain exact old --emit-bytecode/--emit-nullable-candidate
// refusals, complete canonical/optimize roundtrips and scalar branch controls.
// Input/source hashes remain opaque provenance, never reconstructed Source authority.
