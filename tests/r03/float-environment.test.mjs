// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileProgram, sourceInput } from "../../compiler/pipeline.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function filesUnder(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new TypeError("SDK input must be a regular file or directory");
    if (item.isDirectory()) files.push(...await filesUnder(file));
    else if (item.isFile()) files.push(file);
    else throw new TypeError("unsupported SDK entry");
  }
  return files;
}

test("source-produced float packets preserve actual caller FP state on success, trap and abort", async () => {
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const temp = process.env.TSFG_MLIR_TEST_TEMP_ROOT;
  const zig = process.env.TSFG_ZIG_EXE;
  assert.match(temp, /^E:[\\/]/i);
  assert.match(zig, /^E:[\\/]/i);
  const root = await mkdtemp(path.join(temp, "r03-float-environment-"));
  const tools = { frontend: process.env.TSFG_FRONTEND_EXE,
    core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE };
  const lib = path.join(path.dirname(zig), "lib");
  const inputPaths = [process.execPath, zig, ...Object.values(tools),
    ...[tools.core, tools.vm].map(file => path.join(path.dirname(file), "artifact-manifest.json")),
    path.join(path.dirname(tools.frontend), "intake-ledger.json"),
    ...["root", "bytecode", "vm", "runtime", "main", "contract"].map(name => path.join(repo, "runtime", `${name}.zig`)),
    ...["pipeline", "frontend", "hir", "identity", "float"].map(name => path.join(repo, "compiler", `${name}.mjs`)),
    ...["registry.json", "bytecode.schema.json", "hir.schema.json", "frontend-snapshot.schema.json"].map(name => path.join(repo, "contracts", name)),
    path.join(repo, "compiler/minimal-floats-v4.d.ts"), path.join(repo, "eng/frontend-source.lock.json"),
    path.join(repo, "eng/toolchains.lock.json"), import.meta.filename,
    path.join(repo, "tests/r03/fixtures/float-environment.zig"), ...await filesUnder(lib)];
  const inputs = [];
  for (const file of [...new Set(inputPaths)].sort()) {
    inputs.push({ path: file, sha256: digest(await readFile(file)) });
  }
  const record = { qualification: "actual native host probe; formal VMCLI is separately tested",
    root, node: process.execPath, zig, inputs, sdkRoot: lib, sources: [], packets: [],
    startedUtc: new Date().toISOString() };
  await writeFile(path.join(root, "before.json"), JSON.stringify(record, null, 2) + "\n");
  for (const type of ["f32", "f64"]) for (const kind of ["success", "trap"]) {
    const source = kind === "success"
      ? `function main(a:${type},b:${type}):${type}{return a+b;}`
      : `function main(a:${type},z:i32):${type}{const n:${type}=a+0.0;const v:i32=1/z;return n;}`;
    const actual = await compileProgram(await sourceInput(source), tools);
    assert.equal(actual.status, "ok", JSON.stringify(actual));
    const file = `${type}-${kind}.tbc`;
    await writeFile(path.join(root, file), actual.bytecode);
    record.sources.push({ file, source, sourceSha256: digest(source), hir: actual.hir, core: actual.core });
    record.packets.push({ path: file, sha256: digest(actual.bytecode) });
  }
  await writeFile(path.join(root, "probe.zig"), await readFile(path.join(repo, "tests/r03/fixtures/float-environment.zig")));
  const args = ["test", "--zig-lib-dir", lib, "--cache-dir", path.join(root, "local"),
    "--global-cache-dir", path.join(root, "global"), "-target", "x86_64-windows-msvc",
    "-mcpu", "x86_64_v2", "-ODebug", "--dep", "runtime", `-Mroot=${path.join(root, "probe.zig")}`,
    `-Mruntime=${path.join(repo, "runtime/root.zig")}`];
  record.command = { executable: zig, args, cwd: root };
  await writeFile(path.join(root, "command.json"), JSON.stringify(record, null, 2) + "\n");
  const result = spawnSync(zig, args, { cwd: root, windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(path.join(root, "probe.log"), Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]));
  const changed = [];
  for (const item of inputs) if (digest(await readFile(item.path)) !== item.sha256) changed.push(item.path);
  const after = { status: result.status, signal: result.signal, error: result.error?.message,
    changed, finishedUtc: new Date().toISOString(), observationCount: result.stderr?.toString().match(/full-x87-environment equal/g)?.length ?? 0 };
  await writeFile(path.join(root, "after.json"), JSON.stringify(after, null, 2) + "\n");
  console.log(`FP environment evidence ${root}`);
  assert.deepEqual(changed, []);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.match(result.stderr.toString(), /All 1 tests passed/);
  assert.equal(after.observationCount, 80);
});
