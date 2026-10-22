// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { invoke } from "./build-entry-invocation.mjs";
import { startArtifactServer, fixtureDigest, dataDescriptorZip, fixtureTreeDigest } from "./build-entry-fixtures.mjs";

test("prefetch atomically publishes and reuses a content-verified minimal closure", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-prefetch-"));
  const nodeBytes = Buffer.from("fixture-node\n");
  const pnpmBytes = Buffer.from("fixture-pnpm\n");
  const zigBytes = Buffer.from("fixture-zig\n");
  const server = await startArtifactServer(
    new Map([
      ["/node", nodeBytes],
      ["/node-mirror", nodeBytes],
      ["/pnpm", pnpmBytes],
      ["/pnpm-mirror", pnpmBytes],
      ["/zig", zigBytes],
    ]),
  );
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const cachePath = path.join(sandbox, "cache");
  const reportPath = path.join(sandbox, "report.json");
  const lock = {
    dependencyLocks: [],
    schemaVersion: "1",
    targets: {
      "test-x86_64": { tools: ["node", "pnpm", "zig"] },
    },
    tools: {
      node: {
        version: "24.20.0",
        license: "MIT",
        signature: { kind: "fixture", signer: "tsfg test fixture" },
        artifacts: [
          {
            platform: "test-x86_64",
            url: `${server.baseUrl}/node`,
            byteSize: "13",
            archiveFormat: "raw",
            archiveSha256:
              "sha256:65282644da0a98e0bf0917f34dc801982b23beed25a66b2685463bdb50718ec5",
            installPath: "bin/node",
            unpackedTreeSha256:
              "sha256:1bc273e20c69064c683c464679a60a4aca86327de41d3d04e5e08fdba8bfba46",
          },
        ],
      },
      pnpm: {
        version: "11.25.0",
        license: "MIT",
        signature: { kind: "fixture", signer: "tsfg test fixture" },
        artifacts: [
          {
            platform: "test-x86_64",
            url: `${server.baseUrl}/pnpm`,
            byteSize: "13",
            archiveFormat: "raw",
            archiveSha256:
              "sha256:7078759f3ad1ae04b8ecf38d0c98571bed7a26363f4b477dcd118e7b8f83549f",
            installPath: "bin/pnpm",
            unpackedTreeSha256:
              "sha256:02eca1046cb5292ebcb6c814bf75c4902f0bf2181834199cf74fac4bf339a9ce",
          },
        ],
      },
      zig: {
        version: "0.16.0",
        license: "MIT",
        signature: { kind: "fixture", signer: "tsfg test fixture" },
        artifacts: [
          {
            platform: "test-x86_64",
            url: `${server.baseUrl}/zig`,
            byteSize: "12",
            archiveFormat: "raw",
            archiveSha256:
              "sha256:30ccc2b3eddab64e55e66d69c1741102bd114307d82d598bd15bd1118ce41417",
            installPath: "bin/zig",
            unpackedTreeSha256:
              "sha256:0e433afb4c00e1999c50e0bbc06e085b30c11a57e813a7bf8d9dbb16981a3a68",
          },
        ],
      },
    },
  };

  try {
    await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
    const arguments_ = [
      "prefetch",
      "--lock",
      lockPath,
      "--cache",
      cachePath,
      "--platform",
      "test-x86_64",
      "--report",
      reportPath,
    ];

    const first = await invoke(arguments_);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, "");
    const firstReportBytes = await readFile(reportPath, "utf8");
    const firstReport = JSON.parse(firstReportBytes);
    assert.equal(firstReport.command, "prefetch");
    assert.equal(firstReport.network, "online");
    assert.equal(firstReport.status, "success");
    assert.equal(firstReport.telemetry, false);
    assert.equal(
      firstReport.result.cacheKey,
      `test-x86_64/sha256/${firstReport.result.lockDigest.slice("sha256:".length)}`,
    );
    assert.deepEqual(firstReport.result.tools, [
      { id: "node", version: "24.20.0" },
      { id: "pnpm", version: "11.25.0" },
      { id: "zig", version: "0.16.0" },
    ]);

    const closurePath = path.join(
      cachePath,
      "closures",
      "sha256",
      firstReport.result.lockDigest.slice("sha256:".length),
      "test-x86_64",
    );
    assert.equal(
      await readFile(path.join(closurePath, "node", "bin", "node"), "utf8"),
      "fixture-node\n",
    );
    assert.equal(
      await readFile(path.join(closurePath, "pnpm", "bin", "pnpm"), "utf8"),
      "fixture-pnpm\n",
    );
    assert.equal(
      await readFile(path.join(closurePath, "zig", "bin", "zig"), "utf8"),
      "fixture-zig\n",
    );
    assert.equal(JSON.parse(await readFile(path.join(closurePath, "ready.json"), "utf8")).status, "ready");
    const archiveCacheRoot = path.join(
      cachePath,
      "archives",
      "sha256",
      firstReport.result.lockDigest.slice("sha256:".length),
      "test-x86_64",
    );
    assert.deepEqual(
      (await readdir(archiveCacheRoot)).sort(),
      [
        lock.tools.zig.artifacts[0].archiveSha256.slice("sha256:".length),
        lock.tools.node.artifacts[0].archiveSha256.slice("sha256:".length),
        lock.tools.pnpm.artifacts[0].archiveSha256.slice("sha256:".length),
      ].sort(),
    );

    const nodeArchive = path.join(
      archiveCacheRoot,
      lock.tools.node.artifacts[0].archiveSha256.slice("sha256:".length),
    );
    await writeFile(nodeArchive, "poison\n");
    const corruptedArchive = await invoke(arguments_);
    assert.equal(corruptedArchive.status, 11);
    assert.match(corruptedArchive.stderr, /cached archive byte size mismatch/);
    await assert.rejects(
      readFile(path.join(cachePath, "active", "test-x86_64")),
      /ENOENT/,
    );
    await writeFile(nodeArchive, nodeBytes);

    const second = await invoke(arguments_);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(reportPath, "utf8"), firstReportBytes);

    await writeFile(path.join(closurePath, "unexpected-object"), "poison\n");
    const unexpectedObject = await invoke(arguments_);
    assert.equal(unexpectedObject.status, 11);
    assert.match(unexpectedObject.stderr, /unexpected cached closure object/);
    assert.equal(
      JSON.parse(await readFile(reportPath, "utf8")).error.category,
      "lock/integrity",
    );
    await assert.rejects(
      readFile(path.join(cachePath, "active", "test-x86_64")),
      /ENOENT/,
    );
    await rm(path.join(closurePath, "unexpected-object"));

    const restored = await invoke(arguments_);
    assert.equal(restored.status, 0, restored.stderr);

    const mirrorLock = structuredClone(lock);
    mirrorLock.tools.node.artifacts[0].url = `${server.baseUrl}/node-mirror`;
    mirrorLock.tools.pnpm.artifacts[0].url = `${server.baseUrl}/pnpm-mirror`;
    const mirrorLockPath = path.join(sandbox, "mirror-toolchains.lock.json");
    const mirrorReportPath = path.join(sandbox, "mirror-report.json");
    await writeFile(mirrorLockPath, `${JSON.stringify(mirrorLock)}\n`);
    const mirrored = await invoke([
      "prefetch",
      "--lock",
      mirrorLockPath,
      "--cache",
      path.join(sandbox, "mirror-cache"),
      "--platform",
      "test-x86_64",
      "--report",
      mirrorReportPath,
    ]);
    assert.equal(mirrored.status, 0, mirrored.stderr);
    assert.equal(
      JSON.parse(await readFile(mirrorReportPath, "utf8")).result.lockDigest,
      firstReport.result.lockDigest,
      "mirror location must not enter Toolchain Closure identity",
    );

    await writeFile(
      path.join(closurePath, "node", "bin", "node"),
      "corrupt-node\n",
    );
    const corrupted = await invoke(arguments_);
    assert.equal(corrupted.status, 11);
    assert.match(corrupted.stderr, /unpacked tree digest mismatch/);
    await assert.rejects(
      readFile(path.join(cachePath, "active", "test-x86_64")),
      /ENOENT/,
    );
    assert.equal(
      JSON.parse(await readFile(reportPath, "utf8")).error.category,
      "lock/integrity",
    );
  } finally {
    await server.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});


