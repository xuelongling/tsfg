// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {decodeCounterLeaf,inspectCounterObject,inspectCounterBridgeObject,validateCounterMcFacts,validateCounterBridgeMcFacts,writeHostCertificate} from '../../eng/host-counter.mjs';

// Independent x64 instruction bytes, fixed unsigned storage/event offsets and
// COFF scalar fields. These are not captured implementation outputs.
const bytes=Buffer.from('89d048ff410803018901c3','hex');
test('a byte scan and UNWIND allocation cannot publish an admitted host certificate',async()=>{
  const leaf={instructionUpperBound:5};
  // Rejection happens before any output write. This is the old insufficient
  // shape and deliberately uses no physical file as a fake proof authority.
  await assert.rejects(writeHostCertificate(undefined,leaf,{callBoundaryBytes:13248},true),/vm-host-certificate/);
});
function coff() {
  const name=Buffer.from('tsfg_host_counter\0'),symbol=71,strings=89;
  const file=Buffer.alloc(strings+4+name.length);
  file.writeUInt16LE(0x8664,0);file.writeUInt16LE(1,2);file.writeUInt32LE(symbol,8);file.writeUInt32LE(1,12);
  file.write('.text',20);file.writeUInt32LE(bytes.length,36);file.writeUInt32LE(60,40);file.writeUInt32LE(0x60000020,56);
  bytes.copy(file,60);file.writeUInt32LE(4,symbol+4);file.writeInt16LE(1,symbol+12);file.writeUInt16LE(0x20,symbol+14);file[symbol+16]=2;
  file.writeUInt32LE(4+name.length,strings);name.copy(file,strings+4);
  return file;
}

function bridgeCoff() {
  const code=Buffer.from('4883ec28e800000000904883c428c3','hex');
  const bridgeName=Buffer.from('tsfg_host_counter_bridge\0'),leafName=Buffer.from('tsfg_host_counter\0');
  const file=Buffer.alloc(173+bridgeName.length+leafName.length);
  file.writeUInt16LE(0x8664,0);file.writeUInt16LE(2,2);file.writeUInt32LE(133,8);file.writeUInt32LE(2,12);
  file.write('.text',20);file.writeUInt32LE(15,36);file.writeUInt32LE(100,40);file.writeUInt32LE(115,44);file.writeUInt16LE(1,52);file.writeUInt32LE(0x60000020,56);
  file.write('.xdata',60);file.writeUInt32LE(8,76);file.writeUInt32LE(125,80);
  code.copy(file,100);file.writeUInt32LE(5,115);file.writeUInt32LE(1,119);file.writeUInt16LE(4,123);
  Buffer.from('0104010004420000','hex').copy(file,125);
  file.writeUInt32LE(4,137);file.writeInt16LE(1,145);file.writeUInt16LE(32,147);file[149]=2;
  file.writeUInt32LE(4+bridgeName.length,155);file[167]=2;
  file.writeUInt32LE(4+bridgeName.length+leafName.length,169);bridgeName.copy(file,173);leafName.copy(file,173+bridgeName.length);
  return file;
}

// Independent multi-function layout: the unrelated phase has the first UW,
// while .pdata's second record resolves the fixed bridge to .xdata offset8.
function multiBridgeCoff() {
  const names=['tsfg_host_counter_bridge','tsfg_host_counter','phase_unqualified','.text','.phase','.xdata'];
  const strings=Buffer.from(names.map(n=>n+'\0').join(''));
  const file=Buffer.alloc(560+strings.length),symbol=448,stringTable=556;
  file.writeUInt16LE(0x8664,0);file.writeUInt16LE(4,2);file.writeUInt32LE(symbol,8);file.writeUInt32LE(names.length,12);
  /** @type {Array<[string, number, number, number, number, number]>} */
  const sections=[['.text',15,180,296,1,0x60000020],['.xdata',16,311,0,0,0x40000040],['.pdata',24,327,351,6,0x40000040],['.phase',101,195,0,0,0x60000020]];
  sections.forEach(([name,size,raw,relocs,count,flags],i)=>{const at=20+i*40;file.write(name,at);file.writeUInt32LE(size,at+16);file.writeUInt32LE(raw,at+20);file.writeUInt32LE(relocs,at+24);file.writeUInt16LE(count,at+32);file.writeUInt32LE(flags,at+36);});
  Buffer.from('4883ec28e800000000904883c428c3','hex').copy(file,180);file.fill(0x90,195,296);
  file.writeUInt32LE(5,296);file.writeUInt32LE(1,300);file.writeUInt16LE(4,304);
  Buffer.from('01470100716200000104010004420000','hex').copy(file,311);
  file.writeUInt32LE(101,331);file.writeUInt32LE(15,343);file.writeUInt32LE(8,347);
  [4,4,5,3,3,5].forEach((target,i)=>{const at=351+i*10;file.writeUInt32LE(i*4,at);file.writeUInt32LE(target,at+4);file.writeUInt16LE(3,at+8);});
  let nameOffset=4;names.forEach((name,i)=>{const at=symbol+i*18;file.writeUInt32LE(nameOffset,at+4);file.writeInt16LE([1,0,4,1,4,2][i],at+12);file.writeUInt16LE(i===0||i===2?32:0,at+14);file[at+16]=i<3?2:3;nameOffset+=name.length+1;});
  file.writeUInt32LE(4+strings.length,stringTable);strings.copy(file,stringTable+4);return file;
}

