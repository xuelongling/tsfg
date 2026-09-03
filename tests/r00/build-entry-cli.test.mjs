// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
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
chmod +x "$2/tsfg-r00-cpp-smoke"
`);
  const zig = Buffer.from(isWindows
    ? "@echo off\r\nexit /b 0\r\n"
    : `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = --prefix ]; then
    mkdir -p "$2/bin"
    {
      echo '#!/bin/sh'
      echo 'printf "tsfg-r00-zig-smoke: ok\\n" >&2'
    } > "$2/bin/tsfg-r00-zig-smoke"
    chmod +x "$2/bin/tsfg-r00-zig-smoke"
    exit 0
  fi
  shift
done
exit 1
`);
  const inert = Buffer.from(isWindows ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n");
  const toolDefinitions = [
    ["cmake", isWindows ? "bin/cmake.cmd" : "bin/cmake", cmake],
    ["debian-sysroot", "usr/include/assert.h", Buffer.from("fixture sysroot\n")],
    ["llvm", isWindows ? "bin/llvm.cmd" : "bin/llvm", inert],
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
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.command, "build");
    assert.equal(report.network, "offline");
    assert.equal(report.result.profile, "debug");
    assert.equal(report.result.target, "linux-x86_64-gnu");
    assert.deepEqual(report.result.outputs, [
      "bin/tsfg-r00-cpp-smoke",
      "bin/tsfg-r00-zig-smoke",
    ]);
    assert.deepEqual(report.result.steps.map(({ tool }) => tool), ["cmake", "ninja", "zig"]);
    assert.match(report.result.steps[0].arguments.join(" "), /-O0/);
    assert.match(report.result.steps[0].arguments.join(" "), /-g3/);
    assert.match(report.result.steps[0].arguments.join(" "), /-UNDEBUG/);
    assert.match(
      report.result.steps[0].arguments.join(" "),
      /-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY/,
    );
    assert.match(report.result.steps[0].arguments.join(" "), /debian-sysroot/);
    assert.match(report.result.steps[0].arguments.join(" "), /llvm/);
    assert.match(report.result.steps[0].arguments.join(" "), /-DCMAKE_AR=/);
    assert.match(report.result.steps[2].arguments.join(" "), /-Doptimize=Debug/);

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
