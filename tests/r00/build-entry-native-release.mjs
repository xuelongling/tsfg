// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import path from "node:path";
import { invoke } from "./build-entry-invocation.mjs";
import { networkDenialHook } from "./build-entry-paths.mjs";
import { parseTarArchive } from "./build-entry-fixtures.mjs";

export async function verifyReleaseAndRuntimePackage(sandbox, report) {
  const workspacePath = path.join(sandbox, "workspace");
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const isWindows = process.platform === "win32";


    const releaseOutput = path.join(sandbox, "release-out");
    const releaseReportPath = path.join(sandbox, "release-build-report.json");
    const released = await invoke([
      "build",
      "--target", "linux-x86_64-gnu",
      "--profile", "release",
      "--workspace", workspacePath,
      "--out", releaseOutput,
      "--report", releaseReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(released.status, 0, released.stderr);
    const releaseReport = JSON.parse(await readFile(releaseReportPath, "utf8"));
    assert.equal(releaseReport.result.profile, "release");
    assert.deepEqual(releaseReport.result.buildPolicy, {
      cpuBaseline: "x86-64-v2",
      cxx: {
        assertions: true,
        debugInformation: "full",
        optimization: "-O2",
      },
      detachedSymbols: "package",
      forbidden: {
        fastMath: false,
        lto: false,
        nativeTuning: false,
        pgo: false,
      },
      profile: "release",
      simd: {
        baselineFixture: "x86-64-v2",
        dispatch: "runtime-detected",
        higherFeatures: ["avx2"],
      },
      target: "linux-x86_64-gnu",
      zig: {
        optimization: "ReleaseSafe",
        safetyChecks: true,
      },
    });
    assert.notEqual(
      releaseReport.result.buildIdentity.digest,
      report.result.buildIdentity.digest,
    );
    const releaseCmakeArguments = releaseReport.result.steps[0].arguments.join(" ");
    for (const flag of [
      "-O2",
      "-g2",
      "-UNDEBUG",
      "-march=x86-64-v2",
      "-mtune=generic",
      "-mno-avx",
      "-fno-lto",
      "-fno-profile-generate",
      "-fno-profile-use",
      "-fno-fast-math",
    ]) assert.ok(releaseCmakeArguments.includes(flag), `missing release flag ${flag}`);
    assert.match(releaseCmakeArguments, /-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF/);
    assert.match(releaseReport.result.steps[2].arguments.join(" "), /-OReleaseSafe/);
    assert.match(releaseReport.result.steps[2].arguments.join(" "), /-mcpu x86_64_v2/);
    const releaseMetadata = JSON.parse(await readFile(
      path.join(releaseOutput, "build-metadata.json"),
      "utf8",
    ));
    assert.deepEqual(releaseMetadata.buildPolicy, releaseReport.result.buildPolicy);
    const baselineOnlyOutput = path.join(sandbox, "baseline-only-out");
    const baselineOnlyReportPath = path.join(sandbox, "baseline-only-report.json");
    const baselineOnly = await invoke([
      "build",
      "--target", "linux-x86_64-gnu",
      "--profile", "release",
      "--simd-dispatch", "baseline-only",
      "--workspace", workspacePath,
      "--out", baselineOnlyOutput,
      "--report", baselineOnlyReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(baselineOnly.status, 0, baselineOnly.stderr);
    const baselineOnlyReport = JSON.parse(await readFile(baselineOnlyReportPath, "utf8"));
    assert.deepEqual(baselineOnlyReport.result.buildIdentity.options, {
      simdDispatch: "baseline-only",
    });
    assert.notEqual(
      baselineOnlyReport.result.buildIdentity.digest,
      releaseReport.result.buildIdentity.digest,
    );
    assert.equal(baselineOnlyReport.result.buildPolicy.simd.dispatch, "baseline-only");
    const releasePackageOutput = path.join(sandbox, "release-package");
    const releasePackageReportPath = path.join(sandbox, "release-package-report.json");
    const releasePackaged = await invoke([
      "package",
      "--target", "linux-x86_64-gnu",
      "--profile", "release",
      "--workspace", workspacePath,
      "--input", releaseOutput,
      "--out", releasePackageOutput,
      "--report", releasePackageReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(releasePackaged.status, 0, releasePackaged.stderr);
    const releasePackageReport = JSON.parse(await readFile(
      releasePackageReportPath,
      "utf8",
    ));
    assert.deepEqual(releasePackageReport.result.buildIdentity, releaseReport.result.buildIdentity);
    assert.deepEqual(releasePackageReport.result.buildPolicy, releaseReport.result.buildPolicy);
    const releaseArchiveBytes = await readFile(path.join(
      releasePackageOutput,
      releasePackageReport.result.archive,
    ));
    const releaseArchiveEntries = parseTarArchive(zstdDecompressSync(releaseArchiveBytes));
    assert.deepEqual(releaseArchiveEntries.map(({ name }) => name), [
      "artifact-manifest.json",
      "bin/tsfg-r00-cpp-smoke",
      "bin/tsfg-r00-zig-smoke",
      "contract-set.json",
      "symbols/tsfg-r00-cpp-smoke.debug",
      "symbols/tsfg-r00-zig-smoke.debug",
    ]);
    const releaseManifest = JSON.parse(releaseArchiveEntries[0].bytes.toString("utf8"));
    assert.deepEqual(releaseManifest.buildPolicy, releaseReport.result.buildPolicy);
    assert.deepEqual(releaseManifest.buildIdentity, releaseReport.result.buildIdentity);
    if (!isWindows) {
      const packageRuntimeReportPath = path.join(sandbox, "package-runtime-report.json");
      const packageRuntime = await invoke([
        "test",
        "--target", "linux-x86_64-gnu",
        "--profile", "release",
        "--workspace", workspacePath,
        "--package", releasePackageOutput,
        "--report", packageRuntimeReportPath,
      ], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${networkDenialHook}`,
          TSFG_RUNTIME_CACHE: cachePath,
          TSFG_RUNTIME_LOCK: lockPath,
          TSFG_RUNTIME_PLATFORM: "test-x86_64",
        },
      });
      assert.equal(packageRuntime.status, 0, packageRuntime.stderr);
      const packageRuntimeReport = JSON.parse(await readFile(packageRuntimeReportPath, "utf8"));
      assert.deepEqual(packageRuntimeReport.result.buildIdentity, releaseReport.result.buildIdentity);
      assert.equal(packageRuntimeReport.result.host.operatingSystem, "linux");
      assert.match(packageRuntimeReport.result.host.kernelRelease, /\S/);
      assert.deepEqual(packageRuntimeReport.result.networkCanaries, {
        after: "blocked",
        before: "blocked",
      });
      assert.equal(packageRuntimeReport.result.package.archive, releasePackageReport.result.archive);
      assert.deepEqual(packageRuntimeReport.result.tests, [
        { name: "cpp-package-smoke", status: "passed" },
        { name: "zig-package-smoke", status: "passed" },
      ]);
      const versionPath = path.join(workspacePath, "version.json");
      const versionBytes = await readFile(versionPath);
      await writeFile(versionPath, '{"version":"package-runtime-mismatch"}');
      const mismatchedRuntimeReportPath = path.join(sandbox, "package-runtime-mismatch-report.json");
      const mismatchedRuntime = await invoke([
        "test",
        "--target", "linux-x86_64-gnu",
        "--profile", "release",
        "--workspace", workspacePath,
        "--package", releasePackageOutput,
        "--report", mismatchedRuntimeReportPath,
      ], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${networkDenialHook}`,
          TSFG_RUNTIME_CACHE: cachePath,
          TSFG_RUNTIME_LOCK: lockPath,
          TSFG_RUNTIME_PLATFORM: "test-x86_64",
        },
      });
      assert.equal(mismatchedRuntime.status, 21, mismatchedRuntime.stderr);
      const mismatchedRuntimeReport = JSON.parse(await readFile(mismatchedRuntimeReportPath, "utf8"));
      assert.equal(mismatchedRuntimeReport.error.issues[0].code, "build-identity-mismatch");
      await writeFile(versionPath, versionBytes);
      const releaseTestReportPath = path.join(sandbox, "release-test-report.json");
      const releaseTest = await invoke([
        "test",
        "--target", "linux-x86_64-gnu",
        "--profile", "release",
        "--cpu-fixture", "x86-64-v2",
        "--workspace", workspacePath,
        "--out", releaseOutput,
        "--report", releaseTestReportPath,
      ], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${networkDenialHook}`,
          TSFG_RUNTIME_CACHE: cachePath,
          TSFG_RUNTIME_LOCK: lockPath,
          TSFG_RUNTIME_PLATFORM: "test-x86_64",
        },
      });
      assert.equal(releaseTest.status, 0, releaseTest.stderr);
      const releaseTestReport = JSON.parse(await readFile(releaseTestReportPath, "utf8"));
      assert.deepEqual(releaseTestReport.result.buildIdentity, releaseReport.result.buildIdentity);
      assert.equal(releaseTestReport.result.profile, "release");
      assert.equal(releaseTestReport.result.cpuFixture, "x86-64-v2");
      assert.deepEqual(releaseTestReport.result.tests, [
        { name: "cpp-smoke", status: "passed" },
        { name: "cpp-smoke-baseline-fallback", status: "passed" },
        { name: "zig-smoke", status: "passed" },
      ]);
    }
}
