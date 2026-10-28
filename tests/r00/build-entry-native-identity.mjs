// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { lstat, readFile, readlink, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { currentContractSetId } from "./contract-compatibility-fixtures.mjs";
import { invoke } from "./build-entry-invocation.mjs";
import { networkDenialHook, networkAccessHook } from "./build-entry-paths.mjs";
import { fixtureDigest } from "./build-entry-fixtures.mjs";

export async function verifyCleanBuildIdentity(sandbox) {
  const workspacePath = path.join(sandbox, "workspace");
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const developmentOutput = path.join(sandbox, "development-out");
  const outputPath = path.join(sandbox, "out");
  const reportPath = path.join(sandbox, "build-report.json");

    const networkFailureOutput = path.join(sandbox, "network-failure-out");
    const networkFailureReport = path.join(sandbox, "network-failure-report.json");
    const networkFailure = await invoke([
      "build",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", networkFailureOutput,
      "--report", networkFailureReport,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkAccessHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(networkFailure.status, 12, networkFailure.stderr);
    const networkReport = JSON.parse(await readFile(networkFailureReport, "utf8"));
    assert.equal(networkReport.error.category, "offline input missing");
    assert.equal(networkReport.error.issues[0].code, "network-boundary");
    await assert.rejects(lstat(networkFailureOutput), /ENOENT/);
    const developmentPackageReportPath = path.join(
      sandbox,
      "development-package-report.json",
    );
    const developmentPackage = await invoke([
      "package",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--input", developmentOutput,
      "--out", path.join(sandbox, "development-package"),
      "--report", developmentPackageReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(developmentPackage.status, 22, developmentPackage.stderr);
    assert.match(developmentPackage.stderr, /does not match the current Build Identity/);

    const result = await invoke([
      "build",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--out", outputPath,
      "--report", reportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.ok((await stat(path.join(outputPath, "bin", "tsfg-r00-cpp-smoke"))).isFile());
    assert.ok((await stat(path.join(outputPath, "bin", "tsfg-r00-zig-smoke"))).isFile());
    assert.ok((await lstat(outputPath)).isSymbolicLink());
    assert.equal(
      path.basename(
        path.dirname(path.resolve(path.dirname(outputPath), await readlink(outputPath))),
      ),
      ".out.versions",
    );
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.command, "build");
    assert.equal(report.network, "offline");
    assert.equal(report.result.development, false);
    assert.equal(report.result.dirty, false);
    assert.deepEqual(report.result.inputAudit, {
      mode: process.platform === "linux"
        ? "materialized-build-input-set+namespaces"
        : "materialized-build-input-set",
      undeclaredReads: "blocked",
    });
    assert.equal(report.result.publishable, true);
    assert.equal(
      report.result.steps.some(({ arguments: toolArguments }) =>
        toolArguments.some((argument) => argument.includes(workspacePath))),
      false,
    );
    assert.equal(report.result.profile, "debug");
    assert.equal(report.result.target, "linux-x86_64-gnu");
    assert.match(report.result.buildIdentity.digest, /^sha256:[0-9a-f]{64}$/);
    assert.match(report.result.buildIdentity.buildInputSetDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(report.result.buildIdentity.toolchainClosureDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(report.result.buildIdentity.source_date_epoch, /^[1-9][0-9]*$/);
    assert.deepEqual(report.result.buildIdentity.options, {
      simdDispatch: "runtime-detected",
    });
    assert.equal(
      report.result.contractSetId,
      currentContractSetId,
    );
    assert.deepEqual(report.result.outputs, [
      "bin/tsfg-r00-cpp-smoke",
      "bin/tsfg-r00-zig-smoke",
      "build-metadata.json",
    ]);
    const metadataBytes = await readFile(path.join(outputPath, "build-metadata.json"), "utf8");
    const metadata = JSON.parse(metadataBytes);
    assert.equal(metadataBytes, `${JSON.stringify(metadata)}\n`);
    assert.deepEqual(metadata.buildIdentity, report.result.buildIdentity);
    assert.equal(metadata.development, false);
    assert.equal(metadata.dirty, false);
    assert.equal(metadata.publishable, true);
    assert.equal(metadata.buildInputSet.digest, report.result.buildIdentity.buildInputSetDigest);
    const { digest: buildInputSetDigest, ...buildInputSetPayload } = metadata.buildInputSet;
    assert.equal(buildInputSetDigest, fixtureDigest(JSON.stringify(buildInputSetPayload)));
    const { digest: buildIdentityDigest, ...buildIdentityPayload } = metadata.buildIdentity;
    assert.equal(buildIdentityDigest, fixtureDigest(JSON.stringify(buildIdentityPayload)));
    assert.deepEqual(
      metadata.buildInputSet.entries.map(({ projectId, repositoryRelativePath: inputPath }) => ({
        path: inputPath,
        projectId,
      })),
      JSON.parse(await readFile(path.join(workspacePath, "eng", "build-inputs.json"), "utf8")).entries,
    );
    assert.equal(
      metadata.buildInputSet.entries.some(({ repositoryRelativePath: inputPath }) =>
        inputPath.endsWith(".test.mjs") || inputPath.startsWith("docs/")),
      false,
    );
    const expectedEpoch = metadata.buildInputSet.entries.reduce((maximum, { repositoryRelativePath: inputPath }) => {
      const touched = spawnSync("git", ["log", "-1", "--format=%ct", "--", inputPath], {
        cwd: workspacePath,
        encoding: "utf8",
      });
      assert.equal(touched.status, 0, touched.stderr);
      return Math.max(maximum, Number.parseInt(touched.stdout.trim(), 10));
    }, 0);
    assert.equal(report.result.buildIdentity.source_date_epoch, String(expectedEpoch));
    for (const input of metadata.buildInputSet.entries) {
      const inputPath = input.repositoryRelativePath;
      assert.equal(
        input.sha256,
        fixtureDigest(await readFile(path.join(workspacePath, ...inputPath.split("/")))),
      );
      const indexed = spawnSync("git", ["ls-files", "--stage", "--", inputPath], {
        cwd: workspacePath,
        encoding: "utf8",
      });
      assert.equal(indexed.status, 0, indexed.stderr);
      assert.equal(input.normalizedMode, indexed.stdout.slice(0, 6));
    }
    for (const output of metadata.payloads) {
      assert.equal(
        output.sha256,
        fixtureDigest(await readFile(path.join(outputPath, ...output.path.split("/")))),
      );
    }
    assert.deepEqual(report.result.steps.map(({ tool }) => tool), ["cmake", "ninja", "zig", "zig"]);
    assert.match(report.result.steps[0].arguments.join(" "), /-O0/);
    assert.match(report.result.steps[0].arguments.join(" "), /-g3/);
    assert.match(report.result.steps[0].arguments.join(" "), /-UNDEBUG/);
    assert.match(report.result.steps[0].arguments.join(" "), /-ffile-prefix-map=/);
    assert.match(report.result.steps[0].arguments.join(" "), /-fdebug-prefix-map=/);
    assert.match(report.result.steps[0].arguments.join(" "), /-fmacro-prefix-map=/);
    const closureRoot = path.dirname(path.dirname(path.dirname(
      report.result.steps[0].executable,
    )));
    const cmakeInvocation = report.result.steps[0].arguments.join(" ");
    for (const kind of ["file", "debug", "macro"]) {
      assert.ok(
        cmakeInvocation.includes(`-f${kind}-prefix-map=${closureRoot}=.toolchain`),
        "debug paths must remap the verified closure",
      );
    }
    assert.match(
      report.result.steps[0].arguments.join(" "),
      /-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY/,
    );
    assert.match(report.result.steps[0].arguments.join(" "), /debian-sysroot/);
    assert.match(report.result.steps[0].arguments.join(" "), /llvm/);
    assert.match(report.result.steps[0].arguments.join(" "), /-DCMAKE_AR=/);
    assert.match(report.result.steps[2].arguments.join(" "), /-ODebug/);
    assert.match(report.result.steps[2].arguments.join(" "), /--zig-lib-dir .*zig[\\/]lib/);
    assert.match(report.result.steps[2].arguments.join(" "), /-fno-incremental/);
    assert.match(report.result.steps[3].arguments.join(" "), /build-exe .* -fentry=_start/);
  return { report, metadata };
}
