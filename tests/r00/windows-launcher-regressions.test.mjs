// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("Windows restricted token uses mandatory integrity to seal read-only path ACLs", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "eng", "windows-sandbox-run.c"),
    "utf8",
  );
  assert.match(source, /GetTokenInformation\(process_token, TokenUser/);
  assert.match(source, /CreateWellKnownSid\(WinLowLabelSid/);
  assert.match(source, /apply_grant\(&requested\[index\], token_user->User\.Sid/);
  assert.match(source, /LABEL_SECURITY_INFORMATION/);
  assert.match(source, /S:\(ML;OICI;NW;;;LW\)/);
  assert.match(source, /SetTokenInformation\([\s\S]*TokenIntegrityLevel/);
  assert.match(source, /mandatory_label\.Label\.Attributes =[\s\S]*SE_GROUP_INTEGRITY/);
  assert.match(
    source,
    /CreateRestrictedToken\(process_token, DISABLE_MAX_PRIVILEGE,\s*0, NULL, 0, NULL, 0, NULL/,
  );
  assert.match(
    source,
    /GRANT_READ_WRITE:[\s\S]*GENERIC_READ \| GENERIC_WRITE \| GENERIC_EXECUTE \| DELETE/,
  );
  assert.match(source, /GRANT_READ_ONLY: return GENERIC_READ \| GENERIC_EXECUTE/);
  assert.match(
    source,
    /requested\[index\]\.kind == GRANT_READ_ONLY \|\|[\s\S]*GRANT_READ_EXECUTE\)[\s\S]*continue;/,
  );
  assert.doesNotMatch(source, /command_grant/);
});
const windowsLauncher = path.join(repositoryRoot, "eng", "tsfg-build.cmd");

function invokeWindowsLauncher(arguments_, environment) {
  return spawnSync(
    process.env.ComSpec,
    ["/d", "/c", windowsLauncher, ...arguments_],
    { cwd: repositoryRoot, encoding: "utf8", env: environment },
  );
}

async function invokeBeforeRuntime(command, makeArguments) {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-windows-launcher-"));
  const reportPath = path.join(sandbox, `${command}-report.json`);
  try {
    const result = invokeWindowsLauncher(
      [...makeArguments(sandbox), "--report", reportPath],
      {
        ...process.env,
        TSFG_CACHE_DIR: path.join(sandbox, "missing-cache"),
      },
    );
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    return { report, result };
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

function assertUsageFailure(command, result, report) {
  assert.equal(result.status, 2, `${command}: ${result.stderr}`);
  assert.equal(result.stdout, "");
  assert.equal(report.command, command);
  assert.equal(report.error.category, "usage/configuration");
  assert.equal(report.error.code, "2");
}

function assertRuntimeClosureFailure(command, result, report) {
  assert.equal(result.status, 11, `${command}: ${result.stderr}`);
  assert.equal(report.command, command);
  assert.equal(report.error.category, "lock/integrity");
}

test("Windows launcher rejects unknown build-control options before reading the runtime closure", {
  skip: process.platform !== "win32",
}, async () => {
  for (const command of ["build", "test", "package", "repro-check"]) {
    const { report, result } = await invokeBeforeRuntime(
      command,
      () => [command, "--bogus", "value"],
    );
    assertUsageFailure(command, result, report);
  }
});

test("Windows launcher accepts every supported build-control option shape", {
  skip: process.platform !== "win32",
}, async (context) => {
  const scenarios = [
    {
      name: "build",
      command: "build",
      arguments: (sandbox) => [
        "build", "--dev",
        "--target", "windows-x86_64-msvc",
        "--profile", "debug",
        "--simd-dispatch", "runtime-detected",
        "--workspace", repositoryRoot,
        "--out", path.join(sandbox, "build-output"),
      ],
    },
    {
      name: "smoke test",
      command: "test",
      arguments: (sandbox) => [
        "test", "--dev",
        "--target", "windows-x86_64-msvc",
        "--profile", "debug",
        "--simd-dispatch", "baseline-only",
        "--cpu-fixture", "x86-64-v2",
        "--workspace", repositoryRoot,
        "--out", path.join(sandbox, "test-output"),
      ],
    },
    {
      name: "compatibility test",
      command: "test",
      arguments: (sandbox) => [
        "test",
        "--target", "windows-x86_64-msvc",
        "--compatibility-baseline", path.join(sandbox, "baseline.json"),
        "--compatibility-candidate", path.join(sandbox, "candidate.json"),
        "--workspace", repositoryRoot,
      ],
    },
    {
      name: "package-runtime test",
      command: "test",
      arguments: (sandbox) => [
        "test",
        "--target", "windows-x86_64-msvc",
        "--profile", "release",
        "--workspace", repositoryRoot,
        "--package", path.join(sandbox, "package"),
      ],
    },
    {
      name: "package",
      command: "package",
      arguments: (sandbox) => [
        "package",
        "--target", "windows-x86_64-msvc",
        "--profile", "release",
        "--workspace", repositoryRoot,
        "--input", path.join(sandbox, "input"),
        "--out", path.join(sandbox, "package-output"),
      ],
    },
    {
      name: "repro-check",
      command: "repro-check",
      arguments: (sandbox) => [
        "repro-check",
        "--target", "windows-x86_64-msvc",
        "--profile", "release",
        "--producer-a", path.join(sandbox, "producer-a"),
        "--producer-b", path.join(sandbox, "producer-b"),
        "--workspace", repositoryRoot,
      ],
    },
  ];

  for (const scenario of scenarios) {
    await context.test(scenario.name, async () => {
      const { report, result } = await invokeBeforeRuntime(
        scenario.command,
        scenario.arguments,
      );
      assertRuntimeClosureFailure(scenario.command, result, report);
    });
  }
});

test("Windows launcher rejects duplicate, missing, and mutually exclusive arguments before the runtime closure", {
  skip: process.platform !== "win32",
}, async () => {
  const scenarios = [
    [
      "build",
      "--target", "windows-x86_64-msvc",
      "--target", "windows-x86_64-msvc",
      "--profile", "debug",
      "--out", "build-output",
    ],
    [
      "test",
      "--target", "windows-x86_64-msvc",
      "--profile", "debug",
      "--workspace", repositoryRoot,
      "--package", "package",
      "--compatibility-baseline", "baseline.json",
      "--compatibility-candidate", "candidate.json",
    ],
    [
      "test",
      "--target", "windows-x86_64-msvc",
      "--profile", "debug",
      "--workspace", repositoryRoot,
      "--package", "package",
      "--cpu-fixture", "x86-64-v2",
    ],
    [
      "package",
      "--target", "windows-x86_64-msvc",
      "--profile", "release",
      "--out", "package-output",
    ],
    [
      "repro-check",
      "--target", "windows-x86_64-msvc",
      "--profile", "release",
      "--producer-a", "producer-a",
    ],
  ];

  for (const arguments_ of scenarios) {
    const command = arguments_[0];
    const { report, result } = await invokeBeforeRuntime(command, () => arguments_);
    assertUsageFailure(command, result, report);
  }
});

test("Windows launcher routes verify-workspace through the authenticated offline runtime", async () => {
  const launcher = await readFile(windowsLauncher, "utf8");
  assert.match(
    launcher,
    /set "OPENSSL_CONF="\r?\ngoto offline_runtime\r?\n\r?\n:offline_runtime/,
  );
});
