// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildEntry = path.join(repositoryRoot, "eng", "tsfg-build.mjs");
const networkDenialHook = path.join(repositoryRoot, "tests", "r00", "deny-network.cjs");
const manifestUrl = "https://github.com/xuelongling/manifests.git";
const gitAttributes = "* text=auto eol=lf\n*.cmd text eol=crlf\n*.bat text eol=crlf\n";

function git(cwd, ...arguments_) {
  const result = spawnSync("git", arguments_, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function initializeRepository(root, files, remoteUrl, remoteName, indexEntries = []) {
  await mkdir(root, { recursive: true });
  git(root, "init", "--quiet");
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
  const productHead = await initializeRepository(
    path.join(workspace, "tsfg"),
    {
      ".gitattributes": gitAttributes,
      "LICENSE": license,
      "README.md": "# fixture product\n",
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
      "AGENTS.md": "# fixture agents\n",
      "LICENSE": license,
      "codex/config.toml": "model = \"fixture\"\n",
      "codex/hooks.json": "{}\n",
      ...(overrides.agentFiles ?? {}),
    },
    "https://github.com/xuelongling/.agents.git",
    "github-xuelongling",
  );
  let upstream;
  if (overrides.upstreamFiles) {
    const upstreamHead = await initializeRepository(
      path.join(workspace, "future-upstream"),
      overrides.upstreamFiles,
      "https://github.com/xuelongling/future-upstream.git",
      "github-xuelongling",
    );
    upstream = `  <project name="future-upstream.git" path="future-upstream" remote="github-xuelongling" revision="${upstreamHead}" />\n`;
  }
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <remote name="github-xuelongling" fetch="https://github.com/xuelongling/" />
  <project name="tsfg.git" path="tsfg" remote="github-xuelongling" revision="${productHead}" />
${upstream ?? ""}  
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
    { ".gitattributes": gitAttributes, "LICENSE": license, "bootstrap/r00.xml": manifest },
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
    `.agents\n${overrides.upstreamFiles ? "future-upstream\n" : ""}tsfg\n`,
  );
  await createFixtureSymlink("manifests/bootstrap/r00.xml", path.join(workspace, ".repo", "manifest.xml"));
  await createFixtureSymlink(".agents/AGENTS.md", path.join(workspace, "AGENTS.md"));
  await createFixtureSymlink(
    "../.agents/codex/config.toml",
    path.join(workspace, ".codex", "config.toml"),
  );
  await createFixtureSymlink(
    "../.agents/codex/hooks.json",
    path.join(workspace, ".codex", "hooks.json"),
  );
  return { manifestHead };
}

async function invokeVerify(workspace, manifestHead, reportPath) {
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
        "bootstrap/r00.xml",
        "--report",
        reportPath,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, NODE_OPTIONS: `--require=${networkDenialHook}` },
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

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
      code: "license-spdx",
      productFiles: { "eng/example.mjs": "export {};\n" },
    },
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
  const scenarios = [
    {
      code: "agent-secret",
      agentFiles: { "codex/private.toml": 'client_secret = "concrete-private-value"\n' },
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
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-policy-upstream-"));
  const workspace = path.join(sandbox, "workspace");
  const reportPath = path.join(sandbox, "report.json");
  try {
    const { manifestHead } = await materializePolicyFixture(workspace, {
      upstreamFiles: {
        ".gitattributes": gitAttributes,
        "LICENSE": "Apache License 2.0\n",
        "NOTICE": "Future upstream notice\n",
        "UPSTREAM.toml": [
          'canonical_url = "https://github.com/upstream/future-upstream.git"',
          'base_oid = "unknown"',
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
    assert.equal(report.error.issues[0].code, "upstream-provenance");
    assert.match(report.error.issues[0].message, /base OID/);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
