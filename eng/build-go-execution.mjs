// SPDX-License-Identifier: MIT
import path from "node:path";
import { readGoDependencyLock, verifyGoDependencies } from "./go-closure.mjs";
import { GoSourceResultError, bindGoSourceCompletion, publishGoSourceExecutionResult } from "./go-source-result.mjs";
import { buildAstProbe } from "./typescript-ast.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseZip } from "./build-archive-readers.mjs";
import { canonicalize, digest, digestFile, pathExists, renameWithRetry } from "./build-data.mjs";
import { BuildFailureError, ConfigurationError, GoExecutionFailureError, GoInputIntegrityError, GoPreparationBoundaryError, WINDOWS_SANDBOX_EXECUTABLE_DIGEST } from "./build-errors.mjs";
import { gitOutput } from "./build-git.mjs";
import { validateSmokeOptions } from "./build-options.mjs";
import { buildEnvironment } from "./build-process.mjs";
import { isSourceDestinationOnE, prepareGoSourceTarget, validateGoSourceOptions } from "./build-source-control.mjs";
import { verifyRuntimeClosure } from "./build-tool-closure.mjs";
import { closureToolPath, hashTree } from "./build-toolchain.mjs";
import { verifyWindowsSandboxControl } from "./build-windows-sandbox.mjs";

async function copyGoExecutionInputs(source, destination, inputs) {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new GoInputIntegrityError(`linked Go execution input: ${source}`);
  if (metadata.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const names = (await readdir(source)).sort();
    for (let index = 0; index < names.length; index += 8) {
      await Promise.all(names.slice(index, index + 8).map((name) =>
        copyGoExecutionInputs(path.join(source, name), path.join(destination, name), inputs)));
    }
  } else if (metadata.isFile()) {
    const bytes = await readFile(source);
    await writeFile(destination, bytes, { flag: "wx" });
    inputs.push({ path: destination, sha256: digest(bytes) });
  } else throw new GoInputIntegrityError(`nonregular Go execution input: ${source}`);
}

