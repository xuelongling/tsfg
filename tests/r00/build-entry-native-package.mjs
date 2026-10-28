// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { currentContractSetCanonical } from "./contract-compatibility-fixtures.mjs";
import { invoke } from "./build-entry-invocation.mjs";
import { repositoryRoot, networkDenialHook } from "./build-entry-paths.mjs";
import { parseTarArchive, fixtureDigest } from "./build-entry-fixtures.mjs";

export async function verifyIndependentPackages(sandbox, report, metadata) {
  const workspacePath = path.join(sandbox, "workspace");
  const outputPath = path.join(sandbox, "out");
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");


    const packageOutput = path.join(sandbox, "package");
    const packageReportPath = path.join(sandbox, "package-report.json");
    const packaged = await invoke([
      "package",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--input", outputPath,
      "--out", packageOutput,
      "--report", packageReportPath,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(packaged.status, 0, packaged.stderr);
    assert.equal(packaged.stdout, "");
    const packageReport = JSON.parse(await readFile(packageReportPath, "utf8"));
    assert.deepEqual(packageReport.result.buildIdentity, report.result.buildIdentity);
    assert.equal(packageReport.result.networkCanary, "blocked");
    assert.equal(packageReport.result.producerAttestation, "producer-attestation.json");
    const producerAttestationBytes = await readFile(
      path.join(packageOutput, packageReport.result.producerAttestation),
      "utf8",
    );
    const producerAttestation = JSON.parse(producerAttestationBytes);
    assert.equal(producerAttestationBytes, `${JSON.stringify(producerAttestation)}\n`);
    assert.match(producerAttestation.buildExecutionId, /^[0-9a-f-]{36}$/);
    assert.ok(path.isAbsolute(producerAttestation.compilationCache.root));
    assert.deepEqual({
      ...producerAttestation,
      buildExecutionId: "<build-execution-id>",
      compilationCache: {
        ...producerAttestation.compilationCache,
        root: "<fresh-compilation-root>",
      },
    }, {
      archive: packageReport.result.archive,
      buildExecutionId: "<build-execution-id>",
      buildIdentityDigest: report.result.buildIdentity.digest,
      compilationCache: {
        initialState: "empty",
        root: "<fresh-compilation-root>",
        sharing: "none",
      },
      pathCanonicalization: "realpath",
      profile: "debug",
      schemaVersion: "1",
      target: "linux-x86_64-gnu",
      toolchainClosure: {
        cacheAddressing: "sha256",
        digest: report.result.buildIdentity.toolchainClosureDigest,
        objectVerification: "complete",
      },
      workspacePath,
    });
    const secondWorkspacePath = path.join(sandbox, "workspace-independent");
    const secondClone = spawnSync(
      "git",
      ["-c", "core.autocrlf=false", "clone", "--quiet", "--no-hardlinks", repositoryRoot, secondWorkspacePath],
      { encoding: "utf8" },
    );
    assert.equal(secondClone.status, 0, secondClone.stderr);
    const secondBuildOutput = path.join(sandbox, "independent-build");
    const secondBuildReportPath = path.join(sandbox, "independent-build-report.json");
    const independentEnvironment = {
      ...process.env,
      CI_RUN_ID: "independent-producer-ci-run",
      NODE_OPTIONS: `--require=${networkDenialHook}`,
      TSFG_RUNTIME_CACHE: cachePath,
      TSFG_RUNTIME_LOCK: lockPath,
      TSFG_RUNTIME_PLATFORM: "test-x86_64",
      TZ: "Pacific/Kiritimati",
    };
    const secondBuild = await invoke([
      "build",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", secondWorkspacePath,
      "--out", secondBuildOutput,
      "--report", secondBuildReportPath,
    ], { env: independentEnvironment });
    assert.equal(secondBuild.status, 0, secondBuild.stderr);
    const independentMetadataPath = path.join(secondBuildOutput, "build-metadata.json");
    const independentMetadata = JSON.parse(await readFile(independentMetadataPath, "utf8"));
    independentMetadata.payloads.reverse();
    await writeFile(independentMetadataPath, `${JSON.stringify(independentMetadata)}\n`);
    const secondPackageOutput = path.join(sandbox, "independent-package");
    const secondPackageReportPath = path.join(sandbox, "independent-package-report.json");
    const secondPackage = await invoke([
      "package",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", secondWorkspacePath,
      "--input", secondBuildOutput,
      "--out", secondPackageOutput,
      "--report", secondPackageReportPath,
    ], { env: independentEnvironment });
    assert.equal(secondPackage.status, 0, secondPackage.stderr);
    const secondPackageReport = JSON.parse(await readFile(secondPackageReportPath, "utf8"));
    assert.deepEqual(secondPackageReport.result.buildIdentity, packageReport.result.buildIdentity);
    const reproReportPath = path.join(sandbox, "repro-report.json");
    const compared = await invoke([
      "repro-check",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--producer-a", packageOutput,
      "--producer-b", secondPackageOutput,
      "--workspace", secondWorkspacePath,
      "--report", reproReportPath,
    ], { env: independentEnvironment });
    assert.equal(compared.status, 0, compared.stderr);
    const reproReport = JSON.parse(await readFile(reproReportPath, "utf8"));
    assert.equal(reproReport.result.buildExecuted, false);
    assert.deepEqual(
      reproReport.result.producers.map(({ workspacePath: producerWorkspace }) => producerWorkspace),
      [workspacePath, secondWorkspacePath],
    );
    assert.equal(reproReport.result.buildIdentity.digest, packageReport.result.buildIdentity.digest);
    const archivePath = path.join(packageOutput, packageReport.result.archive);
    const archiveBytes = await readFile(archivePath);
    const archiveEntries = parseTarArchive(zstdDecompressSync(archiveBytes));
    assert.deepEqual(archiveEntries.map(({ name }) => name), [
      "artifact-manifest.json",
      "bin/tsfg-r00-cpp-smoke",
      "bin/tsfg-r00-zig-smoke",
      "contract-set.json",
      "symbols/tsfg-r00-cpp-smoke.debug",
      "symbols/tsfg-r00-zig-smoke.debug",
    ]);
    for (const entry of archiveEntries) {
      assert.equal(entry.uid, 0);
      assert.equal(entry.gid, 0);
      assert.equal(entry.mtime, Number(report.result.buildIdentity.source_date_epoch));
      assert.equal(entry.mode, entry.name.startsWith("bin/") ? 0o755 : 0o644);
    }
    const entriesByName = new Map(archiveEntries.map((entry) => [entry.name, entry]));
    assert.equal(entriesByName.get("contract-set.json").bytes.toString("utf8"), currentContractSetCanonical);
    const manifestBytes = entriesByName.get("artifact-manifest.json").bytes;
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    assert.equal(manifestBytes.toString("utf8"), JSON.stringify(manifest));
    assert.deepEqual(manifest.buildIdentity, report.result.buildIdentity);
    assert.deepEqual(manifest.buildInputSet, metadata.buildInputSet);
    assert.equal(manifest.contractSetId, report.result.contractSetId);
    assert.equal(manifest.toolchainClosureDigest, report.result.buildIdentity.toolchainClosureDigest);
    assert.equal(manifest.members.some(({ path: memberPath }) => memberPath === "artifact-manifest.json"), false);
    assert.deepEqual(
      manifest.members.map(({ path: memberPath }) => memberPath),
      archiveEntries.slice(1).map(({ name }) => name),
    );
    for (const member of manifest.members) {
      assert.equal(member.sha256, fixtureDigest(entriesByName.get(member.path).bytes));
    }
    const checksums = JSON.parse(await readFile(
      path.join(packageOutput, packageReport.result.checksums),
      "utf8",
    ));
    assert.deepEqual(checksums, {
      archive: { name: packageReport.result.archive, sha256: fixtureDigest(archiveBytes) },
      artifactManifest: {
        path: "artifact-manifest.json",
        sha256: fixtureDigest(manifestBytes),
      },
      schemaVersion: "1",
    });
    assert.equal(manifestBytes.includes(Buffer.from(packageReport.result.archive)), false);
    assert.equal(manifestBytes.includes(Buffer.from(packageReport.result.checksums)), false);
    assert.equal(
      JSON.stringify(checksums).includes(packageReport.result.checksums),
      false,
      "external checksums must not hash themselves",
    );
    for (const [failurePoint, expectedStatus] of [
      ["output-version", 22],
      ["output-link", 22],
      ["output-swapped", 22],
      ["report-before-rename", 30],
    ]) {
      const injectedOutput = path.join(sandbox, `injected-${failurePoint}`);
      const injectedReport = path.join(sandbox, `injected-${failurePoint}.json`);
      const injected = await invoke([
        "package",
        "--target", "linux-x86_64-gnu",
        "--profile", "debug",
        "--workspace", workspacePath,
        "--input", outputPath,
        "--out", injectedOutput,
        "--report", injectedReport,
      ], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${networkDenialHook}`,
          TSFG_RUNTIME_CACHE: cachePath,
          TSFG_RUNTIME_LOCK: lockPath,
          TSFG_RUNTIME_PLATFORM: "test-x86_64",
          TSFG_TEST_FAIL_PUBLISH_AT: failurePoint,
        },
      });
      assert.equal(injected.status, expectedStatus, injected.stderr);
      await assert.rejects(lstat(injectedOutput), /ENOENT/);
      if (failurePoint === "report-before-rename") {
        await assert.rejects(lstat(injectedReport), /ENOENT/);
      } else {
        const failureReport = JSON.parse(await readFile(injectedReport, "utf8"));
        assert.equal(failureReport.status, "failure");
        assert.equal(failureReport.error.code, "22");
      }
    }
    for (const forbidden of [
      repositoryRoot,
      cachePath,
      sandbox,
      outputPath,
      packageOutput,
      "ticket07-ci-run-id",
    ]) {
      const encoded = Buffer.from(forbidden);
      assert.equal(
        archiveEntries.some(({ bytes }) => bytes.includes(encoded)),
        false,
        `package payload must not contain ${JSON.stringify(forbidden)}`,
      );
    }
  return { packageReport, archiveBytes };
}
