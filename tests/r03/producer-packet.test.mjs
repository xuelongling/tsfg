// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readCoreInputIdentity,verifyAotProducedObject,verifyAotProducedPacket,verifyProducedPacket} from '../../compiler/producer-packet.mjs';
import {expectedStringCore,expectedStringPacket,stringCases} from './formal-string-gold.mjs';
import {aotMetadataObject} from './aot-compiler-coff.mjs';

test('normal producer accepts the complete current independent packet without changing its bytes',()=>{
  const packet=expectedStringPacket(stringCases()[0].hir),before=Buffer.from(packet);
  verifyProducedPacket(packet);assert.deepEqual(packet,before);
});

test('AOT objects bind exported immutable program metadata to the checked Core and R04', () => {
  const [{hir}, {hir: other}] = stringCases();
  const wire = expectedStringPacket(hir);
  const digest = 'sha256:' + createHash('sha256').update('tsfg.aot-compiled-module.v4\0').update(wire).digest('hex');
  const object = aotMetadataObject(hir.inputIdentity, digest);
  assert.equal(verifyAotProducedObject(object, wire, hir.inputIdentity), digest);
  assert.throws(() => verifyAotProducedObject(object, expectedStringPacket(other), other.inputIdentity), /identity differs/);
  assert.throws(() => verifyAotProducedObject(object, wire, other.inputIdentity), /identity differs/);
  assert.throws(() => verifyAotProducedObject(object.subarray(0, -1), wire, hir.inputIdentity), /invalid compiled program metadata/);
});

test('the Core input identity belongs to the module in both printed forms',()=>{
  const [{hir},{hir:other}]=stringCases(),core=expectedStringCore(hir);
  const headEnd=core.indexOf('} {\n');
  const attributes=core.slice('module attributes {'.length,headEnd),body=core.slice(headEnd+4,-2);
  const generic='"builtin.module"() ({\n'+body+'}) {'+attributes+'} : () -> ()\n';
  const escaped=hir.inputIdentity.replace('sha256','sha\\3256');
  const aliased='#loc = loc("facts.ts":1:1)\n#7 = "'+escaped+'"\n'+core.replace('"'+hir.inputIdentity+'"','#7');
  for(const text of [core,generic,'// saved Core\n'+core,aliased]){
    const input=readCoreInputIdentity(text);
    assert.equal(input,hir.inputIdentity);
    verifyAotProducedPacket(expectedStringPacket(hir),input);
    assert.throws(()=>verifyAotProducedPacket(expectedStringPacket(other),input),/differs from the checked Core/);
  }
  const field='tsfg_core.input_identity = "'+hir.inputIdentity+'"';
  assert.equal(readCoreInputIdentity(core.replace(field+', ','')),undefined);
  assert.equal(readCoreInputIdentity(core.replace(field,field+', '+field)),undefined);
  assert.equal(readCoreInputIdentity(generic.replace(field+', ','tsfg_core.note = "'+hir.inputIdentity+'", ')),undefined);
});

test('normal producer rejects old/mixed identity, extent and checksum before publication',()=>{
  const packet=expectedStringPacket(stringCases()[0].hir);
  for(const change of [b=>b.writeUInt32LE(10,8),b=>b[12]^=1,b=>b.writeUInt32LE(b.length-1,44),b=>b[b.length-1]^=1]) {
    const changed=Buffer.from(packet);change(changed);
    assert.notDeepEqual(changed,packet);assert.throws(()=>verifyProducedPacket(changed),/r04-producer-identity/);
  }
});

test('normal producer requires the exact eight magic bytes',()=>{
  const packet=expectedStringPacket(stringCases()[0].hir);
  packet[0]^=0x80;
  assert.throws(()=>verifyProducedPacket(packet),/r04-producer-identity/);
});

test('normal producer bounds the complete packet envelope to one MiB',()=>{
  const original=expectedStringPacket(stringCases()[0].hir);
  const exact=Buffer.alloc(1024*1024),oversized=Buffer.alloc(exact.length+1);
  for(const packet of [exact,oversized]) {
    original.copy(packet);
    packet.writeUInt32LE(packet.length,44);
    createHash('sha256').update(packet.subarray(80)).digest().copy(packet,48);
  }
  verifyProducedPacket(exact);
  assert.throws(()=>verifyProducedPacket(oversized),/r04-producer-identity/);
});
