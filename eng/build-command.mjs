// SPDX-License-Identifier: MIT
import process from "node:process";
import { executeAotTarget } from "./aot-build.mjs";
import { FrontendBuildError } from "./frontend-build.mjs";
import { IntakeLedgerError } from "./intake-ledger.mjs";
import { MlirBuildError, executeMlirTarget } from "./mlir-build.mjs";
import { MlirPythonError } from "./mlir-python.mjs";
import { MlirSdkError } from "./mlir-sdk.mjs";
import { AstExecutionError } from "./typescript-ast.mjs";
import { GenerationError } from "./typescript-generation.mjs";
import { VmBuildError, executeVmTarget } from "./vm-build.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { canonicalize, digest } from "./build-data.mjs";
import { BuildFailureError, BuildPolicyError, ConfigurationError, GoExecutionFailureError, GoInputIntegrityError, GoPreparationBoundaryError, OfflineBoundaryError, SandboxBoundaryError, UndeclaredInputError, WorkspaceMismatchError } from "./build-errors.mjs";
import { executeGoSourceTarget } from "./build-go-execution.mjs";
import { createBuildIdentity } from "./build-identity.mjs";
import { buildLinux } from "./build-linux.mjs";
import { normalizeWindowsExecutable, normalizeWindowsPdb } from "./build-normalization.mjs";
import { verifyOfflineBoundary } from "./build-offline-boundary.mjs";
import { parseBuildOptions, validateSmokeOptions } from "./build-options.mjs";
import { inspectProductWorkspace } from "./build-product.mjs";
import { fail, succeed } from "./build-report.mjs";
import { executeIntakeLedgerTarget, executeUpgradeReviewTarget, runFrontendTarget, validateGoSourceOptions } from "./build-source-control.mjs";
import { verifyRuntimeClosure } from "./build-tool-closure.mjs";
import { toolchainClosureDigest, windowsToolchain } from "./build-toolchain.mjs";
import { buildWindows } from "./build-windows.mjs";

