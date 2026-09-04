// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const acceptanceRoot = process.env.TSFG_WINDOWS_ACCEPTANCE_ROOT;
const closureCache = process.env.TSFG_WINDOWS_CLOSURE_CACHE;
const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function zipEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const time = bytes.readUInt16LE(offset + 10);
    const date = bytes.readUInt16LE(offset + 12);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataOffset = offset + 30 + nameLength + extraLength;
    assert.equal(method, 0, `${name} must use deterministic STORE compression`);
    entries.push({ bytes: bytes.subarray(dataOffset, dataOffset + size), date, mode: 0, name, time });
    offset = dataOffset + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  for (const entry of entries) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    assert.equal(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"), entry.name);
    entry.mode = bytes.readUInt32LE(offset + 38) >>> 16;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("Windows debug build, smoke test, and package share one normalized Build Identity", {
  skip: process.platform !== "win32" || !acceptanceRoot,
}, async () => {
  const buildRoot = path.join(acceptanceRoot, "tsfg-r00-win-build-final");
  const packageRoot = path.join(acceptanceRoot, "tsfg-r00-win-package-final");
  const [buildReport, testReport, packageReport] = await Promise.all([
    "tsfg-r00-win-build-final-report.json",
    "tsfg-r00-win-test-final-report.json",
    "tsfg-r00-win-package-final-report.json",
  ].map(async (name) => JSON.parse(await readFile(path.join(acceptanceRoot, name), "utf8"))));
  for (const report of [buildReport, testReport, packageReport]) {
    assert.equal(report.status, "success");
    assert.equal(report.network, "offline");
    assert.equal(report.result.networkCanary, "blocked");
    assert.deepEqual(report.result.networkIsolation, {
      mode: "wfp-dynamic-app-id",
      scope: "locked-process-set",
      status: "blocked",
    });
  }
  assert.deepEqual(testReport.result.tests, [
    { name: "cpp-smoke", status: "passed" },
    { name: "zig-smoke", status: "passed" },
  ]);
  assert.equal(buildReport.result.publishable, true);
  assert.deepEqual(buildReport.result.inputAudit, {
    mode: "materialized-build-input-set+restricted-token",
    scope: "repository-workspace",
    undeclaredReads: "blocked",
  });
  assert.deepEqual(buildReport.result.steps, [
    { role: "normative", tool: "cmake" },
    { role: "normative", tool: "ninja" },
    { role: "normative", tool: "zig" },
    { role: "compatibility-only", tool: "cl" },
    { role: "compatibility-only", tool: "link" },
  ]);
  assert.deepEqual(packageReport.result.buildIdentity, buildReport.result.buildIdentity);

  const files = await readdir(packageRoot);
  assert.deepEqual(files.sort(), [
    packageReport.result.archive,
    packageReport.result.checksums,
    packageReport.result.producerAttestation,
  ].sort());
  const producerAttestation = JSON.parse(await readFile(
    path.join(packageRoot, packageReport.result.producerAttestation),
    "utf8",
  ));
  assert.equal(producerAttestation.archive, packageReport.result.archive);
  assert.equal(producerAttestation.buildIdentityDigest, buildReport.result.buildIdentity.digest);
  assert.equal(producerAttestation.workspacePath, repositoryRoot);
  assert.deepEqual({
    initialState: producerAttestation.compilationCache.initialState,
    sharing: producerAttestation.compilationCache.sharing,
  }, { initialState: "empty", sharing: "none" });
  assert.ok(path.isAbsolute(producerAttestation.compilationCache.root));
  assert.equal(producerAttestation.toolchainClosure.objectVerification, "complete");
  const archiveBytes = await readFile(path.join(packageRoot, packageReport.result.archive));
  const checksums = JSON.parse(await readFile(path.join(packageRoot, packageReport.result.checksums), "utf8"));
  assert.equal(checksums.archive.sha256, sha256(archiveBytes));
  assert.deepEqual(checksums.buildIdentity, buildReport.result.buildIdentity);
  const entries = zipEntries(archiveBytes);
  assert.deepEqual(entries.map(({ name }) => name), [
    "artifact-manifest.json",
    "bin/tsfg-r00-cpp-smoke.exe",
    "bin/tsfg-r00-zig-smoke.exe",
    "contract-set.json",
    "symbols/tsfg-r00-cpp-smoke.pdb",
    "symbols/tsfg-r00-zig-smoke.pdb",
  ]);
  assert.deepEqual(entries.map(({ mode }) => mode), [0o644, 0o755, 0o755, 0o644, 0o644, 0o644]);
  assert.equal(new Set(entries.map(({ date, time }) => `${date}:${time}`)).size, 1);
  const manifestEntry = entries[0];
  const manifest = JSON.parse(manifestEntry.bytes.toString("utf8"));
  assert.equal(checksums.artifactManifest.sha256, sha256(manifestEntry.bytes));
  assert.deepEqual(manifest.buildIdentity, buildReport.result.buildIdentity);
  assert.deepEqual(manifest.members, entries.slice(1).map((entry) => ({
    path: entry.name,
    sha256: sha256(entry.bytes),
  })));
  for (const entry of entries) {
    assert.equal(entry.bytes.includes(Buffer.from(acceptanceRoot)), false, entry.name);
    assert.equal(entry.bytes.includes(Buffer.from(buildRoot)), false, entry.name);
    if (entry.name.endsWith(".pdb")) {
      assert.doesNotMatch(entry.bytes.toString("latin1"), /[A-Za-z]:[\\/]/, entry.name);
      assert.doesNotMatch(entry.bytes.toString("utf16le"), /[A-Za-z]:[\\/]/, entry.name);
    }
  }
});

test("Windows public build seam blocks network, PATH tools, and undeclared workspace reads", {
  skip: process.platform !== "win32" || !acceptanceRoot || !closureCache,
  timeout: 10 * 60 * 1000,
}, async () => {
  const root = await mkdtemp(path.join(acceptanceRoot, "tsfg-r00-windows-live-"));
  const launcher = path.join(repositoryRoot, "eng", "tsfg-build.cmd");
  const invoke = (arguments_, environment = {}) => spawnSync(launcher, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TSFG_CACHE_DIR: closureCache,
      ...environment,
    },
  });
  try {
    const poisonRoot = path.join(root, "poison-path");
    const poisonSentinel = path.join(root, "poison-ran");
    await mkdir(poisonRoot);
    for (const tool of ["clang-cl", "cmake", "git", "ninja", "node", "pnpm", "zig"]) {
      await writeFile(
        path.join(poisonRoot, `${tool}.cmd`),
        `@echo off\r\n>"${poisonSentinel}" echo poison\r\nexit /b 91\r\n`,
      );
    }
    const locatedGit = spawnSync("where.exe", ["git"], { encoding: "utf8" });
    assert.equal(locatedGit.status, 0, locatedGit.stderr);
    const gitDirectory = path.dirname(locatedGit.stdout.split(/\r?\n/).find(Boolean));
    const gitExecutable = path.join(gitDirectory, "git.exe");
    const gitDigest = sha256(await readFile(gitExecutable)).slice("sha256:".length);
    const isolatedPath = [poisonRoot, gitDirectory].join(path.delimiter);
    const buildRoot = path.join(root, "build");
    const buildReportPath = path.join(root, "build-report.json");
    const built = invoke([
      "build",
      "--target", "windows-x86_64-msvc",
      "--profile", "debug",
      "--workspace", repositoryRoot,
      "--out", buildRoot,
      "--report", buildReportPath,
    ], {
      PATH: isolatedPath,
      TSFG_BOOTSTRAP_GIT: gitExecutable,
      TSFG_BOOTSTRAP_GIT_SHA256: gitDigest,
    });
    assert.equal(built.status, 0, built.stderr);
    await assert.rejects(stat(poisonSentinel), /ENOENT/);
    const buildReport = JSON.parse(await readFile(buildReportPath, "utf8"));
    assert.equal(buildReport.result.networkCanary, "blocked");
    assert.deepEqual(buildReport.result.networkIsolation, {
      mode: "wfp-dynamic-app-id",
      scope: "locked-process-set",
      status: "blocked",
    });

    const testReportPath = path.join(root, "test-report.json");
    const tested = invoke([
      "test",
      "--target", "windows-x86_64-msvc",
      "--profile", "debug",
      "--workspace", repositoryRoot,
      "--out", buildRoot,
      "--report", testReportPath,
    ], {
      PATH: isolatedPath,
      TSFG_BOOTSTRAP_GIT: gitExecutable,
      TSFG_BOOTSTRAP_GIT_SHA256: gitDigest,
    });
    assert.equal(tested.status, 0, tested.stderr);

    const packageRoot = path.join(root, "package");
    const packageReportPath = path.join(root, "package-report.json");
    const packaged = invoke([
      "package",
      "--target", "windows-x86_64-msvc",
      "--profile", "debug",
      "--workspace", repositoryRoot,
      "--input", buildRoot,
      "--out", packageRoot,
      "--report", packageReportPath,
    ], {
      PATH: isolatedPath,
      TSFG_BOOTSTRAP_GIT: gitExecutable,
      TSFG_BOOTSTRAP_GIT_SHA256: gitDigest,
    });
    assert.equal(packaged.status, 0, packaged.stderr);

    const dirtyWorkspace = path.join(root, "dirty-workspace");
    const cloned = spawnSync("git", [
      "-c", "core.autocrlf=false", "clone", "--quiet", "--no-hardlinks",
      repositoryRoot, dirtyWorkspace,
    ], { encoding: "utf8" });
    assert.equal(cloned.status, 0, cloned.stderr);
    const undeclaredHeader = path.join(dirtyWorkspace, "undeclared-input.h");
    await writeFile(undeclaredHeader, "#define TSFG_UNDECLARED_INPUT 1\n");
    const smokeSource = path.join(dirtyWorkspace, "tests", "r00", "smoke", "cpp", "main.cpp");
    await writeFile(
      smokeSource,
      `#include ${JSON.stringify(undeclaredHeader.replaceAll("\\", "/"))}\n${await readFile(smokeSource, "utf8")}`,
    );
    const deniedOutput = path.join(root, "undeclared-output");
    const deniedReportPath = path.join(root, "undeclared-report.json");
    const denied = invoke([
      "build", "--dev",
      "--target", "windows-x86_64-msvc",
      "--profile", "debug",
      "--workspace", dirtyWorkspace,
      "--out", deniedOutput,
      "--report", deniedReportPath,
    ], {
      TSFG_BOOTSTRAP_GIT: gitExecutable,
      TSFG_BOOTSTRAP_GIT_SHA256: gitDigest,
    });
    assert.equal(denied.status, 12, denied.stderr);
    const deniedReport = JSON.parse(await readFile(deniedReportPath, "utf8"));
    assert.equal(deniedReport.error.category, "offline input missing");
    assert.equal(deniedReport.error.issues[0].code, "undeclared-build-input");
    await assert.rejects(stat(deniedOutput), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("Windows release build uses the safe release profile and x86-64-v2 baseline", {
  skip: process.platform !== "win32" || !closureCache,
  timeout: 10 * 60 * 1000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-r00-windows-release-"));
  try {
    const locatedGit = spawnSync("where.exe", ["git"], { encoding: "utf8" });
    assert.equal(locatedGit.status, 0, locatedGit.stderr);
    const gitExecutable = locatedGit.stdout.split(/\r?\n/).find(Boolean);
    const workspace = path.join(root, "workspace");
    const cloned = spawnSync(gitExecutable, [
      "-c", "core.autocrlf=false", "clone", "--quiet", "--no-hardlinks", repositoryRoot, workspace,
    ], { encoding: "utf8" });
    assert.equal(cloned.status, 0, cloned.stderr);
    const launcher = path.join(workspace, "eng", "tsfg-build.cmd");
    const gitDigest = sha256(await readFile(gitExecutable)).slice("sha256:".length);
    const invoke = (arguments_) => spawnSync(process.env.ComSpec, [
      "/d", "/c", launcher, ...arguments_,
    ], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        TSFG_BOOTSTRAP_GIT: gitExecutable,
        TSFG_BOOTSTRAP_GIT_SHA256: gitDigest,
        TSFG_CACHE_DIR: closureCache,
      },
    });
    const buildRoot = path.join(root, "build");
    const reportPath = path.join(root, "build-report.json");
    const built = invoke([
      "build",
      "--target", "windows-x86_64-msvc",
      "--profile", "release",
      "--workspace", workspace,
      "--out", buildRoot,
      "--report", reportPath,
    ]);
    assert.equal(built.status, 0, built.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.result.profile, "release");
    assert.deepEqual(report.result.buildPolicy, {
      cpuBaseline: "x86-64-v2",
      cxx: { assertions: true, debugInformation: "full", optimization: "/O2" },
      detachedSymbols: "package",
      forbidden: { fastMath: false, lto: false, nativeTuning: false, pgo: false },
      profile: "release",
      simd: {
        baselineFixture: "x86-64-v2",
        dispatch: "runtime-detected",
        higherFeatures: ["avx2"],
      },
      target: "windows-x86_64-msvc",
      zig: { optimization: "ReleaseSafe", safetyChecks: true },
    });
    for (const relative of [
      "bin/tsfg-r00-cpp-smoke.exe",
      "bin/tsfg-r00-zig-smoke.exe",
      "symbols/tsfg-r00-cpp-smoke.pdb",
      "symbols/tsfg-r00-zig-smoke.pdb",
    ]) assert.ok((await stat(path.join(buildRoot, ...relative.split("/")))).isFile());
    const testReportPath = path.join(root, "test-report.json");
    const tested = invoke([
      "test",
      "--target", "windows-x86_64-msvc",
      "--profile", "release",
      "--cpu-fixture", "x86-64-v2",
      "--workspace", workspace,
      "--out", buildRoot,
      "--report", testReportPath,
    ]);
    assert.equal(tested.status, 0, tested.stderr);
    const testReport = JSON.parse(await readFile(testReportPath, "utf8"));
    assert.equal(testReport.result.cpuFixture, "x86-64-v2");
    assert.deepEqual(testReport.result.tests, [
      { name: "cpp-smoke", status: "passed" },
      { name: "cpp-smoke-baseline-fallback", status: "passed" },
      { name: "zig-smoke", status: "passed" },
    ]);
    const packageRoot = path.join(root, "package");
    const packageReportPath = path.join(root, "package-report.json");
    const packaged = invoke([
      "package",
      "--target", "windows-x86_64-msvc",
      "--profile", "release",
      "--workspace", workspace,
      "--input", buildRoot,
      "--out", packageRoot,
      "--report", packageReportPath,
    ]);
    assert.equal(packaged.status, 0, packaged.stderr);
    const packageReport = JSON.parse(await readFile(packageReportPath, "utf8"));
    assert.deepEqual(packageReport.result.buildPolicy, report.result.buildPolicy);
    assert.deepEqual(packageReport.result.buildIdentity, report.result.buildIdentity);
    const archiveBytes = await readFile(path.join(packageRoot, packageReport.result.archive));
    const entries = zipEntries(archiveBytes);
    const manifest = JSON.parse(entries[0].bytes.toString("utf8"));
    assert.deepEqual(manifest.buildPolicy, report.result.buildPolicy);
    assert.deepEqual(manifest.buildIdentity, report.result.buildIdentity);
    const checksums = JSON.parse(await readFile(
      path.join(packageRoot, packageReport.result.checksums),
      "utf8",
    ));
    assert.equal(checksums.archive.sha256, sha256(archiveBytes));
    assert.equal(checksums.artifactManifest.sha256, sha256(entries[0].bytes));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
