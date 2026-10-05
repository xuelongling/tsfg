// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("formal Zig Runtime passes public loader, typed request and allocation cleanup checks", async () => {
  const executable = process.env.TSFG_ZIG_EXE;
  assert.match(executable, /^E:[\\/]/i, "TSFG_ZIG_EXE must identify the verified locked Zig tool");
  const temp = process.env.TSFG_MLIR_TEST_TEMP_ROOT;
  assert.match(temp, /^E:[\\/]/i);
  const root = await mkdtemp(path.join(temp, "r03-runtime-native-"));
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const args = ["test", "runtime/root-test.zig", "--zig-lib-dir", path.join(path.dirname(executable), "lib"),
    "--cache-dir", path.join(root, "zig-local"), "--global-cache-dir", path.join(root, "zig-global"),
    "-target", "x86_64-windows-msvc", "-mcpu", "x86_64_v2", "-ODebug"];
  const files = ["root", "bytecode", "vm", "runtime", "main", "contract", "fixture", "root-test"];
  const hash = async name => createHash("sha256").update(await readFile(name)).digest("hex");
  await writeFile(path.join(root, "ownership.json"), JSON.stringify({ owner: "r03-02-runtime-native", root }));
  await writeFile(path.join(root, "command.json"), JSON.stringify({ executable, sha256: await hash(executable),
    args, cwd, inputs: await Promise.all(files.map(async name => ({ path: `runtime/${name}.zig`,
      sha256: await hash(path.join(cwd, "runtime", `${name}.zig`)) }))) }));
  const result = spawnSync(executable, args, { cwd, windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 });
  await writeFile(path.join(root, "test.log"), Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]));
  await writeFile(path.join(root, "test.exit.json"), JSON.stringify({ status: result.status, signal: result.signal,
    error: result.error?.message }));
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.match(result.stderr.toString(), /All 10 tests passed/);
  // The final native PowerShell cleanup owns this explicitly recorded directory.
});