test('multi-function COFF binds only the bridge UW through actual pdata relocations',()=>{
  const proof=inspectCounterBridgeObject(multiBridgeCoff());
  assert.equal(proof.calleeStackBytes,40);assert.equal(proof.unwind.sectionOffset,8);
  assert.equal(proof.unwind.selection,'coff-pdata-relocations');
  assert.equal(proof.unqualifiedFunctions.length,1);
  assert.equal(proof.unqualifiedFunctions[0].resourceQualified,false);
  for(const change of [b=>b.writeUInt32LE(0,347),b=>b.writeUInt16LE(4,409),b=>b.writeUInt32LE(4,343),b=>b.writeUInt32LE(3,355),b=>b[326]=1]){
    const candidate=multiBridgeCoff();change(candidate);assert.throws(()=>inspectCounterBridgeObject(candidate),/vm-host-certificate/);
  }
});

test('Win64 bridge includes its actual NOP, shadow allocation and both future return slots',()=>{
  const bridge=inspectCounterBridgeObject(bridgeCoff());
  assert.equal(bridge.instructionUpperBound,5);
  assert.equal(bridge.calleeStackBytes,40);
  assert.equal(bridge.futureBoundaryBytes,56);
  assert.deepEqual(bridge.call,{offset:4,relocationOffset:5,type:4,symbol:'tsfg_host_counter'});
  for(const change of [b=>b.writeUInt32LE(0,119),b=>b.writeUInt16LE(5,123),b=>b[132]=1,b=>b[128]=1,b=>b[103]=48,b=>b[109]=0xcc]){
    const candidate=bridgeCoff();change(candidate);assert.throws(()=>inspectCounterBridgeObject(candidate),/vm-host-certificate/);
  }
});

test('bridge MC identities cannot replace its direct leaf with a helper, tail jump or loop',()=>{
  const bridge=inspectCounterBridgeObject(bridgeCoff()),offsets=[0,4,9,10,14],codes=['4883ec28','e800000000','90','4883c428','c3'];
  const names=[['RSP','RSP','40'],['0'],[],['RSP','RSP','40'],[]];
  const facts={version:'0.2.0',objectHash:bridge.objectHash,functions:[{name:bridge.symbol,codeHash:bridge.codeHash,sectionOffset:'0',size:'15',decodedInstructionCount:'5',nodes:offsets.map((offset,index)=>({
    offset:String(offset),bytes:codes[index],size:String(codes[index].length/2),decodedInstructionCount:'1',isCall:index===1,isReturn:index===4,isConditionalBranch:false,isUnconditionalBranch:false,
    operands:names[index].map(value=>/^\d+$/.test(value)?{kind:'immediate',value}:{kind:'register',name:value}),
    successors:index===4?[]:[String(offsets[index+1])],relocations:index===1?[{offset:'5',symbol:'tsfg_host_counter',type:'4'}]:[],
  }))}]};
  validateCounterBridgeMcFacts(facts,bridge);
  for(const change of [f=>f.objectHash='sha256:'+'0'.repeat(64),f=>f.functions[0].nodes[1].relocations[0].symbol='helper',f=>f.functions[0].nodes[1].isUnconditionalBranch=true,f=>f.functions[0].nodes[1].successors=['4'],f=>f.functions[0].nodes[0].operands[2].value='32',f=>f.functions[0].nodes.splice(2,1)]){
    const candidate=structuredClone(facts);change(candidate);assert.throws(()=>validateCounterBridgeMcFacts(candidate,bridge),/vm-host-certificate/);
  }
  const multi=inspectCounterBridgeObject(multiBridgeCoff()),extra=multi.unqualifiedFunctions[0];
  const full={...structuredClone(facts),objectHash:multi.objectHash};
  full.functions.push({name:extra.name,codeHash:extra.codeHash,sectionOffset:String(extra.sectionOffset),size:String(extra.size),decodedInstructionCount:'101',nodes:[]});
  validateCounterBridgeMcFacts(full,multi);
  for(const change of [f=>f.functions[1].codeHash='sha256:'+'0'.repeat(64),f=>f.functions[1].sectionOffset='1',f=>f.functions[1].size='100',f=>f.functions[1].name=multi.symbol,f=>f.functions.pop()]){
    const candidate=structuredClone(full);change(candidate);assert.throws(()=>validateCounterBridgeMcFacts(candidate,multi),/vm-host-certificate/);
  }
  assert.equal(extra.resourceQualified,false);
});
test('counter proof fixes unsigned 32-bit storage and unsigned 64-bit telemetry with a finite leaf',()=>{
  const proof=inspectCounterObject(coff());
  assert.equal(proof.codeHash,'sha256:'+createHash('sha256').update(bytes).digest('hex'));
  assert.equal(proof.instructionUpperBound,5);assert.equal(proof.calleeStackBytes,0);
  assert.equal(proof.contextBytes,16);assert.equal(proof.contextAlign,8);
  assert.deepEqual(proof.instructions.map(i=>i.offset),[0,2,6,8,10]);
});

