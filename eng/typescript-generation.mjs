// SPDX-License-Identifier: MIT
// Private generation stage of the Hermetic Build Entry.
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, lstat, cp } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { astGit, astAuxiliaryInputs } from "./typescript-ast-inputs.mjs";
import { spawnSync } from "node:child_process";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export async function readGenerationLock(lockPath, lock) {
  const reference = lock.generationDependencies;
  if (!reference) return undefined;
  if (!/^[a-z0-9][a-z0-9.-]*\.json$/.test(reference.path)) throw new Error("invalid generation dependency lock path");
  const bytes = await readFile(path.join(path.dirname(path.resolve(lockPath)), reference.path))
    .catch(error => { throw new Error(`generation dependency lock unavailable: ${error.message}`); });
  if (hash(bytes) !== reference.sha256) throw new Error("generation dependency lock digest mismatch");
  if (!lock.dependencyLocks?.some(entry => entry.projectId === "tsfg"
      && entry.path === `eng/${reference.path}` && entry.sha256 === reference.sha256)) {
    throw new Error("generation dependency lock must participate in Toolchain Closure");
  }
  const declaration = JSON.parse(bytes.toString("utf8"));
  if (declaration.schemaVersion !== "1") throw new Error("unsupported generation dependency schema");
  for (const item of declaration.packages ?? []) {
    if (!/^(@[a-z0-9.-]+\/)?[a-z0-9.-]+$/.test(item.name) || !/^\d+\.\d+\.\d+$/.test(item.version)
        || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity) || item.license !== "MIT"
        || item.url !== `https://registry.npmjs.org/${item.name}/-/${item.name.split("/").at(-1)}-${item.version}.tgz`) {
      throw new Error("generation package requires exact identity, registry integrity and approved license");
    }
  }
  for (const field of ["inputs", "outputs", "testInputs"]) {
    if (!Array.isArray(declaration[field]) || !declaration[field].length
        || declaration[field].some(name => !safeRelative(name))
        || new Set(declaration[field]).size !== declaration[field].length) throw new Error(`invalid generation ${field}`);
  }
  if (!declaration.packages?.length || !declaration.sources?.length) throw new Error("generation closure requires locked packages and subsources");
  return declaration;
}

