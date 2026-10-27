// SPDX-License-Identifier: MIT
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { sourceGitEnvironment } from "./intake-ledger.mjs";
import { readMlirSourceIdentity } from "./mlir-source.mjs";
import { mlirCommittedSourceBytes, readMlirSourceBuildLegalInputs, readMlirSourceLegalFiles } from "./mlir-source-legal.mjs";
import { readMlirPythonTool } from "./mlir-python.mjs";

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const requiredLegalPaths = ["llvm/lib/Support/xxhash.cpp", "llvm/lib/Support/regstrlcpy.c", "llvm/lib/Support/MD5.cpp",
  "llvm/lib/Support/ConvertUTF.cpp", "llvm/include/llvm/Support/ConvertUTF.h", "llvm/include/llvm/Support/xxhash.h",
  "llvm/include/llvm/Support/MD5.h", "llvm/lib/Support/UnicodeNameToCodepointGenerated.cpp", "llvm/lib/Support/COPYRIGHT.regex"];
export class MlirBuildError extends Error {
  constructor(message, issueCode = "mlir-source-build") { super(message); this.issueCode = issueCode; }
}
const cmakePath = value => value.replaceAll("\\", "/");
const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function validateOutputAncestor(parent) {
  let current = parent;
  for (;;) {
    const state = await lstat(current).catch(error => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (state) {
      const actual = await realpath(current);
      if (!state.isDirectory() || state.isSymbolicLink() || !/^E:[\\/]/i.test(actual) ||
          path.relative(current, actual) !== "")
        throw new MlirBuildError("Build output ancestor must be an ordinary, nonredirected E directory", "mlir-output-integrity");
      return;
    }
    const next = path.dirname(current);
    if (next === current) throw new MlirBuildError("Build output has no verified E ancestor", "mlir-output-integrity");
    current = next;
  }
}
function gitBytes(git, root, args) {
  const child = spawnSync(git, ["-C", root, ...args], { env: sourceGitEnvironment(), encoding: "buffer",
    windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (child.error || child.status !== 0) throw new MlirBuildError(`Git source inspection failed: ${args[0]}`);
  return child.stdout;
}

async function runLogged(executable, args, cwd, env, log) {
  const handle = await open(log, "wx");
  await writeFile(`${log}.command.json`, JSON.stringify({ executable, args, cwd, environment: env }, null, 2));
  try {
    const status = await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ["ignore", handle.fd, handle.fd] });
      process.stderr.write(`MLIR child pid=${child.pid} log=${log}\n`);
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    await writeFile(`${log}.exit.json`, JSON.stringify(status));
    if (status.code !== 0) throw new MlirBuildError(`Source command failed (${status.code}/${status.signal}); see ${log}`);
  } finally { await handle.close(); }
}

async function materializeSource(identity, git, destination) {
  const rawTree = gitBytes(git, identity.sourceRoot,
    ["ls-tree", "-r", "-z", identity.sourceCommit, "--", "llvm", "mlir", "cmake", "third-party", "UPSTREAM.toml"]);
  const entries = [];
  const unmaterialized = [];
  const checkoutDifferences = [];
  for (const line of rawTree.toString("utf8").split("\0").filter(Boolean)) {
    const link = /^120000 blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (link) {
      unmaterialized.push({ path: link[2], mode: "120000", blob: link[1], reason: "nonregular input is never materialized or admitted for consumption" });
      continue;
    }
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match) throw new MlirBuildError("Source materialization contains an unsupported Git entry", "mlir-source-integrity");
    const name = match[3];
    const original = path.join(identity.sourceRoot, name);
    const state = await lstat(original);
    if (!state.isFile() || state.isSymbolicLink() || !within(identity.sourceRoot, await realpath(original)))
      throw new MlirBuildError(`Nonregular source input: ${name}`, "mlir-source-integrity");
    const checkout = await readFile(original);
    let bytes;
    try { bytes = mlirCommittedSourceBytes(checkout, match[2], name); }
    catch (error) { throw new MlirBuildError(error.message, "mlir-source-integrity"); }
    if (!bytes.equals(checkout)) checkoutDifferences.push({ path: name, observedCheckoutSha256: digest(checkout),
      committedBlob: match[2], consumedRawSha256: digest(bytes), method: "only CRLF-to-LF; exact immutable Git object equality proven" });
    const target = path.join(destination, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
    entries.push({ projectId: "llvm-project.git", repositoryRelativePath: name,
      normalizedMode: match[1], sha256: digest(bytes), blob: match[2] });
  }
  return { entries, unmaterialized, checkoutDifferences };
}

async function retainedNoticeBundle({ source, sourceEntries, productRoot, identity, legal }) {
  const lock = JSON.parse(await readFile(path.join(productRoot, "eng/mlir-source-notices.lock.json"), "utf8"));
  if (lock.schemaVersion !== "1" || lock.baseCommit !== identity.baseCommit || lock.sourceCommit !== identity.sourceCommit)
    throw new MlirBuildError("Original notice retention mapping has another source identity", "mlir-source-license");
  const entries = new Map(sourceEntries.map(entry => [entry.repositoryRelativePath, entry]));
  const inputs = [];
  for (const file of lock.files) {
    const entry = entries.get(file.path);
    if (!entry || entry.blob !== file.blob || entry.sha256 !== file.sha256)
      throw new MlirBuildError(`Original notice input differs from committed source: ${file.path}`, "mlir-source-license");
    const bytes = await readFile(path.join(source, file.path));
    const notice = bytes.subarray(file.noticeStart, file.noticeEnd);
    if (digest(bytes) !== file.sha256 || digest(notice) !== file.noticeSha256 ||
      !notice.equals(Buffer.from(file.completeOriginalNotice, "utf8")))
      throw new MlirBuildError(`Complete original notice changed: ${file.path}`, "mlir-source-license");
    inputs.push(entry);
  }
  return { inputs, bundle: { schemaVersion: "1", baseCommit: identity.baseCommit, sourceCommit: identity.sourceCommit,
    role: "compiler-side-M01", approvalLockSha256: legal.approvalLockSha256,
    purpose: lock.purpose, files: lock.files } };
}

async function validatePublication(directory, manifest, serialize) {
  const state = await lstat(directory);
  if (!state.isDirectory() || state.isSymbolicLink() || path.relative(directory, await realpath(directory)) !== "")
    throw new MlirBuildError("Source artifact publication directory was redirected", "mlir-artifact-integrity");
  const expected = ["artifact-manifest.json", ...manifest.outputs.map(output => output.path)].sort();
  const actual = await readdir(directory, { withFileTypes: true });
  if (actual.some(entry => !entry.isFile() || entry.isSymbolicLink()) ||
    JSON.stringify(actual.map(entry => entry.name).sort()) !== JSON.stringify(expected))
    throw new MlirBuildError("Source artifact member set changed", "mlir-artifact-integrity");
  if (!(await readFile(path.join(directory, "artifact-manifest.json"))).equals(Buffer.from(serialize(manifest))))
    throw new MlirBuildError("Source artifact manifest bytes changed", "mlir-artifact-integrity");
  for (const output of manifest.outputs) if (digest(await readFile(path.join(directory, output.path))) !== output.sha256)
    throw new MlirBuildError(`Source artifact payload/notice digest changed: ${output.path}`, "mlir-artifact-integrity");
}

function physicalEvaluationCall(original, recordedLine) {
  const lines = original.split("\n");
  if (recordedLine > lines.length) return false;
  const lineStart = lines.slice(0, recordedLine - 1).reduce((offset, line) => offset + line.length + 1, 0);
  const lineEnd = lineStart + lines[recordedLine - 1].length;
  let depth = 0;
  for (let index = 0; index < original.length;) {
    const character = original[index];
    if (character === "\\") { index += 2; continue; }
    if (character === '"') {
      for (index++; index < original.length; index++) {
        if (original[index] === "\\") index++;
        else if (original[index] === '"') { index++; break; }
      }
      continue;
    }
    const bracket = /^(?:#)?\[(=*)\[/.exec(original.slice(index));
    if (bracket) {
      const close = original.indexOf(`]${bracket[1]}]`, index + bracket[0].length);
      if (close === -1) return false;
      index = close + bracket[1].length + 2;
      continue;
    }
    if (character === "#") {
      const newline = original.indexOf("\n", index);
      index = newline === -1 ? original.length : newline + 1;
      continue;
    }
    if (depth === 0) {
      const command = /^([a-z_][a-z0-9_]*)\s*\(/i.exec(original.slice(index));
      if (command) {
        // Trace line identifies the command name, not text inside an argument.
        if (index >= lineStart && index <= lineEnd && command[1].toLowerCase() === "cmake_language")
          return /^\s*EVAL\s+CODE\b/.test(original.slice(index + command[0].length));
        depth = 1;
        index += command[0].length;
        continue;
      }
    }
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (depth < 0) return false;
    index++;
  }
  return false;
}

/** Read-only CMake trace origins; callers still qualify every returned physical input. */
export async function readMlirBuildTrace({ cmakeTrace, build, inputRoots }) {
  const cmakeFiles = new Set();
  const cmakeEvaluationFrames = new Map();
  const evaluationCalls = new Map();
  for (const line of cmakeTrace.split(/\r?\n/).filter(Boolean)) {
    const record = JSON.parse(line);
    if (!record.file) continue;
    cmakeFiles.add(record.file);
    if (record.cmd === "cmake_language" && record.args?.[0] === "EVAL" && record.args?.[1] === "CODE" &&
      Number.isSafeInteger(record.line) && record.line > 0) {
      const key = `${record.file}:${record.line}:EVAL`;
      const call = evaluationCalls.get(key) ?? { parentFile: record.file, line: record.line, codeHashes: new Set() };
      call.codeHashes.add(digest(JSON.stringify(record.args.slice(2))));
      evaluationCalls.set(key, call);
    }
  }
  for (const name of [...cmakeFiles]) {
    // CMake identifies cmake_language(EVAL CODE) frames as file:line:EVAL,
    // including nested evaluations. Their code originates in the physical
    // parent file, which must pass the same source/tool integrity checks below.
    let physical = name;
    const evaluationLines = [];
    const evaluationCodeHashes = [];
    for (let frame; (frame = /^(.*):([1-9][0-9]*):EVAL$/.exec(physical));) {
      const call = evaluationCalls.get(physical);
      if (!call || call.parentFile !== frame[1] || String(call.line) !== frame[2])
        throw new MlirBuildError(`Unproven CMake evaluation frame: ${physical}`, "mlir-source-integrity");
      evaluationLines.unshift(frame[2]);
      evaluationCodeHashes.unshift([...call.codeHashes].sort());
      physical = frame[1];
    }
    if (evaluationLines.length) {
      const absoluteOrigin = path.resolve(build, physical);
      if (!inputRoots.some(root => within(root, absoluteOrigin)))
        throw new MlirBuildError(`CMake evaluation origin is outside admitted input roots: ${name}`, "mlir-source-integrity");
      const original = await readFile(absoluteOrigin, "utf8");
      if (!physicalEvaluationCall(original, Number(evaluationLines[0])))
        throw new MlirBuildError(`CMake evaluation has no physical origin at the recorded line: ${name}`, "mlir-source-integrity");
      cmakeEvaluationFrames.set(name, { traceFile: name, physicalFile: physical, evaluationLines, evaluationCodeHashes });
      cmakeFiles.delete(name);
    }
    cmakeFiles.add(physical);
  }
  return { files: [...cmakeFiles], evaluationFrames: [...cmakeEvaluationFrames.values()], sha256: digest(cmakeTrace) };
}

async function collectConsumedInputs({ tools, build, source, sourceEntries, product, productEntries, runtime, env, stage }) {
  const capture = args => {
    const child = spawnSync(tools.ninja, args, { cwd: build, env, encoding: "utf8", windowsHide: true,
      maxBuffer: 128 * 1024 * 1024 });
    if (child.error || child.status !== 0) throw new MlirBuildError(`Cannot inspect Ninja dependency trace: ${args.join(" ")}`);
    return child.stdout;
  };
  const inputs = capture(["-t", "inputs", "-E", "-0", "tsfg-core-ir"]);
  const configurationInputs = capture(["-t", "inputs", "-E", "-0", "build.ninja"]);
  const deps = capture(["-t", "deps"]);
  await writeFile(path.join(stage, "ninja-inputs.nul"), inputs);
  await writeFile(path.join(stage, "ninja-configuration-inputs.nul"), configurationInputs);
  await writeFile(path.join(stage, "ninja-deps.txt"), deps);
  const cmakeTrace = await readFile(path.join(stage, "cmake-trace.jsonl"), "utf8");
  const cmakeOrigins = await readMlirBuildTrace({ cmakeTrace, build, inputRoots: [source, product, runtime.closurePath] });
  const observed = new Set([...inputs.split("\0").filter(Boolean),
    ...configurationInputs.split("\0").filter(Boolean), ...cmakeOrigins.files,
    ...deps.split(/\r?\n/).filter(line => /^    \S/.test(line)).map(line => line.trim())]);
  const upstream = new Map(sourceEntries.map(entry => [entry.repositoryRelativePath.toLowerCase(), entry]));
  const consumed = new Map();
  const consumedProduct = new Map();
  const generated = [];
  const toolInputs = [];
  for (const name of observed) {
    const absolute = path.resolve(build, name);
    if (within(source, absolute)) {
      const relative = path.relative(source, absolute).replaceAll("\\", "/");
      const entry = upstream.get(relative.toLowerCase());
      if (!entry || digest(await readFile(absolute)) !== entry.sha256)
        throw new MlirBuildError(`Unregistered or changed source dependency: ${relative}`, "mlir-source-integrity");
      consumed.set(entry.repositoryRelativePath, entry);
    } else if (within(product, absolute)) {
      const relative = path.relative(product, absolute).replaceAll("\\", "/");
      const entry = productEntries.find(entry => entry.projectId === "tsfg" && entry.repositoryRelativePath === relative);
      if (!entry || digest(await readFile(absolute)) !== entry.sha256)
        throw new MlirBuildError(`Undeclared or changed staged product dependency: ${relative}`, "mlir-source-integrity");
      consumedProduct.set(relative, entry);
    } else if (within(runtime.closurePath, absolute)) {
      toolInputs.push({ path: path.relative(runtime.closurePath, absolute).replaceAll("\\", "/"), sha256: digest(await readFile(absolute)) });
    } else if (within(build, absolute)) {
      const state = await lstat(absolute).catch(() => undefined);
      if (state?.isFile()) generated.push({ path: path.relative(build, absolute).replaceAll("\\", "/"), sha256: digest(await readFile(absolute)) });
    } else {
      throw new MlirBuildError(`Undeclared source dependency outside the staged/tool closure: ${absolute}`, "mlir-source-integrity");
    }
  }
  // Provenance and whole-source notices are inspected explicitly by the intake reader.
  for (const name of ["UPSTREAM.toml", "llvm/LICENSE.TXT", "mlir/LICENSE.TXT"]) {
    const entry = upstream.get(name.toLowerCase());
    if (!entry) throw new MlirBuildError(`Missing inspected metadata input: ${name}`, "mlir-source-integrity");
    consumed.set(name, entry);
  }
  return { files: [...consumed.values()].sort((a, b) => Buffer.from(a.repositoryRelativePath).compare(Buffer.from(b.repositoryRelativePath))),
    productFiles: [...consumedProduct.values()], generated, toolInputs, ninjaInputsSha256: digest(inputs), ninjaConfigurationInputsSha256: digest(configurationInputs),
    cmakeTraceSha256: cmakeOrigins.sha256, cmakeEvaluationFrames: cmakeOrigins.evaluationFrames, ninjaDepsSha256: digest(deps) };
}

/** The formal source-build target; no source process starts before all intake gates. */
export async function executeMlirTarget({ options, runtime, tools, productRoot, workspaceState, serialize,
  createIdentity, scopedToolchainDigest, verifyTools }) {
  const sourceRoot = process.env.TSFG_MLIR_SOURCE;
  const git = process.env.TSFG_GIT;
  const identity = await readMlirSourceIdentity({ sourceRoot, git });
  const output = path.resolve(options.get("--out"));
  if (!/^E:[\\/]/i.test(output) || within(sourceRoot, output))
    throw new MlirBuildError("Build output requires an independent absolute E-drive root", "mlir-output-integrity");
  const outputParent = path.dirname(output);
  // Inspect the nearest existing ancestor without creating missing parents.
  // A lexical E path may already traverse a redirected directory.
  await validateOutputAncestor(outputParent);
  // Tool verification is read-only and must preserve its own failure identity,
  // even while an independent source-file approval is still pending.
  const python = await readMlirPythonTool({ toolRoot: process.env.TSFG_MLIR_PYTHON_TOOL_ROOT });
  const legal = await readMlirSourceLegalFiles({ sourceRoot, git, paths: requiredLegalPaths });
  if (!runtime || !tools || typeof verifyTools !== "function") throw new MlirBuildError("MLIR source build requires the verified native tool closure", "mlir-tool-integrity");
  if (!/^E:[\\/]/i.test(output) || !/^E:[\\/]/i.test(runtime.closurePath) || within(sourceRoot, output) || within(runtime.closurePath, output))
    throw new MlirBuildError("Build output and tool/storage paths require independent absolute E-drive roots");
  if (await lstat(output).catch(error => { if (error.code === "ENOENT") return undefined; throw error; }))
    throw new MlirBuildError("Independent source build output already exists");
  await validateOutputAncestor(outputParent);
  await mkdir(outputParent, { recursive: true });
  await validateOutputAncestor(outputParent);
  const manifestPath = "compiler/core-ir/sources.json";
  const coreManifest = JSON.parse(await readFile(path.join(productRoot, manifestPath), "utf8"));
  if (Object.keys(coreManifest).sort().join(",") !== "headers,sources" ||
      !Array.isArray(coreManifest.sources) || !coreManifest.sources.length || !Array.isArray(coreManifest.headers) ||
      coreManifest.sources.some(name => typeof name !== "string" || !/^[a-z0-9_-]+\.cpp$/.test(name)) ||
      coreManifest.headers.some(name => typeof name !== "string" || !/^[a-z0-9_-]+\.h$/.test(name)))
    throw new MlirBuildError("Core product source directory differs", "mlir-source-integrity");
  const coreNames = [...coreManifest.sources, ...coreManifest.headers];
  if (new Set(coreNames).size !== coreNames.length || !coreManifest.sources.includes("main.cpp"))
    throw new MlirBuildError("Core product source membership differs", "mlir-source-integrity");
  const coreProductInputs = ["compiler/core-ir/CMakeLists.txt", manifestPath,
    ...coreNames.map(name => `compiler/core-ir/${name}`)];
  const stagedProductInputs = [...coreProductInputs, "eng/mlir-python-policy.cmake", "eng/mlir-compiler-launcher.mjs"];
  // Require immutable product approval/configuration bytes before source execution.
  for (const name of ["eng/mlir-source-legal.lock.json", "eng/mlir-source-build-legal.lock.json", "eng/mlir-source-notices.lock.json", "eng/mlir-python.lock.json", "eng/mlir-source.lock.json",
    "eng/mlir-build.mjs", "eng/mlir-compiler-launcher.mjs", "eng/mlir-python-policy.cmake", ...coreProductInputs]) {
    const raw = await readFile(path.join(productRoot, name));
    const committed = gitBytes(git, productRoot, ["show", `HEAD:${name}`]);
    if (!raw.equals(committed)) throw new MlirBuildError(`Intake input must match committed product bytes: ${name}`, "mlir-source-integrity");
  }
  const stage = path.join(path.dirname(output), `.mlir-${randomUUID()}`);
  const source = path.join(stage, "source"), build = path.join(stage, "build"), product = path.join(stage, "product");
  await mkdir(stage);
  await writeFile(path.join(stage, "ownership.json"), serialize({ owner: "r03-01-intake", output, stage, sourceCommit: identity.sourceCommit }));
  // Keep failure diagnostics on the file opened in the new owned E stage,
  // rather than writing through a publication path after an integrity refusal.
  const failureHandle = await open(path.join(stage, "failure.json"), "wx");
  try {
    const { entries: sourceEntries, unmaterialized, checkoutDifferences } = await materializeSource(identity, git, source);
    await writeFile(path.join(stage, "source-snapshot.json"), serialize({ sourceCommit: identity.sourceCommit,
      sourceTree: identity.sourceTree, entries: sourceEntries, unmaterialized, checkoutDifferences }));
    for (const name of stagedProductInputs) {
      await mkdir(path.dirname(path.join(product, name)), { recursive: true });
      await copyFile(path.join(productRoot, name), path.join(product, name));
    }
    await mkdir(build);
    const env = { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, TZ: "UTC", LANG: "C.UTF-8",
      PATH: [tools.cmake, tools.ninja, tools.clangcl, tools.lld, tools.rc, tools.cl].map(file => path.dirname(file)).join(";"),
      HOME: stage, USERPROFILE: stage, APPDATA: stage, LOCALAPPDATA: stage, TEMP: stage, TMP: stage, TMPDIR: stage,
      PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1", PYTHONPYCACHEPREFIX: path.join(stage, "python-cache"),
      INCLUDE: tools.include.join(";"), LIB: tools.lib.join(";"), LIBPATH: tools.lib.join(";") };
    const scopedRuntime = { ...runtime, lockDigest: scopedToolchainDigest(runtime, python) };
    const productIdentity = await createIdentity(scopedRuntime, productRoot);
    const requiredProductInputs = [...coreProductInputs, "eng/mlir-build.mjs",
      "eng/mlir-python-policy.cmake", "eng/mlir-source.mjs", "eng/mlir-source.lock.json", "eng/mlir-python.mjs",
      "eng/mlir-python.lock.json", "eng/mlir-source-legal.mjs", "eng/mlir-source-legal.lock.json"];
    requiredProductInputs.push("eng/mlir-compiler-launcher.mjs", "eng/mlir-source-notices.lock.json");
    requiredProductInputs.push("eng/mlir-source-build-legal.lock.json");
    for (const name of requiredProductInputs) {
      const entry = productIdentity.buildInputSet.entries.find(entry => entry.projectId === "tsfg" && entry.repositoryRelativePath === name);
      if (!entry || entry.sha256 !== digest(await readFile(path.join(productRoot, name))))
        throw new MlirBuildError(`Actual product input is absent or changed in Build Input Set: ${name}`, "mlir-source-integrity");
    }
    for (const name of stagedProductInputs) {
      const entry = productIdentity.buildInputSet.entries.find(entry => entry.projectId === "tsfg" && entry.repositoryRelativePath === name);
      if (digest(await readFile(path.join(product, name))) !== entry.sha256)
        throw new MlirBuildError(`Staged product input differs from declared identity: ${name}`, "mlir-source-integrity");
    }
    // The product last-touch maximum is an exact combined maximum only when it
    // dominates every upstream ancestor. This check is a conservative proof;
    // it refuses a newer source rather than inventing per-file timestamps.
    const sourceHistoryTimes = gitBytes(git, identity.sourceRoot,
      ["log", "--format=%ct", identity.sourceCommit]).toString("utf8").trim().split(/\r?\n/).map(Number);
    const sourceHistoryMaximum = sourceHistoryTimes.reduce((maximum, timestamp) => Math.max(maximum, timestamp), 0);
    const productEpoch = Number(productIdentity.buildIdentity.source_date_epoch);
    if (!Number.isSafeInteger(sourceHistoryMaximum) || sourceHistoryMaximum > productEpoch)
      throw new MlirBuildError("Product epoch does not bound the source last-touch history; combined identity cannot be published", "mlir-source-integrity");
    await writeFile(path.join(stage, "epoch-proof.json"), serialize({ method: "product-maximum-dominates-all-source-ancestor-times",
      sourceCommit: identity.sourceCommit, sourceHistoryMaximum, productEpoch }));
    env.SOURCE_DATE_EPOCH = productIdentity.buildIdentity.source_date_epoch;
    const profileFlags = ["/Od", "/Z7", "/UNDEBUG", "/clang:-march=x86-64-v2", "/clang:-mtune=generic", "/clang:-mno-avx",
      "/clang:-fno-lto", "/clang:-fno-fast-math", "/clang:-fdebug-compilation-dir=.", "/clang:-gno-codeview-command-line",
      ...[[source, ".source"], [product, ".product"], [build, ".build"], [runtime.closurePath, ".toolchain"]].flatMap(([from, to]) =>
        [`/clang:-ffile-prefix-map=${cmakePath(from)}=${to}`, `/clang:-fdebug-prefix-map=${cmakePath(from)}=${to}`])]
      .map(flag => `"${flag}"`).join(" ");
    const disabled = ["LLVM_INCLUDE_TESTS", "LLVM_INCLUDE_EXAMPLES", "LLVM_INCLUDE_BENCHMARKS", "LLVM_INCLUDE_DOCS",
      "LLVM_ENABLE_ZLIB", "LLVM_ENABLE_ZSTD", "LLVM_ENABLE_LIBXML2", "LLVM_ENABLE_LIBEDIT", "LLVM_ENABLE_CURL",
      "LLVM_ENABLE_TERMINFO", "LLVM_ENABLE_LIBPFM", "LLVM_ENABLE_Z3_SOLVER", "LLVM_ENABLE_RPMALLOC",
      "LLVM_ENABLE_ICU", "LLVM_ENABLE_ICONV", "LLVM_ENABLE_DIA_SDK", "LLVM_USE_INTEL_JITEVENTS", "LLVM_USE_OPROFILE", "LLVM_USE_PERF",
      "LLVM_ENABLE_LIBCXX", "LLVM_ENABLE_EH", "LLVM_ENABLE_RTTI", "LLVM_APPEND_VC_REV",
      "MLIR_INCLUDE_TESTS", "MLIR_INCLUDE_EXAMPLES", "MLIR_INCLUDE_DOCS", "MLIR_ENABLE_BINDINGS_PYTHON",
      "MLIR_ENABLE_EXECUTION_ENGINE", "MLIR_ENABLE_CUDA_RUNNER", "MLIR_ENABLE_ROCM_RUNNER", "MLIR_ENABLE_VULKAN_RUNNER"];
    // Match the existing Windows control plane's explicit locked static CRT.
    // Automatic default libraries request oldnames.lib, which is not part of
    // this verified tool closure; required symbols must resolve in these exact
    // libraries rather than finding an ambient Visual Studio installation.
    // The locked UCRT declares each POSIX compatibility name with the exact
    // same x64 C ABI as its underscored entry. Resolve only the four names
    // observed in real LLVMSupport linking; no replacement implementation.
    const lockedCrtAliases = ["lseek", "write", "read", "close"].map(name => `/alternatename:${name}=_${name}`).join(" ");
    const lockedCrtFlags = `/nodefaultlib libcmtd.lib libvcruntimed.lib libucrtd.lib libcpmtd.lib kernel32.lib ${lockedCrtAliases}`;
    const compilerLauncher = [tools.node, path.join(product, "eng/mlir-compiler-launcher.mjs"), tools.clangcl, source, product, build]
      .map(cmakePath).join(";");
    const args = ["--trace-expand", "--trace-format=json-v1", `--trace-redirect=${cmakePath(path.join(stage, "cmake-trace.jsonl"))}`,
      "-S", cmakePath(path.join(source, "llvm")), "-B", cmakePath(build), "-G", "Ninja",
      "-DLLVM_ENABLE_PROJECTS=mlir", "-DLLVM_TARGETS_TO_BUILD=X86", "-DLLVM_ENABLE_ASSERTIONS=ON", "-DLLVM_ENABLE_LTO=OFF",
      "-DLLVM_EXTERNAL_PROJECTS=tsfg-core-ir", `-DLLVM_EXTERNAL_TSFG_CORE_IR_SOURCE_DIR=${cmakePath(path.join(product, "compiler/core-ir"))}`,
      "-DCMAKE_BUILD_TYPE=Debug", `-DCMAKE_MAKE_PROGRAM=${cmakePath(tools.ninja)}`, `-DCMAKE_C_COMPILER=${cmakePath(tools.clangcl)}`,
      `-DCMAKE_CXX_COMPILER=${cmakePath(tools.clangcl)}`, `-DCMAKE_LINKER=${cmakePath(tools.lld)}`,
      `-DCMAKE_C_COMPILER_LAUNCHER=${compilerLauncher}`, `-DCMAKE_CXX_COMPILER_LAUNCHER=${compilerLauncher}`,
      `-DCMAKE_RC_COMPILER=${cmakePath(tools.rc)}`, `-DCMAKE_MT=${cmakePath(tools.mt)}`, "-DLLVM_USE_LINKER=lld",
      `-DCMAKE_ASM_MASM_COMPILER=${cmakePath(path.join(path.dirname(tools.cl), "ml64.exe"))}`,
      "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDebug", "-DLLVM_USE_CRT_DEBUG=MTd",
      "-DCMAKE_POLICY_DEFAULT_CMP0141=NEW", "-DCMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded",
      "-DLLVM_INTEGRATED_CRT_ALLOC=", "-DLLVM_USE_SANITIZER=", "-DCMAKE_PREFIX_PATH=",
      "-DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF", "-DCMAKE_FIND_USE_SYSTEM_PACKAGE_REGISTRY=OFF",
      `-DCMAKE_C_FLAGS=${profileFlags}`, `-DCMAKE_CXX_FLAGS=${profileFlags}`,
      "-DCMAKE_C_FLAGS_DEBUG=/Od /Z7 /UNDEBUG", "-DCMAKE_CXX_FLAGS_DEBUG=/Od /Z7 /UNDEBUG",
      `-DCMAKE_EXE_LINKER_FLAGS=/Brepro /debug:full /pdbsourcepath:.build /pdbaltpath:%_PDB% /timestamp:${env.SOURCE_DATE_EPOCH} ${lockedCrtFlags}`,
      `-DCMAKE_SHARED_LINKER_FLAGS=${lockedCrtFlags}`, `-DCMAKE_MODULE_LINKER_FLAGS=${lockedCrtFlags}`,
      "-DCMAKE_EXE_LINKER_FLAGS_DEBUG=/debug /INCREMENTAL:NO",
      "-DCMAKE_SHARED_LINKER_FLAGS_DEBUG=/debug /INCREMENTAL:NO", "-DCMAKE_MODULE_LINKER_FLAGS_DEBUG=/debug /INCREMENTAL:NO",
      `-DPython3_EXECUTABLE=${cmakePath(python.executable)}`, "-DPython3_FIND_REGISTRY=NEVER", "-DPython3_FIND_STRATEGY=LOCATION",
      `-DTSFG_VERIFIED_PYTHON=${cmakePath(python.executable)}`, `-DCMAKE_PROJECT_INCLUDE_BEFORE=${cmakePath(path.join(product, "eng/mlir-python-policy.cmake"))}`,
      ...disabled.map(name => `-D${name}=OFF`)];
    const configurationPaths = sourceEntries.filter(entry => /^(llvm|mlir|cmake)\//.test(entry.repositoryRelativePath) &&
      /(?:^|\/)CMakeLists\.txt$|\.cmake$|\.cmake\.in$/.test(entry.repositoryRelativePath) &&
      !/(?:^|\/)(?:test|tests|examples|docs|benchmark|benchmarks)\//.test(entry.repositoryRelativePath)).map(entry => entry.repositoryRelativePath);
    const configurationLegal = await readMlirSourceBuildLegalInputs({ sourceRoot, git, paths: configurationPaths });
    await writeFile(path.join(stage, "configuration-legal.json"), serialize(configurationLegal));
    await runLogged(tools.cmake, args, stage, env, path.join(stage, "configure.log"));
    const cache = await readFile(path.join(build, "CMakeCache.txt"), "utf8");
    for (const name of disabled) {
      const value = cache.match(new RegExp(`^${name}:[^=\\r\\n]+=([^\\r\\n]*)`, "m"));
      if (!value || value[1] !== "OFF") throw new MlirBuildError(`Optional dependency configuration changed: ${name}`);
    }
    for (const name of ["LLVM_INTEGRATED_CRT_ALLOC", "LLVM_USE_SANITIZER"]) {
      const value = cache.match(new RegExp(`^${name}:[^=\\r\\n]+=([^\\r\\n]*)`, "m"));
      if (!value || value[1] !== "") throw new MlirBuildError(`Undeclared allocator/sanitizer input selected: ${name}`);
    }
    const plannedCommands = spawnSync(tools.ninja, ["-t", "commands", "tsfg-core-ir"], { cwd: build, env,
      encoding: "utf8", windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
    if (plannedCommands.error || plannedCommands.status !== 0) throw new MlirBuildError("Cannot inspect planned source commands");
    await writeFile(path.join(stage, "ninja-commands.txt"), plannedCommands.stdout);
    for (const command of plannedCommands.stdout.split(/\r?\n/)) {
      if (/(?:^|[\\/"\s])(?:python(?:3|\d+\.\d+)?|py)\.exe(?=["\s]|$)/i.test(command)) {
        if (!cmakePath(command).toLowerCase().includes(cmakePath(python.executable).toLowerCase()) ||
          !/(?:^|\s)-I(?:\s|$)/.test(command) || !/(?:^|\s)-B(?:\s|$)/.test(command))
          throw new MlirBuildError("Planned Python generation requires the exact verified isolated/no-bytecode tool", "mlir-python-integrity");
      }
    }
    const plannedTrace = await collectConsumedInputs({ tools, build, source, sourceEntries, product,
      productEntries: productIdentity.buildInputSet.entries, runtime, env, stage });
    const plannedPaths = plannedTrace.files.map(file => file.repositoryRelativePath).filter(name => !["UPSTREAM.toml", "llvm/LICENSE.TXT", "mlir/LICENSE.TXT"].includes(name));
    const plannedLegal = await readMlirSourceBuildLegalInputs({ sourceRoot, git, paths: plannedPaths });
    await writeFile(path.join(stage, "planned-consumption-legal.json"), serialize(plannedLegal));
    // Verify conservative headers and generator includes before compilation.
    // Previously observed transitive TableGen dependencies are explicit entries;
    // Ninja's initial input graph alone does not contain those discovered edges.
    const legalInventory = JSON.parse(await readFile(path.join(productRoot, "eng/mlir-source-build-legal.lock.json"), "utf8"));
    const precompileLegal = await readMlirSourceBuildLegalInputs({ sourceRoot, git, paths: legalInventory.files
      .filter(file => /\.(?:h|hpp|inc|def|td)$/.test(file.path)).map(file => file.path) });
    for (const file of precompileLegal.files) {
      const staged = path.join(source, file.path);
      const state = await lstat(staged);
      if (!state.isFile() || state.isSymbolicLink() || path.relative(staged, await realpath(staged)) !== "" ||
          digest(await readFile(staged)) !== file.sha256)
        throw new MlirBuildError(`Precompile staged source differs from its qualified input: ${file.path}`, "mlir-source-integrity");
    }
    await writeFile(path.join(stage, "precompile-consumption-legal.json"), serialize(precompileLegal));
    await runLogged(tools.cmake, ["--build", cmakePath(build), "--target", "tsfg-core-ir", "--parallel", "4"], stage, env, path.join(stage, "build.log"));
    const trace = await collectConsumedInputs({ tools, build, source, sourceEntries, product,
      productEntries: productIdentity.buildInputSet.entries, runtime, env, stage });
    const notices = await retainedNoticeBundle({ source, sourceEntries, productRoot, identity, legal });
    const consumedPaths = trace.files.map(file => file.repositoryRelativePath).filter(name => !["UPSTREAM.toml", "llvm/LICENSE.TXT", "mlir/LICENSE.TXT"].includes(name));
    const consumedLegal = await readMlirSourceBuildLegalInputs({ sourceRoot, git, paths: consumedPaths });
    await writeFile(path.join(stage, "actual-consumption-legal.json"), serialize(consumedLegal));
    notices.bundle.actualConsumption = consumedLegal;
    const materialInputs = consumedLegal.licenseMaterials.map(material => sourceEntries.find(entry => entry.repositoryRelativePath === material.path));
    if (materialInputs.some(entry => !entry)) throw new MlirBuildError("A consumed original license material was not staged", "mlir-source-license");
    const sourceInputs = new Map([...trace.files, ...notices.inputs, ...materialInputs].map(entry => [entry.repositoryRelativePath, entry]));
    const inputPayload = { schemaVersion: "1", entries: [...productIdentity.buildInputSet.entries,
      ...[...sourceInputs.values()].map(({ blob, ...entry }) => entry)].sort((a, b) => Buffer.from(`${a.projectId}\0${a.repositoryRelativePath}`)
        .compare(Buffer.from(`${b.projectId}\0${b.repositoryRelativePath}`))) };
    const buildInputSet = { ...inputPayload, digest: digest(serialize(inputPayload)) };
    const buildIdentity = { ...productIdentity.buildIdentity, buildInputSetDigest: buildInputSet.digest };
    delete buildIdentity.digest;
    buildIdentity.digest = digest(serialize(buildIdentity));
    const publish = path.join(stage, "publish");
    await mkdir(publish);
    const outputs = [];
    for (const name of ["tsfg-core-ir.exe", "tsfg-core-ir.pdb"]) {
      const raw = await readFile(path.join(build, "bin", name));
      await writeFile(path.join(publish, name), raw, { flag: "wx" });
      outputs.push({ path: name, sha256: digest(raw) });
    }
    const noticeBytes = serialize(notices.bundle);
    await writeFile(path.join(publish, "source-notices.json"), noticeBytes, { flag: "wx" });
    outputs.push({ path: "source-notices.json", sha256: digest(noticeBytes) });
    outputs.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
    const manifest = { schemaVersion: "1", buildIdentity, buildInputSet, contractSetId: productIdentity.contractSetId,
      productVersion: productIdentity.productVersion, toolchainClosureDigest: buildIdentity.toolchainClosureDigest,
      outputs, capability: "formal Core0.10/wire10 and explicit complete Common Program static verification; no private wire/native/VM encoding" };
    await writeFile(path.join(publish, "artifact-manifest.json"), serialize(manifest));
    await writeFile(path.join(stage, "input-trace.json"), serialize(trace));
    await readMlirSourceIdentity({ sourceRoot, git });
    await readMlirSourceLegalFiles({ sourceRoot, git, paths: requiredLegalPaths });
    await readMlirSourceBuildLegalInputs({ sourceRoot, git, paths: consumedPaths });
    await readMlirPythonTool({ toolRoot: process.env.TSFG_MLIR_PYTHON_TOOL_ROOT });
    const currentProduct = await createIdentity(scopedRuntime, productRoot);
    if (serialize(currentProduct.buildIdentity) !== serialize(productIdentity.buildIdentity))
      throw new MlirBuildError("Declared product inputs changed during source build", "mlir-source-integrity");
    await verifyTools();
    await validatePublication(publish, manifest, serialize);
    await rename(publish, output);
    await validatePublication(output, manifest, serialize);
    return { schemaVersion: "1", status: "built", intakeComplete: false, sourceBuild: "built",
      executionMode: "local-development", isolation: "not-enforced", publishable: false,
      dirty: workspaceState.dirty, source: identity, legal, python, buildIdentity, buildInputSet,
      outputs, output, stage, trace: path.join(stage, "input-trace.json"), requiredAcceptance: "structural tests and independent clean rebuild remain required" };
  } catch (error) {
    await failureHandle.writeFile(serialize({ status: "failed", message: error.message }));
    throw error;
  } finally { await failureHandle.close(); }
}
