// SPDX-License-Identifier: MIT
import { MlirBuildError,gitBytes } from './mlir-build-inputs.mjs';
import { lstat,mkdir,open,readFile,rename,writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readGpuFunctionComponent,inspectGpuFunctionComponent,readGpuFunctionComponentDependency,
  projectGpuFunctionComponentBuildIdentity,verifyGpuFunctionComponentBuildInputSet } from './mlir-sdk.mjs';
import { verifyCoreIrInputs } from './core-ir-inputs.mjs';
import { readCmakeTraceEvents,isPhysicalCmakeEvaluationCall } from './mlir-cmake-evaluation.mjs';
import { createZip } from './build-archive-writers.mjs';

// Command and library responsibilities share one complete Core language. The
// GPU library is an explicit independent component, never a Core CLI or SDK.
const roles = Object.freeze({
  native: Object.freeze({ role: 'native', target: 'tsfg-core-ir', executable: 'tsfg-core-ir.exe',
    symbols: 'tsfg-core-ir.pdb', native: true }),
  static: Object.freeze({ role: 'static', target: 'tsfg-core-static', executable: 'tsfg-core-static.exe',
    symbols: 'tsfg-core-static.pdb', native: false }),
  'gpu-function-resource-ir': Object.freeze({ role: 'gpu-function-resource-ir', target: 'tsfg-gpu-function-ir',
    library: 'tsfg-gpu-function-ir.lib', artifactKind: 'static-consumer-library', native: false })
});

/** Select a production target before any SDK body or source process is read. */
export function selectMlirCommandRole(options) {
  const role = options.get('--core-command-role') ?? 'native';
  if (!Object.hasOwn(roles, role))
    throw new MlirBuildError('Core command role must be static or native or gpu-function-resource-ir', 'mlir-command-role');
  return roles[role];
}

/** Operational stop point, independent of the unchanged payload build profile. */
export function selectMlirBuildPhase(options, command, sdkRequested = false) {
  const phase = options.get('--mlir-build-phase') ?? 'build';
  if (!['plan', 'build'].includes(phase))
    throw new MlirBuildError('Core build phase must be plan or build', 'mlir-command-role');
  if (options.has('--mlir-build-phase') && options.has('--source-target') && options.get('--source-target') !== 'mlir-core')
    throw new MlirBuildError('Core build phase requires the mlir-core source target', 'mlir-command-role');
  if (phase === 'plan' && (command.role !== 'static' || sdkRequested))
    throw new MlirBuildError('Core planning requires the static direct-source command', 'mlir-command-role');
  return phase;
}

/** Complete the existing factory's plan, before any Core target build. This
 * writes evidence only; its result cannot be admitted as a compiler artifact.
 */
export async function finishMlirPlanning({ phase, command, stage, trace, source, legal, python,
  productIdentity, workspaceState, serialize, verifyInputs }) {
  if (phase === 'build') return null;
  if (phase !== 'plan' || command.role !== 'static')
    throw new MlirBuildError('Core planning requires the static direct-source command', 'mlir-command-role');
  await verifyInputs();
  const tracePath = path.join(stage, 'planned-input-trace.json');
  await writeFile(tracePath, serialize(trace), { flag: 'wx' });
  return { schemaVersion: '1', status: 'planned', sourceBuild: 'not-run', intakeComplete: false,
    executionMode: 'local-development', isolation: 'not-enforced', publishable: false,
    coreCommandRole: command.role, dirty: workspaceState.dirty, source, legal, python, stage, trace: tracePath,
    planning: { target: command.target, productBuildIdentity: productIdentity.buildIdentity,
      targetBuild: 'not-started', finalDependencyClosure: 'not-qualified' } };
}

/** The original SDK intake authenticates the historical full compiler and every
 * inventory body. A static target alone cannot remove those actual dependencies.
 * Keep that intake and SDKv2 membership intact. Static SDK building requires an
 * independently authenticated consumption closure; absence is a local HOLD, not
 * permission to silently trim the lock, skip provenance or relabel a full SDK.
 */
