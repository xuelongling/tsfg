// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const launcher = path.join(repositoryRoot, "eng", "tsfg-build");
const lockId = "99df577d8c78ae99ffe8ee04dc2034521b023e9e19b177f696d1f0fa2412e9d5";
const nodeId = "89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7";

test("Linux offline commands reject PATH Git without an authenticated Bootstrap Trust Root", {
  skip: process.platform === "win32" ? "Linux launcher acceptance is Linux-only" : false,
}, async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-linux-launcher-git-"));
  try {
    const testNode = process.env.TSFG_TEST_LOCKED_NODE ?? process.execPath;
    const actualNodeId = createHash("sha256").update(await readFile(testNode)).digest("hex");
    assert.equal(actualNodeId, nodeId, "test must run with the locked Linux Node.js executable");
    const cache = path.join(sandbox, "cache");
    const closure = `closures/sha256/${lockId}/linux-x86_64-gnu`;
    const lockedNode = path.join(cache, ...closure.split("/"), "node", "bin", "node");
    await mkdir(path.dirname(lockedNode), { recursive: true });
    await copyFile(testNode, lockedNode);
    await chmod(lockedNode, 0o755);
    await mkdir(path.join(cache, "active"), { recursive: true });
    await writeFile(path.join(cache, "active", "linux-x86_64-gnu"), `${closure}\n`);

    const poison = path.join(sandbox, "poison");
    const sentinel = path.join(sandbox, "path-git-ran");
    await mkdir(poison);
    await writeFile(path.join(poison, "git"), `#!/bin/sh\nprintf poison > '${sentinel}'\nexit 91\n`);
    await chmod(path.join(poison, "git"), 0o755);
    const { TSFG_BOOTSTRAP_GIT: _git, TSFG_BOOTSTRAP_GIT_SHA256: _gitDigest, ...environment } = process.env;
    const launcherArguments = [
      "verify-workspace",
      "--workspace", repositoryRoot,
      "--manifest-url", "https://github.com/xuelongling/manifests.git",
      "--manifest-revision", "1".repeat(40),
      "--manifest", "bootstrap/r00.xml",
    ];
    const result = spawnSync(launcher, launcherArguments, {
      encoding: "utf8",
      env: {
        ...environment,
        PATH: `${poison}:${environment.PATH ?? ""}`,
        TSFG_CACHE_DIR: cache,
      },
    });
    assert.equal(result.status, 11, result.stderr);
    assert.match(result.stderr, /absolute TSFG_BOOTSTRAP_GIT/i);
    await assert.rejects(stat(sentinel), /ENOENT/);

    const systemGit = "/usr/bin/git";
    const gitDigest = createHash("sha256").update(await readFile(systemGit)).digest("hex");
    const wrongDigest = spawnSync(launcher, launcherArguments, {
      encoding: "utf8",
      env: {
        ...environment,
        PATH: `${poison}:${environment.PATH ?? ""}`,
        TSFG_BOOTSTRAP_GIT: systemGit,
        TSFG_BOOTSTRAP_GIT_SHA256: "0".repeat(64),
        TSFG_CACHE_DIR: cache,
      },
    });
    assert.equal(wrongDigest.status, 11, wrongDigest.stderr);
    assert.match(wrongDigest.stderr, /bootstrap Git digest mismatch/i);
    await assert.rejects(stat(sentinel), /ENOENT/);

    const nonExecutableGit = "/etc/hosts";
    const nonExecutableDigest = createHash("sha256").update(await readFile(nonExecutableGit)).digest("hex");
    const nonExecutable = spawnSync(launcher, launcherArguments, {
      encoding: "utf8",
      env: {
        ...environment,
        PATH: `${poison}:${environment.PATH ?? ""}`,
        TSFG_BOOTSTRAP_GIT: nonExecutableGit,
        TSFG_BOOTSTRAP_GIT_SHA256: nonExecutableDigest,
        TSFG_CACHE_DIR: cache,
      },
    });
    assert.equal(nonExecutable.status, 11, nonExecutable.stderr);
    assert.match(nonExecutable.stderr, /does not exist or is not executable/i);
    await assert.rejects(stat(sentinel), /ENOENT/);

    const authenticated = spawnSync(launcher, launcherArguments, {
      encoding: "utf8",
      env: {
        ...environment,
        PATH: `${poison}:${environment.PATH ?? ""}`,
        TSFG_BOOTSTRAP_GIT: systemGit,
        TSFG_BOOTSTRAP_GIT_SHA256: gitDigest,
        TSFG_CACHE_DIR: cache,
      },
    });
    assert.notEqual(authenticated.status, 11, authenticated.stderr);
    assert.doesNotMatch(authenticated.stderr, /bootstrap Git/i);
    await assert.rejects(stat(sentinel), /ENOENT/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
