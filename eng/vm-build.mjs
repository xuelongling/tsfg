// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class VmBuildError extends Error {
  constructor(message, issueCode = "vm-source-build") { super(message); this.issueCode = issueCode; }
}
const runtimeSources = ["root", "bytecode", "vm", "runtime", "main", "contract"].map(name => `runtime/${name}.zig`);

async function ordinaryAncestor(directory) {
  for (let current = directory;; current = path.dirname(current)) {
    const state = await lstat(current).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
    if (state) {
      if (!state.isDirectory() || state.isSymbolicLink() || !/^E:[\\/]/i.test(await realpath(current))
          || path.relative(current, await realpath(current)) !== "")
        throw new VmBuildError("VM output must use an ordinary nonredirected E directory", "vm-output-integrity");
      return;
    }
    if (path.dirname(current) === current) throw new VmBuildError("VM output has no ordinary E ancestor", "vm-output-integrity");
  }
}

/** Build the formal Zig request consumer through the existing locked control plane. */
export async function executeVmTarget({ options, runtime, tools, productRoot, workspaceState, serialize, sha256, createIdentity, verifyTools, normalize }) {
  if (!runtime || !tools || !verifyTools) throw new VmBuildError("VM build requires the verified tool closure", "vm-tool-integrity");
  const output = path.resolve(options.get("--out"));
  if (!/^E:[\\/]/i.test(output)) throw new VmBuildError("VM output must be absolute E storage", "vm-output-integrity");
  for (const inputRoot of [productRoot, runtime.closurePath]) {
    const relative = path.relative(inputRoot, output);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)))
      throw new VmBuildError("VM output must be independent of product/tool inputs", "vm-output-integrity");
  }
  await ordinaryAncestor(path.dirname(output));
  if (await lstat(output).catch(error => { if (error.code === "ENOENT") return undefined; throw error; }))
    throw new VmBuildError("Independent VM build output already exists", "vm-output-integrity");
  const identity = await createIdentity(runtime, productRoot);
  const required = [...runtimeSources, "contracts/registry.json", "contracts/bytecode.schema.json", "eng/vm-build.mjs"];
  for (const name of required) {
    const state = await lstat(path.join(productRoot, name));
    const entry = identity.buildInputSet.entries.find(entry => entry.projectId === "tsfg" && entry.repositoryRelativePath === name);
    if (!state.isFile() || state.isSymbolicLink() || entry?.sha256 !== sha256(await readFile(path.join(productRoot, name))))
      throw new VmBuildError(`VM input absent or changed: ${name}`, "vm-source-integrity");
  }
  await mkdir(path.dirname(output), { recursive: true });
  await ordinaryAncestor(path.dirname(output));
  const stage = path.join(path.dirname(output), `.vm-${randomUUID()}`);
  await mkdir(stage);
  await writeFile(path.join(stage, "ownership.json"), serialize({ owner: "tsfg-vm-build", output, stage }));
  const product = path.join(stage, "product"), publish = path.join(stage, "publish"), temp = path.join(stage, "temp");
  for (const directory of [path.join(product, "runtime"), publish, temp]) await mkdir(directory, { recursive: true });
  for (const name of runtimeSources) {
    await copyFile(path.join(productRoot, name), path.join(product, name));
    const entry = identity.buildInputSet.entries.find(entry => entry.repositoryRelativePath === name && entry.projectId === "tsfg");
    if (sha256(await readFile(path.join(product, name))) !== entry.sha256)
      throw new VmBuildError(`VM staged input changed: ${name}`, "vm-source-integrity");
  }
  const env = { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, TZ: "UTC", LANG: "C.UTF-8",
    PATH: path.dirname(tools.zig), TEMP: temp, TMP: temp, TMPDIR: temp,
    HOME: temp, USERPROFILE: temp, APPDATA: temp, LOCALAPPDATA: temp,
    XDG_CACHE_HOME: temp, XDG_CONFIG_HOME: temp, XDG_DATA_HOME: temp,
    ZIG_LOCAL_CACHE_DIR: path.join(stage, "zig-local"), ZIG_GLOBAL_CACHE_DIR: path.join(stage, "zig-global"),
    SOURCE_DATE_EPOCH: identity.buildIdentity.source_date_epoch };
  const executable = path.join(publish, "tsfg-vm.exe");
  const args = ["build-exe", "runtime/main.zig", "--zig-lib-dir", path.join(path.dirname(tools.zig), "lib"),
    "-target", "x86_64-windows-msvc", "-mcpu", "x86_64_v2", "-ODebug", "-fno-lto",
    "--cache-dir", env.ZIG_LOCAL_CACHE_DIR, "--global-cache-dir", env.ZIG_GLOBAL_CACHE_DIR,
    `-femit-bin=${executable}`];
  const command = { executable: tools.zig, args, cwd: product, environment: env };
  await writeFile(path.join(stage, "build.command.json"), serialize(command));
  const log = await open(path.join(stage, "build.log"), "wx");
  let exit;
  try {
    exit = await new Promise((resolve, reject) => {
      const child = spawn(tools.zig, args, { cwd: product, env, windowsHide: true, stdio: ["ignore", log.fd, log.fd] });
      process.stderr.write(`VM child pid=${child.pid} log=${path.join(stage, "build.log")}\n`);
      child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } finally { await log.close(); }
  await writeFile(path.join(stage, "build.exit.json"), serialize(exit));
  if (exit.code !== 0) throw new VmBuildError(`VM source build failed (${exit.code}/${exit.signal}); see ${stage}`);
  if (!normalize) throw new VmBuildError("VM publication requires canonical Debug artifacts", "vm-artifact-integrity");
  await normalize({ executable, pdb: path.join(publish, "tsfg-vm.pdb"), stage, product, environment: env, identity, tools, runtime });
  await verifyTools();
  const current = await createIdentity(runtime, productRoot);
  if (serialize(current.buildIdentity) !== serialize(identity.buildIdentity))
    throw new VmBuildError("VM product inputs changed during build", "vm-source-integrity");
  const outputs = [];
  for (const name of ["tsfg-vm.exe", "tsfg-vm.pdb"]) {
    const bytes = await readFile(path.join(publish, name));
    outputs.push({ path: name, sha256: sha256(bytes) });
  }
  const manifest = { schemaVersion: "1", ...identity, outputs, capability: "exact signed/unsigned integer family and target isize/usize, bool CFG, nominal typed calls and explicit recursive frames with parallel phi execution, request-local R01 traps, depth and Semantic Fuel" };
  await writeFile(path.join(publish, "artifact-manifest.json"), serialize(manifest));
  for (const entry of outputs) if (sha256(await readFile(path.join(publish, entry.path))) !== entry.sha256)
    throw new VmBuildError("VM publication input changed", "vm-artifact-integrity");
  await rename(publish, output);
  return { schemaVersion: "1", status: "built", sourceBuild: "built", output, stage, ...identity, outputs,
    executionMode: "local-development", isolation: "not-enforced", publishable: false, dirty: workspaceState.dirty,
    requiredAcceptance: "formal source-to-VM, loader and request lifecycle tests remain required" };
}
