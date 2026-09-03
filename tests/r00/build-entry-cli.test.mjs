// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { zstdDecompressSync } from "node:zlib";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const buildEntry = path.join(repositoryRoot, "eng", "tsfg-build.mjs");

function validVerifyArguments(reportPath) {
  return [
    "verify-workspace",
    "--workspace",
    repositoryRoot,
    "--manifest-url",
    "https://github.com/xuelongling/manifests.git",
    "--manifest-revision",
    "0000000000000000000000000000000000000000",
    "--manifest",
    "bootstrap/r00.xml",
    "--report",
    reportPath,
  ];
}

function testNodeInvocation(arguments_) {
  if (process.env.TSFG_TEST_NODE_LOADER && process.env.TSFG_TEST_NODE_BINARY) {
    return {
      executable: process.env.TSFG_TEST_NODE_LOADER,
      arguments: [process.env.TSFG_TEST_NODE_BINARY, ...arguments_],
    };
  }
  return { executable: process.execPath, arguments: arguments_ };
}

async function invoke(arguments_, options = {}) {
  return await new Promise((resolve, reject) => {
    const invocation = testNodeInvocation([buildEntry, ...arguments_]);
    const child = spawn(invocation.executable, invocation.arguments, {
      cwd: repositoryRoot,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function startArtifactServer(artifacts) {
  const server = createServer((request, response) => {
    const content = artifacts.get(request.url);
    if (content === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": content.length });
    response.end(content);
  });
  await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(undefined)),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function parseTarArchive(bytes) {
  const entries = [];
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const stringField = (start, length) => {
      const field = header.subarray(start, start + length);
      const end = field.indexOf(0);
      return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
    };
    const octalField = (start, length) =>
      Number.parseInt(stringField(start, length).trim() || "0", 8);
    const size = octalField(124, 12);
    const contentStart = offset + 512;
    entries.push({
      bytes: bytes.subarray(contentStart, contentStart + size),
      gid: octalField(116, 8),
      mode: octalField(100, 8),
      mtime: octalField(136, 12),
      name: stringField(0, 100),
      uid: octalField(108, 8),
    });
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test("unknown operation returns the stable usage category and an atomic report", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-build-cli-"));
  const reportPath = path.join(sandbox, "report.json");

  try {
    const invocation = testNodeInvocation([
      buildEntry,
      "unknown",
      "--report",
      reportPath,
    ]);
    const result = spawnSync(
      invocation.executable,
      invocation.arguments,
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsupported operation: unknown/);
    assert.equal(
      await readFile(reportPath, "utf8"),
      '{"command":"unknown","error":{"category":"usage/configuration","code":"2","issues":[{"code":"unsupported-operation","message":"unsupported operation: unknown"}]},"network":"disabled","schemaVersion":"1","status":"failure","telemetry":false}\n',
    );
    assert.deepEqual(await readdir(sandbox), ["report.json"]);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("public launcher classifies an unsupported operation before a missing closure", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-launcher-usage-"));
  const reportPath = path.join(sandbox, "report.json");
  const environment = {
    ...process.env,
    TSFG_CACHE_DIR: path.join(sandbox, "missing-cache"),
  };
  let result;
  try {
    if (process.platform === "win32") {
      result = spawnSync(
        process.env.ComSpec,
        [
          "/d",
          "/c",
          path.join(repositoryRoot, "eng", "tsfg-build.cmd"),
          "unsupported-operation",
          "--report",
          reportPath,
        ],
        { cwd: repositoryRoot, encoding: "utf8", env: environment },
      );
    } else {
      result = spawnSync(
        path.join(repositoryRoot, "eng", "tsfg-build"),
        ["unsupported-operation", "--report", reportPath],
        { cwd: repositoryRoot, encoding: "utf8", env: environment },
      );
    }
    if (result.error && "code" in result.error && result.error.code === "EACCES") {
      context.skip("launcher is not executable on this filesystem");
      return;
    }
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "failure");
    assert.equal(report.error.category, "usage/configuration");
    assert.equal(report.error.code, "2");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("public launcher classifies invalid verify-workspace options before a missing closure", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-launcher-invalid-verify-"));
  const reportPath = path.join(sandbox, "report.json");
  const environment = {
    ...process.env,
    TSFG_CACHE_DIR: path.join(sandbox, "missing-cache"),
  };
  let result;
  try {
    if (process.platform === "win32") {
      result = spawnSync(
        process.env.ComSpec,
        [
          "/d",
          "/c",
          path.join(repositoryRoot, "eng", "tsfg-build.cmd"),
          "verify-workspace",
          "--bogus",
          "value",
          "--report",
          reportPath,
        ],
        { cwd: repositoryRoot, encoding: "utf8", env: environment },
      );
    } else {
      result = spawnSync(
        path.join(repositoryRoot, "eng", "tsfg-build"),
        ["verify-workspace", "--bogus", "value", "--report", reportPath],
        { cwd: repositoryRoot, encoding: "utf8", env: environment },
      );
    }
    if (result.error && "code" in result.error && result.error.code === "EACCES") {
      context.skip("launcher is not executable on this filesystem");
      return;
    }
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.command, "verify-workspace");
    assert.equal(report.error.category, "usage/configuration");
    assert.equal(report.error.code, "2");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("public launcher validates verify-workspace identities before a missing closure", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-launcher-invalid-identity-"));
  const environment = {
    ...process.env,
    TSFG_CACHE_DIR: path.join(sandbox, "missing-cache"),
  };
  const scenarios = [
    {
      name: "moving manifest revision",
      mutate: (arguments_) =>
        (arguments_[arguments_.indexOf("--manifest-revision") + 1] = "main"),
    },
    {
      name: "escaping manifest path",
      mutate: (arguments_) =>
        (arguments_[arguments_.indexOf("--manifest") + 1] = "../escape.xml"),
    },
    {
      name: "case-mismatched option",
      mutate: (arguments_) =>
        (arguments_[arguments_.indexOf("--workspace")] = "--WORKSPACE"),
    },
  ];
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const reportPath = path.join(sandbox, `report-${index}.json`);
      const arguments_ = validVerifyArguments(reportPath);
      scenario.mutate(arguments_);
      const result = process.platform === "win32"
        ? spawnSync(
          process.env.ComSpec,
          ["/d", "/c", path.join(repositoryRoot, "eng", "tsfg-build.cmd"), ...arguments_],
          { cwd: repositoryRoot, encoding: "utf8", env: environment },
        )
        : spawnSync(
          path.join(repositoryRoot, "eng", "tsfg-build"),
          arguments_,
          { cwd: repositoryRoot, encoding: "utf8", env: environment },
        );
      if (result.error && "code" in result.error && result.error.code === "EACCES") {
        context.skip("launcher is not executable on this filesystem");
        return;
      }
      assert.equal(result.status, 2, `${scenario.name}: ${result.stderr}`);
      assert.equal(result.stdout, "");
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.command, "verify-workspace");
      assert.equal(report.error.category, "usage/configuration");
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Build Report write failures use the stable internal-failure exit", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-report-failure-"));
  const reportPath = path.join(sandbox, "report.json");
  try {
    await mkdir(reportPath);
    const result = await invoke(["unknown", "--report", reportPath]);
    assert.equal(result.status, 30);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /cannot write Build Report/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

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

test("Windows launcher rejects an invalid closure without using PATH node or pnpm", {
  skip: process.platform !== "win32",
}, async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-launcher-path-"));
  const cachePath = path.join(sandbox, "cache");
  const closureRelative = "closures/sha256/fixture/windows-x86_64";
  const cachedNode = path.join(cachePath, ...closureRelative.split("/"), "node", "node.exe");
  const poisonPath = path.join(sandbox, "poison");
  const sentinel = path.join(sandbox, "path-was-used.txt");
  const reportPath = path.join(sandbox, "report.json");
  try {
    await mkdir(path.dirname(cachedNode), { recursive: true });
    await copyFile(process.execPath, cachedNode);
    await mkdir(path.join(cachePath, "active"), { recursive: true });
    await writeFile(
      path.join(cachePath, "active", "windows-x86_64"),
      `${closureRelative}\n`,
    );
    await mkdir(poisonPath);
    for (const command of ["node.cmd", "pnpm.cmd"]) {
      await writeFile(
        path.join(poisonPath, command),
        `@echo poison>"${sentinel}"\r\n@exit /b 99\r\n`,
      );
    }

    const result = spawnSync(
      process.env.ComSpec,
      [
        "/d",
        "/c",
        path.join(repositoryRoot, "eng", "tsfg-build.cmd"),
        ...validVerifyArguments(reportPath),
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: poisonPath,
          TSFG_CACHE_DIR: cachePath,
        },
      },
    );
    assert.equal(result.status, 11, result.stderr);
    assert.match(result.stderr, /closure|integrity|digest/i);
    await assert.rejects(readFile(sentinel), /ENOENT/);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).error.code, "11");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Windows launcher verifies the locked Node executable before running it", {
  skip: process.platform !== "win32",
}, async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-launcher-node-integrity-"));
  const cachePath = path.join(sandbox, "cache");
  const closureRelative = "closures/sha256/9df4062f8570fb8b396287c973ec2348814db660ef1cfd428d1895eaaefe623a/windows-x86_64";
  const cachedNode = path.join(cachePath, ...closureRelative.split("/"), "node", "node.exe");
  const sentinel = path.join(sandbox, "cached-node-ran.txt");
  const preload = path.join(sandbox, "poison-preload.cjs");
  const reportPath = path.join(sandbox, "report.json");
  try {
    await mkdir(path.dirname(cachedNode), { recursive: true });
    await copyFile(process.execPath, cachedNode);
    await appendFile(cachedNode, "tampered");
    await mkdir(path.join(cachePath, "active"), { recursive: true });
    await writeFile(
      path.join(cachePath, "active", "windows-x86_64"),
      `${closureRelative}\n`,
    );
    await writeFile(
      preload,
      `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed");\n`,
    );
    const result = spawnSync(
      process.env.ComSpec,
      [
        "/d",
        "/c",
        path.join(repositoryRoot, "eng", "tsfg-build.cmd"),
        ...validVerifyArguments(reportPath),
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          TSFG_CACHE_DIR: cachePath,
        },
      },
    );
    assert.equal(result.status, 11, result.stderr);
    await assert.rejects(readFile(sentinel), /ENOENT/);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).error.code, "11");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("launcher reports a missing closure as lock/integrity failure", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-launcher-missing-"));
  const reportPath = path.join(sandbox, "report.json");
  const environment = {
    ...process.env,
    TSFG_CACHE_DIR: path.join(sandbox, "missing-cache"),
  };
  let result;
  try {
    if (process.platform === "win32") {
      result = spawnSync(
        process.env.ComSpec,
        [
          "/d",
          "/c",
          path.join(repositoryRoot, "eng", "tsfg-build.cmd"),
          ...validVerifyArguments(reportPath),
        ],
        { cwd: repositoryRoot, encoding: "utf8", env: environment },
      );
    } else {
      result = spawnSync(
        path.join(repositoryRoot, "eng", "tsfg-build"),
        validVerifyArguments(reportPath),
        { cwd: repositoryRoot, encoding: "utf8", env: environment },
      );
    }
    if (result.error && "code" in result.error && result.error.code === "EACCES") {
      context.skip("launcher is not executable on this filesystem");
      return;
    }
    assert.equal(result.status, 11, result.stderr);
    assert.equal(result.stdout, "");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.command, "verify-workspace");
    assert.equal(report.status, "failure");
    assert.deepEqual(report.error, {
      category: "lock/integrity",
      code: "11",
      issues: [
        {
          code: "runtime-closure",
          message: "locked Node.js closure is missing or invalid; run tsfg-build prefetch",
        },
      ],
    });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

function fixtureDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixtureTreeDigest(installPath, bytes) {
  const payload = JSON.stringify({
    entries: [{ path: installPath, sha256: fixtureDigest(bytes), type: "file" }],
    schemaVersion: "1",
  });
  return fixtureDigest(payload);
}

test("build and test run the private C++ and Zig smoke programs through locked tools", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-linux-cpp-build-"));
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const outputPath = path.join(sandbox, "out");
  const reportPath = path.join(sandbox, "build-report.json");
  const testReportPath = path.join(sandbox, "test-report.json");
  const compileFailureReportPath = path.join(sandbox, "compile-failure-report.json");
  const internalFailureReportPath = path.join(sandbox, "internal-failure-report.json");
  const testFailureReportPath = path.join(sandbox, "test-failure-report.json");
  const isWindows = process.platform === "win32";
  const cmake = Buffer.from(isWindows
    ? "@echo off\r\nset build_dir=%~4\r\nif not \"%build_dir:compile-fail=%\"==\"%build_dir%\" exit /b 9\r\nexit /b 0\r\n"
    : "#!/bin/sh\ncase \"$4\" in *compile-fail*) exit 9 ;; esac\nexit 0\n");
  const ninja = Buffer.from(isWindows
    ? "@echo off\r\n>\"%~2\\tsfg-r00-cpp-smoke\" echo fixture cpp output\r\nif not exist \"%~2\\..\\zig-install\\bin\" mkdir \"%~2\\..\\zig-install\\bin\"\r\n>\"%~2\\..\\zig-install\\bin\\tsfg-r00-zig-smoke\" echo fixture zig output\r\nexit /b 0\r\n"
    : `#!/bin/sh
{
  echo '#!/bin/sh'
  echo 'printf "tsfg-r00-cpp-smoke: ok\\n"'
} > "$2/tsfg-r00-cpp-smoke"
/bin/chmod +x "$2/tsfg-r00-cpp-smoke"
`);
  const zig = Buffer.from(isWindows
    ? "@echo off\r\nexit /b 0\r\n"
    : `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = --prefix ]; then
    /bin/mkdir -p "$2/bin"
    {
      echo '#!/bin/sh'
      echo 'printf "tsfg-r00-zig-smoke: ok\\n" >&2'
    } > "$2/bin/tsfg-r00-zig-smoke"
    /bin/chmod +x "$2/bin/tsfg-r00-zig-smoke"
    exit 0
  fi
  shift
done
exit 1
`);
  const inert = Buffer.from(isWindows ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n");
  const llvm = Buffer.from(isWindows
    ? "@echo off\r\nif \"%~1\"==\"--only-keep-debug\" copy /y \"%~2\" \"%~3\" >nul\r\nexit /b 0\r\n"
    : "#!/bin/sh\nif [ \"$1\" = --only-keep-debug ]; then /bin/cp \"$2\" \"$3\"; fi\nexit 0\n");
  const toolDefinitions = [
    ["cmake", isWindows ? "bin/cmake.cmd" : "bin/cmake", cmake],
    ["debian-sysroot", "usr/include/assert.h", Buffer.from("fixture sysroot\n")],
    ["llvm", isWindows ? "bin/llvm.cmd" : "bin/llvm", llvm],
    ["ninja", isWindows ? "bin/ninja.cmd" : "bin/ninja", ninja],
    ["node", isWindows ? "node.cmd" : "bin/node", inert],
    ["pnpm", isWindows ? "pnpm.cmd" : "pnpm", inert],
    ["zig", isWindows ? "zig.cmd" : "zig", zig],
  ];
  const server = await startArtifactServer(new Map(
    toolDefinitions.map(([id, , bytes]) => [`/${id}`, bytes]),
  ));
  let serverOpen = true;
  const tools = {};
  for (const [id, installPath, bytes] of toolDefinitions) {
    const artifact = {
      archiveFormat: "raw",
      archiveSha256: fixtureDigest(bytes),
      byteSize: String(bytes.length),
      installPath,
      platform: "test-x86_64",
      unpackedTreeSha256: fixtureTreeDigest(installPath, bytes),
      url: `${server.baseUrl}/${id}`,
    };
    if (id === "llvm") {
      artifact.executables = {
        ar: installPath,
        clang: installPath,
        clangxx: installPath,
        lld: installPath,
        objcopy: installPath,
        ranlib: installPath,
      };
    }
    tools[id] = {
      artifacts: [artifact],
      license: "MIT",
      signature: { kind: "fixture", signer: "tsfg test fixture" },
      version: "fixture",
    };
  }
  const lock = {
    dependencyLocks: [],
    schemaVersion: "1",
    targets: {
      "test-x86_64": { tools: toolDefinitions.map(([id]) => id) },
    },
    tools,
  };

  try {
    await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
    const prefetched = await invoke([
      "prefetch",
      "--lock", lockPath,
      "--cache", cachePath,
      "--platform", "test-x86_64",
    ]);
    assert.equal(prefetched.status, 0, prefetched.stderr);
    await server.close();
    serverOpen = false;

    const result = await invoke([
      "build",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--out", outputPath,
      "--report", reportPath,
    ], {
      env: {
        ...process.env,
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
    assert.equal(report.result.profile, "debug");
    assert.equal(report.result.target, "linux-x86_64-gnu");
    assert.match(report.result.buildIdentity.digest, /^sha256:[0-9a-f]{64}$/);
    assert.match(report.result.buildIdentity.buildInputSetDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(report.result.buildIdentity.toolchainClosureDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(report.result.buildIdentity.source_date_epoch, /^[1-9][0-9]*$/);
    assert.deepEqual(report.result.buildIdentity.options, {});
    assert.equal(
      report.result.contractSetId,
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
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
      JSON.parse(await readFile(path.join(repositoryRoot, "eng", "build-inputs.json"), "utf8")).entries,
    );
    assert.equal(
      metadata.buildInputSet.entries.some(({ repositoryRelativePath: inputPath }) =>
        inputPath.endsWith(".test.mjs") || inputPath.startsWith("docs/")),
      false,
    );
    const expectedEpoch = metadata.buildInputSet.entries.reduce((maximum, { repositoryRelativePath: inputPath }) => {
      const touched = spawnSync("git", ["log", "-1", "--format=%ct", "--", inputPath], {
        cwd: repositoryRoot,
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
        fixtureDigest(await readFile(path.join(repositoryRoot, ...inputPath.split("/")))),
      );
      const indexed = spawnSync("git", ["ls-files", "--stage", "--", inputPath], {
        cwd: repositoryRoot,
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
    assert.deepEqual(report.result.steps.map(({ tool }) => tool), ["cmake", "ninja", "zig"]);
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
    assert.match(report.result.steps[2].arguments.join(" "), /-Doptimize=Debug/);
    assert.deepEqual(report.result.steps[2].arguments.slice(-2), ["--seed", "0"]);

    const packageOutput = path.join(sandbox, "package");
    const packageReportPath = path.join(sandbox, "package-report.json");
    const packaged = await invoke([
      "package",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--input", outputPath,
      "--out", packageOutput,
      "--report", packageReportPath,
    ], {
      env: {
        ...process.env,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(packaged.status, 0, packaged.stderr);
    assert.equal(packaged.stdout, "");
    const packageReport = JSON.parse(await readFile(packageReportPath, "utf8"));
    assert.deepEqual(packageReport.result.buildIdentity, report.result.buildIdentity);
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
    assert.equal(entriesByName.get("contract-set.json").bytes.toString("utf8"), "{}");
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

    const firstArchive = Buffer.from(archiveBytes);
    const firstChecksums = await readFile(path.join(packageOutput, packageReport.result.checksums));
    const repackagedOutput = isWindows
      ? path.join(sandbox, "package-repeat")
      : packageOutput;
    const repackaged = await invoke([
      "package",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--input", outputPath,
      "--out", repackagedOutput,
    ], {
      env: {
        ...process.env,
        CI_RUN_ID: "ticket07-ci-run-id",
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(repackaged.status, 0, repackaged.stderr);
    assert.deepEqual(
      await readFile(path.join(repackagedOutput, packageReport.result.archive)),
      firstArchive,
    );
    assert.deepEqual(
      await readFile(path.join(repackagedOutput, packageReport.result.checksums)),
      firstChecksums,
    );

    const failedPackageOutput = path.join(sandbox, "failed-package");
    const failedPackageReport = path.join(sandbox, "failed-package-report.json");
    const packageFailure = await invoke([
      "package",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--input", path.join(sandbox, "missing-build"),
      "--out", failedPackageOutput,
      "--report", failedPackageReport,
    ], {
      env: {
        ...process.env,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(packageFailure.status, 22, packageFailure.stderr);
    assert.equal(
      JSON.parse(await readFile(failedPackageReport, "utf8")).error.category,
      "package failure",
    );
    await assert.rejects(lstat(failedPackageOutput), /ENOENT/);

    if (!isWindows) {
      const firstPublishedTarget = await readlink(outputPath);
      const rebuilt = await invoke([
        "build",
        "--target", "linux-x86_64-gnu",
        "--profile", "debug",
        "--out", outputPath,
      ], {
        env: {
          ...process.env,
          TSFG_RUNTIME_CACHE: cachePath,
          TSFG_RUNTIME_LOCK: lockPath,
          TSFG_RUNTIME_PLATFORM: "test-x86_64",
        },
      });
      assert.equal(rebuilt.status, 0, rebuilt.stderr);
      assert.ok((await lstat(outputPath)).isSymbolicLink());
      assert.notEqual(await readlink(outputPath), firstPublishedTarget);
      assert.ok(
        (await stat(
          path.resolve(path.dirname(outputPath), firstPublishedTarget),
        )).isDirectory(),
      );
      assert.equal((await readdir(path.join(sandbox, ".out.versions"))).length, 2);
    }

    const tested = await invoke([
      "test",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--out", outputPath,
      "--report", testReportPath,
    ], {
      env: {
        ...process.env,
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
      "--out", path.join(sandbox, "compile-fail"),
      "--report", compileFailureReportPath,
    ], {
      env: {
        ...process.env,
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
      "--out", path.join(blockedOutputParent, "out"),
      "--report", internalFailureReportPath,
    ], {
      env: {
        ...process.env,
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
      "--out", outputPath,
      "--report", testFailureReportPath,
    ], {
      env: {
        ...process.env,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: "test-x86_64",
      },
    });
    assert.equal(testFailure.status, 21, testFailure.stderr);
    const testFailureReport = JSON.parse(await readFile(testFailureReportPath, "utf8"));
    assert.equal(testFailureReport.status, "failure");
    assert.equal(testFailureReport.error.category, "test failure");
    assert.equal(testFailureReport.error.code, "21");
  } finally {
    if (serverOpen) await server.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
