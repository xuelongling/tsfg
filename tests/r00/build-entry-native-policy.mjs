// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { appendFile, chmod, lstat, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { invoke } from "./build-entry-invocation.mjs";
import { networkDenialHook } from "./build-entry-paths.mjs";

export async function verifyDeclaredPoliciesAndMissingTools(sandbox, gitExecutable, tools, zig) {
  const workspacePath = path.join(sandbox, "workspace");
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const developmentReportPath = path.join(sandbox, "development-report.json");
  const poisonPath = path.join(sandbox, "poison-path");
  const poisonSentinel = path.join(sandbox, "poison-tool-ran");
  const dirtyPath = path.join(workspacePath, "dirty.txt");
  const undeclaredInputPath = path.join(
      workspacePath,
      "tests",
      "r00",
      "smoke",
      "cpp",
      "undeclared.cpp",
    );
  const developmentOutput = path.join(sandbox, "development-out");

    const policyCmakePath = path.join(
      workspacePath,
      "tests",
      "r00",
      "smoke",
      "cpp",
      "CMakeLists.txt",
    );
    const policyCmake = await readFile(policyCmakePath);
    await appendFile(
      policyCmakePath,
      "\ntarget_compile_options(tsfg-r00-cpp-smoke PRIVATE -flto)\n",
    );
    const policyOutput = path.join(sandbox, "forbidden-declared-policy-out");
    const policyReportPath = path.join(sandbox, "forbidden-declared-policy-report.json");
    const forbiddenDeclaredPolicy = await invoke([
      "build", "--dev",
      "--target", "linux-x86_64-gnu",
      "--profile", "release",
      "--workspace", workspacePath,
      "--out", policyOutput,
      "--report", policyReportPath,
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
    assert.equal(forbiddenDeclaredPolicy.status, 20, forbiddenDeclaredPolicy.stderr);
    const policyReport = JSON.parse(await readFile(policyReportPath, "utf8"));
    assert.equal(policyReport.error.category, "build failure");
    assert.equal(policyReport.error.issues[0].code, "forbidden-build-option");
    await assert.rejects(lstat(policyOutput), /ENOENT/);
    await writeFile(policyCmakePath, policyCmake);
    await appendFile(
      policyCmakePath,
      "\nset(TSFG_TEST_IPO TRUE)\nset_property(TARGET tsfg-r00-cpp-smoke PROPERTY INTERPROCEDURAL_OPTIMIZATION ${TSFG_TEST_IPO})\n",
    );
    const ipoPolicyOutput = path.join(sandbox, "forbidden-cmake-ipo-out");
    const ipoPolicyReportPath = path.join(sandbox, "forbidden-cmake-ipo-report.json");
    const forbiddenCmakeIpo = await invoke([
      "build", "--dev",
      "--target", "linux-x86_64-gnu",
      "--profile", "release",
      "--workspace", workspacePath,
      "--out", ipoPolicyOutput,
      "--report", ipoPolicyReportPath,
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
    assert.equal(forbiddenCmakeIpo.status, 20, forbiddenCmakeIpo.stderr);
    const ipoPolicyReport = JSON.parse(await readFile(ipoPolicyReportPath, "utf8"));
    assert.equal(ipoPolicyReport.error.category, "build failure");
    assert.equal(ipoPolicyReport.error.issues[0].code, "forbidden-build-option");
    await assert.rejects(lstat(ipoPolicyOutput), /ENOENT/);
    await writeFile(policyCmakePath, policyCmake);
    const policyZigPath = path.join(
      workspacePath,
      "tests",
      "r00",
      "smoke",
      "zig",
      "build.zig",
    );
    const policyZig = await readFile(policyZigPath);
    await appendFile(
      policyZigPath,
      "\n// injected policy probe\nconst tsfg_test_lto = .full;\nexecutable.lto = tsfg_test_lto;\n",
    );
    const zigLtoPolicyOutput = path.join(sandbox, "forbidden-zig-lto-out");
    const zigLtoPolicyReportPath = path.join(sandbox, "forbidden-zig-lto-report.json");
    const forbiddenZigLto = await invoke([
      "build", "--dev",
      "--target", "linux-x86_64-gnu",
      "--profile", "release",
      "--workspace", workspacePath,
      "--out", zigLtoPolicyOutput,
      "--report", zigLtoPolicyReportPath,
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
    assert.equal(forbiddenZigLto.status, 20, forbiddenZigLto.stderr);
    const zigLtoPolicyReport = JSON.parse(await readFile(zigLtoPolicyReportPath, "utf8"));
    assert.equal(zigLtoPolicyReport.error.category, "build failure");
    assert.equal(zigLtoPolicyReport.error.issues[0].code, "forbidden-build-option");
    await assert.rejects(lstat(zigLtoPolicyOutput), /ENOENT/);
    await writeFile(policyZigPath, policyZig);
    const activeRelative = (await readFile(
      path.join(cachePath, "active", "test-x86_64"),
      "utf8",
    )).trim();
    const lockedZig = path.join(
      cachePath,
      ...activeRelative.split("/"),
      "zig",
      ...tools.zig.artifacts[0].installPath.split("/"),
    );
    await rm(lockedZig);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const missingTool = await invoke([
        "build", "--dev",
        "--target", "linux-x86_64-gnu",
        "--profile", "debug",
        "--workspace", workspacePath,
        "--out", path.join(sandbox, "missing-tool-out"),
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
      assert.equal(missingTool.status, 11, missingTool.stderr);
      const missingToolReport = JSON.parse(await readFile(developmentReportPath, "utf8"));
      assert.equal(missingToolReport.error.category, "lock/integrity");
      assert.equal(missingToolReport.error.issues[0].code, "runtime-closure");
      await assert.rejects(stat(poisonSentinel), /ENOENT/);
    }
    await writeFile(lockedZig, zig);
    if (process.platform !== "win32") await chmod(lockedZig, 0o755);
    await rm(dirtyPath);
    await rm(undeclaredInputPath);
    const implicitDevelopmentReportPath = path.join(
      sandbox,
      "implicit-development-test-report.json",
    );
    const implicitDevelopment = await invoke([
      "test",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", developmentOutput,
      "--report", implicitDevelopmentReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(implicitDevelopment.status, 10, implicitDevelopment.stderr);
    const implicitDevelopmentReport = JSON.parse(await readFile(
      implicitDevelopmentReportPath,
      "utf8",
    ));
    assert.equal(
      implicitDevelopmentReport.error.issues[0].code,
      "development-mode-required",
    );
}
