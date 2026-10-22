// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { invoke } from "./build-entry-invocation.mjs";
import { repositoryRoot, networkDenialHook } from "./build-entry-paths.mjs";

test("package runtime smoke fails closed when the host is not the target minimum platform", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-package-runtime-platform-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  const target = process.platform === "win32"
    ? "linux-x86_64-gnu"
    : "windows-x86_64-msvc";
  try {
    const cloned = spawnSync(
      "git",
      ["-c", "core.autocrlf=false", "clone", "--quiet", "--no-hardlinks", repositoryRoot, workspace],
      { encoding: "utf8" },
    );
    assert.equal(cloned.status, 0, cloned.stderr);
    const result = await invoke([
      "test",
      "--target", target,
      "--profile", "release",
      "--workspace", workspace,
      "--package", path.join(sandbox, "package"),
      "--report", reportPath,
    ], {
      env: { ...process.env, NODE_OPTIONS: `--require=${networkDenialHook}` },
    });
    assert.equal(result.status, 21, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.category, "test/compatibility failure");
    assert.equal(report.error.issues[0].code, "minimum-platform");
    await assert.rejects(lstat(path.join(sandbox, "package-runtime")), /ENOENT/);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});


test("package runtime smoke rejects build-only options before package inspection", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-package-runtime-options-"));
  const reportPath = path.join(sandbox, "report.json");
  const target = process.platform === "win32"
    ? "windows-x86_64-msvc"
    : "linux-x86_64-gnu";
  try {
    const result = await invoke([
      "test",
      "--dev",
      "--target", target,
      "--profile", "release",
      "--workspace", repositoryRoot,
      "--package", path.join(sandbox, "package"),
      "--out", path.join(sandbox, "out"),
      "--report", reportPath,
    ], {
      env: { ...process.env, NODE_OPTIONS: `--require=${networkDenialHook}` },
    });
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.category, "usage/configuration");
    assert.equal(report.error.issues[0].code, "invalid-configuration");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