test("prefetch accepts authenticated ZIP entries that use a data descriptor", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-prefetch-zip-descriptor-"));
  const toolBytes = Buffer.from("fixture tool\n");
  const archiveBytes = dataDescriptorZip("package/bin/tool.exe", toolBytes);
  const server = await startArtifactServer(new Map([["/tool.zip", archiveBytes]]));
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const cachePath = path.join(sandbox, "cache");
  const reportPath = path.join(sandbox, "report.json");
  const lock = {
    dependencyLocks: [],
    schemaVersion: "1",
    targets: { "test-x86_64": { tools: ["cmake"] } },
    tools: {
      cmake: {
        artifacts: [{
          archiveFormat: "zip",
          archiveSha256: fixtureDigest(archiveBytes),
          byteSize: String(archiveBytes.length),
          installPath: "bin/tool.exe",
          platform: "test-x86_64",
          stripComponents: "1",
          unpackedTreeSha256: fixtureTreeDigest("bin/tool.exe", toolBytes),
          url: `${server.baseUrl}/tool.zip`,
        }],
        license: "BSD-3-Clause",
        signature: { kind: "fixture", signer: "tsfg test fixture" },
        version: "fixture",
      },
    },
  };
  try {
    await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
    const result = await invoke([
      "prefetch",
      "--lock", lockPath,
      "--cache", cachePath,
      "--platform", "test-x86_64",
      "--report", reportPath,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "success");
    assert.equal(
      await readFile(path.join(cachePath, "closures", "sha256",
        report.result.lockDigest.slice("sha256:".length), "test-x86_64", "cmake", "bin", "tool.exe"), "utf8"),
      "fixture tool\n",
    );
  } finally {
    await server.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});


test("prefetch configuration errors use the stable usage category", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-prefetch-config-"));
  const reportPath = path.join(sandbox, "report.json");
  try {
    const result = await invoke(["prefetch", "--report", reportPath]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /requires --lock, --cache, and --platform/);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.deepEqual(report.error, {
      category: "usage/configuration",
      code: "2",
      issues: [
        {
          code: "invalid-configuration",
          message: "prefetch requires --lock, --cache, and --platform",
        },
      ],
    });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});


test("unknown options fail as usage before prefetch reads inputs", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-prefetch-option-"));
  const reportPath = path.join(sandbox, "report.json");
  try {
    const result = await invoke([
      "prefetch",
      "--lock",
      path.join(sandbox, "missing-lock.json"),
      "--cache",
      path.join(sandbox, "cache"),
      "--platform",
      "test-x86_64",
      "--bogus",
      "value",
      "--report",
      reportPath,
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown option: --bogus/);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).error.code, "2");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});