async function prepareGoSourceExecution(options, runtime) {
  const localDevelopment = options.has("--dev") && !options.has("--go-restricted-acceptance");
  const preparation = await prepareGoSourceTarget(options, runtime);
  const output = path.resolve(options.get("--out"));
  if (await pathExists(output)) throw new ConfigurationError("Go dependency output already exists");
  const temporaryRoot = await realpath(tmpdir());
  if (!/^E:\\/i.test(temporaryRoot)) throw new ConfigurationError("Go execution requires an actual E: temporary directory");
  const verifiedHelper = localDevelopment ? null : (await verifyWindowsSandboxControl(runtime)).executable;
  const stageRoot = await mkdtemp(path.join(temporaryRoot, "tsfg-go-source-"));
  const inputRoot = path.join(stageRoot, "inputs");
  const workRoot = path.join(stageRoot, "work");
  const controlRoot = path.join(inputRoot, "control");
  const sourceRoot = path.join(inputRoot, "source");
  const goRoot = path.join(inputRoot, "go");
  const nodeRoot = path.join(inputRoot, "node");
  const proxyCache = path.join(inputRoot, "proxy-cache");
  const proxyRoot = path.join(proxyCache, "go-proxies", "sha256", preparation.dependencies.identity.slice(7));
  await mkdir(controlRoot, { recursive: true });
  await mkdir(workRoot);
  const inputs = [];
  const sourceEntries = gitOutput(preparation.sourceRoot,
    ["ls-tree", "-r", "-z", preparation.source.commit, "--", preparation.source.modulePath]).split("\0");
  for (const entry of sourceEntries.filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if (!match) continue;
    const relative = match[3].slice(preparation.source.modulePath.length + 1);
    const included = ["go.mod", "go.sum", "LICENSE", "NOTICE.txt"].includes(relative)
      || (preparation.astIntake && relative.startsWith("cmd/tsfg-ast/"))
      || (/^internal\//.test(relative) && !/(_test\.go|\/testdata\/)/.test(relative)
        && (/\.(go|s|h)$/.test(relative) || /^internal\/(bundled\/libs\/.*\.ts|diagnostics\/loc\/.*\.gz)$/.test(relative)));
    if (!included) continue;
    const destination = path.join(sourceRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyGoExecutionInputs(path.join(preparation.sourceRoot, match[3]), destination, inputs);
    const bytes = await readFile(destination);
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (blob !== match[2]) throw new GoInputIntegrityError(`source changed from fixed Git blob: ${relative}`);
  }
  await copyGoExecutionInputs(path.join(runtime.closurePath, "go"), goRoot, inputs);
  await copyGoExecutionInputs(path.join(runtime.closurePath, "node"), nodeRoot, inputs);
  await copyGoExecutionInputs(path.join(runtime.cachePath, "go-proxies", "sha256",
    preparation.dependencies.identity.slice(7)), proxyRoot, inputs);
  const helper = localDevelopment ? null : path.join(controlRoot, "windows-sandbox-run.exe");
  if (helper) await copyGoExecutionInputs(verifiedHelper, helper, inputs);
  const worker = path.join(controlRoot, "go-source-worker.mjs");
  await copyGoExecutionInputs(fileURLToPath(new URL("./go-source-worker.mjs", import.meta.url)), worker, inputs);
  await copyGoExecutionInputs(fileURLToPath(new URL("./go-work-access.mjs", import.meta.url)),
    path.join(controlRoot, "go-work-access.mjs"), inputs);
  await copyGoExecutionInputs(fileURLToPath(new URL("./go-network-probe.mjs", import.meta.url)),
    path.join(controlRoot, "go-network-probe.mjs"), inputs);
  // Rebind the actual staged bytes to authoritative identities. A hash first
  // observed while copying cannot establish that a tool or proxy was trusted.
  for (const [id, root] of [["go", goRoot], ["node", nodeRoot]]) {
    const expected = runtime.selections.find((selection) => selection.id === id).artifact.unpackedTreeSha256;
    if (await hashTree(root) !== expected) throw new GoInputIntegrityError(`staged ${id} differs from locked tool tree`);
  }
  if (helper && await digestFile(helper) !== WINDOWS_SANDBOX_EXECUTABLE_DIGEST) {
    throw new GoInputIntegrityError("staged native helper differs from the trusted executable");
  }
  try {
    const declaration = await readGoDependencyLock(runtime.lockPath, runtime.lock);
    await verifyGoDependencies(proxyCache, declaration, runtime.lock.goDependencies.sha256, parseZip);
  } catch (error) {
    throw new GoInputIntegrityError(`staged proxy differs from declared input: ${error.message}`);
  }
  // This input has no grant. It proves denial without modifying external ACLs.
  const undeclaredCanary = path.join(stageRoot, "undeclared.txt");
  await writeFile(undeclaredCanary, "undeclared input\n", { flag: "wx" });
  const go = path.join(goRoot, path.relative(path.join(runtime.closurePath, "go"), preparation.executable));
  const node = path.join(nodeRoot, path.relative(path.join(runtime.closurePath, "node"), closureToolPath(runtime, "node")));
  const environment = { ...buildEnvironment(workRoot, []), ...preparation.environmentPolicy,
    GOPROXY: `file:///${proxyRoot.replaceAll("\\", "/")}`,
    GOROOT: goRoot, GOPATH: path.join(workRoot, "gopath"), GOCACHE: path.join(workRoot, "gocache"),
    GOMODCACHE: path.join(workRoot, "modules"), GOTELEMETRY: "off", PATH: "" };
  const executionMode = localDevelopment ? "local-development" : "restricted";
  const cachesInitiallyEmpty = (await Promise.all([environment.GOCACHE, environment.GOMODCACHE].map(async root =>
    (await readdir(root).catch(error => { if (error.code === "ENOENT") return []; throw error; })).length === 0))).every(Boolean);
  if (!cachesInitiallyEmpty) throw new GoInputIntegrityError("new source execution cache is not empty");
  const plan = { schemaVersion: "1", executionMode, moduleRoot: sourceRoot, inputRoot, workRoot, helper,
    cachesInitiallyEmpty,
    undeclaredCanary, go, goVersion: runtime.lock.tools.go.version, arguments: preparation.arguments,
    modules: preparation.dependencies.modules, environment, inputs: inputs.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0) };
  if (preparation.astIntake) plan.sourceTarget = "typescript-ast";
  if (options.has("--go-network-canary-port")) plan.networkCanaryPort = Number(options.get("--go-network-canary-port"));
  const planPath = path.join(controlRoot, "plan.json");
  await writeFile(planPath, canonicalize(plan), { flag: "wx" });
  const executableInputs = inputs.filter((entry) => /\.exe$/i.test(entry.path)).map((entry) => entry.path);
  const supervisorArguments = ["--allowlisted-root", stageRoot,
    ...executableInputs.flatMap((executable) => ["--deny-network", executable]),
    ...[sourceRoot, proxyRoot].flatMap((root) => ["--ro", root]),
    ...[goRoot, nodeRoot, controlRoot].flatMap((root) => ["--rx", root]),
    "--rw", workRoot, "--", node, worker, planPath];
  const launch = { schemaVersion: "1", executionMode,
    executable: localDevelopment ? node : helper,
    arguments: localDevelopment ? [worker, planPath] : supervisorArguments,
    environment, cwd: stageRoot, helperSha256: localDevelopment ? null : WINDOWS_SANDBOX_EXECUTABLE_DIGEST,
    planSha256: await digestFile(planPath) };
  await writeFile(path.join(stageRoot, "launch.json"), canonicalize(launch), { flag: "wx" });
  return { preparation, output, stageRoot, launch };
}

