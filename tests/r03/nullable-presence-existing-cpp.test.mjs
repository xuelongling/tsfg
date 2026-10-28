// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
import {readNullablePacket} from './nullable-wire-reader.mjs';
import {encodePresencePacketOracle} from './nullable-presence-existing-packet-oracle.mjs';

// Root supplies the already accepted C++ executable and fresh owned capture root.
// This new group only parses/verifies/canonicalizes existing emitted Core and
// produces private packets. It never runs Source, native work or a guest/VM.
const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const read=async name=>readFile(new URL(name,import.meta.url));
const expected=JSON.parse((await read('./nullable-presence-existing-expected-packets.json')).toString('utf8'));
const coreBytes=await read('./nullable-presence-core-first.json');
const hirBytes=await read('./nullable-presence-hir-first.json');
const coreFixture=JSON.parse(coreBytes.toString('utf8'));
const hirFixture=JSON.parse(hirBytes.toString('utf8'));

for(const item of expected.cases)test('existing C++ preserves the entire emitted presence packet: '+item.name,async()=>{
 const core=coreFixture.cases.find(c=>c.name===item.name),hir=hirFixture.cases.find(c=>c.name===item.name);
 assert.ok(core&&hir);assert.equal(expected.cases.length,4);
 for(const [index,bytes] of [coreBytes,hirBytes].entries()) {
  const pin=expected.provenance.inputs[index];assert.equal(bytes.length,pin.bytes);assert.equal(digest(bytes),pin.sha256);
 }
 assert.equal(digest(core.expectedCore),core.expectedCoreSHA256);assert.equal(core.expectedCoreSHA256,item.expectedCoreSHA256);
 assert.equal(Buffer.byteLength(core.expectedCore),core.expectedCoreBytes);
 assert.equal(digest(hir.hirJcsNoLf),item.expectedHirSHA256);assert.deepEqual(JSON.parse(hir.hirJcsNoLf),hir.expectedHir);
 assert.equal(digest(hir.expectedHir.source.content),item.sourceHash);
 const authored=encodePresencePacketOracle(core,hir),packet=Buffer.from(item.packetHex,'hex');
 assert.equal(packet.length,item.packetBytes);assert.equal(digest(packet),item.packetSHA256);
 assert.deepEqual(authored.packet,packet);assert.deepEqual(authored.view,item.expectedView);
 const canonical=await invokeCore(core.expectedCore);accepted(canonical);
 const again=await invokeCore(canonical.stdout);accepted(again);
 assert.deepEqual(again.stdout,canonical.stdout,'second canonicalization is byte-stable');
 const emitted=await invokeCore(canonical.stdout,'--emit-nullable-candidate');accepted(emitted);
 assert.deepEqual(emitted.stdout,packet,'complete independent packet bytes');
 // One comparison covers every reader field, including exact EOF, offsets,
 // all function identities/roles, CF edges, typed registers and original ranges.
 assert.deepEqual(readNullablePacket(emitted.stdout),item.expectedView);
});
