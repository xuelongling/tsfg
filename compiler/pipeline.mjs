// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDataView, isProxy } from "node:util/types";
import { analyzeFrontend } from "./frontend.mjs";
import { compilePackageHir } from "./generic-package-frontend.mjs";
import { genericHirFormat, lowerGenericHir, prepareGenericCore } from "./generic-hir.mjs";
export { compilePackageHir };
import { buildHir, lowerHir, lowerFormalHir, prepareCommonCore } from "./hir.mjs";
import { canonical, own, sha256 } from "./identity.mjs";
import {readSystemQueryFactsAndContext} from './system-query-facts.mjs';
import {checkQueryBatchSource,checkQueryLlvmDialect,emitSystemQueryCore,escapeQueryCompilerBytes,systemQuerySystemIdentity} from './system-query-core.mjs';
import {readSystemQueryEffects} from './system-query-effects.mjs';
import {readSystemQueryTmeta} from './system-query-tmeta.mjs';
import {commonProgramCore} from './common-program-core.mjs';
import {isCommonProgramContext} from './common-program-hir.mjs';
import {commonHirFormat} from './common-program-common.mjs';
import {hirFormat as nullableHirFormat,isSelectedNullableContext} from './nullable-common.mjs';
import {isTypedArrayContext} from './typed-array-hir.mjs';
import {typedArrayHirFormat,typedArrayHirV9Format,typedArrayHirV10Format,typedArrayHirV11Format} from './typed-array-project.mjs';
import {isOptionalPropertyContext,optionalPropertyHirFormat} from './optional-property-hir.mjs';
import {referenceHirFormat} from './reference-hir.mjs';
import {prepareFiniteCore} from './finite-core-emitter.mjs';
import {prepareFormalStringCore} from './string-formal-emitter.mjs';
import {stringHirType} from './string-hir-model.mjs';
import {familyOf} from './module-callable-common.mjs';
import {readCommonBorrowProof} from './common-program-borrow-proof.mjs';
import { verifyCounterHostContract } from "../eng/host-semantic-contract.mjs";
import {verifyCoreIrInputs} from "../eng/core-ir-inputs.mjs";
import {runtimeSources} from "../eng/vm-build.mjs";
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };
import {readCoreInputIdentity,verifyAotPacketInput,verifyAotProducedObject,verifyAotProducedPacket,verifyProducedPacket} from './producer-packet.mjs';
import {verifyCommonProducedPacket} from './common-program-packet.mjs';

const productRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * @template Row
 * @param {Row[] | undefined} rows
 * @param {(row: Row) => boolean} matches
 */
function uniqueManifestRow(rows, matches) {
  const selected = Array.isArray(rows) ? rows.filter(matches) : [];
  return selected.length === 1 ? selected[0] : undefined;
}

/** Verify the actual source-built consumer admission boundary without executing it. */
export async function verifiedConsumer(executable, role) {
  if (!["core", "core-native", "vm", "aot"].includes(role)) throw new TypeError("r03-tool-role: unsupported consumer");
  if (!executable) throw new TypeError(`r03-tool-${role}: formal executable is required`);
  const executableName = path.basename(executable);
  if (role === "aot" && executableName !== "tsfg-aot.exe")
    throw new TypeError("r03-tool-aot: published executable must be tsfg-aot.exe");
  const manifest = JSON.parse(await readFile(path.join(path.dirname(executable), "artifact-manifest.json"), "utf8"));
  /** @param {string} name */
  const artifactRow = name => uniqueManifestRow(manifest.outputs, row => row?.path === name);
  const output = artifactRow(executableName);
  if (!output || output.sha256 !== sha256(await readFile(executable)))
    throw new TypeError(`r03-tool-${role}: executable differs from its source-build manifest`);
  if (manifest.buildIdentity?.target !== "windows-x86_64-msvc"
      || manifest.buildIdentity?.profile !== "debug")
    throw new TypeError(`r03-tool-${role}: unsupported target/profile identity`);
  const coreRole = role === "core" || role === "core-native";
  const commandRole = manifest.buildIdentity.options?.coreCommandRole;
  if (coreRole && !["static", "native"].includes(commandRole))
    throw new TypeError("r03-tool-core: explicit compiler command role is required");
  if (coreRole && manifest.coreCommandRole !== undefined && manifest.coreCommandRole !== commandRole)
    throw new TypeError("r03-tool-core: compiler command role differs from build identity");
  if (role === "core-native" && commandRole !== "native")
    throw new TypeError("r03-tool-core-native: full native compiler command role is required");
  if (coreRole) await verifyCoreIrInputs(manifest, productRoot, commandRole);
  const required = coreRole
    ? ["eng/mlir-command.mjs"]
    : [...runtimeSources, "eng/runtime-entry.mjs", "eng/host-counter.mjs", "eng/host-counter-binary.mjs",
      "eng/host-cost-source.lock.json", "eng/vm-build.mjs", "eng/host-counter-objects.mjs",
      "eng/output-storage.mjs", "eng/host-semantic-contract.mjs", "contracts/host-counter-semantic-v1.json"];
  required.push("contracts/registry.json", "contracts/bytecode.schema.json");
  if (role === "aot") required.push("runtime/aot-main.zig", "runtime/aot-program.zig", "runtime/aot-program.h",
    "runtime/aot-request.zig", "runtime/aot-events.zig", "runtime/request-json.zig", "runtime/module-outcome-writer.zig", "eng/aot-build.mjs");
  for (const name of required) {
    const entry = uniqueManifestRow(manifest.buildInputSet?.entries,
      row => row?.projectId === "tsfg" && row.repositoryRelativePath === name);
    if (!entry || entry.sha256 !== sha256(await readFile(path.join(productRoot, name))))
      throw new TypeError(`r03-tool-${role}: compiled input differs from current ${name}`);
  }
  if(role==="vm") {
    const contractOutput=artifactRow("host-semantic-contract.json");
    const contractBytes=await readFile(path.join(path.dirname(executable),"host-semantic-contract.json"));
    if(contractOutput?.sha256!==sha256(contractBytes))throw new TypeError("r03-tool-vm: semantic contract differs from formal build");
    verifyCounterHostContract(contractBytes,manifest);
    const entry=artifactRow("host-cost-summary.json");
    const bytes=await readFile(path.join(path.dirname(executable),"host-cost-summary.json"));
    if(entry?.sha256!==sha256(bytes))throw new TypeError("r03-tool-vm: host summary differs from formal build");
    const summary=JSON.parse(bytes.toString("utf8"));
    if(summary.summaryVersion!=="tsfg-host-cost-v1"||summary.linkedRuntimeHash!==output.sha256)
      throw new TypeError("r03-tool-vm: host summary belongs to a different Runtime");
  }
  if (role === "aot") {
    if (manifest.executionBackend !== "aot-v4" || manifest.buildIdentity.options?.sourceTarget !== "tsfg-aot")
      throw new TypeError("r03-tool-aot: not a statically compiled ordinary program");
    const artifact = async name => {
      const bytes = await readFile(path.join(path.dirname(executable), name));
      if (artifactRow(name)?.sha256 !== sha256(bytes))
        throw new TypeError(`r03-tool-aot: changed ${name}`);
      return bytes;
    };
    const core=await artifact("program.mlir");
    const inputIdentity=readCoreInputIdentity(decodeCompilerText(core,"r03-tool-aot"));
    if (inputIdentity===undefined)
      throw new TypeError("r03-tool-aot: missing unique Core input identity");
    const wire=await artifact("program.tbc");
    verifyAotProducedPacket(wire,inputIdentity);
    const programObject=await artifact("program.obj");
    const compiledTableId=verifyAotProducedObject(programObject,wire,inputIdentity);
    const programCore=sha256(core);
    if (manifest.program?.core !== programCore || manifest.buildIdentity.options.programCore !== programCore
        || manifest.program?.object !== sha256(programObject)
        || manifest.program?.bytecode !== sha256(wire)
        || manifest.program?.compiledTableId !== compiledTableId)
      throw new TypeError("r03-tool-aot: compiled program identity mismatch");
    verifyCounterHostContract(await artifact("host-semantic-contract.json"), manifest);
  }
  return executable;
}

