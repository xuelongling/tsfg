// SPDX-License-Identifier: MIT
import {createHash} from 'node:crypto';
import {lstat,open,readFile,realpath,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {canonical,own} from '../compiler/identity.mjs';

const digest=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const reject=()=>{throw new TypeError('vm-host-certificate: unknown code, ABI, stack or producer identity');};
// Only this producer can issue witness objects. A linked-byte observation is
// diagnostic evidence, never a complete loaded Runtime/phase proof.
const linkedCounterWitnesses=new WeakMap();
function bounded(bytes,offset,length) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||offset+length>bytes.length)reject();
  return bytes.subarray(offset,offset+length);
}
function cstring(bytes,offset,maximum) {
  const chunk=bounded(bytes,offset,maximum),end=chunk.indexOf(0);
  if(end<0)reject();return new TextDecoder('utf-8',{fatal:true}).decode(chunk.subarray(0,end));
}

/** A closed decoder for the Runtime-owned counter only, not a guest backend.
 * Every accepted byte has a fixed x64 meaning; no branch, call, helper, cookie,
 * dynamic address, stack instruction or unknown suffix can enter the summary.
 * Official X86 MC independently checks these boundaries during publication. */
export function decodeCounterLeaf(code) {
  const shapes=[
    ['89d0','mov eax,edx'],['48ff4108','inc qword ptr [rcx+8]'],
    ['0301','add eax,dword ptr [rcx]'],
    ['8901','mov dword ptr [rcx],eax'],['c3','ret'],
  ];
  if(code.toString('hex')!==shapes.map(([bytes])=>bytes).join(''))reject();
  let offset=0;
  return shapes.map(([hex,intel])=>{const entry={offset,bytes:hex,intel};offset+=hex.length/2;return entry;});
}

export function inspectCounterObject(bytes) {
  if(bytes.length<20||bytes.readUInt16LE(0)!==0x8664||bytes.readUInt16LE(16)!==0)reject();
  const count=bytes.readUInt16LE(2),symbols=bytes.readUInt32LE(8),symbolCount=bytes.readUInt32LE(12);
  if(!count||count>64||!symbolCount||symbolCount>4096)reject();
  bounded(bytes,20,count*40);bounded(bytes,symbols,symbolCount*18);
  const strings=symbols+symbolCount*18;bounded(bytes,strings,4);
  const stringSize=bytes.readUInt32LE(strings);if(stringSize<4)reject();bounded(bytes,strings,stringSize);
  let section;
  for(let index=0;index<symbolCount;){
    const offset=symbols+index*18,aux=bytes[offset+17];
    if(index+aux>=symbolCount)reject();
    const name=bytes.readUInt32LE(offset)===0
      ? cstring(bytes,strings+bytes.readUInt32LE(offset+4),stringSize-bytes.readUInt32LE(offset+4))
      : bytes.subarray(offset,offset+8).toString('ascii').replace(/\0.*$/,'');
    if(name==='tsfg_host_counter'){
      if(section!==undefined||bytes.readUInt32LE(offset+8)!==0||bytes.readUInt16LE(offset+14)!==0x20||bytes[offset+16]!==2)reject();
      section=bytes.readInt16LE(offset+12)-1;
    }
    index+=aux+1;
  }
  if(section===undefined||section<0||section>=count)reject();
  const header=20+section*40,size=bytes.readUInt32LE(header+16),raw=bytes.readUInt32LE(header+20);
  if(bytes.readUInt16LE(header+32)!==0||(bytes.readUInt32LE(header+36)&0x20000000)===0)reject();
  const code=bounded(bytes,raw,size),instructions=decodeCounterLeaf(code);
  return {symbol:'tsfg_host_counter',codeHash:digest(code),objectHash:digest(bytes),codeHex:code.toString('hex'),instructions,instructionUpperBound:instructions.length,calleeStackBytes:0,contextBytes:16,contextAlign:8};
}

/** Closed Win64 bridge object. Only one direct call to the fixed counter is
 * accepted; this certificate fragment grants no authority to arbitrary C. */
