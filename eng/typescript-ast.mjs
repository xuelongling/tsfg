// SPDX-License-Identifier: MIT
// Private adapter of the existing Hermetic Build Entry for ticket R02a/04.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { createIntakeLedger, IntakeLedgerError } from "./intake-ledger.mjs";
import { readGoSourceExecutionResult } from "./go-source-result.mjs";
import { astGit, astBuildInputs, astToolchainInputs } from "./typescript-ast-inputs.mjs";
import { readTypeScriptProbes, runTypeScriptProbes, runJsIsolation } from "./typescript-probes.mjs";
import { replayGeneration } from "./typescript-generation.mjs";
import { runRequiredTypeScriptTests } from "./typescript-required-tests.mjs";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const consumer = "tsfg-ast";
const projectId = "TypeScript.git";
const probeInput = "tsc/cmd/tsfg-ast/testdata/positive.ts";
const fail = message => { throw new IntakeLedgerError("ast-consumption", message); };
export class AstExecutionError extends Error { probes; jsIsolation; requiredTests; generation; }

export async function readAstIntake({ productRoot, controlRoot, planPath, gitExecutable }) {
  const admissionBytes = await readFile(path.join(productRoot, "eng/source-admissions.json"));
  const authority = astGit(gitExecutable, controlRoot, ["show", "HEAD:eng/source-admissions.json"]);
  if (!admissionBytes.equals(authority)) fail("AST admission must match committed control authority");
  const declarationBytes = await readFile(planPath);
  const declaration = JSON.parse(declarationBytes.toString("utf8"));
  if (declaration.evidenceKind !== "real-source") fail("AST execution requires a real-source declaration");
  const consumption = { schemaVersion: "1", evidenceKind: "real-source", entries: declaration.sources.flatMap(source =>
    source.entries.map(entry => ({ projectId: source.projectId, path: entry.path, role: entry.role, consumer: entry.consumer }))) };
  const admission = JSON.parse(admissionBytes.toString("utf8"));
  const policy = JSON.parse(await readFile(path.join(controlRoot, "eng/workspace-policy.json"), "utf8"));
  const request = { workspaceRoot: path.dirname(productRoot), admission, declaration, consumption,
    gitExecutable, approvedLicenses: policy.approvedLicenseExpressions };
  const ledger = await createIntakeLedger(request);
  const probes = await readTypeScriptProbes(controlRoot, gitExecutable);
  return { request, ledger, controlRoot, probes, inputIdentity: { admission: hash(admissionBytes), declaration: hash(declarationBytes), probes: probes.sha256 } };
}

