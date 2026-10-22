// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { appendFile, chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";
import { validVerifyArguments, invoke } from "./build-entry-invocation.mjs";
import { repositoryRoot, buildEntry } from "./build-entry-paths.mjs";
import { fixtureDigest } from "./build-entry-fixtures.mjs";

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


test("Linux prefetch refuses PATH Node without an explicit verified bootstrap", {
  skip: process.platform !== "linux",
}, async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-linux-bootstrap-"));
  const poisonRoot = path.join(sandbox, "poison");
  const sentinel = path.join(sandbox, "poison-node-ran");
  const reportPath = path.join(sandbox, "report.json");
  try {
    await mkdir(poisonRoot);
    const poisonNode = path.join(poisonRoot, "node");
    await writeFile(poisonNode, `#!/bin/sh\n: > ${JSON.stringify(sentinel)}\nexit 0\n`);
    await chmod(poisonNode, 0o755);
    const result = spawnSync(path.join(repositoryRoot, "eng", "tsfg-build"), [
      "prefetch", "--report", reportPath,
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        PATH: `${poisonRoot}:/usr/bin:/bin`,
        TSFG_CACHE_DIR: path.join(sandbox, "cache"),
      },
    });
    assert.equal(result.status, 11, result.stderr);
    assert.match(result.stderr, /absolute TSFG_BOOTSTRAP_NODE/);
    await assert.rejects(stat(sentinel), /ENOENT/);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.category, "lock/integrity");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});


test("Windows prefetch refuses PATH Node without an explicit verified bootstrap", {
  skip: process.platform !== "win32",
}, async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-windows-bootstrap-"));
  const poisonRoot = path.join(sandbox, "poison");
  const sentinel = path.join(sandbox, "poison-node-ran");
  const reportPath = path.join(sandbox, "report.json");
  try {
    await mkdir(poisonRoot);
    await writeFile(
      path.join(poisonRoot, "node.cmd"),
      `@echo off\r\n>"${sentinel}" echo poison\r\nexit /b 99\r\n`,
    );
    const result = spawnSync(process.env.ComSpec, [
      "/d", "/c", path.join(repositoryRoot, "eng", "tsfg-build.cmd"),
      "prefetch", "--report", reportPath,
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: poisonRoot, TSFG_CACHE_DIR: path.join(sandbox, "cache") },
    });
    assert.equal(result.status, 11, result.stderr);
    assert.match(result.stderr, /absolute TSFG_BOOTSTRAP_NODE/);
    await assert.rejects(stat(sentinel), /ENOENT/);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.command, "prefetch");
    assert.equal(report.network, "online");
    assert.equal(report.error.category, "lock/integrity");
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