export function inspectCounterBridgeObject(bytes) {
  if(bytes.length<20||bytes.readUInt16LE(0)!==0x8664||bytes.readUInt16LE(16)!==0)reject();
  const count=bytes.readUInt16LE(2),symbols=bytes.readUInt32LE(8),symbolCount=bytes.readUInt32LE(12);
  if(!count||count>64||!symbolCount||symbolCount>4096)reject();
  bounded(bytes,20,count*40);bounded(bytes,symbols,symbolCount*18);
  const strings=symbols+symbolCount*18;bounded(bytes,strings,4);
  const stringSize=bytes.readUInt32LE(strings);if(stringSize<4)reject();bounded(bytes,strings,stringSize);
  const entries=new Map();let bridge;
  for(let index=0;index<symbolCount;){
    const at=symbols+index*18,aux=bytes[at+17];if(index+aux>=symbolCount)reject();
    const name=bytes.readUInt32LE(at)===0
      ? cstring(bytes,strings+bytes.readUInt32LE(at+4),stringSize-bytes.readUInt32LE(at+4))
      : bytes.subarray(at,at+8).toString('ascii').replace(/\0.*$/,'');
    const entry={name,value:bytes.readUInt32LE(at+8),section:bytes.readInt16LE(at+12),type:bytes.readUInt16LE(at+14),storage:bytes[at+16]};
    entries.set(index,entry);
    if(name==='tsfg_host_counter_bridge'){
      if(bridge||entry.value!==0||entry.section<=0||entry.section>count||entry.type!==32||entry.storage!==2||aux!==0)reject();
      bridge=entry;
    }
    index+=aux+1;
  }
  if(!bridge)reject();
  const header=20+(bridge.section-1)*40,size=bytes.readUInt32LE(header+16),raw=bytes.readUInt32LE(header+20);
  const code=bounded(bytes,raw,size),hex='4883ec28e800000000904883c428c3';
  if(code.toString('hex')!==hex||bytes.readUInt16LE(header+32)!==1||(bytes.readUInt32LE(header+36)&0x20000000)===0)reject();
  const relocation=bytes.readUInt32LE(header+24);bounded(bytes,relocation,10);
  const target=entries.get(bytes.readUInt32LE(relocation+4));
  if(bytes.readUInt32LE(relocation)!==5||bytes.readUInt16LE(relocation+8)!==4
    ||target?.name!=='tsfg_host_counter'||target.section!==0||target.value!==0||target.storage!==2||target.type!==0)reject();
  const sections=[];
  for(let index=0;index<count;index++){
    const at=20+index*40;
    sections.push({name:bytes.subarray(at,at+8).toString('ascii').replace(/\0.*$/,''),
      size:bytes.readUInt32LE(at+16),raw:bytes.readUInt32LE(at+20),
      relocation:bytes.readUInt32LE(at+24),relocations:bytes.readUInt16LE(at+32)});
  }
  const matches=[],pdata=sections.filter(s=>s.name==='.pdata');
  for(const section of pdata){
    if(section.size===0||section.size%12||section.relocations!==section.size/4)reject();
    const data=bounded(bytes,section.raw,section.size),relocations=new Map();
    bounded(bytes,section.relocation,section.relocations*10);
    for(let i=0;i<section.relocations;i++){
      const at=section.relocation+i*10,offset=bytes.readUInt32LE(at),target=entries.get(bytes.readUInt32LE(at+4));
      if(offset%4||offset+4>section.size||relocations.has(offset)||bytes.readUInt16LE(at+8)!==3
        ||!target||target.section<=0||target.section>count)reject();
      relocations.set(offset,{section:target.section,offset:target.value+data.readUInt32LE(offset)});
    }
    for(let at=0;at<section.size;at+=12){
      const start=relocations.get(at),end=relocations.get(at+4),uw=relocations.get(at+8);
      if(!start||!end||!uw)reject();
      if(start.section===bridge.section&&start.offset===bridge.value){
        if(end.section!==bridge.section||end.offset!==bridge.value+size||uw.offset%4)reject();
        const source=sections[uw.section-1];
        if(source.name!=='.xdata'||uw.offset+8>source.size)reject();
        matches.push({section:uw.section,sectionOffset:uw.offset,selection:'coff-pdata-relocations',
          code:bounded(bytes,source.raw+uw.offset,8)});
      }
    }
  }
  // Legacy single-fragment fixtures have one complete .xdata and no pdata.
  // A multi-function object never receives authority from scanning UW bytes.
  if(pdata.length===0){
    const uw=sections.map((s,i)=>({...s,section:i+1})).filter(s=>s.name==='.xdata');
    if(uw.length!==1||uw[0].size!==8||[...entries.values()].some(s=>s.storage===2&&s.type===32&&s.section>0&&s!==bridge))reject();
    matches.push({section:uw[0].section,sectionOffset:0,selection:'single-complete-xdata',code:bounded(bytes,uw[0].raw,8)});
  }
  // Version1/no flags, prologue4, ALLOC_SMALL(40) at offset4, no chained or
  // handler-controlled unwinding and no saved register slots.
  if(matches.length!==1||matches[0].code.toString('hex')!=='0104010004420000')reject();
  const unqualifiedFunctions=[...entries.values()].filter(s=>s.storage===2&&s.type===32&&s.section>0&&s!==bridge).map(s=>{
    if(s.section>count)reject();const section=sections[s.section-1];
    const next=[...entries.values()].filter(n=>n.storage===2&&n.type===32&&n.section===s.section&&n.value>s.value).map(n=>n.value);
    const end=Math.min(section.size,...next);if(s.value>=end)reject();
    const code=bounded(bytes,section.raw+s.value,end-s.value);
    return {name:s.name,sectionOffset:s.value,size:code.length,codeHash:digest(code),resourceQualified:false};
  });
  return {symbol:'tsfg_host_counter_bridge',objectHash:digest(bytes),codeHash:digest(code),codeHex:hex,
    instructionUpperBound:5,calleeStackBytes:40,incomingReturnBytes:8,leafIncomingReturnBytes:8,
    futureBoundaryBytes:56,call:{offset:4,relocationOffset:5,type:4,symbol:'tsfg_host_counter'},
    unwind:{section:matches[0].section,sectionOffset:matches[0].sectionOffset,selection:matches[0].selection,codeHex:matches[0].code.toString('hex')},unqualifiedFunctions};
}

export function validateCounterBridgeMcFacts(inspected,bridge) {
  const other=bridge.unqualifiedFunctions??[];
  if(inspected.version!=='0.2.0'||inspected.objectHash!==bridge.objectHash||inspected.functions?.length!==1+other.length)reject();
  const selected=inspected.functions.filter(fn=>fn.name===bridge.symbol);if(selected.length!==1)reject();
  for(const fragment of other){
    const found=inspected.functions.filter(fn=>fn.name===fragment.name);
    if(found.length!==1||found[0].codeHash!==fragment.codeHash||found[0].sectionOffset!==String(fragment.sectionOffset)||found[0].size!==String(fragment.size))reject();
  }
  // Other functions are byte-bound to the same object, never certified as a
  // caller, runtime entry, loaded graph, stack cost or resource envelope.
  const fn=selected[0],offsets=[0,4,9,10,14],codes=['4883ec28','e800000000','90','4883c428','c3'];
  const operands=[['RSP','RSP','40'],['0'],[],['RSP','RSP','40'],[]];
  if(fn.name!==bridge.symbol||fn.codeHash!==bridge.codeHash||fn.sectionOffset!=='0'||fn.size!=='15'||fn.decodedInstructionCount!=='5'||fn.nodes?.length!==5)reject();
  for(let index=0;index<5;index++){
    const node=fn.nodes[index],names=node.operands?.map(o=>o.kind==='register'?o.name:o.kind==='immediate'?o.value:null);
    if(node.offset!==String(offsets[index])||node.size!==String(codes[index].length/2)||node.bytes!==codes[index]
      ||node.isCall!==(index===1)||node.isReturn!==(index===4)||node.isConditionalBranch!==false||node.isUnconditionalBranch!==false
      ||node.decodedInstructionCount!=='1'||JSON.stringify(names)!==JSON.stringify(operands[index])
      ||JSON.stringify(node.successors)!==JSON.stringify(index===4?[]:[String(offsets[index+1])])
      ||JSON.stringify(node.relocations)!==JSON.stringify(index===1?[{offset:'5',symbol:'tsfg_host_counter',type:'4'}]:[]))reject();
  }
}

