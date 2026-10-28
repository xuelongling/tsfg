// SPDX-License-Identifier: MIT
import process from "node:process";
import path from "node:path";
import { SourceReproError, reproduceTypeScript } from "./typescript-repro.mjs";
import { readFile } from "node:fs/promises";
import { testCompatibility } from "./build-compatibility.mjs";
import { canonicalize, pathExists } from "./build-data.mjs";
import { CompatibilityFailureError, ConfigurationError, OfflineBoundaryError, PackageFailureError, ReproducibilityMismatchError, SandboxBoundaryError, TestFailureError, UndeclaredInputError, WorkspaceMismatchError } from "./build-errors.mjs";
import { verifyOfflineBoundary } from "./build-offline-boundary.mjs";
import { parseOptions, validateCompatibilityOptions, validatePackageRuntimeOptions, validateSmokeOptions } from "./build-options.mjs";
import { packageLinux, packageWindows } from "./build-package.mjs";
import { buildEnvironment } from "./build-process.mjs";
import { inspectProductWorkspace } from "./build-product.mjs";
import { fail, succeed } from "./build-report.mjs";
import { parseReproJson } from "./build-repro-producer.mjs";
import { reproCheck, validateReproOptions } from "./build-repro.mjs";
import { testPackageRuntime, testSmoke } from "./build-smoke.mjs";
import { currentSourceReproIdentity, isSourceDestinationOnE } from "./build-source-control.mjs";
import { verifyWorkspace } from "./build-workspace.mjs";

export async function runTestCommand(arguments_, command, runtimeClosure, reportPath) {
    try {
      const options = parseOptions(
        arguments_,
        new Set([
          "--dev", "--target", "--profile", "--simd-dispatch", "--cpu-fixture", "--workspace", "--out", "--package", "--report",
          "--compatibility-baseline", "--compatibility-candidate",
        ]),
        new Set(["--dev"]),
      );
      const compatibilityMode = options.has("--compatibility-baseline") ||
        options.has("--compatibility-candidate");
      const packageRuntimeMode = options.has("--package");
      if (compatibilityMode && packageRuntimeMode) {
        throw new ConfigurationError("package runtime and compatibility test inputs are mutually exclusive");
      }
      if (compatibilityMode) validateCompatibilityOptions(options);
      else if (packageRuntimeMode) validatePackageRuntimeOptions(options);
      else validateSmokeOptions(options, "test");
      const workspaceState = inspectProductWorkspace(options, !packageRuntimeMode, command);
      const networkCanary = await verifyOfflineBoundary();
      let result;
      if (compatibilityMode) {
        result = await testCompatibility(options, workspaceState, networkCanary);
      } else if (packageRuntimeMode) {
        result = await testPackageRuntime(options, runtimeClosure, workspaceState, networkCanary);
      } else {
        if (!runtimeClosure) throw new Error("locked runtime closure is unavailable");
        result = await testSmoke(options, runtimeClosure, workspaceState, networkCanary);
      }
      process.exitCode = await succeed(command, result, reportPath, "offline");
    } catch (error) {
      const isConfigurationError = error instanceof ConfigurationError;
      const isTestFailure = error instanceof TestFailureError;
      const isCompatibilityFailure = error instanceof CompatibilityFailureError;
      const isWorkspaceMismatch = error instanceof WorkspaceMismatchError;
      const isOfflineBoundary = error instanceof OfflineBoundaryError;
      const isUndeclaredInput = error instanceof UndeclaredInputError;
      const isSandboxBoundary = error instanceof SandboxBoundaryError;
      process.exitCode = await fail(
        command,
        isConfigurationError
          ? 2
          : isWorkspaceMismatch
            ? 10
            : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
              ? 12
              : isTestFailure ? 21 : 30,
        isConfigurationError
          ? "usage/configuration"
          : isWorkspaceMismatch
            ? "workspace mismatch"
            : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
              ? "offline input missing"
            : isTestFailure ? "test/compatibility failure" : "internal control-plane failure",
        {
          code: isConfigurationError
            ? (error.issueCode ?? "invalid-configuration")
            : isWorkspaceMismatch
              ? error.issueCode
              : isOfflineBoundary
                ? "network-boundary"
                : isUndeclaredInput
                  ? "undeclared-test-input"
                  : isSandboxBoundary
                    ? "sandbox-boundary"
                    : isCompatibilityFailure
                      ? error.issueCode
                      : isTestFailure ? error.issueCode : "internal-control-plane",
          ...(isCompatibilityFailure ? { compatibility: error.compatibility } : {}),
          message: error.message,
        },
        reportPath,
        "offline",
      );
    }
  }

