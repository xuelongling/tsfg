// SPDX-License-Identifier: MIT
// Private source-target adapter of the existing Hermetic Build Entry.
import { readFile, writeFile, mkdir, mkdtemp, readdir, lstat, realpath, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { readTypeScriptProbes, matchesTypeScriptObservation } from "./typescript-probes.mjs";
import { sourceProbeMetadata } from "./typescript-ast.mjs";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const payloadNames = ["artifact-manifest.json", "ast.json", "build-metadata.json", "probes.json", "tsfg-ast.exe"];
const evidenceNames = ["generation.json", "go-list.jsonstream", "intake-ledger.json", "js-isolation.json",
  "required-test-events.jsonstream", "required-tests.json", "source-build.json"];
const fail = message => { throw new SourceReproError(23, message); };
const workspaceSummary = workspace => ({ manifest: workspace.manifest, projects: workspace.projects,
  activation: workspace.activation, dirty: workspace.dirty, sourcePolicy: {
    digest: workspace.policy.sourceAdmission.digest, stages: workspace.policy.sourceAdmission.stages,
    sources: workspace.policy.sourceAdmission.sources.map(({ files, ...identity }) => ({ ...identity, fileCount: String(files.length) })) },
  licenseReport: workspace.policy.licenseReport });
export class SourceReproError extends Error {
  constructor(exitCode, message, evidence = undefined) { super(message); this.exitCode = exitCode; this.evidence = evidence; }
}

async function regularBytes(root, name) {
  const file = path.join(root, name), metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) fail(`nonregular source evidence: ${name}`);
  return await readFile(file);
}

function leakedPaths(bytes, roots) {
  const texts = [bytes.toString("latin1"), bytes.toString("utf16le"), bytes.subarray(1).toString("utf16le")]
    .map(text => text.toLowerCase());
  return roots.filter(root => {
    const forward = root.replaceAll("\\", "/").toLowerCase(), backward = forward.replaceAll("/", "\\");
    return [forward, backward, backward.replaceAll("\\", "\\\\")].some(value => texts.some(text => text.includes(value)));
  });
}

async function readProducer(root, workspaceRoot, workspace, serialize, parseJson, currentIdentity) {
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
  if (!isDeepStrictEqual(identity.options, { sourceTarget: "typescript-ast", goamd64: "v2", cgo: false, pgo: false })
      || identity.profile !== "debug" || identity.target !== "windows-x86_64-msvc") fail("source producer does not match the current effective Build Identity");
  if (digest !== hash(serialize(identityPayload)) || identity.buildInputSetDigest !== build.buildInputSet.digest
      || build.buildInputSet.digest !== hash(serialize({ schemaVersion: "1", entries: build.buildInputSet.entries }))
      || identity.toolchainClosureDigest !== build.toolchainClosure) fail("source Build Identity digest mismatch");
  if (manifest.kind !== "typescript-source-probe" || manifest.schemaVersion !== "1"
      || !isDeepStrictEqual(manifest.buildIdentity, identity) || !isDeepStrictEqual(manifest.buildInputSet, build.buildInputSet)
      || manifest.contractSetId !== hash(serialize({})) || manifest.toolchainClosureDigest !== build.toolchainClosure
      || !isDeepStrictEqual(manifest.members.map(member => member.path), payloadNames.slice(1))) fail("source Artifact Manifest declaration mismatch");
  for (const member of manifest.members) if (hash(bytes.get(member.path)) !== member.sha256) fail(`source payload digest mismatch: ${member.path}`);
  if (!isDeepStrictEqual(json("build-metadata.json"), sourceProbeMetadata(build))) fail("source metadata differs from its declared producer recipe");
  const current = await currentIdentity(productRoot);
  if (current.dirty || !isDeepStrictEqual(build.buildInputSet, current.buildInputSet)
      || !isDeepStrictEqual(build.buildIdentity, current.buildIdentity) || !isDeepStrictEqual(build.provenance, current.provenance)
      || !isDeepStrictEqual(build.source, current.source) || !isDeepStrictEqual(build.profile, current.profile)
      || !isDeepStrictEqual(build.inputIdentity, current.inputIdentity)) fail("source producer differs from the current complete input set or Build Identity");
  const generation = build.generation;
  const commands = generation.mode === "replayed" ? generation.commands : generation.verifiedReplay?.commands;
  if (!isDeepStrictEqual(generation.binding, current.generationBinding)
      || !isDeepStrictEqual(generation.outputs, current.generationOutputs) || generation.inputsRechecked !== true
      || generation.intakeLedger?.status !== "matched" || generation.differences?.length !== 0
      || !["replayed", "reused"].includes(generation.mode) || commands?.length !== current.generationCommands
      || commands.some(command => command.exitCode !== 0)
      || generation.mode === "reused" && (generation.commands.length !== 0 || generation.receiptPath !== "eng/probes/generation.json"
        || generation.receiptSha256 !== current.receiptSha256)) fail("generation evidence does not match the current source inputs and recipe");
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
  const expected = await readTypeScriptProbes(productRoot, process.env.TSFG_GIT);
  const semanticIssues = [];
  if (build.probes.status !== "passed" || build.probes.cases.length !== expected.manifest.cases.length
      || build.probes.expectationSha256 !== expected.sha256 || build.probes.languageBaseline !== expected.manifest.languageBaseline
      || !isDeepStrictEqual(build.probes.inputLedger, expected.inputs)) semanticIssues.push("required semantic probe identity mismatch");
  for (const [index, item] of expected.manifest.cases.entries()) {
    const observed = build.probes.cases[index];
    const sourceRoot = item.projectId === "tsfg" ? productRoot : path.join(workspaceRoot, fork.path);
    if (observed?.id !== item.id || observed.status !== "passed" || !matchesTypeScriptObservation(item, observed.observation)
        || !isDeepStrictEqual(observed.expected, item.expected)
        || !isDeepStrictEqual(observed.source, { projectId: item.projectId, path: item.path,
          sha256: hash(await readFile(path.join(sourceRoot, item.path))) })) semanticIssues.push(`fixed semantic expectation mismatch: ${item.id}`);
  }
  return { root, workspaceRoot, workspace, build, bytes, manifest, semanticIssues };
}

