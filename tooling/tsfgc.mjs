// SPDX-License-Identifier: MIT
import { readFile } from "node:fs/promises";
import { compileHir, compileProgram, runBytecode } from "../compiler/pipeline.mjs";
import { printHir } from "../compiler/hir.mjs";

try {
  const options = new Map();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input", "--frontend", "--core", "--vm", "--emit", "--requests"].includes(args[i])
        || options.has(args[i]) || !args[i + 1]) throw new TypeError("r03-cli-options: invalid or duplicate option");
    options.set(args[i], args[i + 1]);
  }
  const emit = options.get("--emit") ?? "run";
  if (!["hir", "core", "bytecode", "run"].includes(emit) || !options.has("--input"))
    throw new TypeError("r03-cli-options: --input <owned-input.json> and --emit hir|core|bytecode|run are required");
  const input = JSON.parse(await readFile(options.get("--input"), "utf8"));
  const compile = emit === "hir" ? compileHir : compileProgram;
  const result = await compile(input, { frontend: options.get("--frontend"), core: options.get("--core") });
  if (result.status !== "ok") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "tool-error" ? 11 : 3;
  } else if (emit === "hir") process.stdout.write(printHir(result.hir));
  else if (emit === "core") process.stdout.write(result.core);
  else if (emit === "bytecode") process.stdout.write(result.bytecode);
  else process.stdout.write(`${JSON.stringify(await runBytecode(result.bytecode, {
    vm: options.get("--vm"), requests: JSON.parse(options.get("--requests") ?? "[{}]") }))}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