// Packages are unpacked from their verified archives, with no npm scripts,
// dependency resolution, executable shims, or implicit formatter downloads.
export async function generationPackages(cache, declaration, parseTar, online = false) {
  const files = [];
  for (const item of declaration?.packages ?? []) {
    const key = createHash("sha256").update(item.integrity).digest("hex");
    const archive = path.join(cache, "generation-packages", key, "package.tgz");
    let bytes;
    try {
      if (!(await lstat(archive)).isFile() || (await lstat(archive)).isSymbolicLink()) throw new Error("nonregular generation archive");
      bytes = await readFile(archive);
    } catch (error) {
      if (error.code !== "ENOENT" || !online) throw error;
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`generation package HTTP ${response.status}: ${item.name}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (`sha512-${createHash("sha512").update(bytes).digest("base64")}` !== item.integrity) throw new Error(`generation package integrity mismatch: ${item.name}`);
    const entries = parseTar(gunzipSync(bytes)).filter(entry => entry.type !== "5");
    const names = new Set();
    for (const entry of entries) {
      if (entry.type !== "0" || !entry.name.startsWith("package/") || !safeRelative(entry.name)
          || names.has(entry.name.toLowerCase())) throw new Error("unsafe generation package entry");
      names.add(entry.name.toLowerCase());
      files.push({ source: `npm:${item.name}@${item.version}`, path: entry.name.slice(8),
        bytes: entry.bytes, sha256: hash(entry.bytes), license: item.license,
        sourceIdentity: item.integrity, role: "build-only" });
    }
    const metadata = entries.find(entry => entry.name === "package/package.json");
    const pkg = metadata && JSON.parse(metadata.bytes.toString("utf8"));
    const legal = entries.some(entry => /^package\/LICENSE(?:\.txt|\.md)?$/i.test(entry.name))
      || (item.name === "@dprint/win32-x64" && files.some(file => file.source === `npm:dprint@${item.version}` && /^LICENSE(?:\.txt|\.md)?$/i.test(file.path)))
      || (item.name === "@unicode/unicode-15.1.0" && entries.some(entry => entry.name === "package/README.md"
        && entry.bytes.toString("utf8").includes("This module is available under the [MIT](https://mths.be/mit) license.")));
    if (pkg?.name !== item.name || pkg.version !== item.version || pkg.license !== item.license || !legal) {
      throw new Error(`generation package legal/identity missing: ${item.name}`);
    }
    const legalSource = item.name === "@dprint/win32-x64" ? `npm:dprint@${item.version}` : `npm:${item.name}@${item.version}`;
    const legalFiles = files.filter(file => file.source === legalSource
      && (/^LICENSE(?:\.txt|\.md)?$/i.test(file.path) || file.path.startsWith("metadata/LICENSES")
        || (item.name === "@unicode/unicode-15.1.0" && file.path === "README.md")))
      .map(({ source, path, sha256 }) => ({ source, path, sha256 }));
    for (const file of files.filter(file => file.source === `npm:${item.name}@${item.version}`)) {
      Object.assign(file, { legal: { declaredLicense: item.license, files: legalFiles } });
    }
    if (online) {
      await mkdir(path.dirname(archive), { recursive: true });
      try { await writeFile(archive, bytes, { flag: "wx" }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
  }
  return files;
}

function safeRelative(name) {
  return typeof name === "string" && !/[<>:"\\|?*]/.test(name)
    && name.split("/").every(part => part && part !== "." && part !== ".." && !/[. ]$/.test(part)
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}

export async function generationSources(sourceRoot, declaration, gitExecutable) {
  const files = [];
  for (const source of declaration?.sources ?? []) {
    if (!/^[a-f0-9]{40}$/.test(source.commit) || !safeRelative(source.mount)
        || source.license !== "Apache-2.0" || source.canonicalUrl !== "https://github.com/microsoft/TypeScript") throw new Error("invalid generation subsource identity");
    const tree = new Map();
    for (const line of astGit(gitExecutable, sourceRoot, ["ls-tree", "-r", "-z", source.commit]).toString("utf8").split("\0")) {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      if (match) tree.set(match[3], { mode: match[1], oid: match[2] });
    }
    for (const input of source.files) {
      if (!safeRelative(input.path) || !/^sha256:[a-f0-9]{64}$/.test(input.sha256) || !tree.has(input.path)) throw new Error("unlocked generation source input");
      const bytes = astGit(gitExecutable, sourceRoot, ["cat-file", "blob", tree.get(input.path).oid]);
      if (hash(bytes) !== input.sha256) throw new Error(`generation source identity mismatch: ${input.path}`);
      files.push({ ...input, source: source.canonicalUrl, sourceIdentity: source.commit,
        mount: `${source.mount}/${input.path}`, normalizedMode: tree.get(input.path).mode,
        license: source.license, legal: { path: "LICENSE.txt", sha256: source.files.find(file => file.path === "LICENSE.txt")?.sha256 },
        role: "build-only", bytes });
    }
    if (!["LICENSE.txt", "CopyrightNotice.txt"].every(name => source.files.some(input => input.path === name || input.path.endsWith(`/${name}`)))) throw new Error("generation subsource legal inputs missing");
  }
  return files;
}

export class GenerationError extends Error { generation; }

export async function replayGeneration(intake, plan, serialize) {
  const context = intake.generation;
  if (!context) return { status: "not-run", reason: "No locked generation closure was supplied." };
  const { declaration, packages, sources } = context;
  const root = path.join(plan.workRoot, "generation");
  const moduleRoot = path.join(root, "source");
  await mkdir(root);
  await cp(plan.moduleRoot, moduleRoot, { recursive: true, errorOnExist: true, force: false });
  const inputs = [];
  const intakeFiles = [];
  const checked = new Map();
  for (const name of declaration.inputs) {
    if (!safeRelative(name)) throw new Error("unsafe generator input");
    const entry = intake.ledger.files.find(file => file.path === `tsc/${name}`);
    if (!entry) throw new Error(`generator input missing from intake ledger: ${name}`);
    const bytes = await readFile(path.join(intake.request.workspaceRoot, "typescript/tsc", name));
    if (hash(bytes) !== entry.sha256) throw new Error(`generator input changed: ${name}`);
    await mkdir(path.dirname(path.join(moduleRoot, name)), { recursive: true });
    await writeFile(path.join(moduleRoot, name), bytes);
    inputs.push({ path: name, sha256: entry.sha256, role: "build-only" });
    intakeFiles.push({ source: "TypeScript.git", sourceIdentity: intake.ledger.sources[0].forkOid,
      path: `tsc/${name}`, sha256: entry.sha256, role: "build-only", license: "Apache-2.0",
      legal: { path: "tsc/LICENSE", sha256: intake.ledger.files.find(file => file.path === "tsc/LICENSE").sha256 } });
    checked.set(path.join(moduleRoot, name), entry.sha256);
  }
  for (const input of sources) {
    const location = path.join(moduleRoot, input.mount);
    await mkdir(path.dirname(location), { recursive: true });
    await writeFile(location, input.bytes, { flag: "wx" });
    inputs.push({ path: input.mount, sha256: input.sha256, sourceIdentity: input.sourceIdentity, role: input.role });
    const { bytes, ...record } = input;
    intakeFiles.push(record);
    checked.set(location, input.sha256);
  }
  for (const file of packages) {
    const packageName = file.source.slice(4, file.source.lastIndexOf("@"));
    const destination = path.join(moduleRoot, "node_modules", packageName, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.bytes, { flag: "wx" });
    const { bytes, ...record } = file;
    intakeFiles.push(record);
    checked.set(destination, file.sha256);
  }
  const formatter = path.join(moduleRoot, "node_modules/@dprint/win32-x64/dprint.exe");
  const config = path.join(root, "dprint.json");
  const formatting = { indentWidth: 4, lineWidth: 1000, newLineKind: "auto", useTabs: false,
    gofumpt: { langVersion: "go1.26", modulePath: "github.com/microsoft/typescript-go" },
    plugins: [path.join(moduleRoot, "node_modules/@jakebailey/dprint-plugin-gofumpt/plugin.wasm")] };
  await writeFile(config, serialize(formatting));
  checked.set(config, hash(serialize(formatting)));
  const environment = { ...plan.environment, TSFG_DPRINT: formatter, TSFG_DPRINT_CONFIG: config,
    DPRINT_CACHE_DIR: path.join(root, "dprint-cache"), PATH: path.dirname(plan.go) };
  const commands = [];
  const invoke = (executable, args, cwd = moduleRoot) => {
    const child = spawnSync(executable, args, { cwd, env: environment, encoding: "utf8", windowsHide: true,
      timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    commands.push({ executable, arguments: args, cwd, exitCode: child.status, stdout: child.stdout, stderr: child.stderr });
    if (child.error || child.status !== 0) throw new Error(`generator failed: ${child.error?.message ?? child.stderr}`);
    return child.stdout;
  };
  const node = path.join(plan.inputRoot, "node/node.exe");
  const before = [];
  for (const name of declaration.outputs) before.push({ path: name, sha256: hash(await readFile(path.join(plan.moduleRoot, name))) });
  const result = { schemaVersion: "1", status: "failed", mode: "replayed", inputs, commands,
    outputs: [], differences: [], declarationSha256: context.sha256,
    sourceOid: intake.ledger.sources[0].forkOid, toolchainClosure: context.toolchainClosure };
  try {
    const consumedOutputs = [];
    for (const entry of intake.ledger.files) {
      const name = entry.path.slice(4);
      if (/^internal\/(bundled\/libs\/.*\.d\.ts|diagnostics\/loc\/.*\.json\.gz)$/.test(name)
          || (entry.role === "compiler-payload" && name.endsWith(".go") && /^\/\/ Code generated .*DO NOT EDIT[.;]?$/m.test(await readFile(path.join(moduleRoot, name), "utf8")))) {
        consumedOutputs.push(name);
      }
    }
    if (serialize(consumedOutputs.sort()) !== serialize([...declaration.outputs].sort())) throw new Error("generation output declaration differs from actual consumed generated files");
    const audit = await astAuxiliaryInputs(intake, plan, moduleRoot, [
      { cwd: path.join(moduleRoot, "internal/diagnostics"), targets: ["generate.go"] },
      { cwd: path.join(moduleRoot, "internal/bundled"), targets: ["generate.go"] },
      { targets: ["golang.org/x/tools/cmd/stringer", "./internal/ast", "./internal/checker", "./internal/core", "./internal/diagnostics", "./internal/vfs/vfsmatch"] },
    ]);
    invoke(node, ["--disable-warning=ExperimentalWarning", "_scripts/generate-go-ast.ts"]);
    invoke(node, ["--disable-warning=ExperimentalWarning", "internal/stringutil/_scripts/generate-unicode-data.mts"]);
    invoke(plan.go, ["run", "-mod=readonly", "generate.go", "-diagnostics", "diagnostics_generated.go", "-loc", "loc_generated.go", "-locdir", "loc"], path.join(moduleRoot, "internal/diagnostics"));
    invoke(plan.go, ["run", "-mod=readonly", "generate.go"], path.join(moduleRoot, "internal/bundled"));
    for (const name of declaration.outputs.filter(name => name.includes("stringer_generated"))) {
      const original = (await readFile(path.join(plan.moduleRoot, name), "utf8")).split("\n")[0];
      const match = /^\/\/ Code generated by "stringer ([^"]+)"; DO NOT EDIT\.$/.exec(original);
      if (!match) throw new Error(`unrecognized locked stringer invocation: ${name}`);
      const args = match[1].split(" ");
      if (args.some(arg => !/^-(type|trimprefix|output)=[A-Za-z0-9_.]+$/.test(arg))) throw new Error("unsafe stringer arguments");
      invoke(plan.go, ["tool", "golang.org/x/tools/cmd/stringer", ...args], path.dirname(path.join(moduleRoot, name)));
    }
    invoke(formatter, ["fmt", "--config", config, ...declaration.outputs.filter(name => name.endsWith(".go")).map(name => path.join(moduleRoot, name))]);
    for (const input of before) {
      const sha256 = hash(await readFile(path.join(moduleRoot, input.path)));
      result.outputs.push({ ...input, sha256 });
      if (sha256 !== input.sha256) result.differences.push({ path: input.path, committed: input.sha256, regenerated: sha256 });
    }
    if (result.differences.length) throw new Error("unexplained generated source differences");
    await audit.verify();
    for (const [file, expected] of checked) if (hash(await readFile(file)) !== expected) throw new Error(`generation input mutated: ${file}`);
    Object.assign(result, { intakeLedger: { ...audit.ledger, files: [...audit.ledger.files, ...intakeFiles] },
      derivedInputs: [{ path: "dprint.json", sha256: checked.get(config), producer: "locked controller recipe" }],
      excluded: [{ scope: "bundled embedding tables and unconsumed library declarations", reason: "Generator produces these incidentally; the actual typed consumer uses only the three declared libs and no embedding tables." }] });
    result.status = "passed";
    await writeFile(path.join(plan.workRoot, "generation.json"), serialize(result));
    return result;
  } catch (cause) {
    await writeFile(path.join(plan.workRoot, "generation.json"), serialize({ ...result, message: cause.message }));
    const error = new GenerationError(cause.message);
    error.generation = { ...result, message: cause.message };
    throw error;
  }
}
