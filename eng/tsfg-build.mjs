#!/usr/bin/env node
// SPDX-License-Identifier: MIT
export { prepareGoSourceAcceptance } from "./build-go-execution.mjs";
import process from "node:process";
import path from "node:path";
import { prepareVmBootstrapWithControls } from "./vm-bootstrap.mjs";
import { VmBuildError, executeVmTarget } from "./vm-build.mjs";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBuildCommand } from "./build-command.mjs";
import { canonicalize, digest } from "./build-data.mjs";
import { runPackageCommand, runReproCommand, runSourceReproCommand, runTestCommand } from "./build-delivery-commands.mjs";
import { ConfigurationError } from "./build-errors.mjs";
import { createBuildIdentity } from "./build-identity.mjs";
import { enterWindowsOfflineBoundary, shouldEnterWindowsOfflineBoundary } from "./build-offline-boundary.mjs";
import { parseBuildOptions, parseOptions, parseReportPath, validateMlirConfiguration, validateSmokeOptions, validateVmConfiguration } from "./build-options.mjs";
import { inspectProductWorkspace } from "./build-product.mjs";
import { fail, succeed } from "./build-report.mjs";
import { isSourceDestinationOnE } from "./build-source-control.mjs";
import { prefetch, verifyRuntimeClosure } from "./build-tool-closure.mjs";
import { windowsToolchain } from "./build-toolchain.mjs";
import { verifyWorkspace } from "./build-workspace.mjs";

// Internal bootstrap seam: retain the normal verified runtime/workspace/BIS
// producers. This creates no positive host witness and adds no CLI selector.
export async function prepareVmBootstrap(request) {
  return prepareVmBootstrapWithControls(request,{ConfigurationError,VmBuildError,isGoDestinationOnE:isSourceDestinationOnE,validateSmokeOptions,
    verifyRuntimeClosure,windowsToolchain,inspectProductWorkspace,executeVmTarget,canonicalize,digest,createBuildIdentity});
}

