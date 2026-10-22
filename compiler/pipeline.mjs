// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFrontend } from "./frontend.mjs";
import { compilePackageHir } from "./generic-package-frontend.mjs";
import { lowerGenericHir } from "./generic-hir.mjs";
export { compilePackageHir };
import { buildHir, lowerFormalHir } from "./hir.mjs";
import { canonical, sha256 } from "./identity.mjs";
import registry from "../contracts/registry.json" with { type: "json" };
import { verifyCounterHostContract } from "../eng/host-semantic-contract.mjs";
import { coreIrInputs } from "../eng/core-ir-inputs.mjs";
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };
import {verifyProducedPacket} from './producer-packet.mjs';

const productRoot = fileURLToPath(new URL("../", import.meta.url));

/** Verify the actual source-built consumer admission boundary without executing it. */
export async function verifiedConsumer(executable, role) {
  if (!["core", "core-native", "vm", "aot"].includes(role)) throw new TypeError("r03-tool-role: unsupported consumer");
  if (!executable) throw new TypeError(`r03-tool-${role}: formal executable is required`);
  const manifest = JSON.parse(await readFile(path.join(path.dirname(executable), "artifact-manifest.json"), "utf8"));
  const output = manifest.outputs?.find(output => output.path === path.basename(executable));
  if (output?.sha256 !== sha256(await readFile(executable)))
    throw new TypeError(`r03-tool-${role}: executable differs from its source-build manifest`);
  if (manifest.buildIdentity?.target !== "windows-x86_64-msvc"
      || manifest.buildIdentity?.profile !== "debug")
    throw new TypeError(`r03-tool-${role}: unsupported target/profile identity`);
  if (["core", "core-native"].includes(role) && !["static", "native"].includes(manifest.coreCommandRole))
    throw new TypeError("r03-tool-core: explicit compiler command role is required");
  if (["core", "core-native"].includes(role) &&
      manifest.coreCommandRole !== (manifest.buildIdentity.options?.coreCommandRole ?? "native"))
    throw new TypeError("r03-tool-core: compiler command role differs from build identity");
  if (role === "core-native" && manifest.coreCommandRole !== "native")
    throw new TypeError("r03-tool-core-native: full native compiler command role is required");
  const required = ["core", "core-native"].includes(role) ? [...coreIrInputs, "eng/core-ir-inputs.mjs", "eng/mlir-command.mjs"]
    : ["runtime/root.zig", "runtime/bytecode.zig", "runtime/bytecode_model.zig", "runtime/bytecode_decode.zig", "runtime/bytecode_view.zig", "runtime/module_format.zig", "runtime/module-plan.zig", "runtime/aot-instance.zig", "runtime/module.zig", "runtime/request.zig", "runtime/clock.zig", "runtime/host_counter.zig", "runtime/host_counter.c", "runtime/host_counter_bridge.c", "runtime/admitted-entry.c", "eng/runtime-entry.mjs", "runtime/vm.zig", "runtime/runtime.zig", "runtime/managed-heap.zig", "runtime/string-codec.zig", "runtime/main.zig", "runtime/contract.zig", "eng/host-counter.mjs", "eng/host-counter-binary.mjs", "eng/host-cost-source.lock.json", "eng/vm-build.mjs", "runtime/execution_frame.zig", "runtime/scalar.zig", "runtime/conversions.zig", "runtime/host-bindings.zig", "runtime/host-semantic-contract.zig",
      "runtime/floating-environment.zig", "runtime/outcome-writer.zig", "runtime/string-arguments.zig", "runtime/string-budget.zig", "runtime/string-frame.zig", "runtime/string-instructions.zig", "runtime/string-output.zig", "runtime/string-value.zig", "runtime/vm-execution.zig", "runtime/vm-instance.zig", "runtime/runtime-state.zig", "runtime/request-values.zig", "runtime/request-json.zig", "runtime/module-outcome-writer.zig", "eng/host-counter-objects.mjs",
      "eng/output-storage.mjs", "eng/host-semantic-contract.mjs", "contracts/host-counter-semantic-v1.json"];
  required.push("contracts/registry.json", "contracts/bytecode.schema.json");
  if (role === "aot") required.push("runtime/aot-main.zig", "runtime/aot-program.zig", "runtime/aot-program.h",
    "runtime/aot-request.zig", "runtime/aot-events.zig", "runtime/request-json.zig", "runtime/module-outcome-writer.zig", "eng/aot-build.mjs");
  for (const name of required) {
    const entry = manifest.buildInputSet?.entries?.find(entry => entry.projectId === "tsfg" && entry.repositoryRelativePath === name);
    if (entry?.sha256 !== sha256(await readFile(path.join(productRoot, name))))
      throw new TypeError(`r03-tool-${role}: compiled input differs from current ${name}`);
  }
  if(role==="vm") {
    const contractOutput=manifest.outputs?.find(output=>output.path==="host-semantic-contract.json");
    const contractBytes=await readFile(path.join(path.dirname(executable),"host-semantic-contract.json"));
    if(contractOutput?.sha256!==sha256(contractBytes))throw new TypeError("r03-tool-vm: semantic contract differs from formal build");
    verifyCounterHostContract(contractBytes,manifest);
    const entry=manifest.outputs?.find(output=>output.path==="host-cost-summary.json");
    const bytes=await readFile(path.join(path.dirname(executable),"host-cost-summary.json"));
    if(entry?.sha256!==sha256(bytes))throw new TypeError("r03-tool-vm: host summary differs from formal build");
    const summary=JSON.parse(bytes.toString("utf8"));
    if(summary.summaryVersion!=="tsfg-host-cost-v1"||summary.linkedRuntimeHash!==output.sha256)
      throw new TypeError("r03-tool-vm: host summary belongs to a different Runtime");
  }
  if (role === "aot") {
    if (manifest.executionBackend !== "aot-v4" || manifest.buildIdentity.options?.sourceTarget !== "tsfg-aot")
      throw new TypeError("r03-tool-aot: not a statically compiled ordinary program");
    const artifact = async name => {
      const bytes = await readFile(path.join(path.dirname(executable), name));
      if (manifest.outputs?.find(output => output.path === name)?.sha256 !== sha256(bytes))
        throw new TypeError(`r03-tool-aot: changed ${name}`);
      return bytes;
    };
    const wire = await artifact("program.tbc");
    verifyProducedPacket(wire);
    const programCore=sha256(await artifact("program.mlir"));
    if (manifest.program?.core !== programCore || manifest.buildIdentity.options.programCore !== programCore
        || manifest.program?.object !== sha256(await artifact("program.obj"))
        || manifest.program?.bytecode !== sha256(wire)
        || manifest.program?.compiledTableId !== sha256(Buffer.concat([Buffer.from("tsfg.aot-compiled-module.v4\0"), wire])))
      throw new TypeError("r03-tool-aot: compiled program identity mismatch");
    verifyCounterHostContract(await artifact("host-semantic-contract.json"), manifest);
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

/** Candidate package route; Source and formal Core manifest admission remain independent. */
export async function compilePackage(packageBytes, roots, options) {
  const highLevel = await compilePackageHir(packageBytes, roots, options);
  if (highLevel.status !== "ok") return highLevel;
  // Only an instantiated owned-HIR result can enter concrete Core lowering.
  if (!("hir" in highLevel)) return { status: "tool-error", requestId: highLevel.requestId,
    code: "r03-d-consumer", message: "r03-package-result: instantiation returned no owned HIR" };
  return { ...highLevel, ...await produceBytecode(highLevel.hir, options, lowerGenericHir) };
}

async function compileSnapshot(snapshot, options) {
  const highLevel = buildHir(snapshot);
  if (highLevel.status !== "ok") return /** @type {typeof highLevel & {bytecode?:undefined}} */ (highLevel);
  return produceBytecode(highLevel.hir, options);
}

async function produceBytecode(hir, options, lower = value => lowerFormalHir(value, options.factsContext)) {
  try {
    const core = await verifiedConsumer(options.core, "core");
    const canonicalCore = consume(core, [options.optimize ? "--optimize" : "--canonicalize"], lower(hir)).toString("utf8");
    const bytecode = consume(core, ["--emit-bytecode"], canonicalCore);
    verifyProducedPacket(bytecode);
    return { status: "ok", hir, core: canonicalCore, bytecode };
  } catch (error) {
    return { status: "tool-error", code: "r03-d-consumer", message: error.message };
  }
}

/** Compile a complete persisted owned HIR through the same formal producer.
 * The String facts context is verified by lowering; this does not admit Source.
 */
export async function compileOwnedHir(hir, options) {
  return produceBytecode(hir, options);
}

/** Produce one whole statically linked program object from complete owned HIR.
 * Existing Source admission is independent; no frontend lock is relaxed here.
 */
export async function compileOwnedStaticProgram(hir, options) {
  const result = await produceBytecode(hir, options);
  if (result.status !== "ok") return result;
  try {
    const executable = await verifiedConsumer(options.nativeCore ?? options.core, "core-native");
    const object = consume(executable, ["--emit-program-object"], result.core);
    // The generated metadata and instance use exactly this original packet;
    // neither a projection nor a re-signed surrogate program enters the link.
    const compiledIdentity = sha256(Buffer.concat([Buffer.from("tsfg.aot-compiled-module.v4\0"), result.bytecode]));
    return { ...result, object, compiledIdentity };
  } catch (error) {
    return { status: "tool-error", code: "r03-d-consumer", message: error.message };
  }
}

/** Official source checking uses its existing exact producer admission. */
export async function compileStaticProgram(input, options) {
  const highLevel = await compileHir(input, options);
  return highLevel.status === "ok" ? compileOwnedStaticProgram(highLevel.hir, options) : highLevel;
}

const sessionInputs = ["compiler/conversions.mjs", "compiler/presence.mjs", "compiler/scalar-hir-body.mjs", "compiler/scalar-hir-module.mjs", "compiler/scalar-hir-expression.mjs", "compiler/scalar-hir-state.mjs", "compiler/scalar-source.mjs", "compiler/scalar-state-emitter.mjs", "compiler/minimal-conversions-v5.d.ts", "contracts/conversion-entries.json", "compiler/generic-package-frontend.mjs", "compiler/generic-package.mjs", "compiler/generic-package-shape.mjs",
  "compiler/generic-package-io.mjs", "compiler/generic-package-io-shape.mjs", "compiler/generic-instance.mjs",
  "compiler/generic-hir.mjs", "compiler/generic-json.mjs", "compiler/generic-json-budget.mjs", "compiler/frontend.mjs", "compiler/frontend-response.mjs", "compiler/frontend-execution.mjs", "compiler/hir.mjs", "compiler/identity.mjs", "compiler/scalar-core-emitter.mjs",
  "compiler/module-facts.mjs", "compiler/module-hir-source.mjs", "compiler/module-hir.mjs", "compiler/modules.mjs",
  "compiler/pipeline.mjs", "compiler/producer-packet.mjs", "compiler/core-ssa-emitter.mjs", "compiler/string-formal-emitter.mjs", "compiler/float.mjs", "contracts/registry.json", "contracts/hir.schema.json", "contracts/bytecode.schema.json"];
async function sessionFingerprint() {
  const inputs = await Promise.all(sessionInputs.map(async name => [name, sha256(await readFile(path.join(productRoot, name)))]));
  return sha256(canonical(inputs));
}

/** Incremental owned lowering; official frontend checking still runs on every input. */
export function createCompilerSession(options) {
  const settings = { frontend: options.frontend, core: options.core, optimize: options.optimize === true };
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
  const args = command === "--requests" || command === "--module-requests" ? [command, JSON.stringify(requests)] : [command];
  const result = consume(executable, args, bytes);
  return command === "--roundtrip" ? result : JSON.parse(result.toString("utf8"));
}

/** The executable is a source-built static program, never a request loader. */
export async function runStaticProgram({ executable, requests = [{}], persistent = false }) {
  const admitted = await verifiedConsumer(executable, "aot");
  return JSON.parse(consume(admitted, [persistent ? "--module-requests" : "--requests", JSON.stringify(requests)], undefined).toString("utf8"));
}

/** Evaluate a serial batch against one persistent module instance. */
export function runModuleRequests(bytes, {vm,requests=[{}]}) {
  return runBytecode(bytes,{vm,requests,command:"--module-requests"});
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

export async function sourceInput(source, { sourcePath = "/src/main.ts", declarationVersion = "minimal-floats-v4" } = {}) {
  if (!["minimal-integers-v3", "minimal-floats-v4", "minimal-conversions-v5"].includes(declarationVersion)) throw new TypeError("unsupported source declaration version");
  const declarations = await readFile(new URL(`./${declarationVersion}.d.ts`, import.meta.url), "utf8");
  return { sourceRoot: "/src", rootFile: sourcePath,
    files: [{ path: sourcePath, content: source }, { path: `/src/${declarationVersion}.d.ts`, content: declarations }],
    declarations: { version: declarationVersion, paths: [`/src/${declarationVersion}.d.ts`] },
    target: { ...bytecodeSchema.target, pointerBits: "64" },
    config: { strict: true, noEmit: true, allowJs: false } };
}

export async function compileAndRun(source, options) {
  const compiled = await compileProgram(await sourceInput(source, options), options);
  if (compiled.status !== "ok") return compiled;
  try { return { ...compiled, requests: await runBytecode(compiled.bytecode, options) }; }
  catch (error) { return { status: "tool-error", code: "r03-d-runtime", message: error.message }; }
}