export async function buildAstProbe({ prepared, child, serialize, publish }) {
  const { preparation, stageRoot, output, launch } = prepared;
  const { worker, outputBytes } = await readGoSourceExecutionResult(stageRoot, child, "local-development");
  const plan = JSON.parse(await readFile(path.join(stageRoot, "inputs/control/plan.json"), "utf8"));
  const intake = preparation.astIntake;
  const auditFiles = ["tsc/go.mod", "tsc/go.sum", "tsc/LICENSE", "tsc/NOTICE.txt", probeInput,
    ...(intake.generation?.declaration.inputs ?? []).map(name => `tsc/${name}`),
    ...(intake.generation?.declaration.testInputs ?? []).map(name => `tsc/${name}`),
    ...["lib.es5.d.ts", "lib.decorators.d.ts", "lib.decorators.legacy.d.ts"].map(name => `tsc/internal/bundled/libs/${name}`)];
  const paths = new Set(auditFiles);
  for (const item of worker.packages) {
    if (item.module !== "github.com/microsoft/typescript-go") continue;
    for (const name of item.inputFiles) {
      const relative = path.relative(plan.moduleRoot, path.resolve(item.directory, name)).replaceAll("\\", "/");
      if (relative.startsWith("../") || path.isAbsolute(relative)) fail("Go package input escapes the source module");
      paths.add(`tsc/${relative}`);
    }
  }
  const consumption = { schemaVersion: "1", evidenceKind: "real-source", entries: [...paths].sort().map(name => ({
    projectId, path: name, consumer,
    role: auditFiles.includes(name) ? "build-only" : "compiler-payload",
  })) };
  const ledger = await createIntakeLedger({ ...intake.request, consumption });
  const toolchainInputs = await astToolchainInputs(intake, plan, worker);
  const identity = await astBuildInputs(intake, ledger, serialize);
  const generation = intake.generation?.mode === "replay" ? await replayGeneration(intake, plan, serialize)
    : { status: "not-run", reason: "No verified generation receipt has been consumed." };
  const requiredTests = await runRequiredTypeScriptTests(intake, plan, serialize);
  if (requiredTests.status !== "passed") {
    const error = new AstExecutionError("required upstream TypeScript tests failed, skipped or did not run");
    error.requiredTests = requiredTests;
    error.generation = generation;
    throw error;
  }
  const verifyInputs = async () => {
    for (const input of plan.inputs) if (hash(await readFile(input.path)) !== input.sha256) fail(`staged input changed: ${input.path}`);
  };
  await verifyInputs();
  const invoke = (executable, args) => spawnSync(executable, args, { cwd: plan.moduleRoot, env: plan.environment,
      encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const run = (executable, args) => {
    const result = invoke(executable, args);
    if (result.error || result.status !== 0) throw new AstExecutionError(`AST execution failed (${result.status}): ${result.error?.message ?? result.stderr}`);
    return result.stdout;
  };
  const executable = path.join(plan.workRoot, "tsfg-ast.exe");
  const arguments_ = ["build", "-mod=readonly", "-buildvcs=false", "-pgo=off", "-trimpath",
    "-gcflags=all=-N -l", "-o", executable, "./cmd/tsfg-ast"];
  run(plan.go, arguments_);
  const probes = await runTypeScriptProbes({ probes: intake.probes, plan, executable, run,
    positiveInput: path.join(plan.moduleRoot, probeInput.slice(4)) });
  if (probes.status !== "passed") {
    const error = new AstExecutionError("required TypeScript probe failed");
    error.probes = probes;
    error.requiredTests = requiredTests;
    error.generation = generation;
    throw error;
  }
  const ast = probes.cases[0].observation;
  const jsIsolation = await runJsIsolation({ probes: intake.probes, ledger, plan, executable, invoke, run,
    positiveInput: path.join(plan.moduleRoot, probeInput.slice(4)) });
  if (jsIsolation.status !== "passed") {
    const error = new AstExecutionError("JS isolation evidence failed");
    error.probes = probes;
    error.jsIsolation = jsIsolation;
    error.requiredTests = requiredTests;
    error.generation = generation;
    throw error;
  }
  const astBytes = serialize(ast);
  const probeBytes = serialize(probes);
  await verifyInputs();
  await astToolchainInputs(intake, plan, worker);
  const currentProbes = await readTypeScriptProbes(intake.controlRoot, intake.request.gitExecutable);
  if (serialize(currentProbes.inputs) !== serialize(intake.probes.inputs)) fail("probe inputs changed during execution");
  for (const entry of identity.buildInputSet.entries.filter(entry => entry.projectId === "tsfg")) {
    if (hash(await readFile(path.join(intake.controlRoot, entry.repositoryRelativePath))) !== entry.sha256) fail("build control changed during AST execution");
  }
  const binary = await readFile(executable);
  const buildIdentityPayload = { buildInputSetDigest: identity.buildInputSet.digest,
    options: { sourceTarget: "typescript-ast", goamd64: "v2", cgo: false, pgo: false },
    profile: "debug", source_date_epoch: identity.sourceDateEpoch, target: "windows-x86_64-msvc",
    toolchainClosureDigest: preparation.toolchainClosure };
  const result = { schemaVersion: "1", status: "ast-observed", source: preparation.source,
    target: "windows-x86_64-msvc", profile: { name: "debug", goamd64: "v2", pgo: false, cgo: false,
      optimization: "disabled", symbols: "embedded-full" },
    toolchainClosure: preparation.toolchainClosure, inputIdentity: intake.inputIdentity,
    executionMode: "local-development", isolation: "not-enforced", arguments: arguments_, ast, probes, jsIsolation,
    probeObservationSha256: hash(probeBytes),
    executableSha256: hash(binary), observationSha256: hash(astBytes),
    ledger, toolchainInputs, executionConsumption: { status: "matched", method: "go-list-deps-and-fixed-probe-input", entries: consumption.entries },
    buildInputSet: identity.buildInputSet, provenance: identity.provenance, dirty: identity.dirty,
    buildIdentity: { ...buildIdentityPayload, digest: hash(serialize(buildIdentityPayload)) },
    generation, requiredTests,
    intakeComplete: false };
  await mkdir(path.dirname(output), { recursive: true });
  const publication = await mkdtemp(path.join(path.dirname(output), ".ast-publication-"));
  await writeFile(path.join(publication, "tsfg-ast.exe"), binary);
  await writeFile(path.join(publication, "ast.json"), astBytes);
  await writeFile(path.join(publication, "probes.json"), probeBytes);
  await writeFile(path.join(publication, "js-isolation.json"), serialize(jsIsolation));
  await writeFile(path.join(publication, "generation.json"), serialize(generation));
  await writeFile(path.join(publication, "required-tests.json"), serialize(requiredTests));
  await writeFile(path.join(publication, "required-test-events.jsonstream"), await readFile(path.join(plan.workRoot, "required-test-events.jsonstream")));
  await writeFile(path.join(publication, "intake-ledger.json"), serialize(ledger));
  await writeFile(path.join(publication, "go-list.jsonstream"), outputBytes);
  await writeFile(path.join(publication, "source-build.json"), serialize(result));
  await publish(publication, output);
  return result;
}