// Private stages of the Hermetic Build Entry; no serialized launch is accepted
// as a replacement for the authoritative preparation above.
async function executePreparedGoSource(prepared) {
  const { stageRoot, launch } = prepared;
  const child = spawnSync(launch.executable, launch.arguments, { cwd: launch.cwd, env: launch.environment,
    encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  await writeFile(path.join(stageRoot, "supervisor.log"), `${child.stdout ?? ""}${child.stderr ?? ""}`);
  return child;
}

async function consumePreparedGoSource(prepared, child) {
  const { preparation, output, stageRoot, launch } = prepared;
  const localDevelopment = launch.executionMode === "local-development";
  preparation.execution = { status: "not-run", blocker: "execution-failed", stageRoot,
    mode: launch.executionMode, helperSha256: launch.helperSha256,
    isolation: localDevelopment ? "not-enforced" : "unique-restricting-sid-lpac-and-wfp-package",
    supervisorCommand: [launch.executable, ...launch.arguments],
    exitCode: child.status, error: child.error?.message ?? null };
  let result;
  try {
    if (preparation.astIntake) {
      return await buildAstProbe({ prepared, child, serialize: canonicalize, publish: renameWithRetry });
    }
    ({ worker: result } = await publishGoSourceExecutionResult(stageRoot, child, output, canonicalize, launch.executionMode));
    preparation.execution.worker = result;
  } catch (error) {
    if (!(error instanceof GoSourceResultError)) throw error;
    if (error.worker !== undefined) preparation.execution.worker = error.worker;
    if (error.kind === "go") {
      preparation.execution.status = "failed";
      preparation.execution.blocker = "go-execution-failed";
      throw new GoExecutionFailureError(preparation, error.message);
    }
    if (error.kind === "native") throw new GoPreparationBoundaryError(preparation, error.message);
    if (error.kind === "integrity") throw new GoInputIntegrityError(error.message);
    throw new BuildFailureError(error.message);
  }
  return { ...preparation, status: "dependencies-resolved", execution: {
    status: "success", mode: launch.executionMode, helperSha256: launch.helperSha256, stageRoot,
    isolation: localDevelopment ? "not-enforced" : "unique-restricting-sid-lpac-and-wfp-package",
    exitCode: child.status, result }, output };
}

// Internal preparation seam for the fixed ticket-03 native operation. This
// creates the same verified stage as the CLI; it neither launches the native
// worker nor accepts an external launch plan as authority.
export async function prepareGoSourceAcceptance({ lockPath, cachePath, output, profile,
  networkCanaryPort = undefined, executionMode = "local-development" }) {
  if (!["local-development", "restricted"].includes(executionMode)) {
    throw new ConfigurationError("unsupported Go execution mode");
  }
  if (networkCanaryPort !== undefined
      && (!Number.isInteger(networkCanaryPort) || networkCanaryPort < 1 || networkCanaryPort > 65535)) {
    throw new ConfigurationError("Go network canary requires a fixed loopback port");
  }
  if (executionMode === "local-development" && networkCanaryPort !== undefined) {
    throw new ConfigurationError("network permission canary requires restricted execution mode");
  }
  for (const destination of [lockPath, cachePath, output]) {
    if (typeof destination !== "string" || !await isSourceDestinationOnE(destination)) {
      throw new ConfigurationError("Go preparation requires absolute E: lock, cache and output paths");
    }
  }
  const options = new Map([
    ["--source-target", "typescript-dependencies"], ["--target", "windows-x86_64-msvc"],
    ["--profile", profile], ["--out", output], ["--dev", ""],
  ]);
  validateSmokeOptions(options, "build");
  if (executionMode === "restricted") options.set("--go-restricted-acceptance", "");
  if (networkCanaryPort !== undefined) options.set("--go-network-canary-port", String(networkCanaryPort));
  const runtime = await verifyRuntimeClosure(lockPath, cachePath, "windows-x86_64-msvc",
    { nativeControls: executionMode !== "local-development" });
  await validateGoSourceOptions(options, runtime);
  const prepared = await prepareGoSourceExecution(options, runtime);
  return bindGoSourceCompletion(prepared.launch, (child) => consumePreparedGoSource(prepared, child));
}

export async function executeGoSourceTarget(options, runtime) {
  const prepared = await prepareGoSourceExecution(options, runtime);
  const child = await executePreparedGoSource(prepared);
  return await consumePreparedGoSource(prepared, child);
}
