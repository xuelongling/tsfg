// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { invoke } from "./build-entry-invocation.mjs";
import { repositoryRoot } from "./build-entry-paths.mjs";

test("dirty workspace fails closed before build execution", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-dirty-build-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    await mkdir(workspace);
    for (const arguments_ of [
      ["init"],
      ["config", "user.name", "tsfg test"],
      ["config", "user.email", "tsfg-test@example.invalid"],
    ]) {
      const initialized = spawnSync("git", arguments_, {
        cwd: workspace,
        encoding: "utf8",
      });
      assert.equal(initialized.status, 0, initialized.stderr);
    }
    await writeFile(path.join(workspace, "tracked.txt"), "tracked\n");
    for (const arguments_ of [["add", "tracked.txt"], ["commit", "-m", "fixture"]]) {
      const committed = spawnSync("git", arguments_, {
        cwd: workspace,
        encoding: "utf8",
      });
      assert.equal(committed.status, 0, committed.stderr);
    }
    await writeFile(path.join(workspace, "undeclared.txt"), "dirty\n");

    const dirtyCommands = [
      [
        "build",
        "--target", "linux-x86_64-gnu",
        "--profile", "debug",
        "--workspace", workspace,
        "--out", path.join(sandbox, "out"),
        "--report", reportPath,
      ],
      [
        "test",
        "--target", "linux-x86_64-gnu",
        "--profile", "debug",
        "--workspace", workspace,
        "--out", path.join(sandbox, "out"),
        "--report", reportPath,
      ],
      [
        "package",
        "--target", "linux-x86_64-gnu",
        "--profile", "debug",
        "--workspace", workspace,
        "--input", path.join(sandbox, "input"),
        "--out", path.join(sandbox, "package"),
        "--report", reportPath,
      ],
      [
        "build",
        "--target", "windows-x86_64-msvc",
        "--profile", "debug",
        "--workspace", workspace,
        "--out", path.join(sandbox, "windows-out"),
        "--report", reportPath,
      ],
      [
        "test",
        "--target", "windows-x86_64-msvc",
        "--profile", "debug",
        "--workspace", workspace,
        "--out", path.join(sandbox, "windows-out"),
        "--report", reportPath,
      ],
      [
        "package",
        "--target", "windows-x86_64-msvc",
        "--profile", "debug",
        "--workspace", workspace,
        "--input", path.join(sandbox, "windows-input"),
        "--out", path.join(sandbox, "windows-package"),
        "--report", reportPath,
      ],
      [
        "build",
        "--target", "linux-x86_64-gnu",
        "--profile", "release",
        "--workspace", workspace,
        "--out", path.join(sandbox, "release-out"),
        "--report", reportPath,
      ],
      [
        "test",
        "--target", "linux-x86_64-gnu",
        "--profile", "release",
        "--cpu-fixture", "x86-64-v2",
        "--workspace", workspace,
        "--out", path.join(sandbox, "release-out"),
        "--report", reportPath,
      ],
    ];
    for (const arguments_ of dirtyCommands) {
      const result = await invoke(arguments_);
      assert.equal(result.status, 10, result.stderr);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.category, "workspace mismatch");
      assert.equal(report.error.code, "10");
      assert.equal(report.error.issues[0].code, "dirty-project");
    }
    const repeated = await invoke(dirtyCommands[0]);
    assert.equal(repeated.status, 10, repeated.stderr);
    const repeatedReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(repeatedReport.error.issues[0].code, "dirty-project");
    const forbiddenPackage = await invoke([
      "package", "--dev",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspace,
      "--input", path.join(sandbox, "input"),
      "--out", path.join(sandbox, "package"),
      "--report", reportPath,
    ]);
    assert.equal(forbiddenPackage.status, 10, forbiddenPackage.stderr);
    let failureReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(failureReport.error.category, "workspace mismatch");
    assert.equal(failureReport.error.issues[0].code, "development-mode-forbidden");

    const forbiddenReproDevelopmentMode = await invoke([
      "repro-check", "--dev", "--workspace", workspace, "--report", reportPath,
    ]);
    assert.equal(forbiddenReproDevelopmentMode.status, 2, forbiddenReproDevelopmentMode.stderr);
    failureReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(failureReport.error.category, "usage/configuration");
    assert.equal(failureReport.error.issues[0].code, "invalid-configuration");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});


test("control plane refuses Git inspection without an explicit executable", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-explicit-git-"));
  const reportPath = path.join(sandbox, "report.json");
  try {
    const result = await invoke([
      "build", "--dev",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", repositoryRoot,
      "--out", path.join(sandbox, "out"),
      "--report", reportPath,
    ], {
      env: { ...process.env, TSFG_GIT: "" },
    });
    assert.equal(result.status, 10, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.issues[0].code, "git-state");
    assert.match(report.error.issues[0].message, /requires an absolute TSFG_GIT/);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});


test("forbidden ambient build options fail policy before tool execution", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-forbidden-build-options-"));
  try {
    const scenarios = [
      ["CXXFLAGS", "-flto", "lto"],
      ["LDFLAGS", "-fprofile-use=profile.profdata", "pgo"],
      ["CFLAGS", "-ffast-math", "fast-math"],
      ["CXXFLAGS", "-march=native", "native-tuning"],
      ["CXXFLAGS", "-mavx2", "static-higher-simd"],
    ];
    for (const [variable, value, policy] of scenarios) {
      const reportPath = path.join(sandbox, `${policy}.json`);
      const outputPath = path.join(sandbox, `${policy}-out`);
      const result = await invoke([
        "build", "--dev",
        "--target", "linux-x86_64-gnu",
        "--profile", "release",
        "--workspace", repositoryRoot,
        "--out", outputPath,
        "--report", reportPath,
      ], {
        env: { ...process.env, [variable]: value },
      });
      assert.equal(result.status, 2, `${policy}: ${result.stderr}`);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.category, "usage/configuration");
      assert.equal(report.error.issues[0].code, "forbidden-build-option");
      assert.match(report.error.issues[0].message, new RegExp(policy));
      await assert.rejects(lstat(outputPath), /ENOENT/);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