export function requireMlirSdkCommandIntake(command, sdkRequested) {
  if (sdkRequested && command.role === 'gpu-function-resource-ir')
    throw new MlirBuildError('GPU function IR uses its independent component; the full SDK cannot satisfy that role', 'mlir-command-role');
  if (sdkRequested && command.role === 'static')
    throw new MlirBuildError(
      'Static Core SDK intake is not qualified: the current authenticated intake reads the historical full compiler and complete SDK inventory; a scoped authenticated dependency closure is required',
      'mlir-static-sdk-consumption');
}

/** A live independently authenticated component is the only configuration source.
 * Physical locations remain local configuration, outside normative input identity. */
export function gpuFunctionCmakeConfiguration(component,productRoot) {
  const proof=inspectGpuFunctionComponent(component,productRoot);
  return {role:'gpu-function-resource-ir',descriptorHash:proof.descriptorHash,
    includeDirectories:proof.includeDirectories,archives:proof.archives};
}

/** Project an already authenticated proof into relocatable artifact data.
 * Qualification files describe a local observation, not another input identity. */
export function gpuFunctionArtifactIdentity(proof) {
  return {projectId:proof.descriptor.projectId,descriptorHash:proof.descriptorHash,
    sourceCommit:proof.sourceIdentity.sourceCommit,sourceTree:proof.sourceIdentity.sourceTree,
    sourceHistoryMaximum:proof.epochProof.sourceHistoryMaximum};
}

/** Formal STATIC API library factory. No upstream package/export is evaluated,
 * and no Source program, native entry, VM or device is executed. */
