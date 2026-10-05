// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFrontend } from "./frontend.mjs";
import { buildHir, lowerHir } from "./hir.mjs";
import { canonical, sha256 } from "./identity.mjs";
import registry from "../contracts/registry.json" with { type: "json" };

const productRoot = fileURLToPath(new URL("../", import.meta.url));

async function verifiedConsumer(executable, role) {
  if (!executable) throw new TypeError(`r03-tool-${role}: formal executable is required`);
  const manifest = JSON.parse(await readFile(path.join(path.dirname(executable), "artifact-manifest.json"), "utf8"));
  const output = manifest.outputs?.find(output => output.path === path.basename(executable));
  if (output?.sha256 !== sha256(await readFile(executable)))
    throw new TypeError(`r03-tool-${role}: executable differs from its source-build manifest`);
  if (manifest.buildIdentity?.target !== "windows-x86_64-msvc"
      || manifest.buildIdentity?.profile !== "debug")
    throw new TypeError(`r03-tool-${role}: unsupported target/profile identity`);
  const required = role === "core" ? ["compiler/core-ir/main.cpp", "compiler/core-ir/CMakeLists.txt"]
    : ["runtime/root.zig", "runtime/bytecode.zig", "runtime/vm.zig", "runtime/runtime.zig", "runtime/main.zig", "runtime/contract.zig"];
  required.push("contracts/registry.json", "contracts/bytecode.schema.json");
  for (const name of required) {
    const entry = manifest.buildInputSet?.entries?.find(entry => entry.projectId === "tsfg" && entry.repositoryRelativePath === name);
    if (entry?.sha256 !== sha256(await readFile(path.join(productRoot, name))))
      throw new TypeError(`r03-tool-${role}: compiled input differs from current ${name}`);
  }
  return executable;
}

function consume(executable, args, input) {
  const child = spawnSync(executable, args, { input, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 300000 });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new TypeError(child.stderr.toString("utf8").trim() || `consumer exited ${child.status}`);
  return child.stdout;
}

/** Officially checked source to owned HIR; no native execution is needed to view it. */
export async function compileHir(input, options) {
  const analyzed = await analyzeFrontend(input, { executable: options.frontend });
  if (analyzed.status !== "ok") return analyzed;
  return buildHir(analyzed.snapshot);
}

/** Compile only through official checking, owned HIR and the real C++ SSA consumer. */
export async function compileProgram(input, options) {
  const highLevel = await compileHir(input, options);
  return highLevel.status === "ok" ? produceBytecode(highLevel.hir, options) : highLevel;
}

async function compileSnapshot(snapshot, options) {
  const highLevel = buildHir(snapshot);
  if (highLevel.status !== "ok") return highLevel;
  return produceBytecode(highLevel.hir, options);
}

async function produceBytecode(hir, options) {
  try {
    const core = await verifiedConsumer(options.core, "core");
    const canonicalCore = consume(core, ["--canonicalize"], lowerHir(hir)).toString("utf8");
    const bytecode = consume(core, ["--emit-bytecode"], canonicalCore);
    if (bytecode.length < 80 || bytecode.subarray(0, 8).toString("ascii") !== "TSFGTBC0"
        || bytecode.readUInt32LE(8) !== 2 || bytecode.readUInt32LE(44) !== bytecode.length
        || `sha256:${bytecode.subarray(12, 44).toString("hex")}` !== registry["tsfg.bytecode"].schemaHash
        || `sha256:${bytecode.subarray(48, 80).toString("hex")}` !== sha256(bytecode.subarray(80)))
      throw new TypeError("r04-producer-identity: C++ output differs from registered R04 packet");
    return { status: "ok", hir, core: canonicalCore, bytecode };
  } catch (error) {
    return { status: "tool-error", code: "r03-d-consumer", message: error.message };
  }
}

const sessionInputs = ["compiler/frontend.mjs", "compiler/hir.mjs", "compiler/identity.mjs",
  "compiler/pipeline.mjs", "contracts/registry.json", "contracts/hir.schema.json", "contracts/bytecode.schema.json"];
async function sessionFingerprint() {
  const inputs = await Promise.all(sessionInputs.map(async name => [name, sha256(await readFile(path.join(productRoot, name)))]));
  return sha256(canonical(inputs));
}

