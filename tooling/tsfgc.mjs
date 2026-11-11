// SPDX-License-Identifier: MIT
import { readFile } from "node:fs/promises";
import { compileHir, compileProgram, compileOwnedCore, compileOwnedHir, compileOwnedStaticProgram, compileStaticProgram, compileSystemQuery, compileCommonBorrowProof, runBytecode } from "../compiler/pipeline.mjs";
import {readCommonProgramHir} from '../compiler/common-program-hir.mjs';
import {commonHirFormat,commonJson} from '../compiler/common-program-common.mjs';
import { printHir, readHir } from "../compiler/hir.mjs";
import { genericHirFormat } from '../compiler/generic-hir.mjs';
import { familyOf } from '../compiler/module-callable-common.mjs';
import { systemQueryFactsFormat } from '../compiler/system-query-facts.mjs';
import {canonical} from '../compiler/identity.mjs';

try {
  const options = new Map();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input", "--input-kind", "--frontend", "--core", "--vm", "--emit", "--requests", "--query-request", "--publication", "--kernel-request"].includes(args[i])
        || options.has(args[i]) || !args[i + 1]) throw new TypeError("r03-cli-options: invalid or duplicate option");
    options.set(args[i], args[i + 1]);
  }
  const emit = options.get("--emit") ?? "run";
  const inputKind = options.get("--input-kind") ?? "source";
  const hasFixedCommon = options.has("--publication") || options.has("--kernel-request");
  const fixedCommonCore = inputKind === "hir" && emit === "core" && hasFixedCommon;
  if (!["source", "hir"].includes(inputKind) || inputKind === "hir" &&
      (!["hir", "core", "bytecode", "program-object", "run"].includes(emit) ||
        ["--frontend", "--query-request"].some(key => options.has(key)) || hasFixedCommon && !fixedCommonCore))
    throw new TypeError("r03-cli-options: --input-kind source|hir; HIR requires --emit hir|core|bytecode|program-object|run without Source, Query or borrow inputs");
  if (!["hir", "core", "bytecode", "program-object", "run", "query-effects", "query-batch", "query-llvm", "query-llvm-ir", "query-tmeta", "borrow-proof"].includes(emit) || !options.has("--input"))
    throw new TypeError("r03-cli-options: --input <owned-input.json> and --emit hir|core|bytecode|program-object|run are required");
  if (fixedCommonCore && (!options.has("--publication") || !options.has("--kernel-request") || !options.has("--core") ||
      ["--vm", "--requests"].some(key => options.has(key))))
    throw new TypeError("r03-cli-options: Common Core requires --publication, --kernel-request and --core without Runtime inputs");
  if(emit==='borrow-proof'){
    if(!options.has('--publication')||!options.has('--kernel-request')||!options.has('--core')||['--frontend','--vm','--requests','--query-request'].some(key=>options.has(key)))
      throw new TypeError('r03-cli-options: borrow-proof requires complete Common HIR, fixed --publication, --kernel-request and --core');
    const hir=readCommonProgramHir(await readFile(options.get('--input'))),publication=commonJson(await readFile(options.get('--publication'))),request=commonJson(await readFile(options.get('--kernel-request')));
    const result=await compileCommonBorrowProof(hir,publication,request,{core:options.get('--core')});process.stdout.write(canonical(result.proof)+'\n');
  }else if(hasFixedCommon&&!fixedCommonCore)throw new TypeError('r03-cli-options: fixed Common publication/request require --emit borrow-proof or --input-kind hir --emit core');
  else if(options.has('--query-request')){
    if(!['core','query-effects','query-batch','query-llvm','query-llvm-ir','query-tmeta'].includes(emit)||['--frontend','--vm','--requests'].some(key=>options.has(key)))
      throw new TypeError('r03-cli-options: owned Query request requires --emit core|query-effects|query-batch|query-llvm|query-llvm-ir|query-tmeta');
    const bytes=await readFile(options.get('--input')),requestBytes=await readFile(options.get('--query-request'));
    const context={family:'tsfg.system-query-context-candidate',version:systemQueryFactsFormat.version,requestBytes,expectedPackageId:JSON.parse(bytes.toString('utf8')).packageId};
    const result=await compileSystemQuery(bytes,context,{core:options.get('--core'),effects:emit==='query-effects',cpuBatch:emit==='query-batch',cpuLLVM:emit==='query-llvm'?'dialect':emit==='query-llvm-ir'?'ir':undefined,tmeta:emit==='query-tmeta'});
    process.stdout.write(emit==='query-tmeta'?canonical(result.tmeta.envelope)+'\n':emit==='query-effects'?canonical(result.effects)+'\n':emit==='query-batch'?result.cpuBatch:emit==='query-llvm'||emit==='query-llvm-ir'?result.cpuLLVM:result.core);
  }else{
  if(['query-effects','query-batch','query-llvm','query-llvm-ir','query-tmeta'].includes(emit))throw new TypeError('r03-cli-options: Query output requires --query-request');
  const bytes = await readFile(options.get("--input"));
  const input = inputKind === "hir" ? readHir(bytes) : JSON.parse(bytes.toString("utf8"));
  if (inputKind === "hir") {
    const family = familyOf(input);
    if (fixedCommonCore && family !== commonHirFormat.family)
      throw new TypeError("r03-cli-options: fixed publication and request require Common HIR");
    if (family === commonHirFormat.family && emit !== "hir" && !fixedCommonCore)
      throw new TypeError("r03-cli-options: Common HIR requires --emit hir or fixed publication and request for --emit core");
    if (family === genericHirFormat.family && ["run", "program-object"].includes(emit))
      throw new TypeError("r03-cli-options: private generic HIR requires --emit hir|core|bytecode");
  }
  const callPublicationContext = fixedCommonCore ? {
    publication: commonJson(await readFile(options.get("--publication"))),
    request: commonJson(await readFile(options.get("--kernel-request"))),
  } : undefined;
  const requests = emit === "run" ? JSON.parse(options.get("--requests") ?? "[{}]") : undefined;
  const compile = inputKind === "hir"
    ? emit === "core" ? compileOwnedCore : emit === "program-object" ? compileOwnedStaticProgram : compileOwnedHir
    : emit === "hir" ? compileHir : emit === "program-object" ? compileStaticProgram : compileProgram;
  const result = inputKind === "hir" && emit === "hir" ? { status: "ok", hir: input }
    : await compile(input, { frontend: options.get("--frontend"), core: options.get("--core"), callPublicationContext });
  if (result.status !== "ok") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "tool-error" ? 11 : 3;
  } else if (emit === "hir") process.stdout.write(printHir(result.hir));
  else if (emit === "core") process.stdout.write(result.core);
  else if (emit === "bytecode") process.stdout.write(result.bytecode);
  else if (emit === "program-object") process.stdout.write(result.object);
  else {
    try {
      process.stdout.write(`${JSON.stringify(await runBytecode(result.bytecode, {
        vm: options.get("--vm"), requests }))}\n`);
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
