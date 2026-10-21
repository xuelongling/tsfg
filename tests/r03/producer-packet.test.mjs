// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProducedPacket} from '../../compiler/producer-packet.mjs';
import {stringCases,expectedStringPacket} from './formal-string-gold.mjs';

test('normal producer accepts the complete current independent packet without changing its bytes',()=>{
  const packet=expectedStringPacket(stringCases()[0].hir),before=Buffer.from(packet);
  verifyProducedPacket(packet);assert.deepEqual(packet,before);
});

test('normal producer rejects old/mixed identity, extent and checksum before publication',()=>{
  const packet=expectedStringPacket(stringCases()[0].hir);
  for(const change of [b=>b.writeUInt32LE(10,8),b=>b[12]^=1,b=>b.writeUInt32LE(b.length-1,44),b=>b[b.length-1]^=1]) {
    const changed=Buffer.from(packet);change(changed);
    assert.notDeepEqual(changed,packet);assert.throws(()=>verifyProducedPacket(changed),/r04-producer-identity/);
  }
});