export async function runPackageCommand(arguments_, command, runtimeClosure, reportPath) {
    let publication;
    try {
      const options = parseOptions(
        arguments_,
        new Set([
          "--dev", "--target", "--profile", "--simd-dispatch", "--workspace", "--input", "--out", "--report",
        ]),
        new Set(["--dev"]),
      );
      validateSmokeOptions(options, "package", true);
      const workspaceState = inspectProductWorkspace(options, false, command);
      if (!runtimeClosure) throw new PackageFailureError("locked runtime closure is unavailable");
      const networkCanary = await verifyOfflineBoundary();
      const result = options.get("--target") === "windows-x86_64-msvc"
        ? await packageWindows(options, runtimeClosure, workspaceState, networkCanary)
        : await packageLinux(options, runtimeClosure, workspaceState, networkCanary);
      publication = result.publication;
      process.exitCode = await succeed(command, result, reportPath, "offline");
    } catch (error) {
      if (publication) await publication.rollback();
      const isConfigurationError = error instanceof ConfigurationError;
      const isWorkspaceMismatch = error instanceof WorkspaceMismatchError;
      const isOfflineBoundary = error instanceof OfflineBoundaryError;
      const isUndeclaredInput = error instanceof UndeclaredInputError;
      const isSandboxBoundary = error instanceof SandboxBoundaryError;
      process.exitCode = await fail(
        command,
        isConfigurationError
          ? 2
          : isWorkspaceMismatch
            ? 10
            : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary) ? 12 : 22,
        isConfigurationError
          ? "usage/configuration"
          : isWorkspaceMismatch
            ? "workspace mismatch"
            : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
              ? "offline input missing"
              : "package failure",
        {
          code: isConfigurationError
            ? (error.issueCode ?? "invalid-configuration")
            : isWorkspaceMismatch
              ? error.issueCode
              : isOfflineBoundary
                ? "network-boundary"
                : isUndeclaredInput
                  ? "undeclared-package-input"
                  : isSandboxBoundary ? "sandbox-boundary" : "artifact-package",
          message: error.message,
        },
        reportPath,
        "offline",
      );
    }
  }

export async function runReproCommand(arguments_, command, runtimeClosure, reportPath) {
    try {
      const options = parseOptions(
        arguments_,
        new Set(["--target", "--profile", "--producer-a", "--producer-b", "--workspace", "--report"]),
      );
      validateReproOptions(options);
      if (!runtimeClosure) {
        throw new ReproducibilityMismatchError(
          "runtime-closure",
          "repro-check requires a verified runtime closure",
          "build-identity-mismatch",
        );
      }
      const workspaceState = inspectProductWorkspace(options, false, command);
      const networkCanary = await verifyOfflineBoundary();
      const result = await reproCheck(options, runtimeClosure, workspaceState, networkCanary);
      process.exitCode = await succeed(command, result, reportPath, "offline");
    } catch (error) {
      const isConfigurationError = error instanceof ConfigurationError;
      const isOfflineBoundary = error instanceof OfflineBoundaryError;
      const isWorkspaceMismatch = error instanceof WorkspaceMismatchError;
      process.exitCode = await fail(
        command,
        isConfigurationError ? 2 : isWorkspaceMismatch ? 10 : isOfflineBoundary ? 12 : 23,
        isConfigurationError
          ? "usage/configuration"
          : isWorkspaceMismatch
            ? "workspace mismatch"
            : isOfflineBoundary ? "offline input missing" : "reproducibility mismatch",
        {
          code: isConfigurationError
            ? (error.issueCode ?? "invalid-configuration")
            : isWorkspaceMismatch
              ? error.issueCode
              : isOfflineBoundary ? "network-boundary" : (error.issueCode ?? "reproducibility-set"),
          ...(error instanceof ReproducibilityMismatchError
            ? {
                member: error.member,
                ...(error.leftSha256 ? { leftSha256: error.leftSha256 } : {}),
                ...(error.offset !== undefined ? { offset: error.offset } : {}),
                ...(error.rightSha256 ? { rightSha256: error.rightSha256 } : {}),
              }
            : {}),
          message: error.message,
        },
        reportPath,
        "offline",
      );
    }
  }