export async function reproduceTypeScript({ options, workspaces, serialize, parseJson, environment, verify, currentIdentity }) {
  const output = path.resolve(options.get("--out"));
  await mkdir(path.dirname(output), { recursive: true });
  if (await lstat(output).catch(error => { if (error.code === "ENOENT") return undefined; throw error; })) {
    throw new SourceReproError(2, "source repro-check output already exists");
  }
  const stage = await mkdtemp(path.join(path.dirname(output), ".source-repro-"));
  const producers = workspaces.map((workspace, index) => {
    const label = index === 0 ? "a" : "b";
    return { label, workspaceRoot: options.get(`--workspace-${label}`), workspace: workspaceSummary(workspace),
      output: options.get(`--producer-${label}`) ?? null, report: null, command: null, execution: null,
      build: { status: "not-run", mode: options.has("--producer-a") ? "recorded" : "rebuild" },
      validation: { status: "not-run" }, stages: { sourcePolicy: "not-run", generation: "not-run",
        requiredTests: "not-run", interface: "not-run", jsIsolation: "not-run" } };
  });
  const evidence = { schemaVersion: "1", executionMode: "local-development", isolation: "not-enforced", producers,
    operation: options.has("--producer-a") ? "compare-existing" : "rebuild",
    reproducibility: { bytes: { status: "not-run", differences: [] }, semantics: { status: "not-run", issues: [] },
      paths: { status: "not-run", leaks: [] } }, intakeComplete: false };
  const read = async index => {
    try {
      const producer = producers[index];
      const value = await readProducer(await realpath(producer.output), producer.workspaceRoot, workspaces[index], serialize, parseJson, currentIdentity);
      producer.validation.status = "passed";
      producer.stages.interface = value.semanticIssues.length ? "failed" : value.build.probes.status;
      return value;
    } catch (error) { producers[index].validation.status = "failed"; throw error; }
  };
  try {
    for (const [index, workspace] of workspaces.entries()) {
      const label = index === 0 ? "a" : "b", workspaceRoot = await realpath(options.get(`--workspace-${label}`));
      const product = workspace.projects.find(project => project.id === "tsfg.git");
      const productRoot = path.join(workspaceRoot, product.path);
      producers[index].workspaceRoot = workspaceRoot;
      if (options.has(`--producer-${label}`)) {
        const previous = await read(index);
        producers[index] = { ...producers[index], output: previous.root,
          report: null, command: null, build: { status: "passed", mode: "recorded" },
          stages: { sourcePolicy: previous.build.ledger.status, generation: previous.build.generation.status,
            requiredTests: previous.build.requiredTests.status, interface: previous.semanticIssues.length ? "failed" : previous.build.probes.status,
            jsIsolation: previous.build.jsIsolation.status }, execution: previous.build.execution };
        continue;
      }
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
      const issue = record?.error?.issues?.[0];
      const producer = { ...producers[index], report, output: producerRoot,
        command: { executable: process.execPath, arguments: arguments_, exitCode: child.status },
        build: { status: child.status === 0 && record?.status === "success" ? "passed" : "failed", mode: "rebuild" },
        stages: record?.result ? { sourcePolicy: record.result.ledger.status, generation: record.result.generation.status,
          requiredTests: record.result.requiredTests.status, interface: record.result.probes.status, jsIsolation: record.result.jsIsolation.status }
          : { sourcePolicy: "not-recorded", generation: issue?.generation?.status ?? "not-run",
            requiredTests: issue?.requiredTests?.status ?? "not-run", interface: issue?.probes?.status ?? "not-run",
            jsIsolation: issue?.jsIsolation?.status ?? "not-run" }, execution: record?.result?.execution ?? null };
      producers[index] = producer;
      if (producer.build.status !== "passed") throw new SourceReproError(child.status || 20,
        `source producer ${label} failed: ${child.error?.message ?? child.stderr}`, evidence);
    }
    const first = await read(0), second = await read(1);
    if (!isDeepStrictEqual(first.build.buildIdentity, second.build.buildIdentity)) fail("source producer Build Identities differ");
    if (first.build.execution.compileCache.toLowerCase() === second.build.execution.compileCache.toLowerCase()
        || first.build.execution.moduleCache.toLowerCase() === second.build.execution.moduleCache.toLowerCase()) fail("source producers share execution caches");
    const differences = payloadNames.filter(name => !first.bytes.get(name).equals(second.bytes.get(name)));
    evidence.reproducibility.bytes = { status: differences.length ? "failed" : "passed", differences };
    const issues = [...first.semanticIssues.map(issue => `a: ${issue}`), ...second.semanticIssues.map(issue => `b: ${issue}`)];
    if (!isDeepStrictEqual(first.build.probes, second.build.probes)) issues.push("source semantic observations differ");
    evidence.reproducibility.semantics = { status: issues.length ? "failed" : "passed", issues };
    const roots = [...new Set([options.get("--cache"), process.cwd(), path.dirname(process.execPath),
      ...["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot"].map(key => process.env[key]),
      ...[first, second].flatMap(producer => [producer.workspaceRoot, producer.root,
        ...["workspace", "stageRoot", "moduleRoot", "compileCache", "moduleCache"].map(key => producer.build.execution[key])])])]
      .filter(value => typeof value === "string" && path.isAbsolute(value) && path.parse(value).root !== value);
    const leaks = [first, second].flatMap((producer, index) => payloadNames.flatMap(name =>
      leakedPaths(producer.bytes.get(name), roots).map(root => ({ producer: index === 0 ? "a" : "b", member: name, root }))));
    evidence.reproducibility.paths = { status: leaks.length ? "failed" : "passed", leaks };
    if (differences.length || issues.length || leaks.length) fail([...differences.map(name => `source payload bytes differ: ${name}`),
      ...issues, ...(leaks.length ? ["absolute build path leakage in declared source payload"] : [])].join("; "));
    for (let index = 0; index < 2; index++) {
      if (!isDeepStrictEqual(await verify(index), workspaces[index])) fail("source workspace changed during reproducibility execution");
    }
    const result = { ...evidence, buildIdentity: first.build.buildIdentity,
      reproducibilitySet: payloadNames.map(name => ({ path: name, sha256: hash(first.bytes.get(name)) })),
      status: "source-reproducible", evidenceRoot: stage,
      publication: { rollback: async () => { await rename(output, path.join(stage, "result")); } } };
    Object.defineProperty(result, "publication", { enumerable: false });
    await mkdir(path.join(stage, "result"));
    await writeFile(path.join(stage, "result/comparison.json"), serialize(result));
    await rename(path.join(stage, "result"), output);
    return result;
  } catch (error) {
    throw new SourceReproError(error instanceof SourceReproError ? error.exitCode : 23, error.message, { ...evidence, evidenceRoot: stage });
  }
}
