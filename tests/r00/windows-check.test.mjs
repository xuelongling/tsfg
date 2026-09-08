// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const windows = process.platform === "win32";

async function invoke(root, mode, extra = []) {
  const gitSha = createHash("sha256").update(await readFile(TEST_GIT_EXECUTABLE)).digest("hex");
  const located = spawnSync("where.exe", ["pwsh.exe"], { encoding: "utf8" });
  assert.equal(located.status, 0, "Windows check tests require PowerShell 7 on PATH");
  const powershell = located.stdout.split(/\r?\n/).find(Boolean);
  return spawnSync(powershell, [
    "-NoProfile", "-NonInteractive", "-File", path.join(repository, "eng/windows-check.ps1"),
    "-Mode", mode, "-Plan", "-RepositoryRoot", repository,
    "-DataRoot", root, "-CacheRoot", path.join(root, "cache"),
    "-NodePath", process.execPath, "-GitPath", TEST_GIT_EXECUTABLE, "-GitSha256", gitSha,
    ...extra,
  ], { cwd: repository, encoding: "utf8", env: {
    ...process.env,
    USERPROFILE: tmpdir(), APPDATA: tmpdir(), LOCALAPPDATA: tmpdir(),
    PSModuleAnalysisCachePath: path.join(tmpdir(), "powershell-module-cache"),
  } });
}

test("Windows check driver plans native host profiles without VM or release operations", { skip: !windows }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-check-plan-"));
  try {
    const result = await invoke(root, "Integration");
    assert.equal(result.status, 0, result.stderr);
    const [directory] = await readdir(root);
    const summary = JSON.parse(await readFile(path.join(root, directory, "check-summary.json"), "utf8"));
    assert.equal(summary.status, "planned");
    assert.equal(summary.planOnly, true);
    assert.deepEqual(summary.steps.map(({ name }) => name), [
      "debug-build", "debug-test", "debug-package", "debug-runtime",
      "release-build", "release-test", "release-package", "release-runtime",
    ]);
    for (const step of summary.steps) {
      assert.equal(step.exitCode, null);
      assert.ok(step.executable.endsWith("tsfg-build.cmd"));
      assert.ok(step.arguments.includes("windows-x86_64-msvc"));
      assert.ok(!step.arguments.includes("--dev"));
    }
    for (const value of Object.values(summary.paths)) assert.match(String(value), /^E:\\/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows development check plans only explicit non-publishable build and test", { skip: !windows }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-check-dev-"));
  try {
    const result = await invoke(root, "Development");
    assert.equal(result.status, 0, result.stderr);
    const [directory] = await readdir(root);
    const summary = JSON.parse(await readFile(path.join(root, directory, "check-summary.json"), "utf8"));
    assert.deepEqual(summary.steps.map(({ name }) => name), ["debug-build", "debug-test"]);
    for (const step of summary.steps) assert.ok(step.arguments.includes("--dev"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows check rejects C-drive, shell-metacharacter and redirected output paths before writes", { skip: !windows }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-check-paths-"));
  try {
    const redirect = path.join(root, "redirect");
    await symlink(process.env.SystemRoot, redirect, "junction");
    for (const target of ["C:\\tsfg-must-not-create", `${root}&invalid`, path.join(redirect, "tsfg-must-not-create")]) {
      const result = await invoke(target, "Quick");
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /absolute E-drive|Reparse-point/);
    }
    assert.deepEqual(await readdir(root), ["redirect"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
