// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function createMlirFixture(prefix) {
  const requested = tmpdir();
  const owned = process.env.TSFG_MLIR_TEST_TEMP_ROOT;
  assert.ok(typeof owned === "string" && /^E:[\\/]/i.test(owned), "MLIR temporary storage requires an explicit owned E root");
  assert.match(requested, /^E:[\\/]/i, "MLIR temporary storage must be on E before any fixture creation");
  assert.equal(path.relative(path.resolve(owned), requested), "", "MLIR temporary storage must match the declared owned root");
  const state = await lstat(requested);
  assert.ok(state.isDirectory() && !state.isSymbolicLink(), "MLIR temporary storage must be an ordinary directory");
  assert.equal(path.relative(requested, await realpath(requested)), "", "MLIR temporary storage must not be redirected");
  return mkdtemp(path.join(requested, prefix));
}

test("Hermetic Build Entry refuses MLIR consumption without an explicit source checkout", async () => {
  const root = await createMlirFixture("mlir-input-");
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

test("MLIR test runner refuses redirected temporary storage before creating fixtures", async () => {
  // This red fixture is deliberately E-to-E: it never points at C or old roots.
  const root = await createMlirFixture("mlir-temp-boundary-");
  const target = path.join(root, "owned-target");
  const redirected = path.join(root, "redirected");
  await mkdir(target);
  await symlink(target, redirected, "junction");
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, TEMP: redirected, TMP: redirected, TMPDIR: redirected,
    TSFG_MLIR_TEST_TEMP_ROOT: redirected };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ["--test", "--test-name-pattern", "^Hermetic Build Entry",
    fileURLToPath(import.meta.url)], { encoding: "utf8", windowsHide: true, env });
  assert.ifError(child.error);
  await writeFile(path.join(root, "runner-result.json"), JSON.stringify({ status: child.status,
    stdout: child.stdout, stderr: child.stderr }));
  assert.match(child.stdout, /Hermetic Build Entry/);
  assert.deepEqual(await readdir(target), [], "refusal must leave the destination untouched");
  assert.notEqual(child.status, 0, "redirected fixture storage must be rejected before mkdtemp");
  assert.match(child.stdout + child.stderr, /temporary storage.*ordinary|temporary storage.*redirected/);
});

test("Hermetic Build Entry reports an invalid Python input with its integrity identity", async () => {
  const root = await createMlirFixture("mlir-python-report-");
  const report = path.join(root, "report.json");
  const env = { ...process.env, TSFG_MLIR_PYTHON_TOOL_ROOT: path.join(root, "missing-python") };
  for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
    "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--out", path.join(root, "missing-parent", "out"), "--report", report], { env, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.error.issues[0].code, "mlir-python-integrity");
  assert.equal(child.status, 11);
  assert.equal(result.error.category, "lock/integrity");
  assert.deepEqual(await readdir(root), ["report.json"], "read-only input refusal must not create output parents");
});

test("Hermetic Build Entry rejects a redirected output ancestor before creating a missing parent", async () => {
  const root = await createMlirFixture("mlir-output-boundary-");
  const target = path.join(root, "owned-target");
  const redirected = path.join(root, "redirected");
  await mkdir(target);
  await symlink(target, redirected, "junction");
  const report = path.join(root, "report.json");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
    "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--out", path.join(redirected, "missing-parent", "out"), "--report", report], { env, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.error.issues[0].code, "mlir-output-integrity");
  assert.equal(child.status, 11);
  assert.equal(result.error.category, "lock/integrity");
  assert.deepEqual(await readdir(target), [], "a rejected ancestor must not receive the missing parent");
});

test("Hermetic Build Entry gates the real MLIR consumer on the newly required exact header approval", async () => {
  assert.ok(process.env.TSFG_MLIR_SOURCE, "actual source must be explicit");
  const root = await createMlirFixture("mlir-legal-gate-");
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
