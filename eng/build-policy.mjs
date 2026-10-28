// SPDX-License-Identifier: MIT
import process from "node:process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { BuildPolicyError, ConfigurationError } from "./build-errors.mjs";

/** @type {Array<[string, RegExp]>} */
const FORBIDDEN_BUILD_POLICIES = [
  ["lto", /(?:-flto(?:=[^\s)"']+)?|\/gl\b|\/ltcg(?::[^\s)"']+)?|\b(?:cmake_)?interprocedural_optimization(?:_[a-z0-9_]+)?\s+(?:on|true|1)\b|\.\s*lto\s*=\s*\.(?:full|thin)\b)/i],
  ["pgo", /(?:-f(?:cs-)?profile(?:-instr)?-(?:generate|use)(?:=[^\s)"']+)?|\/(?:genprofile|useprofile)\b)/i],
  ["fast-math", /(?:-ffast-math\b|-ofast\b|\/fp:fast\b)/i],
  ["native-tuning", /(?:-(?:march|mcpu|mtune)=native\b|-dcpu=native\b)/i],
  ["static-higher-simd", /(?:-mavx[^\s)"']*|\/arch:avx[^\s)"']*)/i],
];

function forbiddenBuildPolicy(contents) {
  return FORBIDDEN_BUILD_POLICIES.find(([, pattern]) => pattern.test(contents))?.[0];
}

export function validateAmbientBuildPolicy() {
  for (const variable of ["CFLAGS", "CPPFLAGS", "CXXFLAGS", "LDFLAGS", "ZIGFLAGS"]) {
    const value = process.env[variable];
    if (!value) continue;
    const policy = forbiddenBuildPolicy(value);
    if (policy) {
      throw new ConfigurationError(
        `${policy} option is forbidden by the R00 build policy (${variable})`,
        "forbidden-build-option",
      );
    }
  }
}

function declaredBuildPolicy(relativePath, contents) {
  const flagPolicy = forbiddenBuildPolicy(contents);
  if (flagPolicy) return flagPolicy;
  if (
    relativePath.endsWith("CMakeLists.txt") &&
    /\b(?:cmake_)?interprocedural_optimization(?:_[a-z0-9_]+)?\b/i.test(contents)
  ) {
    return "lto";
  }
  if (relativePath.endsWith("build.zig")) {
    const withoutRequiredLtoDisable = contents.replace(
      /\bexecutable\s*\.\s*lto\s*=\s*\.none\s*;/gi,
      "",
    );
    if (/\blto\b/i.test(withoutRequiredLtoDisable)) return "lto";
  }
  return undefined;
}

export async function validateDeclaredBuildPolicy(sourceRoot) {
  for (const relativePath of [
    "tests/r00/smoke/cpp/CMakeLists.txt",
    "tests/r00/smoke/zig/build.zig",
  ]) {
    const contents = await readFile(path.join(sourceRoot, ...relativePath.split("/")), "utf8");
    const policy = declaredBuildPolicy(relativePath, contents);
    if (policy) {
      throw new BuildPolicyError(
        `${policy} option is forbidden in declared build input ${relativePath}`,
      );
    }
  }
}

export function createBuildPolicy(target, profile, buildOptions) {
  const windows = target === "windows-x86_64-msvc";
  return {
    cpuBaseline: "x86-64-v2",
    cxx: {
      assertions: true,
      debugInformation: "full",
      optimization: profile === "debug" ? (windows ? "/Od" : "-O0") : (windows ? "/O2" : "-O2"),
    },
    detachedSymbols: "package",
    forbidden: {
      fastMath: false,
      lto: false,
      nativeTuning: false,
      pgo: false,
    },
    profile,
    simd: {
      baselineFixture: "x86-64-v2",
      dispatch: buildOptions.simdDispatch,
      higherFeatures: buildOptions.simdDispatch === "runtime-detected" ? ["avx2"] : [],
    },
    target,
    zig: {
      optimization: profile === "debug" ? "Debug" : "ReleaseSafe",
      safetyChecks: true,
    },
  };
}