export function inspectCounterLink(bytes,leaf) {
  if(bytes.length<64||bytes.readUInt16LE(0)!==0x5a4d)reject();
  const pe=bytes.readUInt32LE(60);bounded(bytes,pe,24);
  if(bytes.readUInt32LE(pe)!==0x4550||bytes.readUInt16LE(pe+4)!==0x8664)reject();
  const count=bytes.readUInt16LE(pe+6),optional=pe+24,size=bytes.readUInt16LE(pe+20);
  bounded(bytes,optional,size);
  if(count<1||count>96||size<240||bytes.readUInt16LE(optional)!==0x20b)reject();
  const sections=[];
  for(let index=0;index<count;index++){
    const at=optional+size+index*40;bounded(bytes,at,40);
    sections.push({rva:bytes.readUInt32LE(at+12),size:bytes.readUInt32LE(at+16),raw:bytes.readUInt32LE(at+20),flags:bytes.readUInt32LE(at+36)});
  }
  const file=(rva,length)=>{
    const section=sections.find(s=>rva>=s.rva&&rva+length<=s.rva+s.size);if(!section)reject();
    return section.raw+rva-section.rva;
  };
  const text=sections.filter(s=>(s.flags&0x20000000)!==0),code=Buffer.from(leaf.codeHex,'hex');
  const matches=[];
  for(const section of text){const raw=bounded(bytes,section.raw,section.size);for(let at=raw.indexOf(code);at>=0;at=raw.indexOf(code,at+1))matches.push(section.rva+at);}
  if(matches.length!==1)reject();
  const RVA=matches[0],unwindRva=bytes.readUInt32LE(optional+112+3*8),unwindSize=bytes.readUInt32LE(optional+116+3*8);
  if(!unwindSize||unwindSize%12||unwindSize>1048576)reject();
  const table=file(unwindRva,unwindSize),entries=[];
  for(let at=table;at<table+unwindSize;at+=12)entries.push({start:bytes.readUInt32LE(at),end:bytes.readUInt32LE(at+4),unwind:bytes.readUInt32LE(at+8)});
  const calls=[];
  for(const section of text){
    const raw=bounded(bytes,section.raw,section.size);
    for(let at=0;at+5<=raw.length;at++)if(raw[at]===0xe8&&section.rva+at+5+raw.readInt32LE(at+1)===RVA){
      const callRva=section.rva+at,owners=entries.filter(e=>e.start<=callRva&&callRva+5<=e.end);
      if(owners.length!==1)reject();
      const owner=owners[0],u=file(owner.unwind,4),version=bytes[u]&7,flags=bytes[u]>>3,n=bytes[u+2];
      if(version!==1||flags!==0||!n)reject();
      const unwind=bounded(bytes,u+4,n*2);let stack=0;
      for(let slot=0;slot<n;slot++){
        const op=unwind[slot*2+1]&15,info=unwind[slot*2+1]>>4;
        if(op===0)stack+=8;
        else if(op===1){
          if(info===0){if(slot+1>=n)reject();stack+=unwind.readUInt16LE((slot+1)*2)*8;slot+=1;}
          else if(info===1){if(slot+2>=n)reject();stack+=unwind.readUInt32LE((slot+1)*2);slot+=2;}
          else reject();
        }else if(op===2)stack+=info*8+8;
        else if(op===3){if(info!==0)reject();}
        else if(op===4||op===8){if(slot+1>=n)reject();slot+=1;}
        else if(op===5||op===9){if(slot+2>=n)reject();slot+=2;}
        else reject();
      }
      // Complete fixed caller allocation includes ABI shadow/outgoing slots,
      // saved registers and its guard contribution. Add the leaf incoming
      // return address once; leaf has no additional stack allocation.
      if(stack<32||stack>1048576)reject();
      calls.push({callRva,callerStart:owner.start,callerEnd:owner.end,callerStackBytes:stack,incomingReturnBytes:8,callBoundaryBytes:stack+8});
    }
  }
  if(calls.length!==1)reject();
  const linked={RVA,linkedRuntimeHash:digest(bytes),calls,callBoundaryBytes:calls[0].callBoundaryBytes};
  linkedCounterWitnesses.set(linked,Object.freeze({kind:'linked-counter-diagnostic',
    linkedRuntimeHash:linked.linkedRuntimeHash,leafObjectHash:leaf.objectHash,leafCodeHash:leaf.codeHash,
    instructionUpperBound:leaf.instructionUpperBound,callBoundaryBytes:linked.callBoundaryBytes,phaseBounds:null}));
  return linked;
}

/** The external producer is an independently built official-X86-MC consumer.
 * Its exact executable/manifest identities join the host summary. */
export function validateCounterMcFacts(inspected,leaf) {
  if(inspected.version!=='0.2.0'||inspected.objectHash!==leaf.objectHash||inspected.functions?.length!==1)reject();
  const fn=inspected.functions[0];
  if(fn.name!==leaf.symbol||fn.codeHash!==leaf.codeHash||fn.sectionOffset!=='0'||fn.size!==String(leaf.codeHex.length/2)
    ||fn.decodedInstructionCount!==String(leaf.instructionUpperBound)||fn.nodes?.length!==leaf.instructions.length)reject();
  // LLVM MC memory tuples are base, scale, index, displacement, segment.
  // This fixes the actual ABI registers and context offsets independently of
  // numeric LLVM register IDs, which are implementation identities.
  const operands=[['EAX','EDX'],['RCX','1','','8',''],['EAX','EAX','RCX','1','','0',''],['RCX','1','','0','','EAX'],[]];
  for(const [index,instruction] of leaf.instructions.entries()){
    const node=fn.nodes[index],next=leaf.instructions[index+1];
    const names=node.operands?.map(operand=>operand.kind==='register'?operand.name:operand.kind==='immediate'?operand.value:null);
    if(node.offset!==String(instruction.offset)||node.size!==String(instruction.bytes.length/2)
      ||node.bytes.toLowerCase()!==instruction.bytes||node.isCall!==false||node.isReturn!==(next===undefined)
      ||node.isConditionalBranch!==false||node.isUnconditionalBranch!==false
      ||node.decodedInstructionCount!=='1'||node.relocations?.length!==0
      ||JSON.stringify(names)!==JSON.stringify(operands[index])
      ||JSON.stringify(node.successors)!==JSON.stringify(next?[String(next.offset)]:[]))reject();
  }
}

