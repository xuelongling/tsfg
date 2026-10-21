// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {lowerFormalHir,lowerHir} from '../../compiler/hir.mjs';
import {stringCases,expectedStringCore,expectedStringPacket} from './formal-string-gold.mjs';
import {generalStringProgram,globalStringProgram} from './formal-string-program.mjs';
const cases=stringCases();
const cpp=process.env.TSFG_FORMAL_STRING_CORE;
for(const c of cases)test('formal String complete HIR/Core/packet gold: '+c.name,()=>{
  const before=structuredClone(c.hir),core=lowerFormalHir(c.hir,c.context);
  assert.equal(core,expectedStringCore(c.hir));assert.deepEqual(c.hir,before);
  assert.doesNotMatch(core,/tsfg_core\.string|tsfg_string\.function_ids/);
  assert.equal((core.match(/func.func @/g)??[]).length,c.hir.functions.length);
  assert.match(lowerHir(c.hir,c.context),/tsfg_core.version = "0.9.0"/);
  const packet=expectedStringPacket(c.hir);
  assert.equal(packet.readUInt32LE(8),12);assert.equal(packet.readUInt32LE(44),packet.length);
});
test('formal C++ complete typed String CFG/calls/all operations and original capacities',{skip:!cpp},()=>{
  for(const count of [3,512]) {
    const {core,packet}=generalStringProgram(count);
    const result=spawnSync(cpp,['--emit-bytecode'],{input:core,maxBuffer:16*1024*1024,windowsHide:true});
    assert.equal(result.status,0,result.stderr.toString());assert.deepEqual(result.stdout,packet);
  }
});
test('formal C++ retains String global lifecycle and complete module tables',{skip:!cpp},()=>{
  const {core,packet}=globalStringProgram();
  const result=spawnSync(cpp,['--emit-bytecode'],{input:core,maxBuffer:16*1024*1024,windowsHide:true});
  assert.equal(result.status,0,result.stderr.toString());assert.deepEqual(result.stdout,packet);
});
test('formal C++ rejects old/mixed identities, forged markers, wrong types/signatures and capacities',{skip:!cpp},()=>{
  const {core}=generalStringProgram();
  const bad=[
    core.replace('version = "0.12.0"','version = "0.9.0"'),
    core.replace(/bytecode_schema = "sha256:[a-f0-9]+"/,'bytecode_schema = "sha256:'+'0'.repeat(64)+'"'),
    core.replace('tsfg_core.source_length =','tsfg_core.string = {}, tsfg_core.source_length ='),
    core.replace('tsfg_core.source_length =','tsfg_core.reference = {}, tsfg_core.source_length ='),
    core.replace('"tsfg_string.length"(%v0)','"tsfg_string.length"(%v1)'),
    core.replace('"tsfg_string.codeunit"(%v0, %v1)','"tsfg_string.codeunit"(%v0, %v0)'),
    core.replace('"tsfg_string.slice"(%v0, %v1, %v2)','"tsfg_string.slice"(%v0, %v1, %v0)'),
    core.replace('"tsfg_string.compare"(%v0, %v0)','"tsfg_core.add"(%v0, %v0)'),
    core.replace('callee = @"worker", tsfg_core.function_id = "sha256:','callee = @"worker", tsfg_core.function_id = "sha256:0'),
    core.replace('"tsfg_string.constant"() {code_units = array<i32>','"tsfg_string.constant"() {code_units = array<i32: 65536>'),
    generalStringProgram(513).core,
  ];
  for(const input of bad) {
    assert.notEqual(input,core);
    const result=spawnSync(cpp,['--emit-bytecode'],{input,maxBuffer:16*1024*1024,windowsHide:true});
    assert.equal(result.status,3,result.stderr.toString());assert.equal(result.stdout.length,0);
  }
});
test('formal C++ consumes every whole String module and matches independent complete packet gold',{skip:!cpp},()=>{
  for(const c of cases) {
    const core=lowerFormalHir(c.hir,c.context);
    const result=spawnSync(cpp,['--emit-bytecode'],{input:core,maxBuffer:16*1024*1024,windowsHide:true});
    assert.equal(result.status,0,result.stderr.toString());assert.deepEqual(result.stdout,expectedStringPacket(c.hir));
    const canonical=spawnSync(cpp,['--canonicalize'],{input:core,maxBuffer:16*1024*1024,windowsHide:true});
    assert.equal(canonical.status,0,canonical.stderr.toString());
    const roundtrip=spawnSync(cpp,['--emit-bytecode'],{input:canonical.stdout,maxBuffer:16*1024*1024,windowsHide:true});
    assert.equal(roundtrip.status,0,roundtrip.stderr.toString());assert.deepEqual(roundtrip.stdout,result.stdout);
  }
});
