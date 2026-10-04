// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("Hermetic Build Entry refuses MLIR consumption without an explicit source checkout", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "mlir-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = path.join(root, "report.json");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_MLIR_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  }
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
    "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--out", path.join(root, "out"), "--report", report], { env, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.error.issues[0].code, "mlir-source-identity");
});

test("Hermetic Build Entry gates the real MLIR consumer on the newly required exact header approval", async t => {
  assert.ok(process.env.TSFG_MLIR_SOURCE, "actual source must be explicit");
  const root = await mkdtemp(path.join(tmpdir(), "mlir-legal-gate-"));
  const report = path.join(root, "report.json");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
    "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--out", path.join(root, "out"), "--report", report], { env, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.error.issues[0].code, "mlir-source-license");
  assert.match(result.error.issues[0].message, /llvm\/include\/llvm\/Support\/xxhash\.h/);
  // Keep this exact non-configured fixture for the validated cleanup phase.
});