test('fixed MC0.2 counter facts bind operands, exact context offsets, object identity and finite edges',()=>{
  const leaf=inspectCounterObject(coff());
  const tuples=[['EAX','EDX'],['RCX','1','','8',''],['EAX','EAX','RCX','1','','0',''],['RCX','1','','0','','EAX'],[]];
  const input={version:'0.2.0',objectHash:leaf.objectHash,functions:[{name:'tsfg_host_counter',codeHash:leaf.codeHash,sectionOffset:'0',size:'11',decodedInstructionCount:'5',nodes:leaf.instructions.map((instruction,index)=>({
    offset:String(instruction.offset),size:String(instruction.bytes.length/2),bytes:instruction.bytes,isCall:false,isReturn:index===4,isConditionalBranch:false,isUnconditionalBranch:false,decodedInstructionCount:'1',relocations:[],
    successors:index===4?[]:[String([0,2,6,8,10][index+1])],operands:tuples[index].map(value=>/^\d+$/.test(value)?{kind:'immediate',value}:{kind:'register',name:value}),
  }))}]};
  validateCounterMcFacts(input,leaf);
  for(const change of [
    copy=>copy.version='0.1.0',copy=>copy.objectHash='sha256:'+'0'.repeat(64),
    copy=>copy.functions[0].nodes[1].operands[3].value='16',
    copy=>copy.functions[0].nodes[0].operands[0].name='RAX',
    copy=>copy.functions[0].nodes[3].operands.at(-1).name='EDX',
    copy=>copy.functions[0].nodes[0].successors=['0'],
    copy=>copy.functions[0].nodes[3].isCall=true,
    copy=>copy.functions[0].nodes[3].relocations=[{target:'foreign'}],
  ]) { const candidate=structuredClone(input);change(candidate);assert.throws(()=>validateCounterMcFacts(candidate,leaf),/vm-host-certificate/); }
});
test('unknown helper, cycle, telemetry width, suffix and COFF identity cannot declare a host cost',()=>{
  for(const hex of ['e800000000'+bytes.toString('hex'),'75fe'+bytes.toString('hex'),'89d0ff410803018901c3',bytes.toString('hex')+'90'])
    assert.throws(()=>decodeCounterLeaf(Buffer.from(hex,'hex')),/vm-host-certificate/);
  for(const mutate of [b=>b.writeUInt16LE(0x14c,0),b=>b.writeUInt32LE(1,79),b=>b.writeUInt16LE(1,52),b=>b.writeUInt32LE(1,8)]){
    const candidate=coff();mutate(candidate);assert.throws(()=>inspectCounterObject(candidate),/vm-host-certificate/);
  }
});


test('unqualified certificates carry zero phase sentinels without granting admission',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'r03-unqualified-certificate-'));
  const file=path.join(directory,'unqualified-sentinel.unit.zig');
  await writeHostCertificate(file,{instructionUpperBound:5},null,false);
  const rendered=await readFile(file,'utf8');
  assert.match(rendered,/pub const qualified = false;/);
  assert.match(rendered,/pub const run_stack_bytes: usize = 0;/);
  assert.match(rendered,/pub const admission_stack_bytes: usize = 0;/);
  assert.match(rendered,/pub const execute_stack_bytes: usize = 0;/);
});


test('caller-created true flags cannot mint an admitted host certificate',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'r03-forged-counter-witness-'));
  const file=path.join(directory,'untrusted-flags.unit.zig');
  const forged={qualification:'closed-counter-call-boundary-v1',instructionBoundariesVerified:true,
    loadedCallGraphVerified:true,prePrologueAdmissionVerified:true,callBoundaryBytes:56,
    runStackBytes:128,admissionStackBytes:64,executeStackBytes:256};
  await assert.rejects(writeHostCertificate(file,{instructionUpperBound:5},forged,true),/vm-host-certificate/);
  await assert.rejects(readFile(file),{code:'ENOENT'});
});
