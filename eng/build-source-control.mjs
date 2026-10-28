// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { executeFrontendTarget } from "./frontend-build.mjs";
import { readGoDependencyLock, verifyGoDependencies } from "./go-closure.mjs";
import { IntakeLedgerError, createIntakeLedger } from "./intake-ledger.mjs";
import { astBuildInputs } from "./typescript-ast-inputs.mjs";
import { readAstIntake, sourceProbeIdentity, sourceProbeProfile } from "./typescript-ast.mjs";
import { generationBinding, generationPackages, generationSources, readGenerationLock } from "./typescript-generation.mjs";
import { SourceReproError } from "./typescript-repro.mjs";
import { reviewUpgrade } from "./upgrade-review.mjs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { parseTar, parseZip } from "./build-archive-readers.mjs";
import { canonicalize, digest, digestFile, readRegularFile, writeAtomicText } from "./build-data.mjs";
import { ConfigurationError, GoInputIntegrityError, OfflineBoundaryError, WINDOWS_SANDBOX_EXECUTABLE_DIGEST, WorkspaceMismatchError } from "./build-errors.mjs";
import { gitOutput, requireVisibleTrackedFiles } from "./build-git.mjs";
import { inspectProductWorkspace, repositoryRoot } from "./build-product.mjs";
import { verifyRuntimeClosure } from "./build-tool-closure.mjs";
import { closureToolPath } from "./build-toolchain.mjs";
import { parseManifest } from "./build-workspace.mjs";

