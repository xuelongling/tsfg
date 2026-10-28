// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { invoke } from "./build-entry-invocation.mjs";
import { networkDenialHook } from "./build-entry-paths.mjs";

export async function verifyNativeFailureCategories(sandbox) {
  const workspacePath = path.join(sandbox, "workspace");
  const outputPath = path.join(sandbox, "out");
  const testReportPath = path.join(sandbox, "test-report.json");
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const isWindows = process.platform === "win32";
  const compileFailureReportPath = path.join(sandbox, "compile-failure-report.json");
  const internalFailureReportPath = path.join(sandbox, "internal-failure-report.json");
  const testFailureReportPath = path.join(sandbox, "test-failure-report.json");


    const tested = await invoke([
      "test",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", outputPath,
      "--report", testReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    if (isWindows) {
      assert.equal(tested.status, 21, tested.stderr);
    } else {
      assert.equal(tested.status, 0, tested.stderr);
      const testReport = JSON.parse(await readFile(testReportPath, "utf8"));
      assert.equal(testReport.command, "test");
      assert.equal(testReport.status, "success");
      assert.deepEqual(testReport.result.tests, [
        { name: "cpp-smoke", status: "passed" },
        { name: "zig-smoke", status: "passed" },
      ]);
    }

    const compileFailure = await invoke([
      "build",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", path.join(sandbox, "compile-fail"),
      "--report", compileFailureReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(compileFailure.status, 20, compileFailure.stderr);
    const compileFailureReport = JSON.parse(
      await readFile(compileFailureReportPath, "utf8"),
    );
    assert.equal(compileFailureReport.status, "failure");
    assert.equal(compileFailureReport.error.category, "build failure");
    assert.equal(compileFailureReport.error.code, "20");

    const blockedOutputParent = path.join(sandbox, "blocked-output-parent");
    await writeFile(blockedOutputParent, "not a directory\n");
    const internalFailure = await invoke([
      "build",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", path.join(blockedOutputParent, "out"),
      "--report", internalFailureReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(internalFailure.status, 30, internalFailure.stderr);
    const internalFailureReport = JSON.parse(
      await readFile(internalFailureReportPath, "utf8"),
    );
    assert.equal(internalFailureReport.error.category, "internal control-plane failure");
    assert.equal(internalFailureReport.error.code, "30");

    if (!isWindows) {
      await writeFile(
        path.join(outputPath, "bin", "tsfg-r00-cpp-smoke"),
        "not an executable\n",
      );
    }
    const testFailure = await invoke([
      "test",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", outputPath,
      "--report", testFailureReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(testFailure.status, 21, testFailure.stderr);
    const testFailureReport = JSON.parse(await readFile(testFailureReportPath, "utf8"));
    assert.equal(testFailureReport.status, "failure");
    assert.equal(testFailureReport.error.category, "test/compatibility failure");
    assert.equal(testFailureReport.error.code, "21");
}
