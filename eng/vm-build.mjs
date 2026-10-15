// SPDX-License-Identifier: MIT
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {prepareHostCounter,inspectCounterLink,writeHostCertificate,intakeUnqualifiedHostCounter,verifyUnqualifiedHostCounterInputs} from "./host-counter.mjs";

export class VmBuildError extends Error {
  constructor(message, issueCode = "vm-source-build") { super(message); this.issueCode = issueCode; }
}

/** Observe only the current producer's complete verbose-link records. This
 * live reader has a different lifetime from final artifact retention: a missed
 * notification or deleted temporary input is a failed acquisition, never proof. */
export async function createVmLinkObjectRetention({stage,logPath,output,counterObjects=[],
    maximumFileBytes=67108864,maximumTotalBytes=134217728}) {
  const storage=path.join(stage,'link-inputs-build-0'),keys=['dev','ino','mode','nlink','size','mtimeNs','ctimeNs','birthtimeNs'];
  const metadata=s=>Object.fromEntries(keys.map(k=>[k,String(s[k])]));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const contained=file=>{const relative=path.relative(stage,file);
    if(!path.isAbsolute(file)||!/^E:[\\/]/i.test(file)||!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))
      throw new VmBuildError('link input outside owned stage','vm-object-retention');};
  const ordinary=async file=>{for(let p=file;;p=path.dirname(p)){
    const s=await lstat(p,{bigint:true});
    if(s.isSymbolicLink()||path.relative(path.resolve(p),await realpath(p))!=='')
      throw new VmBuildError('redirected link input','vm-object-retention');
    if(path.dirname(p)===p)break;
  }};
  contained(logPath);contained(output);await ordinary(stage);await ordinary(logPath);
  const owner=JSON.parse(await readFile(path.join(stage,'ownership.json'),'utf8'));
  if(owner.owner!=='tsfg-vm-build'||path.resolve(owner.stage)!==path.resolve(stage))
    throw new VmBuildError('link input stage owner','vm-object-retention');
  if(!Number.isSafeInteger(maximumFileBytes)||maximumFileBytes<1||maximumFileBytes>67108864||
      !Number.isSafeInteger(maximumTotalBytes)||maximumTotalBytes<1||maximumTotalBytes>134217728)
    throw new VmBuildError('link input byte policy','vm-object-retention');
  await mkdir(storage);
  const result={kind:'unqualified-live-link-input-retention',storage,producerPid:null,lines:[],objects:[],writes:[],
    first:null,secondary:[],readBytes:0,EOFCalls:0,logReadBytes:0,executionAuthority:false,
    linkMembership:'unverified',phaseEntries:null,loadedGraph:null};
  let active=false,finished=false,pending=null,dirty=false,fragment=Buffer.alloc(0),offset=0,total=0;
  const settled=Promise.resolve();
  const fail=error=>{if(result.first===null)result.first=String(error);else result.secondary.push(String(error));};
  const write=async(file,bytes)=>{const state={path:file,bytes:bytes.length,
    sha256:'sha256:'+createHash('sha256').update(bytes).digest('hex'),writeBytes:0,fsync:false,writeClosed:false,error:null};
    result.writes.push(state);let sink,first;try{sink=await open(file,'wx');let at=0;
    while(at<bytes.length){const n=(await sink.write(bytes,at,bytes.length-at,null)).bytesWritten;
      if(!n)throw new VmBuildError('link receipt short write','vm-object-retention');at+=n;state.writeBytes+=n;}
    await sink.sync();state.fsync=true;
  }catch(error){first=error;}finally{if(sink)try{await sink.close();state.writeClosed=true;}catch(error){first??=error;}}
    if(first){state.error=String(first);throw first;}return state;};
  const argv=text=>{const values=[];let i=0;
    while(i<text.length){while(/[ \t]/.test(text[i]??'')&&i<text.length)i++;if(i===text.length)break;
      let value='',quoted=false;
      while(i<text.length){const c=text[i];if(!quoted&&/[ \t]/.test(c))break;
        if(c==='\\'){let n=0;while(text[i]==='\\'){n++;i++;}
          if(text[i]==='"'){value+='\\'.repeat(Math.floor(n/2));if(n%2)value+='"';else quoted=!quoted;i++;}
          else value+='\\'.repeat(n);
        }else if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i+=2;}else{quoted=!quoted;i++;}}
        else{value+=c;i++;}}
      if(quoted)throw new VmBuildError('incomplete linker quoting','vm-object-retention');
      values.push(value);if(values.length>8192)throw new VmBuildError('link argv cap','vm-object-retention');
    }return values;};
  const acquire=async file=>{contained(file);if(path.relative(storage,file)===''||!path.relative(storage,file).startsWith('..'+path.sep))
      throw new VmBuildError('link input aliases retention','vm-object-retention');
    const state={source:file,bytes:0,sha256:null,before:null,fdBefore:null,fdAfter:null,after:null,EOF:null,
      sourceClosed:false,retained:{path:path.join(storage,String(result.objects.length).padStart(4,'0')+'.obj'),writeBytes:0,fsync:false,writeClosed:false},error:null};
    result.objects.push(state);let source,sink,first;const hash=createHash('sha256');
    try{await ordinary(file);const s=await lstat(file,{bigint:true});state.before=metadata(s);
      if(!active||!s.isFile()||s.size>BigInt(maximumFileBytes)||s.size>BigInt(maximumTotalBytes-total))
        throw new VmBuildError('link input producer/size','vm-object-retention');
      source=await open(file,'r');state.fdBefore=metadata(await source.stat({bigint:true}));
      if(!same(state.before,state.fdBefore))throw new VmBuildError('link input changed','vm-object-retention');
      sink=await open(state.retained.path,'wx');const buffer=Buffer.alloc(1048576);
      while(state.bytes<Number(s.size)){const n=(await source.read(buffer,0,Math.min(buffer.length,Number(s.size)-state.bytes),state.bytes)).bytesRead;
        result.readBytes+=n;if(!n)throw new VmBuildError('link input early EOF','vm-object-retention');
        hash.update(buffer.subarray(0,n));state.bytes+=n;total+=n;let at=0;
        while(at<n){const wrote=(await sink.write(buffer,at,n-at,null)).bytesWritten;if(!wrote)throw new VmBuildError('link input short write','vm-object-retention');at+=wrote;state.retained.writeBytes+=wrote;}}
      result.EOFCalls++;state.EOF=(await source.read(buffer,0,1,state.bytes)).bytesRead;result.readBytes+=state.EOF;
      state.fdAfter=metadata(await source.stat({bigint:true}));
      if(state.EOF!==0||!same(state.fdBefore,state.fdAfter)||!active)throw new VmBuildError('link input changed or producer closed','vm-object-retention');
      await sink.sync();state.retained.fsync=true;state.sha256='sha256:'+hash.digest('hex');
    }catch(error){first=error;}finally{
      if(source)try{await source.close();state.sourceClosed=true;}catch(error){first??=error;}
      if(sink)try{await sink.close();state.retained.writeClosed=true;}catch(error){first??=error;}}
    if(!first)try{state.after=metadata(await lstat(file,{bigint:true}));if(!same(state.before,state.after)||!active)
      throw new VmBuildError('link input changed or producer closed','vm-object-retention');}catch(error){first=error;}
    if(first){state.error=String(first);throw first;}
  };
  const line=async raw=>{let bytes=raw.subarray(0,raw.length-1);if(bytes.at(-1)===13)bytes=bytes.subarray(0,bytes.length-1);
    const text=bytes.toString('utf8');if(!/^lld-link(?:[ \t]|$)/i.test(text))return;
    if(result.lines.length>=16||raw.length>65536)throw new VmBuildError('link line cap','vm-object-retention');
    const record={retained:null,argv:null,producerActive:active,rawBytes:raw.length,
      rawSHA256:'sha256:'+createHash('sha256').update(raw).digest('hex')};result.lines.push(record);
    record.retained=await write(path.join(storage,'line-'+(result.lines.length-1)+'.bin'),raw);
    if(result.first!==null)return;if(!active||!Buffer.from(text).equals(bytes)||text.includes('\0'))throw new VmBuildError('link event outside live producer','vm-object-retention');
    const args=argv(text);record.argv=args;
    if(args.some(x=>x.startsWith('@')))throw new VmBuildError('unproven linker response file','vm-object-retention');
    const outputs=args.filter(x=>/^[-/]out:/i.test(x));
    if(outputs.length!==1||path.resolve(outputs[0].slice(5))!==path.resolve(output))throw new VmBuildError('link output mismatch','vm-object-retention');
    const objects=args.slice(1).filter(x=>/\.(?:obj|o)$/i.test(x));
    if(objects.length<1||objects.length>64||new Set(objects.map(x=>path.resolve(x))).size!==objects.length)
      throw new VmBuildError('link object list','vm-object-retention');
    for(const file of objects)await acquire(file);
  };
  const drain=async()=>{let reader,first;try{reader=await open(logPath,'r');const size=Number((await reader.stat()).size);
    if(size<offset||size>16777216)throw new VmBuildError('link event log cap/rewind','vm-object-retention');
    while(offset<size){const buffer=Buffer.alloc(Math.min(65536,size-offset));const n=(await reader.read(buffer,0,buffer.length,offset)).bytesRead;
      if(!n)break;offset+=n;result.logReadBytes+=n;fragment=Buffer.concat([fragment,buffer.subarray(0,n)]);
      let end;while((end=fragment.indexOf(10))!==-1){const raw=fragment.subarray(0,end+1);fragment=fragment.subarray(end+1);try{await line(raw);}catch(error){fail(error);}}
      if(fragment.length>65536)throw new VmBuildError('incomplete link line cap','vm-object-retention');}
  }catch(error){first=error;}finally{if(reader)try{await reader.close();}catch(error){first??=error;}}if(first)fail(first);};
  return{bind(pid){if(result.producerPid!==null||!Number.isSafeInteger(pid)||pid<1)throw new VmBuildError('link producer binding','vm-object-retention');result.producerPid=pid;active=true;},
    changed(){
      if(finished||result.first!==null)return pending?.promise??settled;
      dirty=true;
      if(pending===null){
        let complete;
        const promise=new Promise(resolve=>{complete=resolve;});
        pending={promise};
        // One worker owns the dirty flag. Clearing the flight and settling its
        // promise happen together, without a notification-sized promise queue.
        queueMicrotask(async()=>{
          try{while(dirty&&result.first===null){dirty=false;await drain();}}
          catch(error){fail(error);}
          finally{dirty=false;pending=null;complete();}
        });
      }
      return pending.promise;
    },
    producerClosed(){active=false;},failed(error){fail(error);},
    async finish(){if(finished)throw new VmBuildError('link observer already closed','vm-object-retention');finished=true;await(pending?.promise??settled);active=false;await drain();
      if(/^lld-link(?:[ \t]|$)/i.test(fragment.toString('utf8')))fail(new VmBuildError('incomplete linker line','vm-object-retention'));
      if(result.lines.length!==1)fail(new VmBuildError('complete linker record missing or ambiguous','vm-object-retention'));
      const counters=new Set(counterObjects.map(x=>path.resolve(x)));
      if(!result.objects.some(x=>!counters.has(path.resolve(x.source))&&x.error===null))fail(new VmBuildError('compiler object acquisition pending','vm-object-retention'));
      try{await write(path.join(storage,'receipt.json'),Buffer.from(JSON.stringify(result,null,2)+'\n'));}
      catch(error){fail(error);}return result;}};
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
export async function retainVmBootstrapArtifacts({stage,product,publish,identity,sha256,command=null,objectRetention=null,
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
    executionAuthority:false,resourceProof:null,first:null,objectRetention};
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
    let exit,first,objectRetention,watcher,observer;
    try {
      observer=label==='build-0'?await createVmLinkObjectRetention({stage,
        logPath:path.join(stage,`${label}.log`),output:path.join(publish,'tsfg-vm.exe'),
        counterObjects:command.args.filter(argument=>/\.(?:obj|o)$/i.test(argument))}):null;
      // Keep the native merged FD unchanged. Notifications may lose the race
      // with Zig cleanup; that is a failed acquisition, not a linked proof.
      if(observer){watcher=watch(path.join(stage,`${label}.log`),{persistent:false},()=>{void observer.changed();});
        watcher.on('error',error=>observer.failed(error));}
      exit=await new Promise((resolve,reject)=>{
        const child=spawn(command.executable,command.args,{cwd:command.cwd,env:command.environment,windowsHide:true,stdio:["ignore",log.fd,log.fd]});
        process.stderr.write(`VM ${label} child pid=${child.pid} log=${path.join(stage, `${label}.log`)}\n`);
        child.once("error",error=>{observer?.producerClosed();reject(error);});
        child.once("close",(code,signal)=>{observer?.producerClosed();resolve({code,signal});});
        if(observer){if(Number.isSafeInteger(child.pid))observer.bind(child.pid);
          else observer.failed(new VmBuildError('link producer PID unavailable','vm-object-retention'));}
      });
    }catch(error){first=error;}finally{
      if(watcher)try{watcher.close();}catch(error){first??=error;}
      try{await log.close();}catch(error){first??=error;}
      if(observer)try{objectRetention=await observer.finish();}catch(error){first??=error;}
    }
    try{await writeFile(path.join(stage,`${label}.exit.json`),serialize(observer?
      {...(exit??{code:null,signal:null}),objectRetention:objectRetention??null,first:first?String(first):null}:exit));}
    catch(error){first??=error;}
    if(first)throw first;
    if(exit.code===0&&objectRetention?.first)throw new VmBuildError(objectRetention.first,'vm-object-retention');
    return{...exit,objectRetention};
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
        objectRoots:[exit.objectRetention.storage],objectRetention:exit.objectRetention,
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
