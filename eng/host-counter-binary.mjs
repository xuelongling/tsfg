// SPDX-License-Identifier: MIT
import {sha256 as digest} from '../compiler/identity.mjs';

// Pure binary facts; private witness and certificate authority stay in host-counter.mjs.
const reject=()=>{throw new TypeError('vm-host-certificate: unknown code, ABI, stack or producer identity');};
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

export function inspectCounterLinkBytes(bytes,leaf) {
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