test("Windows verify-workspace enters the JS offline supervisor before workspace inspection", {
  skip: process.platform !== "win32",
}, async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-verify-offline-boundary-"));
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const preloadPath = path.join(sandbox, "control-digest.cjs");
  const reportPath = path.join(sandbox, "report.json");
  const platform = "windows-x86_64-msvc";
  const buildSource = await readFile(buildEntry, "utf8");
  const controlDigest = buildSource.match(
    /WINDOWS_SANDBOX_EXECUTABLE_DIGEST\s*=\s*\n\s*"sha256:([0-9a-f]{64})"/,
  )?.[1];
  assert.ok(controlDigest);
  const controlBytes = Buffer.from("tsfg test WFP supervisor marker\n");
  const publicationDigest = buildSource.match(
    /WINDOWS_PUBLICATION_EXECUTABLE_DIGEST\s*=\s*\n\s*"sha256:([0-9a-f]{64})"/,
  )?.[1];
  assert.ok(publicationDigest);
  const publicationBytes = Buffer.from("tsfg test publication control marker\n");
  const emptyTreeDigest = fixtureDigest('{"entries":[],"schemaVersion":"1"}');
  const toolIds = ["cmake", "llvm", "msvc-tools", "ninja", "node", "windows-sdk", "zig"];
  const artifacts = Object.fromEntries(toolIds.map((id) => {
    const artifact = {
      archiveFormat: "raw",
      archiveSha256: fixtureDigest(""),
      byteSize: "0",
      installPath: `${id}.exe`,
      platform,
      unpackedTreeSha256: emptyTreeDigest,
      url: `https://fixtures.tsfg.invalid/${id}`,
    };
    if (id === "llvm") {
      artifact.executables = { clangcl: "clang-cl.exe", lld: "lld-link.exe", pdbutil: "llvm-pdbutil.exe" };
    } else if (id === "msvc-tools") {
      artifact.executables = { cl: "cl.exe", link: "link.exe" };
    } else if (id === "windows-sdk") {
      artifact.executables = { mt: "mt.exe", rc: "rc.exe" };
    }
    return [id, artifact];
  }));
  const lock = {
    dependencyLocks: [],
    schemaVersion: "1",
    targets: { [platform]: { tools: toolIds } },
    tools: Object.fromEntries(toolIds.map((id) => [id, {
      artifacts: [artifacts[id]],
      license: "MIT",
      signature: { kind: "fixture", signer: "tsfg test fixture" },
      version: "fixture",
    }])),
  };
  const lockDigest = fixtureDigest(JSON.stringify({
    dependencyLocks: [],
    schemaVersion: "1",
    target: platform,
    tools: toolIds.map((id) => ({
      archiveSha256: artifacts[id].archiveSha256,
      id,
      platform,
      unpackedTreeSha256: emptyTreeDigest,
      version: "fixture",
    })),
  }));
  const closureRelative = path.join(
    "closures", "sha256", lockDigest.slice("sha256:".length), platform,
  );
  const closurePath = path.join(cachePath, closureRelative);
  const controlPath = path.join(cachePath, "controls", controlDigest, "windows-sandbox-run.exe");
  try {
    for (const id of toolIds) await mkdir(path.join(closurePath, id), { recursive: true });
    await mkdir(path.join(cachePath, "active"), { recursive: true });
    await mkdir(path.dirname(controlPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
    await writeFile(
      path.join(closurePath, "ready.json"),
      `${JSON.stringify({ lockDigest, platform, status: "ready" })}\n`,
    );
    await writeFile(
      path.join(cachePath, "active", platform),
      `${closureRelative.replaceAll("\\", "/")}\n`,
    );
    await writeFile(controlPath, controlBytes);
    const publicationPath = path.join(cachePath, "controls", publicationDigest, "windows-publish.exe");
    await mkdir(path.dirname(publicationPath), { recursive: true });
    await writeFile(publicationPath, publicationBytes);
    await writeFile(preloadPath, `
const crypto = require("node:crypto");
const { syncBuiltinESMExports } = require("node:module");
const originalCreateHash = crypto.createHash;
const marker = Buffer.from(${JSON.stringify(controlBytes.toString("base64"))}, "base64");
const publicationMarker = Buffer.from(${JSON.stringify(publicationBytes.toString("base64"))}, "base64");
crypto.createHash = function createHash(algorithm, options) {
  const hash = originalCreateHash.call(this, algorithm, options);
  const chunks = [];
  const wrapper = {
    update(value, encoding) {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, encoding);
      chunks.push(bytes);
      hash.update(value, encoding);
      return wrapper;
    },
    digest(encoding) {
      const observed = Buffer.concat(chunks);
      if (algorithm === "sha256" && observed.equals(marker)) {
        const fixed = Buffer.from(${JSON.stringify(controlDigest)}, "hex");
        return encoding ? fixed.toString(encoding) : fixed;
      }
      if (algorithm === "sha256" && observed.equals(publicationMarker)) {
        const fixed = Buffer.from(${JSON.stringify(publicationDigest)}, "hex");
        return encoding ? fixed.toString(encoding) : fixed;
      }
      return hash.digest(encoding);
    },
  };
  return wrapper;
};
syncBuiltinESMExports();
`);

    const result = await invoke(validVerifyArguments(reportPath), {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${preloadPath}`,
        TSFG_GIT: TEST_GIT_EXECUTABLE,
        TSFG_RUNTIME_CACHE: cachePath,
        TSFG_RUNTIME_LOCK: lockPath,
        TSFG_RUNTIME_PLATFORM: platform,
      },
    });

    assert.equal(result.status, 12, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.category, "offline input missing");
    assert.equal(report.error.issues[0].code, "sandbox-boundary");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
