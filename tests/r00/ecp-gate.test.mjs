// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const gatePath = path.join(productRoot, "eng", "ecp-gate.mjs");

function git(repository, ...arguments_) {
  const result = spawnSync("git", arguments_, { cwd: repository, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function commit(repository, message) {
  git(repository, "add", ".");
  git(repository, "commit", "--quiet", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

function acceptedProposal(boundaries = ["contract-schema"]) {
  return `<!-- SPDX-License-Identifier: MIT -->

# ECP 2026-0001: Contract fixture

Status: accepted
Owner: @human-maintainer
Affected boundaries: ${boundaries.join(", ")}

## Context

The fixture changes a governed engineering boundary.

## Goals

Make the intended boundary change explicit.

## Non-goals

Do not change unrelated implementation behavior.

## Affected contracts

The public fixture schema is affected.

## Alternatives

Keep the existing schema unchanged.

## Compatibility

Consumers must migrate before removal.

## Migration and rollback

Land compatibility support first; revert before removal if verification fails.

## Security and licensing

No security or license impact is expected.

## Verification evidence

Compatibility fixtures and repository gates must pass.

## Decision

Accepted by the responsible human owner.
`;
}

async function fixture(files = {}) {
  const repository = await mkdtemp(path.join(tmpdir(), "tsfg-ecp-gate-"));
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "tsfg ECP fixture");
  git(repository, "config", "user.email", "ecp-fixture@tsfg.invalid");
  await writeFile(path.join(repository, "README.md"), "fixture\n");
  for (const directory of [".github", "contracts", "docs", "eng", "tests"]) {
    await mkdir(path.join(repository, directory), { recursive: true });
    await writeFile(path.join(repository, directory, ".keep"), "fixture\n");
  }
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(repository, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
  }
  const base = await commit(repository, "base");
  return { base, repository };
}

async function invoke(repository, base, head, body = "", executable = gatePath) {
  const eventPath = path.join(repository, "event.json");
  const reportPath = path.join(repository, "ecp-report.json");
  await writeFile(eventPath, `${JSON.stringify({ pull_request: { body } })}\n`);
  const result = spawnSync(process.execPath, [
    executable,
    "--repository", repository,
    "--base", base,
    "--head", head,
    "--event", eventPath,
    "--report", reportPath,
  ], { cwd: repository, encoding: "utf8" });
  return { report: JSON.parse(await readFile(reportPath, "utf8")), result };
}

test("a candidate cannot replace the trusted base gate with an allow-all implementation", async () => {
  const trustedGate = await readFile(gatePath, "utf8");
  const { base, repository } = await fixture({ "eng/ecp-gate.mjs": trustedGate });
  try {
    await writeFile(path.join(repository, "eng", "ecp-gate.mjs"), "process.exit(0);\n");
    await writeFile(path.join(repository, "contracts", "public.schema.json"), "{}\n");
    const head = await commit(repository, "replace candidate gate");
    const extractedGate = path.join(repository, "trusted-base-gate.mjs");
    await writeFile(extractedGate, `${git(repository, "show", `${base}:eng/ecp-gate.mjs`)}\n`);

    const { report, result } = await invoke(repository, base, head, "", extractedGate);

    assert.equal(result.status, 1);
    assert.equal(report.status, "blocked");
    assert.deepEqual(report.requiredBoundaries, ["contract-schema"]);
    assert.equal(report.issues[0].code, "ecp-reference-required");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("contract boundary changes fail closed without a preceding ECP", async () => {
  const { base, repository } = await fixture();
  try {
    await mkdir(path.join(repository, "contracts"), { recursive: true });
    await writeFile(path.join(repository, "contracts", "public.schema.json"), "{}\n");
    const head = await commit(repository, "change contract schema");

    const { report, result } = await invoke(repository, base, head);

    assert.equal(result.status, 1);
    assert.equal(report.status, "blocked");
    assert.deepEqual(report.requiredBoundaries, ["contract-schema"]);
    assert.equal(report.issues[0].code, "ecp-reference-required");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("a preceding accepted ECP covering the classified boundary passes", async () => {
  const proposalPath = "docs/proposals/2026-0001-contract-fixture.md";
  const { base, repository } = await fixture({ [proposalPath]: acceptedProposal() });
  try {
    await mkdir(path.join(repository, "contracts"), { recursive: true });
    await writeFile(path.join(repository, "contracts", "public.schema.json"), "{}\n");
    const head = await commit(repository, "change contract schema");

    const { report, result } = await invoke(repository, base, head, `ECP: ${proposalPath}`);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.status, "passed");
    assert.deepEqual(report.requiredBoundaries, ["contract-schema"]);
    assert.deepEqual(report.proposal, {
      affectedBoundaries: ["contract-schema"],
      baseBlobOid: git(repository, "rev-parse", `${base}:${proposalPath}`),
      baseStatus: "accepted",
      headBlobOid: git(repository, "rev-parse", `${head}:${proposalPath}`),
      headStatus: "accepted",
      owner: "@human-maintainer",
      path: proposalPath,
      status: "accepted",
    });
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("toolchain patch changes remain ordinary but major or minor changes require an ECP", async () => {
  for (const scenario of [
    { expected: [], from: "4.4.3", to: "4.4.4" },
    { expected: ["toolchain-major-minor"], from: "4.4.3", to: "4.5.0" },
    { expected: ["toolchain-major-minor"], from: "4.4.3", to: "5.0.0" },
  ]) {
    const lock = (version) => `${JSON.stringify({
      schemaVersion: "1",
      targets: { "linux-x86_64-gnu": { tools: ["cmake"] } },
      tools: { cmake: { version } },
    })}\n`;
    const { base, repository } = await fixture({ "eng/toolchains.lock.json": lock(scenario.from) });
    try {
      await writeFile(path.join(repository, "eng", "toolchains.lock.json"), lock(scenario.to));
      const head = await commit(repository, `update CMake to ${scenario.to}`);
      const { report, result } = await invoke(repository, base, head);

      assert.deepEqual(report.requiredBoundaries, scenario.expected);
      assert.equal(result.status, scenario.expected.length === 0 ? 0 : 1);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }
});

test("authoritative engineering boundary changes are classified while ordinary data updates are exempt", async () => {
  const lock = (targets) => `${JSON.stringify({
    schemaVersion: "1",
    targets: Object.fromEntries(targets.map((target) => [target, { tools: ["cmake"] }])),
    tools: { cmake: { version: "4.4.3" } },
  })}\n`;
  const buildInputs = (schemaVersion, entries) => `${JSON.stringify({ entries, schemaVersion })}\n`;
  const workflow = (permissions, runner) => `on:\n  pull_request:\npermissions:\n  contents: ${permissions}\njobs:\n  gate:\n    runs-on: ${runner}\n`;
  const scenarios = [
    {
      baseFiles: {},
      changedPath: "runtime/main.c",
      contents: "int main(void) { return 0; }\n",
      expected: ["repository-topology"],
    },
    {
      baseFiles: { "eng/build-inputs.json": buildInputs("1", []) },
      changedPath: "eng/build-inputs.json",
      contents: buildInputs("2", []),
      expected: ["build-input-set"],
    },
    {
      baseFiles: { "eng/build-inputs.json": buildInputs("1", []) },
      changedPath: "eng/build-inputs.json",
      contents: buildInputs("1", [{ path: "runtime/main.c", projectId: "tsfg" }]),
      expected: [],
    },
    {
      baseFiles: { "eng/toolchains.lock.json": lock(["linux-x86_64-gnu"]) },
      changedPath: "eng/toolchains.lock.json",
      contents: lock(["linux-x86_64-gnu", "windows-x86_64-msvc"]),
      expected: ["tier-1"],
    },
    {
      baseFiles: { "eng/toolchains.lock.json": lock(["linux-x86_64-gnu"]) },
      changedPath: "eng/toolchains.lock.json",
      contents: lock(["linux-x86_64-gnu"]).replace('["cmake"]', '["cmake","zig"]'),
      expected: ["tier-1"],
    },
    {
      baseFiles: { "eng/toolchains.lock.json": lock(["linux-x86_64-gnu"]) },
      changedPath: "eng/toolchains.lock.json",
      contents: lock(["linux-x86_64-gnu"]).replace('"schemaVersion":"1"', '"schemaVersion":"2"'),
      expected: ["build-identity"],
    },
    {
      baseFiles: { ".github/workflows/product-pr.yml": workflow("read", "ubuntu-24.04") },
      changedPath: ".github/workflows/product-pr.yml",
      contents: workflow("write", "ubuntu-24.04"),
      expected: ["release-security"],
    },
    {
      baseFiles: { ".github/workflows/product-pr.yml": workflow("read", "ubuntu-24.04") },
      changedPath: ".github/workflows/product-pr.yml",
      contents: workflow("read", "ubuntu-26.04"),
      expected: ["tier-1"],
    },
    {
      baseFiles: { ".github/workflows/product-pr.yml": workflow("read", "ubuntu-24.04") },
      changedPath: ".github/workflows/product-pr.yml",
      contents: workflow("read", "ubuntu-24.04").replace("pull_request:", "push:"),
      expected: ["release-security"],
    },
    {
      baseFiles: { "eng/helper.mjs": "export const value = 1;\n" },
      changedPath: "eng/helper.mjs",
      contents: "export const value = 2;\n",
      expected: [],
    },
  ];

  for (const scenario of scenarios) {
    const { base, repository } = await fixture(scenario.baseFiles);
    try {
      const absolutePath = path.join(repository, scenario.changedPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, scenario.contents);
      const head = await commit(repository, `change ${scenario.changedPath}`);
      const { report, result } = await invoke(repository, base, head);

      assert.deepEqual(report.requiredBoundaries, scenario.expected, scenario.changedPath);
      assert.equal(result.status, scenario.expected.length === 0 ? 0 : 1, scenario.changedPath);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }
});

test("contract registry, charter, ADR, and workflow lifecycle changes require the matching ECP classes", async () => {
  const cases = [
    {
      baseFiles: { "contracts/registry.json": "{}\n" },
      changedPath: "contracts/registry.json",
      contents: `${JSON.stringify({ api: { compatibility: "backward", version: "1.0.0" } })}\n`,
      expected: ["compatibility-window", "contract-schema"],
    },
    {
      baseFiles: { "docs/r00-engineering-charter.md": "## 8. 规范数据与 Build Identity\n\nold rule\n" },
      changedPath: "docs/r00-engineering-charter.md",
      contents: "## 8. 规范数据与 Build Identity\n\nnew rule\n",
      expected: ["build-identity", "build-input-set"],
    },
    {
      baseFiles: {},
      changedPath: "docs/adr/0001-new-decision.md",
      contents: "# durable decision\n",
      expected: ["durable-decision"],
    },
    {
      baseFiles: {},
      changedPath: ".github/workflows/new-boundary.yml",
      contents: "on:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  gate:\n    runs-on: ubuntu-24.04\n",
      expected: ["release-security", "tier-1"],
    },
  ];

  for (const scenario of cases) {
    const { base, repository } = await fixture(scenario.baseFiles);
    try {
      const absolutePath = path.join(repository, scenario.changedPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, scenario.contents);
      const head = await commit(repository, `change ${scenario.changedPath}`);
      const { report, result } = await invoke(repository, base, head);

      assert.equal(result.status, 1, scenario.changedPath);
      assert.deepEqual(report.requiredBoundaries, scenario.expected, scenario.changedPath);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }
});

test("release-security classification covers credential seams and sensitive step control flow", async () => {
  const scenarios = [
    {
      before: `on:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  publish:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Publish release\n        if: false\n        run: gh release create v1\n`,
      after: `on:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  publish:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Publish release\n        if: true\n        run: gh release create v1\n`,
    },
    {
      before: `on:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  gate:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Authenticate\n        env:\n          RELEASE_TOKEN: \${{ secrets.OLD_TOKEN }}\n        run: test -n "$RELEASE_TOKEN"\n`,
      after: `on:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  gate:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Authenticate\n        env:\n          RELEASE_TOKEN: \${{ secrets.NEW_TOKEN }}\n        run: test -n "$RELEASE_TOKEN"\n`,
    },
    {
      before: `on:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  gate:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@${"1".repeat(40)}\n        with:\n          persist-credentials: false\n`,
      after: `on:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  gate:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@${"2".repeat(40)}\n        with:\n          token: \${{ github.token }}\n`,
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const workflowPath = `.github/workflows/security-${index}.yml`;
    const { base, repository } = await fixture({ [workflowPath]: scenario.before });
    try {
      await writeFile(path.join(repository, workflowPath), scenario.after);
      const head = await commit(repository, `change credential seam ${index}`);
      const { report, result } = await invoke(repository, base, head);
      assert.equal(result.status, 1);
      assert.deepEqual(report.requiredBoundaries, ["release-security"]);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }
});

test("ECP references fail closed when they are late, unaccepted, ambiguous, incomplete, or misclassified", async () => {
  const proposalPath = "docs/proposals/2026-0001-contract-fixture.md";
  const malformed = [
    {
      body: `ECP: ${proposalPath}`,
      proposal: acceptedProposal().replace("Status: accepted", "Status: draft"),
      code: "ecp-not-accepted",
    },
    {
      body: `ECP: ${proposalPath}`,
      proposal: acceptedProposal(["tier-1"]),
      code: "ecp-boundary-mismatch",
    },
    {
      body: `ECP: ${proposalPath}`,
      proposal: acceptedProposal().replace("Accepted by the responsible human owner.", "TODO"),
      code: "invalid-ecp",
    },
    {
      body: `ECP: ${proposalPath}`,
      proposal: acceptedProposal().replace(
        "Accepted by the responsible human owner.",
        "<!-- Record the decision. -->\nTODO",
      ),
      code: "invalid-ecp",
    },
    {
      body: `ECP: ${proposalPath}`,
      proposal: acceptedProposal(["contract-schema", "invented-boundary"]),
      code: "invalid-ecp",
    },
    {
      body: `ECP: ${proposalPath}`,
      proposal: acceptedProposal().replace("<!-- SPDX-License-Identifier: MIT -->\n\n", ""),
      code: "invalid-ecp",
    },
    {
      body: `ECP: ${proposalPath}`,
      proposal: acceptedProposal()
        .replace("Status: accepted\nOwner: @human-maintainer\nAffected boundaries: contract-schema\n\n", "")
        .replace(
          "Accepted by the responsible human owner.",
          "Status: accepted\nOwner: @human-maintainer\nAffected boundaries: contract-schema\n\nAccepted by the responsible human owner.",
        ),
      code: "invalid-ecp",
    },
    {
      body: `ECP: ${proposalPath}\nECP: docs/proposals/2026-0002-other.md`,
      proposal: acceptedProposal(),
      code: "invalid-ecp-reference",
    },
  ];

  for (const scenario of malformed) {
    const { base, repository } = await fixture({ [proposalPath]: scenario.proposal });
    try {
      await writeFile(path.join(repository, "contracts", "public.schema.json"), "{}\n");
      const head = await commit(repository, "change contract schema");
      const { report, result } = await invoke(repository, base, head, scenario.body);

      assert.equal(result.status, 1, scenario.code);
      assert.equal(report.status, "blocked");
      assert.equal(report.issues[0].code, scenario.code);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }

  const late = await fixture();
  try {
    const absoluteProposal = path.join(late.repository, proposalPath);
    await mkdir(path.dirname(absoluteProposal), { recursive: true });
    await writeFile(absoluteProposal, acceptedProposal());
    await writeFile(path.join(late.repository, "contracts", "public.schema.json"), "{}\n");
    const head = await commit(late.repository, "add ECP and contract change together");
    const { report, result } = await invoke(late.repository, late.base, head, `ECP: ${proposalPath}`);
    assert.equal(result.status, 1);
    assert.equal(report.issues[0].code, "ecp-not-preceding");
  } finally {
    await rm(late.repository, { recursive: true, force: true });
  }
});

test("a referenced accepted ECP cannot be downgraded, deleted, or substantively rewritten in head", async () => {
  const proposalPath = "docs/proposals/2026-0001-contract-fixture.md";
  const mutations = [
    { code: "accepted-ecp-downgrade", value: acceptedProposal().replace("Status: accepted", "Status: draft") },
    { code: "accepted-ecp-rewrite", value: acceptedProposal().replace("Keep the existing schema unchanged.", "Adopt an unrelated wire format.") },
    { code: "proposal-history", value: null },
  ];
  for (const mutation of mutations) {
    const { base, repository } = await fixture({ [proposalPath]: acceptedProposal() });
    try {
      if (mutation.value === null) await rm(path.join(repository, proposalPath));
      else await writeFile(path.join(repository, proposalPath), mutation.value);
      await writeFile(path.join(repository, "contracts", "public.schema.json"), "{}\n");
      const head = await commit(repository, "mutate referenced accepted proposal");
      const { report, result } = await invoke(repository, base, head, `ECP: ${proposalPath}`);
      assert.equal(result.status, 1);
      assert.equal(report.issues[0].code, mutation.code);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }
});

test("accepted ECP sections reject embedded placeholder statements", async () => {
  const proposalPath = "docs/proposals/2026-0001-contract-fixture.md";
  for (const placeholder of [
    "Keep the existing schema unchanged. TODO: evaluate deployment rollback.",
    "Keep the existing schema unchanged. The migration details are TBD.",
    "Keep the existing schema unchanged. To be determined.",
    "Keep the existing schema unchanged. <describe the rejected alternative>",
  ]) {
    const proposal = acceptedProposal().replace("Keep the existing schema unchanged.", placeholder);
    const { base, repository } = await fixture();
    try {
      await mkdir(path.dirname(path.join(repository, proposalPath)), { recursive: true });
      await writeFile(path.join(repository, proposalPath), proposal);
      const head = await commit(repository, "add placeholder proposal");
      const { report, result } = await invoke(repository, base, head);
      assert.equal(result.status, 1);
      assert.equal(report.issues[0].code, "invalid-ecp");
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }
});

test("proposal-only changes validate the ECP template and status vocabulary", async () => {
  const cases = [
    {
      contents: acceptedProposal().replace("Status: accepted", "Status: draft"),
      expectedStatus: 0,
      expectedCode: null,
    },
    {
      contents: acceptedProposal().replace("Status: accepted", "Status: approved"),
      expectedStatus: 1,
      expectedCode: "invalid-ecp",
    },
    {
      contents: acceptedProposal().replace(/## Alternatives[\s\S]*?## Compatibility/u, "## Compatibility"),
      expectedStatus: 1,
      expectedCode: "invalid-ecp",
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    const { base, repository } = await fixture();
    try {
      const proposalPath = `docs/proposals/2026-000${index + 1}-proposal.md`;
      const absolutePath = path.join(repository, proposalPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, scenario.contents.replace("2026-0001", `2026-000${index + 1}`));
      const head = await commit(repository, "add proposal");
      const { report, result } = await invoke(repository, base, head);

      assert.equal(result.status, scenario.expectedStatus);
      assert.equal(report.issues[0]?.code ?? null, scenario.expectedCode);
      assert.deepEqual(report.proposalChanges, [proposalPath]);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }
});

test("the shipped ECP template materializes into a gate-valid accepted proposal", async () => {
  const template = await readFile(path.join(productRoot, "docs", "proposals", "template.md"), "utf8");
  const proposalPath = "docs/proposals/2026-0042-template-check.md";
  const proposal = template
    .replace("YYYY-NNNN", "2026-0042")
    .replace("Title", "Template check")
    .replace("Status: draft", "Status: accepted")
    .replace("@github-login", "@human-maintainer")
    .replaceAll("TODO", "The responsible owner recorded the reviewed decision and evidence.");
  const { base, repository } = await fixture();
  try {
    const absolutePath = path.join(repository, proposalPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, proposal);
    const head = await commit(repository, "add accepted proposal from template");
    const { report, result } = await invoke(repository, base, head);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(report.proposalChanges, [proposalPath]);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("proposal history deletion fails closed", async () => {
  const proposalPath = "docs/proposals/2026-0001-contract-fixture.md";
  const { base, repository } = await fixture({ [proposalPath]: acceptedProposal() });
  try {
    await rm(path.join(repository, proposalPath));
    const head = await commit(repository, "delete proposal");
    const { report, result } = await invoke(repository, base, head);

    assert.equal(result.status, 1);
    assert.equal(report.issues[0].code, "proposal-history");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
