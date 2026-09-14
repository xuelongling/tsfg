// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildEntry = path.join(repositoryRoot, "eng", "tsfg-build.mjs");
const networkDenialHook = path.join(repositoryRoot, "tests", "r00", "deny-network.cjs");
const manifestUrl = "https://github.com/xuelongling/manifests.git";
const gitAttributes = "* text=auto eol=lf\n*.cmd text eol=crlf\n*.bat text eol=crlf\n";

function validUpstreamFiles(branch = "refs/heads/tsfg-r02a-fixture") {
  return {
    ".gitattributes": gitAttributes,
    "LICENSE": "Apache License 2.0\nCopyright fixture authors\n",
    "NOTICE": "Original fixture notice\n",
    "UPSTREAM.toml": (base) => `canonical_url = "https://github.com/upstream/future-upstream.git"\nbase_oid = "${base}"\nlicense = "Apache-2.0"\nsync_branch = "${branch}"\nlocal_changes = "isolated governance fixture"\n`,
  };
}

function git(cwd, ...arguments_) {
  const result = spawnSync("git", arguments_, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function initializeRepository(root, files, remoteUrl, remoteName, indexEntries = []) {
  await mkdir(root, { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "core.longpaths", "true");
  git(root, "config", "user.name", "tsfg policy fixture");
  git(root, "config", "user.email", "policy-fixture@tsfg.invalid");
  git(root, "config", `remote.${remoteName}.url`, remoteUrl);
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  git(root, "add", ".");
  for (const entry of indexEntries) {
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: root,
      input: entry.contents,
    });
    assert.equal(blob.status, 0, blob.stderr.toString("utf8"));
    const cacheInfo = `${entry.mode ?? "100644"},${blob.stdout.toString("ascii").trim()},${entry.path}`;
    let update = spawnSync("git", ["update-index", "--add", "--cacheinfo", cacheInfo], {
      cwd: root,
      encoding: "utf8",
    });
    if (update.status !== 0 && process.platform === "win32") {
      update = spawnSync(
        "wsl.exe",
        ["git", "-C", windowsPathToWsl(root), "update-index", "--add", "--cacheinfo", cacheInfo],
        { encoding: "utf8" },
      );
    }
    assert.equal(update.status, 0, update.stderr);
  }
  git(root, "commit", "--quiet", "-m", "policy fixture");
  return git(root, "rev-parse", "HEAD");
}

function windowsPathToWsl(absolutePath) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(absolutePath);
  if (!match) return undefined;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}

async function createFixtureSymlink(target, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await symlink(target, destination, "file");
  } catch (error) {
    const wslDestination = process.platform === "win32" ? windowsPathToWsl(destination) : undefined;
    if (error.code !== "EPERM" || !wslDestination) throw error;
    const parentResult = spawnSync(
      "wsl.exe",
      ["mkdir", "-p", "--", windowsPathToWsl(path.dirname(destination))],
      { encoding: "utf8" },
    );
    const result =
      parentResult.status === 0
        ? spawnSync(
            "wsl.exe",
            ["ln", "-s", "--", target.replaceAll("\\", "/"), wslDestination],
            { encoding: "utf8" },
          )
        : parentResult;
    if (result.status !== 0) {
      throw new Error(`cannot create fixture symlink through WSL: ${result.stderr.trim()}`, {
        cause: error,
      });
    }
  }
}

