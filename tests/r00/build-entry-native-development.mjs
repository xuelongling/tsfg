// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { appendFile, chmod, lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { invoke } from "./build-entry-invocation.mjs";
import { repositoryRoot, networkDenialHook } from "./build-entry-paths.mjs";

export async function verifyDevelopmentIsolation(sandbox) {
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const isWindows = process.platform === "win32";

    const workspacePath = path.join(sandbox, "workspace");
    const cloned = spawnSync(
      "git",
      ["-c", "core.autocrlf=false", "clone", "--quiet", "--no-hardlinks", repositoryRoot, workspacePath],
      { encoding: "utf8" },
    );
    assert.equal(cloned.status, 0, cloned.stderr);
    const locatedGit = spawnSync(
      process.platform === "win32" ? "where.exe" : "which",
      ["git"],
      { encoding: "utf8" },
    );
    assert.equal(locatedGit.status, 0, locatedGit.stderr);
    const gitExecutable = locatedGit.stdout.split(/\r?\n/).find(Boolean);
    const poisonPath = path.join(sandbox, "poison-path");
    const poisonSentinel = path.join(sandbox, "poison-tool-ran");
    await mkdir(poisonPath);
    for (const tool of ["node", "pnpm", "zig", "clang", "cmake", "ninja"]) {
      const poisonTool = path.join(
        poisonPath,
        process.platform === "win32" ? `${tool}.cmd` : tool,
      );
      await writeFile(
        poisonTool,
        process.platform === "win32"
          ? `@echo off\r\n>"${poisonSentinel}" echo poison\r\nexit /b 91\r\n`
          : `#!/bin/sh\nprintf poison > '${poisonSentinel}'\nexit 91\n`,
      );
      if (process.platform !== "win32") await chmod(poisonTool, 0o755);
    }
    const dirtyPath = path.join(workspacePath, "dirty.txt");
    await writeFile(dirtyPath, "dirty\n");
    const undeclaredInputPath = path.join(
      workspacePath,
      "tests",
      "r00",
      "smoke",
      "cpp",
      "undeclared.cpp",
    );
    await writeFile(undeclaredInputPath, "undeclared input\n");
    const developmentOutput = path.join(sandbox, "development-out");
    const developmentReportPath = path.join(sandbox, "development-report.json");
    const developed = await invoke([
      "build", "--dev",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", developmentOutput,
      "--report", developmentReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        PATH: poisonPath,
        TSFG_GIT: gitExecutable,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(developed.status, 0, developed.stderr);
    const developmentReport = JSON.parse(await readFile(developmentReportPath, "utf8"));
    assert.equal(developmentReport.result.development, true);
    assert.equal(developmentReport.result.dirty, true);
    assert.equal(developmentReport.result.networkCanary, "blocked");
    assert.deepEqual(developmentReport.result.networkCanaries, {
      after: "blocked",
      before: "blocked",
    });
    assert.equal(developmentReport.result.publishable, false);
    const postCanaryHook = path.join(sandbox, "allow-network-after-before-canary.cjs");
    await writeFile(postCanaryHook, `
const net = require("node:net");
const { EventEmitter } = require("node:events");
let attempts = 0;
net.connect = () => {
  const socket = new EventEmitter();
  socket.destroy = () => undefined;
  socket.setTimeout = () => socket;
  attempts += 1;
  process.nextTick(() => socket.emit(attempts > 2 ? "connect" : "error", new Error("blocked")));
  return socket;
};
`);
    const postCanaryOutput = path.join(sandbox, "post-canary-output");
    const postCanaryReportPath = path.join(sandbox, "post-canary-report.json");
    const postCanaryFailure = await invoke([
      "build", "--dev",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", postCanaryOutput,
      "--report", postCanaryReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${postCanaryHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(postCanaryFailure.status, 12, postCanaryFailure.stderr);
    const postCanaryReport = JSON.parse(await readFile(postCanaryReportPath, "utf8"));
    assert.equal(postCanaryReport.error.issues[0].code, "network-boundary");
    await assert.rejects(lstat(postCanaryOutput), /ENOENT/);
    const developmentMetadata = JSON.parse(await readFile(
      path.join(developmentOutput, "build-metadata.json"),
      "utf8",
    ));
    assert.equal(developmentMetadata.development, true);
    assert.equal(developmentMetadata.dirty, true);
    assert.equal(developmentMetadata.publishable, false);
    if (!isWindows) {
      const developmentTestReportPath = path.join(sandbox, "development-test-report.json");
      const developmentTest = await invoke([
      "test", "--dev",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", developmentOutput,
      "--report", developmentTestReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
      assert.equal(developmentTest.status, 0, developmentTest.stderr);
      const developmentTestReport = JSON.parse(await readFile(
        developmentTestReportPath,
        "utf8",
      ));
      assert.equal(developmentTestReport.result.development, true);
      assert.equal(developmentTestReport.result.dirty, true);
      assert.equal(developmentTestReport.result.publishable, false);
    }
    await assert.rejects(stat(poisonSentinel), /ENOENT/);
    if (!isWindows) {
      const cmakeListsPath = path.join(
        workspacePath,
        "tests",
        "r00",
        "smoke",
        "cpp",
        "CMakeLists.txt",
      );
      const cmakeLists = await readFile(cmakeListsPath);
      await appendFile(
        cmakeListsPath,
        `\n# TSFG_TEST_REQUIRE_UNDECLARED ${undeclaredInputPath.replaceAll("\\", "/")}\n`,
      );
      const undeclaredReadReportPath = path.join(sandbox, "undeclared-read-report.json");
      const undeclaredRead = await invoke([
        "build", "--dev",
        "--target", "linux-x86_64-gnu",
        "--profile", "debug",
        "--workspace", workspacePath,
        "--out", path.join(sandbox, "undeclared-read-out"),
        "--report", undeclaredReadReportPath,
      ], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${networkDenialHook}`,
          TSFG_GIT: gitExecutable,
          TSFG_RUNTIME_CACHE: cachePath,
          TSFG_RUNTIME_LOCK: lockPath,
          TSFG_RUNTIME_PLATFORM: "test-x86_64",
        },
      });
      assert.equal(undeclaredRead.status, 12, undeclaredRead.stderr);
      const undeclaredReadReport = JSON.parse(await readFile(undeclaredReadReportPath, "utf8"));
      assert.equal(undeclaredReadReport.error.category, "offline input missing");
      assert.equal(undeclaredReadReport.error.issues[0].code, "undeclared-build-input");
      assert.match(
        undeclaredReadReport.error.issues[0].message,
        /tests\/r00\/smoke\/cpp\/undeclared\.cpp/,
      );
      await writeFile(cmakeListsPath, cmakeLists);

      await appendFile(cmakeListsPath, "\n# TSFG_TEST_MUTATE_DECLARED\n");
      const sourceWriteReportPath = path.join(sandbox, "source-write-report.json");
      const sourceWrite = await invoke([
        "build", "--dev",
        "--target", "linux-x86_64-gnu",
        "--profile", "debug",
        "--workspace", workspacePath,
        "--out", path.join(sandbox, "source-write-out"),
        "--report", sourceWriteReportPath,
      ], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${networkDenialHook}`,
          TSFG_GIT: gitExecutable,
          TSFG_RUNTIME_CACHE: cachePath,
          TSFG_RUNTIME_LOCK: lockPath,
          TSFG_RUNTIME_PLATFORM: "test-x86_64",
        },
      });
      assert.equal(sourceWrite.status, 12, sourceWrite.stderr);
      const sourceWriteReport = JSON.parse(await readFile(sourceWriteReportPath, "utf8"));
      assert.equal(sourceWriteReport.error.category, "offline input missing");
      assert.equal(sourceWriteReport.error.issues[0].code, "undeclared-build-input");
      assert.match(sourceWriteReport.error.issues[0].message, /CMakeLists\.txt/);
      assert.equal((await readFile(cmakeListsPath, "utf8")).includes("mutation"), false);
      await writeFile(cmakeListsPath, cmakeLists);
    }
  return { gitExecutable };
}