export async function executeIntakeLedgerTarget(options) {
  if (!options.has("--dev") || !options.get("--workspace") ||
      !options.get("--intake-plan") || !options.get("--intake-consumption")) {
    throw new ConfigurationError("intake-ledger requires --dev, --workspace, --intake-plan and --intake-consumption");
  }
  for (const name of ["--out", "--report"]) {
    if (options.has(name) && !await isSourceDestinationOnE(options.get(name))) {
      throw new ConfigurationError(`intake-ledger requires an absolute E: ${name} destination`);
    }
  }
  const productRoot = path.resolve(options.get("--workspace"));
  const inputs = {};
  for (const [name, location] of Object.entries({
    admission: path.join(productRoot, "eng", "source-admissions.json"),
    declaration: path.resolve(options.get("--intake-plan")),
    consumption: path.resolve(options.get("--intake-consumption")),
  })) {
    try {
      const bytes = await readRegularFile(location, `intake ${name}`);
      inputs[name] = { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), sha256: digest(bytes) };
    } catch (error) {
      throw new IntakeLedgerError("intake-ledger-input", `cannot read ${name}: ${error.message}`);
    }
  }
  if (inputs.declaration.value?.evidenceKind === "real-source") {
    const authority = gitOutput(repositoryRoot, ["--no-replace-objects", "show", "HEAD:eng/source-admissions.json"], "buffer");
    if (digest(authority) !== inputs.admission.sha256) {
      throw new IntakeLedgerError("intake-ledger-authority", "real-source admission must match the control repository's committed source approval");
    }
  }
  const definition = JSON.parse(await readFile(path.join(repositoryRoot, "eng", "workspace-policy.json"), "utf8"));
  const ledger = await createIntakeLedger({
    workspaceRoot: path.dirname(productRoot), admission: inputs.admission.value,
    declaration: inputs.declaration.value, consumption: inputs.consumption.value,
    gitExecutable: process.env.TSFG_GIT, approvedLicenses: definition.approvedLicenseExpressions,
  });
  const result = { ...ledger, inputIdentity: Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [name, input.sha256])),
    operation: "declared-consumption-governance", executionMode: "local-development", isolation: "not-enforced" };
  const output = path.resolve(options.get("--out"));
  try { await lstat(output); throw new IntakeLedgerError("intake-ledger-output", "ledger output already exists; use a fresh destination"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await writeAtomicText(path.join(output, "intake-ledger.json"), `${canonicalize(result)}\n`);
  return result;
}

export async function executeUpgradeReviewTarget(options) {
  if (!options.has("--dev") || !options.get("--workspace") || !options.get("--upgrade-plan")) {
    throw new ConfigurationError("upgrade-review requires --dev, --workspace and --upgrade-plan");
  }
  for (const name of ["--out", "--report"]) {
    if (options.has(name) && !await isSourceDestinationOnE(options.get(name))) throw new ConfigurationError(`upgrade-review requires an absolute E: ${name} destination`);
  }
  const bytes = await readRegularFile(path.resolve(options.get("--upgrade-plan")), "upgrade plan");
  const plan = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (path.resolve(plan.candidate?.workspaceRoot ?? "", "tsfg") !== path.resolve(options.get("--workspace"))) throw new ConfigurationError("upgrade candidate must match --workspace");
  const output = path.resolve(options.get("--out"));
  try { await lstat(output); throw new IntakeLedgerError("upgrade-output", "review output already exists; use a fresh destination"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const definition = JSON.parse(await readFile(path.join(repositoryRoot, "eng", "workspace-policy.json"), "utf8"));
  const result = await reviewUpgrade({ plan, git: gitOutput, parseManifest, canonicalize, digest,
    gitExecutable: process.env.TSFG_GIT, approvedLicenses: definition.approvedLicenseExpressions });
  const receipt = { ...result, inputSha256: digest(bytes) };
  await writeAtomicText(path.join(output, "upgrade-review.json"), `${canonicalize(receipt)}\n`);
  return receipt;
}

export async function runFrontendTarget(options, runtime, command) {
  if (!options.has("--dev") || options.get("--target") !== "windows-x86_64-msvc"
      || options.get("--profile") !== "debug") {
    throw new ConfigurationError("frontend source target requires Windows debug --dev");
  }
  if (!await isSourceDestinationOnE(options.get("--out"))) {
    throw new ConfigurationError("frontend source target requires an absolute E: output");
  }
  if (!runtime?.selections.some(({ id }) => id === "go")) {
    throw new OfflineBoundaryError("locked Go runtime is unavailable");
  }
  const workspace = inspectProductWorkspace(options, true, command);
  const declaration = await readGoDependencyLock(runtime.lockPath, runtime.lock);
  const dependencyProxy = await verifyGoDependencies(runtime.cachePath, declaration,
    runtime.lock.goDependencies.sha256, parseZip);
  return executeFrontendTarget({ command, productRoot: workspace.root,
    sourceRoot: path.resolve(workspace.root, "..", "typescript"), out: options.get("--out"),
    runtime, go: closureToolPath(runtime, "go"), node: process.execPath,
    git: process.env.TSFG_GIT, dependencyProxy, serialize: canonicalize });
}

export async function prepareGoSourceTarget(options, runtime, controlRoot = repositoryRoot) {
  if (options.get("--target") !== "windows-x86_64-msvc" || runtime.platform !== "windows-x86_64-msvc") {
    throw new ConfigurationError("TypeScript dependency preparation requires the locked Windows target");
  }
  const workspaceState = inspectProductWorkspace(options, true);
  let declaration, proxy;
  try {
    declaration = await readGoDependencyLock(runtime.lockPath, runtime.lock);
    if (!declaration?.source) throw new Error("fixed Go source declaration is missing");
    proxy = await verifyGoDependencies(runtime.cachePath, declaration, runtime.lock.goDependencies.sha256, parseZip);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new OfflineBoundaryError(`Go offline input missing: ${error.path ?? error.message}`);
    }
    throw new GoInputIntegrityError(error.message);
  }
  const sourceRoot = path.resolve(workspaceState.root, "..", declaration.source.projectId);
  const astIntake = options.get("--source-target") === "typescript-ast"
    ? await readAstIntake({ productRoot: workspaceState.root, controlRoot,
      planPath: options.get("--intake-plan"), gitExecutable: process.env.TSFG_GIT,
      serialize: canonicalize }) : undefined;
  if (astIntake && declaration.source.commit !== astIntake.ledger.sources[0].forkOid) {
    throw new GoInputIntegrityError("AST tool dependency source lock differs from the approved fork");
  }
  if (astIntake) {
    Object.assign(astIntake, { toolLock: runtime.lock, dependencyLock: declaration });
    Object.defineProperty(astIntake, "parseZip", { value: parseZip });
  }
  if (astIntake) {
    try {
      const generation = await readGenerationLock(runtime.lockPath, runtime.lock);
      if (!generation) throw new Error("typed consumer requires a locked generation closure");
      for (const source of generation.sources) {
        const gitlink = astIntake.request.admission.sources[0].files.find(file => file.path === `tsc/${source.mount}`);
        if (gitlink?.contentKind !== "gitlink" || gitlink.oid !== source.commit) throw new GoInputIntegrityError("generation subsource differs from approved gitlink");
      }
      astIntake.generation = { declaration: generation, sha256: runtime.lock.generationDependencies.sha256,
        toolchainClosure: runtime.lockDigest, mode: options.get("--generation") ?? "auto",
        packages: await generationPackages(runtime.cachePath, generation, parseTar),
        sources: await generationSources(sourceRoot, generation, process.env.TSFG_GIT) };
    } catch (error) {
      if (error instanceof IntakeLedgerError) throw error;
      if (error.code === "ENOENT") throw new OfflineBoundaryError(`generation offline input missing: ${error.path ?? error.message}`);
      throw new GoInputIntegrityError(error.message);
    }
  }
  const actualRoot = gitOutput(sourceRoot, ["rev-parse", "--show-toplevel"]).trim();
  const actualCommit = gitOutput(sourceRoot, ["rev-parse", "HEAD"]).trim();
  const remoteName = gitOutput(sourceRoot, ["remote"]).trim().split(/\r?\n/).includes("origin") ? "origin" : "github-xuelongling";
  const remote = gitOutput(sourceRoot, ["remote", "get-url", remoteName]).trim().replace(/\.git$/, "");
  if (path.resolve(actualRoot) !== sourceRoot || actualCommit !== declaration.source.commit
      || remote !== "https://github.com/xuelongling/TypeScript"
      || gitOutput(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).trim()) {
    throw new WorkspaceMismatchError("go-source-identity", "fixed TypeScript source root, HEAD, remote or clean state mismatch");
  }
  requireVisibleTrackedFiles(sourceRoot);
  gitOutput(sourceRoot, ["merge-base", "--is-ancestor", "1e4744d68260a7cb91b62b12edc3f6a2187faaf1", actualCommit]);
  const moduleRoot = path.join(sourceRoot, declaration.source.modulePath);
  for (const [name, expected] of [["go.mod", declaration.source.goModSha256], ["go.sum", declaration.source.goSumSha256]]) {
    if (await digestFile(path.join(moduleRoot, name)) !== expected) {
      throw new WorkspaceMismatchError("go-source-lock", `fixed ${name} identity mismatch`);
    }
  }
  const profile = options.get("--profile");
  return {
    status: "prepared-not-executed",
    source: declaration.source,
    sourceRoot, moduleRoot,
    ...(astIntake ? { astIntake } : {}),
    toolchainClosure: runtime.lockDigest,
    dependencies: { identity: proxy.identity, modules: proxy.modules },
    executable: closureToolPath(runtime, "go"),
    arguments: ["list", "-deps", "-json", "-mod=readonly", "-buildvcs=false", "-pgo=off", "-trimpath",
      ...(profile === "debug" ? ["-gcflags=all=-N -l"] : []),
      ...(astIntake ? ["./cmd/tsfg-ast"] : declaration.packages)],
    profile: { name: profile, operation: "dependency-resolution", goamd64: "v2", cgo: false,
      pgo: false, debugOptimization: profile === "debug" ? "disabled" : "not-applicable",
      linkedSymbols: "not-applicable-no-link", nativeBuildAcceptance: "not-run" },
    environmentPolicy: { GOENV: "off", GOWORK: "off", GOTOOLCHAIN: "local", GOFLAGS: "",
      ...(astIntake ? { GOMAXPROCS: "2" } : {}),
      GOEXPERIMENT: "", GOOS: "windows", GOARCH: "amd64", GOAMD64: "v2", CGO_ENABLED: "0",
      GOSUMDB: "off", GOVCS: "*:off", GOAUTH: "off", GOPROXY: "verified-local-proxy-only" },
    execution: { status: "not-run", blocker: "restricted-windows-control-plane",
      helperSha256: WINDOWS_SANDBOX_EXECUTABLE_DIGEST },
    intakeComplete: false,
  };
}

export async function currentSourceReproIdentity(productRoot, cachePath) {
  let runtime;
  try {
    runtime = await verifyRuntimeClosure(path.join(productRoot, "eng/go-ast-toolchains.lock.json"), cachePath,
      "windows-x86_64-msvc", { nativeControls: false });
  } catch (error) { throw new SourceReproError(error.code === "ENOENT" ? 12 : 11, error.message); }
  try {
    const options = new Map([["--workspace", productRoot], ["--target", "windows-x86_64-msvc"], ["--profile", "debug"],
      ["--source-target", "typescript-ast"], ["--dev", ""],
      ["--intake-plan", path.join(productRoot, "eng/intake-declarations/typescript-ast.json")]]);
    const preparation = await prepareGoSourceTarget(options, runtime, productRoot), intake = preparation.astIntake;
    const inputs = await astBuildInputs(intake, intake.ledger, canonicalize);
    const receipt = await readFile(path.join(productRoot, "eng/probes/generation.json")).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    return { ...inputs, buildIdentity: sourceProbeIdentity(inputs, preparation.toolchainClosure, canonicalize),
      source: preparation.source, profile: sourceProbeProfile, inputIdentity: intake.inputIdentity,
      generationBinding: generationBinding(intake, inputs, canonicalize),
      generationOutputs: intake.generation.declaration.outputs.map(name => ({ path: name,
        sha256: intake.ledger.files.find(file => file.path === `tsc/${name}`).sha256 })),
      generationCommands: 5 + intake.generation.declaration.outputs.filter(name => name.includes("stringer_generated")).length,
      receiptSha256: receipt === null ? null : digest(receipt) };
  } catch (error) {
    const code = error instanceof OfflineBoundaryError ? 12 : error instanceof GoInputIntegrityError ? 11
      : error instanceof ConfigurationError ? 2
      : error instanceof WorkspaceMismatchError || error instanceof IntakeLedgerError || error.code === "ENOENT" ? 10 : 30;
    throw new SourceReproError(code, error.message);
  }
}

export async function validateGoSourceOptions(options, runtime) {
  if (options.get("--source-target") === "typescript-ast" &&
      (!options.has("--dev") || !options.get("--intake-plan"))) {
    throw new ConfigurationError("AST requires --dev and --intake-plan");
  }
  if (options.get("--source-target") === "typescript-ast" && options.get("--profile") !== "debug") {
    throw new ConfigurationError("AST currently supports only the debug profile");
  }
  if (!["typescript-dependencies", "typescript-ast"].includes(options.get("--source-target"))) {
    throw new ConfigurationError("unsupported source target");
  }
  if (!await isSourceDestinationOnE(options.get("--out"))) {
    throw new ConfigurationError("source target requires an absolute E: output");
  }
  const goOverrides = { GOFLAGS: "", GOEXPERIMENT: "", GOTOOLCHAIN: "local",
    GOWORK: "off", GOENV: "off", GOPROXY: "off", GOAMD64: "v2" };
  for (const [name, allowed] of Object.entries(goOverrides)) {
    const actual = Object.keys(process.env).find((key) => key.toUpperCase() === name);
    if (actual && process.env[actual] && process.env[actual] !== allowed) {
      throw new ConfigurationError(`source target forbids ambient ${name}`);
    }
  }
  if (!runtime?.selections.some(({ id }) => id === "go")) {
    throw new OfflineBoundaryError("locked Go runtime is unavailable");
  }
}

export async function isSourceDestinationOnE(destination) {
  if (!/^E:[\\/]/i.test(destination) || destination.slice(2).includes(":")) return false;
  let current = path.resolve(destination);
  for (;;) {
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink() || !/^E:[\\/]/i.test(await realpath(current))) return false;
    } catch (error) {
      if (error.code !== "ENOENT") return false;
    }
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}
