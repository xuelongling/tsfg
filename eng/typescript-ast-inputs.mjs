// SPDX-License-Identifier: MIT
// Target-specific reconciliation of Go's real package inputs with fixed approvals.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IntakeLedgerError, sourceGitEnvironment } from "./intake-ledger.mjs";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = message => { throw new IntakeLedgerError("ast-input-identity", message); };
const compare = (a, b) => Buffer.from(a).compare(Buffer.from(b));

export function astGit(executable, root, args) {
  const env = sourceGitEnvironment();
  const result = spawnSync(executable, ["--no-replace-objects", "-c", "core.longpaths=true", "-C", root, ...args], {
    env, maxBuffer: 128 * 1024 * 1024, timeout: 120000, windowsHide: true });
  if (result.error || result.status !== 0) fail(`Git ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

export async function astBuildInputs(intake, ledger, serialize) {
  const git = (root, args) => astGit(intake.request.gitExecutable, root, args);
  const controlNames = ["eng/tsfg-build.mjs", "eng/contract-set.mjs", "eng/typescript-ast.mjs", "eng/typescript-ast-inputs.mjs",
    "eng/typescript-repro.mjs", "eng/upgrade-review.mjs", "eng/vulnerability-admission.mjs",
    "eng/intake-declarations/typescript-ast-toolchain.json",
    "eng/typescript-generation.mjs",
    "eng/typescript-required-tests.mjs",
    "eng/typescript-probes.mjs", "eng/go-source-worker.mjs", "eng/go-source-result.mjs", "eng/go-closure.mjs", "eng/go-network-probe.mjs",
    "eng/go-work-access.mjs", "eng/intake-ledger.mjs", "eng/source-admission.mjs", "eng/workspace-policy.json",
    "contracts/registry.json", ...intake.probes.inputs.map(input => input.path)];
  const declared = [...ledger.buildInputEntries.map(entry => ({ projectId: entry.projectId,
    root: path.join(intake.request.workspaceRoot, ledger.sources.find(source => source.projectId === entry.projectId).path),
    relative: entry.path.slice(ledger.sources.find(source => source.projectId === entry.projectId).path.length + 1),
    sha256: entry.sha256 })), ...await Promise.all(controlNames.map(async relative => ({
      projectId: "tsfg", root: intake.controlRoot, relative,
      sha256: hash(await readFile(path.join(intake.controlRoot, relative))) })))];
  const trees = new Map();
  const entries = [], epochs = [];
  for (const input of declared) {
    if (!trees.has(input.root)) {
      trees.set(input.root, new Map(git(input.root, ["ls-tree", "-r", "-z", "HEAD"]).toString("utf8")
        .split("\0").filter(Boolean).map(line => {
          const match = /^(\d+) blob [a-f0-9]{40}\t(.+)$/.exec(line);
          return match ? [match[2], match[1]] : ["", ""];
        })));
    }
    const mode = trees.get(input.root).get(input.relative);
    if (!["100644", "100755"].includes(mode)) fail(`Build Input is not a committed regular file: ${input.relative}`);
    entries.push({ projectId: input.projectId, repositoryRelativePath: input.relative,
      normalizedMode: mode, sha256: input.sha256 });
    const epoch = git(input.root, ["log", "-1", "--format=%ct", "--", input.relative]).toString("utf8").trim();
    if (!/^[1-9][0-9]*$/.test(epoch)) fail(`Build Input has no last-touch timestamp: ${input.relative}`);
    epochs.push(BigInt(epoch));
  }
  const sourceRoot = path.join(intake.request.workspaceRoot, "typescript");
  for (const input of intake.generation?.sources ?? []) {
    entries.push({ projectId: "TypeScript.git", repositoryRelativePath: `tsc/${input.mount}`,
      normalizedMode: input.normalizedMode, sha256: input.sha256 });
    const epoch = git(sourceRoot, ["log", "-1", "--format=%ct", input.sourceIdentity, "--", input.path]).toString("utf8").trim();
    if (!/^[1-9][0-9]*$/.test(epoch)) fail(`generation Build Input has no last-touch timestamp: ${input.path}`);
    epochs.push(BigInt(epoch));
  }
  entries.sort((a, b) => compare(a.projectId, b.projectId) || compare(a.repositoryRelativePath, b.repositoryRelativePath));
  const payload = { schemaVersion: "1", entries };
  return { buildInputSet: { ...payload, digest: hash(serialize(payload)) },
    sourceDateEpoch: String(epochs.reduce((a, b) => a > b ? a : b)),
    provenance: [...ledger.sources.map(source => ({ projectId: source.projectId, projectOid: source.forkOid })),
      { projectId: "tsfg", projectOid: git(intake.controlRoot, ["rev-parse", "HEAD"]).toString("utf8").trim() }],
    dirty: git(intake.controlRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).length !== 0 };
}

export async function astToolchainInputs(intake, plan, worker) {
  const root = path.join(intake.controlRoot, "eng/intake-declarations/typescript-ast-toolchain.json");
  const bytes = await readFile(root);
  const declaration = JSON.parse(bytes.toString("utf8"));
  const expected = new Map();
  if (declaration.schemaVersion !== "1" || declaration.consumer !== "tsfg-ast" || !Array.isArray(declaration.entries)) fail("invalid AST tool input declaration");
  for (const entry of declaration.entries) {
    const key = `${entry.source}\0${entry.path}`;
    if (expected.has(key) || !/^(build-only|compiler-payload)$/.test(entry.role)
        || typeof entry.path !== "string" || entry.path.split("/").some(p => !p || p === ".." || p === ".")
        || /[:\\]/.test(entry.path) || !/^sha256:[a-f0-9]{64}$/.test(entry.sha256)) fail("invalid AST tool input entry");
    expected.set(key, entry);
  }
  const lock = intake.toolLock;
  const sources = new Map([
    ["go", { root: plan.environment.GOROOT, version: lock.tools.go.version, license: lock.tools.go.license,
      identity: lock.tools.go.artifacts.find(item => item.platform === "windows-x86_64-msvc").unpackedTreeSha256 }],
    ["node", { root: path.join(plan.inputRoot, "node"), version: lock.tools.node.version, license: lock.tools.node.license,
      identity: lock.tools.node.artifacts.find(item => item.platform === "windows-x86_64-msvc").unpackedTreeSha256 }],
  ]);
  for (const module of intake.dependencyLock.modules) sources.set(`module:${module.path}@${module.version}`, {
    root: path.join(plan.environment.GOMODCACHE, `${module.path}@${module.version}`),
    version: module.version, license: module.license, identity: module.sum });
  const files = new Map();
  async function consume(source, name, role = "compiler-payload") {
    const origin = sources.get(source);
    if (!origin || !["MIT", "BSD-2-Clause", "BSD-3-Clause"].includes(origin.license)) fail(`unapproved tool source or license: ${source}`);
    const relative = name.replaceAll("\\", "/");
    const key = `${source}\0${relative}`;
    const approval = expected.get(key);
    if (!approval || approval.role !== role) fail(`unregistered toolchain consumption: ${source}/${relative}`);
    const sha256 = hash(await readFile(path.join(origin.root, relative)));
    if (sha256 !== approval.sha256) fail(`toolchain file differs from approved bytes: ${source}/${relative}`);
    files.set(key, { source, path: relative, sha256, role, consumer: "tsfg-ast", version: origin.version,
      sourceIdentity: origin.identity, license: origin.license, legal: { path: "LICENSE", sha256: expected.get(`${source}\0LICENSE`)?.sha256 } });
  }
  for (const item of worker.packages) {
    if (item.module === "github.com/microsoft/typescript-go") continue;
    const source = item.standard ? "go" : `module:${item.module}@${item.moduleVersion}`;
    const origin = sources.get(source);
    if (!origin) fail(`unknown resolved toolchain source: ${source}`);
    for (const name of item.inputFiles) {
      const relative = path.relative(origin.root, path.resolve(item.directory, name));
      if (relative.startsWith("..") || path.isAbsolute(relative)) fail("toolchain package escapes its source");
      await consume(source, relative);
    }
  }
  for (const name of ["bin/go.exe", "pkg/tool/windows_amd64/compile.exe", "pkg/tool/windows_amd64/asm.exe",
    "pkg/tool/windows_amd64/link.exe", "VERSION", "go.env", "LICENSE"]) await consume("go", name, "build-only");
  for (const name of ["asm_amd64.h", "funcdata.h", "textflag.h"]) await consume("go", `pkg/include/${name}`);
  for (const name of ["node.exe", "LICENSE"]) await consume("node", name, "build-only");
  for (const module of worker.modules) for (const name of ["LICENSE", "go.mod"]) {
    await consume(`module:${module.path}@${module.version}`, name, "build-only");
  }
  if (files.size !== expected.size) fail("toolchain declaration contains unconsumed files");
  return { schemaVersion: "1", status: "matched", declarationSha256: hash(bytes),
    method: "Go package inputs plus compiler tools, assembly headers and required legal/module control files",
    files: [...files.values()].sort((a, b) => compare(`${a.source}\0${a.path}`, `${b.source}\0${b.path}`)) };
}

// Audit the packages actually resolved for the selected generators/tests. Module
// files are matched to verified proxy archives, never trusted on first read.
export async function astAuxiliaryInputs(intake, plan, moduleRoot, requests) {
  const files = new Map(), generated = [], commands = [], checked = new Map();
  const origins = new Map();
  const inside = (root, file) => {
    const name = path.relative(root, file).replaceAll("\\", "/");
    return name && name !== ".." && !name.startsWith("../") && !path.isAbsolute(name) ? name : undefined;
  };
  async function consume(file, origin, relative, expected) {
    if (!expected || hash(await readFile(file)) !== expected) fail(`auxiliary input differs from locked bytes: ${origin.source}/${relative}`);
    checked.set(file, expected);
    files.set(`${origin.source}\0${relative}`, { ...origin, path: relative, sha256: expected, role: "build-only", consumer: "tsfg-ast-generation-tests" });
  }
  async function moduleOrigin(item) {
    const identity = plan.modules.find(module => module.path === item.Module?.Path && module.version === item.Module?.Version);
    const approval = intake.dependencyLock.modules.find(module => module.path === identity?.path);
    if (!identity || !approval || item.Module.Replace) fail(`unlocked auxiliary Go module: ${item.ImportPath}`);
    if (!origins.has(identity.path)) {
      const archive = path.join(fileURLToPath(plan.environment.GOPROXY), identity.path, "@v", `${identity.version}.zip`);
      const bytes = await readFile(archive);
      if (hash(bytes) !== identity.archiveSha256) fail("auxiliary module archive changed");
      const prefix = `${identity.path}@${identity.version}/`;
      const expected = new Map(intake.parseZip(bytes).filter(entry => entry.type === "0")
        .map(entry => [entry.name.slice(prefix.length), hash(entry.bytes)]));
      const origin = { source: `module:${identity.path}@${identity.version}`, sourceIdentity: identity.sum,
        license: approval.license, legal: { path: "LICENSE", sha256: approval.licenseEvidence.sha256 } };
      const root = path.join(plan.environment.GOMODCACHE, `${identity.path}@${identity.version}`);
      for (const name of ["LICENSE", "go.mod"]) await consume(path.join(root, name), origin, name, expected.get(name));
      origins.set(identity.path, { root, origin, expected });
    }
    return origins.get(identity.path);
  }
  for (const request of requests) {
    const args = ["list", "-deps", "-json", "-mod=readonly", ...(request.tests ? ["-test"] : []), ...request.targets];
    const child = spawnSync(plan.go, args, { cwd: request.cwd ?? moduleRoot,
      env: { ...plan.environment, PATH: path.dirname(plan.go) }, encoding: "utf8", timeout: 300000,
      maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    commands.push({ executable: plan.go, arguments: args, cwd: request.cwd ?? moduleRoot,
      exitCode: child.status, outputSha256: hash(child.stdout ?? ""), stderr: child.stderr });
    if (child.error || child.status !== 0) fail(`auxiliary Go resolution failed: ${child.error?.message ?? child.stderr}`);
    // go list emits pretty-printed objects with only root braces at column zero.
    const packages = JSON.parse(`[${child.stdout.trim().replace(/^}\r?\n{/gm, "},{")}]`);
    if (!packages.length) fail("auxiliary Go resolution returned no packages");
    for (const item of packages) {
      if (item.Error || item.DepsErrors || item.Incomplete || item.CgoFiles?.length) fail(`incomplete auxiliary package: ${item.ImportPath}`);
      for (const name of [...(item.GoFiles ?? []), ...(item.SFiles ?? []), ...(item.HFiles ?? []), ...(item.SysoFiles ?? []), ...(item.EmbedFiles ?? [])]) {
        const file = path.resolve(item.Dir, name);
        const relative = inside(moduleRoot, file);
        if (relative) {
          const approval = intake.ledger.files.find(entry => entry.path === `tsc/${relative}`);
          if (!approval) fail(`unregistered auxiliary source consumption: ${relative}`);
          await consume(file, { source: "TypeScript.git", sourceIdentity: intake.ledger.sources[0].forkOid,
            license: "Apache-2.0", legal: { path: "tsc/LICENSE", sha256: intake.ledger.files.find(entry => entry.path === "tsc/LICENSE").sha256 } }, `tsc/${relative}`, approval.sha256);
        } else if (request.tests && item.ImportPath.endsWith(".test") && item.Name === "main"
            && inside(plan.environment.GOCACHE, file)) {
          generated.push({ package: item.ImportPath, sha256: hash(await readFile(file)), kind: "Go-generated-test-harness", sourceIdentity: `go${plan.goVersion}` });
        } else if (item.Standard) {
          const relative = inside(plan.environment.GOROOT, file);
          const approval = plan.inputs.find(input => path.resolve(input.path) === file);
          if (!relative) fail("auxiliary Go standard input escapes GOROOT");
          await consume(file, { source: "go", sourceIdentity: intake.toolLock.tools.go.artifacts.find(item => item.platform === "windows-x86_64-msvc").unpackedTreeSha256,
            license: "BSD-3-Clause", legal: { path: "LICENSE", sha256: plan.inputs.find(input => input.path === path.join(plan.environment.GOROOT, "LICENSE")).sha256 } }, relative, approval?.sha256);
        } else {
          const { root, origin, expected } = await moduleOrigin(item);
          const relative = inside(root, file);
          if (!relative) fail("auxiliary Go module input escapes its verified module");
          await consume(file, origin, relative, expected.get(relative));
        }
      }
    }
  }
  return { ledger: { schemaVersion: "1", status: "matched", commands,
    files: [...files.values()].sort((a, b) => compare(`${a.source}/${a.path}`, `${b.source}/${b.path}`)), generated },
    verify: async () => {
      for (const [file, expected] of checked) if (hash(await readFile(file)) !== expected) fail(`auxiliary input mutated during execution: ${file}`);
    } };
}
