// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const buildEntry = path.join(repositoryRoot, "eng", "tsfg-build.mjs");
const networkDenialHook = path.join(
  repositoryRoot,
  "tests",
  "r00",
  "deny-network.cjs",
);
const manifestUrl = "https://github.com/xuelongling/manifests.git";

function git(cwd, ...arguments_) {
  const result = spawnSync("git", arguments_, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function initializeRepository(
  root,
  files,
  remoteUrl,
  remoteName = "github-xuelongling",
) {
  await mkdir(root, { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "tsfg fixture");
  git(root, "config", "user.email", "fixture@tsfg.invalid");
  git(root, "config", `remote.${remoteName}.url`, remoteUrl);
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "fixture");
  return git(root, "rev-parse", "HEAD");
}

async function createFixtureSymlink(target, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(target, destination, "file");
}

async function materializeFixture(workspace) {
  const license = await readFile(path.join(repositoryRoot, "LICENSE"));
  const productHead = await initializeRepository(
    path.join(workspace, "tsfg"),
    {
      ".gitattributes": "* text=auto eol=lf\n*.cmd text eol=crlf\n*.bat text eol=crlf\n",
      "LICENSE": license,
      "README.md": "# fixture product\n",
      "eng/build-inputs.json": '{"entries":[],"schemaVersion":"1"}\n',
      "eng/dependency-sources.json": '{"dependencies":[],"schemaVersion":"1"}\n',
      "eng/toolchains.lock.json":
        '{"dependencyLocks":[],"schemaVersion":"1","targets":{},"tools":{}}\n',
    },
    "https://github.com/xuelongling/tsfg.git",
  );
  const agentsHead = await initializeRepository(
    path.join(workspace, ".agents"),
    {
      ".gitattributes": "* text=auto eol=lf\n*.cmd text eol=crlf\n*.bat text eol=crlf\n",
      "AGENTS.md": "# fixture agents\n",
      "LICENSE": license,
      "codex/config.toml": "model = \"fixture\"\n",
      "codex/hooks.json": "{}\n",
    },
    "https://github.com/xuelongling/.agents.git",
  );
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <remote name="github-xuelongling" fetch="https://github.com/xuelongling/" />
  <project name="tsfg.git" path="tsfg" remote="github-xuelongling" revision="${productHead}" />
  <project name=".agents.git" path=".agents" remote="github-xuelongling" revision="${agentsHead}">
    <linkfile src="AGENTS.md" dest="AGENTS.md" />
    <linkfile src="codex/config.toml" dest=".codex/config.toml" />
    <linkfile src="codex/hooks.json" dest=".codex/hooks.json" />
  </project>
</manifest>
`;
  const manifestsRoot = path.join(workspace, ".repo", "manifests");
  const manifestHead = await initializeRepository(
    manifestsRoot,
    {
      ".gitattributes": "* text=auto eol=lf\n*.cmd text eol=crlf\n*.bat text eol=crlf\n",
      "LICENSE": license,
      "bootstrap/r00.xml": manifest,
    },
    manifestUrl,
    "origin",
  );
  const manifestGit = path.join(workspace, ".repo", "manifests.git");
  await mkdir(manifestGit, { recursive: true });
  git(manifestGit, "init", "--bare", "--quiet");
  git(manifestGit, "config", "remote.origin.url", manifestUrl);
  git(manifestGit, "config", "branch.default.merge", manifestHead);
  await writeFile(
    path.join(workspace, ".repo", "project.list"),
    ".agents\ntsfg\n",
  );
  await createFixtureSymlink(
    "manifests/bootstrap/r00.xml",
    path.join(workspace, ".repo", "manifest.xml"),
  );
  await createFixtureSymlink(
    ".agents/AGENTS.md",
    path.join(workspace, "AGENTS.md"),
  );
  await createFixtureSymlink(
    "../.agents/codex/config.toml",
    path.join(workspace, ".codex", "config.toml"),
  );
  await createFixtureSymlink(
    "../.agents/codex/hooks.json",
    path.join(workspace, ".codex", "hooks.json"),
  );
  return { manifestHead, productHead, agentsHead };
}

async function invoke(arguments_, environment = {}) {
  return await new Promise((resolve, reject) => {
    const executable = process.env.TSFG_TEST_NODE_LOADER ?? process.execPath;
    const prefix = process.env.TSFG_TEST_NODE_BINARY
      ? [process.env.TSFG_TEST_NODE_BINARY]
      : [];
    const child = spawn(executable, [...prefix, buildEntry, ...arguments_], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...environment,
        NODE_OPTIONS: `--require=${networkDenialHook}`,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("verify-workspace accepts a clean complete materialized identity", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-workspace-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    let identity;
    try {
      identity = await materializeFixture(workspace);
    } catch (error) {
      if (process.platform === "win32" && error.code === "EPERM") {
        context.skip("Windows host does not grant symbolic-link capability");
        return;
      }
      throw error;
    }
    const arguments_ = [
      "verify-workspace",
      "--workspace",
      workspace,
      "--manifest-url",
      manifestUrl,
      "--manifest-revision",
      identity.manifestHead,
      "--manifest",
      "bootstrap/r00.xml",
      "--report",
      reportPath,
    ];
    const first = await invoke(arguments_, {
      GIT_DIR: path.join(sandbox, "poison-git-dir"),
      GIT_WORK_TREE: path.join(sandbox, "poison-work-tree"),
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, "");
    const firstBytes = await readFile(reportPath, "utf8");
    const report = JSON.parse(firstBytes);
    assert.equal(report.command, "verify-workspace");
    assert.equal(report.network, "offline");
    assert.equal(report.status, "success");
    assert.equal(report.telemetry, false);
    assert.equal(report.result.dirty, false);
    assert.deepEqual(report.result.manifest, {
      repositoryUrl: manifestUrl,
      revision: identity.manifestHead,
      selected: "bootstrap/r00.xml",
    });
    assert.deepEqual(
      report.result.projects.map(({ id, path: projectPath, head, dirty }) => ({
        id,
        path: projectPath,
        head,
        dirty,
      })),
      [
        { id: ".agents.git", path: ".agents", head: identity.agentsHead, dirty: false },
        { id: "tsfg.git", path: "tsfg", head: identity.productHead, dirty: false },
      ],
    );
    assert.deepEqual(
      report.result.activation.map(({ destination, source, type }) => ({
        destination,
        source,
        type,
      })),
      [
        { destination: ".codex/config.toml", source: ".agents/codex/config.toml", type: "symbolic-link" },
        { destination: ".codex/hooks.json", source: ".agents/codex/hooks.json", type: "symbolic-link" },
        { destination: "AGENTS.md", source: ".agents/AGENTS.md", type: "symbolic-link" },
      ],
    );

    const second = await invoke(arguments_);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(reportPath, "utf8"), firstBytes);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects an extra Git project omitted from repo metadata", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-workspace-extra-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    let identity;
    try {
      identity = await materializeFixture(workspace);
    } catch (error) {
      if (process.platform === "win32" && error.code === "EPERM") {
        context.skip("Windows host does not grant symbolic-link capability");
        return;
      }
      throw error;
    }
    await initializeRepository(
      path.join(workspace, "unexpected-project"),
      { "README.md": "unexpected\n" },
      "https://github.com/xuelongling/unexpected-project.git",
    );
    const result = await invoke([
      "verify-workspace",
      "--workspace",
      workspace,
      "--manifest-url",
      manifestUrl,
      "--manifest-revision",
      identity.manifestHead,
      "--manifest",
      "bootstrap/r00.xml",
      "--report",
      reportPath,
    ]);
    assert.equal(result.status, 10);
    assert.equal(result.stdout, "");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.category, "workspace mismatch");
    assert.equal(report.error.issues[0].code, "project-set");
    assert.match(report.error.issues[0].message, /unexpected-project/);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("verify-workspace rejects an activation parent redirected through a symlink", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-workspace-parent-link-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    let identity;
    try {
      identity = await materializeFixture(workspace);
    } catch (error) {
      if (process.platform === "win32" && error.code === "EPERM") {
        context.skip("Windows host does not grant symbolic-link capability");
        return;
      }
      throw error;
    }
    await rm(path.join(workspace, ".codex"), { recursive: true });
    const redirected = path.join(workspace, "redirected-codex");
    await mkdir(redirected);
    await createFixtureSymlink(
      "../.agents/codex/config.toml",
      path.join(redirected, "config.toml"),
    );
    await createFixtureSymlink(
      "../.agents/codex/hooks.json",
      path.join(redirected, "hooks.json"),
    );
    await symlink("redirected-codex", path.join(workspace, ".codex"), "dir");

    const result = await invoke([
      "verify-workspace",
      "--workspace",
      workspace,
      "--manifest-url",
      manifestUrl,
      "--manifest-revision",
      identity.manifestHead,
      "--manifest",
      "bootstrap/r00.xml",
      "--report",
      reportPath,
    ]);
    assert.equal(result.status, 10);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.error.issues[0].code, "activation-link-parent");
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

/** @type {any[]} */
const mismatchScenarios = [
  {
    name: "wrong manifest repository HEAD",
    mutate: async ({ workspace }) => {
      const root = path.join(workspace, ".repo", "manifests");
      await writeFile(path.join(root, "README.md"), "new manifest commit\n");
      git(root, "add", "README.md");
      git(root, "commit", "--quiet", "-m", "wrong head");
    },
  },
  {
    name: "wrong selected manifest",
    mutate: async ({ workspace }) => {
      const destination = path.join(workspace, ".repo", "manifest.xml");
      await rm(destination);
      await createFixtureSymlink("manifests/other.xml", destination);
    },
  },
  {
    name: "dirty selected manifest content",
    mutate: async ({ workspace }) => {
      const selected = path.join(workspace, ".repo", "manifests", "bootstrap", "r00.xml");
      await writeFile(selected, `${await readFile(selected, "utf8")}<!-- drift -->\n`);
    },
  },
  {
    name: "wrong project HEAD",
    mutate: async ({ workspace }) => {
      const root = path.join(workspace, "tsfg");
      await writeFile(path.join(root, "other.txt"), "wrong head\n");
      git(root, "add", "other.txt");
      git(root, "commit", "--quiet", "-m", "wrong head");
    },
  },
  {
    name: "wrong canonical remote",
    mutate: async ({ workspace }) => {
      git(
        path.join(workspace, "tsfg"),
        "config",
        "remote.github-xuelongling.url",
        "https://example.invalid/tsfg.git",
      );
    },
  },
  {
    name: "missing project",
    mutate: async ({ workspace }) => {
      await rm(path.join(workspace, ".agents"), { recursive: true });
    },
  },
  {
    name: "tracked dirty project",
    mutate: async ({ workspace }) => {
      await writeFile(path.join(workspace, "tsfg", "README.md"), "dirty\n");
    },
  },
  {
    name: "tracked dirty project hidden by assume-unchanged",
    issueCode: "dirty-project",
    mutate: async ({ workspace }) => {
      const root = path.join(workspace, "tsfg");
      git(root, "update-index", "--assume-unchanged", "README.md");
      await writeFile(path.join(root, "README.md"), "dirty but hidden\n");
    },
  },
  {
    name: "tracked dirty project hidden by skip-worktree",
    issueCode: "dirty-project",
    mutate: async ({ workspace }) => {
      const root = path.join(workspace, "tsfg");
      git(root, "update-index", "--skip-worktree", "README.md");
      await writeFile(path.join(root, "README.md"), "dirty but skipped\n");
    },
  },
  {
    name: "staged dirty project",
    mutate: async ({ workspace }) => {
      const root = path.join(workspace, "tsfg");
      await writeFile(path.join(root, "staged.txt"), "staged\n");
      git(root, "add", "staged.txt");
    },
  },
  {
    name: "untracked dirty project",
    mutate: async ({ workspace }) => {
      await writeFile(path.join(workspace, "tsfg", "untracked.txt"), "untracked\n");
    },
  },
  {
    name: "copied activation entry",
    mutate: async ({ workspace }) => {
      const destination = path.join(workspace, "AGENTS.md");
      await rm(destination);
      await writeFile(destination, await readFile(path.join(workspace, ".agents", "AGENTS.md")));
    },
  },
  {
    name: "redirected activation entry",
    mutate: async ({ workspace }) => {
      const destination = path.join(workspace, "AGENTS.md");
      await rm(destination);
      await createFixtureSymlink(".agents/codex/config.toml", destination);
    },
  },
  {
    name: "workspace-escaping activation entry",
    mutate: async ({ workspace, sandbox }) => {
      const outside = path.join(sandbox, "outside-agents.md");
      await writeFile(outside, "# fixture agents\n");
      const destination = path.join(workspace, "AGENTS.md");
      await rm(destination);
      await createFixtureSymlink(path.relative(workspace, outside), destination);
    },
  },
  {
    name: "activation content identity drift hidden from status",
    mutate: async ({ workspace }) => {
      const root = path.join(workspace, ".agents");
      await writeFile(path.join(root, "AGENTS.md"), "# drifted agents\n");
      git(root, "update-index", "--assume-unchanged", "AGENTS.md");
    },
  },
  {
    name: "hardlinked activation source",
    mutate: async ({ workspace, sandbox }) => {
      await link(
        path.join(workspace, ".agents", "AGENTS.md"),
        path.join(sandbox, "hardlink-to-agents.md"),
      );
    },
  },
];

for (const scenario of mismatchScenarios) {
  test(`verify-workspace rejects ${scenario.name}`, async (context) => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-workspace-mismatch-"));
    const workspace = path.join(sandbox, "workspace");
    const reportPath = path.join(sandbox, "report.json");
    try {
      let identity;
      try {
        identity = await materializeFixture(workspace);
      } catch (error) {
        if (process.platform === "win32" && error.code === "EPERM") {
          context.skip("Windows host does not grant symbolic-link capability");
          return;
        }
        throw error;
      }
      await scenario.mutate({ workspace, sandbox });
      const arguments_ = [
        "verify-workspace",
        "--workspace",
        workspace,
        "--manifest-url",
        manifestUrl,
        "--manifest-revision",
        identity.manifestHead,
        "--manifest",
        "bootstrap/r00.xml",
        "--report",
        reportPath,
      ];
      const first = await invoke(arguments_);
      assert.equal(first.status, 10, `${scenario.name}: ${first.stderr}`);
      assert.equal(first.stdout, "");
      assert.notEqual(first.stderr, "");
      const firstBytes = await readFile(reportPath, "utf8");
      const report = JSON.parse(firstBytes);
      assert.equal(report.schemaVersion, "1");
      assert.equal(report.command, "verify-workspace");
      assert.equal(report.network, "offline");
      assert.equal(report.status, "failure");
      assert.equal(report.telemetry, false);
      assert.equal(report.error.category, "workspace mismatch");
      assert.equal(report.error.code, "10");
      if (scenario.issueCode) {
        assert.equal(report.error.issues[0].code, scenario.issueCode);
      }
      const second = await invoke(arguments_);
      assert.equal(second.status, 10);
      assert.equal(await readFile(reportPath, "utf8"), firstBytes);
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
