// SPDX-License-Identifier: MIT
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {prepareHostCounter,inspectCounterLink,writeHostCertificate,intakeUnqualifiedHostCounter,verifyUnqualifiedHostCounterInputs} from "./host-counter.mjs";

export class VmBuildError extends Error {
  constructor(message, issueCode = "vm-source-build") { super(message); this.issueCode = issueCode; }
}
const runtimeSources = [...["root", "bytecode", "vm", "runtime", "main", "contract", "module_format", "module", "request", "host_counter", "clock"].map(name => `runtime/${name}.zig`), "runtime/host_counter.c", "runtime/host_counter_bridge.c"];

async function ordinaryAncestor(directory) {
  for (let current = directory;; current = path.dirname(current)) {
    const state = await lstat(current).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
    if (state) {
      if (!state.isDirectory() || state.isSymbolicLink() || !/^E:[\\/]/i.test(await realpath(current))
          || path.relative(current, await realpath(current)) !== "")
        throw new VmBuildError("VM output must use an ordinary nonredirected E directory", "vm-output-integrity");
      return;
    }
    if (path.dirname(current) === current) throw new VmBuildError("VM output has no ordinary E ancestor", "vm-output-integrity");
  }
}


/** Retain the normal false Runtime build as raw evidence. Cache object discovery
 * is not proof that an object was linked, and PDB names confer no phase authority. */
export async function retainVmBootstrapArtifacts({stage,product,publish,identity,sha256,command=null,
    counterSource=null,objectRoots=[path.join(stage,'zig-local')],maximumFileBytes=67108864,maximumTotalBytes=134217728}) {
  const storage=path.join(stage,'bootstrap-evidence');
  const keys=['dev','ino','mode','nlink','size','mtimeNs','ctimeNs','birthtimeNs'];
  const metadata=value=>Object.fromEntries(keys.map(key=>[key,String(value[key])]));
  const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
  const contained=file=>{const relative=path.relative(stage,file);
    if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))
      throw new VmBuildError('bootstrap artifact outside owned stage','vm-output-integrity');};
  const ordinary=async file=>{
    if(!path.isAbsolute(file)||!/^E:[\\/]/i.test(file))throw new VmBuildError('bootstrap ordinary E path','vm-output-integrity');
    for(let current=file;;current=path.dirname(current)){
      const value=await lstat(current,{bigint:true});
      if(value.isSymbolicLink()||path.relative(path.resolve(current),await realpath(current))!=='')
        throw new VmBuildError('bootstrap redirected path','vm-output-integrity');
      if(path.dirname(current)===current)break;
    }
  };
  await ordinary(stage);
  const owner=JSON.parse(await readFile(path.join(stage,'ownership.json'),'utf8'));
  if(owner.owner!=='tsfg-vm-build'||path.resolve(owner.stage)!==path.resolve(stage))
    throw new VmBuildError('bootstrap stage owner','vm-output-integrity');
  if(!Number.isSafeInteger(maximumFileBytes)||maximumFileBytes<1||!Number.isSafeInteger(maximumTotalBytes)||maximumTotalBytes<1)
    throw new VmBuildError('bootstrap artifact size policy','vm-output-integrity');
  const inputs=[path.join(publish,'tsfg-vm.exe'),path.join(publish,'tsfg-vm.pdb'),
    path.join(product,'runtime','host_certificate.zig'),path.join(stage,'build-0.log')];
  const objects=[];let directoryCount=0,entryCount=0;
  const visit=async directory=>{
    contained(directory);await ordinary(directory);
    if(++directoryCount>1024)throw new VmBuildError('bootstrap object directory cap','vm-output-integrity');
    const entries=await readdir(directory,{withFileTypes:true});
    if((entryCount+=entries.length)>8192)throw new VmBuildError('bootstrap object entry cap','vm-output-integrity');
    entries.sort((left,right)=>Buffer.from(left.name).compare(Buffer.from(right.name)));
    for(const entry of entries){
      const file=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw new VmBuildError('bootstrap object reparse','vm-output-integrity');
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()&&/\.(?:obj|o)$/i.test(entry.name))objects.push(file);
    }
  };
  for(const directory of objectRoots){contained(directory);
    const state=await lstat(directory).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(state===null)continue;if(!state.isDirectory())throw new VmBuildError('bootstrap object root','vm-output-integrity');
    await visit(directory);
  }
  inputs.push(...objects);
  if(new Set(inputs.map(file=>path.resolve(file))).size!==inputs.length)
    throw new VmBuildError('bootstrap duplicate object','vm-output-integrity');
  const result={kind:'normal-unqualified-runtime-bootstrap-evidence',buildIdentity:identity.buildIdentity,
    buildInputSet:identity.buildInputSet,command,counterSource,artifacts:[],compilerObjects:[],
    compilerObjectLinkMembership:'unverified',phaseEntries:null,loadedGraph:null,
    executionAuthority:false,resourceProof:null,first:null};
  await mkdir(storage);let total=0,primary=null;
  for(const [index,file] of inputs.entries()){
    const state={source:file,bytes:0,sha256:null,EOF:null,sourceClosed:false,
      before:null,fdBefore:null,fdAfter:null,after:null,retained:{path:path.join(storage,String(index).padStart(4,'0')+'.bin'),
        writeBytes:0,fsync:false,writeClosed:false},error:null};
    result.artifacts.push(state);if(objects.includes(file))result.compilerObjects.push(state);
    let source,sink;const hash=createHash('sha256');
    try{
      contained(file);await ordinary(file);const observed=await lstat(file,{bigint:true});state.before=metadata(observed);
      if(!observed.isFile()||observed.size>BigInt(maximumFileBytes)||observed.size>BigInt(maximumTotalBytes-total))
        throw new VmBuildError('bootstrap artifact size','vm-output-integrity');
      source=await open(file,'r');state.fdBefore=metadata(await source.stat({bigint:true}));
      if(!same(state.before,state.fdBefore))throw new VmBuildError('bootstrap artifact changed','vm-output-integrity');
      sink=await open(state.retained.path,'wx');const buffer=Buffer.alloc(1048576);
      while(state.bytes<Number(observed.size)){
        const read=await source.read(buffer,0,Math.min(buffer.length,Number(observed.size)-state.bytes),state.bytes);
        if(read.bytesRead===0)throw new VmBuildError('bootstrap artifact early EOF','vm-output-integrity');
        hash.update(buffer.subarray(0,read.bytesRead));state.bytes+=read.bytesRead;total+=read.bytesRead;
        let offset=0;while(offset<read.bytesRead){const write=await sink.write(buffer,offset,read.bytesRead-offset,null);
          if(write.bytesWritten===0)throw new VmBuildError('bootstrap artifact short write','vm-output-integrity');
          offset+=write.bytesWritten;state.retained.writeBytes+=write.bytesWritten;}
      }
      state.EOF=(await source.read(buffer,0,1,state.bytes)).bytesRead;
      state.fdAfter=metadata(await source.stat({bigint:true}));
      if(state.EOF!==0||!same(state.fdBefore,state.fdAfter))throw new VmBuildError('bootstrap artifact changed','vm-output-integrity');
      await sink.sync();state.retained.fsync=true;state.sha256='sha256:'+hash.digest('hex');
    }catch(error){primary=error;state.error=String(error);}
    finally{
      if(source)try{await source.close();state.sourceClosed=true;}catch(error){primary??=error;state.error??=String(error);}
      if(sink)try{await sink.close();state.retained.writeClosed=true;}catch(error){primary??=error;state.error??=String(error);}
    }
    if(!primary)try{state.after=metadata(await lstat(file,{bigint:true}));
      if(!same(state.before,state.after))throw new VmBuildError('bootstrap artifact changed','vm-output-integrity');
    }catch(error){primary=error;state.error=String(error);}
    if(primary)break;
  }
  result.first=primary?String(primary):null;
  const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');let publication;
  try{const receipt=await open(path.join(stage,'bootstrap-evidence.json'),'wx');
    try{await receipt.writeFile(bytes);await receipt.sync();}finally{await receipt.close();}
  }catch(error){publication=error;}
  if(primary)throw primary;if(publication)throw publication;
  return result;
}