function consume(executable, args, input) {
  const child = spawnSync(executable, args, { input, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 300000 });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new TypeError(child.stderr.toString("utf8").trim() || `consumer exited ${child.status}`);
  return child.stdout;
}

/** @param {Buffer} bytes @param {string} diagnostic */
function decodeCompilerText(bytes,diagnostic){
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{throw new TypeError(`${diagnostic}: invalid UTF-8 in compiler output`);}
}

/** Compile complete owned Query input through the independent static consumer.
 * @param {Uint8Array} bytes @param {unknown} context
 * @param {{core:string,optimize?:boolean,effects?:boolean,cpuBatch?:boolean,cpuLLVM?:'dialect'|'ir',tmeta?:boolean}} options
 */
export async function compileSystemQuery(bytes,context,options){
  const {facts,context:sourceContext}=readSystemQueryFactsAndContext(bytes,context);
  const {core:corePath,optimize,effects,cpuBatch,cpuLLVM,tmeta}=options;
  const executable=await verifiedConsumer(corePath,'core');
  const consumeQuery=(command,input)=>consume(executable,['--system-query',command],input);
  const coreBytes=consumeQuery(optimize?'--optimize':'--canonicalize',emitSystemQueryCore(facts,sourceContext));
  return readQueryCompilerOutputs(facts,sourceContext,coreBytes,{effects,cpuBatch,cpuLLVM,tmeta},consumeQuery);
}

/** @param {Buffer} bytes @param {'core'|'batch'|'llvm'} stage */
function decodeQueryCompilerText(bytes,stage){
  // Match the byte limit of the independent batch and LLVM consumers.
  if(stage!=='core'&&(bytes.length===0||bytes.length>8*1024*1024))
    throw new TypeError(`r10-system-query-${stage}: compiler output size differs`);
  if(stage==='batch'&&bytes.at(-1)!==10)
    throw new TypeError('r10-system-query-batch: compiler output requires a final LF');
  return decodeCompilerText(bytes,`r10-system-query-${stage}`);
}

/** Match the official printer's target declarations and byte-escaped batch proof.
 * @param {string} llvm @param {string} batch
 * @param {import('./system-query-facts.mjs').SystemQueryFacts['program']['target']} target
 */
function checkQueryLlvmPair(llvm,batch,target){
  const lines=llvm.split('\n');
  const definitions=/** @param {string} id */ id=>lines.filter(line=>{
    const equals=line.indexOf('=');
    return equals>=0&&line.slice(0,equals).trim()===id;
  });
  for(const [name,value] of [['target triple',target.triple],['target datalayout',target.llvmDataLayout]]){
    const declaration=definitions(name);
    if(declaration.length!==1||declaration[0]!==name+' = "'+value+'"')
      throw new TypeError('r10-system-query-llvm: checked target differs');
  }
  const named=definitions('!tsfg.query.cpu');
  const id=named.length===1&&/^!tsfg\.query\.cpu = !\{(![0-9]+)\}$/u.exec(named[0])?.[1];
  if(id){
    const proof=definitions(id);
    const encoded=escapeQueryCompilerBytes(Buffer.from(batch));
    if(proof.length===1&&proof[0]===id+' = !{!"1", !"'+encoded+'"}')return;
  }
  throw new TypeError('r10-system-query-llvm: checked batch proof differs');
}

/** Match the checked entry and helper definitions emitted by the Query printer.
 * @param {string} llvm @param {import('./system-query-facts.mjs').SystemQueryFacts} facts
 * @param {'dialect'|'ir'} format
 */
