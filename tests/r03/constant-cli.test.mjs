// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("CLI checks source, prints owned HIR/Core and sends actual R04 to the formal VM", async () => {
  const { sourceInput } = await import("../../compiler/pipeline.mjs");
  const { readHir } = await import("../../compiler/hir.mjs");
  const temp = process.env.TSFG_MLIR_TEST_TEMP_ROOT;
  assert.match(temp, /^E:[\\/]/i);
  const root = await mkdtemp(path.join(temp, "r03-constant-cli-"));
  await writeFile(path.join(root, "ownership.json"), JSON.stringify({ owner: "r03-02-cli-test", root }));
  const input = path.join(root, "input.json");
  await writeFile(input, JSON.stringify(await sourceInput("export function answer(): i32 { return 42; }")));
  const cli = fileURLToPath(new URL("../../tooling/tsfgc.mjs", import.meta.url));
  const run = (emit, native = true) => spawnSync(process.execPath,
    [cli, "--input", input, "--frontend", process.env.TSFG_FRONTEND_EXE, "--emit", emit,
      ...(native ? ["--core", process.env.TSFG_CORE_IR_EXE, "--vm", process.env.TSFG_VM_EXE] : [])],
    { windowsHide: true });
  const hir = run("hir", false);
  assert.ifError(hir.error); assert.equal(hir.status, 0, hir.stdout.toString() + hir.stderr.toString());
  assert.equal(readHir(hir.stdout).functions[0].body[0].value.decimal, "42");
  const core = run("core");
  assert.equal(core.status, 0, core.stderr.toString()); assert.match(core.stdout.toString(), /tsfg_core.constant/);
  const bytecode = run("bytecode");
  assert.equal(bytecode.status, 0, bytecode.stderr.toString()); assert.equal(bytecode.stdout.subarray(0, 8).toString(), "TSFGTBC0");
  const result = run("run");
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(JSON.parse(result.stdout.toString())[0].result, { type: "i32", value: "42" });
  const data = JSON.parse(await readFile(input, "utf8"));
  data.files[0].content = "export function answer(): i32 { return missing; }";
  await writeFile(input, JSON.stringify(data));
  const rejected = run("hir", false);
  assert.equal(rejected.status, 3);
  assert.ok(JSON.parse(rejected.stdout.toString()).diagnostics.some(item => item.code === "r01-d-unresolved-name"));
  // Owned test directories are left for the final native PowerShell cleanup.
});
