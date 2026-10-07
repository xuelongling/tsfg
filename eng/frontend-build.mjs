// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifiedContractSet } from "./contract-set.mjs";
import { sourceGitEnvironment } from "./intake-ledger.mjs";

const sha256 = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export class FrontendBuildError extends Error {}

function run(executable, args, cwd, env, input = undefined) {
  const child = spawnSync(executable, args, { cwd, env, input, encoding: "utf8", windowsHide: true,
    timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  if (child.error || child.status !== 0) {
    throw new FrontendBuildError(`${path.basename(executable)} ${args[0]} failed: ${child.error?.message ?? child.stderr}`);
  }
  return child.stdout;
}

function parsePackages(text) {
  const packages = [];
  let depth = 0, start = 0, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") { if (depth++ === 0) start = index; }
    else if (char === "}" && --depth === 0) packages.push(JSON.parse(text.slice(start, index + 1)));
    else if (depth === 0 && !/\s/.test(char)) throw new FrontendBuildError("invalid Go package stream");
  }
  if (depth || quoted || !packages.length) throw new FrontendBuildError("incomplete Go package stream");
  return packages;
}

export async function executeFrontendTarget({ command, productRoot, sourceRoot, out, runtime,
  go, node, git, dependencyProxy, serialize }) {
  const lock = JSON.parse(await readFile(path.join(productRoot, "eng/frontend-source.lock.json"), "utf8"));
  const registry = JSON.parse(await readFile(path.join(productRoot, "contracts/registry.json"), "utf8"));
  await verifiedContractSet(productRoot, registry, serialize);
  const schema = JSON.parse(await readFile(path.join(productRoot, "contracts/frontend-snapshot.schema.json"), "utf8"));
  const contract = registry["tsfg.frontend-snapshot"];
  if (contract?.semver !== lock.contractVersion || contract?.compatibility !== "exact"
      || contract?.schemaHash !== sha256(serialize(schema))) {
    throw new FrontendBuildError("frontend snapshot contract differs from its registered schema");
  }
  if (lock.schemaVersion !== "1"
      || lock.languageBaseline !== "TypeScript 7.0.2") throw new FrontendBuildError("invalid frontend source lock");
  const gitEnv = sourceGitEnvironment();
  const head = run(git, ["rev-parse", "HEAD"], sourceRoot, gitEnv).trim();
  const status = run(git, ["status", "--porcelain=v1", "--untracked-files=all"], sourceRoot, gitEnv).trim();
  if (head !== lock.forkOid || status) throw new FrontendBuildError("frontend fork identity is not clean and locked");
  if (run(git, ["remote", "get-url", "origin"], sourceRoot, gitEnv).trim() !== lock.remoteUrl
      || run(git, ["symbolic-ref", "HEAD"], sourceRoot, gitEnv).trim() !== lock.sourceBranch
      || lock.canonicalUrl !== "https://github.com/microsoft/TypeScript.git"
      || lock.license !== "Apache-2.0") {
    throw new FrontendBuildError("frontend fork provenance differs from its lock");
  }
  run(git, ["merge-base", "--is-ancestor", lock.upstreamBaseOid, "HEAD"], sourceRoot, gitEnv);
  const localModifications = new Set(run(git, ["diff", "--name-only", `${lock.upstreamBaseOid}...HEAD`],
    sourceRoot, gitEnv).trim().split(/\r?\n/).filter(Boolean));
  if (!localModifications.has(lock.producerPath)
      || sha256(await readFile(path.join(sourceRoot, "UPSTREAM.toml"))) !== lock.upstreamTomlSha256) {
    throw new FrontendBuildError("frontend local modification or provenance bytes differ from lock");
  }
  const producer = await readFile(path.join(sourceRoot, lock.producerPath));
  if (sha256(producer) !== lock.producerSha256 || !Array.isArray(lock.declarations)
      || lock.declarations.map(item => item.path).join(",") !== "compiler/minimal-bool-v1.d.ts,compiler/minimal-scalars-v2.d.ts,compiler/minimal-integers-v3.d.ts,compiler/minimal-floats-v4.d.ts,compiler/minimal-conversions-v5.d.ts") {
    throw new FrontendBuildError("frontend source or declaration differs from its lock");
  }
  for (const item of lock.declarations) {
    if (sha256(await readFile(path.join(productRoot, item.path))) !== item.sha256) {
      throw new FrontendBuildError("frontend declaration differs from its lock");
    }
  }
  await stat(out).then(() => { throw new FrontendBuildError("frontend output already exists"); }, error => {
    if (error.code !== "ENOENT") throw error;
  });
  const tempRoot = await realpath(tmpdir());
  if (!/^E:\\/i.test(tempRoot)) throw new FrontendBuildError("frontend temporary root must be on E:");
  const stage = await mkdtemp(path.join(tempRoot, "tsfg-frontend-"));
  try {
    await mkdir(out, { recursive: true });
    const executable = path.join(out, "tsfg-frontend.exe");
    const env = {
      SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec,
      PATH: path.dirname(go), HOME: stage, USERPROFILE: stage, APPDATA: stage, LOCALAPPDATA: stage,
      TEMP: stage, TMP: stage, TMPDIR: stage,
      GOCACHE: path.join(stage, "gocache"), GOMODCACHE: path.join(stage, "modules"),
      GOPATH: path.join(stage, "gopath"), GOPROXY: pathToFileURL(dependencyProxy.root).href,
      GOSUMDB: "off", GOENV: "off", GOWORK: "off", GOTOOLCHAIN: "local", GOFLAGS: "-p=1", GOMAXPROCS: "2",
      GOEXPERIMENT: "", GOOS: "windows", GOARCH: "amd64", GOAMD64: "v2", CGO_ENABLED: "0",
    };
    const goList = run(go, ["list", "-deps", "-json", "-mod=readonly", "-buildvcs=false", "./cmd/tsfg-frontend"],
      path.join(sourceRoot, "tsc"), env);
    const goRoot = run(go, ["env", "GOROOT"], path.join(sourceRoot, "tsc"), env).trim();
    if (path.resolve(goRoot) !== path.resolve(go, "../..")) {
      throw new FrontendBuildError("Go standard library is not from the locked toolchain");
    }
    const packageFiles = new Set(["UPSTREAM.toml", "LICENSE.txt", "ThirdPartyNoticeText.txt",
      "tsc/go.mod", "tsc/go.sum", "tsc/LICENSE", "tsc/NOTICE.txt"]);
    const auxiliaryFiles = new Map();
    let packageCount = 0;
    for (const pkg of parsePackages(goList)) {
      if (pkg.Error || pkg.DepsErrors || pkg.Incomplete || pkg.Module?.Replace) {
        throw new FrontendBuildError(`incomplete or replaced Go package: ${pkg.ImportPath}`);
      }
      const mainModule = pkg.Module?.Path === "github.com/microsoft/typescript-go" && pkg.Module.Main;
      if (mainModule) packageCount += 1;
      for (const kind of ["GoFiles", "CgoFiles", "SFiles", "HFiles", "SysoFiles", "EmbedFiles"]) {
        for (const name of pkg[kind] ?? []) {
          const file = path.resolve(pkg.Dir, name);
          let root, projectId;
          if (mainModule) { root = sourceRoot; projectId = "TypeScript.git"; }
          else if (pkg.Standard) { root = goRoot; projectId = "go-toolchain"; }
          else {
            const identity = dependencyProxy.modules.find(module => module.path === pkg.Module?.Path
              && module.version === pkg.Module?.Version);
            if (!identity || !pkg.Module?.Dir) {
              throw new FrontendBuildError(`Go package lacks locked module identity: ${pkg.ImportPath}`);
            }
            root = pkg.Module.Dir;
            projectId = `module:${identity.path}@${identity.version}`;
          }
          const relative = path.relative(root, file).replaceAll("\\", "/");
          if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
            throw new FrontendBuildError("Go package input escapes its locked source root");
          }
          if (mainModule) packageFiles.add(relative);
          else auxiliaryFiles.set(`${projectId}\0${relative}`, { projectId, path: relative, file });
        }
      }
    }
    if (!packageCount || !packageFiles.has(lock.producerPath)) {
      throw new FrontendBuildError("frontend producer is absent from Go dependency closure");
    }
    const upstreamEntries = [];
    for (const name of [...packageFiles].sort()) {
      upstreamEntries.push({ projectId: "TypeScript.git", path: name,
        sha256: sha256(await readFile(path.join(sourceRoot, name))) });
    }
    const auxiliaryEntries = [];
    for (const item of [...auxiliaryFiles.values()].sort((a, b) =>
      `${a.projectId}/${a.path}`.localeCompare(`${b.projectId}/${b.path}`))) {
      auxiliaryEntries.push({ projectId: item.projectId, path: item.path,
        sha256: sha256(await readFile(item.file)) });
    }
    const admission = JSON.parse(await readFile(path.join(productRoot, "eng/frontend-source-admission.json"), "utf8"));
    const expectedSource = { projectId: "TypeScript.git", forkOid: head,
      upstreamBaseOid: lock.upstreamBaseOid, remoteUrl: lock.remoteUrl,
      canonicalUrl: lock.canonicalUrl, sourceBranch: lock.sourceBranch, license: lock.license };
    const observedFiles = upstreamEntries.map(({ path: name, sha256: fileSha256 }) => ({
      path: name, sha256: fileSha256,
      localModification: localModifications.has(name) ? "fork-local modification" : null }));
    if (admission.schemaVersion !== "1" || serialize(admission.source) !== serialize(expectedSource)
        || serialize(admission.files) !== serialize(observedFiles)) {
      throw new FrontendBuildError("frontend consumed source differs from approved per-file admission");
    }
    const productEntries = [];
    for (const name of ["contracts/registry.json", "contracts/frontend-snapshot.schema.json",
      "eng/build-inputs.json", "eng/contract-set.mjs", "eng/frontend-build.mjs", "eng/frontend-source-admission.json", "eng/frontend-source.lock.json",
      "eng/frontend-toolchains.lock.json", "eng/tsfg-build.mjs", "compiler/frontend.mjs", "compiler/identity.mjs", "compiler/conversions.mjs", "contracts/conversion-entries.json", "compiler/minimal-bool-v1.d.ts", "compiler/minimal-scalars-v2.d.ts", "compiler/minimal-integers-v3.d.ts", "compiler/minimal-floats-v4.d.ts", "compiler/minimal-conversions-v5.d.ts",
      ...(command === "test" ? ["tests/r02b/frontend.test.mjs"] : [])]) {
      productEntries.push({ projectId: "tsfg", path: name,
        sha256: sha256(await readFile(path.join(productRoot, name))) });
    }
    const buildInputSet = { schemaVersion: "1", entries: [...upstreamEntries, ...productEntries, ...auxiliaryEntries]
      .sort((a, b) => `${a.projectId}/${a.path}`.localeCompare(`${b.projectId}/${b.path}`)) };
    const inputDigest = sha256(serialize(buildInputSet));
    await writeFile(path.join(out, "go-list.jsonstream"), goList);
    const args = ["build", "-mod=readonly", "-buildvcs=false", "-pgo=off", "-trimpath",
      "-gcflags=all=-N -l", "-o", executable, "./cmd/tsfg-frontend"];
    run(go, args, path.join(sourceRoot, "tsc"), env);
    const binarySha256 = sha256(await readFile(executable));
    if (binarySha256 !== lock.executableSha256) {
      throw new FrontendBuildError("frontend executable differs from locked build bytes");
    }
    let testOutput;
    if (command === "test") {
      testOutput = run(node, ["--test", "tests/r02b/frontend.test.mjs"], productRoot,
        { ...env, TSFG_FRONTEND_EXE: executable });
    }
    for (const entry of upstreamEntries) {
      if (sha256(await readFile(path.join(sourceRoot, entry.path))) !== entry.sha256) {
        throw new FrontendBuildError(`frontend source changed during build: ${entry.path}`);
      }
    }
    for (const item of auxiliaryFiles.values()) {
      const entry = auxiliaryEntries.find(candidate => candidate.projectId === item.projectId
        && candidate.path === item.path);
      if (sha256(await readFile(item.file)) !== entry.sha256) {
        throw new FrontendBuildError(`Go tool or module input changed during build: ${item.projectId}/${item.path}`);
      }
    }
    const intakeLedger = { schemaVersion: "1", status: "verified", evidenceKind: "real-source",
      projectId: "TypeScript.git", forkOid: head, upstreamBaseOid: lock.upstreamBaseOid,
      remoteUrl: lock.remoteUrl, canonicalUrl: lock.canonicalUrl, sourceBranch: lock.sourceBranch,
      license: lock.license, consumer: "tsfg-frontend", packageCount,
      goListSha256: sha256(goList), files: upstreamEntries.map(entry => ({ ...entry,
        license: lock.license, role: "compiler-payload", consumer: "tsfg-frontend",
        localModification: localModifications.has(entry.path) ? "fork-local modification" : null })),
      auxiliaryFiles: auxiliaryEntries };
    await writeFile(path.join(out, "intake-ledger.json"), `${serialize(intakeLedger)}\n`);
    return { schemaVersion: "1", status: command === "test" ? "passed" : "built",
      capability: "integer-family-v5", contractVersion: lock.contractVersion,
      source: { forkOid: head, producer: lock.producerPath },
      toolchainClosureDigest: runtime.lockDigest, dependencyProxyIdentity: dependencyProxy.identity,
      buildInputSet, buildInputSetDigest: inputDigest, intakeLedger,
      executable, executableSha256: binarySha256,
      ...(testOutput === undefined ? {} : { tests: { status: "passed", command: "node --test tests/r02b/frontend.test.mjs", output: testOutput } }),
      executionMode: "local-development", isolation: "not-enforced" };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
