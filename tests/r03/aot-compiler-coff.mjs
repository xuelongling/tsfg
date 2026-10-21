// SPDX-License-Identifier: MIT
// Test-local bounded COFF/stackmap data reader. It never decodes instructions.
import assert from 'node:assert/strict';
export function readCompilerCoff(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >=20 && bytes.length <=67108864);
  function range(offset,size) {
    assert.ok(Number.isSafeInteger(offset)&&Number.isSafeInteger(size)&&offset>=0&&size>=0
      &&offset<=bytes.length&&size<=bytes.length-offset,'COFF range');
    return bytes.subarray(offset,offset+size);
  }
  const u16=offset=>range(offset,2).readUInt16LE();
  const u32=offset=>range(offset,4).readUInt32LE();
  assert.equal(u16(0),0x8664,'AMD64 COFF');
  const count=u16(2),symbolOffset=u32(8),symbolCount=u32(12);
  assert.ok(count>0&&count<=128);assert.equal(u16(16),0,'ordinary object, no PE optional header');
  range(20,count*40);range(symbolOffset,symbolCount*18);
  const strings=symbolOffset+symbolCount*18,stringBytes=u32(strings);
  assert.ok(stringBytes>=4);range(strings,stringBytes);
  function string(offset) {
    assert.ok(offset>=4&&offset<stringBytes);
    const limit=strings+stringBytes,end=bytes.indexOf(0,strings+offset);
    assert.ok(end>=strings+offset&&end<limit);
    return new TextDecoder('utf8',{fatal:true}).decode(bytes.subarray(strings+offset,end));
  }
  function shortName(offset) {
    const field=range(offset,8),zero=field.indexOf(0);
    return new TextDecoder('utf8',{fatal:true}).decode(field.subarray(0,zero<0?8:zero));
  }
  const symbols=[],symbolByIndex=new Map();
  for(let index=0;index<symbolCount;) {
    const offset=symbolOffset+index*18;
    const name=u32(offset)===0?string(u32(offset+4)):shortName(offset);
    const auxiliary=range(offset+17,1)[0];
    assert.ok(index+auxiliary<symbolCount);
    const symbol={index,name,value:u32(offset+8),section:range(offset+12,2).readInt16LE(),
      type:u16(offset+14),storage:range(offset+16,1)[0],auxiliary};
    symbols.push(symbol);symbolByIndex.set(index,symbol);index+=1+auxiliary;
  }
  const sections=[];
  for(let index=0;index<count;index++) {
    const offset=20+index*40,short=shortName(offset);
    const name=short.startsWith('/')?string(Number(short.slice(1))):short;
    const size=u32(offset+16),dataOffset=u32(offset+20),relocOffset=u32(offset+24),relocCount=u16(offset+32);
    const characteristics=u32(offset+36);
    assert.equal(characteristics&0x01000000,0,'small fixture has no relocation-overflow table');
    const data=size?range(dataOffset,size):Buffer.alloc(0);range(relocOffset,relocCount*10);
    const relocations=[];
    for(let r=0;r<relocCount;r++) {
      const at=relocOffset+r*10,address=u32(at),symbol=symbolByIndex.get(u32(at+4)),type=u16(at+8);
      assert.ok(symbol&&address<size,'relocation references real section data and a primary symbol');
      relocations.push({address,symbol:symbol.name,type});
    }
    sections.push({index:index+1,name,size,characteristics,data,relocations});
  }
  const stackSection=sections.find(section=>section.name==='.llvm_stackmaps');
  assert.ok(stackSection,'real stackmap section');
  const data=stackSection.data;
  function stackRange(offset,size) {assert.ok(offset>=0&&size>=0&&offset+size<=data.length);return data.subarray(offset,offset+size);}
  const s16=offset=>stackRange(offset,2).readUInt16LE();
  const s32=offset=>stackRange(offset,4).readUInt32LE();
  const s64=offset=>stackRange(offset,8).readBigUInt64LE();
  assert.equal(stackRange(0,1)[0],3);assert.equal(stackRange(1,1)[0],0);assert.equal(s16(2),0);
  const functions=s32(4),constants=s32(8),records=s32(12);
  assert.ok(functions>0&&functions<=129&&constants<=65536&&records<=1000000);
  let cursor=16,totalRecords=0n;const frames=[];
  for(let index=0;index<functions;index++) {
    const address=cursor,recordCount=s64(cursor+16);
    const relocation=stackSection.relocations.find(row=>row.address===address);
    assert.ok(relocation&&relocation.type===1,'stackmap frame uses ADDR64 function relocation');
    const frame={symbol:relocation.symbol,stackSize:s64(cursor+8),records:recordCount};
    frames.push(frame);totalRecords+=recordCount;cursor+=24;
  }
  assert.equal(totalRecords,BigInt(records));cursor+=constants*8;stackRange(cursor,0);
  const ids=[];
  for(let index=0;index<records;index++) {
    ids.push(s64(cursor));const instructionOffset=s32(cursor+8);
    assert.equal(s16(cursor+12),0);const locations=s16(cursor+14);
    assert.ok(Number.isSafeInteger(instructionOffset)&&locations<=65535);
    cursor+=16;stackRange(cursor,locations*12);cursor+=locations*12;
    cursor=Math.ceil(cursor/8)*8;assert.equal(s16(cursor),0);
    const liveOuts=s16(cursor+2);cursor+=4;stackRange(cursor,liveOuts*4);cursor+=liveOuts*4;
    cursor=Math.ceil(cursor/8)*8;stackRange(cursor,0);
  }
  assert.equal(cursor,data.length,'complete stackmap data');
  assert.equal(new Set(ids.map(String)).size,ids.length,'frame and interval ids are unique');
  for(const symbol of symbols)assert.ok(!symbol.name.includes('tsfg_native_descriptor'));
  return {timestamp:u32(4),symbols,sections,stackmaps:{frames,ids,records}};
}
