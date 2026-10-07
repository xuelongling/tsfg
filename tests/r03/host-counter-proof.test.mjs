// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {decodeCounterLeaf,inspectCounterObject} from '../../eng/host-counter.mjs';

// Independent x64 instruction bytes, fixed unsigned storage/event offsets and
// COFF scalar fields. These are not captured implementation outputs.
const bytes=Buffer.from('89d048ff410803018901c3','hex');
function coff() {
  const name=Buffer.from('tsfg_host_counter\0'),symbol=71,strings=89;
  const file=Buffer.alloc(strings+4+name.length);
  file.writeUInt16LE(0x8664,0);file.writeUInt16LE(1,2);file.writeUInt32LE(symbol,8);file.writeUInt32LE(1,12);
  file.write('.text',20);file.writeUInt32LE(bytes.length,36);file.writeUInt32LE(60,40);file.writeUInt32LE(0x60000020,56);
  bytes.copy(file,60);file.writeUInt32LE(4,symbol+4);file.writeInt16LE(1,symbol+12);file.writeUInt16LE(0x20,symbol+14);file[symbol+16]=2;
  file.writeUInt32LE(4+name.length,strings);name.copy(file,strings+4);
  return file;
}
test('counter proof fixes unsigned 32-bit storage and unsigned 64-bit telemetry with a finite leaf',()=>{
  const proof=inspectCounterObject(coff());
  assert.equal(proof.codeHash,'sha256:'+createHash('sha256').update(bytes).digest('hex'));
  assert.equal(proof.instructionUpperBound,5);assert.equal(proof.calleeStackBytes,0);
  assert.equal(proof.contextBytes,16);assert.equal(proof.contextAlign,8);
  assert.deepEqual(proof.instructions.map(i=>i.offset),[0,2,6,8,10]);
});
test('unknown helper, cycle, telemetry width, suffix and COFF identity cannot declare a host cost',()=>{
  for(const hex of ['e800000000'+bytes.toString('hex'),'75fe'+bytes.toString('hex'),'89d0ff410803018901c3',bytes.toString('hex')+'90'])
    assert.throws(()=>decodeCounterLeaf(Buffer.from(hex,'hex')),/vm-host-certificate/);
  for(const mutate of [b=>b.writeUInt16LE(0x14c,0),b=>b.writeUInt32LE(1,79),b=>b.writeUInt16LE(1,52),b=>b.writeUInt32LE(1,8)]){
    const candidate=coff();mutate(candidate);assert.throws(()=>inspectCounterObject(candidate),/vm-host-certificate/);
  }
});
