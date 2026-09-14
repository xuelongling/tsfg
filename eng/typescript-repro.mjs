// SPDX-License-Identifier: MIT
// Private source-target adapter of the existing Hermetic Build Entry.
import { readFile, writeFile, mkdir, mkdtemp, readdir, lstat, realpath, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const payloadNames = ["artifact-manifest.json", "ast.json", "build-metadata.json", "probes.json", "tsfg-ast.exe"];
const evidenceNames = ["generation.json", "go-list.jsonstream", "intake-ledger.json", "js-isolation.json",
  "required-test-events.jsonstream", "required-tests.json", "source-build.json"];
const fail = message => { throw new SourceReproError(23, message); };
export class SourceReproError extends Error {
  constructor(exitCode, message, evidence = undefined) { super(message); this.exitCode = exitCode; this.evidence = evidence; }
}

async function regularBytes(root, name) {
  const file = path.join(root, name), metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) fail(`nonregular source evidence: ${name}`);
  return await readFile(file);
}

async function readProducer(root, workspaceRoot, workspace, serialize, parseJson) {
  const names = (await readdir(root)).sort();
  if (!isDeepStrictEqual(names, [...payloadNames, ...evidenceNames].sort())) fail("incomplete or unexpected source producer members");
  const bytes = new Map();
  for (const name of names) bytes.set(name, await regularBytes(root, name));
  const json = name => parseJson(bytes.get(name), name, false);
  const manifest = json("artifact-manifest.json"), build = json("source-build.json");
  const product = workspace.projects.find(project => project.id === "tsfg.git");
  const fork = workspace.projects.find(project => project.id === "TypeScript.git");
  const productRoot = path.join(workspaceRoot, product.path);
  if (build.status !== "ast-observed" || build.dirty !== false || build.executionMode !== "local-development"
      || build.isolation !== "not-enforced" || build.source.commit !== fork.head
      || build.provenance.find(project => project.projectId === "tsfg")?.projectOid !== product.head
      || build.target !== "windows-x86_64-msvc" || build.profile.name !== "debug"
      || path.resolve(build.execution.workspace).toLowerCase() !== productRoot.toLowerCase()) fail("stale or mismatched source producer identity");
  const identity = build.buildIdentity, { digest, ...identityPayload } = identity;
  if (digest !== hash(serialize(identityPayload)) || identity.buildInputSetDigest !== build.buildInputSet.digest
      || build.buildInputSet.digest !== hash(serialize({ schemaVersion: "1", entries: build.buildInputSet.entries }))
      || identity.toolchainClosureDigest !== build.toolchainClosure) fail("source Build Identity digest mismatch");
  if (manifest.kind !== "typescript-source-probe" || manifest.schemaVersion !== "1"
      || !isDeepStrictEqual(manifest.buildIdentity, identity) || !isDeepStrictEqual(manifest.buildInputSet, build.buildInputSet)
      || manifest.contractSetId !== hash(serialize({})) || manifest.toolchainClosureDigest !== build.toolchainClosure
      || !isDeepStrictEqual(manifest.members.map(member => member.path), payloadNames.slice(1))) fail("source Artifact Manifest declaration mismatch");
  for (const member of manifest.members) if (hash(bytes.get(member.path)) !== member.sha256) fail(`source payload digest mismatch: ${member.path}`);
  for (const [name, value] of [["ast.json", build.ast], ["probes.json", build.probes], ["generation.json", build.generation],
    ["required-tests.json", build.requiredTests], ["js-isolation.json", build.jsIsolation], ["intake-ledger.json", build.ledger]]) {
    if (!isDeepStrictEqual(json(name), value)) fail(`source evidence differs from its build: ${name}`);
  }
  if (hash(bytes.get("tsfg-ast.exe")) !== build.executableSha256
      || hash(bytes.get("ast.json")) !== build.observationSha256 || hash(bytes.get("probes.json")) !== build.probeObservationSha256
      || hash(bytes.get("go-list.jsonstream")) !== build.execution.dependencyResolution.outputSha256
      || hash(bytes.get("required-test-events.jsonstream")) !== build.requiredTests.eventLog.sha256) fail("source build evidence digest mismatch");
  if (build.ledger.status !== "declared" || build.executionConsumption.status !== "matched"
      || build.generation.status !== "passed" || build.generation.binding.buildInputSetDigest !== build.buildInputSet.digest
      || build.requiredTests.status !== "passed" || build.requiredTests.skipped.length || build.requiredTests.missing.length
      || build.requiredTests.command.exitCode !== 0 || !build.requiredTests.command.arguments.includes("-count=1")
      || build.jsIsolation.status !== "passed" || build.jsIsolation.cases.length !== 14
      || build.jsIsolation.cases.some(item => item.status !== "passed")
      || build.execution.cachesInitiallyEmpty !== true || build.execution.nativeExitCode !== 0
      || build.execution.build.exitCode !== "0" || build.execution.dependencyResolution.exitCode !== "0") fail("source producer lacks successful independent execution evidence");
  // The fixed oracle comes from the verified checkout, never the producer's claimed expectation.
  const expected = JSON.parse(await readFile(path.join(productRoot, "eng/probes/typescript.json"), "utf8"));
  if (build.probes.status !== "passed" || build.probes.cases.length !== expected.cases.length) fail("required semantic probes did not pass");
  for (const [index, item] of expected.cases.entries()) {
    const observed = build.probes.cases[index];
    if (observed.id !== item.id || observed.status !== "passed" || observed.observation.kind !== "KindSourceFile"
        || Object.entries(item.expected).some(([key, value]) => !isDeepStrictEqual(observed.observation[key], value))) fail(`fixed semantic expectation mismatch: ${item.id}`);
  }
  return { root, workspaceRoot, workspace, build, bytes, manifest };
}

