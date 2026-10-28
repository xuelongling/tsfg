// SPDX-License-Identifier: MIT
import process from "node:process";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { connect as connectNetwork } from "node:net";
import { fileURLToPath } from "node:url";
import { OfflineBoundaryError, SANDBOX_SETUP_FAILURE_STATUS } from "./build-errors.mjs";
import { parseOptions, validatePackageRuntimeOptions, validateSmokeOptions } from "./build-options.mjs";
import { fail } from "./build-report.mjs";
import { verifyWindowsSandboxControl, windowsNetworkPrograms } from "./build-windows-sandbox.mjs";
import { validateVerifyWorkspaceOptions } from "./build-workspace.mjs";

async function networkCanaryConnects(host) {
  return await new Promise((resolve) => {
    let socket;
    try {
      socket = connectNetwork({ host, port: 443 });
    } catch {
      resolve(false);
      return;
    }
    const finish = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

export async function verifyOfflineBoundary() {
  for (const host of ["1.1.1.1", "8.8.8.8"]) {
    if (await networkCanaryConnects(host)) {
      throw new OfflineBoundaryError(
        `network canary unexpectedly connected to ${host}:443`,
      );
    }
  }
  if (process.platform === "linux") {
    const ipv4Routes = await readFile("/proc/net/route", "utf8");
    const externalIpv4Route = ipv4Routes
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .some((fields) => fields.length > 1 && fields[0] !== "lo");
    const ipv6Routes = await readFile("/proc/net/ipv6_route", "utf8");
    const externalIpv6Route = ipv6Routes
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .some((fields) => fields.length > 9 && fields[9] !== "lo");
    if (externalIpv4Route || externalIpv6Route) {
      throw new OfflineBoundaryError(
        "offline network isolation is not established: a non-loopback route is present",
      );
    }
  }
  return "blocked";
}

export function shouldEnterWindowsOfflineBoundary(arguments_, runtime) {
  // Source intake must not elevate the mutable control plane via network-only.
  // Its native operation establishes its own restricted boundary.
  if (arguments_.includes("--source-target")) return false;
  if (
    process.platform !== "win32" ||
    process.env.TSFG_WINDOWS_OFFLINE_ACTIVE === "1" ||
    runtime?.platform !== "windows-x86_64-msvc"
  ) return false;
  const command = arguments_[0];
  if (!["verify-workspace", "build", "test", "package", "repro-check"].includes(command)) {
    return false;
  }
  try {
    if (command === "verify-workspace") {
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
      validateVerifyWorkspaceOptions(options);
      return true;
    }
    if (command === "repro-check") {
      const options = parseOptions(
        arguments_,
        new Set(["--target", "--profile", "--producer-a", "--producer-b", "--workspace", "--report"]),
      );
      return options.get("--target") === "windows-x86_64-msvc";
    }
    const requireInput = command === "package";
    const options = parseOptions(
      arguments_,
      new Set([
        "--dev",
        "--target",
        "--profile",
        "--simd-dispatch",
        ...(command === "test" ? ["--cpu-fixture"] : []),
        "--workspace",
        ...(command === "test" ? ["--package"] : []),
        ...(requireInput ? ["--input"] : []),
        "--out",
        "--report",
      ]),
      new Set(["--dev"]),
    );
    if (command === "test" && options.has("--package")) validatePackageRuntimeOptions(options);
    else validateSmokeOptions(options, command, requireInput);
    if (options.get("--target") !== "windows-x86_64-msvc") return false;
    return true;
  } catch {
    return false;
  }
}

// The supervisor transport consumes exactly this argv. Keep construction pure
// so command forwarding can be verified without invoking the Windows boundary.
export function windowsOfflineArguments(arguments_, node, networkPrograms) {
  return [
    "--network-only",
    ...networkPrograms.flatMap((program) => ["--deny-network", program]),
    // This implementation is not a CLI. Re-enter the unique real dispatcher;
    // import.meta.url alone would launch this exports-only module and exit 0.
    "--", node, fileURLToPath(new URL("./tsfg-build.mjs", import.meta.url)), ...arguments_,
  ];
}

export async function enterWindowsOfflineBoundary(arguments_, runtime, reportPath) {
  try {
    const { executable } = await verifyWindowsSandboxControl(runtime);
    const child = spawnSync(
      executable,
      windowsOfflineArguments(arguments_, process.execPath,
        windowsNetworkPrograms(runtime, [process.execPath])),
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, TSFG_WINDOWS_OFFLINE_ACTIVE: "1" },
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    if (child.error || child.status === SANDBOX_SETUP_FAILURE_STATUS) {
      const detail = child.error?.message
        ?? `${child.stdout ?? ""}${child.stderr ?? ""}`.trim()
        ?? "Windows offline supervisor failed";
      return await fail(
        arguments_[0],
        12,
        "offline input missing",
        {
          code: "sandbox-boundary",
          message: `Windows offline boundary is unavailable: ${detail}`,
        },
        reportPath,
        "offline",
      );
    }
    return child.status ?? 30;
  } catch (error) {
    return await fail(
      arguments_[0],
      12,
      "offline input missing",
      {
        code: "sandbox-boundary",
        message: `Windows offline boundary is unavailable: ${error.message}`,
      },
      reportPath,
      "offline",
    );
  }
}