async function runCommandLine() {
  const arguments_ = process.argv.slice(2);
  const command = arguments_[0] ?? "";
  const sourceTarget = arguments_.includes("--source-target") ? arguments_[arguments_.indexOf("--source-target") + 1] : undefined;
  const typedProbeTest = command === "test" && sourceTarget === "typescript-ast";
  const frontendTest = command === "test" && sourceTarget === "typescript-frontend";
  const sourceReproCheck = command === "repro-check" && sourceTarget === "typescript-ast";
  const requestedReportPath = parseReportPath(arguments_);
  const invalidGoReport = arguments_.includes("--source-target") && requestedReportPath
    && !await isSourceDestinationOnE(requestedReportPath);
  const sourceReproOutput = sourceReproCheck && arguments_.includes("--out")
    ? arguments_[arguments_.indexOf("--out") + 1] : undefined;
  const sourceReportRelative = sourceReproOutput && requestedReportPath
    ? path.relative(path.resolve(sourceReproOutput), path.resolve(requestedReportPath)) : undefined;
  const overlappingSourceReport = sourceReportRelative !== undefined && sourceReportRelative !== ".."
    && !sourceReportRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(sourceReportRelative);
  const reportPath = invalidGoReport || overlappingSourceReport ? undefined : requestedReportPath;
  // Reject unsupported MLIR requests before inspecting runtime/tool inputs or
  // dispatching any Windows boundary. Report destination safety remains first.
  if (command === "build" && ["mlir-core", "tsfg-vm", "tsfg-aot"].includes(sourceTarget)) {
    try {
      if (sourceTarget === "mlir-core") validateMlirConfiguration(parseBuildOptions(arguments_));
      else validateVmConfiguration(parseBuildOptions(arguments_));
    } catch (error) {
      if (!(error instanceof ConfigurationError)) throw error;
      process.exitCode = await fail(command, 2, "usage/configuration", {
        code: error.issueCode, message: error.message,
      }, reportPath, "offline");
      return;
    }
  }
  const windowsBoundaryBootstrapError = process.env.TSFG_WINDOWS_BOUNDARY_ERROR;
  let runtimeIntegrityError;
  let runtimeClosure;
  if (
    !windowsBoundaryBootstrapError &&
    (
      process.env.TSFG_RUNTIME_LOCK ||
      process.env.TSFG_RUNTIME_CACHE ||
      process.env.TSFG_RUNTIME_PLATFORM
    )
  ) {
    try {
      if (
        !process.env.TSFG_RUNTIME_LOCK ||
        !process.env.TSFG_RUNTIME_CACHE ||
        !process.env.TSFG_RUNTIME_PLATFORM
      ) {
        throw new Error("incomplete runtime closure identity");
      }
      runtimeClosure = await verifyRuntimeClosure(
        process.env.TSFG_RUNTIME_LOCK,
        process.env.TSFG_RUNTIME_CACHE,
        process.env.TSFG_RUNTIME_PLATFORM,
        { nativeControls: !((command === "build" || typedProbeTest || frontendTest || sourceReproCheck) && arguments_.includes("--dev") &&
            ["typescript-dependencies", "typescript-ast", "typescript-frontend", "intake-ledger", "upgrade-review", "mlir-core", "tsfg-vm", "tsfg-aot"].includes(arguments_[arguments_.indexOf("--source-target") + 1])) },
      );
    } catch (error) {
      runtimeIntegrityError = error;
    }
  }

  let delegatedWindowsStatus;
  if (windowsBoundaryBootstrapError) {
    delegatedWindowsStatus = await fail(
      command,
      12,
      "offline input missing",
      {
        code: "sandbox-boundary",
        message: windowsBoundaryBootstrapError,
      },
      reportPath,
      "offline",
    );
  } else if (
    !runtimeIntegrityError &&
    shouldEnterWindowsOfflineBoundary(arguments_, runtimeClosure)
  ) {
    delegatedWindowsStatus = await enterWindowsOfflineBoundary(
      arguments_,
      runtimeClosure,
      reportPath,
    );
  }

  if (invalidGoReport) {
    process.exitCode = await fail(command, 2, "usage/configuration", {
      code: "invalid-configuration", message: "source target requires an absolute E: report destination",
    }, undefined, "offline");
  } else if (overlappingSourceReport) {
    process.exitCode = await fail(command, 2, "usage/configuration", {
      code: "invalid-configuration", message: "source repro-check report must remain outside its comparison output",
    }, undefined, "offline");
  } else if (delegatedWindowsStatus !== undefined) {
    process.exitCode = delegatedWindowsStatus;
  } else if (runtimeIntegrityError) {
    process.exitCode = await fail(
      command,
      11,
      "lock/integrity",
      { code: "runtime-closure", message: runtimeIntegrityError.message },
      reportPath,
      "offline",
    );
  } else if (command === "prefetch") {
    try {
      const options = parseOptions(
        arguments_,
        new Set(["--lock", "--cache", "--platform", "--report", "--dev"]),
        new Set(["--dev"]),
      );
      const result = await prefetch(options);
      process.exitCode = await succeed(
        command,
        result,
        reportPath,
        "online",
      );
    } catch (error) {
      const isConfigurationError = error instanceof ConfigurationError;
      process.exitCode = await fail(
        command,
        isConfigurationError ? 2 : 11,
        isConfigurationError ? "usage/configuration" : "lock/integrity",
        {
          code: isConfigurationError
            ? (error.issueCode ?? "invalid-configuration")
            : "prefetch-integrity",
          message: error.message,
        },
        reportPath,
        "online",
      );
    }
  } else if (command === "verify-workspace") {
    try {
      const options = parseOptions(
        arguments_,
        new Set([
          "--workspace",
          "--manifest-url",
          "--manifest-revision",
          "--manifest",
          "--report",
        ]),
      );
      const result = await verifyWorkspace(options);
      process.exitCode = await succeed(
        command,
        result,
        reportPath,
        "offline",
      );
    } catch (error) {
      const isConfigurationError = error instanceof ConfigurationError;
      process.exitCode = await fail(
        command,
        isConfigurationError ? 2 : 10,
        isConfigurationError ? "usage/configuration" : "workspace mismatch",
        {
          code: isConfigurationError
            ? (error.issueCode ?? "invalid-configuration")
            : (error.issueCode ?? "workspace-state"),
          message: error.message,
        },
        reportPath,
        "offline",
      );
    }
  } else if (command === "build" || typedProbeTest || frontendTest) {
    await runBuildCommand(arguments_, command, sourceTarget, runtimeClosure, reportPath);
  } else if (command === "test") {
    await runTestCommand(arguments_, command, runtimeClosure, reportPath);
  } else if (command === "package") {
    await runPackageCommand(arguments_, command, runtimeClosure, reportPath);
  } else if (command === "repro-check" && sourceTarget === "typescript-ast") {
    await runSourceReproCommand(arguments_, command, runtimeClosure, reportPath);
  } else if (command === "repro-check") {
    await runReproCommand(arguments_, command, runtimeClosure, reportPath);
  } else {
    process.exitCode = await fail(
      command,
      2,
      "usage/configuration",
      {
        code: "unsupported-operation",
        message: `unsupported operation: ${command || "<missing>"}`,
      },
      reportPath,
      "disabled",
    );
  }

}

// Resolve both paths so a direct invocation through a symlink still reaches the
// existing workspace and launcher validation rather than silently doing nothing.
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  await runCommandLine();
}