/** Build the formal Zig request consumer through the existing locked control plane. */
export async function executeVmTarget({ options, runtime, tools, productRoot, workspaceState, serialize, sha256, createIdentity, verifyTools, normalize, unqualifiedHostCounterReceipt=undefined }) {
  if (!runtime || !tools || !verifyTools) throw new VmBuildError("VM build requires the verified tool closure", "vm-tool-integrity");
  const output = path.resolve(options.get("--out"));
  if (!/^E:[\\/]/i.test(output)) throw new VmBuildError("VM output must be absolute E storage", "vm-output-integrity");
  for (const inputRoot of [productRoot, runtime.closurePath]) {
    const relative = path.relative(inputRoot, output);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)))
      throw new VmBuildError("VM output must be independent of product/tool inputs", "vm-output-integrity");
  }
  await ordinaryAncestor(path.dirname(output));
  if (await lstat(output).catch(error => { if (error.code === "ENOENT") return undefined; throw error; }))
    throw new VmBuildError("Independent VM build output already exists", "vm-output-integrity");
  const identity = await createIdentity(runtime, productRoot);
  const required = [...runtimeSources, "contracts/registry.json", "contracts/bytecode.schema.json", "eng/vm-build.mjs", "eng/host-counter.mjs", "eng/host-cost-source.lock.json"];
  for (const name of required) {
    const state = await lstat(path.join(productRoot, name));
    const entry = identity.buildInputSet.entries.find(entry => entry.projectId === "tsfg" && entry.repositoryRelativePath === name);
    if (!state.isFile() || state.isSymbolicLink() || entry?.sha256 !== sha256(await readFile(path.join(productRoot, name))))
      throw new VmBuildError(`VM input absent or changed: ${name}`, "vm-source-integrity");
  }
  await mkdir(path.dirname(output), { recursive: true });
  await ordinaryAncestor(path.dirname(output));
  const stage = path.join(path.dirname(output), `.vm-${randomUUID()}`);
  await mkdir(stage);
  await writeFile(path.join(stage, "ownership.json"), serialize({ owner: "tsfg-vm-build", output, stage }));
  const product = path.join(stage, "product"), publish = path.join(stage, "publish"), temp = path.join(stage, "temp");
  for (const directory of [path.join(product, "runtime"), publish, temp]) await mkdir(directory, { recursive: true });
  for (const name of runtimeSources) {
    await copyFile(path.join(productRoot, name), path.join(product, name));
    const entry = identity.buildInputSet.entries.find(entry => entry.repositoryRelativePath === name && entry.projectId === "tsfg");
    if (sha256(await readFile(path.join(product, name))) !== entry.sha256)
      throw new VmBuildError(`VM staged input changed: ${name}`, "vm-source-integrity");
  }
  const env = { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, TZ: "UTC", LANG: "C.UTF-8",
    PATH: path.dirname(tools.zig), TEMP: temp, TMP: temp, TMPDIR: temp,
    HOME: temp, USERPROFILE: temp, APPDATA: temp, LOCALAPPDATA: temp,
    XDG_CACHE_HOME: temp, XDG_CONFIG_HOME: temp, XDG_DATA_HOME: temp,
    ZIG_LOCAL_CACHE_DIR: path.join(stage, "zig-local"), ZIG_GLOBAL_CACHE_DIR: path.join(stage, "zig-global"),
    SOURCE_DATE_EPOCH: identity.buildIdentity.source_date_epoch };
  async function run(command) {
    const label=command.label;
    await writeFile(path.join(stage, `${label}.command.json`), serialize(command));
    const log=await open(path.join(stage, `${label}.log`), "wx");
    let exit;
    try {
      exit=await new Promise((resolve,reject)=>{
        const child=spawn(command.executable,command.args,{cwd:command.cwd,env:command.environment,windowsHide:true,stdio:["ignore",log.fd,log.fd]});
        process.stderr.write(`VM ${label} child pid=${child.pid} log=${path.join(stage, `${label}.log`)}\n`);
        child.once("error",reject);child.once("close",(code,signal)=>resolve({code,signal}));
      });
    }finally{await log.close();}
    await writeFile(path.join(stage, `${label}.exit.json`),serialize(exit));
    return exit;
  }
  // Internal source-built bootstrap evidence only; no public CLI or supported
  // execution contract selects this independently anchored cold prefix.
  const unqualified=unqualifiedHostCounterReceipt===undefined?null:
    await intakeUnqualifiedHostCounter({...unqualifiedHostCounterReceipt,product,stage,tools});
  const counter=unqualified===null?await prepareHostCounter({productRoot,product,stage,tools,environment:env,run}):
    await verifyUnqualifiedHostCounterInputs(unqualified,{product,stage});
  const executable=path.join(publish,"tsfg-vm.exe");
  const args=["build-exe","runtime/main.zig",counter.object,counter.bridgeObject,"--zig-lib-dir",path.join(path.dirname(tools.zig),"lib"),
    "--verbose-link","-target","x86_64-windows-msvc","-mcpu","x86_64_v2","-ODebug","-fno-lto",
    "--cache-dir",env.ZIG_LOCAL_CACHE_DIR,"--global-cache-dir",env.ZIG_GLOBAL_CACHE_DIR,`-femit-bin=${executable}`];
  let qualified=false, linked, admittedBoundaryBytes=0;
  for(let pass=0;pass<4;pass++){
    const label=`build-${pass}`;
    await copyFile(path.join(product,"runtime/host_certificate.zig"),path.join(stage,`${label}.certificate.zig`));
    const exit=await run({executable:tools.zig,args,cwd:product,environment:env,label});
    if(exit.code!==0)throw new VmBuildError(`VM source build failed (${exit.code}/${exit.signal}); see ${stage}`);
    await copyFile(executable,path.join(stage,`${label}.exe`));
    await copyFile(path.join(publish,"tsfg-vm.pdb"),path.join(stage,`${label}.pdb`));
    if(pass===0){
      const bootstrap=await retainVmBootstrapArtifacts({stage,product,publish,identity,sha256,
        counterSource:{objectHash:counter.leaf.objectHash,bridgeObjectHash:counter.bridge.objectHash,
          mcProducerLockHash:counter.lockHash,coldBundleHash:unqualified?.bundleHash??null},
        command:{executable:tools.zig,args,cwd:product,environment:env,label}});
      if(unqualified!==null){
        await verifyUnqualifiedHostCounterInputs(unqualified,{product,stage});await verifyTools();
        const current=await createIdentity(runtime,productRoot);
        if(serialize(current.buildIdentity)!==serialize(identity.buildIdentity)||
            serialize(current.buildInputSet)!==serialize(identity.buildInputSet))
          throw new VmBuildError('VM bootstrap source changed','vm-source-integrity');
        return{schemaVersion:'1',status:'unqualified-bootstrap',stage,bootstrap,
          publishable:false,executionAuthority:false,resourceProof:null,
          qualification:'raw false Runtime build only; phase, loaded and complete host witness remain required'};
      }
    }
    const observed=inspectCounterLink(await readFile(executable),counter.leaf);
    await writeFile(path.join(stage,`${label}.linked.json`),serialize(observed));
    if(qualified && observed.callBoundaryBytes<=linked.callBoundaryBytes){linked=observed;break;}
    if(pass===3)throw new VmBuildError("Host caller allocation did not reach a verified finite bound", "vm-host-certificate");
    linked=observed;qualified=true;admittedBoundaryBytes=linked.callBoundaryBytes;
    await writeHostCertificate(path.join(product,"runtime/host_certificate.zig"),counter.leaf,linked,true);
  }
  if(!qualified)throw new VmBuildError("Host counter was not independently qualified", "vm-host-certificate");
  if (!normalize) throw new VmBuildError("VM publication requires canonical Debug artifacts", "vm-artifact-integrity");
  await normalize({ executable, pdb: path.join(publish, "tsfg-vm.pdb"), stage, product, environment: env, identity, tools, runtime });
  const finalLinked=inspectCounterLink(await readFile(executable),counter.leaf);
  if(finalLinked.callBoundaryBytes>admittedBoundaryBytes)throw new VmBuildError("Normalized host boundary exceeds admitted storage", "vm-host-certificate");
  const hostSummary={id:31,summaryVersion:"tsfg-host-cost-v1",abiVersion:"x86_64-windows-msvc-counter-v1",
    parameterTypes:["i32"],returnType:"i32",codeHash:counter.leaf.codeHash,objectHash:counter.leaf.objectHash,
    linkedRuntimeHash:finalLinked.linkedRuntimeHash,symbol:counter.leaf.symbol,RVA:finalLinked.RVA,
    instructionUpperBound:counter.leaf.instructionUpperBound,calleeStackBytes:0,
    memoryUpperBound:admittedBoundaryBytes+counter.leaf.contextBytes,blockingPolicy:"bounded-nonblocking",deadlinePolicy:"request-clock-before-and-after",
    physicalWorkPolicy:"verified-bytecode-dispatch-plus-certified-host-machine-bound-v1",
    baseline:{callerStackUpperBound:admittedBoundaryBytes-8,contextBytes:16,contextAlign:8,alreadyCountedInHeapFrames:false},
    future:{incomingReturnBytes:8,calleeStackBytes:0},actualLinkedBoundary:finalLinked,
    sourceAndTool:counter.before,mcProducer:counter.mc,mcProducerLockHash:counter.lockHash};
  await writeFile(path.join(publish,"host-cost-summary.json"),serialize(hostSummary));
  await verifyTools();
  const current = await createIdentity(runtime, productRoot);
  if (serialize(current.buildIdentity) !== serialize(identity.buildIdentity))
    throw new VmBuildError("VM product inputs changed during build", "vm-source-integrity");
  const outputs = [];
  for (const name of ["tsfg-vm.exe", "tsfg-vm.pdb", "host-cost-summary.json"]) {
    const bytes = await readFile(path.join(publish, name));
    outputs.push({ path: name, sha256: sha256(bytes) });
  }
  const manifest = { schemaVersion: "1", ...identity, outputs, capability: "exact signed/unsigned integer family and target isize/usize, bool CFG, nominal typed calls and explicit recursive frames with parallel phi execution, request-local R01 traps, depth and Semantic Fuel" };
  await writeFile(path.join(publish, "artifact-manifest.json"), serialize(manifest));
  for (const entry of outputs) if (sha256(await readFile(path.join(publish, entry.path))) !== entry.sha256)
    throw new VmBuildError("VM publication input changed", "vm-artifact-integrity");
  await rename(publish, output);
  return { schemaVersion: "1", status: "built", sourceBuild: "built", output, stage, ...identity, outputs,
    executionMode: "local-development", isolation: "not-enforced", publishable: false, dirty: workspaceState.dirty,
    requiredAcceptance: "formal source-to-VM, loader and request lifecycle tests remain required" };
}
