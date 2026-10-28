// SPDX-License-Identifier: MIT
import {createHash} from 'node:crypto';
import {lstat,open,readFile,realpath,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {prepareCounterObjects} from './host-counter-objects.mjs';
import {canonical,own} from '../compiler/identity.mjs';
import {inspectCounterObject,inspectCounterBridgeObject,inspectCounterLinkBytes,validateCounterMcFacts,validateCounterBridgeMcFacts} from './host-counter-binary.mjs';

const digest=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const reject=()=>{throw new TypeError('vm-host-certificate: unknown code, ABI, stack or producer identity');};
// Only this producer can issue witness objects. A linked-byte observation is
// diagnostic evidence, never a complete loaded Runtime/phase proof.
const linkedCounterWitnesses=new WeakMap();
export function inspectCounterLink(bytes,leaf) {
  const linked=inspectCounterLinkBytes(bytes,leaf);
  linkedCounterWitnesses.set(linked,Object.freeze({kind:'linked-counter-diagnostic',
    linkedRuntimeHash:linked.linkedRuntimeHash,leafObjectHash:leaf.objectHash,leafCodeHash:leaf.codeHash,
    instructionUpperBound:leaf.instructionUpperBound,callBoundaryBytes:linked.callBoundaryBytes,phaseBounds:null}));
  return linked;
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
  const {object,bridgeObject,leaf,bridge,before}=await prepareCounterObjects({productRoot,product,stage,tools,environment,run});
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

// Current source builds can retain real objects without invoking the separate
// MC producer. This never creates a receipt, positive witness or Host admission.
export async function prepareUnqualifiedCurrentCounter({productRoot,product,stage,tools,environment,run}) {
  const counter=await prepareCounterObjects({productRoot,product,stage,tools,environment,run});
  await writeFile(path.join(stage,'host.after.json'),JSON.stringify({...counter.before,
    kind:'current-source-unqualified-counter-objects',objectHash:counter.leaf.objectHash,
    leaf:counter.leaf,bridge:counter.bridge,sourceLockHash:counter.sourceLockHash,mcProducerLockHash:null,
    qualified:false,executionAuthority:false,resourceProof:null},null,2)+'\n',{flag:'wx'});
  await writeHostCertificate(path.join(product,'runtime/host_certificate.zig'),counter.leaf,null,false);
  return {...counter,lockHash:null};
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
