// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildEntry = path.join(repositoryRoot, "eng", "tsfg-build.mjs");
const networkDenialHook = path.join(repositoryRoot, "tests", "r00", "deny-network.cjs");
const TOOLCHAIN_DIGEST = `sha256:${"2".repeat(64)}`;
let comparatorWorkspaceContainer;
let comparatorWorkspace;

test.before(async () => {
  comparatorWorkspaceContainer = await mkdtemp(path.join(tmpdir(), "tsfg-repro-comparator-"));
  comparatorWorkspace = path.join(comparatorWorkspaceContainer, "workspace");
  await mkdir(comparatorWorkspace);
  assert.equal(spawnSync("git", ["init", "--quiet"], {
    cwd: comparatorWorkspace,
    encoding: "utf8",
  }).status, 0);
  await writeFile(path.join(comparatorWorkspace, "README.md"), "comparator fixture\n");
  for (const arguments_ of [
    ["config", "user.name", "tsfg test"],
    ["config", "user.email", "test@tsfg.invalid"],
    ["add", "README.md"],
    ["commit", "--quiet", "-m", "fixture"],
  ]) {
    const result = spawnSync("git", arguments_, { cwd: comparatorWorkspace, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});

test.after(async () => {
  await rm(comparatorWorkspaceContainer, { recursive: true, force: true });
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixtureBuildIdentity(
  target,
  profile,
  buildInputSetDigest = sha256('{"entries":[],"schemaVersion":"1"}'),
) {
  const payload = {
    buildInputSetDigest,
    options: { simdDispatch: "runtime-detected" },
    profile,
    source_date_epoch: "1700000000",
    target,
    toolchainClosureDigest: TOOLCHAIN_DIGEST,
  };
  return {
    buildInputSetDigest: payload.buildInputSetDigest,
    digest: sha256(JSON.stringify(payload)),
    options: payload.options,
    profile: payload.profile,
    source_date_epoch: payload.source_date_epoch,
    target: payload.target,
    toolchainClosureDigest: payload.toolchainClosureDigest,
  };
}

const FIXTURE_DIGEST = fixtureBuildIdentity("windows-x86_64-msvc", "debug").digest;

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const date = new Date(1700000000 * 1000);
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5)
    | Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5)
    | date.getUTCDate();
  for (const entry of [...entries].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))) {
    const name = Buffer.from(entry.path);
    const checksum = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((entry.mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, entry.bytes);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.bytes.length;
  }
  const directory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

function tarNumber(value, length) {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function createTar(entries, metadata = {}) {
  const chunks = [];
  for (const entry of [...entries].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))) {
    const header = Buffer.alloc(512);
    Buffer.from(entry.path).copy(header, 0);
    header.write(tarNumber(entry.mode, 8), 100, "ascii");
    header.write(tarNumber(metadata.uid ?? 0, 8), 108, "ascii");
    header.write(tarNumber(metadata.gid ?? 0, 8), 116, "ascii");
    header.write(tarNumber(entry.bytes.length, 12), 124, "ascii");
    header.write(tarNumber(metadata.mtime ?? 1700000000, 12), 136, "ascii");
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    header.write(tarNumber(0, 8), 329, "ascii");
    header.write(tarNumber(0, 8), 337, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    chunks.push(header, entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

async function writeWindowsProducer(
  root,
  workspacePath,
  cppPayload = "cpp payload\n",
  evidence = {},
  profile = "debug",
) {
  await mkdir(root, { recursive: true });
  const target = "windows-x86_64-msvc";
  const buildInputEntries = evidence.buildInputEntries ?? [];
  const buildInputSetDigest = sha256(JSON.stringify({
    entries: buildInputEntries,
    schemaVersion: "1",
  }));
  const derivedIdentity = fixtureBuildIdentity(target, profile, buildInputSetDigest);
  const buildIdentityDigest = evidence.identityDigest ?? derivedIdentity.digest;
  const buildIdentity = { ...derivedIdentity, digest: buildIdentityDigest };
  const members = [
    { bytes: Buffer.from(cppPayload), mode: evidence.cppMode ?? 0o755, path: "bin/tsfg-r00-cpp-smoke.exe" },
    { bytes: Buffer.from("zig payload\n"), mode: 0o755, path: "bin/tsfg-r00-zig-smoke.exe" },
    {
      bytes: Buffer.from(JSON.stringify(evidence.contractSet ?? {})),
      mode: 0o644,
      path: "contract-set.json",
    },
    { bytes: Buffer.from("debug symbols\n"), mode: 0o644, path: "symbols/tsfg-r00-cpp-smoke.pdb" },
    { bytes: Buffer.from("zig debug symbols\n"), mode: 0o644, path: "symbols/tsfg-r00-zig-smoke.pdb" },
  ];
  const artifactManifest = Buffer.from(JSON.stringify({
    buildIdentity,
    buildInputSet: {
      digest: buildIdentity.buildInputSetDigest,
      entries: buildInputEntries,
      schemaVersion: "1",
    },
    contractSetId: sha256(JSON.stringify(evidence.contractSet ?? {})),
    members: members.map((member) => ({ path: member.path, sha256: sha256(member.bytes) })),
    productVersion: "0.1.0-dev.0",
    schemaVersion: "1",
    toolchainClosureDigest: TOOLCHAIN_DIGEST,
  }));
  const archive = createZip([
    { bytes: artifactManifest, mode: 0o644, path: "artifact-manifest.json" },
    ...members,
  ]);
  const archiveName = `tsfg-v0.1.0-dev.0-${target}-${profile}-${buildIdentityDigest.slice(7, 23)}.zip`;
  await writeFile(path.join(root, archiveName), archive);
  await writeFile(path.join(root, `${archiveName}.checksums.json`), `${JSON.stringify({
    archive: { name: archiveName, sha256: sha256(archive) },
    artifactManifest: { path: "artifact-manifest.json", sha256: sha256(artifactManifest) },
    schemaVersion: "1",
  })}\n`);
  await writeFile(path.join(root, "producer-attestation.json"), `${JSON.stringify({
    archive: archiveName,
    buildExecutionId: evidence.buildExecutionId ?? sha256(workspacePath),
    buildIdentityDigest,
    compilationCache: {
      initialState: evidence.initialState ?? "empty",
      root: evidence.cacheRoot ?? path.join(workspacePath, ".empty-build-cache"),
      sharing: evidence.sharing ?? "none",
    },
    pathCanonicalization: "realpath",
    profile,
    schemaVersion: "1",
    target,
    toolchainClosure: {
      cacheAddressing: "sha256",
      digest: TOOLCHAIN_DIGEST,
      objectVerification: evidence.objectVerification ?? "complete",
    },
    workspacePath,
  })}\n`);
}

async function writeLinuxProducer(root, workspacePath, profile, archiveMetadata = {}) {
  await mkdir(root, { recursive: true });
  const target = "linux-x86_64-gnu";
  const buildIdentity = fixtureBuildIdentity(target, profile);
  const buildIdentityDigest = buildIdentity.digest;
  const members = [
    { bytes: Buffer.from("cpp payload\n"), mode: 0o755, path: "bin/tsfg-r00-cpp-smoke" },
    { bytes: Buffer.from("zig payload\n"), mode: 0o755, path: "bin/tsfg-r00-zig-smoke" },
    { bytes: Buffer.from("{}"), mode: 0o644, path: "contract-set.json" },
    { bytes: Buffer.from("cpp symbols\n"), mode: 0o644, path: "symbols/tsfg-r00-cpp-smoke.debug" },
    { bytes: Buffer.from("zig symbols\n"), mode: 0o644, path: "symbols/tsfg-r00-zig-smoke.debug" },
  ];
  const artifactManifest = Buffer.from(JSON.stringify({
    buildIdentity,
    buildInputSet: { digest: buildIdentity.buildInputSetDigest, entries: [], schemaVersion: "1" },
    contractSetId: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    members: members.map((member) => ({ path: member.path, sha256: sha256(member.bytes) })),
    productVersion: "0.1.0-dev.0",
    schemaVersion: "1",
    toolchainClosureDigest: TOOLCHAIN_DIGEST,
  }));
  const archive = zstdCompressSync(createTar([
    { bytes: artifactManifest, mode: 0o644, path: "artifact-manifest.json" },
    ...members,
  ], archiveMetadata));
  const archiveName = `tsfg-v0.1.0-dev.0-${target}-${profile}-${buildIdentityDigest.slice(7, 23)}.tar.zst`;
  await writeFile(path.join(root, archiveName), archive);
  await writeFile(path.join(root, `${archiveName}.checksums.json`), `${JSON.stringify({
    archive: { name: archiveName, sha256: sha256(archive) },
    artifactManifest: { path: "artifact-manifest.json", sha256: sha256(artifactManifest) },
    schemaVersion: "1",
  })}\n`);
  await writeFile(path.join(root, "producer-attestation.json"), `${JSON.stringify({
    archive: archiveName,
    buildExecutionId: sha256(workspacePath),
    buildIdentityDigest,
    compilationCache: {
      initialState: "empty",
      root: path.join(workspacePath, ".empty-build-cache"),
      sharing: "none",
    },
    pathCanonicalization: "realpath",
    profile,
    schemaVersion: "1",
    target,
    toolchainClosure: {
      cacheAddressing: "sha256",
      digest: TOOLCHAIN_DIGEST,
      objectVerification: "complete",
    },
    workspacePath,
  })}\n`);
}

async function invoke(arguments_) {
  return await new Promise((resolve, reject) => {
    const completeArguments = arguments_[0] === "repro-check" && !arguments_.includes("--workspace")
      ? [...arguments_, "--workspace", comparatorWorkspace]
      : arguments_;
    const child = spawn(process.execPath, [buildEntry, ...completeArguments], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
        TSFG_GIT: TEST_GIT_EXECUTABLE,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("repro-check independently accepts identical Windows debug Reproducibility Sets", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-check-"));
  const first = path.join(sandbox, "producer-a");
  const second = path.join(sandbox, "producer-b");
  const reportPath = path.join(sandbox, "report.json");
  try {
    await writeWindowsProducer(first, path.join(sandbox, "workspace-a"));
    await writeWindowsProducer(second, path.join(sandbox, "workspace-b"));

    const result = await invoke([
      "repro-check",
      "--target", "windows-x86_64-msvc",
      "--profile", "debug",
      "--producer-a", first,
      "--producer-b", second,
      "--report", reportPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "success");
    assert.equal(report.result.buildExecuted, false);
    assert.equal(report.result.buildIdentity.digest, FIXTURE_DIGEST);
    assert.equal(report.result.target, "windows-x86_64-msvc");
    assert.equal(report.result.profile, "debug");
    assert.deepEqual(report.result.excludedSidecars, [
      "build-report",
      "external-attestation",
      "log",
      "signature",
      "trusted-timestamp",
    ]);
    assert.match(report.result.reproducibilitySetDigest, /^sha256:[0-9a-f]{64}$/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("public launcher recognizes the repro-check comparator before loading its runtime", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-launcher-"));
  const reportPath = path.join(sandbox, "report.json");
  const arguments_ = [
    "repro-check",
    "--target", process.platform === "win32" ? "windows-x86_64-msvc" : "linux-x86_64-gnu",
    "--profile", "debug",
    "--producer-a", path.join(sandbox, "producer-a"),
    "--producer-b", path.join(sandbox, "producer-b"),
    "--workspace", comparatorWorkspace,
    "--report", reportPath,
  ];
  try {
    const result = process.platform === "win32"
      ? spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repositoryRoot, "eng", "tsfg-build.cmd"), ...arguments_], {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, TSFG_CACHE_DIR: path.join(sandbox, "missing-cache") },
        })
      : spawnSync(path.join(repositoryRoot, "eng", "tsfg-build"), arguments_, {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: { ...process.env, TSFG_CACHE_DIR: path.join(sandbox, "missing-cache") },
        });
    assert.equal(result.status, 11, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.command, "repro-check");
    assert.equal(report.error.category, "lock/integrity");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("repro-check rejects a dirty comparator workspace", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-dirty-comparator-"));
  const first = path.join(sandbox, "producer-a");
  const second = path.join(sandbox, "producer-b");
  const dirtyFile = path.join(comparatorWorkspace, "dirty.txt");
  const reportPath = path.join(sandbox, "report.json");
  try {
    await writeWindowsProducer(first, path.join(sandbox, "workspace-a"));
    await writeWindowsProducer(second, path.join(sandbox, "workspace-b"));
    await writeFile(dirtyFile, "dirty\n");
    const result = await invoke([
      "repro-check", "--target", "windows-x86_64-msvc", "--profile", "debug",
      "--producer-a", first, "--producer-b", second, "--report", reportPath,
    ]);
    assert.equal(result.status, 10, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.category, "workspace mismatch");
    assert.equal(report.error.issues[0].code, "dirty-project");
  } finally {
    await rm(dirtyFile, { force: true });
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("repro-check covers both Tier 1 targets in debug and release", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-matrix-"));
  try {
    for (const target of ["windows-x86_64-msvc", "linux-x86_64-gnu"]) {
      for (const profile of ["debug", "release"]) {
        const key = `${target}-${profile}`;
        const first = path.join(sandbox, `${key}-a`);
        const second = path.join(sandbox, `${key}-b`);
        if (target === "windows-x86_64-msvc") {
          await writeWindowsProducer(first, path.join(sandbox, `${key}-workspace-a`), "cpp payload\n", {}, profile);
          await writeWindowsProducer(second, path.join(sandbox, `${key}-workspace-b`), "cpp payload\n", {}, profile);
        } else {
          await writeLinuxProducer(first, path.join(sandbox, `${key}-workspace-a`), profile);
          await writeLinuxProducer(second, path.join(sandbox, `${key}-workspace-b`), profile);
        }
        const reportPath = path.join(sandbox, `${key}-report.json`);
        const result = await invoke([
          "repro-check", "--target", target, "--profile", profile,
          "--producer-a", first, "--producer-b", second, "--report", reportPath,
        ]);
        assert.equal(result.status, 0, `${key}: ${result.stderr}`);
      }
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("repro-check rejects producers that do not prove independent empty build state", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-independence-"));
  const reportPath = path.join(sandbox, "report.json");
  const scenarios = [
    {
      name: "same workspace",
      firstWorkspace: path.join(sandbox, "shared-workspace"),
      secondWorkspace: path.join(sandbox, "shared-workspace"),
      secondEvidence: {},
    },
    {
      name: "shared compilation cache",
      firstWorkspace: path.join(sandbox, "workspace-a"),
      secondWorkspace: path.join(sandbox, "workspace-b"),
      firstEvidence: { cacheRoot: path.join(sandbox, "shared-cache") },
      secondEvidence: { cacheRoot: path.join(sandbox, "shared-cache") },
    },
    {
      name: "Windows path alias differs only by case",
      firstWorkspace: path.join(sandbox, "case-workspace"),
      secondWorkspace: path.join(sandbox, "case-workspace").toUpperCase(),
      firstEvidence: {},
      secondEvidence: {},
    },
    {
      name: "reused build execution",
      firstWorkspace: path.join(sandbox, "workspace-a"),
      secondWorkspace: path.join(sandbox, "workspace-b"),
      firstEvidence: { buildExecutionId: "same-execution" },
      secondEvidence: { buildExecutionId: "same-execution" },
    },
    {
      name: "warm incremental cache",
      firstWorkspace: path.join(sandbox, "workspace-a"),
      secondWorkspace: path.join(sandbox, "workspace-b"),
      secondEvidence: { initialState: "warm" },
    },
    {
      name: "unverified tool objects",
      firstWorkspace: path.join(sandbox, "workspace-a"),
      secondWorkspace: path.join(sandbox, "workspace-b"),
      secondEvidence: { objectVerification: "assumed" },
    },
  ];
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const first = path.join(sandbox, `producer-a-${index}`);
      const second = path.join(sandbox, `producer-b-${index}`);
      await writeWindowsProducer(first, scenario.firstWorkspace, "cpp payload\n", scenario.firstEvidence);
      await writeWindowsProducer(second, scenario.secondWorkspace, "cpp payload\n", scenario.secondEvidence);
      const result = await invoke([
        "repro-check",
        "--target", "windows-x86_64-msvc",
        "--profile", "debug",
        "--producer-a", first,
        "--producer-b", second,
        "--report", reportPath,
      ]);
      assert.equal(result.status, 23, `${scenario.name}: ${result.stderr}`);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, "producer-independence", scenario.name);
      assert.equal(report.error.issues[0].member, "producer-attestation.json", scenario.name);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("repro-check independently derives rather than trusts the claimed Build Identity", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-identity-"));
  const first = path.join(sandbox, "producer-a");
  const second = path.join(sandbox, "producer-b");
  const reportPath = path.join(sandbox, "report.json");
  try {
    const forged = `sha256:${"f".repeat(64)}`;
    await writeWindowsProducer(first, path.join(sandbox, "workspace-a"), "cpp payload\n", { identityDigest: forged });
    await writeWindowsProducer(second, path.join(sandbox, "workspace-b"), "cpp payload\n", { identityDigest: forged });
    const result = await invoke([
      "repro-check", "--target", "windows-x86_64-msvc", "--profile", "debug",
      "--producer-a", first, "--producer-b", second, "--report", reportPath,
    ]);
    assert.equal(result.status, 23, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.issues[0].code, "build-identity-mismatch");
    assert.equal(report.error.issues[0].member, "artifact-manifest.json#buildIdentity");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("repro-check rejects non-canonical Build Input entries and a non-empty R00 Contract Set", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-canonical-inputs-"));
  const scenarios = [
    {
      name: "invalid normalized mode",
      evidence: {
        buildInputEntries: [{
          normalizedMode: "100777",
          projectId: "tsfg",
          repositoryRelativePath: "eng/tsfg-build.mjs",
          sha256: `sha256:${"7".repeat(64)}`,
        }],
      },
      code: "build-identity-mismatch",
      member: "artifact-manifest.json#buildInputSet",
    },
    {
      name: "unsorted Build Input entries",
      evidence: {
        buildInputEntries: [
          {
            normalizedMode: "100644",
            projectId: "tsfg",
            repositoryRelativePath: "z-last",
            sha256: `sha256:${"8".repeat(64)}`,
          },
          {
            normalizedMode: "100644",
            projectId: "tsfg",
            repositoryRelativePath: "a-first",
            sha256: `sha256:${"9".repeat(64)}`,
          },
        ],
      },
      code: "build-identity-mismatch",
      member: "artifact-manifest.json#buildInputSet",
    },
    {
      name: "invented contract family",
      evidence: { contractSet: { invented: { version: "1.0.0" } } },
      code: "member-mismatch",
      member: "contract-set.json",
    },
  ];
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const first = path.join(sandbox, `producer-a-${index}`);
      const second = path.join(sandbox, `producer-b-${index}`);
      await writeWindowsProducer(first, path.join(sandbox, `workspace-a-${index}`), "cpp payload\n", scenario.evidence);
      await writeWindowsProducer(second, path.join(sandbox, `workspace-b-${index}`), "cpp payload\n", scenario.evidence);
      const reportPath = path.join(sandbox, `report-${index}.json`);
      const result = await invoke([
        "repro-check", "--target", "windows-x86_64-msvc", "--profile", "debug",
        "--producer-a", first, "--producer-b", second, "--report", reportPath,
      ]);
      assert.equal(result.status, 23, `${scenario.name}: ${result.stderr}`);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, scenario.code, scenario.name);
      assert.equal(report.error.issues[0].member, scenario.member, scenario.name);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("repro-check excludes only identified sidecars from byte comparison", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-sidecars-"));
  const first = path.join(sandbox, "producer-a");
  const second = path.join(sandbox, "producer-b");
  const reportPath = path.join(sandbox, "report.json");
  try {
    await writeWindowsProducer(first, path.join(sandbox, "workspace-a"));
    await writeWindowsProducer(second, path.join(sandbox, "workspace-b"));
    for (const [name, left, right] of [
      ["build-report.json", "host a report", "host b report"],
      ["producer.log", "host a log", "host b log"],
      ["release.sig", "signature a", "signature b"],
      ["release.trusted-timestamp.json", "timestamp a", "timestamp b"],
      ["release.attestation.json", "attestation a", "attestation b"],
    ]) {
      await writeFile(path.join(first, name), left);
      await writeFile(path.join(second, name), right);
    }
    const arguments_ = [
      "repro-check", "--target", "windows-x86_64-msvc", "--profile", "debug",
      "--producer-a", first, "--producer-b", second, "--report", reportPath,
    ];
    const accepted = await invoke(arguments_);
    assert.equal(accepted.status, 0, accepted.stderr);
    const acceptedReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.deepEqual(acceptedReport.result.observedSidecars.a, [
      { kind: "build-report", path: "build-report.json" },
      { kind: "external-attestation", path: "producer-attestation.json" },
      { kind: "log", path: "producer.log" },
      { kind: "external-attestation", path: "release.attestation.json" },
      { kind: "signature", path: "release.sig" },
      { kind: "trusted-timestamp", path: "release.trusted-timestamp.json" },
    ]);

    await writeFile(path.join(second, "unsigned-extra.bin"), "unclassified payload");
    const rejected = await invoke(arguments_);
    assert.equal(rejected.status, 23, rejected.stderr);
    const rejectedReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(rejectedReport.error.issues[0].code, "unexpected-bundle-member");
    assert.equal(rejectedReport.error.issues[0].member, "unsigned-extra.bin");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("repro-check rejects identically non-canonical archive ownership, modes, and timestamps", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-normalization-"));
  const scenarios = [
    {
      name: "Windows executable mode",
      target: "windows-x86_64-msvc",
      write: (root, workspacePath) => writeWindowsProducer(root, workspacePath, "cpp payload\n", { cppMode: 0o644 }),
      member: "bin/tsfg-r00-cpp-smoke.exe",
    },
    {
      name: "Linux ownership",
      target: "linux-x86_64-gnu",
      write: (root, workspacePath) => writeLinuxProducer(root, workspacePath, "debug", { uid: 1000 }),
      member: "artifact-manifest.json",
    },
    {
      name: "Linux timestamp",
      target: "linux-x86_64-gnu",
      write: (root, workspacePath) => writeLinuxProducer(root, workspacePath, "debug", { mtime: 1700000001 }),
      member: "artifact-manifest.json",
    },
  ];
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const first = path.join(sandbox, `producer-a-${index}`);
      const second = path.join(sandbox, `producer-b-${index}`);
      await scenario.write(first, path.join(sandbox, `workspace-a-${index}`));
      await scenario.write(second, path.join(sandbox, `workspace-b-${index}`));
      const reportPath = path.join(sandbox, `report-${index}.json`);
      const result = await invoke([
        "repro-check", "--target", scenario.target, "--profile", "debug",
        "--producer-a", first, "--producer-b", second, "--report", reportPath,
      ]);
      assert.equal(result.status, 23, `${scenario.name}: ${result.stderr}`);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, "archive-normalization", scenario.name);
      assert.equal(report.error.issues[0].member, scenario.member, scenario.name);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("repro-check returns category 23 and the smallest differing payload member", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-repro-mismatch-"));
  const first = path.join(sandbox, "producer-a");
  const second = path.join(sandbox, "producer-b");
  const reportPath = path.join(sandbox, "report.json");
  try {
    await writeWindowsProducer(first, path.join(sandbox, "workspace-a"));
    await writeWindowsProducer(second, path.join(sandbox, "workspace-b"), "different payload\n");

    const result = await invoke([
      "repro-check",
      "--target", "windows-x86_64-msvc",
      "--profile", "debug",
      "--producer-a", first,
      "--producer-b", second,
      "--report", reportPath,
    ]);

    assert.equal(result.status, 23, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.category, "reproducibility mismatch");
    assert.equal(report.error.code, "23");
    assert.equal(report.error.issues[0].code, "member-mismatch");
    assert.equal(report.error.issues[0].member, "bin/tsfg-r00-cpp-smoke.exe");
    assert.match(report.error.issues[0].message, /byte 0/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
