// SPDX-License-Identifier: MIT
import process from "node:process";
import { ConfigurationError } from "./build-errors.mjs";
import { validateAmbientBuildPolicy } from "./build-policy.mjs";

export function parseReportPath(arguments_) {
  const index = arguments_.indexOf("--report");
  if (index === -1 || !arguments_[index + 1]) {
    return undefined;
  }
  return arguments_[index + 1];
}

export function parseOptions(arguments_, allowed, flags = new Set()) {
  const options = new Map();
  for (let index = 1; index < arguments_.length;) {
    const name = arguments_[index];
    if (!name?.startsWith("--")) {
      throw new ConfigurationError(`invalid argument: ${name ?? "<missing>"}`);
    }
    if (!allowed.has(name)) {
      throw new ConfigurationError(`unknown option: ${name}`);
    }
    if (options.has(name)) {
      throw new ConfigurationError(`duplicate argument: ${name}`);
    }
    if (flags.has(name)) {
      options.set(name, true);
      index += 1;
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined) {
      throw new ConfigurationError(`invalid argument: ${name}`);
    }
    options.set(name, value);
    index += 2;
  }
  return options;
}

export function parseBuildOptions(arguments_) {
  return parseOptions(arguments_, new Set([
    "--dev", "--target", "--profile", "--simd-dispatch", "--workspace", "--out", "--report", "--source-target", "--intake-plan", "--intake-consumption", "--upgrade-plan", "--generation", "--program-core", "--core", "--core-command-role",
  ]), new Set(["--dev"]));
}

export function validateMlirConfiguration(options) {
  const role = options.get("--core-command-role");
  if (role !== undefined && !["static", "native"].includes(role))
    throw new ConfigurationError("Core command role must be static or native", "mlir-configuration");
  if (!options.has("--dev") || process.platform !== "win32" || options.get("--target") !== "windows-x86_64-msvc" ||
      options.get("--profile") !== "debug") {
    throw new ConfigurationError("MLIR intake requires explicit local-development Windows debug configuration", "mlir-configuration");
  }
}

export function validateVmConfiguration(options) {
  if (!options.has("--dev") || process.platform !== "win32" || options.get("--target") !== "windows-x86_64-msvc"
      || options.get("--profile") !== "debug")
    throw new ConfigurationError("Zig VM requires explicit local-development Windows debug configuration", "vm-configuration");
}

export function validateSmokeOptions(options, command, requireInput = false) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const output = options.get("--out");
  const input = options.get("--input");
  if (!target || !profile || !output || (requireInput && !input)) {
    throw new ConfigurationError(
      `${command} requires --target, --profile, ${requireInput ? "--input, " : ""}and --out`,
    );
  }
  if (
    !["linux-x86_64-gnu", "windows-x86_64-msvc"].includes(target) ||
    !["debug", "release"].includes(profile)
  ) {
    throw new ConfigurationError(
      `R00 ${command} supports only declared Linux and Windows debug/release targets`,
    );
  }
  if (command === "build" && options.get("--source-target") === "mlir-core") validateMlirConfiguration(options);
  if (command === "build" && ["tsfg-vm", "tsfg-aot"].includes(options.get("--source-target"))) validateVmConfiguration(options);
  if (options.get("--source-target") === "tsfg-aot") {
    if (!options.has("--program-core") || !options.has("--core"))
      throw new ConfigurationError("Static AOT build requires --program-core and --core", "aot-configuration");
  } else if (options.has("--program-core") || options.has("--core"))
    throw new ConfigurationError("Program/producer options require --source-target tsfg-aot", "aot-configuration");
  if (options.has("--core-command-role") && options.get("--source-target") !== "mlir-core")
    throw new ConfigurationError("Core command role requires --source-target mlir-core", "mlir-configuration");
  payloadOptions(options);
  const cpuFixture = options.get("--cpu-fixture");
  if (cpuFixture && (command !== "test" || cpuFixture !== "x86-64-v2")) {
    throw new ConfigurationError("--cpu-fixture supports only x86-64-v2 on test");
  }
  validateAmbientBuildPolicy();
}

export function validateCompatibilityOptions(options) {
  const target = options.get("--target");
  if (!target || !options.get("--compatibility-baseline") || !options.get("--compatibility-candidate")) {
    throw new ConfigurationError(
      "compatibility test requires --target, --compatibility-baseline, and --compatibility-candidate",
    );
  }
  if (!["linux-x86_64-gnu", "windows-x86_64-msvc"].includes(target)) {
    throw new ConfigurationError("R00 compatibility test supports only declared Linux and Windows targets");
  }
  for (const incompatible of ["--profile", "--simd-dispatch", "--cpu-fixture", "--out"]) {
    if (options.has(incompatible)) {
      throw new ConfigurationError(`${incompatible} is not valid for a compatibility artifact test`);
    }
  }
}

export function validatePackageRuntimeOptions(options) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  if (!target || !profile || !options.get("--workspace") || !options.get("--package")) {
    throw new ConfigurationError(
      "package runtime test requires --target, --profile, --workspace, and --package",
    );
  }
  if (
    !["linux-x86_64-gnu", "windows-x86_64-msvc"].includes(target) ||
    !["debug", "release"].includes(profile)
  ) {
    throw new ConfigurationError(
      "R00 package runtime test supports only declared Linux and Windows debug/release targets",
    );
  }
  const incompatible = ["--dev", "--out", "--simd-dispatch", "--cpu-fixture"]
    .find((option) => options.has(option));
  if (incompatible) {
    throw new ConfigurationError(`${incompatible} is not valid for package runtime test`);
  }
}

export function payloadOptions(options) {
  const simdDispatch = options.get("--simd-dispatch") ?? "runtime-detected";
  if (!["runtime-detected", "baseline-only"].includes(simdDispatch)) {
    throw new ConfigurationError(
      "--simd-dispatch must be runtime-detected or baseline-only",
    );
  }
  return { simdDispatch };
}