async function materializePolicyFixture(workspace, overrides = {}) {
  const license = await readFile(path.join(repositoryRoot, "LICENSE"));
  let productHead = await initializeRepository(
    path.join(workspace, "tsfg"),
    {
      ".gitattributes": gitAttributes,
      "LICENSE": license,
      "README.md": "<!-- SPDX-License-Identifier: MIT -->\n\n# fixture product\n",
      "eng/build-inputs.json":
        '{"entries":[{"path":"eng/example.mjs","projectId":"tsfg"}],"schemaVersion":"1"}\n',
      "eng/dependency-sources.json": '{"dependencies":[],"schemaVersion":"1"}\n',
      "eng/example.mjs": "// SPDX-License-Identifier: MIT\nexport {};\n",
      "eng/toolchains.lock.json":
        '{"dependencyLocks":[],"schemaVersion":"1","targets":{},"tools":{}}\n',
      ...(overrides.productFiles ?? {}),
    },
    "https://github.com/xuelongling/tsfg.git",
    "github-xuelongling",
    overrides.productIndexEntries,
  );
  const agentsHead = await initializeRepository(
    path.join(workspace, ".agents"),
    {
      ".gitattributes": gitAttributes,
      "AGENTS.md": "<!-- SPDX-License-Identifier: MIT -->\n\n# fixture agents\n",
      "LICENSE": license,
      "codex/config.toml": "# SPDX-License-Identifier: MIT\nmodel = \"fixture\"\n",
      "codex/hooks.json": "{}\n",
      ...(overrides.agentFiles ?? {}),
    },
    "https://github.com/xuelongling/.agents.git",
    "github-xuelongling",
  );
  let upstream;
  let admission;
  const baselineProductHead = productHead;
  const sourceBranch = overrides.branch ?? "refs/heads/tsfg-r02a-fixture";
  const upstreamPath = overrides.upstreamPath ?? "future-upstream";
  const manifestName = overrides.manifestName ?? (overrides.admitUpstream ? "candidates/tsfg-v0.2.0.xml" : "bootstrap/r00.xml");
  if (overrides.upstreamFiles) {
    const upstreamRoot = path.join(workspace, upstreamPath);
    const upstreamFiles = { ...overrides.upstreamFiles };
    const upstreamToml = upstreamFiles["UPSTREAM.toml"];
    delete upstreamFiles["UPSTREAM.toml"];
    let upstreamHead = await initializeRepository(
      upstreamRoot,
      upstreamFiles,
      "https://github.com/xuelongling/future-upstream.git",
      "github-xuelongling",
    );
    const baseOid = overrides.unrelatedBase
      ? git(upstreamRoot, "commit-tree", git(upstreamRoot, "rev-parse", "HEAD^{tree}"), "-m", "unrelated upstream history fixture")
      : upstreamHead;
    if (overrides.admitUpstream) git(upstreamRoot, "checkout", "--quiet", "-b", sourceBranch.slice("refs/heads/".length));
    if (upstreamToml !== undefined) {
      const contents =
        typeof upstreamToml === "function" ? upstreamToml(baseOid) : upstreamToml;
      await writeFile(path.join(upstreamRoot, "UPSTREAM.toml"), contents);
      if (overrides.unmaterializedGitlink) {
        git(upstreamRoot, "update-index", "--add", "--cacheinfo", `160000,${baseOid},_submodules/TypeScript`);
        await mkdir(path.join(upstreamRoot, "_submodules/TypeScript"), { recursive: true });
      }
      git(upstreamRoot, "add", "UPSTREAM.toml");
      git(upstreamRoot, "commit", "--quiet", "-m", "add upstream provenance");
      upstreamHead = git(upstreamRoot, "rev-parse", "HEAD");
    }
    if (overrides.admitUpstream) {
      const files = git(upstreamRoot, "ls-files").split("\n").map((filePath) => filePath === "_submodules/TypeScript" ? {
        contentKind: "gitlink", path: filePath, oid: baseOid,
      } : ({
        contentKind: "text",
        path: filePath,
        sha256: `sha256:${createHash("sha256").update(spawnSync("git", ["show", `${upstreamHead}:${filePath}`], { cwd: upstreamRoot }).stdout).digest("hex")}`,
      }));
      admission = { schemaVersion: overrides.admissionVersion ?? "1", sources: [{
        projectId: "future-upstream.git", path: upstreamPath,
        remoteUrl: "https://github.com/xuelongling/future-upstream.git",
        canonicalUrl: "https://github.com/upstream/future-upstream.git",
        baseOid, forkOid: upstreamHead, branch: sourceBranch,
        license: "Apache-2.0", files,
        legal: { license: "LICENSE", notice: "NOTICE", copyright: "LICENSE" },
      }] };
      overrides.admissionTransform?.(admission);
      const productAdmission = structuredClone(admission);
      overrides.productAdmissionTransform?.(productAdmission);
      await writeFile(path.join(workspace, "tsfg", "eng", "source-admissions.json"), JSON.stringify(productAdmission));
      git(path.join(workspace, "tsfg"), "add", "eng/source-admissions.json");
      git(path.join(workspace, "tsfg"), "commit", "--quiet", "-m", "approve isolated source fixture only");
      productHead = git(path.join(workspace, "tsfg"), "rev-parse", "HEAD");
    }
    upstream = `  <project name="future-upstream.git" path="${upstreamPath}" remote="github-xuelongling" upstream="${sourceBranch}" revision="${upstreamHead}" />\n`;
  }
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<!-- SPDX-License-Identifier: MIT -->
<manifest>
  <remote name="github-xuelongling" fetch="https://github.com/xuelongling/" />
  <project name="tsfg.git" path="tsfg" remote="github-xuelongling" revision="${productHead}" upstream="refs/heads/main" />
${upstream ?? ""}
  <project name=".agents.git" path=".agents" remote="github-xuelongling" revision="${agentsHead}" upstream="refs/heads/main">
    <linkfile src="AGENTS.md" dest="AGENTS.md" />
    <linkfile src="codex/config.toml" dest=".codex/config.toml" />
    <linkfile src="codex/hooks.json" dest=".codex/hooks.json" />
  </project>
</manifest>
`;
  const manifestsRoot = path.join(workspace, ".repo", "manifests");
  let manifestHead = await initializeRepository(
    manifestsRoot,
    {
      ".gitattributes": gitAttributes,
      "LICENSE": license,
      "bootstrap/r00.xml": admission ? manifest.replace(upstream, "").replace(productHead, baselineProductHead) : overrides.manifestTransform?.(manifest) ?? manifest,
    },
    manifestUrl,
    "origin",
  );
  const manifestBase = manifestHead;
  if (admission) {
    await mkdir(path.join(manifestsRoot, "candidates"));
    await writeFile(path.join(manifestsRoot, manifestName), overrides.manifestTransform?.(manifest) ?? manifest);
    await writeFile(path.join(manifestsRoot, `${manifestName}.sources.json`), JSON.stringify(admission));
    git(manifestsRoot, "add", ".");
    git(manifestsRoot, "commit", "--quiet", "-m", "version isolated candidate combination");
    manifestHead = git(manifestsRoot, "rev-parse", "HEAD");
  }
  const manifestGit = path.join(workspace, ".repo", "manifests.git");
  await mkdir(manifestGit, { recursive: true });
  git(manifestGit, "init", "--bare", "--quiet");
  git(manifestGit, "config", "remote.origin.url", manifestUrl);
  git(manifestGit, "config", "branch.default.merge", manifestHead);
  await writeFile(
    path.join(workspace, ".repo", "project.list"),
    `.agents\n${overrides.upstreamFiles ? `${upstreamPath}\n` : ""}tsfg\n`,
  );
  await writeFile(
    path.join(workspace, ".repo", "manifest.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<manifest>\n  <include name="${manifestName}" />\n</manifest>\n`,
  );
  await createFixtureSymlink(".agents/AGENTS.md", path.join(workspace, "AGENTS.md"));
  await createFixtureSymlink(
    "../.agents/codex/config.toml",
    path.join(workspace, ".codex", "config.toml"),
  );
  await createFixtureSymlink(
    "../.agents/codex/hooks.json",
    path.join(workspace, ".codex", "hooks.json"),
  );
  return { manifestHead, manifestBase, manifestName, admission };
}

