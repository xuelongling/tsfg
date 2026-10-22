// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { BuildFailureError, OfflineBoundaryError, PackageFailureError, SANDBOX_NETWORK_BOUNDARY_STATUS, SANDBOX_SETUP_FAILURE_STATUS, SANDBOX_UNDECLARED_INPUT_STATUS, SandboxBoundaryError, UndeclaredInputError } from "./build-errors.mjs";

export function buildEnvironment(temporaryRoot, toolDirectories) {
  const environment = {
    HOME: temporaryRoot,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: toolDirectories.join(path.delimiter),
    TMPDIR: temporaryRoot,
    TZ: "UTC",
  };
  if (process.platform === "win32") {
    environment.APPDATA = temporaryRoot;
    environment.ComSpec = process.env.ComSpec;
    environment.LOCALAPPDATA = temporaryRoot;
    environment.SystemRoot = process.env.SystemRoot;
    environment.TEMP = temporaryRoot;
    environment.TMP = temporaryRoot;
    environment.USERPROFILE = temporaryRoot;
  }
  return environment;
}

export function throwSandboxBoundaryFailure(detail, operation, status) {
  if (status === SANDBOX_NETWORK_BOUNDARY_STATUS) {
    throw new OfflineBoundaryError(`sandbox network isolation failed during ${operation}: ${detail}`);
  }
  if (status === SANDBOX_UNDECLARED_INPUT_STATUS) {
    throw new UndeclaredInputError(`sandbox denied an undeclared ${operation} input: ${detail}`);
  }
  if (status === SANDBOX_SETUP_FAILURE_STATUS) {
    throw new SandboxBoundaryError(`sandbox setup failed during ${operation}: ${detail}`);
  }
}

export function runBuildTool(
  toolId,
  executable,
  arguments_,
  cwd,
  environment,
  sandboxProtocol = false,
) {
  try {
    if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
      execFileSync(process.env.ComSpec, ["/d", "/c", executable, ...arguments_], {
        cwd,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      execFileSync(executable, arguments_, {
        cwd,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
  } catch (error) {
    const stdout = Buffer.isBuffer(error.stdout)
      ? error.stdout.toString("utf8")
      : "";
    const stderr = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8")
      : "";
    const processOutcome = Number.isInteger(error.status)
      ? `process exited with status ${error.status}`
      : typeof error.signal === "string"
      ? `process terminated by signal ${error.signal}`
      : error.message;
    const detail = `${stdout}${stderr}`.trim() || processOutcome;
    if (sandboxProtocol) {
      throwSandboxBoundaryFailure(detail, "build", error.status);
      if (/\b(?:access is denied|permission denied)\b/i.test(detail)) {
        throw new UndeclaredInputError(`sandbox denied an undeclared build input: ${detail}`);
      }
    }
    throw new BuildFailureError(`${toolId} failed${detail ? `: ${detail}` : ""}`);
  }
}

export function runPackageTool(executable, arguments_, cwd, environment, sandboxProtocol = false) {
  try {
    if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
      execFileSync(process.env.ComSpec, ["/d", "/c", executable, ...arguments_], {
        cwd,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      execFileSync(executable, arguments_, {
        cwd,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
  } catch (error) {
    const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString("utf8") : "";
    const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : "";
    const detail = `${stdout}${stderr}`.trim() || error.message;
    if (sandboxProtocol) throwSandboxBoundaryFailure(detail, "package", error.status);
    throw new PackageFailureError(`llvm-objcopy failed${detail ? `: ${detail}` : ""}`);
  }
}
