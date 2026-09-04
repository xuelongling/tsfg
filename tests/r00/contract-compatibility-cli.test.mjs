// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildEntry = path.join(repositoryRoot, "eng", "tsfg-build.mjs");
const networkDenialHook = path.join(repositoryRoot, "tests", "r00", "deny-network.cjs");
const fixturesRoot = path.join(repositoryRoot, "tests", "r00", "fixtures", "compatibility");
const emptyContractSetId =
  "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";

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

test("public launchers accept compatibility artifact test arguments before loading the locked runtime", () => {
  const arguments_ = [
    "test",
    "--target", process.platform === "win32" ? "windows-x86_64-msvc" : "linux-x86_64-gnu",
    "--workspace", repositoryRoot,
    "--compatibility-baseline", path.join(fixturesRoot, "baseline.json"),
    "--compatibility-candidate", path.join(fixturesRoot, "candidate.json"),
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
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-contract-compatibility-"));
  const baseline = path.join(fixturesRoot, "baseline.json");
  const candidate = path.join(fixturesRoot, "candidate.json");

  try {
    for (const target of ["linux-x86_64-gnu", "windows-x86_64-msvc"]) {
      const reportPath = path.join(sandbox, `${target}.json`);
      const result = await invokeCompatibility(target, reportPath, baseline, candidate);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");

      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.command, "test");
      assert.equal(report.status, "success");
      assert.deepEqual(report.result.contractSet, {
        canonical: "{}",
        id: emptyContractSetId,
      });
      assert.equal(report.result.target, target);
      assert.equal(report.result.compatibility.artifactTransport, "serialized-json-only");
      assert.equal(report.result.compatibility.syntheticFamilyRegistered, false);
      assert.equal(
        report.result.compatibility.artifacts.baseline.productSemver,
        report.result.compatibility.artifacts.candidate.productSemver,
      );
      assert.notEqual(
        report.result.compatibility.artifacts.baseline.syntheticContractSemver,
        report.result.compatibility.artifacts.candidate.syntheticContractSemver,
      );
      assert.deepEqual(
        report.result.compatibility.combinations.map(({ consumer, producer, status }) => ({
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
      for (const combination of report.result.compatibility.combinations) {
        assert.match(combination.producerProductOid, /^[0-9a-f]{40}$/);
        assert.match(combination.consumerProductOid, /^[0-9a-f]{40}$/);
        assert.equal(combination.exchange, "serialized-payload");
      }
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Product SemVer can change without impersonating a synthetic Contract SemVer change", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-product-contract-version-separation-"));
  const baseline = path.join(fixturesRoot, "baseline.json");
  const candidatePath = path.join(sandbox, "candidate.json");

  try {
    const candidateArtifact = JSON.parse(await readFile(baseline, "utf8"));
    candidateArtifact.product = {
      ...candidateArtifact.product,
      commitOid: "3333333333333333333333333333333333333333",
      semver: "9.9.9",
    };
    const candidateBytes = Buffer.from(`${JSON.stringify(candidateArtifact)}\n`);
    await writeFile(candidatePath, candidateBytes);

    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeCompatibility(
      "linux-x86_64-gnu",
      reportPath,
      baseline,
      candidatePath,
    );
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const { artifacts, combinations, gate } = report.result.compatibility;
    assert.equal(gate.status, "passed");
    assert.equal(combinations.every(({ status }) => status === "passed"), true);
    assert.notEqual(artifacts.baseline.productSemver, artifacts.candidate.productSemver);
    assert.equal(
      artifacts.baseline.syntheticContractSemver,
      artifacts.candidate.syntheticContractSemver,
    );
    assert.equal(artifacts.candidate.sha256, sha256(candidateBytes));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("changed Schema Hash without a Contract SemVer bump fails with the complete matrix report", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-contract-version-gate-"));
  const baseline = path.join(fixturesRoot, "baseline.json");
  const candidatePath = path.join(sandbox, "candidate.json");

  try {
    const baselineArtifact = JSON.parse(await readFile(baseline, "utf8"));
    const candidateArtifact = JSON.parse(
      await readFile(path.join(fixturesRoot, "candidate.json"), "utf8"),
    );
    candidateArtifact.contract.semver = baselineArtifact.contract.semver;
    await writeFile(candidatePath, `${JSON.stringify(candidateArtifact)}\n`);

    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeCompatibility(
      "linux-x86_64-gnu",
      reportPath,
      baseline,
      candidatePath,
    );
    assert.equal(result.status, 21, result.stderr);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "failure");
    assert.equal(report.error.category, "test/compatibility failure");
    assert.equal(report.error.code, "21");
    assert.equal(report.error.issues[0].code, "contract-version-not-bumped");
    assert.deepEqual(report.error.issues[0].compatibility.gate.issues, [
      {
        code: "contract-version-not-bumped",
        message: "synthetic contract semantics or Schema Hash changed without a Contract SemVer bump",
      },
    ]);
    assert.equal(report.error.issues[0].compatibility.combinations.length, 4);
    assert.equal(
      report.error.issues[0].compatibility.combinations.every(({ status }) => status === "passed"),
      true,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("a compatible extension mislabeled as a patch fails the Contract SemVer gate", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-contract-extension-gate-"));
  const baseline = path.join(fixturesRoot, "baseline.json");
  const candidatePath = path.join(sandbox, "candidate.json");

  try {
    const candidateArtifact = JSON.parse(
      await readFile(path.join(fixturesRoot, "candidate.json"), "utf8"),
    );
    candidateArtifact.contract.semver = "0.1.1";
    await writeFile(candidatePath, `${JSON.stringify(candidateArtifact)}\n`);

    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeCompatibility(
      "linux-x86_64-gnu",
      reportPath,
      baseline,
      candidatePath,
    );
    assert.equal(result.status, 21, result.stderr);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.issues[0].code, "compatible-extension-requires-minor");
    assert.deepEqual(report.error.issues[0].compatibility.gate.issues, [
      {
        code: "compatible-extension-requires-minor",
        message: "backward-compatible synthetic extension requires a Contract SemVer minor bump",
      },
    ]);
    assert.equal(report.error.issues[0].compatibility.combinations.length, 4);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("a breaking change without a complete expand-migrate-remove window fails", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-contract-migration-gate-"));
  const baseline = path.join(fixturesRoot, "baseline.json");
  const candidatePath = path.join(sandbox, "candidate.json");

  try {
    const candidateArtifact = JSON.parse(
      await readFile(path.join(fixturesRoot, "candidate.json"), "utf8"),
    );
    candidateArtifact.contract.change = {
      class: "breaking",
      fromSemver: "0.1.0",
    };
    await writeFile(candidatePath, `${JSON.stringify(candidateArtifact)}\n`);

    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeCompatibility(
      "linux-x86_64-gnu",
      reportPath,
      baseline,
      candidatePath,
    );
    assert.equal(result.status, 21, result.stderr);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.issues[0].code, "breaking-migration-window-incomplete");
    assert.deepEqual(report.error.issues[0].compatibility.gate.issues, [
      {
        code: "breaking-migration-window-incomplete",
        message: "breaking synthetic change requires a complete expand-migrate-remove window",
      },
    ]);
    assert.equal(report.error.issues[0].compatibility.combinations.length, 4);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("an exact-match seam rejects mixed baseline and candidate contract versions", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-contract-exact-gate-"));
  const baselinePath = path.join(sandbox, "baseline.json");
  const candidatePath = path.join(sandbox, "candidate.json");

  try {
    const baselineArtifact = JSON.parse(
      await readFile(path.join(fixturesRoot, "baseline.json"), "utf8"),
    );
    const candidateArtifact = JSON.parse(
      await readFile(path.join(fixturesRoot, "candidate.json"), "utf8"),
    );
    baselineArtifact.contract.compatibility = "exact";
    candidateArtifact.contract.compatibility = "exact";
    candidateArtifact.contract.change = {
      class: "exact-change",
      fromSemver: "0.1.0",
    };
    await writeFile(baselinePath, `${JSON.stringify(baselineArtifact)}\n`);
    await writeFile(candidatePath, `${JSON.stringify(candidateArtifact)}\n`);

    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeCompatibility(
      "linux-x86_64-gnu",
      reportPath,
      baselinePath,
      candidatePath,
    );
    assert.equal(result.status, 21, result.stderr);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
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
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