export async function runSourceReproCommand(arguments_, command, runtimeClosure, reportPath) {
    let publication;
    try {
      const options = parseOptions(arguments_, new Set(["--dev", "--source-target", "--target", "--profile",
        "--workspace-a", "--workspace-b", "--out", "--report", "--manifest-revision", "--manifest", "--cache",
        "--producer-a", "--producer-b", "--intake-review"]), new Set(["--dev"]));
      let intakeReview;
      if (options.has("--intake-review")) {
        intakeReview = parseReproJson(await readFile(options.get("--intake-review")), "intake review", false);
        if (intakeReview?.schemaVersion !== "1" || intakeReview.evidenceKind !== "real-source") {
          throw new ConfigurationError("intake review requires real-source evidence; governance fixtures cannot certify intake");
        }
        if (!intakeReview.binding || !Array.isArray(intakeReview.coverage) || !Array.isArray(intakeReview.records)) {
          throw new ConfigurationError("intake review requires exact binding and dependency coverage");
        }
      }
      const first = options.get("--workspace-a"), second = options.get("--workspace-b");
      if (!first || !second || path.resolve(first).toLowerCase() === path.resolve(second).toLowerCase()) {
        throw new ConfigurationError("source repro-check requires two distinct verified workspace paths");
      }
      if (options.has("--out") && await pathExists(options.get("--out"))) throw new ConfigurationError("source repro-check output already exists");
      if (options.has("--producer-a") !== options.has("--producer-b")) throw new ConfigurationError("source repro-check requires both producer paths or neither");
      for (const name of ["--producer-a", "--producer-b"]) {
        if (options.has(name) && !await isSourceDestinationOnE(options.get(name))) throw new ConfigurationError("source producer evidence requires an actual absolute E: path");
      }
      const verify = async index => {
        try {
          return await verifyWorkspace(new Map([["--workspace", [first, second][index]],
            ["--manifest-url", "https://github.com/xuelongling/manifests.git"],
            ["--manifest-revision", options.get("--manifest-revision")], ["--manifest", options.get("--manifest")]]));
        } catch (error) {
          if (error instanceof ConfigurationError) throw error;
          throw new WorkspaceMismatchError("source-repro-workspace", `workspace verification failed: ${error.message}`);
        }
      };
      const workspaces = [await verify(0), await verify(1)];
      if (canonicalize(workspaces[0]) !== canonicalize(workspaces[1])) throw new WorkspaceMismatchError("source-repro-identity", "source workspaces must contain the same exact integration");
      if (!options.has("--dev") || options.get("--target") !== "windows-x86_64-msvc" || options.get("--profile") !== "debug") {
        throw new ConfigurationError("source repro-check requires --dev and the Windows debug source target");
      }
      for (const destination of [first, second, options.get("--out"), options.get("--cache")]) {
        if (!destination || !await isSourceDestinationOnE(destination)) throw new ConfigurationError("source repro-check requires actual absolute E: workspace, output and cache paths");
      }
      const currentIdentities = new Map();
      const currentIdentity = async productRoot => {
        if (!currentIdentities.has(productRoot)) currentIdentities.set(productRoot,
          await currentSourceReproIdentity(productRoot, options.get("--cache")));
        return currentIdentities.get(productRoot);
      };
      const result = await reproduceTypeScript({ options, workspaces,
        serialize: canonicalize, parseJson: parseReproJson, environment: buildEnvironment, verify, currentIdentity, intakeReview });
      publication = result.publication;
      process.exitCode = await succeed(command, result, reportPath, "offline");
    } catch (error) {
      if (publication) await publication.rollback();
      const workspaceMismatch = error instanceof WorkspaceMismatchError;
      const code = workspaceMismatch ? 10 : error instanceof SourceReproError ? error.exitCode : error instanceof ConfigurationError ? 2 : 23;
      const categories = { 2: "usage/configuration", 10: "workspace mismatch", 11: "lock/integrity", 12: "offline input missing",
        20: "build failure", 21: "test/compatibility failure", 23: "reproducibility mismatch", 30: "internal control-plane failure" };
      process.exitCode = await fail(command, code, categories[code] ?? categories[30], {
        code: workspaceMismatch ? error.issueCode : "source-reproducibility", message: error.message,
        ...(error instanceof SourceReproError && error.evidence !== undefined ? { evidence: error.evidence } : {}),
      }, reportPath, "offline");
    }
  }
