// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const productPrCi = path.join(repositoryRoot, "eng", "product-pr-ci.mjs");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "product-pr.yml");
const manifestRevision = "1".repeat(40);
const baselineProductRevision = "2".repeat(40);
const agentRevision = "3".repeat(40);
const candidateRevision = "4".repeat(40);

/** @param {string | Buffer} value */
function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function invoke(arguments_) {
  return spawnSync(process.execPath, [productPrCi, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env },
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`);
}

function workspaceReport(productRevision) {
  return {
    command: "verify-workspace",
    result: {
      manifest: {
        repositoryUrl: "https://github.com/xuelongling/manifests.git",
        revision: "5".repeat(40),
        selected: "bootstrap/r00.xml",
      },
      projects: [
        { dirty: false, head: productRevision, id: "tsfg.git", path: "tsfg" },
        { dirty: false, head: agentRevision, id: ".agents.git", path: ".agents" },
      ],
    },
    schemaVersion: "1",
    status: "success",
  };
}

function workflowJob(workflow, name) {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow job ${name}`);
  const remainder = workflow.slice(start + marker.length);
  const next = remainder.search(/^  [a-z0-9-]+:\s*$/m);
  return next === -1 ? remainder : remainder.slice(0, next);
}

test("candidate identity binds a complete product overlay to the fixed Integration Snapshot", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-product-pr-identity-"));
  const manifestPath = path.join(sandbox, "bootstrap", "r00.xml");
  const outputPath = path.join(sandbox, "identity");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <remote name="github-xuelongling" fetch="https://github.com/xuelongling/" />
  <project name="tsfg.git" path="tsfg" remote="github-xuelongling" revision="${baselineProductRevision}" />
  <project name=".agents.git" path=".agents" remote="github-xuelongling" revision="${agentRevision}" />
</manifest>
`);

  try {
    const result = invoke([
      "identity",
      "--manifest", manifestPath,
      "--manifest-name", "bootstrap/r00.xml",
      "--manifest-revision", manifestRevision,
      "--candidate-revision", candidateRevision,
      "--out", outputPath,
    ]);
    assert.equal(result.status, 0, result.stderr);

    const overlayBytes = await readFile(path.join(outputPath, "candidate-overlay.json"));
    const resolvedBytes = await readFile(path.join(outputPath, "resolved-manifest.json"));
    const report = JSON.parse(await readFile(path.join(outputPath, "candidate-identity.json"), "utf8"));
    assert.deepEqual(JSON.parse(overlayBytes.toString("utf8")), {
      baseline: {
        manifest: "bootstrap/r00.xml",
        repository: "https://github.com/xuelongling/manifests.git",
        revision: manifestRevision,
      },
      replacements: [{ project: "tsfg.git", revision: candidateRevision }],
      schemaVersion: "1",
    });
    assert.deepEqual(JSON.parse(resolvedBytes.toString("utf8")), {
      baseline: {
        manifest: "bootstrap/r00.xml",
        repository: "https://github.com/xuelongling/manifests.git",
        revision: manifestRevision,
      },
      projects: [
        { name: ".agents.git", path: ".agents", revision: agentRevision },
        { name: "tsfg.git", path: "tsfg", revision: candidateRevision },
      ],
      schemaVersion: "1",
    });
    const canonicalOverlay = `{"baseline":{"manifest":"bootstrap/r00.xml","repository":"https://github.com/xuelongling/manifests.git","revision":"${manifestRevision}"},"replacements":[{"project":"tsfg.git","revision":"${candidateRevision}"}],"schemaVersion":"1"}`;
    const canonicalResolved = `{"baseline":{"manifest":"bootstrap/r00.xml","repository":"https://github.com/xuelongling/manifests.git","revision":"${manifestRevision}"},"projects":[{"name":".agents.git","path":".agents","revision":"${agentRevision}"},{"name":"tsfg.git","path":"tsfg","revision":"${candidateRevision}"}],"schemaVersion":"1"}`;
    assert.deepEqual(report, {
      candidateRevision,
      overlayDigest: digest(canonicalOverlay),
      resolvedManifestDigest: digest(canonicalResolved),
      schemaVersion: "1",
    });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("candidate identity failure preserves a pre-existing output directory and publishes no partial identity", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-product-pr-atomic-"));
  const manifestPath = path.join(sandbox, "bootstrap", "r00.xml");
  const outputPath = path.join(sandbox, "identity");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await mkdir(outputPath);
  await writeFile(path.join(outputPath, "sentinel.txt"), "owned by caller\n");
  await writeFile(path.join(outputPath, "candidate-overlay.json"), "occupied\n");
  await writeFile(manifestPath, `<manifest>
  <project name="tsfg.git" path="tsfg" revision="${baselineProductRevision}" />
  <project name=".agents.git" path=".agents" revision="${agentRevision}" />
</manifest>\n`);
  try {
    const result = invoke([
      "identity", "--manifest", manifestPath,
      "--manifest-name", "bootstrap/r00.xml",
      "--manifest-revision", manifestRevision,
      "--candidate-revision", candidateRevision,
      "--out", outputPath,
    ]);
    assert.equal(result.status, 1);
    assert.equal(await readFile(path.join(outputPath, "sentinel.txt"), "utf8"), "owned by caller\n");
    await assert.rejects(readFile(path.join(outputPath, "resolved-manifest.json")), /ENOENT/);
    await assert.rejects(readFile(path.join(outputPath, "candidate-identity.json")), /ENOENT/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("product PR plan covers both Tier 1 targets, both profiles, independent producers, and comparators", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-product-pr-plan-"));
  const reportPath = path.join(sandbox, "plan.json");
  try {
    const result = invoke(["plan", "--out", reportPath]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(await readFile(reportPath, "utf8"));
    assert.deepEqual(plan.producerMatrix, [
      { os: "ubuntu-24.04", producer: "a", profile: "debug", target: "linux-x86_64-gnu" },
      { os: "ubuntu-24.04", producer: "b", profile: "debug", target: "linux-x86_64-gnu" },
      { os: "ubuntu-24.04", producer: "a", profile: "release", target: "linux-x86_64-gnu" },
      { os: "ubuntu-24.04", producer: "b", profile: "release", target: "linux-x86_64-gnu" },
      { os: "windows-2025", producer: "a", profile: "debug", target: "windows-x86_64-msvc" },
      { os: "windows-2025", producer: "b", profile: "debug", target: "windows-x86_64-msvc" },
      { os: "windows-2025", producer: "a", profile: "release", target: "windows-x86_64-msvc" },
      { os: "windows-2025", producer: "b", profile: "release", target: "windows-x86_64-msvc" },
    ]);
    assert.deepEqual(plan.comparatorMatrix, [
      { os: "ubuntu-24.04", profile: "debug", target: "linux-x86_64-gnu" },
      { os: "ubuntu-24.04", profile: "release", target: "linux-x86_64-gnu" },
      { os: "windows-2025", profile: "debug", target: "windows-x86_64-msvc" },
      { os: "windows-2025", profile: "release", target: "windows-x86_64-msvc" },
    ]);
    assert.deepEqual(plan.compatibilityMatrix, [
      { os: "ubuntu-24.04", target: "linux-x86_64-gnu" },
      { os: "windows-2025", target: "windows-x86_64-msvc" },
    ]);
    assert.deepEqual(plan.requiredJobs, [
      "candidate-identity",
      "repository-gates",
      "workspace-verification",
      "product-build",
      "compatibility",
      "reproducibility",
      "candidate-evidence",
    ]);
    assert.equal(plan.evidenceRetentionDays, "90");
    assert.equal(plan.schemaVersion, "1");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("product PR workflow has a read-only, secret-free, commit-pinned pull_request boundary", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /^on:\n  pull_request:\s*$/m);
  assert.match(workflow, /^permissions:\n  contents: read\s*$/m);
  assert.doesNotMatch(workflow, /pull_request_target|\$\{\{\s*secrets\.|^\s+secrets\s*:/m);
  assert.doesNotMatch(workflow, /(?:ubuntu|windows)-latest/);
  for (const match of workflow.matchAll(/^\s+(?:-\s+)?uses:\s*([^\s#]+).*$/gm)) {
    if (!match[1].startsWith("./")) {
      assert.match(match[1], /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/);
    }
  }
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.doesNotMatch(workflow, /persist-credentials:\s*true/);
});

test("product PR workflow composes every gate, producer, compatibility lane, and build-free comparator", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const repositoryGates = workflowJob(workflow, "repository-gates");
  assert.match(repositoryGates, /git diff --check/);
  assert.match(repositoryGates, /workspace-policy-cli\.test\.mjs/);
  assert.match(repositoryGates, /toolchain-lock\.test\.mjs/);
  assert.match(repositoryGates, /tsc --noEmit/);

  const workspaceVerification = workflowJob(workflow, "workspace-verification");
  assert.match(workspaceVerification, /verify-workspace/);
  assert.match(workspaceVerification, /git -C "\$workspace\/tsfg" fetch --no-tags "\$GITHUB_WORKSPACE"/);
  assert.doesNotMatch(workspaceVerification, /\.ci\/candidate-product/);
  const productBuild = workflowJob(workflow, "product-build");
  assert.match(productBuild, /eng[\\/]tsfg-build(?:\.cmd)?"? build/);
  assert.match(productBuild, /eng[\\/]tsfg-build(?:\.cmd)?"? test/);
  assert.match(productBuild, /eng[\\/]tsfg-build(?:\.cmd)?"? package/);
  assert.match(productBuild, /candidate-binding\.json/);
  assert.match(productBuild, /producer-\$\{\{ matrix\.producer \}\}/);
  assert.match(productBuild, /actions\/cache@[0-9a-f]{40}/);
  assert.match(productBuild, /key: tsfg-tools-\$\{\{ matrix\.target \}\}-\$\{\{ hashFiles\('eng\/toolchains\.lock\.json', 'pnpm-lock\.yaml'\) \}\}/);
  assert.doesNotMatch(productBuild, /restore-keys:/);
  assert.ok(productBuild.indexOf("actions/cache@") < productBuild.indexOf(" prefetch"));

  const compatibility = workflowJob(workflow, "compatibility");
  assert.match(compatibility, /--compatibility-baseline/);
  assert.match(compatibility, /--compatibility-candidate/);
  assert.match(compatibility, /RUNNER_TEMP\/tsfg-compatibility/);
  assert.doesNotMatch(compatibility, /\.ci\/(?:compatibility|evidence)/);
  const reproducibility = workflowJob(workflow, "reproducibility");
  assert.match(reproducibility, /needs:.*product-build/s);
  assert.match(reproducibility, /repro-check/);
  assert.match(reproducibility, /RUNNER_TEMP\/tsfg-repro/);
  assert.doesNotMatch(reproducibility, /\.ci\/(?:download|evidence)/);
  assert.doesNotMatch(reproducibility, /tsfg-build(?:\.cmd)? (?:build|package)/);

  const evidence = workflowJob(workflow, "candidate-evidence");
  assert.match(evidence, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(evidence, /retention-days: 90/);
  const verified = workflowJob(workflow, "verified-candidate");
  assert.match(verified, /if: \$\{\{ always\(\) \}\}/);
  assert.match(verified, /product-pr-ci\.mjs verdict/);
});

test("candidate verdict requires complete successful matrix evidence before declaring Verified Candidate", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-product-pr-verdict-"));
  const evidence = path.join(sandbox, "evidence");
  const outputPath = path.join(sandbox, "candidate-evidence.json");
  const success = { schemaVersion: "1", status: "success" };
  const targets = ["linux-x86_64-gnu", "windows-x86_64-msvc"];
  const profiles = ["debug", "release"];
  try {
    const manifestPath = path.join(sandbox, "bootstrap", "r00.xml");
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `<manifest>
  <project name="tsfg.git" path="tsfg" revision="${baselineProductRevision}" />
  <project name=".agents.git" path=".agents" revision="${agentRevision}" />
</manifest>\n`);
    const identityResult = invoke([
      "identity", "--manifest", manifestPath,
      "--manifest-name", "bootstrap/r00.xml",
      "--manifest-revision", manifestRevision,
      "--candidate-revision", candidateRevision,
      "--out", path.join(evidence, "identity"),
    ]);
    assert.equal(identityResult.status, 0, identityResult.stderr);
    await writeJson(path.join(evidence, "repository-gates", "report.json"), {
      gates: { format: "passed", license: "passed", lock: "passed", policy: "passed" },
      ...success,
    });
    await writeJson(
      path.join(evidence, "workspace-verification", "report.json"),
      workspaceReport(candidateRevision),
    );
    for (const target of targets) {
      await writeJson(path.join(evidence, "compatibility", target, "report.json"), {
        ...success,
        result: {
          contractSet: { canonical: "{}", id: digest("{}") },
          compatibility: {
            artifacts: { candidate: { productOid: candidateRevision } },
            combinations: [
              { consumer: "baseline", producer: "baseline", status: "passed" },
              { consumer: "baseline", producer: "candidate", status: "passed" },
              { consumer: "candidate", producer: "baseline", status: "passed" },
              { consumer: "candidate", producer: "candidate", status: "passed" },
            ],
          },
          target,
        },
      });
      for (const profile of profiles) {
        const identityDigest = digest(`${target}/${profile}`);
        for (const producer of ["a", "b"]) {
          const root = path.join(evidence, "producers", target, profile, producer);
          await writeJson(path.join(root, "workspace-report.json"), workspaceReport(candidateRevision));
          for (const [command, name] of [["build", "build-report.json"], ["test", "test-report.json"]]) {
            await writeJson(path.join(root, name), {
              command,
              result: { buildIdentity: { digest: identityDigest }, profile, target },
              ...success,
            });
          }
          const archive = `tsfg-${target}-${profile}.archive`;
          await writeJson(path.join(root, "package-report.json"), {
            command: "package",
            result: { archive, buildIdentity: { digest: identityDigest, profile, target } },
            ...success,
          });
          await mkdir(path.join(root, "package"), { recursive: true });
          await writeFile(path.join(root, "package", archive), `${target}/${profile}\n`);
          await writeJson(path.join(root, "package", `${archive}.checksums.json`), { schemaVersion: "1" });
          await writeJson(path.join(root, "package", "producer-attestation.json"), {
            buildIdentityDigest: identityDigest,
            profile,
            producer,
            schemaVersion: "1",
            target,
          });
          await writeJson(path.join(root, "candidate-binding.json"), {
            buildIdentityDigest: identityDigest,
            candidateRevision,
            schemaVersion: "1",
          });
        }
        await writeJson(path.join(evidence, "reproducibility", target, profile, "report.json"), {
          command: "repro-check",
          result: { buildExecuted: false, profile, producers: [{}, {}], target },
          ...success,
        });
      }
    }
    const jobResultsPath = path.join(sandbox, "job-results.json");
    await writeJson(jobResultsPath, {
      "candidate-evidence": "success",
      "candidate-identity": "success",
      compatibility: "success",
      "product-build": "success",
      "repository-gates": "success",
      reproducibility: "success",
      "workspace-verification": "success",
    });

    const result = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", outputPath,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const verdict = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(verdict.candidateRevision, candidateRevision);
    assert.equal(verdict.evidenceRetentionDays, "90");
    assert.equal(verdict.promotionState, "Verified Candidate");
    assert.equal(verdict.requiredEvidence.producers, "8/8");
    assert.equal(verdict.requiredEvidence.reproducibility, "4/4");
    assert.match(verdict.evidenceDigest, /^sha256:[0-9a-f]{64}$/);

    await writeJson(
      path.join(evidence, "workspace-verification", "report.json"),
      workspaceReport(baselineProductRevision),
    );
    const foreignWorkspaceOutput = path.join(sandbox, "foreign-workspace-evidence.json");
    const foreignWorkspace = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", foreignWorkspaceOutput,
    ]);
    assert.notEqual(foreignWorkspace.status, 0);
    await assert.rejects(readFile(foreignWorkspaceOutput));

    await writeJson(
      path.join(evidence, "workspace-verification", "report.json"),
      workspaceReport(candidateRevision),
    );
    const foreignBindingPath = path.join(
      evidence,
      "producers",
      targets[0],
      profiles[0],
      "a",
      "candidate-binding.json",
    );
    const foreignBinding = JSON.parse(await readFile(foreignBindingPath, "utf8"));
    await writeJson(foreignBindingPath, { ...foreignBinding, candidateRevision: baselineProductRevision });
    const foreignBuildOutput = path.join(sandbox, "foreign-build-evidence.json");
    const foreignBuild = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", foreignBuildOutput,
    ]);
    assert.notEqual(foreignBuild.status, 0);
    await assert.rejects(readFile(foreignBuildOutput));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("candidate verdict rejects missing, skipped, cancelled, and failed required jobs without publishing", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-product-pr-job-results-"));
  const baseResults = {
    "candidate-evidence": "success",
    "candidate-identity": "success",
    compatibility: "success",
    "product-build": "success",
    "repository-gates": "success",
    reproducibility: "success",
    "workspace-verification": "success",
  };
  try {
    for (const [index, state] of [undefined, "skipped", "cancelled", "failure"].entries()) {
      const results = { ...baseResults };
      if (state === undefined) delete results["product-build"];
      else results["product-build"] = state;
      const resultsPath = path.join(sandbox, `job-results-${index}.json`);
      const outputPath = path.join(sandbox, `verdict-${index}.json`);
      await writeJson(resultsPath, results);
      const result = invoke([
        "verdict", "--evidence", path.join(sandbox, "missing-evidence"),
        "--job-results", resultsPath,
        "--out", outputPath,
      ]);
      assert.equal(result.status, 1, state ?? "missing");
      assert.match(result.stderr, /required job product-build did not succeed/);
      await assert.rejects(readFile(outputPath), /ENOENT/);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
