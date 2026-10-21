// SPDX-License-Identifier: MIT
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {copyFile,lstat,mkdir,open,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {verifiedConsumer} from '../compiler/pipeline.mjs';
import {verifyProducedPacket} from '../compiler/producer-packet.mjs';
import {prepareUnqualifiedCurrentCounter} from './host-counter.mjs';
import {createCounterHostContract} from './host-semantic-contract.mjs';
import {startVmBuildChild,VmBuildError} from './vm-build.mjs';
import {requireOrdinaryEAncestor} from './output-storage.mjs';

export class AotBuildError extends VmBuildError {
  constructor(message,issueCode='aot-source-build') { super(message);this.issueCode=issueCode; }
}
const metadata=value=>Object.fromEntries(['dev','ino','mode','nlink','size','mtimeNs','ctimeNs','birthtimeNs'].map(key=>[key,String(value[key])]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exists=async file=>lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});

async function ordinaryAncestor(directory) {
  await requireOrdinaryEAncestor(directory,reason=>new AotBuildError(reason==='missing'
    ?'AOT output has no ordinary E ancestor':'AOT output requires ordinary E storage','aot-output-integrity'));
}

// Retain exact finite producer/artifact bytes, including EOF and metadata
// continuity. Failure keeps the stage and never publishes a partial artifact.
async function stableBytes(file,maximum) {
  const before=await lstat(file,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.size<1n||before.size>BigInt(maximum))
    throw new AotBuildError('AOT artifact extent','aot-output-integrity');
  const observed=metadata(before),bytes=Buffer.alloc(Number(before.size));
  let input,at=0,first;
  try {
    input=await open(file,'r');
    if(!same(observed,metadata(await input.stat({bigint:true}))))throw new AotBuildError('AOT artifact changed','aot-output-integrity');
    while(at<bytes.length) {
      const count=(await input.read(bytes,at,Math.min(1048576,bytes.length-at),at)).bytesRead;
      if(!count)throw new AotBuildError('AOT artifact early EOF','aot-output-integrity');
      at+=count;
    }
    if((await input.read(Buffer.alloc(1),0,1,at)).bytesRead!==0
        ||!same(observed,metadata(await input.stat({bigint:true}))))throw new AotBuildError('AOT artifact changed','aot-output-integrity');
  }catch(error){first=error;}finally{if(input)try{await input.close();}catch(error){first??=error;}}
  if(first)throw first;
  if(!same(observed,metadata(await lstat(file,{bigint:true}))))throw new AotBuildError('AOT artifact changed','aot-output-integrity');
  return bytes;
}

function runtimeInputs(identity) {
  return identity.buildInputSet.entries.filter(entry=>entry.projectId==='tsfg'
    &&(/^runtime\/[A-Za-z0-9_.-]+\.(?:zig|h)$/.test(entry.repositoryRelativePath)
      ||['runtime/host_counter.c','runtime/host_counter_bridge.c'].includes(entry.repositoryRelativePath)));
}

/** One real compiled program and the locked request host form one executable.
 * Only compiler-verified Core enters code generation; JSON requests can select
 * neither a code address nor a metadata/descriptor file. This ordinary build
 * deliberately retains the real false Host resource certificate. */
export async function executeAotTarget({options,runtime,tools,productRoot,workspaceState,serialize,sha256,
  createIdentity,verifyTools,normalize,core,coreExecutable}) {
  if(!runtime||!tools||typeof verifyTools!=='function'||typeof createIdentity!=='function'
      ||typeof normalize!=='function')throw new AotBuildError('AOT build requires the locked normal build context','aot-tool-integrity');
  if(typeof core!=='string'||!core.isWellFormed()||Buffer.byteLength(core)<1||Buffer.byteLength(core)>16777216)
    throw new AotBuildError('AOT expects one complete bounded Core program','aot-input-integrity');
  const coreBytes=Buffer.from(core,'utf8'),programCore=sha256(coreBytes),output=path.resolve(options.get('--out'));
  if(!/^E:[\\/]/i.test(output))throw new AotBuildError('AOT output must use absolute E storage','aot-output-integrity');
  for(const inputRoot of [productRoot,runtime.closurePath]) {
    const relative=path.relative(inputRoot,output);
    if(relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))
      throw new AotBuildError('AOT output overlaps product/tool inputs','aot-output-integrity');
  }
  await ordinaryAncestor(path.dirname(output));
  if(await exists(output))throw new AotBuildError('Independent AOT output already exists','aot-output-integrity');
  await verifyTools();
  const identity=await createIdentity(runtime,productRoot,programCore);
  if(identity.buildIdentity.options.sourceTarget!=='tsfg-aot'||identity.buildIdentity.options.programCore!==programCore)
    throw new AotBuildError('AOT source identity program/target mismatch','aot-source-integrity');
  const sources=runtimeInputs(identity);
  const required=['runtime/aot-main.zig','runtime/aot-program.zig','runtime/aot-instance.zig','runtime/request-json.zig',
    'runtime/request.zig','runtime/contract.zig','runtime/host_counter.zig','runtime/host_counter.c','runtime/host_counter_bridge.c',
    'runtime/host-semantic-contract.zig','eng/aot-build.mjs','eng/vm-build.mjs','eng/host-counter.mjs',
    'eng/host-counter-objects.mjs','eng/host-counter-binary.mjs','eng/host-cost-source.lock.json','eng/host-semantic-contract.mjs',
    'eng/output-storage.mjs','compiler/pipeline.mjs','compiler/producer-packet.mjs','contracts/registry.json','contracts/bytecode.schema.json',
    'contracts/host-counter-semantic-v1.json'];
  for(const name of new Set([...required,...sources.map(entry=>entry.repositoryRelativePath)])) {
    const state=await lstat(path.join(productRoot,name));
    const entry=identity.buildInputSet.entries.find(entry=>entry.projectId==='tsfg'&&entry.repositoryRelativePath===name);
    if(!state.isFile()||state.isSymbolicLink()||entry?.sha256!==sha256(await readFile(path.join(productRoot,name))))
      throw new AotBuildError('AOT input absent or changed: '+name,'aot-source-integrity');
  }
  const producer=await verifiedConsumer(coreExecutable,'core');
  const manifestPath=path.join(path.dirname(producer),'artifact-manifest.json');
  const producerIdentity={executable:sha256(await readFile(producer)),manifest:sha256(await readFile(manifestPath))};
  await mkdir(path.dirname(output),{recursive:true});await ordinaryAncestor(path.dirname(output));
  const stage=path.join(path.dirname(output),'.aot-'+randomUUID());
  await mkdir(stage);
  await writeFile(path.join(stage,'ownership.json'),serialize({owner:'tsfg-aot-build',output,stage}),{flag:'wx'});
  const product=path.join(stage,'product'),publish=path.join(stage,'publish'),temp=path.join(stage,'temp');
  for(const directory of [path.join(product,'runtime'),publish,temp])await mkdir(directory,{recursive:true});
  for(const entry of sources) {
    const destination=path.join(product,entry.repositoryRelativePath);
    await copyFile(path.join(productRoot,entry.repositoryRelativePath),destination);
    if(sha256(await readFile(destination))!==entry.sha256)throw new AotBuildError('AOT staged source changed','aot-source-integrity');
  }
  const hostSemantic=createCounterHostContract(identity);
  await writeFile(path.join(product,'runtime/host_semantic_identity.zig'),hostSemantic.identitySource,{flag:'wx'});
  await writeFile(path.join(stage,'host-semantic-contract.json'),hostSemantic.contractText,{flag:'wx'});
  const coreInput=path.join(stage,'program.mlir');await writeFile(coreInput,coreBytes,{flag:'wx'});
  const environment={SystemRoot:process.env.SystemRoot,ComSpec:process.env.ComSpec,TZ:'UTC',LANG:'C.UTF-8',
    PATH:path.dirname(tools.zig),TEMP:temp,TMP:temp,TMPDIR:temp,HOME:temp,USERPROFILE:temp,APPDATA:temp,LOCALAPPDATA:temp,
    XDG_CACHE_HOME:temp,XDG_CONFIG_HOME:temp,XDG_DATA_HOME:temp,
    ZIG_LOCAL_CACHE_DIR:path.join(stage,'zig-local'),ZIG_GLOBAL_CACHE_DIR:path.join(stage,'zig-global'),
    SOURCE_DATE_EPOCH:identity.buildIdentity.source_date_epoch,LIB:tools.lib.join(';'),LIBPATH:tools.lib.join(';')};

  async function run(command,stdout=undefined) {
    const label=command.label,logPath=path.join(stage,label+'.log');
    await writeFile(path.join(stage,label+'.command.json'),serialize({...command,...(stdout?{stdin:coreInput,stdout}:{} )}),{flag:'wx'});
    const log=await open(logPath,'wx');let input,sink,exit,first,processObservation=null;
    try {
      if(stdout) {
        input=await open(coreInput,'r');sink=await open(stdout,'wx');
        const observation={pid:null,exit:null,close:null,error:null};processObservation=observation;
        exit=await new Promise(resolve=>{
          const child=spawn(command.executable,command.args,{cwd:command.cwd,env:command.environment,windowsHide:true,
            stdio:[input.fd,sink.fd,log.fd]});
          observation.pid=Number.isSafeInteger(child.pid)?child.pid:null;
          process.stderr.write('AOT '+label+' child pid='+child.pid+' log='+logPath+'\n');
          child.once('error',error=>{observation.error=String(error);first??=error;});
          child.once('exit',(code,signal)=>{observation.exit={code,signal};});
          child.once('close',(code,signal)=>{observation.close={code,signal};resolve({code,signal});});
        });
      } else {
        // Reuse the existing locked normal child runner and merged native FD.
        const child=startVmBuildChild({command,logFd:log.fd,logPath});processObservation=child.observation;
        exit=await child.completion;
      }
    }catch(error){first??=error;}finally{
      for(const file of [input,sink,log])if(file)try{await file.close();}catch(error){first??=error;}
    }
    try{await writeFile(path.join(stage,label+'.exit.json'),serialize({...(exit??{code:null,signal:null}),processObservation,
      first:first?String(first):null}),{flag:'wx'});}catch(error){first??=error;}
    if(first)throw first;
    if(exit.code!==0||exit.signal)throw new AotBuildError('AOT child failed ('+exit.code+'/'+exit.signal+'); see '+stage);
    return {...exit,processObservation};
  }

  const wirePath=path.join(stage,'program.tbc'),object=path.join(stage,'program.obj');
  await run({executable:producer,args:['--emit-bytecode'],cwd:product,environment,label:'core-wire'},wirePath);
  const wire=await stableBytes(wirePath,1048576);verifyProducedPacket(wire);
  await run({executable:producer,args:['--emit-program-object'],cwd:product,environment,label:'core-program'},object);
  const programObject=await stableBytes(object,16777216);
  const compiledTableId=sha256(Buffer.concat([Buffer.from('tsfg.aot-compiled-module.v4\0'),wire]));
  const counter=await prepareUnqualifiedCurrentCounter({productRoot,product,stage,tools,environment,run});
  const certificate=path.join(product,'runtime/host_certificate.zig');
  const certificateBytes=await readFile(certificate);
  await writeFile(path.join(stage,'build-0.certificate.zig'),certificateBytes,{flag:'wx'});
  const executable=path.join(publish,'tsfg-aot.exe'),pdb=path.join(publish,'tsfg-aot.pdb');
  const args=['build-exe','runtime/aot-main.zig',object,counter.object,counter.bridgeObject,
    '--zig-lib-dir',path.join(path.dirname(tools.zig),'lib'),'--verbose-link',
    '-target','x86_64-windows-msvc','-mcpu','x86_64_v2','-ODebug','-fno-lto',
    '--cache-dir',environment.ZIG_LOCAL_CACHE_DIR,'--global-cache-dir',environment.ZIG_GLOBAL_CACHE_DIR,'-femit-bin='+executable];
  await run({executable:tools.zig,args,cwd:product,environment,label:'build-0'});
  // Ordinary artifacts retain the false certificate. No loaded-link scan, MC
  // helper or synthetic positive authority participates in this build path.
  await normalize({executable,pdb,stage,product,environment,identity,tools,runtime});
  if(!certificateBytes.equals(await readFile(certificate)))throw new AotBuildError('AOT false certificate changed','aot-source-integrity');
  if(!coreBytes.equals(await stableBytes(coreInput,16777216))||!programObject.equals(await stableBytes(object,16777216))
      ||!wire.equals(await stableBytes(wirePath,1048576)))throw new AotBuildError('AOT program input changed','aot-source-integrity');
  for(const entry of sources)if(sha256(await readFile(path.join(product,entry.repositoryRelativePath)))!==entry.sha256)
    throw new AotBuildError('AOT staged source changed','aot-source-integrity');
  for(const [file,expected] of [[counter.object,counter.leaf.objectHash],[counter.bridgeObject,counter.bridge.objectHash]])
    if(sha256(await readFile(file))!==expected)throw new AotBuildError('AOT Counter object changed','aot-source-integrity');
  await verifiedConsumer(producer,'core');
  if(sha256(await readFile(producer))!==producerIdentity.executable||sha256(await readFile(manifestPath))!==producerIdentity.manifest)
    throw new AotBuildError('AOT Core producer changed','aot-tool-integrity');
  await verifyTools();
  const current=await createIdentity(runtime,productRoot,programCore);
  if(serialize(current.buildIdentity)!==serialize(identity.buildIdentity)||serialize(current.buildInputSet)!==serialize(identity.buildInputSet))
    throw new AotBuildError('AOT product inputs changed','aot-source-integrity');
  await writeFile(path.join(publish,'host-semantic-contract.json'),hostSemantic.contractText,{flag:'wx'});
  await writeFile(path.join(publish,'host-certificate.zig'),certificateBytes,{flag:'wx'});
  // Keep the complete compile inputs/products alongside their manifest hashes.
  // Execution uses the linked immutable tables and never loads these files.
  /** @type {[string,Buffer][]} */
  const programProducts=[['program.mlir',coreBytes],['program.tbc',wire],['program.obj',programObject]];
  for(const [name,bytes] of programProducts)
    await writeFile(path.join(publish,name),bytes,{flag:'wx'});
  const outputs=[];
  for(const name of ['tsfg-aot.exe','tsfg-aot.pdb','host-semantic-contract.json','host-certificate.zig','program.mlir','program.tbc','program.obj']) {
    const bytes=await stableBytes(path.join(publish,name),67108864);outputs.push({path:name,sha256:sha256(bytes)});
  }
  const program={core:sha256(coreBytes),bytecode:sha256(wire),object:sha256(programObject),compiledTableId,producer:producerIdentity};
  const manifest={schemaVersion:'1',...identity,outputs,executionBackend:'aot-v4',program,
    hostResourceQualified:false,executionMode:'local-development',publishable:false,resourceProof:null};
  await writeFile(path.join(publish,'artifact-manifest.json'),serialize(manifest),{flag:'wx'});
  for(const entry of outputs)if(sha256(await stableBytes(path.join(publish,entry.path),67108864))!==entry.sha256)
    throw new AotBuildError('AOT publication input changed','aot-output-integrity');
  await rename(publish,output);
  return {schemaVersion:'1',status:'ordinary-built-unqualified',sourceBuild:'built',output,stage,...identity,outputs,program,
    executionBackend:'aot-v4',executionMode:'local-development',isolation:'not-enforced',publishable:false,
    hostResourceQualified:false,resourceProof:null,dirty:workspaceState.dirty,
    requiredAcceptance:'real production request behavior and full Source/VM/Native/Resource qualification remain separate'};
}
