// SPDX-License-Identifier: MIT
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { compileHir, compileProgram, compileOwnedCore, compileOwnedHir, compileOwnedStaticProgram, compileStaticProgram, compileSystemQuery, compileCommonBorrowProof, runBytecode } from "../compiler/pipeline.mjs";
import {readCommonProgramHir} from '../compiler/common-program-hir.mjs';
import {checkCommonJsonFileSize,commonHirFormat,commonJson} from '../compiler/common-program-common.mjs';
import { printHir, readHir } from "../compiler/hir.mjs";
import { checkHirWireFileSize } from '../compiler/hir-wire.mjs';
import { genericHirFormat } from '../compiler/generic-hir.mjs';
import { referenceHirFormat } from '../compiler/reference-hir.mjs';
import { familyOf } from '../compiler/module-callable-common.mjs';
import { checkSystemQueryFileSize, systemQueryRequestContext } from '../compiler/system-query-facts.mjs';
import {canonical} from '../compiler/identity.mjs';

/** @param {string} file @param {(size: bigint) => number} checkSize @param {'Query'|'HIR'|'Common'} kind */
async function readStableInputFile(file,checkSize,kind){
  const diagnostic={Query:'r10-system-query-input',HIR:'r03-hir-invalid',Common:'r03-common-program-input'}[kind];
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
  const optionNames = ["--input", "--input-kind", "--frontend", "--core", "--vm", "--emit", "--requests", "--query-request", "--publication", "--kernel-request"];
  const options = new Map();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const option = args[i], value = args[i + 1];
    if (!optionNames.includes(option) || options.has(option)) throw new TypeError("r03-cli-options: invalid or duplicate option");
    if (!value || optionNames.includes(value)) throw new TypeError(`r03-cli-options: ${option} requires a value`);
    options.set(option, value);
  }
  const emit = options.get("--emit") ?? "run";
  const inputKind = options.get("--input-kind") ?? "source";
  const hasFixedCommon = options.has("--publication") || options.has("--kernel-request");
  const fixedCommonCore = inputKind === "hir" && emit === "core" && hasFixedCommon;
  const emitModes = ["hir", "core", "bytecode", "program-object", "run", "query-effects", "query-batch", "query-llvm", "query-llvm-ir", "query-tmeta", "borrow-proof"];
  if (!emitModes.includes(emit))
    throw new TypeError("r03-cli-options: unsupported --emit (expected " + emitModes.join("|") + ")");
  if (!["source", "hir"].includes(inputKind) || inputKind === "hir" &&
      (!["hir", "core", "bytecode", "program-object", "run"].includes(emit) ||
        ["--frontend", "--query-request"].some(key => options.has(key)) || hasFixedCommon && !fixedCommonCore))
    throw new TypeError("r03-cli-options: --input-kind source|hir; HIR requires --emit hir|core|bytecode|program-object|run without Source, Query or borrow inputs");
  if (!options.has("--input"))
    throw new TypeError("r03-cli-options: --input <owned-input.json> is required (--emit defaults to run)");
  if (fixedCommonCore && (!options.has("--publication") || !options.has("--kernel-request") || !options.has("--core") ||
      ["--vm", "--requests"].some(key => options.has(key))))
    throw new TypeError("r03-cli-options: Common Core requires --publication, --kernel-request and --core without Runtime inputs");
  if(emit==='borrow-proof'){
    if(!options.has('--publication')||!options.has('--kernel-request')||!options.has('--core')||['--frontend','--vm','--requests','--query-request'].some(key=>options.has(key)))
      throw new TypeError('r03-cli-options: borrow-proof requires complete Common HIR, fixed --publication, --kernel-request and --core');
    const hir=readCommonProgramHir(await readCommonInputFile(options.get('--input')));
    const publication=commonJson(await readCommonInputFile(options.get('--publication')));
    const request=commonJson(await readCommonInputFile(options.get('--kernel-request')));
    const result=await compileCommonBorrowProof(hir,publication,request,{core:options.get('--core')});process.stdout.write(canonical(result.proof)+'\n');
  }else if(hasFixedCommon&&!fixedCommonCore)throw new TypeError('r03-cli-options: fixed Common publication/request require --emit borrow-proof or --input-kind hir --emit core');
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
    : emit === "hir" ? compileHir : emit === "program-object" ? compileStaticProgram : compileProgram;
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
  process.stderr.write(`${error.message}${chain}\n`);
  process.exitCode = 2;
}
