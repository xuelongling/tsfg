// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFrontend } from "./frontend.mjs";
import { buildHir, lowerHir } from "./hir.mjs";
import { sha256 } from "./identity.mjs";
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

/** Compile only through official checking, owned HIR and the real C++ SSA consumer. */
export async function compileProgram(input, options) {
  const analyzed = await analyzeFrontend(input, { executable: options.frontend });
  if (analyzed.status !== "ok") return analyzed;
  const highLevel = buildHir(analyzed.snapshot);
  if (highLevel.status !== "ok") return highLevel;
  try {
    const core = await verifiedConsumer(options.core, "core");
    const canonicalCore = consume(core, ["--canonicalize"], lowerHir(highLevel.hir)).toString("utf8");
    const bytecode = consume(core, ["--emit-bytecode"], canonicalCore);
    if (bytecode.length < 80 || bytecode.subarray(0, 8).toString("ascii") !== "TSFGTBC0"
        || bytecode.readUInt32LE(8) !== 1 || bytecode.readUInt32LE(44) !== bytecode.length
        || `sha256:${bytecode.subarray(12, 44).toString("hex")}` !== registry["tsfg.bytecode"].schemaHash
        || `sha256:${bytecode.subarray(48, 80).toString("hex")}` !== sha256(bytecode.subarray(80)))
      throw new TypeError("r04-producer-identity: C++ output differs from registered R04 packet");
    return { status: "ok", hir: highLevel.hir, core: canonicalCore, bytecode };
  } catch (error) {
    return { status: "tool-error", code: "r03-d-consumer", message: error.message };
  }
}

export async function runBytecode(bytes, { vm, requests = [{}], command = "--requests" }) {
  const executable = await verifiedConsumer(vm, "vm");
  const args = command === "--requests" ? [command, JSON.stringify(requests)] : [command];
  const result = consume(executable, args, bytes);
  return command === "--roundtrip" ? result : JSON.parse(result.toString("utf8"));
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
