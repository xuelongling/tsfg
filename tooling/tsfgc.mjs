// SPDX-License-Identifier: MIT
import { constants } from "node:fs";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
import { compileTsToWindowsAot, runTsOnWindowsAot } from '../compiler/tsfg-aot-driver.mjs';
import { buildTsfgProject, loadLocalPackage } from './r12-project-and-pkg.mjs';
import { inspectAbi, inspectTbcBytecode, inspectTmeta } from './debugger/r12-inspector-debugger.mjs';
import { startLspStdioServer } from './lsp/r12-tsfg-lsp.mjs';
import { startDapStdioServer } from './debugger/tsfg-dap.mjs';
import { R09CompilerService } from './compiler-service/r09-compiler-service.mjs';
import { contractSetId, WINDOWS_X64_TARGET } from '../compiler/r04-identity.mjs';

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
  const rawArgs = process.argv.slice(2);
  const subcmd = rawArgs[0];

  // Unified Developer Product Subcommands (preserves all legacy `--ts` / `--input` CLI flags!)
  if (subcmd === "version" || subcmd === "--version" || subcmd === "-v") {
    process.stdout.write(JSON.stringify({ name: "tsfgc", version: "1.0.0", target: WINDOWS_X64_TARGET.target, contractSetId: contractSetId() }) + "\n");
    process.exit(0);
  }
  if (subcmd === "help" || subcmd === "--help" || subcmd === "-h") {
    process.stdout.write(
      "Usage: tsfgc <command> [options]\n" +
      "  build <project-dir> [--out <dir>] [--clean] [--aot] [--mode exe|dll] [--profile debug|release]\n" +
      "  run <file.ts> [--entry <fn>] [--args a,b] [--fuel N] [--profile-trace <path>] [--breakpoint-pc N]\n" +
      "  aot <file.ts> [--entry <fn>] [--mode exe|dll] [--out <path>] [--profile debug|release] [--run] [--args a,b]\n" +
      "  inspect <artifact.tbc|.tmeta|.tsfgabi|.tpkg>\n" +
      "  lsp              Start JSON-RPC 2.0 tsfg-lsp over stdio\n" +
      "  dap              Start Debug Adapter Protocol tsfg-dap over stdio\n" +
      "  service          Start CompilerService hot-reload daemon\n" +
      "  version          Print toolchain version and contractSetId\n",
    );
    process.exit(0);
  }
  if (subcmd === "lsp") {
    startLspStdioServer();
    await new Promise(() => {});
  }
  if (subcmd === "dap") {
    startDapStdioServer();
    await new Promise(() => {});
  }
  if (subcmd === "service") {
    const svc = new R09CompilerService();
    process.stdout.write(JSON.stringify({ status: "ready", service: "tsfg-compiler-service", workRoot: svc.workRoot }) + "\n");
    process.exit(0);
  }
  if (subcmd === "inspect") {
    const file = rawArgs[1];
    if (!file) throw new TypeError("tsfgc inspect: artifact file path required");
    const bytes = await readFile(file);
    let info;
    if (file.endsWith(".tbc")) info = inspectTbcBytecode(bytes);
    else if (file.endsWith(".tmeta")) info = inspectTmeta(bytes);
    else if (file.endsWith(".tsfgabi")) info = inspectAbi(bytes);
    else if (file.endsWith(".tpkg")) {
      const pkg = loadLocalPackage(bytes);
      info = { name: pkg.name, version: pkg.version, abiHash: pkg.abiHash, exports: pkg.exports, digest: pkg.digest };
    } else {
      throw new TypeError(`tsfgc inspect: unsupported extension for '${file}'`);
    }
    process.stdout.write(JSON.stringify(info, null, 2) + "\n");
    process.exit(0);
  }
  if (subcmd === "build") {
    const projectDir = rawArgs[1] ?? ".";
    const opts = { clean: false, emitAot: false, profile: "release", aotMode: "exe" };
    for (let i = 2; i < rawArgs.length; i++) {
      if (rawArgs[i] === "--clean") opts.clean = true;
      else if (rawArgs[i] === "--aot") opts.emitAot = true;
      else if (rawArgs[i] === "--out") opts.outDir = rawArgs[++i];
      else if (rawArgs[i] === "--cache") opts.cacheDir = rawArgs[++i];
      else if (rawArgs[i] === "--profile") opts.profile = rawArgs[++i];
      else if (rawArgs[i] === "--mode") opts.aotMode = rawArgs[++i];
    }
    const built = await buildTsfgProject(path.resolve(projectDir), opts);
    process.stdout.write(JSON.stringify({
      status: "ok",
      buildKey: built.buildKey,
      cacheHit: built.cacheHit,
      outputDigest: built.outputDigest,
      usedRealTsPipeline: built.outputs.usedRealTsPipeline,
      paths: built.paths,
    }) + "\n");
    process.exit(0);
  }
  if (subcmd === "run") {
    const tsFile = rawArgs[1];
    if (!tsFile) throw new TypeError("tsfgc run: .ts file path required");
    const runOpts = { isFile: true, entry: "main", args: [] };
    for (let i = 2; i < rawArgs.length; i++) {
      if (rawArgs[i] === "--entry") runOpts.entry = rawArgs[++i];
      else if (rawArgs[i] === "--args") runOpts.args = rawArgs[++i].split(",").filter(Boolean);
      else if (rawArgs[i] === "--fuel") runOpts.fuel = Number(rawArgs[++i]);
      else if (rawArgs[i] === "--unfused") runOpts.unfused = true;
      else if (rawArgs[i] === "--profile-trace") runOpts.profileTrace = rawArgs[++i];
      else if (rawArgs[i] === "--breakpoint-pc") runOpts.breakpointPc = Number(rawArgs[++i]);
    }
    const { result } = await runTsOnR05ZigVm(path.resolve(tsFile), runOpts);
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(0);
  }
  if (subcmd === "aot") {
    const tsFile = rawArgs[1];
    if (!tsFile) throw new TypeError("tsfgc aot: .ts file path required");
    const aotOpts = { isFile: true, entry: "main", mode: "exe", profile: "release", args: [], run: false };
    for (let i = 2; i < rawArgs.length; i++) {
      if (rawArgs[i] === "--entry") aotOpts.entry = rawArgs[++i];
      else if (rawArgs[i] === "--mode") aotOpts.mode = rawArgs[++i];
      else if (rawArgs[i] === "--out") aotOpts.outPath = path.resolve(rawArgs[++i]);
      else if (rawArgs[i] === "--profile") aotOpts.profile = rawArgs[++i];
      else if (rawArgs[i] === "--args") aotOpts.args = rawArgs[++i].split(",").filter(Boolean);
      else if (rawArgs[i] === "--run") aotOpts.run = true;
    }
    if (aotOpts.run) {
      const { artifact, result } = await runTsOnWindowsAot(path.resolve(tsFile), aotOpts);
      process.stdout.write(JSON.stringify({ ...result, exePath: artifact.exePath, pdbPath: artifact.pdbPath }) + "\n");
    } else {
      const artifact = await compileTsToWindowsAot(path.resolve(tsFile), aotOpts);
      process.stdout.write(JSON.stringify({ status: "ok", mode: artifact.mode, profile: artifact.profile, outPath: artifact.outPath, pdbPath: artifact.pdbPath }) + "\n");
    }
    process.exit(0);
  }

  const optionNames = ["--input", "--input-kind", "--frontend", "--core", "--vm", "--emit", "--requests", "--query-request", "--publication", "--kernel-request", "--gpu-request", "--package-response", "--ts", "--entry", "--args", "--fuel", "--unfused", "--out", "--profile", "--optimize"];
  const options = new Map();
  const args = rawArgs;
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (!optionNames.includes(option) || options.has(option)) throw new TypeError("r03-cli-options: invalid or duplicate option");
    if (option === "--unfused" || option === "--optimize") {
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
    if (!["r05-run", "r05-bytecode", "aot-exe", "aot-dll", "aot-run"].includes(emit)) {
      throw new TypeError("r05-cli-options: --ts requires --emit r05-run|r05-bytecode|aot-exe|aot-dll|aot-run");
    }
    if (emit === "aot-exe" || emit === "aot-dll" || emit === "aot-run") {
      const argList = options.has("--args") ? options.get("--args").split(",").filter(Boolean) : [];
      const aotOpts = {
        isFile: true,
        entry,
        args: argList,
        mode: emit === "aot-dll" ? "dll" : "exe",
        profile: options.get("--profile") ?? "release",
        optimize: options.has("--optimize") ? true : undefined,
        outPath: options.has("--out") ? path.resolve(options.get("--out")) : undefined,
        frontend: options.get("--frontend"),
        core: options.get("--core"),
      };
      if (emit === "aot-run") {
        const { artifact, result } = await runTsOnWindowsAot(tsPath, aotOpts);
        process.stdout.write(JSON.stringify({ ...result, exePath: artifact.exePath, pdbPath: artifact.pdbPath }) + "\n");
      } else {
        const artifact = await compileTsToWindowsAot(tsPath, aotOpts);
        process.stdout.write(JSON.stringify({ status: "ok", outPath: artifact.outPath, pdbPath: artifact.pdbPath }) + "\n");
      }
    } else if (emit === "r05-bytecode") {
      const sourceText = await readFile(tsPath, "utf8");
      const compiled = compileTsSourceToR05Bytecode(sourceText, {
        filePath: tsPath,
        resolveImports: true,
        entry,
        optimize: options.has("--optimize"),
        frontend: options.get("--frontend"),
        core: options.get("--core"),
      });
      if (options.has("--out")) {
        await writeFile(options.get("--out"), compiled.bytes);
      } else {
        process.stdout.write(compiled.bytes);
      }
    } else {
      const argList = options.has("--args") ? options.get("--args").split(",").filter(Boolean) : [];
      const { result } = await runTsOnR05ZigVm(tsPath, {
        isFile: true,
        entry,
        args: argList,
        unfused: options.has("--unfused"),
        optimize: options.has("--optimize"),
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