async function invokeVerify(workspace, manifestHead, reportPath, manifestName = "bootstrap/r00.xml") {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        buildEntry,
        "verify-workspace",
        "--workspace",
        workspace,
        "--manifest-url",
        manifestUrl,
        "--manifest-revision",
        manifestHead,
        "--manifest",
        manifestName,
        "--report",
        reportPath,
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${networkDenialHook}`,
          TSFG_GIT: TEST_GIT_EXECUTABLE,
        },
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

test("verify-workspace admits an exact isolated fork while leaving Source Intake stages unrun", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-admission-"));
  const workspace = path.join(sandbox, "workspace");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true,
      branch: "refs/heads/tsfg@intake",
      upstreamFiles: validUpstreamFiles("refs/heads/tsfg@intake"),
    });
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    if (process.env.TSFG_SOURCE_ADMISSION_EVIDENCE) {
      const evidence = path.resolve(process.env.TSFG_SOURCE_ADMISSION_EVIDENCE);
      await mkdir(evidence, { recursive: true });
      await writeFile(path.join(evidence, "producer-report.json"), JSON.stringify(report, null, 2));
      await writeFile(path.join(evidence, "source-admissions.json"), JSON.stringify(fixture.admission, null, 2));
      await writeFile(path.join(evidence, "candidate-manifest.xml"), await readFile(path.join(workspace, ".repo", "manifests", fixture.manifestName)));
      for (const [name, repositoryPath] of [["product", "tsfg"], ["agents", ".agents"], ["manifests", ".repo/manifests"], ["source", "future-upstream"]]) {
        git(path.join(workspace, repositoryPath), "bundle", "create", path.join(evidence, `${name}.bundle`), "--all");
      }
      await writeFile(path.join(evidence, "fixture.json"), JSON.stringify({
        kind: "isolated-governance-fixture", intakeComplete: false,
        manifestBase: fixture.manifestBase, manifestHead: fixture.manifestHead,
        manifestName: fixture.manifestName, producerCommit: git(repositoryRoot, "rev-parse", "HEAD"),
      }, null, 2));
    }
    assert.deepEqual(report.result.policy.upstreamForks, fixture.admission.sources);
    assert.equal(report.result.policy.sourceAdmission.intakeComplete, false);
    assert.deepEqual(report.result.policy.sourceAdmission.stages, {
      sourcePolicy: "passed", generation: "not-run", build: "not-run", interface: "not-run",
      jsIsolation: "not-run", reproducibility: "not-run",
    });
    const productConsumer = spawnSync(process.execPath, [path.join(repositoryRoot, "eng", "product-pr-ci.mjs"), "identity",
      "--manifest", path.join(workspace, ".repo", "manifests", fixture.manifestName),
      "--manifest-name", fixture.manifestName, "--manifest-revision", fixture.manifestHead,
      "--candidate-revision", git(path.join(workspace, "tsfg"), "rev-parse", "HEAD"),
      "--agent-revision", git(path.join(workspace, ".agents"), "rev-parse", "HEAD"),
      "--workspace-report", reportPath, "--out", path.join(sandbox, "product-ci-evidence"),
    ], { encoding: "utf8", env: process.env });
    assert.equal(productConsumer.status, 0, productConsumer.stderr);
    await context.test("approved source still requires actual HEAD, remote, clean state, complete projects and activation", async () => {
      const fork = path.join(workspace, "future-upstream");
      const source = fixture.admission.sources[0];
      const projectListPath = path.join(workspace, ".repo", "project.list");
      const projectList = await readFile(projectListPath);
      const cases = [
        { change: () => git(fork, "checkout", "--quiet", source.baseOid), restore: () => git(fork, "checkout", "--quiet", source.forkOid) },
        { change: () => git(fork, "config", "remote.github-xuelongling.url", "https://github.com/other/source.git"), restore: () => git(fork, "config", "remote.github-xuelongling.url", source.remoteUrl) },
        { change: () => writeFile(path.join(fork, "untracked.txt"), "dirty"), restore: () => rm(path.join(fork, "untracked.txt")) },
        { change: () => writeFile(projectListPath, ".agents\ntsfg\n"), restore: () => writeFile(projectListPath, projectList) },
        { change: async () => { await rm(path.join(workspace, "AGENTS.md")); await writeFile(path.join(workspace, "AGENTS.md"), "not a link"); }, restore: async () => { await rm(path.join(workspace, "AGENTS.md")); await createFixtureSymlink(".agents/AGENTS.md", path.join(workspace, "AGENTS.md")); } },
      ];
      for (const [index, scenario] of cases.entries()) {
        await scenario.change();
        try {
          const rejected = await invokeVerify(workspace, fixture.manifestHead, path.join(sandbox, `identity-rejection-${index}.json`), fixture.manifestName);
          assert.equal(rejected.status, 10, rejected.stderr);
        } finally { await scenario.restore(); }
      }
    });
    await context.test("manifest CI consumes the actual producer report and rejects damaged evidence", { skip: !process.env.TSFG_MANIFEST_CI }, async () => {
      const mutations = [
        undefined,
        (value) => { delete value.result.policy.sourceAdmission; },
        (value) => { value.result.policy.sourceAdmission.digest = `sha256:${"0".repeat(64)}`; },
        (value) => { value.result.projects[0].remote = "https://github.com/other/wrong.git"; },
        (value) => { value.result.policy.sourceAdmission.intakeComplete = true; },
        (value) => { delete value.result.policy.licenseReport; },
        (value) => { value.result.policy.repositories.pop(); },
        (value) => { value.result.dirty = true; },
        (value) => { delete value.result.dirty; },
      ];
      for (const [index, mutate] of mutations.entries()) {
        const input = structuredClone(report);
        mutate?.(input);
        const consumerReport = path.join(sandbox, `consumer-${index}.json`);
        await writeFile(consumerReport, JSON.stringify(input));
        const consumer = spawnSync(process.execPath, [process.env.TSFG_MANIFEST_CI, "gate",
          "--repository", path.join(workspace, ".repo", "manifests"), "--base", fixture.manifestBase,
          "--head", fixture.manifestHead, "--workspace-report", consumerReport,
          "--out", path.join(sandbox, `manifest-evidence-${index}`),
        ], { encoding: "utf8", env: process.env });
        assert.equal(consumer.status, mutate ? 1 : 0, consumer.stderr);
        const productCheck = spawnSync(process.execPath, [path.join(repositoryRoot, "eng", "product-pr-ci.mjs"), "identity",
          "--manifest", path.join(workspace, ".repo", "manifests", fixture.manifestName),
          "--manifest-name", fixture.manifestName, "--manifest-revision", fixture.manifestHead,
          "--candidate-revision", report.result.projects.find((project) => project.id === "tsfg.git").head,
          "--agent-revision", report.result.projects.find((project) => project.id === ".agents.git").head,
          "--workspace-report", consumerReport, "--out", path.join(sandbox, `product-consumer-${index}`),
        ], { encoding: "utf8", env: process.env });
        assert.equal(productCheck.status, mutate ? 1 : 0, productCheck.stderr);
      }
    });
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects stale legal material even when both approval records agree", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-admission-stale-"));
  const workspace = path.join(sandbox, "workspace");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true,
      admissionTransform: (record) => { record.sources[0].files.find((file) => file.path === "LICENSE").sha256 = `sha256:${"0".repeat(64)}`; },
      upstreamFiles: validUpstreamFiles(),
    });
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 10, result.stderr);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).error.issues[0].code, "source-admission");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace preserves explicitly mapped original upstream license and text shapes", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-admission-original-"));
  const workspace = path.join(sandbox, "workspace");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true,
      admissionTransform: (record) => { record.sources[0].legal = { license: "Legal/License.txt", notice: "Legal/Notice.txt", copyright: "Legal/License.txt" }; },
      upstreamFiles: {
        "Legal/License.txt": "Apache License 2.0\r\nCopyright fixture authors\r\n",
        "Legal/Notice.txt": "Original fixture notice\r\n",
        "Source.ts": "export const original = 1;\r\n",
        "UPSTREAM.toml": (base) => `canonical_url = "https://github.com/upstream/future-upstream.git"\nbase_oid = "${base}"\nlicense = "Apache-2.0"\nsync_branch = "refs/heads/tsfg-r02a-fixture"\nlocal_changes = "isolated governance fixture"\n`,
      },
    });
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")).result.policy.upstreamForks, fixture.admission.sources);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace binds source approval to the canonical fork remote", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-admission-remote-"));
  const workspace = path.join(sandbox, "workspace");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true,
      admissionTransform: (record) => { record.sources[0].remoteUrl = "https://github.com/other/future-upstream.git"; },
      upstreamFiles: validUpstreamFiles(),
    });
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 10, result.stderr);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).error.issues[0].code, "source-admission");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace preserves explicitly mapped upstream paths beyond first-party naming limits", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-source-paths-"));
  const workspace = path.join(sandbox, "w");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true,
      admissionVersion: "2",
      upstreamFiles: { ...validUpstreamFiles(), [`tests/${"long-directory/".repeat(10)}original test (case), name with spaces.ts`]: "// Original upstream fixture\n" },
    });
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).result.policy.sourceAdmission.intakeComplete, false);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace records an exact unmaterialized upstream gitlink without admitting its source", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-source-gitlink-"));
  const workspace = path.join(sandbox, "w");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true, admissionVersion: "2", unmaterializedGitlink: true,
      upstreamFiles: validUpstreamFiles(),
    });
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 0, result.stderr);
    const source = JSON.parse(await readFile(reportPath, "utf8")).result.policy.sourceAdmission.sources[0];
    assert.deepEqual(source.files.find(file => file.contentKind === "gitlink"), {
      contentKind: "gitlink", path: "_submodules/TypeScript", oid: source.baseOid,
    });
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects contents materialized beneath an admission-only gitlink", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-source-gitlink-content-"));
  const workspace = path.join(sandbox, "w");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true, admissionVersion: "2", unmaterializedGitlink: true,
      upstreamFiles: validUpstreamFiles(),
    });
    await writeFile(path.join(workspace, "future-upstream/_submodules/TypeScript/unchecked.ts"), "unapproved source\n");
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 10, result.stderr);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).error.issues[0].code, "source-admission");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects a redirected parent of an unmaterialized gitlink", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-source-gitlink-parent-"));
  const workspace = path.join(sandbox, "w");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true, admissionVersion: "2", unmaterializedGitlink: true,
      upstreamFiles: validUpstreamFiles(),
    });
    const parent = path.join(workspace, "future-upstream/_submodules");
    await rm(parent, { recursive: true });
    const outside = path.join(sandbox, "outside");
    await mkdir(path.join(outside, "TypeScript"), { recursive: true });
    await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 10, result.stderr);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).error.issues[0].code, "source-admission");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace requires an explicit preserved copyright mapping", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-admission-copyright-"));
  const workspace = path.join(sandbox, "workspace");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true,
      admissionTransform: (record) => { delete record.sources[0].legal.copyright; },
      upstreamFiles: validUpstreamFiles(),
    });
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 10, result.stderr);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).error.issues[0].code, "source-admission");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

for (const [scenario, mutate] of [
  ["content kind", (record) => { record.sources[0].files[0].contentKind = "unchecked"; }],
  ["null source", (record) => { record.sources[0] = null; }],
  ["non-string OID", (record) => { record.sources[0].baseOid = [record.sources[0].baseOid]; }],
  ["unknown field", (record) => { record.sources[0].approved = true; }],
  ["unknown license", (record) => { record.sources[0].license = "NOASSERTION"; }],
  ["missing files", (record) => { delete record.sources[0].files; }],
  ["dangerous mapping", (record) => { record.sources[0].files[0].path = "../outside"; }],
  ["unmapped file", (record) => { record.sources[0].files.pop(); }],
  ["missing legal", (record) => { record.sources[0].legal.notice = "missing.txt"; }],
  ["unrelated base", undefined],
  ["unversioned combination", undefined],
  ["two sides disagree", undefined],
  ["forbidden fork prefix", undefined],
]) test(`verify-workspace rejects malformed source mappings: ${scenario}`, async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-admission-shape-"));
  const workspace = path.join(sandbox, "workspace");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true,
      admissionTransform: mutate,
      unrelatedBase: scenario === "unrelated base",
      manifestName: scenario === "unversioned combination" ? "candidates/floating.xml" : undefined,
      productAdmissionTransform: scenario === "two sides disagree" ? (record) => { record.sources[0].license = "MIT"; } : undefined,
      upstreamPath: scenario === "forbidden fork prefix" ? "tsfg-upstream-fixture" : undefined,
      upstreamFiles: validUpstreamFiles(),
    });
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 10, result.stderr);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).status, "failure");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects ambiguous duplicate source approvals", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-admission-duplicate-"));
  const workspace = path.join(sandbox, "workspace");
  try {
    const fixture = await materializePolicyFixture(workspace, {
      admitUpstream: true,
      admissionTransform: (record) => { record.sources.push(structuredClone(record.sources[0])); },
      upstreamFiles: validUpstreamFiles(),
    });
    const reportPath = path.join(sandbox, "report.json");
    const result = await invokeVerify(workspace, fixture.manifestHead, reportPath, fixture.manifestName);
    assert.equal(result.status, 10, result.stderr);
    assert.equal(JSON.parse(await readFile(reportPath, "utf8")).error.issues[0].code, "source-admission");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace reports complete three-repository policy coverage", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-clean-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    const { manifestHead } = await materializePolicyFixture(workspace);
    const result = await invokeVerify(workspace, manifestHead, reportPath);
    if (process.platform === "win32" && result.status === 10 && /EACCES.*realpath/.test(result.stderr)) {
      context.skip("Windows host does not grant a traversable symbolic-link capability");
      return;
    }
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.deepEqual(report.result.policy.repositories, [
      { files: 5, id: ".agents.git", license: "MIT", path: ".agents" },
      { files: 3, id: "manifests", license: "MIT", path: ".repo/manifests" },
      { files: 7, id: "tsfg.git", license: "MIT", path: "tsfg" },
    ]);
    assert.deepEqual(report.result.policy.licenseReport.coverage, {
      covered: 15,
      percent: "100",
      total: 15,
    });
    assert.deepEqual(report.result.policy.licenseReport.dependencies, {
      buildOnly: [],
      payload: [],
    });
    assert.deepEqual(report.result.policy.upstreamForks, []);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace maps the immutable bootstrap manifest without rewriting it", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-bootstrap-license-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    const { manifestHead } = await materializePolicyFixture(workspace, {
      manifestTransform: (manifest) => manifest.replace("<!-- SPDX-License-Identifier: MIT -->\n", ""),
    });
    const result = await invokeVerify(workspace, manifestHead, reportPath);
    if (process.platform === "win32" && result.status === 10 && /EACCES.*realpath/.test(result.stderr)) {
      context.skip("Windows host does not grant a traversable symbolic-link capability");
      return;
    }
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace reports traced build-only and payload dependencies separately", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-dependency-report-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  const buildDigest = `sha256:${"a".repeat(64)}`;
  const payloadDigest = `sha256:${"b".repeat(64)}`;
  const dependencySources = {
    dependencies: [
      {
        id: "tool:build-tool",
        license: "MIT",
        notice: { status: "not-required" },
        scope: "build-only",
        source: { kind: "toolchain", toolId: "build-tool" },
      },
      {
        id: "tool:payload-sdk",
        license: "Apache-2.0",
        notice: { status: "not-required" },
        scope: "payload",
        source: { kind: "toolchain", toolId: "payload-sdk" },
      },
    ],
    schemaVersion: "1",
  };
  const toolchainLock = {
    dependencyLocks: [],
    schemaVersion: "1",
    targets: {},
    tools: {
      "build-tool": {
        artifacts: [
          {
            archiveSha256: buildDigest,
            url: "https://example.invalid/build-tool",
          },
        ],
        license: "MIT",
      },
      "payload-sdk": {
        artifacts: [
          {
            archiveSha256: payloadDigest,
            url: "https://example.invalid/payload-sdk",
          },
        ],
        license: "Apache-2.0",
      },
    },
  };
  try {
    const { manifestHead } = await materializePolicyFixture(workspace, {
      productFiles: {
        "eng/dependency-sources.json": `${JSON.stringify(dependencySources)}\n`,
        "eng/toolchains.lock.json": `${JSON.stringify(toolchainLock)}\n`,
      },
    });
    const result = await invokeVerify(workspace, manifestHead, reportPath);
    if (process.platform === "win32" && result.status === 10 && /EACCES.*realpath/.test(result.stderr)) {
      context.skip("Windows host does not grant a traversable symbolic-link capability");
      return;
    }
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.deepEqual(report.result.policy.licenseReport.dependencies, {
      buildOnly: [
        {
          id: "tool:build-tool",
          inputs: [
            {
              id: "build-tool",
              license: "MIT",
              sha256: buildDigest,
              source: "https://example.invalid/build-tool",
            },
          ],
          license: "MIT",
          notice: "not-required",
        },
      ],
      payload: [
        {
          id: "tool:payload-sdk",
          inputs: [
            {
              id: "payload-sdk",
              license: "Apache-2.0",
              sha256: payloadDigest,
              source: "https://example.invalid/payload-sdk",
            },
          ],
          license: "Apache-2.0",
          notice: "not-required",
        },
      ],
    });
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects a UTF-8 BOM from the pinned repository tree", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-bom-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    const { manifestHead } = await materializePolicyFixture(workspace, {
      productFiles: { "docs/bom.md": "\uFEFF# rejected\n" },
    });
    const result = await invokeVerify(workspace, manifestHead, reportPath);
    assert.equal(result.status, 10, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.category, "workspace mismatch");
    assert.equal(report.error.issues[0].code, "text-bom");
    assert.match(report.error.issues[0].message, /tsfg\/docs\/bom\.md/);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects lone surrogate code units in committed canonical JSON", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-ijson-surrogate-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    const { manifestHead } = await materializePolicyFixture(workspace, {
      productFiles: {
        "eng/dependency-sources.json":
          '{"dependencies":[],"schemaVersion":"\\ud800"}\n',
      },
    });
    const result = await invokeVerify(workspace, manifestHead, reportPath);
    assert.equal(result.status, 10, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.issues[0].code, "dependency-metadata");
    assert.match(report.error.issues[0].message, /I-JSON.*surrogate/);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects non-UTF-8 bytes and non-LF Git text", async () => {
  const scenarios = [
    {
      code: "text-encoding",
      path: "docs/invalid-utf8.md",
      contents: Buffer.from([0x23, 0x20, 0xc3, 0x28, 0x0a]),
    },
    {
      code: "text-encoding",
      path: "docs/utf16.md",
      contents: Buffer.from("# rejected\n", "utf16le"),
    },
    {
      code: "text-line-endings",
      path: "docs/crlf.md",
      contents: Buffer.from("# rejected\r\n", "utf8"),
    },
  ];
  for (const scenario of scenarios) {
    const sandbox = await mkdtemp(path.join(tmpdir(), `tsfg-policy-${scenario.code}-`));
    const workspace = path.join(sandbox, "workspace");
    const reportPath = path.join(sandbox, "report.json");
    try {
      const { manifestHead } = await materializePolicyFixture(workspace, {
        productIndexEntries: [scenario],
      });
      const result = await invokeVerify(workspace, manifestHead, reportPath);
      assert.equal(result.status, 10, `${scenario.path}: ${result.stderr}`);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, scenario.code);
      assert.match(report.error.issues[0].message, new RegExp(scenario.path.replace(".", "\\.")));
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});

test("verify-workspace requires the canonical line-ending attributes", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-attributes-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    const { manifestHead } = await materializePolicyFixture(workspace, {
      productFiles: { ".gitattributes": "* -text\n" },
    });
    const result = await invokeVerify(workspace, manifestHead, reportPath);
    assert.equal(result.status, 10, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.issues[0].code, "text-attributes");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects non-portable Git paths and repository symlinks", async () => {
  const source = "// SPDX-License-Identifier: MIT\nexport {};\n";
  const scenarios = [
    {
      code: "path-ascii-lowercase",
      entries: [{ path: "src/Bad.mjs", contents: source }],
    },
    {
      code: "path-ascii-lowercase",
      entries: [{ path: "src/é.mjs", contents: source }],
    },
    {
      code: "path-case-collision",
      entries: [
        { path: "src/case.mjs", contents: source },
        { path: "src/CASE.mjs", contents: source },
      ],
    },
    {
      code: "path-case-collision",
      entries: [
        { path: "src/Case/one.mjs", contents: source },
        { path: "src/case/two.mjs", contents: source },
      ],
    },
    {
      code: "path-ascii-lowercase",
      entries: [{ path: "docs/README.md/child.md", contents: "# rejected\n" }],
    },
    {
      code: "path-windows-reserved",
      entries: [{ path: "src/con.txt", contents: "reserved\n" }],
    },
    {
      code: "path-trailing-dot-space",
      entries: [{ path: "src/trailing.", contents: "trailing\n" }],
    },
    {
      code: "path-too-long",
      entries: [{ path: `src/${"a".repeat(173)}.mjs`, contents: source }],
    },
    {
      code: "repository-symlink",
      entries: [{ mode: "120000", path: "src/linked.mjs", contents: "../outside.mjs" }],
    },
  ];
  for (const scenario of scenarios) {
    const sandbox = await mkdtemp(path.join(tmpdir(), `tsfg-policy-${scenario.code}-`));
    const workspace = path.join(sandbox, "workspace");
    const reportPath = path.join(sandbox, "report.json");
    try {
      const { manifestHead } = await materializePolicyFixture(workspace, {
        productIndexEntries: scenario.entries,
      });
      const result = await invokeVerify(workspace, manifestHead, reportPath);
      assert.equal(result.status, 10, result.stderr);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, scenario.code);
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});

test("verify-workspace requires machine-complete first-party MIT coverage", async () => {
  const scenarios = [
    {
      code: "license-root",
      productFiles: { "LICENSE": "MIT License\n\nCopyright (c) 2026 somebody-else\n" },
    },
    {
      code: "license-root",
      productFiles: {
        "LICENSE": "MIT License\n\nCopyright (c) 2026 xuelongling\n\ntruncated\n",
      },
    },
    {
      code: "license-spdx",
      productFiles: { "eng/example.mjs": "export {};\n" },
    },
    ...[
      ["docs/guide.md", "# rejected\n"],
      ["config/example.toml", "value = true\n"],
      ["config/example.xml", "<value>true</value>\n"],
      ["config/example.yaml", "value: true\n"],
    ].map(([relativePath, contents]) => ({
      code: "license-spdx",
      productFiles: { [relativePath]: contents },
    })),
    {
      code: "license-coverage",
      productFiles: { "data/unmapped.dat": "no machine mapping\n" },
    },
  ];
  for (const scenario of scenarios) {
    const sandbox = await mkdtemp(path.join(tmpdir(), `tsfg-policy-${scenario.code}-`));
    const workspace = path.join(sandbox, "workspace");
    const reportPath = path.join(sandbox, "report.json");
    try {
      const { manifestHead } = await materializePolicyFixture(workspace, scenario);
      const result = await invokeVerify(workspace, manifestHead, reportPath);
      assert.equal(result.status, 10, result.stderr);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, scenario.code);
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});

test("verify-workspace rejects incomplete dependency license provenance", async () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const tool = (license, nestedLicense = undefined) => ({
    artifacts: [
      {
        archiveSha256: digest,
        ...(nestedLicense
          ? { archives: [{ archiveSha256: digest, id: "member", license: nestedLicense }] }
          : {}),
        url: "https://example.invalid/tool",
      },
    ],
    license,
  });
  const source = (license, notice = { status: "not-required" }) => ({
    dependencies: [
      {
        id: "tool:example",
        license,
        notice,
        scope: "build-only",
        source: { kind: "toolchain", toolId: "example" },
      },
    ],
    schemaVersion: "1",
  });
  const lock = (license, nestedLicense = undefined) => ({
    dependencyLocks: [],
    schemaVersion: "1",
    targets: {},
    tools: { example: tool(license, nestedLicense) },
  });
  const scenarios = [
    {
      code: "dependency-license",
      dependencySources: source("NOASSERTION"),
      toolchainLock: lock("NOASSERTION"),
    },
    {
      code: "dependency-license",
      dependencySources: source("MIT"),
      toolchainLock: lock("MIT", "unknown"),
    },
    ...["???", " NOASSERTION ", "NOASSERTION OR MIT"].map((license) => ({
      code: "dependency-license",
      dependencySources: source(license),
      toolchainLock: lock(license),
    })),
    {
      code: "dependency-coverage",
      dependencySources: { dependencies: [], schemaVersion: "1" },
      toolchainLock: lock("MIT"),
    },
    {
      code: "dependency-notice",
      dependencySources: source("MIT", {
        path: "third_party/notices/example.txt",
        status: "required",
      }),
      toolchainLock: lock("MIT"),
    },
    {
      code: "dependency-notice",
      dependencySources: source("MIT", {
        path: "third_party/notices/example.txt",
        status: "required",
      }),
      productFiles: { "third_party/notices/example.txt": "" },
      toolchainLock: lock("MIT"),
    },
    {
      code: "dependency-notice",
      dependencySources: source("MIT", {
        path: "third_party/notices/example.txt",
        status: "required",
      }),
      productFiles: { "third_party/notices/example.txt": "  \n\t\n" },
      toolchainLock: lock("MIT"),
    },
    {
      code: "dependency-notice",
      dependencySources: source("MIT", { path: "README.md", status: "required" }),
      toolchainLock: lock("MIT"),
    },
  ];
  for (const scenario of scenarios) {
    const sandbox = await mkdtemp(path.join(tmpdir(), `tsfg-policy-${scenario.code}-`));
    const workspace = path.join(sandbox, "workspace");
    const reportPath = path.join(sandbox, "report.json");
    try {
      const { manifestHead } = await materializePolicyFixture(workspace, {
        productFiles: {
          "eng/dependency-sources.json": `${JSON.stringify(scenario.dependencySources)}\n`,
          "eng/toolchains.lock.json": `${JSON.stringify(scenario.toolchainLock)}\n`,
          ...(scenario.productFiles ?? {}),
        },
      });
      const result = await invokeVerify(workspace, manifestHead, reportPath);
      assert.equal(result.status, 10, result.stderr);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, scenario.code);
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});

test("verify-workspace requires every declared build input in the license report", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-build-input-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    const { manifestHead } = await materializePolicyFixture(workspace, {
      productFiles: {
        "eng/build-inputs.json":
          '{"entries":[{"path":"missing-input.mjs","projectId":"tsfg"}],"schemaVersion":"1"}\n',
      },
    });
    const result = await invokeVerify(workspace, manifestHead, reportPath);
    assert.equal(result.status, 10, result.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.issues[0].code, "license-input-coverage");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace authenticates every dependency source identity", async () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const scenarios = [
    {
      productFiles: {
        "eng/dependency-sources.json":
          '{"dependencies":[{"id":"tool:example","license":"MIT","notice":{"status":"not-required"},"scope":"build-only","source":{"kind":"toolchain","toolId":"example"}}],"schemaVersion":"1"}\n',
        "eng/toolchains.lock.json":
          '{"dependencyLocks":[],"schemaVersion":"1","targets":{},"tools":{"example":{"artifacts":[{"archiveSha256":"not-a-digest","url":"relative"}],"license":"MIT"}}}\n',
      },
    },
    {
      productFiles: {
        "eng/dependency-sources.json":
          '{"dependencies":[{"id":"pnpm:example@1.0.0","license":"MIT","notice":{"status":"not-required"},"scope":"build-only","source":{"kind":"dependency-lock","lockPath":"pnpm-lock.yaml","package":"example@1.0.0"}}],"schemaVersion":"1"}\n',
        "eng/toolchains.lock.json":
          `{"dependencyLocks":[{"path":"pnpm-lock.yaml","projectId":"tsfg","sha256":"${digest}"}],"schemaVersion":"1","targets":{},"tools":{}}\n`,
        "pnpm-lock.yaml":
          "lockfileVersion: '9.0'\n\npackages:\n\n  example@1.0.0:\n    resolution: {integrity: fixture}\n\nsnapshots:\n\n  example@1.0.0: {}\n",
      },
    },
  ];
  for (const scenario of scenarios) {
    const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-dependency-identity-"));
    const workspace = path.join(sandbox, "workspace");
    const reportPath = path.join(sandbox, "report.json");
    try {
      const { manifestHead } = await materializePolicyFixture(workspace, scenario);
      const result = await invokeVerify(workspace, manifestHead, reportPath);
      assert.equal(result.status, 10, result.stderr);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, "dependency-provenance");
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});

test("verify-workspace rejects agent private state and unexplained generated outputs", async () => {
  const dist = "// SPDX-License-Identifier: MIT\nexport {};\n";
  const distDigest = `sha256:${createHash("sha256").update(dist).digest("hex")}`;
  const selfReferentialProvenance = `${JSON.stringify({
    artifacts: [
      {
        digest: distDigest,
        locks: [{ digest: distDigest, path: "dist/server.js" }],
        path: "dist/server.js",
        sources: [{ digest: distDigest, path: "dist/server.js" }],
      },
    ],
    schema_version: "1",
  })}\n`;
  const scenarios = [
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'client_secret = "concrete-private-value"\n' },
    },
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'password = "concrete-private-value"\n' },
    },
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'password = "hunter2"\n' },
    },
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'password = "multi word secret"\n' },
    },
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'OPENAI_API_KEY = "x"\n' },
    },
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'GITHUB_TOKEN = "short secret"\n' },
    },
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'oauth_session = "short secret"\n' },
    },
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'session_cookie = "concrete-private-value"\n' },
    },
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'state = "/root/private-state"\n' },
    },
    {
      code: "agent-personal-state",
      agentFiles: { "auth.json": "{}\n" },
    },
    {
      code: "agent-personal-state",
      agentFiles: { "logs/agent.log": "local execution state\n" },
    },
    {
      code: "agent-dist-only-mcp",
      agentFiles: {
        "mcp/example/dist/server.js": "// SPDX-License-Identifier: MIT\nexport {};\n",
      },
    },
    {
      code: "agent-dist-only-mcp",
      agentFiles: {
        "mcp/example/artifact-provenance.json": selfReferentialProvenance,
        "mcp/example/dist/server.js": dist,
      },
    },
    {
      code: "agent-dist-only-mcp",
      agentFiles: (() => {
        const readme = "<!-- SPDX-License-Identifier: MIT -->\n\n# not source\n";
        const lock = '{"lockfileVersion":1}\n';
        return {
          "mcp/example/src/README.md": readme,
          "mcp/example/artifact-provenance.json": `${JSON.stringify({
            artifacts: [
              {
                digest: distDigest,
                locks: [
                  {
                    digest: `sha256:${createHash("sha256").update(lock).digest("hex")}`,
                    path: "package-lock.json",
                  },
                ],
                path: "dist/server.js",
                sources: [
                  {
                    digest: `sha256:${createHash("sha256").update(readme).digest("hex")}`,
                    path: "src/README.md",
                  },
                ],
              },
            ],
            schema_version: "1",
          })}\n`,
          "mcp/example/dist/server.js": dist,
          "mcp/example/package-lock.json": lock,
        };
      })(),
    },
    {
      code: "repository-local-output",
      productFiles: {
        "out/result.mjs": "// SPDX-License-Identifier: MIT\nexport {};\n",
      },
    },
    {
      code: "generated-provenance",
      productFiles: {
        "tooling/example/generated/output.mjs":
          "// SPDX-License-Identifier: MIT\nexport {};\n",
      },
    },
  ];
  for (const scenario of scenarios) {
    const sandbox = await mkdtemp(path.join(tmpdir(), `tsfg-policy-${scenario.code}-`));
    const workspace = path.join(sandbox, "workspace");
    const reportPath = path.join(sandbox, "report.json");
    try {
      const { manifestHead } = await materializePolicyFixture(workspace, scenario);
      const result = await invokeVerify(workspace, manifestHead, reportPath);
      assert.equal(result.status, 10, result.stderr);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, scenario.code);
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});

test("verify-workspace rejects an unknown future upstream base OID without approving a fork", async () => {
  const scenarios = [
    { baseOid: "unknown", message: /base OID/ },
    { baseOid: "a".repeat(40), message: /base OID/ },
    { baseOid: (commit) => commit, code: "upstream-not-approved", message: /not approved/ },
  ];
  for (const scenario of scenarios) {
    const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-upstream-"));
    const workspace = path.join(sandbox, "workspace");
    const reportPath = path.join(sandbox, "report.json");
    try {
      const { manifestHead } = await materializePolicyFixture(workspace, {
        upstreamFiles: {
          ".gitattributes": gitAttributes,
          "LICENSE": "Apache License 2.0\n",
          "NOTICE": "Future upstream notice\n",
          "UPSTREAM.toml": (commit) => [
            'canonical_url = "https://github.com/upstream/future-upstream.git"',
            `base_oid = "${typeof scenario.baseOid === "function" ? scenario.baseOid(commit) : scenario.baseOid}"`,
            'license = "Apache-2.0"',
            'sync_branch = "refs/heads/tsfg-r00-shape-fixture"',
            'local_changes = "shape fixture only"',
            "",
          ].join("\n"),
        },
      });
      const result = await invokeVerify(workspace, manifestHead, reportPath);
      assert.equal(result.status, 10, result.stderr);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.error.issues[0].code, scenario.code ?? "upstream-provenance");
      assert.match(report.error.issues[0].message, scenario.message);
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});
