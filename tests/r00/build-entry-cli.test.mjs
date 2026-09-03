// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const buildEntry = path.join(repositoryRoot, "eng", "tsfg-build.mjs");

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
  const server = await startArtifactServer(
    new Map([
      ["/node", nodeBytes],
      ["/node-mirror", nodeBytes],
      ["/pnpm", pnpmBytes],
      ["/pnpm-mirror", pnpmBytes],
    ]),
  );
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const cachePath = path.join(sandbox, "cache");
  const reportPath = path.join(sandbox, "report.json");
  const lock = {
    schemaVersion: "1",
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
    assert.deepEqual(firstReport.result.tools, [
      { id: "node", version: "24.20.0" },
      { id: "pnpm", version: "11.25.0" },
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
    assert.equal(JSON.parse(await readFile(path.join(closurePath, "ready.json"), "utf8")).status, "ready");

    const second = await invoke(arguments_);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(reportPath, "utf8"), firstReportBytes);

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
        "verify-workspace",
        "--report",
        reportPath,
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
          "verify-workspace",
          "--report",
          reportPath,
        ],
        { cwd: repositoryRoot, encoding: "utf8", env: environment },
      );
    } else {
      result = spawnSync(
        path.join(repositoryRoot, "eng", "tsfg-build"),
        ["verify-workspace", "--report", reportPath],
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
