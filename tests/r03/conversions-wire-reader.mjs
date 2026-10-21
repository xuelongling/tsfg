// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const names=['none','i32','bool','i8','i16','i64','u8','u16','u32','u64','isize','usize','f32','f64'];
// Independent reader for the complete ordinary one-parameter conversion table.
// No product emitter/Runtime imports, ignored records, or guest evaluator.
export function readConversions(packet,entries,schemaHash){
 let offset=0;
 const take=n=>{assert.ok(n>=0&&offset+n<=packet.length);const r=packet.subarray(offset,offset+n);offset+=n;return r;};
 const u8=()=>take(1)[0],u16=()=>take(2).readUInt16LE(),u32=()=>take(4).readUInt32LE();
 const string=()=>new TextDecoder('utf-8',{fatal:true}).decode(take(u32()));
 const digest=()=>take(32).toString('hex');
 assert.equal(take(8).toString(),'TSFGTBC0');assert.equal(u32(),11);
 assert.equal('sha256:'+digest(),schemaHash);assert.equal(u32(),packet.length);
 assert.equal(digest(),hash(packet.subarray(80)));
 assert.equal(string(),'windows-x86_64-msvc');assert.equal(string(),'x86_64-pc-windows-msvc');
 assert.equal(string(),'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128');
 assert.deepEqual([u16(),u16(),u16(),u16(),u32()],[4,4,64,8,119]);
 digest();digest();assert.equal(string(),'/src/main.ts');assert.equal(u32(),100);assert.equal(u8(),0);
 assert.equal(u16(),entries.length);
 for(const entry of entries){
  const from=names.indexOf(entry.from),to=names.indexOf(entry.to);
  const signature=hash('tsfg.signature\0('+entry.from+')->'+entry.to);
  assert.equal(digest(),hash('tsfg.function\0/src/main.ts\0'+entry.name+'\0'+signature));
  assert.equal(digest(),signature);assert.equal(digest(),hash('tsfg.type\0'+entry.to));
  assert.equal(string(),entry.name);assert.deepEqual([u32(),u32(),u8(),u8(),u8()],[0,100,to,1,from]);
  assert.deepEqual([u8(),u8()],[1,0]);
  assert.deepEqual([u16(),u16(),u16(),u16(),u16(),u8(),u8(),u16()],[2,1,3,1,0,from,0,3]);
  const instruction=()=>[u8(),u8(),u16(),u32(),u32(),u32()];
  assert.deepEqual(instruction(),[26,0,0,1,0,100]);
  assert.deepEqual(instruction(),[entry.mode==='checked'?40:entry.mode==='wrap'?41:42,to,1,from<<16,10,20]);
  assert.deepEqual(instruction(),[2,to,1,0,10,20]);
 }
 assert.equal(offset,packet.length,'all table bytes consumed');
}
