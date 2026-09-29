// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const workspace = process.env.TSFG_TYPESCRIPT_WORKSPACE;
const revision = process.env.TSFG_TYPESCRIPT_MANIFEST_REVISION;
const evidence = process.env.TSFG_TYPESCRIPT_EVIDENCE;
const manifestName = process.env.TSFG_TEST_MANIFEST_NAME ?? "candidates/tsfg-v0.2.0.xml";
const expectedForkOid = process.env.TSFG_TYPESCRIPT_EXPECTED_FORK_OID ?? "2c3d2d793a208fd15e6e20fd5dfdd687ce2d7223";
if (!/^candidates\/tsfg-v\d+\.\d+\.\d+\.xml$/.test(manifestName)) throw new Error("Invalid test manifest name");
const manifestBase = manifestName === "candidates/tsfg-v0.2.1.xml"
  ? "dae9d84cddf313cc112907e47d27654d79049e70" : "722402dab85be4da034831afee56ebf3020731a7";

test("real TypeScript candidate passes Workspace Verification without claiming Source Intake", {
  skip: !workspace && "set TSFG_TYPESCRIPT_WORKSPACE, TSFG_TYPESCRIPT_MANIFEST_REVISION and TSFG_TYPESCRIPT_EVIDENCE for real-source acceptance",
}, async (context) => {
  assert.ok(path.isAbsolute(workspace));
  assert.match(revision ?? "", /^[0-9a-f]{40}$/);
  assert.ok(evidence && path.isAbsolute(evidence));
  assert.ok(!path.resolve(evidence).startsWith(path.resolve(workspace) + path.sep));
  await mkdir(evidence, { recursive: true });
  const commands = [];
  async function invoke(args) {
    const result = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, TSFG_GIT: TEST_GIT_EXECUTABLE } });
    commands.push({ executable: process.execPath, arguments: args, exitCode: result.status, stderr: result.stderr });
    await writeFile(path.join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
    return result;
  }
  function verify(name) {
    return invoke([path.join(repository, "eng/tsfg-build.mjs"), "verify-workspace", "--workspace", workspace,
      "--manifest-url", "https://github.com/xuelongling/manifests.git", "--manifest-revision", revision,
      "--manifest", manifestName, "--report", path.join(evidence, name)]);
  }
  const reportPath = path.join(evidence, "workspace-report.json");
  const result = await verify("workspace-report.json");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.result.dirty, false);
  assert.deepEqual(report.result.projects.map(project => project.id).sort(), [".agents.git", "TypeScript.git", "tsfg.git"]);
  const admission = report.result.policy.sourceAdmission;
  assert.equal(admission.intakeComplete, false);
  assert.deepEqual(admission.stages, {sourcePolicy: "passed", generation: "not-run", build: "not-run", interface: "not-run", jsIsolation: "not-run", reproducibility: "not-run"});
  assert.equal(admission.sources[0].canonicalUrl, "https://github.com/microsoft/TypeScript.git");
  assert.equal(admission.sources[0].baseOid, "1e4744d68260a7cb91b62b12edc3f6a2187faaf1");
  assert.equal(admission.sources[0].forkOid, expectedForkOid);
  await context.test("both candidate consumers accept the real workspace report", async () => {
    const product = await invoke([path.join(repository, "eng/product-pr-ci.mjs"), "identity",
      "--manifest", path.join(workspace, ".repo/manifests", manifestName),
      "--manifest-name", manifestName, "--manifest-revision", revision,
      "--candidate-revision", report.result.projects.find(project => project.id === "tsfg.git").head,
      "--agent-revision", report.result.projects.find(project => project.id === ".agents.git").head,
      "--workspace-report", reportPath, "--out", path.join(evidence, "product-consumer")]);
    assert.equal(product.status, 0, product.stderr);
    const manifest = await invoke([process.env.TSFG_MANIFEST_CI ?? path.join(workspace, ".repo/manifests/tools/manifest-ci.mjs"),
      "gate", "--repository", path.join(workspace, ".repo/manifests"),
      "--base", manifestBase, "--head", revision,
      "--workspace-report", reportPath, "--out", path.join(evidence, "manifest-consumer")]);
    assert.equal(manifest.status, 0, manifest.stderr);
  });
  await context.test("isolated real checkout rejects changed HEAD, remote and activation link", async () => {
    const fork = path.join(workspace, "typescript");
    const source = admission.sources[0];
    function git(...args) {
      const result = spawnSync(TEST_GIT_EXECUTABLE, ["-C", fork, ...args], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const activation = path.join(workspace, "AGENTS.md");
    const linkTarget = await readlink(activation);
    const cases = [
      { name: "head", code: "project-head", change: () => git("update-ref", "HEAD", source.baseOid, source.forkOid), restore: () => git("update-ref", "HEAD", source.forkOid, source.baseOid) },
      { name: "remote", code: "project-remote", change: () => git("config", "remote.github-xuelongling.url", "https://github.com/other/TypeScript.git"), restore: () => git("config", "remote.github-xuelongling.url", source.remoteUrl) },
      { name: "link", change: async () => { await unlink(activation); await writeFile(activation, "not the manifest-managed link\n"); }, restore: async () => { await unlink(activation); await symlink(linkTarget, activation, "file"); } },
    ];
    for (const scenario of cases) {
      await scenario.change();
      try {
        const result = await verify(`${scenario.name}-rejected.json`);
        assert.equal(result.status, 10, result.stderr);
        const rejection = JSON.parse(await readFile(path.join(evidence, `${scenario.name}-rejected.json`), "utf8"));
        if (scenario.code) assert.equal(rejection.error.issues[0].code, scenario.code);
        else assert.match(rejection.error.issues[0].code, /activation|link/);
      } finally { await scenario.restore(); }
    }
  });
});