/** Incremental owned lowering; official frontend checking still runs on every input. */
export function createCompilerSession(options) {
  const settings = { frontend: options.frontend, core: options.core };
  let inputs, previous;
  const counts = { analyses: 0, lowerings: 0, reuses: 0 };
  return {
    statistics: () => ({ ...counts }),
    async compile(input) {
      counts.analyses++;
      const analyzed = await analyzeFrontend(input, { executable: settings.frontend });
      if (analyzed.status !== "ok") { previous = undefined; return analyzed; }
      try {
        const fingerprint = await sessionFingerprint();
        if (inputs !== undefined && inputs !== fingerprint)
          throw new TypeError("r03-compiler-input: compiler inputs changed during session");
        inputs = fingerprint;
        const core = await verifiedConsumer(settings.core, "core");
        const key = sha256(canonical({ snapshotId: analyzed.snapshot.snapshotId,
          compiler: fingerprint, producer: sha256(await readFile(core)) }));
        if (previous?.key === key) {
          counts.reuses++;
          return { ...previous.result, bytecode: Buffer.from(previous.result.bytecode) };
        }
        counts.lowerings++;
        const result = await compileSnapshot(analyzed.snapshot, settings);
        previous = result.status === "ok" ? { key, result: { ...result, bytecode: Buffer.from(result.bytecode) } } : undefined;
        return result;
      } catch (error) {
        previous = undefined;
        return { status: "tool-error", code: "r03-d-consumer", message: error.message };
      }
    },
  };
}

export async function runBytecode(bytes, { vm, requests = [{}], command = "--requests" }) {
  const executable = await verifiedConsumer(vm, "vm");
  const args = command === "--requests" ? [command, JSON.stringify(requests)] : [command];
  const result = consume(executable, args, bytes);
  return command === "--roundtrip" ? result : JSON.parse(result.toString("utf8"));
}

/** Multiple verified modules share one formal Zig Runtime request host. */
export async function runRequestSequence(bytecodes, { vm, requests = undefined }) {
  if (!Array.isArray(bytecodes) || bytecodes.length < 1 || bytecodes.length > 128)
    throw new TypeError("r05-request-sequence: expected 1..128 matching modules and requests");
  const requestFrames = requests === undefined ? bytecodes.map(() => ({})) : requests;
  if (!Array.isArray(requestFrames) || requestFrames.length !== bytecodes.length)
    throw new TypeError("r05-request-sequence: expected 1..128 matching modules and requests");
  let totalBytes = 12;
  for (const bytes of bytecodes) {
    if (!Buffer.isBuffer(bytes)) throw new TypeError("r05-request-sequence: expected bytecode buffers");
    totalBytes += 4 + bytes.length;
    if (totalBytes > 1048576) throw new TypeError("r05-request-sequence: frame exceeds size limit");
  }
  const header = Buffer.alloc(12);
  header.write("TSFGREQ1", "ascii");
  header.writeUInt32LE(bytecodes.length, 8);
  const frames = bytecodes.flatMap(bytes => {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    return [length, bytes];
  });
  const input = Buffer.concat([header, ...frames]);
  const executable = await verifiedConsumer(vm, "vm");
  return JSON.parse(consume(executable, ["--request-sequence", JSON.stringify(requestFrames)], input).toString("utf8"));
}

export async function sourceInput(source, { sourcePath = "/src/main.ts" } = {}) {
  const declarations = await readFile(new URL("./minimal-scalars-v2.d.ts", import.meta.url), "utf8");
  return { sourceRoot: "/src", rootFile: sourcePath,
    files: [{ path: sourcePath, content: source }, { path: "/src/minimal-scalars-v2.d.ts", content: declarations }],
    declarations: { version: "minimal-scalars-v2", paths: ["/src/minimal-scalars-v2.d.ts"] },
    config: { strict: true, noEmit: true, allowJs: false } };
}

export async function compileAndRun(source, options) {
  const compiled = await compileProgram(await sourceInput(source, options), options);
  if (compiled.status !== "ok") return compiled;
  try { return { ...compiled, requests: await runBytecode(compiled.bytecode, options) }; }
  catch (error) { return { status: "tool-error", code: "r03-d-runtime", message: error.message }; }
}
