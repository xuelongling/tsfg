// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { lstat, readFile, readlink, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { invoke } from "./build-entry-invocation.mjs";
import { networkDenialHook } from "./build-entry-paths.mjs";
import { fixtureDigest } from "./build-entry-fixtures.mjs";

export async function verifyPublicationReplacements(archiveBytes, sandbox, packageReport, context, publicationHelper) {
  const packageOutput = path.join(sandbox, "package");
  const isWindows = process.platform === "win32";
  const workspacePath = path.join(sandbox, "workspace");
  const outputPath = path.join(sandbox, "out");
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");


    const firstArchive = Buffer.from(archiveBytes);
    const firstChecksums = await readFile(path.join(packageOutput, packageReport.result.checksums));
    await context.test("package replays into the same published directory", {
      skip: isWindows && !publicationHelper && "set TSFG_WINDOWS_PUBLICATION_TEST_HELPER to the pinned native control",
    }, async () => {
      let reading = true;
      let reads = 0;
      let readerError;
      const reader = (async () => {
        try {
          while (reading) {
            assert.deepEqual(await readFile(path.join(packageOutput, packageReport.result.archive)), firstArchive);
            reads += 1;
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        } catch (error) { readerError = error; }
      })();
      try {
        const repackaged = await invoke([
          "package",
          "--target", "linux-x86_64-gnu",
          "--profile", "debug",
          "--workspace", workspacePath,
          "--input", outputPath,
          "--out", packageOutput,
        ], {
          env: {
            ...process.env,
            CI_RUN_ID: "ticket07-ci-run-id",
            NODE_OPTIONS: `--require=${networkDenialHook}`,
            TSFG_RUNTIME_CACHE: cachePath,
            TSFG_RUNTIME_LOCK: lockPath,
            TSFG_RUNTIME_PLATFORM: "test-x86_64",
          },
        });
        assert.equal(repackaged.status, 0, repackaged.stderr);
      } finally {
        reading = false;
        await reader;
      }
      assert.ifError(readerError);
      assert.ok(reads > 0, "reader observes complete published bytes during replacement");
      assert.deepEqual(await readFile(path.join(packageOutput, packageReport.result.archive)), firstArchive);
      assert.deepEqual(await readFile(path.join(packageOutput, packageReport.result.checksums)), firstChecksums);
    });
    await context.test("failed package replacements preserve the previous publication", {
      skip: isWindows && !publicationHelper && "set TSFG_WINDOWS_PUBLICATION_TEST_HELPER to the pinned native control",
    }, async () => {
      for (const [failurePoint, expectedStatus] of [
        ["output-version", 22], ["output-link", 22], ["output-swapped", 22], ["report-before-rename", 30],
      ]) {
        const previousTarget = await readlink(packageOutput);
        const failureReport = path.join(sandbox, `replacement-${failurePoint}.json`);
        const failed = await invoke([
          "package", "--target", "linux-x86_64-gnu", "--profile", "debug",
          "--workspace", workspacePath, "--input", outputPath, "--out", packageOutput,
          "--report", failureReport,
        ], { env: {
          ...process.env, NODE_OPTIONS: `--require=${networkDenialHook}`,
          TSFG_RUNTIME_CACHE: cachePath, TSFG_RUNTIME_LOCK: lockPath,
          TSFG_RUNTIME_PLATFORM: "test-x86_64", TSFG_TEST_FAIL_PUBLISH_AT: failurePoint,
        } });
        assert.equal(failed.status, expectedStatus, failed.stderr);
        assert.equal(await readlink(packageOutput), previousTarget);
        assert.deepEqual(await readFile(path.join(packageOutput, packageReport.result.archive)), firstArchive);
        if (failurePoint === "report-before-rename") {
          await assert.rejects(lstat(failureReport), /ENOENT/);
        } else {
          assert.equal(JSON.parse(await readFile(failureReport, "utf8")).status, "failure");
        }
      }
    });
    await context.test("Windows replacement rejects a corrupt publication control without changing the package", {
      skip: !isWindows || !publicationHelper,
    }, async () => {
      const control = path.join(cachePath, "controls", fixtureDigest(publicationHelper).slice(7), "windows-publish.exe");
      const previousTarget = await readlink(packageOutput);
      try {
        await writeFile(control, "corrupt control\n");
        const failed = await invoke([
          "package", "--target", "linux-x86_64-gnu", "--profile", "debug",
          "--workspace", workspacePath, "--input", outputPath, "--out", packageOutput,
        ], { env: {
          ...process.env, NODE_OPTIONS: `--require=${networkDenialHook}`,
          TSFG_RUNTIME_CACHE: cachePath, TSFG_RUNTIME_LOCK: lockPath, TSFG_RUNTIME_PLATFORM: "test-x86_64",
        } });
        assert.equal(failed.status, 22, failed.stderr);
        assert.match(failed.stderr, /publication control digest mismatch/);
        assert.equal(await readlink(packageOutput), previousTarget);
        assert.deepEqual(await readFile(path.join(packageOutput, packageReport.result.archive)), firstArchive);
      } finally {
        await writeFile(control, publicationHelper);
      }
    });

    const failedPackageOutput = path.join(sandbox, "failed-package");
    const failedPackageReport = path.join(sandbox, "failed-package-report.json");
    const packageFailure = await invoke([
      "package",
      "--target", "linux-x86_64-gnu",
      "--profile", "debug",
      "--workspace", workspacePath,
      "--input", path.join(sandbox, "missing-build"),
      "--out", failedPackageOutput,
      "--report", failedPackageReport,
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
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

    await context.test("build replaces the same published directory", {
      skip: isWindows && !publicationHelper && "set TSFG_WINDOWS_PUBLICATION_TEST_HELPER to the pinned native control",
    }, async () => {
      const firstPublishedTarget = await readlink(outputPath);
      const rebuilt = await invoke([
        "build",
        "--target", "linux-x86_64-gnu",
        "--profile", "debug",
        "--workspace", workspacePath,
        "--out", outputPath,
      ], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${networkDenialHook}`,
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
    });
}