test("prefetch rejects incomplete lock metadata without publishing partial success", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-prefetch-corrupt-"));
  const bytes = Buffer.from("fixture-node\n");
  const server = await startArtifactServer(new Map([["/artifact", bytes]]));
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const cachePath = path.join(sandbox, "cache");
  const reportPath = path.join(sandbox, "report.json");
  const artifact = {
    platform: "test-x86_64",
    url: `${server.baseUrl}/artifact`,
    byteSize: "13",
    archiveFormat: "raw",
    archiveSha256:
      "sha256:65282644da0a98e0bf0917f34dc801982b23beed25a66b2685463bdb50718ec5",
    installPath: "bin/tool",
    unpackedTreeSha256:
      "sha256:3693f6aaa8a9360c66028c75f3e3b280d22a09ff0b998ed7ace9b4c12c13530d",
  };
  const lock = {
    dependencyLocks: [],
    schemaVersion: "1",
    tools: {
      node: {
        version: "24.20.0",
        license: "MIT",
        signature: { kind: "fixture", signer: "" },
        artifacts: [artifact],
      },
      pnpm: {
        version: "11.25.0",
        license: "MIT",
        signature: { kind: "fixture", signer: "tsfg test fixture" },
        artifacts: [artifact],
      },
    },
  };

  try {
    await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
    const result = await invoke([
      "prefetch",
      "--lock",
      lockPath,
      "--cache",
      cachePath,
      "--platform",
      "test-x86_64",
      "--report",
      reportPath,
    ]);
    assert.equal(result.status, 11);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /signer/);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.category, "lock/integrity");
    assert.equal(report.error.code, "11");
    await assert.rejects(readFile(path.join(cachePath, "closures")), /ENOENT/);
    await assert.rejects(readdir(path.join(cachePath, ".staging")), /ENOENT/);
  } finally {
    await server.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