export async function reproduceTypeScript({ options, workspaces, serialize, parseJson, environment, verify }) {
  const output = path.resolve(options.get("--out"));
  await mkdir(path.dirname(output), { recursive: true });
  if (await lstat(output).catch(error => { if (error.code === "ENOENT") return undefined; throw error; })) {
    throw new SourceReproError(2, "source repro-check output already exists");
  }
  const stage = await mkdtemp(path.join(path.dirname(output), ".source-repro-"));
  const producers = [];
  const evidence = { schemaVersion: "1", executionMode: "local-development", isolation: "not-enforced", producers,
    reproducibility: { bytes: { status: "not-run" }, semantics: { status: "not-run" } }, intakeComplete: false };
  try {
    for (const [index, workspace] of workspaces.entries()) {
      const label = index === 0 ? "a" : "b", workspaceRoot = await realpath(options.get(`--workspace-${label}`));
      const product = workspace.projects.find(project => project.id === "tsfg.git");
      const productRoot = path.join(workspaceRoot, product.path);
      const runRoot = path.join(stage, label), temp = path.join(runRoot, "temp"), producerRoot = path.join(runRoot, "producer");
      await mkdir(temp, { recursive: true });
      const report = path.join(runRoot, "build-report.json");
      const arguments_ = [path.join(productRoot, "eng/tsfg-build.mjs"), "build", "--dev", "--source-target", "typescript-ast",
        "--workspace", productRoot, "--intake-plan", path.join(productRoot, "eng/intake-declarations/typescript-ast.json"),
        "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", producerRoot, "--report", report];
      const env = { ...environment(temp, []), TSFG_GIT: process.env.TSFG_GIT,
        TSFG_RUNTIME_LOCK: path.join(productRoot, "eng/go-ast-toolchains.lock.json"),
        TSFG_RUNTIME_CACHE: options.get("--cache"), TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" };
      const child = spawnSync(process.execPath, arguments_, { cwd: productRoot, env, encoding: "utf8",
        timeout: 1200000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      await writeFile(path.join(runRoot, "build.log"), `${child.stdout ?? ""}${child.stderr ?? ""}`);
      let record;
      try { record = JSON.parse(await readFile(report, "utf8")); } catch { /* Native failure can precede report creation. */ }
      const producer = { label, workspaceRoot, workspace, report, output: producerRoot,
        command: { executable: process.execPath, arguments: arguments_, exitCode: child.status },
        build: { status: child.status === 0 && record?.status === "success" ? "passed" : "failed" },
        stages: record?.result ? { sourcePolicy: record.result.ledger.status, generation: record.result.generation.status,
          requiredTests: record.result.requiredTests.status, interface: record.result.probes.status, jsIsolation: record.result.jsIsolation.status }
          : record?.error, execution: record?.result?.execution };
      producers.push(producer);
      if (producer.build.status !== "passed") throw new SourceReproError(child.status || 20,
        `source producer ${label} failed: ${child.error?.message ?? child.stderr}`, evidence);
    }
    const read = async index => await readProducer(producers[index].output, producers[index].workspaceRoot, workspaces[index], serialize, parseJson);
    const first = await read(0), second = await read(1);
    if (!isDeepStrictEqual(first.build.buildIdentity, second.build.buildIdentity)) fail("source producer Build Identities differ");
    if (first.build.execution.compileCache.toLowerCase() === second.build.execution.compileCache.toLowerCase()
        || first.build.execution.moduleCache.toLowerCase() === second.build.execution.moduleCache.toLowerCase()) fail("source producers share execution caches");
    for (const name of payloadNames) if (!first.bytes.get(name).equals(second.bytes.get(name))) fail(`source payload bytes differ: ${name}`);
    evidence.reproducibility.bytes = { status: "passed" };
    if (!isDeepStrictEqual(first.build.probes, second.build.probes)) fail("source semantic observations differ");
    evidence.reproducibility.semantics = { status: "passed" };
    for (let index = 0; index < 2; index++) {
      if (!isDeepStrictEqual(await verify(index), workspaces[index])) fail("source workspace changed during reproducibility execution");
    }
    const result = { ...evidence, buildIdentity: first.build.buildIdentity,
      reproducibilitySet: payloadNames.map(name => ({ path: name, sha256: hash(first.bytes.get(name)) })),
      status: "source-reproducible", evidenceRoot: stage };
    await mkdir(path.join(stage, "result"));
    await writeFile(path.join(stage, "result/comparison.json"), serialize(result));
    await rename(path.join(stage, "result"), output);
    return result;
  } catch (error) {
    evidence.reproducibility.bytes = { status: error instanceof SourceReproError && error.exitCode === 23 ? "failed" : "not-run" };
    throw new SourceReproError(error instanceof SourceReproError ? error.exitCode : 23, error.message, { ...evidence, evidenceRoot: stage });
  }
}
