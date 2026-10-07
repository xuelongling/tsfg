// SPDX-License-Identifier: MIT
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {canonical} from '../compiler/identity.mjs';

const digest=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
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
  return {RVA,linkedRuntimeHash:digest(bytes),calls,callBoundaryBytes:calls[0].callBoundaryBytes};
}

/** The external producer is an independently built official-X86-MC consumer.
 * Its exact executable/manifest identities join the host summary. */
export async function verifyCounterMc(executable,object,leaf) {
  if(!executable)reject();
  const manifestBytes=await readFile(path.join(path.dirname(executable),'artifact-manifest.json'));
  const manifest=JSON.parse(manifestBytes.toString("utf8")),binary=await readFile(executable);
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
  const result=spawnSync(executable,['--inspect-native-instructions'],{input:await readFile(object),windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
  if(result.error||result.status!==0)reject();
  const inspected=JSON.parse(result.stdout.toString("utf8"));
  if(inspected.version!=='0.1.0'||inspected.objectHash!==leaf.objectHash||inspected.functions?.length!==1)reject();
  const fn=inspected.functions[0];
  if(fn.name!==leaf.symbol||fn.codeHash!==leaf.codeHash||fn.sectionOffset!=='0'||fn.size!==String(leaf.codeHex.length/2)
    ||fn.decodedInstructionCount!==String(leaf.instructionUpperBound)||fn.nodes?.length!==leaf.instructions.length)reject();
  for(const [index,instruction] of leaf.instructions.entries()){
    const node=fn.nodes[index],next=leaf.instructions[index+1];
    if(node.offset!==String(instruction.offset)||node.size!==String(instruction.bytes.length/2)
      ||node.bytes.toLowerCase()!==instruction.bytes||node.isCall!==false||node.isReturn!==(next===undefined)
      ||node.decodedInstructionCount!=='1'||node.relocations?.length!==0
      ||JSON.stringify(node.successors)!==JSON.stringify(next?[String(next.offset)]:[]))reject();
  }
  return {executableHash:digest(binary),manifestHash:digest(manifestBytes),buildIdentity:manifest.buildIdentity,buildInputSet:manifest.buildInputSet,
    outputs,sourceCommit:notices.sourceCommit,legalNoticeHash:noticeOutput.sha256,
    stdout:result.stdout.toString('utf8'),stderr:result.stderr.toString('utf8'),exit:result.status,leafCodeHash:leaf.codeHash};
}

export async function writeHostCertificate(file,leaf,linked,qualified) {
  if(qualified&&!linked)reject();
  await writeFile(file,`// Generated from actual Runtime-owned machine code; retained in build evidence.\npub const qualified = ${qualified};\npub const instruction_upper_bound: u64 = ${leaf?.instructionUpperBound??0};\npub const call_boundary_bytes: usize = ${linked?.callBoundaryBytes??0};\n`);
}

export async function prepareHostCounter({productRoot,product,stage,tools,environment,run}) {
  const object=path.join(stage,'host_counter.obj'),source=path.join(product,'runtime/host_counter.c');
  const compilerBytes=await readFile(tools.clangcl),sourceBytes=await readFile(source);
  const relativeHeaders=['llvm/lib/clang/22/include/stdint.h','msvc-tools/VC/Tools/MSVC/14.44.35207/include/stdint.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/vcruntime.h','msvc-tools/VC/Tools/MSVC/14.44.35207/include/sal.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/concurrencysal.h','llvm/lib/clang/22/include/vadefs.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/vadefs.h'];
  const closure=path.resolve(path.dirname(tools.clangcl),'../..');
  const headers=await Promise.all(relativeHeaders.map(async name=>{const file=path.join(closure,name);return {path:file,sha256:digest(await readFile(file))};}));
  const before={compiler:tools.clangcl,compilerHash:digest(compilerBytes),sourceHash:digest(sourceBytes),headers};
  await writeFile(path.join(stage,'host.before.json'),JSON.stringify(before,null,2)+'\n');
  const args=['/nologo','/c','/O2','/GS-','/Zl','/Brepro','/showIncludes','/clang:-fno-ident',source,`/Fo${object}`];
  const result=await run({executable:tools.clangcl,args,cwd:product,environment:{...environment,INCLUDE:tools.include.join(';')},label:'host-counter'});
  if(result.code!==0)reject();
  const trace=(await readFile(path.join(stage,'host-counter.log'),'utf8')).split(/\r?\n/)
    .flatMap(line=>{const match=/^Note: including file:\s+(.+)$/.exec(line);return match?[path.resolve(match[1].trim())]:[];});
  if(new Set(trace).size!==headers.length||trace.some(file=>!headers.some(h=>h.path.toLowerCase()===file.toLowerCase())))reject();
  for(const header of headers)if(digest(await readFile(header.path))!==header.sha256)reject();
  if(digest(await readFile(source))!==before.sourceHash||digest(await readFile(tools.clangcl))!==before.compilerHash)reject();
  const leaf=inspectCounterObject(await readFile(object));
  const lockBytes=await readFile(path.join(productRoot,'eng/host-cost-source.lock.json')),lock=JSON.parse(lockBytes.toString("utf8"));
  if(lock.status!=='admitted'||lock.summaryVersion!=='tsfg-host-cost-v1'||!process.env.TSFG_HOST_COST_CORE_EXE)reject();
  const executable=path.resolve(process.env.TSFG_HOST_COST_CORE_EXE),manifest=path.join(path.dirname(executable),'artifact-manifest.json');
  if(digest(await readFile(executable))!==lock.executableSha256||digest(await readFile(manifest))!==lock.manifestSha256)reject();
  const mc=await verifyCounterMc(executable,object,leaf);
  if(digest(await readFile(executable))!==lock.executableSha256||digest(await readFile(manifest))!==lock.manifestSha256)reject();
  await writeFile(path.join(stage,'host-mc.json'),JSON.stringify(mc,null,2)+'\n');
  await writeFile(path.join(stage,'host.after.json'),JSON.stringify({...before,objectHash:leaf.objectHash,leaf,mcProducerLockHash:digest(lockBytes)},null,2)+'\n');
  await writeHostCertificate(path.join(product,'runtime/host_certificate.zig'),leaf,null,false);
  return {object,leaf,before,mc,lockHash:digest(lockBytes)};
}
