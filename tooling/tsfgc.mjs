// SPDX-License-Identifier: MIT
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { compileHir, compileProgram, compileSourceCore, compileOwnedCore, compileOwnedHir, compileOwnedStaticProgram, compileStaticProgram, compileSystemQuery, compileCommonBorrowProof, runBytecode } from "../compiler/pipeline.mjs";
import {readCommonProgramHir} from '../compiler/common-program-hir.mjs';
import {checkCommonJsonFileSize,commonHirFormat,commonJson} from '../compiler/common-program-common.mjs';
import {createCommonGpuBindingPlan} from '../compiler/common-program-gpu-bindings.mjs';
import { printHir, readHir } from "../compiler/hir.mjs";
import { checkHirWireFileSize } from '../compiler/hir-wire.mjs';
import { genericHirFormat } from '../compiler/generic-hir.mjs';
import { readGenericPackageFrontendResponse } from '../compiler/generic-package-frontend.mjs';
import { checkGenericPackageIoFileSize } from '../compiler/generic-package-io.mjs';
import { referenceHirFormat } from '../compiler/reference-hir.mjs';
import { familyOf } from '../compiler/module-callable-common.mjs';
import { checkSystemQueryFileSize, systemQueryRequestContext } from '../compiler/system-query-facts.mjs';
import { canonical } from '../compiler/identity.mjs';
import { compileTsSourceToR05Bytecode, runTsOnR05ZigVm } from '../compiler/r05-ts-driver.mjs';

/** @param {string} file @param {(size: bigint) => number} checkSize @param {'Query'|'HIR'|'Common'|'Generic package RPC'} kind */
async function readStableInputFile(file,checkSize,kind){
  const diagnostic={Query:'r10-system-query-input',HIR:'r03-hir-invalid',Common:'r03-common-program-input',
    'Generic package RPC':'generic-package-io-input'}[kind];
  const handle=await open(file,constants.O_RDONLY|(constants.O_NONBLOCK??0));
  try {
    const before=await handle.stat({bigint:true});
    if(!before.isFile())throw new TypeError(`${diagnostic}: regular ${kind} input file required`);
    const limit=checkSize(before.size),size=Number(before.size);
    // Read one extra byte when within the cap so growth cannot produce a valid prefix.
    const bytes=Buffer.allocUnsafe(Math.min(size+1,limit));
    let offset=0;
    while(offset<bytes.length){
      const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);
      if(bytesRead===0)break;
      offset+=bytesRead;
    }
    const after=await handle.stat({bigint:true});
    checkSize(after.size);
    if(offset!==size||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs)
      throw new TypeError(`${diagnostic}: ${kind} input changed while reading`);
    return bytes.subarray(0,size);
  } finally {
    await handle.close();
  }
}

/** @param {string} file */
const readCommonInputFile = file => readStableInputFile(file,checkCommonJsonFileSize,'Common');

