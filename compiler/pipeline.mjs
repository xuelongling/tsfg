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
import {readSystemQueryFacts} from './system-query-facts.mjs';
import {emitSystemQueryCore} from './system-query-core.mjs';
import {readSystemQueryEffects} from './system-query-effects.mjs';
import {readSystemQueryTmeta} from './system-query-tmeta.mjs';
import {commonProgramCore} from './common-program-core.mjs';
import {isCommonProgramContext} from './common-program-hir.mjs';
import {familyOf} from './module-callable-common.mjs';
import {readCommonBorrowProof} from './common-program-borrow-proof.mjs';
import { verifyCounterHostContract } from "../eng/host-semantic-contract.mjs";
import {verifyCoreIrInputs} from "../eng/core-ir-inputs.mjs";
import {runtimeSources} from "../eng/vm-build.mjs";
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };
import {verifyProducedPacket} from './producer-packet.mjs';
import {verifyCommonProducedPacket} from './common-program-packet.mjs';

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
  const coreRole = role === "core" || role === "core-native";
  const commandRole = manifest.buildIdentity.options?.coreCommandRole;
  if (coreRole && !["static", "native"].includes(commandRole))
    throw new TypeError("r03-tool-core: explicit compiler command role is required");
  if (coreRole && manifest.coreCommandRole !== undefined && manifest.coreCommandRole !== commandRole)
    throw new TypeError("r03-tool-core: compiler command role differs from build identity");
  if (role === "core-native" && commandRole !== "native")
    throw new TypeError("r03-tool-core-native: full native compiler command role is required");
  if (coreRole) await verifyCoreIrInputs(manifest, productRoot, commandRole);
  const required = coreRole
    ? ["eng/mlir-command.mjs"]
    : [...runtimeSources, "eng/runtime-entry.mjs", "eng/host-counter.mjs", "eng/host-counter-binary.mjs",
      "eng/host-cost-source.lock.json", "eng/vm-build.mjs", "eng/host-counter-objects.mjs",
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

/** Compile complete owned Query input through the independent static consumer.
 * @param {Uint8Array} bytes @param {unknown} context
 * @param {{core:string,optimize?:boolean,effects?:boolean,cpuBatch?:boolean,cpuLLVM?:'dialect'|'ir',tmeta?:boolean}} options
 */
export async function compileSystemQuery(bytes,context,options){
  const facts=readSystemQueryFacts(bytes,context);
  const executable=await verifiedConsumer(options.core,'core');
  const core=consume(executable,['--system-query',options.optimize?'--optimize':'--canonicalize'],emitSystemQueryCore(facts,context)).toString('utf8');
  const effects=options.effects?readSystemQueryEffects(consume(executable,['--system-query','--effects'],core),facts,context):undefined;
  const checkedBatch=options.cpuBatch||options.tmeta?consume(executable,['--system-query','--cpu-batch'],core).toString('utf8'):core;
  const cpuBatch=options.cpuBatch?checkedBatch:undefined;
  const cpuLLVM=options.cpuLLVM?consume(executable,['--system-query',options.cpuLLVM==='ir'?'--llvm-ir':'--cpu-llvm'],cpuBatch??core).toString('utf8'):undefined;
  const tmeta=options.tmeta?readSystemQueryTmeta(consume(executable,['--system-query','--tmeta'],checkedBatch),facts,context,checkedBatch):undefined;
  return {status:'ok',facts,core,effects,...(cpuBatch===undefined?{}:{cpuBatch}),...(cpuLLVM===undefined?{}:{cpuLLVM}),...(tmeta===undefined?{}:{tmeta})};
}

/** Existing complete Common HIR/fixed bounds to the independent static proof.
 * @param {{core:string}} options
 */
export async function compileCommonBorrowProof(hir,publication,request,options){
  const product=commonProgramCore(hir,publication,request,{borrowProof:true}),executable=await verifiedConsumer(options.core,'core');
  const core=consume(executable,['--common-program','--canonicalize'],product.text).toString('utf8');
  const proof=readCommonBorrowProof(consume(executable,['--common-program','--borrow-proof'],core),product.hir,publication,request);
  return {status:'ok',hir:product.hir,core,proof};
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

async function produceBytecode(hir, options, lower = value => lowerFormalHir(value, options.factsContext, options.callPublicationContext)) {
  try {
    const core = await verifiedConsumer(options.core, "core");
    const lowered = lower(hir), common = isCommonProgramContext(options.factsContext) || familyOf(hir) === 'tsfg.program-hir-candidate', prefix = common ? ['--common-program'] : [];
    const canonicalCore = consume(core, [...prefix, options.optimize ? "--optimize" : "--canonicalize"], lowered).toString("utf8");
    const bytecode = consume(core, [...prefix, "--emit-bytecode"], canonicalCore);
    (common ? verifyCommonProducedPacket : verifyProducedPacket)(bytecode);
    return { status: "ok", hir, core: canonicalCore, bytecode };
  } catch (error) {
    return { status: "tool-error", code: "r03-d-consumer", message: error.message };
  }
}

/** Compile a complete persisted owned HIR through the same formal producer.
 * Facts and fixed publication context are verified by lowering; Source admission is independent.
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

// Pin the actual static module/data closure, including declaration profiles.
// compiler-session-inputs.test.mjs checks this explicit table independently.
const sessionInputs = ["compiler/core-ssa-graph.mjs", "compiler/scalar-operators.mjs", "compiler/conversions.mjs", "compiler/presence.mjs", "compiler/scalar-hir-body.mjs", "compiler/scalar-hir-module.mjs", "compiler/scalar-hir-expression.mjs", "compiler/scalar-hir-state.mjs", "compiler/scalar-source.mjs", "compiler/scalar-state-emitter.mjs", "compiler/minimal-conversions-v5.d.ts", "contracts/conversion-entries.json", "compiler/generic-package-frontend.mjs", "compiler/generic-package.mjs", "compiler/generic-package-shape.mjs",
  "compiler/generic-package-io.mjs", "compiler/generic-package-io-shape.mjs", "compiler/generic-instance.mjs",
  "compiler/generic-hir.mjs", "compiler/generic-json.mjs", "compiler/generic-json-budget.mjs", "compiler/frontend.mjs", "compiler/frontend-response.mjs", "compiler/frontend-execution.mjs", "compiler/hir.mjs", "compiler/identity.mjs", "compiler/scalar-core-emitter.mjs",
  "compiler/module-facts.mjs", "compiler/module-hir-source.mjs", "compiler/module-hir.mjs", "compiler/modules.mjs",
  "compiler/pipeline.mjs", "compiler/producer-packet.mjs", "compiler/core-ssa-emitter.mjs", "compiler/string-formal-emitter.mjs", "compiler/float.mjs", "contracts/registry.json", "contracts/hir.schema.json", "contracts/bytecode.schema.json",
  "compiler/array-analysis-types.mjs", "compiler/array-call-context.mjs", "compiler/array-call-graph.mjs", "compiler/array-call-model.mjs",
  "compiler/array-call-publication.mjs", "compiler/array-owner-trace.mjs", "compiler/array-parallel.mjs", "compiler/array-readspan-model.mjs",
  "compiler/array-span-contexts.mjs", "compiler/array-span-planes.mjs", "compiler/array-span-storage.mjs", "compiler/call-effects.mjs",
  "compiler/callable-target-domain.mjs", "compiler/closure-call-effects.mjs", "compiler/closure-common.mjs", "compiler/closure-core-emitter.mjs",
  "compiler/closure-core-initialization.mjs", "compiler/closure-core-model.mjs", "compiler/closure-environment-lowering.mjs", "compiler/closure-environments.mjs",
  "compiler/closure-facts.mjs", "compiler/closure-frontend.mjs", "compiler/closure-hir.mjs", "compiler/closure-source-grammar.mjs",
  "compiler/closure-target-domain.mjs", "compiler/closure-target-solver.mjs", "compiler/closure-targets.mjs", "compiler/common-program-abstract.mjs",
  "compiler/common-program-actual-context.mjs", "compiler/common-program-actual.mjs", "compiler/common-program-analysis.mjs", "compiler/common-program-body.mjs",
  "compiler/common-program-borrow-events.mjs", "compiler/common-program-borrow-observations.mjs", "compiler/common-program-borrow-proof.mjs", "compiler/common-program-borrows.mjs",
  "compiler/common-program-budget.mjs", "compiler/common-program-carriers.mjs", "compiler/common-program-common.mjs", "compiler/common-program-construction-plans.mjs",
  "compiler/common-program-constructor-return-origins.mjs", "compiler/common-program-control.mjs", "compiler/common-program-core.mjs", "compiler/common-program-declarations.mjs",
  "compiler/common-program-diagnostics.mjs", "compiler/common-program-effects.mjs", "compiler/common-program-entry.mjs", "compiler/common-program-environments.mjs",
  "compiler/common-program-facts.mjs", "compiler/common-program-fixed-storage.mjs", "compiler/common-program-hir.mjs", "compiler/common-program-hosts.mjs",
  "compiler/common-program-identities.mjs", "compiler/common-program-implicit-construction-plans.mjs", "compiler/common-program-internal-constructions.mjs", "compiler/common-program-lexical.mjs",
  "compiler/common-program-methods.mjs", "compiler/common-program-native-language.mjs", "compiler/common-program-observation-contexts.mjs", "compiler/common-program-packet.mjs",
  "compiler/common-program-physical.mjs", "compiler/common-program-plan.mjs", "compiler/common-program-print.mjs", "compiler/common-program-publication-scope.mjs",
  "compiler/common-program-receiver-actual.mjs", "compiler/common-program-regions.mjs", "compiler/common-program-return-origin-domain.mjs", "compiler/common-program-return-origin-graph.mjs",
  "compiler/common-program-return-origin-inclusion.mjs", "compiler/common-program-return-origin-receivers.mjs", "compiler/common-program-return-origin-scope.mjs", "compiler/common-program-return-origin-source.mjs",
  "compiler/common-program-return-origins.mjs", "compiler/common-program-source.mjs", "compiler/common-program-targets.mjs", "compiler/common-program-values.mjs",
  "compiler/exception-aggregate-expressions.mjs", "compiler/exception-aggregate-facts.mjs", "compiler/exception-aggregate-input.mjs", "compiler/exception-callable.mjs",
  "compiler/exception-closures.mjs", "compiler/exception-common.mjs", "compiler/exception-core-common.mjs", "compiler/exception-expressions.mjs",
  "compiler/exception-facts.mjs", "compiler/exception-frontend.mjs", "compiler/exception-function-values.mjs", "compiler/exception-hir-aggregates.mjs",
  "compiler/exception-hir-common.mjs", "compiler/exception-hir-functions.mjs", "compiler/exception-hir-identity.mjs", "compiler/exception-hir-model.mjs",
  "compiler/exception-hir-modules.mjs", "compiler/exception-hir-regions.mjs", "compiler/exception-hir.mjs", "compiler/exception-identifiers.mjs",
  "compiler/exception-input.mjs", "compiler/exception-module-expressions.mjs", "compiler/exception-module-facts.mjs", "compiler/exception-module-input.mjs",
  "compiler/exception-presence.mjs", "compiler/exception-scope.mjs", "compiler/exception-source-grammar.mjs", "compiler/exception-statements.mjs",
  "compiler/exception-types.mjs", "compiler/finite-actual-domains.mjs", "compiler/finite-array-call-contexts.mjs", "compiler/finite-array-reaching.mjs",
  "compiler/finite-callables.mjs", "compiler/finite-core-emitter.mjs", "compiler/finite-field-effects.mjs", "compiler/finite-field-phases.mjs",
  "compiler/finite-field-reaching.mjs", "compiler/finite-field-return-graphs.mjs", "compiler/finite-numeric-use.mjs", "compiler/finite-presence.mjs",
  "compiler/formal-closure-core.mjs", "compiler/formal-exception-control.mjs", "compiler/formal-exception-core.mjs", "compiler/formal-exception-model.mjs",
  "compiler/formal-exception-values.mjs", "compiler/hir-wire.mjs", "compiler/kernel-access.mjs", "compiler/kernel-core-emitter.mjs",
  "compiler/lexical-environment-layouts.mjs", "compiler/member-presence.mjs", "compiler/minimal-bool-v1.d.ts", "compiler/minimal-floats-v4.d.ts",
  "compiler/minimal-integers-v3.d.ts", "compiler/minimal-scalars-v2.d.ts", "compiler/mlir-strings.mjs", "compiler/module-callable-common.mjs",
  "compiler/module-callable-core.mjs", "compiler/module-callable-facts.mjs", "compiler/module-callable-hir.mjs", "compiler/module-callable-model.mjs",
  "compiler/module-callable-publication.mjs", "compiler/module-callable-source.mjs", "compiler/module-callable-targets.mjs", "compiler/nullable-common.mjs",
  "compiler/nullable-core-emitter.mjs", "compiler/nullable-facts.mjs", "compiler/nullable-frontend.mjs", "compiler/nullable-hir.mjs",
  "compiler/nullable-typeof.mjs", "compiler/optional-property-hir.mjs", "compiler/optional-property-profile.mjs", "compiler/reference-callable.mjs",
  "compiler/reference-common.mjs", "compiler/reference-core-emitter.mjs", "compiler/reference-core-model.mjs", "compiler/reference-facts-body.mjs",
  "compiler/reference-facts-shape.mjs", "compiler/reference-facts.mjs", "compiler/reference-forwarding.mjs", "compiler/reference-hierarchy.mjs",
  "compiler/reference-hir.mjs", "compiler/reference-methods.mjs", "compiler/reference-provenance.mjs", "compiler/reference-relations.mjs",
  "compiler/reference-scalar-policy.mjs", "compiler/reference-types.mjs", "compiler/string-core-emitter.mjs", "compiler/string-facts-model.mjs",
  "compiler/string-facts-v2-model.mjs", "compiler/string-facts-v2.mjs", "compiler/string-facts.mjs", "compiler/string-hir-model.mjs",
  "compiler/string-hir.mjs", "compiler/system-query-core.mjs", "compiler/system-query-effects.mjs", "compiler/system-query-expressions.mjs",
  "compiler/system-query-facts.mjs", "compiler/system-query-scalars.mjs", "compiler/system-query-source-bindings.mjs", "compiler/system-query-statements.mjs",
  "compiler/system-query-tmeta.mjs", "compiler/typed-array-body.mjs", "compiler/typed-array-construction.mjs", "compiler/typed-array-density.mjs",
  "compiler/typed-array-facts.mjs", "compiler/typed-array-hir.mjs", "compiler/typed-array-literals.mjs", "compiler/typed-array-project.mjs",
  "compiler/typed-array-relations.mjs", "compiler/typed-array-representation.mjs", "compiler/typed-array-schema.mjs", "compiler/typed-array-type-graphs.mjs",
  "compiler/typed-array-types.mjs", "compiler/typed-array-witnesses.mjs", "compiler/typed-layouts.mjs", "compiler/typed-reference-authority.mjs",
  "compiler/typed-reference-views.mjs", "contracts/array-calls-candidate.schema.json", "contracts/array-generic-facts.schema.json", "contracts/common-program-bytecode-development.schema.json",
  "contracts/common-program-core-development.json", "contracts/common-program-hir-v2.schema.json", "contracts/common-program-hir-v3.schema.json", "contracts/common-program-source-v2.schema.json",
  "contracts/common-program-source-v3.schema.json", "contracts/common-program-wire-development.json", "contracts/component-layout-development.json", "contracts/core-closure-candidate.schema.json",
  "contracts/core-closure-publication-candidate.schema.json", "contracts/core-kernel-global-candidate.schema.json", "contracts/core-nullable-candidate.schema.json", "contracts/core-reference-candidate.schema.json",
  "contracts/core-string-candidate.schema.json", "contracts/exception-hir-v2.schema.json", "contracts/exception-owned-bridge-candidate.schema.json", "contracts/finite-core-development.json",
  "contracts/formal-closure-core-development.json", "contracts/formal-exception-core-development.json", "contracts/host-counter-semantic-v1.json", "contracts/module-callable-candidate.schema.json",
  "contracts/nullable-groups-candidate.schema.json", "contracts/nullable-owned-bridge-candidate.schema.json", "contracts/nullable-presence-capture-candidate.schema.json", "contracts/nullable-presence-hir-candidate.schema.json",
  "contracts/nullable-typeof-undefined-candidate.schema.json", "contracts/optional-property-facts-v1.schema.json", "contracts/optional-property-hir.schema.json", "contracts/query-tmeta-development.json",
  "contracts/string-facts-candidate.schema.json", "contracts/string-facts-v2-candidate.schema.json", "contracts/system-query-facts.schema.json", "contracts/typed-array-hir.schema.json",
  "eng/core-ir-inputs.mjs", "eng/frontend-source.lock.json", "eng/host-counter-binary.mjs", "eng/host-counter-objects.mjs",
  "eng/host-counter.mjs", "eng/host-semantic-contract.mjs", "eng/output-storage.mjs", "eng/runtime-entry.mjs",
  "eng/vm-build.mjs"
];
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

export async function sourceInput(source, { sourcePath = "/src/main.ts", declarationVersion = "minimal-conversions-v5" } = {}) {
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
