// SPDX-License-Identifier: MIT
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { arch as hostArchitecture, release as hostRelease, version as hostVersion } from "node:os";
import { TestFailureError, UndeclaredInputError } from "./build-errors.mjs";
import { sandboxArguments } from "./build-linux-sandbox.mjs";
import { buildEnvironment, throwSandboxBoundaryFailure } from "./build-process.mjs";
import { windowsSandboxArguments, windowsSandboxPolicy } from "./build-windows-sandbox.mjs";

export async function observeHostPlatform(target) {
  const expectedPlatform = target === "linux-x86_64-gnu" ? "linux" : "win32";
  if (process.platform !== expectedPlatform || hostArchitecture() !== "x64") {
    throw new TestFailureError(
      `${target} package runtime smoke requires its x86_64 target host`,
      "minimum-platform",
    );
  }
  const observed = {
    architecture: "x86_64",
    kernelRelease: hostRelease(),
    operatingSystem: process.platform === "linux" ? "linux" : "windows",
    osVersion: hostVersion(),
  };
  if (process.platform === "linux") {
    const diagnosticReport = /** @type {{header?: {glibcVersionRuntime?: string}}} */ (
      process.report.getReport()
    );
    const values = new Map();
    for (const line of (await readFile("/etc/os-release", "utf8")).split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (match) values.set(match[1], match[2].replace(/^"|"$/g, ""));
    }
    return {
      ...observed,
      distribution: {
        id: values.get("ID") ?? "",
        pointRelease: (await readFile("/etc/debian_version", "utf8").catch(() => "")).trim(),
        versionId: values.get("VERSION_ID") ?? "",
      },
      glibcVersion: diagnosticReport.header?.glibcVersionRuntime ?? "",
    };
  }
  return {
    ...observed,
    windowsBuild: hostRelease().split(".")[2] ?? "",
  };
}

export function runSmokeExecutable(
  name,
  executable,
  outputRoot,
  runtime,
  sandboxExecutable,
  sandboxRoot,
  lockedShell,
  deniedRoot,
  executableArguments = [],
  executionMode = "toolchain-runtime",
) {
  const useToolchainSysroot = runtime.platform === "linux-x86_64-gnu" &&
    executionMode === "toolchain-runtime";
  const sysroot = useToolchainSysroot
    ? path.join(runtime.closurePath, "debian-sysroot")
    : undefined;
  const command = useToolchainSysroot
    ? path.join(sysroot, "lib", "x86_64-linux-gnu", "ld-linux-x86-64.so.2")
    : executable;
  const commandArguments = useToolchainSysroot
    ? [
        "--inhibit-cache",
        "--library-path",
        [
          path.join(sysroot, "lib", "x86_64-linux-gnu"),
          path.join(sysroot, "usr", "lib", "x86_64-linux-gnu"),
        ].join(":"),
        executable,
        ...executableArguments,
      ]
    : executableArguments;
  const result = spawnSync(
    sandboxExecutable ?? command,
    sandboxExecutable
      ? runtime.platform === "windows-x86_64-msvc"
        ? windowsSandboxArguments(
          windowsSandboxPolicy(runtime, {
            additionalNetwork: [command],
            deniedRead: [deniedRoot],
            readOnly: [],
            readExecute: [outputRoot, runtime.closurePath],
            readWrite: [],
          }),
          command,
          commandArguments,
        )
        : sandboxArguments(
          {
            readExecute: [outputRoot, runtime.closurePath],
            root: sandboxRoot,
            shell: lockedShell,
          },
          command,
          commandArguments,
        )
      : commandArguments,
    {
      cwd: outputRoot,
      encoding: "utf8",
      env: buildEnvironment(outputRoot, []),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (sandboxExecutable) {
      throwSandboxBoundaryFailure(detail, "test", result.status);
      if (/\b(?:access is denied|permission denied)\b/i.test(detail)) {
        throw new UndeclaredInputError(`sandbox denied an undeclared test input: ${detail}`);
      }
    }
    throw new TestFailureError(
      `${name} failed${detail ? `: ${detail}` : result.error ? `: ${result.error.message}` : ""}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}
