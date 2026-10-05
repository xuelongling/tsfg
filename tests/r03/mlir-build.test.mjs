// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMlirFixture } from "./mlir-fixtures.mjs";
import { MlirBuildError, readMlirBuildTrace } from "../../eng/mlir-build.mjs";

test("MLIR trace reader requires a physical EVAL CODE command, not a CALL, comment or string", async () => {
  const root = await createMlirFixture("mlir-eval-origin-");
  const file = path.join(root, "GNUInstallDirs.cmake");
  // Independent physical goldens reproduce the locked module's three line identities.
  const lines = Array(488).fill("");
  lines[289] = "  cmake_language(CALL set result value)";
  lines[483] = "  # Using cmake_language(EVAL) to call a short wrapper function instead";
  lines[484] = '  cmake_language(EVAL CODE "set(result value)")';
  await writeFile(file, lines.join("\n"));
  const trace = line => [
    { file, line, cmd: "cmake_language", args: ["EVAL", "CODE", "set(result value)"] },
    { file: `${file}:${line}:EVAL`, line: 1, cmd: "set", args: ["result", "value"] }
  ].map(record => JSON.stringify(record)).join("\n");
  const result = await readMlirBuildTrace({ cmakeTrace: trace(485), build: root, inputRoots: [root] });
  assert.deepEqual(result.files, [file]);
  assert.equal(result.evaluationFrames[0].physicalFile, file);
  assert.deepEqual(result.evaluationFrames[0].evaluationLines, ["485"]);
  for (const line of [290, 484]) await assert.rejects(
    readMlirBuildTrace({ cmakeTrace: trace(line), build: root, inputRoots: [root] }),
    error => error instanceof MlirBuildError && error.issueCode === "mlir-source-integrity");
  for (const text of ['set(text "\ncmake_language(EVAL CODE fake)\n")',
    'set(text [=[\ncmake_language(EVAL CODE fake)\n]=])',
    '#[=[\ncmake_language(EVAL CODE fake)\n]=]',
    'set(text\ncmake_language(EVAL CODE fake)\n)']) {
    await writeFile(file, text);
    await assert.rejects(readMlirBuildTrace({ cmakeTrace: trace(2), build: root, inputRoots: [root] }),
      error => error instanceof MlirBuildError && error.issueCode === "mlir-source-integrity");
  }
  await assert.rejects(readMlirBuildTrace({ cmakeTrace: trace(485), build: root, inputRoots: [] }),
    error => error instanceof MlirBuildError && error.issueCode === "mlir-source-integrity");
});