function checkQueryLlvmEntries(llvm,facts,format){
  const fail=()=>{throw new TypeError('r10-system-query-llvm: checked entry ABI differs');};
  const dialect=format==='dialect';
  // Each byte memref expands to two pointers and three indices. Its extra
  // index is a row stride for an entry and a row byte offset for a helper.
  const column=['ptr','ptr','i64','i64','i64','i64'];
  const floating=/** @param {string} type */ type=>{
    if(type==='f32')return dialect?'f32':'float';
    if(type==='f64')return dialect?'f64':'double';
    return fail();
  };
  /** @param {string} symbol @param {string} result @param {string[]} types */
  const definition=(symbol,result,types)=>{
    if(dialect)return symbol+' '+result+' ('+types.join(', ')+')';
    const parameters=types.map((type,index)=>`${type} %${index}`).join(', ');
    return `define ${result} @${symbol}(${parameters}) {`;
  };
  const expected=new Set();
  for(const system of facts.systems){
    if(system.loops.length===0)continue;
    const {id}=systemQuerySystemIdentity(system);
    const scalars=system.parameters.filter(parameter=>!parameter.query).map(parameter=>floating(parameter.logicalType));
    for(const [index,loop] of system.loops.entries()){
      const components=[...new Set(loop.bindings.map(binding=>binding.componentType))];
      expected.add(definition('batch_'+id.slice(7)+'_'+index,'void',['i64',...components.flatMap(()=>column),...scalars]));
    }
  }
  for(const helper of facts.scalarHelpers)
    expected.add(definition('batch_helper_'+helper.id.slice(7),floating(helper.sourceReturnType),
      helper.parameters.flatMap(parameter=>parameter.view?column:[floating(parameter.logicalType)])));
  const definitions=dialect?/^[ \t]*"llvm\.func"[^\r\n]*/gmu:/^[ \t]*define\b[^\r\n]*/gmu;
  for(const [line] of llvm.matchAll(definitions)){
    let entry=line;
    if(dialect){
      // Match the canonical top-level printer header and read its ABI fields.
      const properties=/^  "llvm\.func"\(\) <\{(.*)\}> \(\{$/u.exec(line)?.[1]??'';
      const types=[...properties.matchAll(/(?:^|, )function_type = !llvm\.func<([^>]+)>(?=, |$)/gu)];
      const symbols=[...properties.matchAll(/(?:^|, )sym_name = "([^"]+)"(?=, |$)/gu)];
      const conventions=[...properties.matchAll(/(?:^|, )CConv = #llvm\.cconv<([^>]+)>(?=, |$)/gu)];
      const linkages=[...properties.matchAll(/(?:^|, )linkage = #llvm\.linkage<([^>]+)>(?=, |$)/gu)];
      if(types.length!==1||symbols.length!==1||conventions.length!==1||conventions[0][1]!=='ccc'||
        linkages.length!==1||linkages[0][1]!=='external')fail();
      entry=symbols[0][1]+' '+types[0][1];
    }
    if(!expected.delete(entry))fail();
  }
  if(expected.size!==0)fail();
}

/** Collect outputs from the same verified static Query consumer.
 * @internal
 * @param {import('./system-query-facts.mjs').SystemQueryFacts} facts @param {unknown} sourceContext
 * @param {Buffer} coreBytes @param {{effects?:boolean,cpuBatch?:boolean,cpuLLVM?:'dialect'|'ir',tmeta?:boolean}} options
 * @param {(command:string,input:string)=>Buffer} consumeQuery
 */
export function readQueryCompilerOutputs(facts,sourceContext,coreBytes,options,consumeQuery){
  const core=decodeQueryCompilerText(coreBytes,'core');
  requireCheckedCoreInput(core,facts.inputIdentity,'r10-system-query-core');
  const {effects:includeEffects,cpuBatch:includeBatch,cpuLLVM:llvmOutput,tmeta:includeTmeta}=options;
  const effects=includeEffects?readSystemQueryEffects(consumeQuery('--effects',core),facts,sourceContext):undefined;
  const needsCheckedBatch=includeBatch||includeTmeta||llvmOutput!==undefined;
  const checkedBatch=needsCheckedBatch?decodeQueryCompilerText(consumeQuery('--cpu-batch',core),'batch'):core;
  if(needsCheckedBatch)checkQueryBatchSource(checkedBatch,coreBytes,facts.inputIdentity);
  const cpuBatch=includeBatch?checkedBatch:undefined;
  const llvmBytes=llvmOutput?consumeQuery(llvmOutput==='ir'?'--llvm-ir':'--cpu-llvm',checkedBatch):undefined;
  const cpuLLVM=llvmBytes?decodeQueryCompilerText(llvmBytes,'llvm'):undefined;
  if(cpuLLVM&&(llvmOutput==='ir'||llvmOutput==='dialect')){
    if(llvmOutput==='ir')checkQueryLlvmPair(cpuLLVM,checkedBatch,facts.program.target);
    else checkQueryLlvmDialect(cpuLLVM,checkedBatch,facts.program.target);
    checkQueryLlvmEntries(cpuLLVM,facts,llvmOutput);
  }
  const tmeta=includeTmeta?readSystemQueryTmeta(consumeQuery('--tmeta',checkedBatch),facts,sourceContext,checkedBatch):undefined;
  const llvmArtifact=llvmOutput==='ir'&&llvmBytes&&tmeta?own({
    llvmHash:sha256(llvmBytes),
    batchHash:tmeta.payload.batchHash,
    metadataHash:tmeta.envelope.payloadHash,
  }):undefined;
  return {status:'ok',facts,core,effects,...(cpuBatch===undefined?{}:{cpuBatch}),...(cpuLLVM===undefined?{}:{cpuLLVM}),
    ...(tmeta===undefined?{}:{tmeta}),...(llvmArtifact===undefined?{}:{llvmArtifact})};
}

/** Existing complete Common HIR/fixed bounds to the independent static proof.
 * @param {{core:string}} options
 */
export async function compileCommonBorrowProof(hir,publication,request,options){
  const product=commonProgramCore(hir,publication,request,{borrowProof:true});
  const fixed=own({publication,request});
  const executable=await verifiedConsumer(options.core,'core');
  const core=decodeCompilerText(consume(executable,['--common-program','--canonicalize'],product.text),'r03-core-output');
  requireCheckedCoreInput(core,product.hir.inputIdentity);
  const proof=readCommonBorrowProof(consume(executable,['--common-program','--borrow-proof'],core),product.hir,fixed.publication,fixed.request);
  return {status:'ok',hir:product.hir,core,proof};
}

/** Officially checked source to owned HIR; no native execution is needed to view it. */
export async function compileHir(input, options) {
  const analyzed = await analyzeFrontend(input, { executable: options.frontend });
  if (analyzed.status !== "ok") return analyzed;
  return buildHir(analyzed.snapshot);
}

/** Capture the selected tools and lowering options before the frontend can wait.
 * @param {{frontend?:string, core?:string, optimize?:boolean, factsContext?:unknown, callPublicationContext?:unknown}} [options]
 */
function captureSourceCompilationOptions({ frontend, core, optimize, factsContext, callPublicationContext } = {}) {
  return { frontend, core, optimize, factsContext, callPublicationContext };
}

/** Compile only through official checking, owned HIR and the real C++ SSA consumer. */
export async function compileProgram(input, options) {
  const selected = captureSourceCompilationOptions(options);
  const highLevel = await compileHir(input, selected);
  return highLevel.status === "ok" ? produceBytecode(() => produceCore(highLevel.hir, selected)) : highLevel;
}

/** Produce verified Core text from officially checked Source. */
export async function compileSourceCore(input, options) {
  const selected = captureSourceCompilationOptions(options);
  const highLevel = await compileHir(input, selected);
  return highLevel.status === "ok" ? compileOwnedCore(highLevel.hir, selected) : highLevel;
}

/** Candidate package route; Source and formal Core manifest admission remain independent. */
export async function compilePackage(packageBytes, roots, options) {
  const selected = captureSourceCompilationOptions(options);
  const highLevel = await compilePackageHir(packageBytes, roots, selected);
  if (highLevel.status !== "ok") return highLevel;
  // Only an instantiated owned-HIR result can enter concrete Core lowering.
  if (!("hir" in highLevel)) return { status: "tool-error", requestId: highLevel.requestId,
    code: "r03-d-consumer", message: "r03-package-result: instantiation returned no owned HIR" };
  return { ...highLevel, ...await produceBytecode(() => produceCore(highLevel.hir, selected, lowerGenericHir)) };
}

async function compileSnapshot(snapshot, options) {
  const highLevel = buildHir(snapshot);
  if (highLevel.status !== "ok") return /** @type {typeof highLevel & {bytecode?:undefined}} */ (highLevel);
  return produceBytecode(() => produceCore(highLevel.hir, options));
}

const coreModulePrefix='"builtin.module"() ({\n';

/** Read a unique identity owned by the operation's final dictionary.
 * @param {string} closing @param {string} identityField */
function checkedCoreIdentity(closing,identityField) {
  const suffix='} : () -> ()';
  if(!closing.startsWith('}) {')||!closing.endsWith(suffix))return;
  const fields=closing.slice(4,-suffix.length);
  const tokens=/(?:^|,)[ \t]*(?:"((?:[^"\\]|\\.)*)"|(tsfg_core\.(?:input_identity|function_id)))[ \t]*=[ \t]*|"(?:[^"\\]|\\.)*"|[{}\[\]]/gu;
  const digest=/"(sha256:[0-9a-f]{64})"/y;
  let depth=0,identity;
  for(const match of fields.matchAll(tokens)){
    const [token,quoted,bare]=match;
    // The scalar generic printer emits only bare names in the function's
    // own dictionary. Reject quoted keys, including escaped spellings.
    if(depth===0&&quoted!==undefined&&(identityField==='tsfg_core.function_id'||quoted===identityField))return;
    if(bare===identityField&&depth===0){
      const canonical=(match.index===0?'':', ')+identityField+' = ';
      digest.lastIndex=match.index+token.length;
      const value=digest.exec(fields),after=digest.lastIndex;
      if(identity!==undefined||token!==canonical||!value||(after!==fields.length&&!fields.startsWith(', ',after)))return;
      identity=value[1];
    }else if(token==='['||token==='{')depth++;
    else if(token===']'||token==='}'){
      if(--depth<0)return;
    }
  }
  if(depth===0)return identity;
}

/** @param {string} core @param {string} inputIdentity @param {string} [stage] */
function requireCheckedCoreInput(core,inputIdentity,stage='r03-core-output') {
  const end=core.trimEnd().length,closing=core.lastIndexOf('\n',end-1)+1;
  if(!core.startsWith(coreModulePrefix)||!inputIdentity||
     checkedCoreIdentity(core.slice(closing,end),'tsfg_core.input_identity')!==inputIdentity)
    throw new TypeError(`${stage}: checked input identity differs`);
  return closing;
}

/** @param {string} core @param {number} moduleClose
 * @param {string} defaultRoot @param {readonly string[]} functionIds */
function requireCheckedGenericFunctions(core,moduleClose,defaultRoot,functionIds) {
  // A registered generic Core module consists of function definitions. The
  // printer closes each region before printing that function's own fields.
  const prefix='  "func.func"() <{',remaining=new Set(functionIds);
  const tokens=/"(?:[^"\\]|\\.)*"|[{}]/gu;
  let cursor=coreModulePrefix.length;
  const inventoryError='r03-core-output: generic function inventory differs from the checked HIR';
  while(cursor<moduleClose){
    const first=cursor===coreModulePrefix.length;
    const invalid=()=>new TypeError(first
      ?'r03-core-output: first generic function differs from the checked default root':inventoryError);
    const headerEnd=core.indexOf('\n',cursor);
    if(!core.startsWith(prefix,cursor)||headerEnd<0||!core.startsWith('}> ({',headerEnd-5))throw invalid();
    tokens.lastIndex=headerEnd+1;
    let depth=1,closing;
    for(let match; (match=tokens.exec(core))&&match.index<moduleClose;){
      if(match[0]==='{')depth++;
      else if(match[0]==='}'&&--depth===0){closing=match.index;break;}
    }
    if(closing===undefined||!core.startsWith('\n  }) {',closing-3))throw invalid();
    const end=core.indexOf('\n',closing);
    if(end<0||end>=moduleClose)throw invalid();
    const identity=checkedCoreIdentity(core.slice(closing,end),'tsfg_core.function_id');
    if(identity===undefined||(first&&identity!==defaultRoot)||!remaining.delete(identity))throw invalid();
    cursor=end+1;
  }
  if(cursor!==moduleClose||remaining.size)throw new TypeError(inventoryError);
}

async function produceCore(hir, options, lower = undefined, context = undefined) {
  const coreExecutable = options.core;
  const optimize = coreExecutable ? options.optimize : undefined;
  const executable = await verifiedConsumer(coreExecutable, "core");
  const factsContext = context ? context.factsContext : options.factsContext;
  const lowered = lower ? lower(hir) : lowerFormalHir(hir, factsContext, options.callPublicationContext);
  const inputIdentity = Object.getOwnPropertyDescriptor(hir, "inputIdentity")?.value;
  const commonContext = isCommonProgramContext(factsContext);
  const family = commonContext ? undefined : familyOf(hir);
  const common = commonContext || family === 'tsfg.program-hir-candidate';
  const generic = family === genericHirFormat.family;
  const ordinary = family === undefined || family === 'tsfg.module-callable-hir-candidate';
  const exception = family === 'tsfg.exception-hir-candidate';
  const nullable = family === nullableHirFormat.family;
  const closure = family === 'tsfg.closure-hir-candidate';
  const optional = family === optionalPropertyHirFormat.family;
  const reference = factsContext === undefined && family === referenceHirFormat.family;
  const coreInput = reference ? hir.context.factsDigest : inputIdentity;
  const packetInput = common || generic || ordinary ? inputIdentity : undefined;
  // Only scalar packets use the first function descriptor as the default.
  const scalar = !common && family === undefined && hir.modules === undefined;
  const packetDefaultRoot = generic ? hir.closure.roots[0] : scalar ? hir.functions[0].id : undefined;
  const prefix = common ? ['--common-program'] : [];
  const core = decodeCompilerText(consume(executable, [...prefix, optimize ? "--optimize" : "--canonicalize"], lowered),"r03-core-output");
  if(common||ordinary||generic||exception||nullable||closure||optional||reference){
    const moduleClose=requireCheckedCoreInput(core,coreInput);
    if(generic)requireCheckedGenericFunctions(core,moduleClose,packetDefaultRoot,hir.closure.functions);
  }
  return { hir, executable, prefix, common, core, packetInput, packetDefaultRoot };
}

async function produceBytecode(buildCore) {
  try {
    const { hir, executable, prefix, common, core, packetInput, packetDefaultRoot } = await buildCore();
    const bytecode = consume(executable, [...prefix, "--emit-bytecode"], core);
    if (common) verifyCommonProducedPacket(bytecode, packetInput);
    else verifyProducedPacket(bytecode, packetInput, packetDefaultRoot);
    return { status: "ok", hir, core, bytecode };
  } catch (error) {
    return { status: "tool-error", code: "r03-d-consumer", message: error.message };
  }
}

function produceOwnedCore(hir, options, selected = undefined) {
  let family;
  let finite = false;
  let string = false;
  try {
    family = familyOf(hir);
    const expected = family === undefined ? [typedArrayHirFormat,typedArrayHirV9Format,typedArrayHirV10Format,typedArrayHirV11Format] :
      family === optionalPropertyHirFormat.family ? [optionalPropertyHirFormat] : [];
    if (expected.length && hir && typeof hir === 'object') {
      // familyOf already checked the own format descriptor and its prototype.
      const format = Object.getOwnPropertyDescriptor(hir, 'format')?.value;
      finite = !!format && typeof format === 'object' && expected.some(candidate =>
        Object.getOwnPropertyDescriptor(format, 'contractVersion')?.value === candidate.contractVersion &&
        Object.getOwnPropertyDescriptor(format, 'schemaHash')?.value === candidate.schemaHash);
      if (!finite && family === undefined) {
        const data = (object, key) => object && typeof object === 'object' && !isProxy(object)
          ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
        const functions = data(hir, 'functions');
        const first = Array.isArray(functions) ? data(functions, '0') : undefined;
        string = data(data(first, 'returnType'), 'id') === stringHirType.id;
      }
    }
  } catch {
    // Keep malformed inputs on the existing formal validation path.
  }
  if (finite) {
    const core = options.core;
    if (!core) return produceCore(hir, { core });
    const fixedOptions = { core, optimize: options.optimize };
    const request = selected ?? options;
    const { factsContext } = request;
    const matchesContext = family === optionalPropertyHirFormat.family ? isOptionalPropertyContext : isTypedArrayContext;
    if (!matchesContext(factsContext))
      return produceCore(hir, fixedOptions,
        selected?.lower ?? (value => lowerFormalHir(value, factsContext, options.callPublicationContext)), { factsContext });
    const prepared = prepareFiniteCore(hir, factsContext, request.callPublicationContext);
    return produceCore(prepared.hir, fixedOptions, () => prepared.text);
  }
  if (string) {
    const core = options.core;
    if (!core) return produceCore(hir, { core });
    const fixedOptions = { core, optimize: options.optimize };
    const { factsContext, callPublicationContext } = selected ?? options;
    if (factsContext !== undefined && callPublicationContext === undefined &&
      !isCommonProgramContext(factsContext) && !isSelectedNullableContext(factsContext) &&
      !isTypedArrayContext(factsContext) && !isOptionalPropertyContext(factsContext)) {
      const prepared = prepareFormalStringCore(hir, factsContext);
      return produceCore(prepared.hir, fixedOptions, () => prepared.text);
    }
    return produceCore(hir, { ...fixedOptions, factsContext, callPublicationContext }, selected?.lower, { factsContext });
  }
  if (family === commonHirFormat.family) {
    const core = options.core;
    if (!core && selected?.callPublicationContext === undefined) return produceCore(hir, { core });
    const fixedOptions = { core, optimize: core ? options.optimize : undefined };
    const { factsContext, callPublicationContext } = selected ?? options;
    if (factsContext !== undefined && !isCommonProgramContext(factsContext)) {
      // Preserve the selected lowering's diagnostic for incompatible contexts.
      const lower = selected?.lower ?? lowerFormalHir;
      const text = lower(hir, factsContext, callPublicationContext);
      return produceCore(hir, fixedOptions, () => text, { factsContext });
    }
    const prepared = prepareCommonCore(hir, factsContext, callPublicationContext);
    return produceCore(prepared.hir, fixedOptions, () => prepared.text);
  }
  if (family !== genericHirFormat.family) return produceCore(hir, options, selected?.lower, selected);
  const { factsContext, callPublicationContext } = selected ?? options;
  if (factsContext !== undefined || callPublicationContext !== undefined)
    return produceCore(hir, options, selected?.lower ?? (value => lowerFormalHir(value, factsContext, callPublicationContext)), { factsContext });
  const prepared = prepareGenericCore(hir);
  const core = options.core;
  return produceCore(prepared.hir, { core, optimize: core ? options.optimize : undefined }, prepared.emit);
}

/** Produce verified Core text from complete persisted owned HIR. */
export async function compileOwnedCore(hir, options) {
  try {
    const { factsContext, callPublicationContext } = options;
    const lower = isSelectedNullableContext(factsContext) ? lowerHir : lowerFormalHir;
    const result = await produceOwnedCore(hir, options, {
      factsContext, callPublicationContext, lower: value => lower(value, factsContext, callPublicationContext),
    });
    return { status: "ok", hir: result.hir, core: result.core };
  } catch (error) {
    const result = { status: "tool-error", code: "r03-d-consumer", message: error.message };
    return error instanceof Error && "callChain" in error ? { ...result, callChain: error.callChain } : result;
  }
}

/** Compile a complete persisted owned HIR through the same formal producer.
 * Facts and fixed publication context are verified by lowering; Source admission is independent.
 */
export async function compileOwnedHir(hir, options) {
  return produceBytecode(() => produceOwnedCore(hir, options));
}

/** Produce one whole statically linked program object from complete owned HIR.
 * Existing Source admission is independent; no frontend lock is relaxed here.
 */
export async function compileOwnedStaticProgram(hir, options) {
  let nativeCore;
  const result = await produceBytecode(() => {
    const { core, optimize, factsContext, callPublicationContext } = options;
    nativeCore = options.nativeCore ?? core;
    return produceOwnedCore(hir, { core, optimize, factsContext, callPublicationContext });
  });
  if (result.status !== "ok") return result;
  try {
    const inputIdentity = readCoreInputIdentity(result.core);
    if (inputIdentity === undefined)
      throw new TypeError("r03-tool-aot: missing unique Core input identity");
    verifyAotPacketInput(result.bytecode, inputIdentity);
    const executable = await verifiedConsumer(nativeCore, "core-native");
    const object = consume(executable, ["--emit-program-object"], result.core);
    // The generated metadata and instance use exactly this original packet;
    // neither a projection nor a re-signed surrogate program enters the link.
    const compiledIdentity = verifyAotProducedObject(object, result.bytecode, inputIdentity);
    return { ...result, object, compiledIdentity };
  } catch (error) {
    return { status: "tool-error", code: "r03-d-consumer", message: error.message };
  }
}

/** Official source checking uses its existing exact producer admission. */
export async function compileStaticProgram(input, options) {
  const selected = { ...captureSourceCompilationOptions(options), nativeCore: options.nativeCore };
  const highLevel = await compileHir(input, selected);
  return highLevel.status === "ok" ? compileOwnedStaticProgram(highLevel.hir, selected) : highLevel;
}

// Pin the actual static module/data closure, including declaration profiles.
// compiler-session-inputs.test.mjs checks this explicit table independently.
const sessionInputs = ["compiler/core-ssa-graph.mjs", "compiler/scalar-operators.mjs", "compiler/conversions.mjs", "compiler/presence.mjs", "compiler/scalar-hir-body.mjs", "compiler/scalar-hir-module.mjs", "compiler/scalar-hir-expression.mjs", "compiler/scalar-hir-state.mjs", "compiler/scalar-source.mjs", "compiler/scalar-state-emitter.mjs", "compiler/minimal-conversions-v5.d.ts", "contracts/conversion-entries.json", "compiler/generic-package-frontend.mjs", "compiler/generic-package.mjs", "compiler/generic-package-shape.mjs",
  "compiler/generic-package-io.mjs", "compiler/generic-package-io-shape.mjs", "compiler/generic-instance.mjs",
  "compiler/generic-hir.mjs", "compiler/generic-json.mjs", "compiler/generic-json-budget.mjs", "compiler/frontend.mjs", "compiler/frontend-response.mjs", "compiler/frontend-execution.mjs", "compiler/hir.mjs", "compiler/identity.mjs", "compiler/scalar-core-emitter.mjs",
  "compiler/module-facts.mjs", "compiler/module-hir-source.mjs", "compiler/module-hir.mjs", "compiler/modules.mjs",
  "compiler/pipeline.mjs", "compiler/producer-packet.mjs", "compiler/core-ssa-emitter.mjs", "compiler/string-formal-emitter.mjs", "compiler/float.mjs", "contracts/registry.json", "contracts/hir.schema.json", "contracts/bytecode.schema.json",
  "compiler/array-analysis-types.mjs", "compiler/array-call-context.mjs", "compiler/array-call-graph.mjs", "compiler/array-call-model.mjs",
  "compiler/array-call-publication.mjs", "compiler/array-owner-trace.mjs", "compiler/array-parallel.mjs", "compiler/array-readspan-model.mjs",
  "compiler/array-span-contexts.mjs", "compiler/array-span-planes.mjs", "compiler/array-span-storage.mjs", "compiler/call-effects.mjs",
  "compiler/callable-target-domain.mjs", "compiler/closure-call-effects.mjs", "compiler/closure-common.mjs", "compiler/closure-core-emitter.mjs",
  "compiler/closure-core-initialization.mjs", "compiler/closure-core-model.mjs", "compiler/closure-environment-lowering.mjs", "compiler/closure-environments.mjs",
  "compiler/closure-facts.mjs", "compiler/closure-frontend.mjs", "compiler/closure-hir.mjs", "compiler/closure-source-grammar.mjs",
  "compiler/closure-target-domain.mjs", "compiler/closure-target-solver.mjs", "compiler/closure-targets.mjs", "compiler/common-program-abstract.mjs",
  "compiler/common-program-actual-context.mjs", "compiler/common-program-actual.mjs", "compiler/common-program-analysis.mjs", "compiler/common-program-body.mjs",
  "compiler/common-program-borrow-events.mjs", "compiler/common-program-borrow-observations.mjs", "compiler/common-program-borrow-proof.mjs", "compiler/common-program-borrows.mjs",
  "compiler/common-program-budget.mjs", "compiler/common-program-carriers.mjs", "compiler/common-program-common.mjs", "compiler/common-program-construction-plans.mjs",
  "compiler/common-program-constructor-return-origins.mjs", "compiler/common-program-control.mjs", "compiler/common-program-core.mjs", "compiler/common-program-declarations.mjs",
  "compiler/common-program-diagnostics.mjs", "compiler/common-program-effects.mjs", "compiler/common-program-entry.mjs", "compiler/common-program-environments.mjs",
  "compiler/common-program-facts.mjs", "compiler/common-program-fixed-storage.mjs", "compiler/common-program-hir.mjs", "compiler/common-program-hosts.mjs",
  "compiler/common-program-identities.mjs", "compiler/common-program-implicit-construction-plans.mjs", "compiler/common-program-internal-constructions.mjs", "compiler/common-program-lexical.mjs",
  "compiler/common-program-methods.mjs", "compiler/common-program-native-language.mjs", "compiler/common-program-observation-contexts.mjs", "compiler/common-program-packet.mjs",
  "compiler/common-program-physical.mjs", "compiler/common-program-plan.mjs", "compiler/common-program-print.mjs", "compiler/common-program-publication-scope.mjs",
  "compiler/common-program-receiver-actual.mjs", "compiler/common-program-regions.mjs", "compiler/common-program-return-origin-domain.mjs", "compiler/common-program-return-origin-graph.mjs",
  "compiler/common-program-return-origin-inclusion.mjs", "compiler/common-program-return-origin-receivers.mjs", "compiler/common-program-return-origin-scope.mjs", "compiler/common-program-return-origin-source.mjs",
  "compiler/common-program-return-origins.mjs", "compiler/common-program-source.mjs", "compiler/common-program-targets.mjs", "compiler/common-program-values.mjs",
  "compiler/exception-aggregate-expressions.mjs", "compiler/exception-aggregate-facts.mjs", "compiler/exception-aggregate-input.mjs", "compiler/exception-callable.mjs",
  "compiler/exception-closures.mjs", "compiler/exception-common.mjs", "compiler/exception-core-common.mjs", "compiler/exception-expressions.mjs",
  "compiler/exception-facts.mjs", "compiler/exception-frontend.mjs", "compiler/exception-function-values.mjs", "compiler/exception-hir-aggregates.mjs",
  "compiler/exception-hir-common.mjs", "compiler/exception-hir-functions.mjs", "compiler/exception-hir-identity.mjs", "compiler/exception-hir-model.mjs",
  "compiler/exception-hir-modules.mjs", "compiler/exception-hir-regions.mjs", "compiler/exception-hir.mjs", "compiler/exception-identifiers.mjs",
  "compiler/exception-input.mjs", "compiler/exception-module-expressions.mjs", "compiler/exception-module-facts.mjs", "compiler/exception-module-input.mjs",
  "compiler/exception-presence.mjs", "compiler/exception-scope.mjs", "compiler/exception-source-grammar.mjs", "compiler/exception-statements.mjs",
  "compiler/exception-types.mjs", "compiler/finite-actual-domains.mjs", "compiler/finite-array-call-contexts.mjs", "compiler/finite-array-reaching.mjs",
  "compiler/finite-callables.mjs", "compiler/finite-core-emitter.mjs", "compiler/finite-field-effects.mjs", "compiler/finite-field-phases.mjs",
  "compiler/finite-field-reaching.mjs", "compiler/finite-field-return-graphs.mjs", "compiler/finite-numeric-use.mjs", "compiler/finite-presence.mjs",
  "compiler/formal-closure-core.mjs", "compiler/formal-exception-control.mjs", "compiler/formal-exception-core.mjs", "compiler/formal-exception-model.mjs",
  "compiler/formal-exception-values.mjs", "compiler/hir-wire.mjs", "compiler/kernel-access.mjs", "compiler/kernel-core-emitter.mjs",
  "compiler/lexical-environment-layouts.mjs", "compiler/member-presence.mjs", "compiler/minimal-bool-v1.d.ts", "compiler/minimal-floats-v4.d.ts",
  "compiler/minimal-integers-v3.d.ts", "compiler/minimal-scalars-v2.d.ts", "compiler/mlir-strings.mjs", "compiler/module-callable-common.mjs",
  "compiler/module-callable-core.mjs", "compiler/module-callable-facts.mjs", "compiler/module-callable-hir.mjs", "compiler/module-callable-model.mjs",
  "compiler/module-callable-publication.mjs", "compiler/module-callable-source.mjs", "compiler/module-callable-targets.mjs", "compiler/nullable-common.mjs",
  "compiler/nullable-core-emitter.mjs", "compiler/nullable-facts.mjs", "compiler/nullable-frontend.mjs", "compiler/nullable-hir.mjs",
  "compiler/nullable-typeof.mjs", "compiler/optional-property-hir.mjs", "compiler/optional-property-profile.mjs", "compiler/reference-callable.mjs",
  "compiler/reference-common.mjs", "compiler/reference-core-emitter.mjs", "compiler/reference-core-model.mjs", "compiler/reference-facts-body.mjs",
  "compiler/reference-facts-shape.mjs", "compiler/reference-facts.mjs", "compiler/reference-forwarding.mjs", "compiler/reference-hierarchy.mjs",
  "compiler/reference-hir.mjs", "compiler/reference-methods.mjs", "compiler/reference-provenance.mjs", "compiler/reference-relations.mjs",
  "compiler/reference-scalar-policy.mjs", "compiler/reference-types.mjs", "compiler/string-core-emitter.mjs", "compiler/string-facts-model.mjs",
  "compiler/string-facts-v2-model.mjs", "compiler/string-facts-v2.mjs", "compiler/string-facts.mjs", "compiler/string-hir-model.mjs",
  "compiler/string-hir.mjs", "compiler/system-query-core.mjs", "compiler/system-query-effects.mjs", "compiler/system-query-expressions.mjs",
  "compiler/system-query-facts.mjs", "compiler/system-query-scalars.mjs", "compiler/system-query-source-bindings.mjs", "compiler/system-query-statements.mjs",
  "compiler/system-query-tmeta.mjs", "compiler/typed-array-body.mjs", "compiler/typed-array-construction.mjs", "compiler/typed-array-density.mjs",
  "compiler/typed-array-facts.mjs", "compiler/typed-array-hir.mjs", "compiler/typed-array-literals.mjs", "compiler/typed-array-project.mjs",
  "compiler/typed-array-relations.mjs", "compiler/typed-array-representation.mjs", "compiler/typed-array-schema.mjs", "compiler/typed-array-type-graphs.mjs",
  "compiler/typed-array-types.mjs", "compiler/typed-array-witnesses.mjs", "compiler/typed-layouts.mjs", "compiler/typed-reference-authority.mjs",
  "compiler/typed-reference-views.mjs", "contracts/array-calls-candidate.schema.json", "contracts/array-generic-facts-v10.schema.json",
  "contracts/array-generic-facts-v11.schema.json", "contracts/array-generic-facts-v9.schema.json", "contracts/array-generic-facts.schema.json",
  "contracts/common-program-bytecode-development.schema.json",
  "contracts/common-program-core-development.json", "contracts/common-program-hir-v2.schema.json", "contracts/common-program-hir-v3.schema.json", "contracts/common-program-source-v2.schema.json",
  "contracts/common-program-source-v3.schema.json", "contracts/common-program-wire-development.json", "contracts/component-layout-development.json", "contracts/core-closure-candidate.schema.json",
  "contracts/core-closure-publication-candidate.schema.json", "contracts/core-kernel-global-candidate.schema.json", "contracts/core-nullable-candidate.schema.json", "contracts/core-reference-candidate.schema.json",
  "contracts/core-string-candidate.schema.json", "contracts/exception-hir-v2.schema.json", "contracts/exception-owned-bridge-candidate.schema.json", "contracts/finite-core-development.json",
  "contracts/formal-closure-core-development.json", "contracts/formal-exception-core-development.json", "contracts/host-counter-semantic-v1.json", "contracts/module-callable-candidate.schema.json",
  "contracts/nullable-groups-candidate.schema.json", "contracts/nullable-owned-bridge-candidate.schema.json", "contracts/nullable-presence-capture-candidate.schema.json", "contracts/nullable-presence-hir-candidate.schema.json",
  "contracts/nullable-typeof-undefined-candidate.schema.json", "contracts/optional-property-facts-v1.schema.json", "contracts/optional-property-hir.schema.json", "contracts/query-tmeta-development.json",
  "contracts/string-facts-candidate.schema.json", "contracts/string-facts-v2-candidate.schema.json", "contracts/system-query-facts.schema.json",
  "contracts/typed-array-hir-v10.schema.json", "contracts/typed-array-hir-v11.schema.json",
  "contracts/typed-array-hir-v9.schema.json", "contracts/typed-array-hir.schema.json",
  "eng/core-ir-inputs.mjs", "eng/frontend-source.lock.json", "eng/host-counter-binary.mjs", "eng/host-counter-objects.mjs",
  "eng/host-counter.mjs", "eng/host-semantic-contract.mjs", "eng/output-storage.mjs", "eng/runtime-entry.mjs",
  "eng/vm-build.mjs"
];
async function sessionFingerprint() {
  const inputs = await Promise.all(sessionInputs.map(async name => [name, sha256(await readFile(path.join(productRoot, name)))]));
  return sha256(canonical(inputs));
}

/** Incremental owned lowering; official frontend checking still runs on every input. */
export function createCompilerSession(options) {
  const settings = { frontend: options.frontend, core: options.core, optimize: options.optimize === true };
  let inputs, previous;
  const counts = { analyses: 0, lowerings: 0, reuses: 0 };
  return {
    statistics: () => ({ ...counts }),
    async compile(input) {
      counts.analyses++;
      const analyzed = await analyzeFrontend(input, { executable: settings.frontend });
      if (analyzed.status !== "ok") { previous = undefined; return analyzed; }
      try {
        const fingerprint = await sessionFingerprint();
        if (inputs !== undefined && inputs !== fingerprint)
          throw new TypeError("r03-compiler-input: compiler inputs changed during session");
        inputs = fingerprint;
        const core = await verifiedConsumer(settings.core, "core");
        const key = sha256(canonical({ snapshotId: analyzed.snapshot.snapshotId,
          compiler: fingerprint, producer: sha256(await readFile(core)) }));
        if (previous?.key === key) {
          counts.reuses++;
          return { ...previous.result, bytecode: Buffer.from(previous.result.bytecode) };
        }
        counts.lowerings++;
        const result = await compileSnapshot(analyzed.snapshot, settings);
        previous = result.status === "ok" ? { key, result: { ...result, bytecode: Buffer.from(result.bytecode) } } : undefined;
        return result;
      } catch (error) {
        previous = undefined;
        return { status: "tool-error", code: "r03-d-consumer", message: error.message };
      }
    },
  };
}

/** Decode JSON stdout from an admitted Runtime or static program. Binary roundtrip returns the original bytes. @param {Buffer} bytes @param {string} [command] */
export function readRuntimeOutput(bytes, command) {
  if (command === "--roundtrip") return bytes;
  let json;
  try {
    json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new TypeError("r03-tool-runtime: invalid UTF-8 in Runtime output");
  }
  return JSON.parse(json);
}

const requestTypedArraySlots = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(Uint8Array.prototype));
const requestDataViewSlots = Object.getOwnPropertyDescriptors(DataView.prototype);

/** Read the view's actual range without consulting caller properties. @param {NodeJS.ArrayBufferView} bytes */
function requestByteView(bytes) {
  const slots = isDataView(bytes) ? requestDataViewSlots : requestTypedArraySlots;
  return new Uint8Array(slots.buffer.get.call(bytes), slots.byteOffset.get.call(bytes), slots.byteLength.get.call(bytes));
}

/**
 * @param {NodeJS.ArrayBufferView | string} bytes
 * @param {{vm?: string, requests?: unknown, requestJson?: string, command?: string}} options
 */
export async function runBytecode(bytes, { vm, requests = [{}], requestJson, command = "--requests" }) {
  // Own the selected input range before asynchronous admission. Typed views
  // carry bytes, regardless of their element width.
  const input = typeof bytes === "string" ? bytes : Buffer.from(requestByteView(bytes));
  const args = command === "--requests" || command === "--module-requests"
    ? [command, requestJson ?? JSON.stringify(requests)] : [command];
  const executable = await verifiedConsumer(vm, "vm");
  return readRuntimeOutput(consume(executable, args, input), command);
}

/** The executable is a source-built static program, never a request loader. */
export async function runStaticProgram({ executable, requests = [{}], persistent = false }) {
  const args = [persistent ? "--module-requests" : "--requests", JSON.stringify(requests)];
  const admitted = await verifiedConsumer(executable, "aot");
  return readRuntimeOutput(consume(admitted, args, undefined));
}

/** Evaluate a serial batch against one persistent module instance. */
export function runModuleRequests(bytes, {vm,requests=[{}]}) {
  return runBytecode(bytes,{vm,requests,command:"--module-requests"});
}

/** Run a serial batch of framed bytecode requests on one Runtime host. */
export async function runRequestSequence(bytecodes, { vm, requests = undefined }) {
  const moduleCount = Array.isArray(bytecodes) ? bytecodes.length : 0;
  if (moduleCount < 1 || moduleCount > 128)
    throw new TypeError("r05-request-sequence: expected 1..128 matching modules and requests");
  const requestFrames = requests === undefined ? Array.from({ length: moduleCount }, () => ({})) : requests;
  if (!Array.isArray(requestFrames) || requestFrames.length !== moduleCount)
    throw new TypeError("r05-request-sequence: expected 1..128 matching modules and requests");
  const views = [];
  let totalBytes = 12;
  for (let index = 0; index < moduleCount; index++) {
    const bytes = bytecodes[index];
    if (!Buffer.isBuffer(bytes)) throw new TypeError("r05-request-sequence: expected bytecode buffers");
    const view = requestByteView(bytes);
    totalBytes += 4 + view.byteLength;
    if (totalBytes > 1048576) throw new TypeError("r05-request-sequence: frame exceeds size limit");
    views.push(view);
  }
  const header = Buffer.alloc(12);
  header.write("TSFGREQ1", "ascii");
  header.writeUInt32LE(moduleCount, 8);
  const frames = views.flatMap(view => {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(view.byteLength);
    return [length, view];
  });
  const input = Buffer.concat([header, ...frames]);
  const args = ["--request-sequence", JSON.stringify(requestFrames)];
  const executable = await verifiedConsumer(vm, "vm");
  return readRuntimeOutput(consume(executable, args, input));
}

export async function sourceInput(source, { sourcePath = "/src/main.ts", declarationVersion = "minimal-conversions-v5" } = {}) {
  if (!["minimal-integers-v3", "minimal-floats-v4", "minimal-conversions-v5"].includes(declarationVersion)) throw new TypeError("unsupported source declaration version");
  const declarations = await readFile(new URL(`./${declarationVersion}.d.ts`, import.meta.url), "utf8");
  return { sourceRoot: "/src", rootFile: sourcePath,
    files: [{ path: sourcePath, content: source }, { path: `/src/${declarationVersion}.d.ts`, content: declarations }],
    declarations: { version: declarationVersion, paths: [`/src/${declarationVersion}.d.ts`] },
    target: { ...bytecodeSchema.target, pointerBits: "64" },
    config: { strict: true, noEmit: true, allowJs: false } };
}

export async function compileAndRun(source, options) {
  const compiled = await compileProgram(await sourceInput(source, options), options);
  if (compiled.status !== "ok") return compiled;
  try { return { ...compiled, requests: await runBytecode(compiled.bytecode, options) }; }
  catch (error) { return { status: "tool-error", code: "r03-d-runtime", message: error.message }; }
}