export async function executeGpuFunctionTarget({options,runtime,tools,productRoot,workspaceState,serialize,createIdentity,
  verifyTools,command,stageProduct,runLogged,validateOutputAncestor,validatePublication}) {
  requireMlirSdkCommandIntake(command,Boolean(process.env.TSFG_MLIR_SDK_ROOT||process.env.TSFG_MLIR_SDK_ARTIFACT_ROOT));
  selectMlirBuildPhase(options,command);
  if(!runtime||!tools||typeof verifyTools!=='function')
    throw new MlirBuildError('GPU component requires the verified native tool closure','mlir-tool-integrity');
  const rootLocations={'sdk-current':process.env.TSFG_GPU_FUNCTION_IR_SDK_ROOT,'spirv-emit':process.env.TSFG_GPU_FUNCTION_IR_SPIRV_ROOT};
  const qualification={path:process.env.TSFG_GPU_FUNCTION_IR_QUALIFICATION,sha256:process.env.TSFG_GPU_FUNCTION_IR_QUALIFICATION_SHA256};
  const epochProof={path:process.env.TSFG_GPU_FUNCTION_IR_EPOCH_PROOF,sha256:process.env.TSFG_GPU_FUNCTION_IR_EPOCH_PROOF_SHA256};
  const component=await readGpuFunctionComponent({productRoot,rootLocations,qualification,epochProof,canonicalize:serialize});
  const proof=inspectGpuFunctionComponent(component,productRoot),hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
  const within=(root,file)=>{const relative=path.relative(root,file);return relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
  const slash=file=>file.replaceAll('\\','/'),output=path.resolve(options.get('--out'));
  if(!/^E:[\\/]/i.test(output)||[...Object.values(proof.rootLocations),runtime.closurePath,productRoot].some(root=>within(root,output)))
    throw new MlirBuildError('GPU output requires an independent absolute E root','mlir-output-integrity');
  await validateOutputAncestor(path.dirname(output));
  if(await lstat(output).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))
    throw new MlirBuildError('Independent GPU component output already exists','mlir-output-integrity');
  const base=await createIdentity(runtime,productRoot),identity=projectGpuFunctionComponentBuildIdentity(base,component,serialize);
  const coreInputs=await verifyCoreIrInputs(identity,productRoot,command.role);
  const controls=['eng/mlir-build.mjs','eng/mlir-command.mjs','eng/mlir-sdk.mjs','eng/build-identity.mjs',
    'eng/build-dependency-policy.mjs','eng/build-archive-writers.mjs','eng/mlir-compiler-launcher.mjs','eng/build-inputs.json'];
  for(const name of [...controls,...coreInputs]) {
    const raw=await readFile(path.join(productRoot,name)),entry=identity.buildInputSet.entries.find(row=>row.projectId==='tsfg'&&row.repositoryRelativePath===name);
    if(entry?.sha256!==hash(raw)||!raw.equals(gitBytes(process.env.TSFG_GIT,productRoot,['show','HEAD:'+name])))
      throw new MlirBuildError('GPU factory input must match committed declared bytes: '+name,'mlir-source-integrity');
  }
  await verifyTools();await mkdir(path.dirname(output),{recursive:true});await validateOutputAncestor(path.dirname(output));
  const stage=path.join(path.dirname(output),'.gpu-ir-'+randomUUID()),build=path.join(stage,'build'),product=path.join(stage,'product');
  await mkdir(build,{recursive:true});
  const failure=await open(path.join(stage,'failure.json'),'wx');
  try {
    await writeFile(path.join(stage,'component-provenance.json'),serialize({rootLocations:proof.rootLocations,
      sourceIdentity:proof.sourceIdentity,qualification:proof.qualification,epochProof:proof.epochProof}),{flag:'wx'});
    const productInputs=new Set(await stageProduct({productRoot,product,identity,command}));
    const configuration=gpuFunctionCmakeConfiguration(component,productRoot),configPath=path.join(stage,'component-configuration.json'),configBytes=serialize(configuration)+'\n';
    await writeFile(configPath,configBytes,{flag:'wx'});
    const env={SystemRoot:process.env.SystemRoot,ComSpec:process.env.ComSpec,TZ:'UTC',LANG:'C.UTF-8',SOURCE_DATE_EPOCH:identity.buildIdentity.source_date_epoch,
      PATH:[tools.cmake,tools.ninja,tools.clangcl,tools.lld,tools.rc,tools.cl].map(file=>path.dirname(file)).join(';'),
      HOME:stage,USERPROFILE:stage,APPDATA:stage,LOCALAPPDATA:stage,TEMP:stage,TMP:stage,TMPDIR:stage,
      INCLUDE:tools.include.join(';'),LIB:tools.lib.join(';'),LIBPATH:tools.lib.join(';')};
    const flags=['/Od','/Z7','/UNDEBUG','/EHs-c-','/GR-','/clang:-march=x86-64-v2','/clang:-mtune=generic','/clang:-mno-avx',
      '/clang:-fno-lto','/clang:-fno-fast-math','/clang:-fdebug-compilation-dir=.','/clang:-gno-codeview-command-line',
      ...[[product,'.product'],[build,'.build'],[runtime.closurePath,'.toolchain'],...Object.entries(proof.rootLocations).map(([id,root])=>[root,'.component/'+id])]
        .flatMap(([root,label])=>['/clang:-ffile-prefix-map='+slash(root)+'='+label,'/clang:-fdebug-prefix-map='+slash(root)+'='+label])].map(flag=>'"'+flag+'"').join(' ');
    const launcher=[tools.node,path.join(product,'eng/mlir-compiler-launcher.mjs'),tools.clangcl,proof.rootLocations['sdk-current'],product,build].map(slash).join(';');
    const args=['--trace-expand','--trace-format=json-v1','--trace-redirect='+slash(path.join(stage,'cmake-trace.jsonl')),
      '-S',slash(path.join(product,'compiler/core-ir')),'-B',slash(build),'-G','Ninja','-DTSFG_CORE_BUILD_ROLE='+command.role,
      '-DTSFG_GPU_COMPONENT_CONFIGURATION='+slash(configPath),'-DCMAKE_BUILD_TYPE=Debug','-DCMAKE_MAKE_PROGRAM='+slash(tools.ninja),
      '-DCMAKE_C_COMPILER='+slash(tools.clangcl),'-DCMAKE_CXX_COMPILER='+slash(tools.clangcl),'-DCMAKE_LINKER='+slash(tools.lld),
      '-DCMAKE_AR='+slash(path.join(path.dirname(tools.clangcl),'llvm-lib.exe')),'-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY',
      '-DCMAKE_RC_COMPILER='+slash(tools.rc),'-DCMAKE_MT='+slash(tools.mt),'-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDebug',
      '-DCMAKE_POLICY_DEFAULT_CMP0141=NEW','-DCMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded',
      '-DCMAKE_C_COMPILER_LAUNCHER='+launcher,'-DCMAKE_CXX_COMPILER_LAUNCHER='+launcher,
      '-DCMAKE_C_FLAGS='+flags,'-DCMAKE_CXX_FLAGS='+flags,'-DCMAKE_C_FLAGS_DEBUG=/Od /Z7 /UNDEBUG','-DCMAKE_CXX_FLAGS_DEBUG=/Od /Z7 /UNDEBUG',
      '-DCMAKE_PREFIX_PATH=','-DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF','-DCMAKE_FIND_USE_SYSTEM_PACKAGE_REGISTRY=OFF'];
    await runLogged(tools.cmake,args,stage,env,path.join(stage,'configure.log'));
    const observed=new Set(),frames=[];
    const trace=await readCmakeTraceEvents(createReadStream(path.join(stage,'cmake-trace.jsonl')),record=>{
      if(!record.file)return;let name=record.file;
      for(let frame;(frame=/^(.*):([1-9][0-9]*):EVAL$/.exec(name));){frames.push({file:frame[1],line:Number(frame[2])});name=frame[1];}
      observed.add(path.resolve(build,name));
    });
    const capture=args=>{
      const child=spawnSync(tools.ninja,args,{cwd:build,env,encoding:'utf8',windowsHide:true,maxBuffer:128*1024*1024});
      if(child.error||child.status!==0)throw new MlirBuildError('Cannot inspect GPU component Ninja dependencies');return child.stdout;
    };
    const planned=capture(['-t','commands',command.target]);
    await writeFile(path.join(stage,'ninja-commands.txt'),planned,{flag:'wx'});
    // Imported archives are a verified ordered link interface, not inputs merged
    // into this STATIC archive. A final consumer must link the same interface.
    for(const archive of proof.archives)await readGpuFunctionComponentDependency(component,archive.absolute,productRoot);
    await runLogged(tools.cmake,['--build',slash(build),'--target',command.target,'--parallel','4'],stage,env,path.join(stage,'build.log'));
    const inputs=capture(['-t','inputs','-E','-0',command.target]),configurationInputs=capture(['-t','inputs','-E','-0','build.ninja']),deps=capture(['-t','deps']);
    await writeFile(path.join(stage,'ninja-inputs.nul'),inputs,{flag:'wx'});await writeFile(path.join(stage,'ninja-configuration-inputs.nul'),configurationInputs,{flag:'wx'});
    await writeFile(path.join(stage,'ninja-deps.txt'),deps,{flag:'wx'});
    for(const name of [...inputs.split('\0'),...configurationInputs.split('\0'),...deps.split(/\r?\n/).filter(line=>/^    \S/.test(line)).map(line=>line.trim())])
      if(name)observed.add(path.resolve(build,name));
    const productFiles=[],componentFiles=[],toolInputs=[],generated=[];
    for(const absolute of observed) {
      let raw;
      if(within(product,absolute)) {
        const name=slash(path.relative(product,absolute)),entry=identity.buildInputSet.entries.find(row=>row.projectId==='tsfg'&&row.repositoryRelativePath===name);
        if(!productInputs.has(name))throw new MlirBuildError('GPU build read an undeclared staged product input: '+name,'mlir-source-integrity');
        raw=await readFile(absolute);if(entry?.sha256!==hash(raw))throw new MlirBuildError('GPU staged product input changed: '+name,'mlir-source-integrity');productFiles.push(entry);
      } else if(Object.values(proof.rootLocations).some(root=>within(root,absolute))) {
        raw=await readGpuFunctionComponentDependency(component,absolute,productRoot);componentFiles.push({path:absolute,sha256:hash(raw)});
      } else if(within(runtime.closurePath,absolute)) {
        raw=await readFile(absolute);toolInputs.push({path:slash(path.relative(runtime.closurePath,absolute)),sha256:hash(raw)});
      } else if(absolute===configPath) {
        raw=await readFile(absolute);if(!raw.equals(Buffer.from(configBytes)))throw new MlirBuildError('GPU component configuration changed','mlir-source-integrity');
      } else if(within(build,absolute)) {
        const state=await lstat(absolute).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(!state?.isFile())continue;raw=await readFile(absolute);generated.push({path:slash(path.relative(build,absolute)),sha256:hash(raw)});
      } else throw new MlirBuildError('GPU build dependency is outside its explicit component/product/tool roots: '+absolute,'mlir-source-integrity');
      for(const frame of frames.filter(frame=>path.resolve(build,frame.file)===absolute))if(!isPhysicalCmakeEvaluationCall(raw.toString('utf8'),frame.line))
        throw new MlirBuildError('GPU CMake EVAL has no physical origin','mlir-source-integrity');
    }
    const inputTrace={schemaVersion:'1',role:command.role,productFiles,componentFiles,toolInputs,generated,
      linkInterfaceArchives:proof.archives,cmakeTraceSha256:trace.sha256,ninjaInputsSha256:hash(inputs),ninjaDepsSha256:hash(deps),executionAuthority:false};
    await writeFile(path.join(stage,'input-trace.json'),serialize(inputTrace),{flag:'wx'});
    const publish=path.join(stage,'publish');await mkdir(publish);const outputs=[];
    const save=async(name,raw)=>{await writeFile(path.join(publish,name),raw,{flag:'wx'});outputs.push({path:name,sha256:hash(raw)});};
    await save(command.library,await readFile(path.join(build,'lib',command.library)));
    const catalog=JSON.parse(await readFile(path.join(product,'compiler/core-ir/sources.json'),'utf8'));
    const headers=await Promise.all([...catalog.common.headers,...catalog[command.role].headers].map(async name=>({path:'include/'+name,mode:0o100644,bytes:await readFile(path.join(product,'compiler/core-ir',name))})));
    await save('tsfg-gpu-function-ir-headers.zip',createZip(headers,Number(identity.buildIdentity.source_date_epoch)));
    await save('component-interface.json',serialize({schemaVersion:'1',role:command.role,artifactKind:command.artifactKind,descriptor:proof.descriptor,descriptorHash:proof.descriptorHash,
      library:command.library,publicHeaders:'tsfg-gpu-function-ir-headers.zip',executionAuthority:false})+'\n');
    const {sourceRoot,...sourceIdentity}=proof.sourceIdentity;
    await save('source-notices.json',serialize({schemaVersion:'1',scope:command.role,sourceIdentity,sourceEntries:proof.sourceEntries,
      licenseMaterials:proof.licenseMaterials,fullSdkQualification:false})+'\n');
    outputs.sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
    const manifest={schemaVersion:'1',artifactKind:command.artifactKind,coreCommandRole:command.role,buildIdentity:identity.buildIdentity,buildInputSet:identity.buildInputSet,
      contractSetId:identity.contractSetId,productVersion:identity.productVersion,toolchainClosureDigest:identity.buildIdentity.toolchainClosureDigest,outputs,
      component:gpuFunctionArtifactIdentity(proof),executionAuthority:false,publishable:false,
      capability:'typed GPU function/resource IR STATIC consumer API; no Core command entry, Source/VM/native/device execution or full SDK qualification'};
    await writeFile(path.join(publish,'artifact-manifest.json'),serialize(manifest),{flag:'wx'});
    const after=await readGpuFunctionComponent({productRoot,rootLocations,qualification,epochProof,canonicalize:serialize}),afterProof=inspectGpuFunctionComponent(after,productRoot);
    const current=projectGpuFunctionComponentBuildIdentity(await createIdentity(runtime,productRoot),after,serialize);
    if(serialize(current.buildIdentity)!==serialize(identity.buildIdentity)||afterProof.descriptorHash!==proof.descriptorHash)
      throw new MlirBuildError('GPU component/product identity changed during build','mlir-source-integrity');
    verifyGpuFunctionComponentBuildInputSet(identity.buildInputSet,after,serialize);await verifyTools();
    await validatePublication(publish,manifest,serialize);await rename(publish,output);await validatePublication(output,manifest,serialize);
    return {schemaVersion:'1',status:'built',sourceBuild:'built',intakeComplete:false,executionMode:'local-development',isolation:'not-enforced',publishable:false,executionAuthority:false,
      artifactKind:command.artifactKind,coreCommandRole:command.role,dirty:workspaceState.dirty,buildIdentity:identity.buildIdentity,buildInputSet:identity.buildInputSet,
      output,outputs,stage,trace:path.join(stage,'input-trace.json'),requiredAcceptance:'real independent consumer link and typed metadata tests remain required'};
  } catch(error) {await failure.writeFile(serialize({status:'failed',message:error.message}));throw error;}
  finally {await failure.close();}
}