try {
  const optionNames = ["--input", "--input-kind", "--frontend", "--core", "--vm", "--emit", "--requests", "--query-request", "--publication", "--kernel-request", "--gpu-request", "--package-response", "--ts", "--entry", "--args", "--fuel", "--unfused"];
  const options = new Map();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (!optionNames.includes(option) || options.has(option)) throw new TypeError("r03-cli-options: invalid or duplicate option");
    if (option === "--unfused") {
      options.set(option, "true");
      continue;
    }
    const value = args[++i];
    if (!value || optionNames.includes(value)) throw new TypeError(`r03-cli-options: ${option} requires a value`);
    options.set(option, value);
  }
  if (options.has("--ts")) {
    const tsPath = options.get("--ts");
    const emit = options.get("--emit") ?? "r05-run";
    const entry = options.get("--entry") ?? "main";
    if (emit !== "r05-run" && emit !== "r05-bytecode") {
      throw new TypeError("r05-cli-options: --ts requires --emit r05-run|r05-bytecode");
    }
    if (emit === "r05-bytecode") {
      const sourceText = await readFile(tsPath, "utf8");
      const compiled = compileTsSourceToR05Bytecode(sourceText, {
        filePath: tsPath,
        entry,
        frontend: options.get("--frontend"),
        core: options.get("--core"),
      });
      process.stdout.write(compiled.bytes);
    } else {
      const argList = options.has("--args") ? options.get("--args").split(",").filter(Boolean) : [];
      const { result } = await runTsOnR05ZigVm(tsPath, {
        isFile: true,
        entry,
        args: argList,
        unfused: options.has("--unfused"),
        fuel: options.has("--fuel") ? Number(options.get("--fuel")) : undefined,
        frontend: options.get("--frontend"),
        core: options.get("--core"),
        vm: options.get("--vm"),
      });
      process.stdout.write(JSON.stringify(result) + "\n");
    }
    process.exit(0);
  }
  const emit = options.get("--emit") ?? "run";
  const inputKind = options.get("--input-kind") ?? "source";
  const packageResponse = inputKind === "generic-package-response";
  const hasFixedCommon = options.has("--publication") || options.has("--kernel-request");
  const gpuBindingPlan = emit === "gpu-binding-plan";
  const borrowProof = emit === "borrow-proof";
  const fixedCommonCore = inputKind === "hir" && emit === "core" && hasFixedCommon;
  const emitModes = ["hir", "core", "bytecode", "program-object", "run", "query-effects", "query-batch", "query-llvm", "query-llvm-ir", "query-tmeta", "borrow-proof", "gpu-binding-plan"];
  if (packageResponse) emitModes.push("package");
  if (!emitModes.includes(emit))
    throw new TypeError("r03-cli-options: unsupported --emit (expected " + emitModes.join("|") + ")");
  if (options.has("--gpu-request") && !gpuBindingPlan)
    throw new TypeError("r03-cli-options: --gpu-request requires --emit gpu-binding-plan");
  if (options.has("--package-response") && !packageResponse)
    throw new TypeError("r03-cli-options: --package-response requires --input-kind generic-package-response");
  if (!["source", "hir", "generic-package-response"].includes(inputKind) || inputKind === "hir" && !gpuBindingPlan && !borrowProof &&
      (!["hir", "core", "bytecode", "program-object", "run"].includes(emit) ||
        ["--frontend", "--query-request"].some(key => options.has(key)) || hasFixedCommon && !fixedCommonCore))
    throw new TypeError("r03-cli-options: --input-kind source|hir|generic-package-response; HIR requires --emit hir|core|bytecode|program-object|run without Source, Query or borrow inputs");
  if (!options.has("--input"))
    throw new TypeError("r03-cli-options: --input <owned-input.json> is required (--emit defaults to run)");
  if (fixedCommonCore && (!options.has("--publication") || !options.has("--kernel-request") || !options.has("--core") ||
      ["--vm", "--requests"].some(key => options.has(key))))
    throw new TypeError("r03-cli-options: Common Core requires --publication, --kernel-request and --core without Runtime inputs");
  if (packageResponse) {
    if ((emit !== "hir" && emit !== "package") || !options.has("--package-response") || options.size !== 4)
      throw new TypeError("r03-cli-options: generic-package-response requires --input <request.json>, --package-response <response.json> and --emit hir|package");
    const request = await readStableInputFile(options.get("--input"), checkGenericPackageIoFileSize, "Generic package RPC");
    const response = await readStableInputFile(options.get("--package-response"), checkGenericPackageIoFileSize, "Generic package RPC");
    const restored = readGenericPackageFrontendResponse(request, response, { operation: emit === "package" ? "export" : "instantiate" });
    if (restored.status === "error") {
      process.stdout.write(canonical(restored) + "\n");
      process.exitCode = 3;
    } else if (emit === "package" && "packageBytes" in restored) {
      process.stdout.write(restored.packageBytes);
    } else if (emit === "hir" && "hir" in restored) {
      process.stdout.write(printHir(restored.hir));
    } else {
      throw new TypeError("generic-package-io-operation: checked response lacked the requested output");
    }
  } else if (gpuBindingPlan || borrowProof) {
    const hasCommonInputs = options.has("--publication") && options.has("--kernel-request") &&
      !["--frontend", "--vm", "--requests", "--query-request"].some(key => options.has(key));
    if (gpuBindingPlan && (!hasCommonInputs || inputKind !== "hir" || !options.has("--gpu-request") || options.has("--core")))
      throw new TypeError("r03-cli-options: gpu-binding-plan requires --input-kind hir, --publication, --kernel-request and --gpu-request");
    if (!gpuBindingPlan && (!hasCommonInputs || !options.has("--core")))
      throw new TypeError('r03-cli-options: borrow-proof requires complete Common HIR, fixed --publication, --kernel-request and --core');
    const hir=readCommonProgramHir(await readCommonInputFile(options.get('--input')));
    const publication=commonJson(await readCommonInputFile(options.get('--publication')));
    const request=commonJson(await readCommonInputFile(options.get('--kernel-request')));
    if (gpuBindingPlan) {
      const gpuRequest = commonJson(await readCommonInputFile(options.get("--gpu-request")));
      const plan = createCommonGpuBindingPlan(hir, publication, request, gpuRequest);
      process.stdout.write(canonical(plan) + "\n");
    } else {
      const result = await compileCommonBorrowProof(hir, publication, request, {core: options.get("--core")});
      process.stdout.write(canonical(result.proof) + "\n");
    }
  }else if(hasFixedCommon&&!fixedCommonCore)throw new TypeError('r03-cli-options: fixed Common publication/request require --emit borrow-proof, --emit gpu-binding-plan or --input-kind hir --emit core');
  else if(options.has('--query-request')){
    if(!['core','query-effects','query-batch','query-llvm','query-llvm-ir','query-tmeta'].includes(emit)||['--frontend','--vm','--requests'].some(key=>options.has(key)))
      throw new TypeError('r03-cli-options: owned Query request requires --emit core|query-effects|query-batch|query-llvm|query-llvm-ir|query-tmeta');
    const bytes=await readStableInputFile(options.get('--input'),checkSystemQueryFileSize,'Query');
    const requestBytes=await readStableInputFile(options.get('--query-request'),checkSystemQueryFileSize,'Query');
    const context=systemQueryRequestContext(bytes,requestBytes);
    const result=await compileSystemQuery(bytes,context,{core:options.get('--core'),effects:emit==='query-effects',cpuBatch:emit==='query-batch',cpuLLVM:emit==='query-llvm'?'dialect':emit==='query-llvm-ir'?'ir':undefined,tmeta:emit==='query-tmeta'});
    process.stdout.write(emit==='query-tmeta'?canonical(result.tmeta.envelope)+'\n':emit==='query-effects'?canonical(result.effects)+'\n':emit==='query-batch'?result.cpuBatch:emit==='query-llvm'||emit==='query-llvm-ir'?result.cpuLLVM:result.core);
  }else{
  if(['query-effects','query-batch','query-llvm','query-llvm-ir','query-tmeta'].includes(emit))throw new TypeError('r03-cli-options: Query output requires --query-request');
  const runtimeOption = ["--vm", "--requests"].find(option => options.has(option));
  if (emit !== "run" && runtimeOption)
    throw new TypeError(`r03-cli-options: ${runtimeOption} requires --emit run`);
  if (emit === "hir" && options.has("--core"))
    throw new TypeError("r03-cli-options: --core is invalid with --emit hir");
  const inputPath = options.get("--input");
  const input = inputKind === "hir" ? readHir(await (fixedCommonCore ? readCommonInputFile(inputPath)
    : readStableInputFile(inputPath, checkHirWireFileSize, 'HIR')))
    : JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(inputPath)));
  if (inputKind === "hir") {
    const family = familyOf(input);
    if (fixedCommonCore && family !== commonHirFormat.family)
      throw new TypeError("r03-cli-options: fixed publication and request require Common HIR");
    if (family === commonHirFormat.family && emit !== "hir" && !fixedCommonCore)
      throw new TypeError("r03-cli-options: Common HIR requires --emit hir or fixed publication and request for --emit core");
    if (family === genericHirFormat.family && ["run", "program-object"].includes(emit))
      throw new TypeError("r03-cli-options: private generic HIR requires --emit hir|core|bytecode");
    if (family === referenceHirFormat.family && !["hir", "core"].includes(emit))
      throw new TypeError("r03-cli-options: private Reference HIR requires --emit hir|core");
  }
  const callPublicationContext = fixedCommonCore ? {
    publication: commonJson(await readCommonInputFile(options.get("--publication"))),
    request: commonJson(await readCommonInputFile(options.get("--kernel-request"))),
  } : undefined;
  const requestJson = emit === "run" ? options.get("--requests") ?? "[{}]" : undefined;
  // Check syntax here and let Runtime read exact integer tokens and field names.
  if (requestJson !== undefined) JSON.parse(requestJson);
  const compile = inputKind === "hir"
    ? emit === "core" ? compileOwnedCore : emit === "program-object" ? compileOwnedStaticProgram : compileOwnedHir
    : emit === "hir" ? compileHir : emit === "core" ? compileSourceCore : emit === "program-object" ? compileStaticProgram : compileProgram;
  const result = inputKind === "hir" && emit === "hir" ? { status: "ok", hir: input }
    : await compile(input, { frontend: options.get("--frontend"), core: options.get("--core"), callPublicationContext });
  if (fixedCommonCore && result.status === "tool-error" && "callChain" in result) {
    process.stderr.write(`${result.message}; callChain=${canonical(result.callChain)}\n`);
    process.exitCode = 2;
  } else if (result.status !== "ok") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "tool-error" ? 11 : 3;
  } else if (emit === "hir") process.stdout.write(printHir(result.hir));
  else if (emit === "core") process.stdout.write(result.core);
  else if (emit === "bytecode") process.stdout.write(result.bytecode);
  else if (emit === "program-object") process.stdout.write(result.object);
  else {
    try {
      process.stdout.write(`${JSON.stringify(await runBytecode(result.bytecode, {
        vm: options.get("--vm"), requestJson }))}\n`);
    } catch (error) {
      // Preserve the formal VM's request-format diagnostics as CLI input errors.
      if (error.message.startsWith("r05-cli-")) throw error;
      process.stdout.write(`${JSON.stringify({ status: "tool-error", code: "r03-d-runtime", message: error.message })}\n`);
      process.exitCode = 11;
    }
  }
  }
} catch (error) {
  const chain=error instanceof Error&&'callChain' in error?'; callChain='+canonical(error.callChain):'';
  const primary=error instanceof Error&&'ruleId' in error&&error.ruleId==='r01-gpu'&&'primary' in error
    ?/** @type {import('../compiler/common-program-gpu-bindings.mjs').GpuSource|undefined} */(error.primary):undefined;
  const source=primary?` (${primary.sourceId}:${primary.start}:${primary.end})`:'';
  process.stderr.write(`${error.message}${source}${chain}\n`);
  process.exitCode = 2;
}
