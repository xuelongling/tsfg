// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  baselineSyntheticArtifact,
  candidateSyntheticArtifact,
  emptyContractSetId,
} from "./contract-compatibility-fixtures.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildEntry = path.join(repositoryRoot, "eng", "tsfg-build.mjs");
const networkDenialHook = path.join(repositoryRoot, "tests", "r00", "deny-network.cjs");

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function invokeCompatibility(target, reportPath, baseline, candidate) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      buildEntry,
      "test",
      "--dev",
      "--target", target,
      "--workspace", repositoryRoot,
      "--compatibility-baseline", baseline,
      "--compatibility-candidate", candidate,
      "--report", reportPath,
    ], {
      cwd: repositoryRoot,
      env: { ...process.env, NODE_OPTIONS: `--require=${networkDenialHook}` },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr, stdout }));
  });
}

/**
 * @param {{baseline?: Record<string, any>, candidate?: Record<string, any>, target?: string}} [fixture]
 */
async function runCompatibilityCase({
  baseline = baselineSyntheticArtifact(),
  candidate = candidateSyntheticArtifact(),
  target = "linux-x86_64-gnu",
} = {}) {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-contract-compatibility-"));
  const baselinePath = path.join(sandbox, "baseline.json");
  const candidatePath = path.join(sandbox, "candidate.json");
  const reportPath = path.join(sandbox, "report.json");
  const baselineBytes = Buffer.from(`${JSON.stringify(baseline)}\n`);
  const candidateBytes = Buffer.from(`${JSON.stringify(candidate)}\n`);
  try {
    await writeFile(baselinePath, baselineBytes);
    await writeFile(candidatePath, candidateBytes);
    const result = await invokeCompatibility(target, reportPath, baselinePath, candidatePath);
    return {
      baselineBytes,
      candidateBytes,
      report: JSON.parse(await readFile(reportPath, "utf8")),
      result,
    };
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

test("public launchers accept compatibility artifact test arguments before loading the locked runtime", () => {
  const arguments_ = [
    "test",
    "--target", process.platform === "win32" ? "windows-x86_64-msvc" : "linux-x86_64-gnu",
    "--workspace", repositoryRoot,
    "--compatibility-baseline", "baseline-artifact.json",
    "--compatibility-candidate", "candidate-artifact.json",
  ];
  const environment = {
    ...process.env,
    TSFG_CACHE_DIR: path.join(tmpdir(), "tsfg-missing-compatibility-launcher-cache"),
  };
  /** @type {Array<[string, string[]]>} */
  const invocations = process.platform === "win32"
    ? [[process.env.ComSpec ?? "cmd.exe", [
        "/d", "/c", path.join(repositoryRoot, "eng", "tsfg-build.cmd"), ...arguments_,
      ]]]
    : [[path.join(repositoryRoot, "eng", "tsfg-build"), arguments_]];

  if (process.platform === "win32") {
    const gitExecPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim();
    const gitBash = path.resolve(gitExecPath, "../../../bin/bash.exe");
    const linuxArguments = [...arguments_];
    linuxArguments[2] = "linux-x86_64-gnu";
    invocations.push([
      gitBash,
      [path.join(repositoryRoot, "eng", "tsfg-build"), ...linuxArguments],
    ]);
  }

  for (const [executable, launcherArguments] of invocations) {
    const result = spawnSync(executable, launcherArguments, {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(result.status, 11, result.stderr || result.error?.message);
    assert.match(result.stderr, /locked Node\.js closure is missing or invalid/);
  }
});

test("empty Contract Set and all four serialized artifact combinations pass on both targets", async () => {
  for (const target of ["linux-x86_64-gnu", "windows-x86_64-msvc"]) {
    const { baselineBytes, candidateBytes, report, result } = await runCompatibilityCase({ target });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(report.command, "test");
    assert.equal(report.status, "success");
    assert.deepEqual(report.result.contractSet, { canonical: "{}", id: emptyContractSetId });
    assert.equal(report.result.target, target);

    const compatibility = report.result.compatibility;
    assert.equal(compatibility.artifactTransport, "serialized-json-only");
    assert.equal(compatibility.syntheticFamilyRegistered, false);
    assert.equal(compatibility.artifacts.baseline.sha256, sha256(baselineBytes));
    assert.equal(compatibility.artifacts.candidate.sha256, sha256(candidateBytes));
    assert.equal(
      compatibility.artifacts.baseline.productSemver,
      compatibility.artifacts.candidate.productSemver,
    );
    assert.notEqual(
      compatibility.artifacts.baseline.syntheticContractSemver,
      compatibility.artifacts.candidate.syntheticContractSemver,
    );
    assert.deepEqual(
      compatibility.combinations.map(({ consumer, producer, status }) => ({
        consumer,
        producer,
        status,
      })),
      [
        { consumer: "baseline", producer: "baseline", status: "passed" },
        { consumer: "baseline", producer: "candidate", status: "passed" },
        { consumer: "candidate", producer: "baseline", status: "passed" },
        { consumer: "candidate", producer: "candidate", status: "passed" },
      ],
    );
    for (const combination of compatibility.combinations) {
      assert.match(combination.producerProductOid, /^[0-9a-f]{40}$/);
      assert.match(combination.consumerProductOid, /^[0-9a-f]{40}$/);
      assert.equal(combination.exchange, "serialized-payload");
    }
  }
});

test("Product SemVer can change without impersonating a synthetic Contract SemVer change", async () => {
  const candidate = baselineSyntheticArtifact();
  candidate.product = {
    ...candidate.product,
    commitOid: "3".repeat(40),
    semver: "9.9.9",
  };
  candidate.contract.change = { class: "unchanged", fromSemver: candidate.contract.semver };

  const { candidateBytes, report, result } = await runCompatibilityCase({ candidate });
  assert.equal(result.status, 0, result.stderr);
  const { artifacts, combinations, gate } = report.result.compatibility;
  assert.equal(gate.status, "passed");
  assert.equal(combinations.every(({ status }) => status === "passed"), true);
  assert.notEqual(artifacts.baseline.productSemver, artifacts.candidate.productSemver);
  assert.equal(artifacts.baseline.syntheticContractSemver, artifacts.candidate.syntheticContractSemver);
  assert.equal(artifacts.candidate.sha256, sha256(candidateBytes));
});

test("changed Schema Hash without a Contract SemVer bump fails with the complete matrix report", async () => {
  const candidate = candidateSyntheticArtifact();
  candidate.contract.semver = baselineSyntheticArtifact().contract.semver;
  const { report, result } = await runCompatibilityCase({ candidate });
  assert.equal(result.status, 21, result.stderr);
  assert.equal(report.status, "failure");
  assert.equal(report.error.category, "test/compatibility failure");
  assert.equal(report.error.code, "21");
  assert.equal(report.error.issues[0].code, "contract-version-not-bumped");
  assert.deepEqual(report.error.issues[0].compatibility.gate.issues, [{
    code: "contract-version-not-bumped",
    message: "synthetic contract semantics or Schema Hash changed without a Contract SemVer bump",
  }]);
  assert.equal(report.error.issues[0].compatibility.combinations.length, 4);
  assert.equal(
    report.error.issues[0].compatibility.combinations.every(({ status }) => status === "passed"),
    true,
  );
});

test("a compatible extension mislabeled as a patch fails the Contract SemVer gate", async () => {
  const candidate = candidateSyntheticArtifact();
  candidate.contract.semver = "0.1.1";
  const { report, result } = await runCompatibilityCase({ candidate });
  assert.equal(result.status, 21, result.stderr);
  assert.equal(report.error.issues[0].code, "compatible-extension-requires-minor");
  assert.deepEqual(report.error.issues[0].compatibility.gate.issues, [{
    code: "compatible-extension-requires-minor",
    message: "backward-compatible synthetic extension requires a Contract SemVer minor bump",
  }]);
});

test("an unknown change class cannot bypass the compatible-extension version gate", async () => {
  const candidate = candidateSyntheticArtifact();
  candidate.contract.change.class = "unknown";
  candidate.contract.semver = "0.1.1";
  const { report, result } = await runCompatibilityCase({ candidate });
  assert.equal(result.status, 21, result.stderr);
  assert.equal(report.error.category, "test/compatibility failure");
  assert.equal(report.error.issues[0].code, "invalid-synthetic-artifact");
});

test("a breaking change without a complete expand-migrate-remove window fails", async () => {
  const candidate = candidateSyntheticArtifact();
  candidate.contract.change = { class: "breaking", fromSemver: "0.1.0" };
  const { report, result } = await runCompatibilityCase({ candidate });
  assert.equal(result.status, 21, result.stderr);
  assert.equal(report.error.issues[0].code, "breaking-migration-window-incomplete");
  assert.deepEqual(report.error.issues[0].compatibility.gate.issues, [{
    code: "breaking-migration-window-incomplete",
    message: "breaking synthetic change requires a complete expand-migrate-remove window bound to baseline and candidate stable Product SemVer",
  }]);
});

test("a claimed migration window must bind the baseline and candidate Product SemVer", async () => {
  const baseline = baselineSyntheticArtifact();
  const candidate = candidateSyntheticArtifact();
  baseline.product.semver = "0.1.0";
  candidate.product.semver = "0.3.0";
  candidate.contract.change = {
    class: "breaking",
    fromSemver: "0.1.0",
    migration: {
      phases: ["expand", "migrate", "remove"],
      stableProductMinors: ["99.0", "99.1", "99.2"],
    },
  };
  const { report, result } = await runCompatibilityCase({ baseline, candidate });
  assert.equal(result.status, 21, result.stderr);
  assert.equal(report.error.issues[0].code, "breaking-migration-window-incomplete");
  assert.equal(
    report.error.issues[0].compatibility.gate.issues[0].message,
    "breaking synthetic change requires a complete expand-migrate-remove window bound to baseline and candidate stable Product SemVer",
  );
});

test("an exact-match seam rejects mixed baseline and candidate contract versions", async () => {
  const baseline = baselineSyntheticArtifact();
  const candidate = candidateSyntheticArtifact();
  baseline.contract.compatibility = "exact";
  candidate.contract.compatibility = "exact";
  candidate.contract.change = { class: "exact-change", fromSemver: "0.1.0" };
  const { report, result } = await runCompatibilityCase({ baseline, candidate });
  assert.equal(result.status, 21, result.stderr);
  assert.equal(report.error.issues[0].code, "exact-match-version-mixed");
  assert.equal(report.error.issues[0].compatibility.gate.status, "passed");
  assert.deepEqual(
    report.error.issues[0].compatibility.combinations.map(
      ({ consumer, issueCode, producer, status }) => ({
        consumer,
        ...(issueCode ? { issueCode } : {}),
        producer,
        status,
      }),
    ),
    [
      { consumer: "baseline", producer: "baseline", status: "passed" },
      {
        consumer: "baseline",
        issueCode: "exact-match-version-mixed",
        producer: "candidate",
        status: "failed",
      },
      {
        consumer: "candidate",
        issueCode: "exact-match-version-mixed",
        producer: "baseline",
        status: "failed",
      },
      { consumer: "candidate", producer: "candidate", status: "passed" },
    ],
  );
});
