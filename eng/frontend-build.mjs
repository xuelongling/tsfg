// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  if (lock.schemaVersion !== "1" || lock.contractVersion !== "1"
      || lock.languageBaseline !== "TypeScript 7.0.2") throw new FrontendBuildError("invalid frontend source lock");
  const head = run(git, ["rev-parse", "HEAD"], sourceRoot, process.env).trim();
  const status = run(git, ["status", "--porcelain=v1", "--untracked-files=all"], sourceRoot, process.env).trim();
  if (head !== lock.forkOid || status) throw new FrontendBuildError("frontend fork identity is not clean and locked");
  const producer = await readFile(path.join(sourceRoot, lock.producerPath));
  const declaration = await readFile(path.join(productRoot, lock.declarationPath));
  if (sha256(producer) !== lock.producerSha256 || sha256(declaration) !== lock.declarationSha256) {
    throw new FrontendBuildError("frontend source or declaration differs from its lock");
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
      GOSUMDB: "off", GOENV: "off", GOWORK: "off", GOTOOLCHAIN: "local", GOFLAGS: "",
      GOEXPERIMENT: "", GOOS: "windows", GOARCH: "amd64", GOAMD64: "v2", CGO_ENABLED: "0",
    };
    const goList = run(go, ["list", "-deps", "-json", "-mod=readonly", "-buildvcs=false", "./cmd/tsfg-frontend"],
      path.join(sourceRoot, "tsc"), env);
    const packageFiles = new Set(["tsc/go.mod", "tsc/go.sum", "tsc/LICENSE", "tsc/NOTICE.txt"]);
    let packageCount = 0;
    for (const pkg of parsePackages(goList)) {
      if (pkg.Module?.Path !== "github.com/microsoft/typescript-go") continue;
      packageCount += 1;
      for (const kind of ["GoFiles", "CgoFiles", "SFiles", "SysoFiles", "EmbedFiles"]) {
        for (const name of pkg[kind] ?? []) {
          const relative = path.relative(sourceRoot, path.resolve(pkg.Dir, name)).replaceAll("\\", "/");
          if (relative.startsWith("../") || path.isAbsolute(relative)) {
            throw new FrontendBuildError("Go package input escapes the source repository");
          }
          packageFiles.add(relative);
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
    const productEntries = [];
    for (const name of ["eng/build-inputs.json", "eng/frontend-build.mjs", "eng/frontend-source.lock.json",
      "eng/frontend-toolchains.lock.json", "eng/tsfg-build.mjs", "src/frontend.mjs", "src/minimal-bool-v1.d.ts",
      ...(command === "test" ? ["tests/r02b/frontend.test.mjs"] : [])]) {
      productEntries.push({ projectId: "tsfg", path: name,
        sha256: sha256(await readFile(path.join(productRoot, name))) });
    }
    const buildInputSet = { schemaVersion: "1", entries: [...upstreamEntries, ...productEntries] };
    const inputDigest = sha256(serialize(buildInputSet));
    await writeFile(path.join(out, "go-list.jsonstream"), goList);
    const args = ["build", "-mod=readonly", "-buildvcs=false", "-pgo=off", "-trimpath",
      "-gcflags=all=-N -l", "-o", executable, "./cmd/tsfg-frontend"];
    run(go, args, path.join(sourceRoot, "tsc"), env);
    const binarySha256 = sha256(await readFile(executable));
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
    const intakeLedger = { schemaVersion: "1", status: "verified", evidenceKind: "real-source",
      projectId: "TypeScript.git", forkOid: head, upstreamBaseOid: lock.upstreamBaseOid,
      license: "Apache-2.0", consumer: "tsfg-frontend", packageCount,
      goListSha256: sha256(goList), files: upstreamEntries };
    await writeFile(path.join(out, "intake-ledger.json"), `${serialize(intakeLedger)}\n`);
    return { schemaVersion: "1", status: command === "test" ? "passed" : "built",
      capability: "minimal-bool-v1", contractVersion: lock.contractVersion,
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
