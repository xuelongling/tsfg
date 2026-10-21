// SPDX-License-Identifier: MIT
import { readFile } from "node:fs/promises";
import { compileHir, compileProgram, compileOwnedHir, compileOwnedStaticProgram, compileStaticProgram, runBytecode } from "../compiler/pipeline.mjs";
import { printHir, readHir } from "../compiler/hir.mjs";

try {
  const options = new Map();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input", "--input-kind", "--frontend", "--core", "--vm", "--emit", "--requests"].includes(args[i])
        || options.has(args[i]) || !args[i + 1]) throw new TypeError("r03-cli-options: invalid or duplicate option");
    options.set(args[i], args[i + 1]);
  }
  const emit = options.get("--emit") ?? "run";
  const inputKind = options.get("--input-kind") ?? "source";
  if (!["source", "hir"].includes(inputKind) || !["hir", "core", "bytecode", "program-object", "run"].includes(emit) || !options.has("--input"))
    throw new TypeError("r03-cli-options: --input and --emit hir|core|bytecode|program-object|run are required");
  const bytes = await readFile(options.get("--input"));
  const input = inputKind === "hir" ? readHir(bytes) : JSON.parse(bytes.toString("utf8"));
  const requests = emit === "run" ? JSON.parse(options.get("--requests") ?? "[{}]") : undefined;
  const compile = inputKind === "hir" ? (emit === "program-object" ? compileOwnedStaticProgram : compileOwnedHir)
    : emit === "hir" ? compileHir : emit === "program-object" ? compileStaticProgram : compileProgram;
  const result = inputKind === "hir" && emit === "hir" ? { status: "ok", hir: input }
    : await compile(input, { frontend: options.get("--frontend"), core: options.get("--core") });
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
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
