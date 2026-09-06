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
const resolvedManifestRevision = "5".repeat(40);
const candidateAgentRevision = "7".repeat(40);

/** @param {string | Buffer} value */
function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function invoke(arguments_, environment = {}) {
  return spawnSync(process.execPath, [productPrCi, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`);
}

function workspaceReport(productRevision, manifestHead = resolvedManifestRevision) {
  return {
    command: "verify-workspace",
    result: {
      manifest: {
        repositoryUrl: "https://github.com/xuelongling/manifests.git",
        revision: manifestHead,
        selected: "bootstrap/r00.xml",
      },
      projects: [
        {
          dirty: false,
          head: productRevision,
          id: "tsfg.git",
          path: "tsfg",
          remote: "https://github.com/xuelongling/tsfg.git",
        },
        {
          dirty: false,
          head: candidateAgentRevision,
          id: ".agents.git",
          path: ".agents",
          remote: "https://github.com/xuelongling/.agents.git",
        },
      ],
      activation: [{
        destination: "AGENTS.md",
        sha256: digest("agent instructions"),
        source: ".agents/AGENTS.md",
        type: "symbolic-link",
      }],
      dirty: false,
      policy: {
        licenseReport: {
          coverage: { covered: 3, percent: "100", total: 3 },
        dependencies: { buildOnly: [], payload: [] },
          inputs: [],
        },
        repositories: [
          { files: 1, id: "manifests", license: "MIT", path: ".repo/manifests" },
          { files: 1, id: ".agents.git", license: "MIT", path: ".agents" },
          { files: 1, id: "tsfg.git", license: "MIT", path: "tsfg" },
        ],
        upstreamForks: [],
      },
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
  const manifestBytes = `<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <remote name="github-xuelongling" fetch="https://github.com/xuelongling/" />
  <project name="tsfg.git" path="tsfg" remote="github-xuelongling" revision="${baselineProductRevision}" />
  <project name=".agents.git" path=".agents" remote="github-xuelongling" revision="${agentRevision}">
    <linkfile src="AGENTS.md" dest="AGENTS.md" />
  </project>
</manifest>
`;
  await writeFile(manifestPath, manifestBytes);

  try {
    const result = invoke([
      "identity",
      "--manifest", manifestPath,
      "--manifest-name", "bootstrap/r00.xml",
      "--manifest-revision", manifestRevision,
      "--candidate-revision", candidateRevision,
      "--agent-revision", candidateAgentRevision,
      "--out", outputPath,
    ]);
    assert.equal(result.status, 0, result.stderr);

    const overlayBytes = await readFile(path.join(outputPath, "candidate-overlay.json"));
    const resolvedBytes = await readFile(path.join(outputPath, "resolved-manifest.json"));
    const resolvedManifestBytes = await readFile(path.join(outputPath, "resolved-manifest.xml"));
    const archivedBaselineBytes = await readFile(path.join(outputPath, "baseline-manifest.xml"));
    const report = JSON.parse(await readFile(path.join(outputPath, "candidate-identity.json"), "utf8"));
    assert.equal(archivedBaselineBytes.toString("utf8"), manifestBytes);
    assert.equal(
      resolvedManifestBytes.toString("utf8"),
      manifestBytes
        .replace(baselineProductRevision, candidateRevision)
        .replace(agentRevision, candidateAgentRevision),
    );
    assert.deepEqual(JSON.parse(overlayBytes.toString("utf8")), {
      baseline: {
        manifest: "bootstrap/r00.xml",
        repository: "https://github.com/xuelongling/manifests.git",
        revision: manifestRevision,
      },
      replacements: [
        { project: ".agents.git", revision: candidateAgentRevision },
        { project: "tsfg.git", revision: candidateRevision },
      ],
      schemaVersion: "1",
    });
    assert.deepEqual(JSON.parse(resolvedBytes.toString("utf8")), {
      baseline: {
        manifest: "bootstrap/r00.xml",
        repository: "https://github.com/xuelongling/manifests.git",
        revision: manifestRevision,
      },
      activation: [
        {
          destination: "AGENTS.md",
          source: ".agents/AGENTS.md",
          type: "symbolic-link",
        },
      ],
      projects: [
        {
          name: ".agents.git",
          path: ".agents",
          remote: "https://github.com/xuelongling/.agents.git",
          revision: candidateAgentRevision,
        },
        {
          name: "tsfg.git",
          path: "tsfg",
          remote: "https://github.com/xuelongling/tsfg.git",
          revision: candidateRevision,
        },
      ],
      schemaVersion: "1",
    });
    const canonicalOverlay = `{"baseline":{"manifest":"bootstrap/r00.xml","repository":"https://github.com/xuelongling/manifests.git","revision":"${manifestRevision}"},"replacements":[{"project":".agents.git","revision":"${candidateAgentRevision}"},{"project":"tsfg.git","revision":"${candidateRevision}"}],"schemaVersion":"1"}`;
    const canonicalResolved = `{"activation":[{"destination":"AGENTS.md","source":".agents/AGENTS.md","type":"symbolic-link"}],"baseline":{"manifest":"bootstrap/r00.xml","repository":"https://github.com/xuelongling/manifests.git","revision":"${manifestRevision}"},"projects":[{"name":".agents.git","path":".agents","remote":"https://github.com/xuelongling/.agents.git","revision":"${candidateAgentRevision}"},{"name":"tsfg.git","path":"tsfg","remote":"https://github.com/xuelongling/tsfg.git","revision":"${candidateRevision}"}],"schemaVersion":"1"}`;
    assert.deepEqual(report, {
      agentRevision: candidateAgentRevision,
      baselineManifestDigest: digest(manifestBytes),
      baselineProductRevision,
      candidateRevision,
      overlayDigest: digest(canonicalOverlay),
      resolvedManifestDigest: digest(canonicalResolved),
      schemaVersion: "1",
    });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("candidate identity retries a transient Windows rename denial", {
  skip: process.platform !== "win32" && "Windows rename retry is Windows-only",
}, async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-product-pr-rename-retry-"));
  const manifestPath = path.join(sandbox, "bootstrap", "r00.xml");
  const outputPath = path.join(sandbox, "identity");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `<manifest>
  <remote name="github-xuelongling" fetch="https://github.com/xuelongling/" />
  <project name="tsfg.git" path="tsfg" remote="github-xuelongling" revision="${baselineProductRevision}" />
  <project name=".agents.git" path=".agents" remote="github-xuelongling" revision="${agentRevision}" />
</manifest>\n`);

  try {
    const result = invoke([
      "identity", "--manifest", manifestPath,
      "--manifest-name", "bootstrap/r00.xml",
      "--manifest-revision", manifestRevision,
      "--candidate-revision", candidateRevision,
      "--agent-revision", candidateAgentRevision,
      "--out", outputPath,
    ], { TSFG_TEST_CANDIDATE_IDENTITY_RENAME_EPERM_ONCE: "1" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(path.join(outputPath, "candidate-identity.json"), "utf8"));
    assert.equal(report.candidateRevision, candidateRevision);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
      "--agent-revision", candidateAgentRevision,
      "--out", outputPath,
    ]);
    assert.equal(result.status, 1);
    assert.equal(await readFile(path.join(outputPath, "sentinel.txt"), "utf8"), "owned by caller\n");
    await assert.rejects(readFile(path.join(outputPath, "baseline-manifest.xml")), /ENOENT/);
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

test("product PR workflow uses the published Bootstrap Integration Snapshot identity", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(
    workflow,
    /^  TSFG_MANIFEST_REVISION: d94f4e6bff9aa980b18b0df94e133559e4b61240$/m,
  );
  assert.match(workflowJob(workflow, "candidate-identity"), /--agent-revision "\$TSFG_AGENT_TOOLS_REVISION"/);
});

test("product PR workflow composes every gate, producer, compatibility lane, and build-free comparator", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const repositoryGates = workflowJob(workflow, "repository-gates");
  assert.match(repositoryGates, /git diff --check/);
  assert.doesNotMatch(repositoryGates, /ecp-gate\.mjs|ecp-report\.json/);
  assert.match(repositoryGates, /workspace-policy-cli\.test\.mjs/);
  assert.match(repositoryGates, /toolchain-lock\.test\.mjs/);
  assert.match(repositoryGates, /contract-compatibility-cli\.test\.mjs/);
  assert.match(repositoryGates, /tsc --noEmit/);

  const workspaceVerification = workflowJob(workflow, "workspace-verification");
  assert.match(workspaceVerification, /verify-workspace/);
  assert.match(
    workspaceVerification,
    /cp "\$GITHUB_WORKSPACE\/\.ci\/manifests\/\$TSFG_SELECTED_MANIFEST" \.ci\/evidence\/workspace-verification\/verified-baseline-manifest\.xml/,
  );
  assert.match(workspaceVerification, /verified-manifest-identity\.json/);
  assert.match(workspaceVerification, /verified-resolved-manifest\.xml/);
  assert.match(
    workspaceVerification,
    /cp "\$workspace\/\.repo\/manifests\/\$TSFG_SELECTED_MANIFEST" \.ci\/evidence\/workspace-verification\/verified-resolved-manifest\.xml/,
  );
  assert.doesNotMatch(
    workspaceVerification,
    /cp "\$workspace\/\.repo\/manifests\/\$TSFG_SELECTED_MANIFEST" \.ci\/evidence\/workspace-verification\/verified-baseline-manifest\.xml/,
  );
  assert.match(workspaceVerification, /git -C "\$workspace\/tsfg" fetch --no-tags "\$GITHUB_WORKSPACE"/);
  assert.match(workspaceVerification, /git -C "\$workspace\/\.agents" fetch --no-tags "\$GITHUB_WORKSPACE\/\.ci\/agent-tools" "\$TSFG_AGENT_TOOLS_REVISION"/);
  assert.match(workspaceVerification, /git -C "\$workspace\/\.agents" checkout --detach FETCH_HEAD/);
  assert.doesNotMatch(workspaceVerification, /\.ci\/candidate-product/);
  const productBuild = workflowJob(workflow, "product-build");
  assert.equal((productBuild.match(/git -C .*\.agents.* fetch --no-tags /g) ?? []).length, 2);
  assert.equal((productBuild.match(/git -C .*\.agents.* checkout --detach FETCH_HEAD/g) ?? []).length, 2);
  assert.match(productBuild, /python "\$env:GITHUB_WORKSPACE\/\.ci\/bootstrap\/repo\.py" init/);
  assert.match(productBuild, /python "\$env:GITHUB_WORKSPACE\/\.ci\/bootstrap\/repo\.py" sync --verify/);
  assert.doesNotMatch(productBuild, /repo\.cmd" (?:init|sync)/);
  assert.match(productBuild, /eng[\\/]tsfg-build(?:\.cmd)?"? build/);
  assert.match(productBuild, /eng[\\/]tsfg-build(?:\.cmd)?"? test/);
  assert.match(productBuild, /eng[\\/]tsfg-build(?:\.cmd)?"? package/);
  assert.match(productBuild, /candidate-binding\.json/);
  assert.match(productBuild, /manifestRevision/);
  assert.match(productBuild, /producer-\$\{\{ matrix\.producer \}\}/);
  assert.match(productBuild, /actions\/cache@[0-9a-f]{40}/);
  assert.match(productBuild, /key: tsfg-tools-\$\{\{ matrix\.target \}\}-\$\{\{ hashFiles\('eng\/toolchains\.lock\.json', 'pnpm-lock\.yaml'\) \}\}/);
  assert.doesNotMatch(productBuild, /restore-keys:/);
  assert.ok(productBuild.indexOf("actions/cache@") < productBuild.indexOf(" prefetch"));
  assert.match(productBuild, /export TSFG_BOOTSTRAP_GIT="\$\(command -v git\)"/);
  assert.match(productBuild, /"TSFG_BOOTSTRAP_GIT_SHA256=\$TSFG_BOOTSTRAP_GIT_SHA256" "\$workspace\/tsfg\/eng\/tsfg-build" build/);

  const compatibility = workflowJob(workflow, "compatibility");
  assert.match(compatibility, /--compatibility-baseline/);
  assert.match(compatibility, /--compatibility-candidate/);
  assert.doesNotMatch(compatibility, /baselineSyntheticArtifact/);
  assert.match(compatibility, /TSFG_BASELINE_COMPATIBILITY_SHA256/);
  assert.match(compatibility, /process\.env\.TSFG_BASELINE_PRODUCT_REVISION/);
  assert.match(compatibility, /join\(process\.env\.RUNNER_TEMP,'tsfg-compatibility','input','baseline\.json'\)/);
  assert.doesNotMatch(compatibility, /readFileSync\('\$compatibility\/input/);
  assert.match(compatibility, /sha256sum --check --strict/);
  assert.match(compatibility, /eb2838e4c4910113b23072b40c526a8b2843f744/);
  assert.match(compatibility, /candidateSyntheticArtifact/);
  assert.match(compatibility, /RUNNER_TEMP\/tsfg-compatibility/);
  assert.doesNotMatch(compatibility, /\.ci\/(?:compatibility|evidence)/);
  const reproducibility = workflowJob(workflow, "reproducibility");
  assert.match(reproducibility, /needs:.*product-build/s);
  assert.match(reproducibility, /repro-check/);
  assert.match(reproducibility, /RUNNER_TEMP\/tsfg-repro/);
  assert.doesNotMatch(reproducibility, /\.ci\/(?:download|evidence)/);
  assert.doesNotMatch(reproducibility, /tsfg-build(?:\.cmd)? (?:build|package)/);
  assert.match(reproducibility, /export TSFG_BOOTSTRAP_GIT="\$\(command -v git\)"/);
  assert.match(reproducibility, /"TSFG_BOOTSTRAP_GIT_SHA256=\$TSFG_BOOTSTRAP_GIT_SHA256" "\$GITHUB_WORKSPACE\/eng\/tsfg-build" repro-check/);

  const evidence = workflowJob(workflow, "candidate-evidence");
  assert.match(evidence, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(evidence, /retention-days: 90/);
  const verified = workflowJob(workflow, "verified-candidate");
  assert.match(verified, /if: \$\{\{ always\(\) \}\}/);
  assert.match(verified, /product-pr-ci\.mjs verdict/);
});

test("product PR workflow isolates every Linux offline phase in a loopback-only namespace", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const jobs = [
    workflowJob(workflow, "repository-gates"),
    workflowJob(workflow, "workspace-verification"),
    workflowJob(workflow, "product-build"),
    workflowJob(workflow, "compatibility"),
    workflowJob(workflow, "reproducibility"),
  ];
  for (const job of jobs) {
    assert.match(job, /sudo sysctl -q kernel\.apparmor_restrict_unprivileged_userns=0/);
    assert.match(job, /sudo unshare --net bash -ceu/);
    assert.doesNotMatch(job, /unshare --user/);
    assert.doesNotMatch(job, /unshare --mount/);
    assert.doesNotMatch(job, /mount -t sysfs/);
    assert.match(job, /ip link set lo up/);
    assert.match(job, /\[ "\$\(ip -o link show \| wc -l\)" -eq 1 \]/);
    assert.match(job, /ip -o link show dev lo >\/dev\/null/);
    assert.match(job, /exec setpriv --reuid "\$SUDO_UID" --regid "\$SUDO_GID" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs -- "\$@"/);
  }

  const assertions = [
    [jobs[0], /contract-compatibility-cli\.test\.mjs/],
    [jobs[1], /eng\/tsfg-build" verify-workspace/],
    [jobs[2], /eng\/tsfg-build" verify-workspace/],
    [jobs[2], /eng\/tsfg-build" build/],
    [jobs[2], /eng\/tsfg-build" test/],
    [jobs[2], /eng\/tsfg-build" package/],
    [jobs[3], /eng\/tsfg-build" test/],
    [jobs[4], /eng\/tsfg-build" repro-check/],
  ];
  for (const [job, command] of assertions) {
    const line = job.split("\n").find((candidate) => command.test(candidate));
    assert.ok(line, `missing offline command ${command}`);
    assert.match(line, /^\s*run_offline /, `${command} bypasses the offline namespace`);
  }

  assert.doesNotMatch(jobs[1], /^\s*run_offline .* prefetch /m);
  assert.doesNotMatch(jobs[3], /^\s*run_offline .* prefetch /m);
});

test("product PR result commands enter through verified public launchers", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const workspaceVerification = workflowJob(workflow, "workspace-verification");
  const compatibility = workflowJob(workflow, "compatibility");

  assert.match(workspaceVerification, /actions\/cache@[0-9a-f]{40}/);
  assert.match(workspaceVerification, /TSFG_BOOTSTRAP_NODE_SHA256/);
  assert.match(workspaceVerification, /TSFG_BOOTSTRAP_GIT_SHA256/);
  assert.match(workspaceVerification, /eng\/tsfg-build" prefetch/);
  assert.match(workspaceVerification, /eng\/tsfg-build" verify-workspace/);
  assert.doesNotMatch(workspaceVerification, /tsfg-build\.mjs" verify-workspace/);

  assert.match(compatibility, /TSFG_BOOTSTRAP_NODE_SHA256/);
  assert.match(compatibility, /TSFG_BOOTSTRAP_GIT_SHA256/);
  assert.match(compatibility, /eng\/tsfg-build prefetch/);
  assert.match(compatibility, /eng\\tsfg-build\.cmd prefetch/);
  assert.match(compatibility, /eng\/tsfg-build" test/);
  assert.match(compatibility, /eng\\tsfg-build\.cmd test/);
  assert.doesNotMatch(compatibility, /eng\/tsfg-build\.mjs test/);
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
    const baselineManifestBytes = `<manifest>
  <remote name="github-xuelongling" fetch="https://github.com/xuelongling/" />
  <project name="tsfg.git" path="tsfg" remote="github-xuelongling" revision="${baselineProductRevision}" />
  <project name=".agents.git" path=".agents" remote="github-xuelongling" revision="${agentRevision}">
    <linkfile src="AGENTS.md" dest="AGENTS.md" />
  </project>
</manifest>\n`;
    await writeFile(manifestPath, baselineManifestBytes);
    const identityResult = invoke([
      "identity", "--manifest", manifestPath,
      "--manifest-name", "bootstrap/r00.xml",
      "--manifest-revision", manifestRevision,
      "--candidate-revision", candidateRevision,
      "--agent-revision", candidateAgentRevision,
      "--out", path.join(evidence, "identity"),
    ]);
    assert.equal(identityResult.status, 0, identityResult.stderr);
    await writeJson(path.join(evidence, "repository-gates", "report.json"), {
      gates: {
        compatibility: "passed",
        format: "passed",
        license: "passed",
        lock: "passed",
        policy: "passed",
      },
      ...success,
    });
    await writeJson(
      path.join(evidence, "workspace-verification", "report.json"),
      workspaceReport(candidateRevision),
    );
    await writeFile(
      path.join(evidence, "workspace-verification", "verified-baseline-manifest.xml"),
      baselineManifestBytes,
    );
    const resolvedManifestBytes = baselineManifestBytes
      .replace(baselineProductRevision, candidateRevision)
      .replace(agentRevision, candidateAgentRevision);
    await writeFile(
      path.join(evidence, "workspace-verification", "verified-resolved-manifest.xml"),
      resolvedManifestBytes,
    );
    await writeJson(
      path.join(evidence, "workspace-verification", "verified-manifest-identity.json"),
      {
        manifestRevision: resolvedManifestRevision,
        manifestUrl: "https://github.com/xuelongling/manifests.git",
        selectedManifest: "bootstrap/r00.xml",
      },
    );
    for (const target of targets) {
      const compatibilityRoot = path.join(evidence, "compatibility", target);
      const baselineArtifact = { product: { commitOid: baselineProductRevision } };
      const candidateArtifact = { product: { commitOid: candidateRevision } };
      const baselineArtifactBytes = `${JSON.stringify(baselineArtifact)}\n`;
      const candidateArtifactBytes = `${JSON.stringify(candidateArtifact)}\n`;
      await writeJson(path.join(compatibilityRoot, "baseline.json"), baselineArtifact);
      await writeJson(path.join(compatibilityRoot, "candidate.json"), candidateArtifact);
      await writeJson(path.join(compatibilityRoot, "report.json"), {
        ...success,
        result: {
          contractSet: { canonical: "{}", id: digest("{}") },
          compatibility: {
            artifacts: {
              baseline: { productOid: baselineProductRevision, sha256: digest(baselineArtifactBytes) },
              candidate: { productOid: candidateRevision, sha256: digest(candidateArtifactBytes) },
            },
            combinations: [
              { consumer: "baseline", consumerProductOid: baselineProductRevision, producer: "baseline", producerProductOid: baselineProductRevision, status: "passed" },
              { consumer: "baseline", consumerProductOid: baselineProductRevision, producer: "candidate", producerProductOid: candidateRevision, status: "passed" },
              { consumer: "candidate", consumerProductOid: candidateRevision, producer: "baseline", producerProductOid: baselineProductRevision, status: "passed" },
              { consumer: "candidate", consumerProductOid: candidateRevision, producer: "candidate", producerProductOid: candidateRevision, status: "passed" },
            ],
          },
          target,
        },
      });
      for (const profile of profiles) {
        const identityDigest = digest(`${target}/${profile}`);
        const buildIdentity = { digest: identityDigest, profile, target };
        const buildInputSetPayload = { entries: [], schemaVersion: "1" };
        const buildInputSet = {
          digest: digest(canonicalize(buildInputSetPayload)),
          ...buildInputSetPayload,
        };
        const producerWorkspacePaths = {};
        let archive;
        let archiveBytes;
        let checksumsBytes;
        let compared;
        for (const producer of ["a", "b"]) {
          const root = path.join(evidence, "producers", target, profile, producer);
          producerWorkspacePaths[producer] = `${root}-workspace`;
          await writeJson(path.join(root, "workspace-report.json"), workspaceReport(candidateRevision));
          for (const [command, name] of [["build", "build-report.json"], ["test", "test-report.json"]]) {
            await writeJson(path.join(root, name), {
              command,
              result: { buildIdentity, profile, target },
              ...success,
            });
          }
          archive = `tsfg-${target}-${profile}.archive`;
          archiveBytes = `${target}/${profile}\n`;
          const checksums = { schemaVersion: "1" };
          checksumsBytes = `${JSON.stringify(checksums)}\n`;
          await writeJson(path.join(root, "package-report.json"), {
            command: "package",
            result: { archive, buildIdentity, buildInputSet },
            ...success,
          });
          await mkdir(path.join(root, "package"), { recursive: true });
          await writeFile(path.join(root, "package", archive), archiveBytes);
          await writeJson(path.join(root, "package", `${archive}.checksums.json`), checksums);
          await writeJson(path.join(root, "package", "producer-attestation.json"), {
            buildExecutionId: `${target}/${profile}/${producer}`,
            buildIdentityDigest: identityDigest,
            profile,
            schemaVersion: "1",
            target,
            workspacePath: producerWorkspacePaths[producer],
          });
          await writeJson(path.join(root, "candidate-binding.json"), {
            buildIdentityDigest: identityDigest,
            candidateRevision,
            manifestRevision: resolvedManifestRevision,
            schemaVersion: "1",
          });
          compared ??= [
            { path: `package/${archive}`, sha256: digest(archiveBytes) },
            { path: `package/${archive}.checksums.json`, sha256: digest(checksumsBytes) },
          ];
        }
        await writeJson(path.join(evidence, "reproducibility", target, profile, "report.json"), {
          command: "repro-check",
          result: {
            buildExecuted: false,
            buildIdentity,
            buildInputSet,
            comparator: {
              buildIdentityDigest: identityDigest,
              buildInputSetDigest: buildInputSet.digest,
              workspacePath: path.join(evidence, "reproducibility", target, profile, "workspace"),
            },
            compared,
            producers: [
              {
                archive,
                archiveSha256: digest(archiveBytes),
                artifactPath: path.join(evidence, "producers", target, profile, "a", "package"),
                buildExecutionId: `${target}/${profile}/a`,
                buildIdentityDigest: identityDigest,
                checksumsSha256: digest(checksumsBytes),
                label: "a",
                workspacePath: producerWorkspacePaths.a,
              },
              {
                archive,
                archiveSha256: digest(archiveBytes),
                artifactPath: path.join(evidence, "producers", target, profile, "b", "package"),
                buildExecutionId: `${target}/${profile}/b`,
                buildIdentityDigest: identityDigest,
                checksumsSha256: digest(checksumsBytes),
                label: "b",
                workspacePath: producerWorkspacePaths.b,
              },
            ],
            profile,
            reproducibilitySetDigest: digest(canonicalize({ entries: compared, schemaVersion: "1" })),
            target,
          },
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

    const workspaceReportPath = path.join(evidence, "workspace-verification", "report.json");
    const malformedWorkspaceReport = workspaceReport(candidateRevision);
    // @ts-expect-error Deliberately replace the schema with stale evidence.
    malformedWorkspaceReport.result.policy.licenseReport.dependencies = [];
    await writeJson(workspaceReportPath, malformedWorkspaceReport);
    const malformedPolicyOutput = path.join(sandbox, "malformed-policy-evidence.json");
    const malformedPolicy = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", malformedPolicyOutput,
    ]);
    assert.notEqual(malformedPolicy.status, 0);
    assert.match(malformedPolicy.stderr, /complete workspace policy evidence/);
    await assert.rejects(readFile(malformedPolicyOutput));
    await writeJson(workspaceReportPath, workspaceReport(candidateRevision));

    const overlayPath = path.join(evidence, "identity", "candidate-overlay.json");
    const canonicalOverlayBytes = await readFile(overlayPath);
    await writeFile(
      overlayPath,
      `${JSON.stringify(JSON.parse(canonicalOverlayBytes.toString("utf8")), null, 2)}\n`,
    );
    const noncanonicalOverlayOutput = path.join(sandbox, "noncanonical-overlay-evidence.json");
    const noncanonicalOverlay = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", noncanonicalOverlayOutput,
    ]);
    assert.notEqual(noncanonicalOverlay.status, 0);
    assert.match(noncanonicalOverlay.stderr, /Candidate Overlay must use canonical JSON/);
    await assert.rejects(readFile(noncanonicalOverlayOutput));
    await writeFile(overlayPath, canonicalOverlayBytes);

    const loneSurrogateOverlay = canonicalOverlayBytes.toString("utf8").trimEnd()
      .replace(/}$/, ',"x":"\\ud800"}');
    await writeFile(overlayPath, `${loneSurrogateOverlay}\n`);
    const nonIJsonOverlayOutput = path.join(sandbox, "non-ijson-overlay-evidence.json");
    const nonIJsonOverlay = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", nonIJsonOverlayOutput,
    ]);
    assert.notEqual(nonIJsonOverlay.status, 0);
    assert.match(nonIJsonOverlay.stderr, /non-I-JSON string/);
    await assert.rejects(readFile(nonIJsonOverlayOutput));
    await writeFile(overlayPath, canonicalOverlayBytes);

    const verifiedManifestIdentityPath = path.join(
      evidence,
      "workspace-verification",
      "verified-manifest-identity.json",
    );
    await writeJson(verifiedManifestIdentityPath, {
      manifestRevision: "6".repeat(40),
      manifestUrl: "https://github.com/xuelongling/manifests.git",
      selectedManifest: "bootstrap/r00.xml",
    });
    const foreignManifestHeadOutput = path.join(sandbox, "foreign-manifest-head.json");
    const foreignManifestHead = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", foreignManifestHeadOutput,
    ]);
    assert.notEqual(foreignManifestHead.status, 0);
    await assert.rejects(readFile(foreignManifestHeadOutput));
    await writeJson(verifiedManifestIdentityPath, {
      manifestRevision: resolvedManifestRevision,
      manifestUrl: "https://github.com/xuelongling/manifests.git",
      selectedManifest: "bootstrap/r00.xml",
    });

    const archivedBaselinePath = path.join(evidence, "identity", "baseline-manifest.xml");
    await writeFile(
      archivedBaselinePath,
      baselineManifestBytes.replace(baselineProductRevision, candidateRevision),
    );
    const tamperedBaselineOutput = path.join(sandbox, "tampered-baseline-evidence.json");
    const tamperedBaseline = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", tamperedBaselineOutput,
    ]);
    assert.notEqual(tamperedBaseline.status, 0);
    await assert.rejects(readFile(tamperedBaselineOutput));
    await writeFile(archivedBaselinePath, baselineManifestBytes);

    const verifiedBaselinePath = path.join(
      evidence,
      "workspace-verification",
      "verified-baseline-manifest.xml",
    );
    await writeFile(
      verifiedBaselinePath,
      baselineManifestBytes.replace(agentRevision, candidateRevision),
    );
    const foreignVerifiedBaselineOutput = path.join(sandbox, "foreign-verified-baseline-evidence.json");
    const foreignVerifiedBaseline = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", foreignVerifiedBaselineOutput,
    ]);
    assert.notEqual(foreignVerifiedBaseline.status, 0);
    await assert.rejects(readFile(foreignVerifiedBaselineOutput));
    await writeFile(verifiedBaselinePath, baselineManifestBytes);

    const verifiedResolvedPath = path.join(
      evidence,
      "workspace-verification",
      "verified-resolved-manifest.xml",
    );
    await writeFile(
      verifiedResolvedPath,
      resolvedManifestBytes.replace(candidateAgentRevision, "6".repeat(40)),
    );
    const foreignResolvedManifestOutput = path.join(sandbox, "foreign-resolved-manifest.json");
    const foreignResolvedManifest = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", foreignResolvedManifestOutput,
    ]);
    assert.notEqual(foreignResolvedManifest.status, 0);
    await assert.rejects(readFile(foreignResolvedManifestOutput));
    await writeFile(verifiedResolvedPath, resolvedManifestBytes);

    const producerWorkspaceReportPath = path.join(
      evidence,
      "producers",
      targets[0],
      profiles[0],
      "a",
      "workspace-report.json",
    );
    const divergentProducerWorkspace = JSON.parse(await readFile(producerWorkspaceReportPath, "utf8"));
    divergentProducerWorkspace.result.activation[0].sha256 = digest("different activation");
    await writeJson(producerWorkspaceReportPath, divergentProducerWorkspace);
    const divergentActivationOutput = path.join(sandbox, "divergent-activation-evidence.json");
    const divergentActivation = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", divergentActivationOutput,
    ]);
    assert.notEqual(divergentActivation.status, 0);
    await assert.rejects(readFile(divergentActivationOutput));
    divergentProducerWorkspace.result.activation[0].sha256 = digest("agent instructions");
    divergentProducerWorkspace.result.policy.repositories[0].files += 1;
    await writeJson(producerWorkspaceReportPath, divergentProducerWorkspace);
    const divergentPolicyOutput = path.join(sandbox, "divergent-policy-evidence.json");
    const divergentPolicy = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", divergentPolicyOutput,
    ]);
    assert.notEqual(divergentPolicy.status, 0);
    await assert.rejects(readFile(divergentPolicyOutput));
    await writeJson(producerWorkspaceReportPath, workspaceReport(candidateRevision));

    const reproReportPath = path.join(
      evidence,
      "reproducibility",
      targets[0],
      profiles[0],
      "report.json",
    );
    const foreignRepro = JSON.parse(await readFile(reproReportPath, "utf8"));
    foreignRepro.result.buildIdentity.digest = digest("foreign build");
    await writeJson(reproReportPath, foreignRepro);
    const foreignReproOutput = path.join(sandbox, "foreign-repro-evidence.json");
    const foreignReproResult = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", foreignReproOutput,
    ]);
    assert.notEqual(foreignReproResult.status, 0);
    await assert.rejects(readFile(foreignReproOutput));
    foreignRepro.result.buildIdentity.digest = digest(`${targets[0]}/${profiles[0]}`);
    await writeJson(reproReportPath, foreignRepro);

    foreignRepro.result.producers[0].artifactPath = foreignRepro.result.producers[1].artifactPath;
    await writeJson(reproReportPath, foreignRepro);
    const foreignProducerOutput = path.join(sandbox, "foreign-repro-producer-evidence.json");
    const foreignProducer = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", foreignProducerOutput,
    ]);
    assert.notEqual(foreignProducer.status, 0);
    await assert.rejects(readFile(foreignProducerOutput));
    foreignRepro.result.producers[0].artifactPath = path.join(
      evidence,
      "producers",
      targets[0],
      profiles[0],
      "a",
      "package",
    );
    for (const [field, value] of [
      ["archive", "foreign.archive"],
      ["archiveSha256", digest("foreign archive")],
      ["checksumsSha256", digest("foreign checksums")],
      ["buildExecutionId", "foreign execution"],
    ]) {
      const original = foreignRepro.result.producers[0][field];
      foreignRepro.result.producers[0][field] = value;
      await writeJson(reproReportPath, foreignRepro);
      const tamperedProducerOutput = path.join(sandbox, `foreign-repro-${field}.json`);
      const tamperedProducer = invoke([
        "verdict", "--evidence", evidence,
        "--job-results", jobResultsPath,
        "--out", tamperedProducerOutput,
      ]);
      assert.notEqual(tamperedProducer.status, 0, field);
      await assert.rejects(readFile(tamperedProducerOutput));
      foreignRepro.result.producers[0][field] = original;
    }
    await writeJson(reproReportPath, foreignRepro);
    foreignRepro.result.reproducibilitySetDigest = digest("foreign set");
    await writeJson(reproReportPath, foreignRepro);
    const foreignSetOutput = path.join(sandbox, "foreign-repro-set-evidence.json");
    const foreignSet = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", foreignSetOutput,
    ]);
    assert.notEqual(foreignSet.status, 0);
    await assert.rejects(readFile(foreignSetOutput));
    foreignRepro.result.reproducibilitySetDigest = digest(canonicalize({
      entries: foreignRepro.result.compared,
      schemaVersion: "1",
    }));
    await writeJson(reproReportPath, foreignRepro);

    foreignRepro.result.comparator.buildInputSetDigest = digest("foreign inputs");
    await writeJson(reproReportPath, foreignRepro);
    const foreignComparatorOutput = path.join(sandbox, "foreign-repro-comparator-evidence.json");
    const foreignComparator = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", foreignComparatorOutput,
    ]);
    assert.notEqual(foreignComparator.status, 0);
    await assert.rejects(readFile(foreignComparatorOutput));
    foreignRepro.result.comparator.buildInputSetDigest = foreignRepro.result.buildInputSet.digest;
    await writeJson(reproReportPath, foreignRepro);

    const compatibilityReportPath = path.join(
      evidence,
      "compatibility",
      targets[0],
      "report.json",
    );
    const mixedCompatibility = JSON.parse(await readFile(compatibilityReportPath, "utf8"));
    mixedCompatibility.result.compatibility.combinations[1].consumerProductOid = candidateRevision;
    await writeJson(compatibilityReportPath, mixedCompatibility);
    const mixedCompatibilityOutput = path.join(sandbox, "mixed-compatibility-evidence.json");
    const mixedCompatibilityResult = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", mixedCompatibilityOutput,
    ]);
    assert.notEqual(mixedCompatibilityResult.status, 0);
    await assert.rejects(readFile(mixedCompatibilityOutput));
    mixedCompatibility.result.compatibility.combinations[1].consumerProductOid = baselineProductRevision;
    await writeJson(compatibilityReportPath, mixedCompatibility);

    const baselineArtifactPath = path.join(
      evidence,
      "compatibility",
      targets[0],
      "baseline.json",
    );
    const baselineArtifactBytes = await readFile(baselineArtifactPath);
    await writeFile(baselineArtifactPath, Buffer.concat([baselineArtifactBytes, Buffer.from(" ")]));
    const tamperedArtifactOutput = path.join(sandbox, "tampered-compatibility-artifact.json");
    const tamperedArtifact = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", tamperedArtifactOutput,
    ]);
    assert.notEqual(tamperedArtifact.status, 0);
    await assert.rejects(readFile(tamperedArtifactOutput));
    await writeFile(baselineArtifactPath, baselineArtifactBytes);

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

    const wrongRemoteReport = workspaceReport(candidateRevision);
    wrongRemoteReport.result.projects[0].remote = "https://example.invalid/tsfg.git";
    await writeJson(
      path.join(evidence, "workspace-verification", "report.json"),
      wrongRemoteReport,
    );
    const wrongRemoteOutput = path.join(sandbox, "wrong-remote-evidence.json");
    const wrongRemote = invoke([
      "verdict", "--evidence", evidence,
      "--job-results", jobResultsPath,
      "--out", wrongRemoteOutput,
    ]);
    assert.notEqual(wrongRemote.status, 0);
    await assert.rejects(readFile(wrongRemoteOutput));

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
    for (const [field, value] of [
      ["candidateRevision", baselineProductRevision],
      ["manifestRevision", "6".repeat(40)],
    ]) {
      await writeJson(foreignBindingPath, { ...foreignBinding, [field]: value });
      const foreignBuildOutput = path.join(sandbox, `foreign-build-${field}.json`);
      const foreignBuild = invoke([
        "verdict", "--evidence", evidence,
        "--job-results", jobResultsPath,
        "--out", foreignBuildOutput,
      ]);
      assert.notEqual(foreignBuild.status, 0, field);
      await assert.rejects(readFile(foreignBuildOutput));
    }
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