export async function verifyCounterMc(executable,object,leaf,lock,receiptPath,role='leaf') {
  if(!executable)reject();
  if(!['leaf','bridge'].includes(role)||lock?.status!=='admitted'||lock.issuer!=='tsfg-compiler-control-plane'||lock.purpose!=='runtime-owned-counter-call-graph-mc'
    ||lock.authorityDomain!=='fixed-runtime-counter-leaf-and-owned-bridge-only'||lock.protocolVersion!=='0.2.0'
    ||lock.inputFormat!=='AMD64-COFF'||lock.maxInputBytes!==16777216||!/^sha256:[0-9a-f]{64}$/.test(lock.proofIdentity??''))reject();
  const policy=lock.adapterCodePolicy?.find(item=>item.role===role);
  if(lock.adapterCodePolicy?.length!==2||policy?.symbol!==leaf.symbol||policy.codeHash!==leaf.codeHash
    ||policy.instructionUpperBound!==leaf.instructionUpperBound||policy.calleeStackBytes!==leaf.calleeStackBytes)reject();
  const manifestBytes=await readFile(path.join(path.dirname(executable),'artifact-manifest.json'));
  const manifest=JSON.parse(manifestBytes.toString("utf8")),binary=await readFile(executable);
  if(digest(manifestBytes)!==lock.manifestSha256||digest(binary)!==lock.executableSha256
    ||manifest.buildInputSet?.digest!==lock.buildInputSetDigest||manifest.buildIdentity?.digest!==lock.buildIdentityDigest
    ||manifest.toolchainClosureDigest!==lock.toolchainClosureDigest||canonical(manifest.outputs)!==canonical(lock.outputs))reject();
  if(lock.implementation?.length!==2||!lock.implementation.every(item=>manifest.buildInputSet?.entries.some(e=>e.projectId==='tsfg'&&e.repositoryRelativePath===item.path&&e.sha256===item.sha256)))reject();
  if(manifest.buildIdentity?.profile!=='debug'||manifest.buildIdentity?.target!=='windows-x86_64-msvc'
    ||manifest.outputs?.find(e=>e.path===path.basename(executable))?.sha256!==digest(binary)
    ||!['compiler/core-ir/main.cpp','compiler/core-ir/native_cost.cpp','compiler/core-ir/native_cost.h'].every(name=>manifest.buildInputSet?.entries.some(e=>e.projectId==='tsfg'&&e.repositoryRelativePath===name)))reject();
  const inputPayload={...manifest.buildInputSet};delete inputPayload.digest;
  const identityPayload={...manifest.buildIdentity};delete identityPayload.digest;
  if(digest(canonical(inputPayload))!==manifest.buildInputSet.digest
    ||manifest.buildIdentity.buildInputSetDigest!==manifest.buildInputSet.digest
    ||digest(canonical(identityPayload))!==manifest.buildIdentity.digest)reject();
  const outputs=[];
  for(const output of manifest.outputs){
    if(typeof output.path!=='string'||path.basename(output.path)!==output.path||!/^sha256:[0-9a-f]{64}$/.test(output.sha256))reject();
    const raw=await readFile(path.join(path.dirname(executable),output.path));if(digest(raw)!==output.sha256)reject();
    outputs.push({path:output.path,sha256:output.sha256});
  }
  const noticeOutput=manifest.outputs.find(e=>e.path==='source-notices.json');if(!noticeOutput)reject();
  const notices=JSON.parse(await readFile(path.join(path.dirname(executable),noticeOutput.path),'utf8'));
  if(notices.actualConsumption?.status!=='selected-build-legal-inputs-verified'
    ||!Array.isArray(notices.actualConsumption.files)||!Array.isArray(notices.actualConsumption.licenseMaterials))reject();
  const input=await readFile(object);
  if(input.length>lock.maxInputBytes||digest(input)!==leaf.objectHash)reject();
  const result=spawnSync(executable,['--inspect-native-instructions'],{input,windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
  if(!receiptPath||!/^E:[\\/]/i.test(receiptPath))reject();
  const rawBuffers={};
  for(const [channel,buffer] of [['stdin',input],['stdout',result.stdout],['stderr',result.stderr]]){
    const state={path:receiptPath+'.'+channel+'.bin',observed:Buffer.isBuffer(buffer),bytes:Buffer.isBuffer(buffer)?buffer.length:null,
      sha256:Buffer.isBuffer(buffer)?digest(buffer):null,writeBytes:0,opened:false,WX:true,fsync:false,writeClosed:false,errors:[]};
    rawBuffers[channel]=state;
    if(!Buffer.isBuffer(buffer)){state.errors.push({lane:'capture',message:'MC result did not provide a Buffer'});continue;}
    let file;
    try{
      file=await open(state.path,'wx');state.opened=true;
      while(state.writeBytes<buffer.length){
        const written=await file.write(buffer,state.writeBytes,buffer.length-state.writeBytes,null);
        if(written.bytesWritten===0)throw new Error('short MC raw write');
        state.writeBytes+=written.bytesWritten;
      }
      await file.sync();state.fsync=true;
    }catch(error){state.errors.push({lane:'write',message:String(error)});}
    finally{if(file){try{await file.close();state.writeClosed=true;}catch(error){state.errors.push({lane:'close',message:String(error)});}}}
  }
  await writeFile(receiptPath,JSON.stringify({kind:'actual-fixed-mc-helper-invocation',qualification:'leaf MC inspection only; no caller/Runtime resource credit',
    issuer:lock.issuer,purpose:lock.purpose,proofIdentity:lock.proofIdentity,role,
    before:{executableSha256:digest(binary),manifestSha256:digest(manifestBytes),objectHash:digest(input)},
    command:{executable,args:['--inspect-native-instructions'],inputHash:digest(input)},
    rawBuffers,
    originalChild:{pid:result.pid,exit:result.status,signal:result.signal,error:result.error?.message??null,stdout:result.stdout?.toString('utf8')??'',stderr:result.stderr?.toString('utf8')??''},
    after:{executableSha256:digest(await readFile(executable)),manifestSha256:digest(await readFile(path.join(path.dirname(executable),'artifact-manifest.json'))),objectHash:digest(await readFile(object))}},null,2)+'\n');
  if(Object.values(rawBuffers).some(state=>!state.observed||state.errors.length!==0||!state.fsync||!state.writeClosed||state.writeBytes!==state.bytes))reject();
  if(result.error||result.status!==0)reject();
  const inspected=JSON.parse(result.stdout.toString("utf8"));
  if(role==='leaf')validateCounterMcFacts(inspected,leaf);else validateCounterBridgeMcFacts(inspected,leaf);
  if(digest(await readFile(object))!==leaf.objectHash||digest(await readFile(executable))!==lock.executableSha256
    ||digest(await readFile(path.join(path.dirname(executable),'artifact-manifest.json')))!==lock.manifestSha256)reject();
  return {executableHash:digest(binary),manifestHash:digest(manifestBytes),buildIdentity:manifest.buildIdentity,buildInputSet:manifest.buildInputSet,
    outputs,sourceCommit:notices.sourceCommit,legalNoticeHash:noticeOutput.sha256,
    issuer:lock.issuer,purpose:lock.purpose,protocolVersion:lock.protocolVersion,proofIdentity:lock.proofIdentity,role,
    command:{executable,args:['--inspect-native-instructions'],inputHash:leaf.objectHash},
    stdout:result.stdout.toString('utf8'),stderr:result.stderr.toString('utf8'),exit:result.status,leafCodeHash:leaf.codeHash};
}

export async function writeHostCertificate(file,leaf,linked,qualified) {
  // Caller-supplied labels are not proof authority. The normal observer issues
  // only diagnostic witnesses; a real closed Runtime verifier must issue the
  // complete witness before any positive certificate can be rendered.
  const witness=linked&&linkedCounterWitnesses.get(linked);
  if(qualified&&(!witness||witness.kind!=='closed-counter-call-boundary-v1'
    ||witness.linkedRuntimeHash!==linked.linkedRuntimeHash||witness.leafObjectHash!==leaf?.objectHash
    ||witness.leafCodeHash!==leaf?.codeHash||witness.instructionUpperBound!==leaf?.instructionUpperBound
    ||witness.callBoundaryBytes!==linked.callBoundaryBytes
    ||witness.instructionBoundariesVerified!==true||witness.loadedCallGraphVerified!==true
    ||witness.prePrologueAdmissionVerified!==true||!witness.phaseBounds
    ||!['runStackBytes','admissionStackBytes','executeStackBytes'].every(name=>
      Number.isSafeInteger(witness.phaseBounds[name])&&witness.phaseBounds[name]>0)))reject();
  const phases=qualified?witness.phaseBounds:{runStackBytes:0,admissionStackBytes:0,executeStackBytes:0};
  await writeFile(file,`// Generated from actual Runtime-owned machine code; retained in build evidence.\npub const qualified = ${qualified};\npub const instruction_upper_bound: u64 = ${leaf?.instructionUpperBound??0};\npub const call_boundary_bytes: usize = ${linked?.callBoundaryBytes??0};\npub const run_stack_bytes: usize = ${phases.runStackBytes};\npub const admission_stack_bytes: usize = ${phases.admissionStackBytes};\npub const execute_stack_bytes: usize = ${phases.executeStackBytes};\n`);
}

export async function prepareHostCounter({productRoot,product,stage,tools,environment,run}) {
  const object=path.join(stage,'host_counter.obj'),source=path.join(product,'runtime/host_counter.c');
  const bridgeObject=path.join(stage,'host_counter_bridge.obj'),bridgeSource=path.join(product,'runtime/host_counter_bridge.c');
  const compilerBytes=await readFile(tools.clangcl),sourceBytes=await readFile(source),bridgeBytes=await readFile(bridgeSource);
  const relativeHeaders=['llvm/lib/clang/22/include/stdint.h','msvc-tools/VC/Tools/MSVC/14.44.35207/include/stdint.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/vcruntime.h','msvc-tools/VC/Tools/MSVC/14.44.35207/include/sal.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/concurrencysal.h','llvm/lib/clang/22/include/vadefs.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/vadefs.h'];
  const closure=path.resolve(path.dirname(tools.clangcl),'../..');
  const headers=await Promise.all(relativeHeaders.map(async name=>{const file=path.join(closure,name);return {path:file,sha256:digest(await readFile(file))};}));
  const before={compiler:tools.clangcl,compilerHash:digest(compilerBytes),sourceHash:digest(sourceBytes),bridgeSourceHash:digest(bridgeBytes),headers};
  await writeFile(path.join(stage,'host.before.json'),JSON.stringify(before,null,2)+'\n');
  const args=['/nologo','/c','/O2','/GS-','/Zl','/Brepro','/showIncludes','/clang:-fno-ident',source,`/Fo${object}`];
  const result=await run({executable:tools.clangcl,args,cwd:product,environment:{...environment,INCLUDE:tools.include.join(';')},label:'host-counter'});
  if(result.code!==0)reject();
  const bridgeArgs=[...args.slice(0,-2),bridgeSource,`/Fo${bridgeObject}`];
  const bridgeResult=await run({executable:tools.clangcl,args:bridgeArgs,cwd:product,environment:{...environment,INCLUDE:tools.include.join(';')},label:'host-counter-bridge'});
  if(bridgeResult.code!==0)reject();
  for(const label of ['host-counter','host-counter-bridge']){
  const trace=(await readFile(path.join(stage,`${label}.log`),'utf8')).split(/\r?\n/)
    .flatMap(line=>{const match=/^Note: including file:\s+(.+)$/.exec(line);return match?[path.resolve(match[1].trim())]:[];});
  if(new Set(trace).size!==headers.length||trace.some(file=>!headers.some(h=>h.path.toLowerCase()===file.toLowerCase())))reject();
  }
  for(const header of headers)if(digest(await readFile(header.path))!==header.sha256)reject();
  if(digest(await readFile(source))!==before.sourceHash||digest(await readFile(bridgeSource))!==before.bridgeSourceHash||digest(await readFile(tools.clangcl))!==before.compilerHash)reject();
  const leaf=inspectCounterObject(await readFile(object)),bridge=inspectCounterBridgeObject(await readFile(bridgeObject));
  const lockBytes=await readFile(path.join(productRoot,'eng/host-cost-source.lock.json')),lock=JSON.parse(lockBytes.toString("utf8"));
  if(lock.status!=='admitted'||lock.summaryVersion!=='tsfg-host-cost-v1'||!process.env.TSFG_HOST_COST_CORE_EXE)reject();
  if(lock.adapterSources?.length!==2||!lock.adapterSources.some(s=>s.path==='runtime/host_counter.c'&&s.sha256===before.sourceHash)
    ||!lock.adapterSources.some(s=>s.path==='runtime/host_counter_bridge.c'&&s.sha256===before.bridgeSourceHash))reject();
  const executable=path.resolve(process.env.TSFG_HOST_COST_CORE_EXE),manifest=path.join(path.dirname(executable),'artifact-manifest.json');
  if(digest(await readFile(executable))!==lock.executableSha256||digest(await readFile(manifest))!==lock.manifestSha256)reject();
  const mc=await verifyCounterMc(executable,object,leaf,lock,path.join(stage,'host-mc-original.json'));
  const bridgeMc=await verifyCounterMc(executable,bridgeObject,bridge,lock,path.join(stage,'host-bridge-mc-original.json'),'bridge');
  if(digest(await readFile(executable))!==lock.executableSha256||digest(await readFile(manifest))!==lock.manifestSha256)reject();
  await writeFile(path.join(stage,'host-mc.json'),JSON.stringify({leaf:mc,bridge:bridgeMc},null,2)+'\n');
  await writeFile(path.join(stage,'host.after.json'),JSON.stringify({...before,objectHash:leaf.objectHash,leaf,bridge,mcProducerLockHash:digest(lockBytes)},null,2)+'\n');
  await writeHostCertificate(path.join(product,'runtime/host_certificate.zig'),leaf,null,false);
  return {object,bridgeObject,leaf,bridge,before,mc,bridgeMc,lockHash:digest(lockBytes)};
}

// Cold receipt intake creates a NEW unqualified input for one new owned build.
// It does not resurrect an old invocation or create a complete host witness.
const unqualifiedCounterInputs=new WeakMap();
export function consumeUnqualifiedHostCounter(input,{product,stage}) {
  const record=input&&unqualifiedCounterInputs.get(input);
  if(!record||path.resolve(product)!==record.product||path.resolve(stage)!==record.stage||
      canonical(input)!==record.canonical)throw new TypeError('private unqualified counter input');
  return record.counter;
}
export async function verifyUnqualifiedHostCounterInputs(input,{product,stage}) {
  const counter=consumeUnqualifiedHostCounter(input,{product,stage}),record=unqualifiedCounterInputs.get(input);
  const reads=[];
  for(const file of record.written){const observed=await coldCounterRead(file.path,file);
    if(observed.sha256!==file.sha256)reject();reads.push(coldCounterObservation(file.path,observed));}
  await coldCounterWrite(path.join(stage,'cold-counter-verification-'+(record.verificationOrdinal++)+'.json'),
    Buffer.from(JSON.stringify({kind:'private-unqualified-input-recheck',reads,qualified:false,executionAuthority:false,resourceProof:null},null,2)+'\n'));
  return counter;
}
async function coldCounterOrdinary(file) {
  if(typeof file!=='string'||!path.isAbsolute(file)||!/^E:[\\/]/i.test(file))
    throw new TypeError('cold counter ordinary E path');
  for(let current=file;;current=path.dirname(current)){
    const value=await lstat(current,{bigint:true});
    if(value.isSymbolicLink()||path.relative(path.resolve(current),await realpath(current))!=='')
      throw new TypeError('cold counter ordinary E path');
    if(path.dirname(current)===current)break;
  }
}
const coldCounterKeys=['dev','ino','mode','nlink','size','mtimeNs','ctimeNs','birthtimeNs'];
const coldCounterMetadata=value=>Object.fromEntries(coldCounterKeys.map(key=>[key,String(value[key])]));
const coldCounterSame=(left,right)=>coldCounterKeys.every(key=>left?.[key]===right?.[key]);
async function coldCounterRead(file,expected,maximum=16777216) {
  await coldCounterOrdinary(file);const before=await lstat(file,{bigint:true});
  if(!before.isFile()||before.size<0n||before.size>BigInt(maximum)||
      (expected?.bytes!==undefined&&BigInt(expected.bytes)!==before.size))reject();
  const metadata=coldCounterMetadata(before),bytes=Buffer.alloc(Number(before.size));let source,at=0,fdBefore,fdAfter,eof;
  try{source=await open(file,'r');fdBefore=coldCounterMetadata(await source.stat({bigint:true}));
    if(!coldCounterSame(metadata,fdBefore))reject();
    while(at<bytes.length){const read=await source.read(bytes,at,Math.min(1048576,bytes.length-at),at);
      if(read.bytesRead===0)reject();at+=read.bytesRead;}
    eof=(await source.read(Buffer.alloc(1),0,1,at)).bytesRead;fdAfter=coldCounterMetadata(await source.stat({bigint:true}));
  }finally{if(source)await source.close();}
  const after=coldCounterMetadata(await lstat(file,{bigint:true})),sha256=digest(bytes);
  if(eof!==0||!coldCounterSame(metadata,fdAfter)||!coldCounterSame(metadata,after)||
      (expected?.sha256!==undefined&&sha256!==('sha256:'+expected.sha256.replace(/^sha256:/,''))))reject();
  return{bytes,sha256,metadata,fdBefore,fdAfter,after,EOF:eof,sourceClosed:true};
}
function coldCounterObservation(file,observed) {
  return{path:file,bytes:observed.bytes.length,sha256:observed.sha256,metadata:observed.metadata,
    fdBefore:observed.fdBefore,fdAfter:observed.fdAfter,after:observed.after,EOF:observed.EOF,sourceClosed:observed.sourceClosed};
}
async function coldCounterWrite(file,bytes) {
  await coldCounterOrdinary(path.dirname(file));let target,at=0;
  try{target=await open(file,'wx');while(at<bytes.length){const written=await target.write(bytes,at,bytes.length-at,at);
    if(written.bytesWritten===0)reject();at+=written.bytesWritten;}await target.sync();}
  finally{if(target)await target.close();}
  return{path:file,bytes:at,sha256:digest(bytes),WX:true,fsync:true,writeClosed:true};
}
/** Internal normal build input, anchored by an independently supplied exact
 * sealed bundle digest. No candidate file may choose its own expected digest. */
export async function intakeUnqualifiedHostCounter({bundlePath,expectedBundleSHA,product=undefined,stage=undefined,tools=undefined}) {
  if(typeof expectedBundleSHA!=='string'||!/^sha256:[0-9a-f]{64}$/.test(expectedBundleSHA))
    throw new TypeError('cold counter expected bundle digest required');
  await coldCounterOrdinary(bundlePath);
  const reads=[],take=async pin=>{if(!pin||typeof pin.path!=='string'||!Number.isSafeInteger(pin.bytes)||pin.bytes<0)reject();
    const observed=await coldCounterRead(pin.path,pin);reads.push({path:pin.path,bytes:observed.bytes.length,
      sha256:observed.sha256,metadata:observed.metadata,fdBefore:observed.fdBefore,fdAfter:observed.fdAfter,after:observed.after,
      EOF:observed.EOF,sourceClosed:observed.sourceClosed});return observed.bytes;};
  const bundleRead=await coldCounterRead(bundlePath,{sha256:expectedBundleSHA},1048576),bundle=JSON.parse(bundleRead.bytes.toString('utf8'));
  if(bundle.version!==1||bundle.purpose!=='unqualified-runtime-bootstrap'||
      canonical(Object.keys(bundle).sort())!==canonical(['admittedLock','authority','manifest','parameters','purpose','rootQualification','validation','version'].sort())||
      bundle.authority!=='unqualified bootstrap input only; not positive runtime witness; no ResourceProof/RF/AC')reject();
  // This independently sealed record is evidence of the historical prefix only.
  // Its labels never issue a current Runtime/loaded/phase witness.
  JSON.parse((await take(bundle.rootQualification)).toString('utf8'));
  reads.push(coldCounterObservation(bundlePath,bundleRead));
  const pins=JSON.parse((await take(bundle.manifest)).toString('utf8'));
  const validation=JSON.parse((await take(bundle.validation)).toString('utf8'));
  const parameters=JSON.parse((await take(bundle.parameters)).toString('utf8'));
  const lockBytes=await take(bundle.admittedLock),lock=JSON.parse(lockBytes.toString('utf8'));
  if(!Array.isArray(pins)||pins.length!==40||pins.some(pin=>pin.closed!==true||pin.fsynced!==true)||
      new Set(pins.map(pin=>path.resolve(pin.path))).size!==pins.length||
      lock.status!=='admitted'||lock.summaryVersion!=='tsfg-host-cost-v1'||
      lock.issuer!=='tsfg-compiler-control-plane'||lock.purpose!=='runtime-owned-counter-call-graph-mc'||
      lock.authorityDomain!=='fixed-runtime-counter-leaf-and-owned-bridge-only'||lock.protocolVersion!=='0.2.0'||
      lock.inputFormat!=='AMD64-COFF'||lock.maxInputBytes!==16777216||lock.adapterCodePolicy?.length!==2||parameters.requiredAdmittedLockSHA!==digest(lockBytes).slice(7)||
      parameters.requiredRootProofIdentity!==lock.proofIdentity)reject();
  const find=name=>{const matches=pins.filter(pin=>path.basename(pin.path)===name);if(matches.length!==1)reject();return matches[0];};
  const component=async name=>take(find(name));
  const before=JSON.parse((await component('stage02__host.before.json')).toString('utf8'));
  const after=JSON.parse((await component('stage02__host.after.json')).toString('utf8'));
  if(before.compilerHash!==after.compilerHash||before.sourceHash!==after.sourceHash||
      before.bridgeSourceHash!==after.bridgeSourceHash||canonical(before.headers)!==canonical(after.headers)||
      after.mcProducerLockHash!==digest(lockBytes)||path.resolve(tools.clangcl)!==path.resolve(before.compiler)||
      path.resolve(parameters.tools.clangcl)!==path.resolve(tools.clangcl)||
      canonical(tools.include.map(file=>path.resolve(file)))!==canonical(parameters.tools.include.map(file=>path.resolve(file))))reject();
  const continuity=async()=>{
    const observed=[];
    for(const executable of [tools.clangcl,parameters.MC.executable]){
      const expected=validation.after.tools.filter(row=>path.resolve(row.path)===path.resolve(executable));
      if(expected.length!==1||expected[0].same8!==true)reject();await coldCounterOrdinary(executable);
      const current=coldCounterMetadata(await lstat(executable,{bigint:true}));
      if(!coldCounterSame(current,expected[0].current))reject();observed.push({path:executable,current});
    }return observed;
  };
  const toolBefore=await continuity();
  const cSources=[['runtime/host_counter.c',before.sourceHash],['runtime/host_counter_bridge.c',before.bridgeSourceHash]];
  for(const [name,expected]of cSources){const observed=await coldCounterRead(path.join(product,name),{sha256:expected});
    reads.push(coldCounterObservation(path.join(product,name),observed));}
  const headerNames=['llvm/lib/clang/22/include/stdint.h','msvc-tools/VC/Tools/MSVC/14.44.35207/include/stdint.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/vcruntime.h','msvc-tools/VC/Tools/MSVC/14.44.35207/include/sal.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/concurrencysal.h','llvm/lib/clang/22/include/vadefs.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/vadefs.h'];
  if(before.headers.length!==7)reject();const closure=path.resolve(path.dirname(tools.clangcl),'../..');
  for(const [index,name]of headerNames.entries()){const row=before.headers[index],file=path.join(closure,name);
    if(path.resolve(row.path)!==path.resolve(file))reject();const observed=await coldCounterRead(file,{sha256:row.sha256});
    reads.push(coldCounterObservation(file,observed));}
  const manifestPath=path.join(path.dirname(parameters.MC.executable),'artifact-manifest.json');
  const manifest=JSON.parse((await take({path:manifestPath,bytes:validation.after.sources.find(row=>path.resolve(row.path)===path.resolve(manifestPath))?.bytes,
    sha256:lock.manifestSha256})).toString('utf8'));
  if(manifest.buildIdentity?.digest!==lock.buildIdentityDigest||manifest.buildInputSet?.digest!==lock.buildInputSetDigest||
      manifest.toolchainClosureDigest!==lock.toolchainClosureDigest||canonical(manifest.outputs)!==canonical(lock.outputs))reject();
  const id={...manifest.buildIdentity},inputs={...manifest.buildInputSet};delete id.digest;delete inputs.digest;
  if(digest(canonical(id))!==lock.buildIdentityDigest||digest(canonical(inputs))!==lock.buildInputSetDigest||
      manifest.buildIdentity.buildInputSetDigest!==lock.buildInputSetDigest||manifest.buildIdentity.profile!=='debug'||
      manifest.buildIdentity.target!=='windows-x86_64-msvc'||
      manifest.outputs.find(row=>row.path==='tsfg-core-ir.exe')?.sha256!==lock.executableSha256)reject();
  const objects=[await component('stage02__host_counter.obj'),await component('stage02__host_counter_bridge.obj')];
  const leaf=inspectCounterObject(objects[0]),bridge=inspectCounterBridgeObject(objects[1]);
  if(canonical(leaf)!==canonical(after.leaf)||canonical(bridge)!==canonical(after.bridge)||
      lock.adapterSources?.length!==2||cSources.some(([name,sha256])=>!lock.adapterSources.some(row=>row.path===name&&row.sha256===sha256)))reject();
  const calls=JSON.parse((await component('stage02__C-calls-original.json')).toString('utf8'));
  if(calls.length!==2)reject();
  for(const [index,label]of ['host-counter','host-counter-bridge'].entries()){
    const row=calls[index],command=row.command,terminal=row.result;
    const source=path.join(parameters.product,cSources[index][0]),output=path.join(parameters.stage,index?'host_counter_bridge.obj':'host_counter.obj');
    const args=['/nologo','/c','/O2','/GS-','/Zl','/Brepro','/showIncludes','/clang:-fno-ident',source,'/Fo'+output];
    if(command.label!==label||path.resolve(command.executable)!==path.resolve(tools.clangcl)||
        path.resolve(command.cwd)!==path.resolve(parameters.product)||canonical(command.args)!==canonical(args)||
        command.environment.INCLUDE!==parameters.tools.include.join(';')||terminal.exitCode!==0||terminal.closeCode!==0||
        terminal.exitSignal!==null||terminal.closeSignal!==null||terminal.naturalClosed!==true||terminal.qualified!==true||
        terminal.primary.present!==false||terminal.observer.present!==false||terminal.streamEnd.stdout!==true||
        terminal.streamEnd.stderr!==true||terminal.streamClose.stdout!==true||terminal.streamClose.stderr!==true)reject();
    const outputBytes=await component('stage02__capture-'+label+'__stdout.bin'),errors=await component('stage02__capture-'+label+'__stderr.bin');
    if(errors.length!==0||digest(outputBytes).slice(7)!==terminal.stdoutHash||terminal.stderrBytes!==0)reject();
    const trace=outputBytes.toString('utf8').split(/\r?\n/).flatMap(line=>{const match=/^Note: including file:\s+(.+)$/.exec(line);return match?[path.resolve(match[1].trim())]:[];});
    if(new Set(trace).size!==7||trace.some(file=>!before.headers.some(header=>path.resolve(header.path).toLowerCase()===file.toLowerCase())))reject();
  }
  const mc=[];
  for(const [index,role]of ['leaf','bridge'].entries()){
    const prefix=index?'stage02__host-bridge-mc-original.json':'stage02__host-mc-original.json';
    const receipt=JSON.parse((await component(prefix)).toString('utf8')),original=receipt.originalChild;
    const raw={};for(const channel of ['stdin','stdout','stderr']){raw[channel]=await component(prefix+'.'+channel+'.bin');
      const retained=receipt.rawBuffers[channel];
      if(retained.observed!==true||retained.WX!==true||retained.opened!==true||retained.fsync!==true||retained.writeClosed!==true||
          retained.errors.length!==0||retained.bytes!==raw[channel].length||retained.writeBytes!==raw[channel].length||
          retained.sha256!==digest(raw[channel]))reject();}
    if(receipt.kind!=='actual-fixed-mc-helper-invocation'||receipt.role!==role||receipt.issuer!==lock.issuer||
        receipt.purpose!==lock.purpose||receipt.proofIdentity!==lock.proofIdentity||
        !Number.isSafeInteger(original.pid)||original.pid<=0||original.exit!==0||original.signal!==null||original.error!==null||
        canonical(receipt.command.args)!==canonical(['--inspect-native-instructions'])||
        path.resolve(receipt.command.executable)!==path.resolve(parameters.MC.executable)||
        !raw.stdin.equals(objects[index])||raw.stderr.length!==0||original.stdout!==raw.stdout.toString('utf8')||original.stderr!==''||
        receipt.command.inputHash!==digest(objects[index])||
        [receipt.before,receipt.after].some(row=>row.objectHash!==digest(objects[index])||
          row.executableSha256!==lock.executableSha256||row.manifestSha256!==lock.manifestSha256))reject();
    const inspected=JSON.parse(raw.stdout.toString('utf8'));
    if(index===0)validateCounterMcFacts(inspected,leaf);else validateCounterBridgeMcFacts(inspected,bridge);
    const policy=lock.adapterCodePolicy.find(row=>row.role===role),summary=index?bridge:leaf;
    if(!policy||policy.symbol!==summary.symbol||policy.codeHash!==summary.codeHash||
        policy.instructionUpperBound!==summary.instructionUpperBound||policy.calleeStackBytes!==summary.calleeStackBytes)reject();
    mc.push({role,executableHash:lock.executableSha256,manifestHash:lock.manifestSha256,
      proofIdentity:lock.proofIdentity,originalPid:original.pid,stdoutHash:digest(raw.stdout),inputHash:digest(raw.stdin),
      qualification:'sealed historical actual fixed MC child; not a new invocation or complete witness'});
  }
  const certificate=await component('product02__runtime__host_certificate.zig');
  const expectedCertificate=Buffer.from('// Generated from actual Runtime-owned machine code; retained in build evidence.\npub const qualified = false;\npub const instruction_upper_bound: u64 = 5;\npub const call_boundary_bytes: usize = 0;\npub const run_stack_bytes: usize = 0;\npub const admission_stack_bytes: usize = 0;\npub const execute_stack_bytes: usize = 0;\n');
  if(!certificate.equals(expectedCertificate))reject();
  const toolAfter=await continuity();if(canonical(toolBefore)!==canonical(toolAfter))reject();
  await coldCounterOrdinary(stage);await coldCounterOrdinary(product);
  const written=[await coldCounterWrite(path.join(stage,'host_counter.obj'),objects[0]),
    await coldCounterWrite(path.join(stage,'host_counter_bridge.obj'),objects[1]),
    await coldCounterWrite(path.join(product,'runtime/host_certificate.zig'),certificate)];
  const counter=own({object:written[0].path,bridgeObject:written[1].path,leaf,bridge,before,mc:mc[0],bridgeMc:mc[1],lockHash:digest(lockBytes)});
  const result=Object.freeze({kind:'unqualified-counter-prepared-input',qualified:false,executionAuthority:false,resourceProof:null,
    bundleHash:expectedBundleSHA,objectHash:leaf.objectHash,bridgeObjectHash:bridge.objectHash,certificateHash:digest(certificate)});
  const receipt={kind:result.kind,bundleHash:expectedBundleSHA,reads,toolBefore,toolAfter,written,
    currentRuntimeGraph:null,currentLoadedGraph:null,qualified:false,executionAuthority:false,resourceProof:null};
  await coldCounterWrite(path.join(stage,'cold-counter-intake.json'),Buffer.from(JSON.stringify(receipt,null,2)+'\n'));
  unqualifiedCounterInputs.set(result,{product:path.resolve(product),stage:path.resolve(stage),counter,written,verificationOrdinal:0,canonical:canonical(result)});
  return result;
}