export async function runBuildCommand(arguments_, command, sourceTarget, runtimeClosure, reportPath) {
    let publication;
    try {
      const options = parseBuildOptions(arguments_);
      validateSmokeOptions(options, "build");
      if (options.has("--upgrade-plan") && options.get("--source-target") !== "upgrade-review") throw new ConfigurationError("upgrade plan requires --source-target upgrade-review");
      if (options.has("--generation") && (options.get("--source-target") !== "typescript-ast"
          || !["replay", "reuse"].includes(options.get("--generation")))) throw new ConfigurationError("generation requires typescript-ast and replay or reuse");
      if (!["intake-ledger", "typescript-ast"].includes(options.get("--source-target")) &&
          (options.has("--intake-plan") || options.has("--intake-consumption"))) {
        throw new ConfigurationError("intake options require --source-target intake-ledger");
      }
      if (options.get("--source-target") === "upgrade-review") {
        process.exitCode = await succeed(command, await executeUpgradeReviewTarget(options), reportPath, "offline");
      } else if (options.get("--source-target") === "intake-ledger") {
        process.exitCode = await succeed(command, await executeIntakeLedgerTarget(options), reportPath, "offline");
      } else if (options.get("--source-target") === "typescript-frontend") {
        process.exitCode = await succeed(command, await runFrontendTarget(options, runtimeClosure, command), reportPath, "offline");
      } else if (options.get("--source-target") === "tsfg-aot") {
        const workspaceState = inspectProductWorkspace(options, true, command);
        const result = await executeAotTarget({ options, runtime: runtimeClosure,
          tools: runtimeClosure ? windowsToolchain(runtimeClosure) : undefined,
          productRoot: workspaceState.root, workspaceState, serialize: canonicalize, sha256: digest,
          core: await readFile(options.get("--program-core"), "utf8"), coreExecutable: options.get("--core"),
          normalize: async ({ executable, pdb, stage, product, environment, identity, tools, runtime }) => {
            const guid = await normalizeWindowsPdb(pdb, tools.pdbutil,
              [[product, "."], [runtime.closurePath, ".toolchain"], [stage, ".build"],
                [/^(\s+(?:- Module|ObjFile):\s+')\.build\\zig-local\\tmp\\[0-9a-f]{16}\\tsfg-aot_zcu\.obj'$/gm,
                  "$1.build/tsfg-aot_zcu.obj'"]], stage, environment);
            await writeFile(executable, await normalizeWindowsExecutable(executable, guid,
              Number.parseInt(identity.buildIdentity.source_date_epoch, 10)));
          },
          createIdentity: (runtime, root, programCore) => createBuildIdentity(runtime, "windows-x86_64-msvc", "debug", root,
            { sourceTarget: "tsfg-aot", simdDispatch: "runtime-detected", programCore }),
          verifyTools: async () => {
            const current = await verifyRuntimeClosure(process.env.TSFG_RUNTIME_LOCK, runtimeClosure.cachePath,
              "windows-x86_64-msvc", { nativeControls: false });
            if (current.lockDigest !== runtimeClosure.lockDigest)
              throw new VmBuildError("Tool closure changed during static AOT build", "aot-tool-integrity");
          } });
        process.exitCode = await succeed(command, result, reportPath, "offline");
      } else if (options.get("--source-target") === "tsfg-vm") {
        const workspaceState = inspectProductWorkspace(options, true, command);
        const result = await executeVmTarget({ options, runtime: runtimeClosure,
          tools: runtimeClosure ? windowsToolchain(runtimeClosure) : undefined,
          productRoot: workspaceState.root, workspaceState, serialize: canonicalize, sha256: digest,
          normalize: async ({ executable, pdb, stage, product, environment, identity, tools, runtime }) => {
            const guid = await normalizeWindowsPdb(pdb, tools.pdbutil,
              [[product, "."], [runtime.closurePath, ".toolchain"], [stage, ".build"],
                // Zig's temporary object directory is random. Map only this
                // observed VM Module/ObjFile reference before deriving its GUID.
                [/^(\s+(?:- Module|ObjFile):\s+')\.build\\zig-local\\tmp\\[0-9a-f]{16}\\tsfg-vm_zcu\.obj'$/gm,
                  "$1.build/tsfg-vm_zcu.obj'"]], stage, environment);
            await writeFile(executable, await normalizeWindowsExecutable(executable, guid,
              Number.parseInt(identity.buildIdentity.source_date_epoch, 10)));
          },
          createIdentity: (runtime, root) => createBuildIdentity(runtime, "windows-x86_64-msvc", "debug", root,
            { sourceTarget: "tsfg-vm", simdDispatch: "runtime-detected" }),
          verifyTools: async () => {
            const current = await verifyRuntimeClosure(process.env.TSFG_RUNTIME_LOCK, runtimeClosure.cachePath,
              "windows-x86_64-msvc", { nativeControls: false });
            if (current.lockDigest !== runtimeClosure.lockDigest)
              throw new VmBuildError("Tool closure changed during VM build", "vm-tool-integrity");
          } });
        process.exitCode = await succeed(command, result, reportPath, "offline");
      } else if (options.get("--source-target") === "mlir-core") {
        const workspaceState = inspectProductWorkspace(options, true, command);
        const result = await executeMlirTarget({ options, runtime: runtimeClosure,
          tools: runtimeClosure ? windowsToolchain(runtimeClosure) : undefined,
          productRoot: workspaceState.root, workspaceState, serialize: canonicalize,
          verifyTools: async () => {
            const current = await verifyRuntimeClosure(process.env.TSFG_RUNTIME_LOCK, runtimeClosure.cachePath,
              "windows-x86_64-msvc", { nativeControls: false });
            if (current.lockDigest !== runtimeClosure.lockDigest)
              throw new MlirBuildError("Native tool closure changed during MLIR source build", "mlir-tool-integrity");
          },
          createIdentity: (runtime, root) => createBuildIdentity(runtime, "windows-x86_64-msvc", "debug", root,
            { sourceTarget: "mlir-core", simdDispatch: "runtime-detected",
              coreCommandRole: options.get("--core-command-role") ?? "native" }),
          scopedToolchainDigest: (runtime, python) => toolchainClosureDigest({ ...runtime.lock,
            dependencyLocks: [...runtime.lock.dependencyLocks, { projectId: "tsfg", path: "eng/mlir-python.lock.json", sha256: python.lockSha256 }] },
            [...runtime.selections, { id: "cpython-mlir-build-only", tool: { version: python.version }, artifact: {
              platform: "windows-x86_64-msvc", archiveSha256: python.archiveSha256, unpackedTreeSha256: python.treeSha256 } }]
              .sort((a, b) => Buffer.from(a.id).compare(Buffer.from(b.id))), "windows-x86_64-msvc") });
        process.exitCode = await succeed(command, result, reportPath, "offline");
      } else if (options.has("--source-target")) {
        await validateGoSourceOptions(options, runtimeClosure);
        const result = await executeGoSourceTarget(options, runtimeClosure);
        publication = result.publication;
        process.exitCode = await succeed(command, result, reportPath, "offline");
      } else {
      const workspaceState = inspectProductWorkspace(options, true, command);
      if (!runtimeClosure) throw new Error("locked runtime closure is unavailable");
      const networkCanary = await verifyOfflineBoundary();
      const result = options.get("--target") === "windows-x86_64-msvc"
        ? await buildWindows(options, runtimeClosure, workspaceState, networkCanary)
        : await buildLinux(
        options,
        runtimeClosure,
        workspaceState,
        networkCanary,
        );
      publication = result.publication;
      result.networkCanaries = {
        before: networkCanary,
        after: await verifyOfflineBoundary(),
      };
      process.exitCode = await succeed(command, result, reportPath, "offline");
      }
    } catch (error) {
      if (publication) await publication.rollback();
      const isConfigurationError = error instanceof ConfigurationError;
      const isBuildFailure = error instanceof BuildFailureError || error instanceof AstExecutionError || error instanceof GenerationError || error instanceof FrontendBuildError || error instanceof MlirBuildError || error instanceof VmBuildError;
      const isProbeFailure = error instanceof AstExecutionError && (error.probes?.status === "failed" || error.jsIsolation?.status === "failed" || error.requiredTests?.status === "failed");
      const isBuildPolicy = error instanceof BuildPolicyError;
      const isWorkspaceMismatch = error instanceof WorkspaceMismatchError || error instanceof IntakeLedgerError;
      const isOfflineBoundary = error instanceof OfflineBoundaryError;
      const isUndeclaredInput = error instanceof UndeclaredInputError;
      const isSandboxBoundary = error instanceof SandboxBoundaryError;
      const isGoIntegrity = error instanceof GoInputIntegrityError;
      const isMlirIntegrity = error instanceof MlirSdkError || (error instanceof VmBuildError &&
        ["vm-tool-integrity", "vm-source-integrity", "vm-artifact-integrity", "vm-output-integrity"].includes(error.issueCode)) || error instanceof MlirPythonError ||
        (error instanceof IntakeLedgerError && error.issueCode === "mlir-source-license") || (error instanceof MlirBuildError &&
        ["mlir-source-integrity", "mlir-tool-integrity", "mlir-artifact-integrity", "mlir-output-integrity",
          "mlir-python-integrity", "mlir-source-license"].includes(error.issueCode));
      process.exitCode = await fail(
        command,
        isConfigurationError
          ? 2
          : (isGoIntegrity || isMlirIntegrity) ? 11
          : isWorkspaceMismatch
            ? 10
            : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
              ? 12
              : isProbeFailure ? 21 : isBuildFailure ? 20 : 30,
        isConfigurationError
          ? "usage/configuration"
          : (isGoIntegrity || isMlirIntegrity) ? "lock/integrity"
          : isWorkspaceMismatch
            ? "workspace mismatch"
            : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
              ? "offline input missing"
              : isProbeFailure ? "test/compatibility failure" : isBuildFailure ? "build failure" : "internal control-plane failure",
        {
          code: isConfigurationError
            ? (error.issueCode ?? "invalid-configuration")
            : isGoIntegrity ? "go-input-integrity"
            : isMlirIntegrity ? error.issueCode
            : isWorkspaceMismatch
              ? error.issueCode
              : isOfflineBoundary
                ? "network-boundary"
                : isUndeclaredInput
                  ? "undeclared-build-input"
                  : isSandboxBoundary
                    ? "sandbox-boundary"
                    : isBuildPolicy
                      ? "forbidden-build-option"
                    : isProbeFailure ? "typescript-probe" : isBuildFailure ? ((error instanceof MlirBuildError || error instanceof VmBuildError) ? error.issueCode : "native-build") : "internal-control-plane",
          message: error.message,
          ...(sourceTarget === "typescript-ast" ? {
            generation: error.generation ?? { status: "not-run", reason: error.message },
            requiredTests: error instanceof AstExecutionError && error.requiredTests
              ? error.requiredTests : { status: "not-run", reason: error.message },
          } : {}),
          ...(sourceTarget === "typescript-ast" ? { probes: error instanceof AstExecutionError && error.probes
            ? error.probes : { status: "not-run", reason: error.message },
          jsIsolation: error instanceof AstExecutionError && error.jsIsolation
            ? error.jsIsolation : { status: "not-run", reason: error.message } } : {}),
          ...(error instanceof GoPreparationBoundaryError || error instanceof GoExecutionFailureError ? { preparation: error.preparation } : {}),
        },
        reportPath,
        "offline",
      );
    }
  }