test("Hermetic Build Entry classifies unsupported MLIR configurations before reading missing inputs", async () => {
  const root = await createMlirFixture("mlir-configuration-");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_MLIR_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  }
  const configurations = [[], ["--dev", "--target", "linux-x86_64-gnu"], ["--dev", "--profile", "release"]];
  const invalidLock = path.join(root, "invalid-runtime-lock.json");
  const cache = path.join(root, "runtime-cache");
  await writeFile(invalidLock, "{}\n");
  await mkdir(cache);
  const environments = [{ name: "no-runtime", values: {}, validStatus: 10, validCode: "mlir-source-identity" },
    { name: "partial-runtime", values: { TSFG_RUNTIME_LOCK: invalidLock }, validStatus: 11, validCode: "runtime-closure" },
    { name: "invalid-runtime", values: { TSFG_RUNTIME_LOCK: invalidLock, TSFG_RUNTIME_CACHE: cache,
      TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc", TSFG_WINDOWS_OFFLINE_ACTIVE: "0" }, validStatus: 11, validCode: "runtime-closure" },
    { name: "boundary-bootstrap", values: { TSFG_WINDOWS_BOUNDARY_ERROR: "test boundary bootstrap unavailable",
      TSFG_RUNTIME_LOCK: invalidLock, TSFG_RUNTIME_CACHE: cache, TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" },
      validStatus: 12, validCode: "sandbox-boundary" }];
  const results = [];
  const controls = [];
  for (const environment of environments) {
    for (const configuration of configurations) {
      const index = results.length;
      const report = path.join(root, `report-${index}.json`);
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
        "build", ...configuration, "--source-target", "mlir-core",
        ...(configuration.includes("--target") ? [] : ["--target", "windows-x86_64-msvc"]),
        ...(configuration.includes("--profile") ? [] : ["--profile", "debug"]),
        "--out", path.join(root, `out-${index}`), "--report", report],
        { env: { ...env, ...environment.values }, encoding: "utf8", windowsHide: true });
      assert.ifError(child.error);
      results.push({ environment: environment.name, configuration, status: child.status,
        report: JSON.parse(await readFile(report, "utf8")) });
    }
    const report = path.join(root, `control-${controls.length}.json`);
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
      "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
      "--out", path.join(root, "control-out"), "--report", report],
      { env: { ...env, ...environment.values }, encoding: "utf8", windowsHide: true });
    assert.ifError(child.error);
    controls.push({ status: child.status, expectedStatus: environment.validStatus, expectedCode: environment.validCode,
      report: JSON.parse(await readFile(report, "utf8")) });
  }
  await writeFile(path.join(root, "configuration-results.json"), JSON.stringify({ results, controls }));
  for (const result of results) {
    assert.equal(result.status, 2);
    assert.equal(result.report.error.category, "usage/configuration");
    assert.equal(result.report.error.issues[0].code, "mlir-configuration");
  }
  for (const control of controls) {
    assert.equal(control.status, control.expectedStatus);
    assert.equal(control.report.error.issues[0].code, control.expectedCode);
  }
  assert.deepEqual(await readdir(cache), [], "configuration rejection must not populate the runtime cache");
  assert.equal(await readFile(invalidLock, "utf8"), "{}\n");
  assert.ok((await readdir(root)).every(name => ["configuration-results.json", "invalid-runtime-lock.json", "runtime-cache"].includes(name)
    || /^(report|control)-\d+\.json$/.test(name)), "refusal must not create build/boundary outputs");
});

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
  const results = [];
  for (const [file, pattern] of [["mlir-build.test.mjs", "^Hermetic Build Entry"],
    ["mlir-legal.test.mjs", "mutable approvals"], ["mlir-python.test.mjs", "changed executable"],
    ["mlir-python.test.mjs", "expand the fixed tool-lock"]]) {
    const index = results.length;
    const target = path.join(root, `owned-target-${index}`);
    const redirected = path.join(root, `redirected-${index}`);
    await mkdir(target);
    await symlink(target, redirected, "junction");
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, TEMP: redirected, TMP: redirected, TMPDIR: redirected,
      TSFG_MLIR_TEST_TEMP_ROOT: redirected };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ["--test", "--test-name-pattern", pattern,
      fileURLToPath(new URL(file, import.meta.url))], { encoding: "utf8", windowsHide: true, env });
    assert.ifError(child.error);
    results.push({ file, pattern, status: child.status, stdout: child.stdout, stderr: child.stderr,
      targetMembers: await readdir(target) });
  }
  await writeFile(path.join(root, "runner-results.json"), JSON.stringify(results));
  for (const result of results) {
    assert.deepEqual(result.targetMembers, [], `${result.file}/${result.pattern} must leave the destination untouched`);
    assert.notEqual(result.status, 0, "redirected fixture storage must be rejected before mkdtemp");
    assert.match(result.stdout + result.stderr, /temporary storage.*ordinary|temporary storage.*redirected/);
  }
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

test("Hermetic Build Entry requires a verified native closure after the approved source supplement", async () => {
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
  assert.equal(result.error.issues[0].code, "mlir-tool-integrity");
  assert.equal(child.status, 11);
  assert.equal(result.error.category, "lock/integrity");
  assert.match(result.error.issues[0].message, /verified native tool closure/);
  assert.deepEqual(await readdir(root), ["report.json"], "missing tools must refuse before staging source");
  // Keep this exact non-configured fixture for the validated cleanup phase.
});
