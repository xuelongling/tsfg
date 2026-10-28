// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validVerifyArguments, testNodeInvocation, invoke } from "./build-entry-invocation.mjs";
import { repositoryRoot, buildEntry } from "./build-entry-paths.mjs";

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
