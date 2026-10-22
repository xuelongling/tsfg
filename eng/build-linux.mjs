// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { canonicalize, digestFile, readRegularFile } from "./build-data.mjs";
import { BuildFailureError, ConfigurationError } from "./build-errors.mjs";
import { createBuildIdentity, createProducerEvidence, materializeBuildInputs } from "./build-identity.mjs";
import { compileSandbox, sandboxArguments, writeLockedLlvmWrapper } from "./build-linux-sandbox.mjs";
import { normalizeEmbeddedPaths } from "./build-normalization.mjs";
import { payloadOptions } from "./build-options.mjs";
import { createBuildPolicy, validateDeclaredBuildPolicy } from "./build-policy.mjs";
import { buildEnvironment, runBuildTool } from "./build-process.mjs";
import { publishDirectory } from "./build-publication.mjs";
import { closureToolPath } from "./build-toolchain.mjs";

export async function buildLinux(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const outputOption = options.get("--out");
  if (!target || !profile || !outputOption) {
    throw new ConfigurationError("build requires --target, --profile, and --out");
  }
  if (target !== "linux-x86_64-gnu" || !["debug", "release"].includes(profile)) {
    throw new ConfigurationError("R00 build supports only linux-x86_64-gnu debug/release");
  }
  let identity;
  try {
    identity = await createBuildIdentity(
      runtime,
      target,
      profile,
      workspaceState.root,
      payloadOptions(options),
    );
  } catch (error) {
    throw new BuildFailureError(`cannot derive Build Identity: ${error.message}`);
  }
  const buildPolicy = createBuildPolicy(target, profile, identity.buildIdentity.options);

  const output = path.resolve(outputOption);
  const stagingRoot = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${randomUUID()}.tmp`,
  );
  const sourceRoot = path.join(stagingRoot, "source");
  const workRoot = path.join(stagingRoot, "work");
  const controlRoot = path.join(stagingRoot, "control");
  const sandboxRoot = `${stagingRoot}-sandbox`;
  const publishRoot = path.join(stagingRoot, "publish");
  const cppWork = path.join(workRoot, "cpp");
  const wrapperRoot = path.join(controlRoot, "llvm-wrappers");
  const zigPrefix = path.join(workRoot, "zig-install");
  const sandboxExecutable = path.join(controlRoot, "sandbox-run");
  const sandboxRequired = process.platform === "linux";
  const binRoot = path.join(publishRoot, "bin");
  const cppOutput = path.join(cppWork, "tsfg-r00-cpp-smoke");
  const cmake = closureToolPath(runtime, "cmake");
  const ninja = closureToolPath(runtime, "ninja");
  const zig = closureToolPath(runtime, "zig");
  const clangxx = closureToolPath(runtime, "llvm", "clangxx");
  const lld = closureToolPath(runtime, "llvm", "lld");
  const llvmAr = closureToolPath(runtime, "llvm", "ar");
  const llvmRanlib = closureToolPath(runtime, "llvm", "ranlib");
  const sysroot = path.join(runtime.closurePath, "debian-sysroot");
  const lockedShell = closureToolPath(runtime, "archive-extractor");
  const loader = path.join(sysroot, "lib", "x86_64-linux-gnu", "ld-linux-x86-64.so.2");
  const runtimeLibraries = [
    path.join(sysroot, "lib", "x86_64-linux-gnu"),
    path.join(sysroot, "usr", "lib", "x86_64-linux-gnu"),
  ].join(":");
  const compilerWrapper = path.join(wrapperRoot, "clang++");
  const linkerWrapper = path.join(wrapperRoot, "ld.lld");
  const arWrapper = path.join(wrapperRoot, "llvm-ar");
  const ranlibWrapper = path.join(wrapperRoot, "llvm-ranlib");
  const ninjaWrapper = path.join(wrapperRoot, "ninja");
  const selectedNinja = sandboxRequired ? ninjaWrapper : ninja;
  const environment = buildEnvironment(workRoot, [
    path.dirname(cmake),
    path.dirname(ninja),
    path.dirname(clangxx),
    path.dirname(lld),
    path.dirname(zig),
  ]);
  environment.SOURCE_DATE_EPOCH = identity.buildIdentity.source_date_epoch;
  const debugPathFlags = [
    `-ffile-prefix-map=${sourceRoot}=.`,
    `-fdebug-prefix-map=${sourceRoot}=.`,
    `-fmacro-prefix-map=${sourceRoot}=.`,
    `-ffile-prefix-map=${runtime.closurePath}=.toolchain`,
    `-fdebug-prefix-map=${runtime.closurePath}=.toolchain`,
    `-fmacro-prefix-map=${runtime.closurePath}=.toolchain`,
    `-ffile-prefix-map=${workRoot}=.build`,
    `-fdebug-prefix-map=${workRoot}=.build`,
    `-fmacro-prefix-map=${workRoot}=.build`,
    "-fdebug-compilation-dir=.",
  ];
  const cmakeBuildType = profile === "debug" ? "Debug" : "Release";
  const cxxProfileFlags = [
    profile === "debug" ? "-O0 -g3" : "-O2 -g2",
    "-UNDEBUG",
    "-fno-omit-frame-pointer",
    "-march=x86-64-v2",
    "-mtune=generic",
    "-mno-avx",
    "-fno-lto",
    "-fno-profile-generate",
    "-fno-profile-use",
    "-fno-fast-math",
  ].join(" ");
  const zigOptimize = buildPolicy.zig.optimization;
  const zigLibraryRoot = sandboxRequired
    ? "/toolchain/zig/lib"
    : path.join(path.dirname(zig), "lib");
  const zigCacheRoot = sandboxRequired ? "/build/zig-cache" : path.join(workRoot, "zig-cache");
  const zigGlobalCacheRoot = sandboxRequired
    ? "/build/zig-global-cache"
    : path.join(workRoot, "zig-global-cache");
  const zigObject = path.join(workRoot, "zig-main.o");
  const zigObjectArgument = sandboxRequired ? "/build/zig-main.o" : zigObject;
  const zigOutput = path.join(zigPrefix, "bin", "tsfg-r00-zig-smoke");
  const zigOutputArgument = sandboxRequired ? "/build/zig-install/bin/tsfg-r00-zig-smoke" : zigOutput;
  const zigLinkCacheRoot = sandboxRequired
    ? "/build/zig-link-cache"
    : path.join(workRoot, "zig-link-cache");
  const zigLinkGlobalCacheRoot = sandboxRequired
    ? "/build/zig-link-global-cache"
    : path.join(workRoot, "zig-link-global-cache");
  const cmakeArguments = [
    "-S", path.join(sourceRoot, "tests", "r00", "smoke", "cpp"),
    "-B", cppWork,
    "-G", "Ninja",
    `-DCMAKE_MAKE_PROGRAM=${selectedNinja}`,
    `-DCMAKE_CXX_COMPILER=${compilerWrapper}`,
    `-DCMAKE_AR=${arWrapper}`,
    `-DCMAKE_RANLIB=${ranlibWrapper}`,
    `-DCMAKE_BUILD_TYPE=${cmakeBuildType}`,
    "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY",
    `-DCMAKE_SYSROOT=${sysroot}`,
    `-DCMAKE_CXX_FLAGS_${cmakeBuildType.toUpperCase()}=${cxxProfileFlags} ${debugPathFlags.join(" ")}`,
    `-DTSFG_R00_SIMD_DISPATCH_RUNTIME=${buildPolicy.simd.dispatch === "runtime-detected" ? "1" : "0"}`,
    "-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF",
    `-DCMAKE_EXE_LINKER_FLAGS=-fno-lto -fuse-ld=${linkerWrapper} --rtlib=compiler-rt -unwindlib=none`,
  ];
  const ninjaArguments = ["-C", cppWork, "tsfg-r00-cpp-smoke"];
  const zigArguments = [
    "build-obj",
    "tests/r00/smoke/zig/main.zig",
    "--zig-lib-dir", zigLibraryRoot,
    "-target", "x86_64-linux-gnu",
    "-mcpu", "x86_64_v2",
    `-O${zigOptimize}`,
    "-fno-lto",
    "-fno-incremental",
    `-femit-bin=${zigObjectArgument}`,
    "--cache-dir", zigCacheRoot,
    "--global-cache-dir", zigGlobalCacheRoot,
  ];
  const zigLinkArguments = [
    "build-exe",
    zigObjectArgument,
    "--zig-lib-dir", zigLibraryRoot,
    "-target", "x86_64-linux-gnu",
    "-mcpu", "x86_64_v2",
    `-O${zigOptimize}`,
    "-fentry=_start",
    "-fno-lto",
    "-fno-incremental",
    `-femit-bin=${zigOutputArgument}`,
    "--cache-dir", zigLinkCacheRoot,
    "--global-cache-dir", zigLinkGlobalCacheRoot,
  ];
  const steps = [
    { tool: "cmake", executable: cmake, arguments: cmakeArguments },
    { tool: "ninja", executable: selectedNinja, arguments: ninjaArguments },
    { tool: "zig", executable: zig, arguments: zigArguments },
    { tool: "zig", executable: zig, arguments: zigLinkArguments },
  ];

  try {
    await materializeBuildInputs(
      workspaceState.root,
      identity.buildInputSet,
      sourceRoot,
    );
    await validateDeclaredBuildPolicy(sourceRoot);
    await mkdir(cppWork, { recursive: true });
    await mkdir(wrapperRoot, { recursive: true });
    await mkdir(path.join(zigPrefix, "bin"), { recursive: true });
    await mkdir(binRoot, { recursive: true });
    if (sandboxRequired) {
      await compileSandbox(runtime, sourceRoot, controlRoot);
      environment.TSFG_LOCKED_LOADER = loader;
      environment.TSFG_LOCKED_LIB_DIRECTORY = path.join(sysroot, "lib", "x86_64-linux-gnu");
      environment.TSFG_LOCKED_USR_LIB_DIRECTORY = path.join(
        sysroot,
        "usr",
        "lib",
        "x86_64-linux-gnu",
      );
      environment.TSFG_LOCKED_LIBRARIES = runtimeLibraries;
      environment.TSFG_LOCKED_CLANGXX = clangxx;
      environment.TSFG_LOCKED_CLANG_RESOURCE = `-resource-dir=${path.join(
        runtime.closurePath,
        "llvm",
        "lib",
        "clang",
        "22",
      )}`;
      environment.TSFG_LOCKED_LLD = lld;
      environment.TSFG_LOCKED_AR = llvmAr;
      environment.TSFG_LOCKED_RANLIB = llvmRanlib;
      environment.TSFG_LOCKED_NINJA = ninja;
      environment.TSFG_CANONICAL_SOURCE = sourceRoot;
      environment.TSFG_CANONICAL_WORK = workRoot;
      environment.TSFG_CANONICAL_TOOLCHAIN = runtime.closurePath;
      environment.TSFG_SANDBOX_WORKING_DIRECTORY = "/workspace";
      environment.HOME = "/build";
      environment.PWD = "/workspace";
      environment.TMPDIR = "/build";
    }
    if (sandboxRequired) {
      for (const wrapper of [compilerWrapper, linkerWrapper, arWrapper, ranlibWrapper, ninjaWrapper]) {
        await copyFile(sandboxExecutable, wrapper);
        await chmod(wrapper, 0o755);
      }
    } else {
      await writeLockedLlvmWrapper(
        compilerWrapper,
        loader,
        runtimeLibraries,
        clangxx,
        [`-resource-dir=${path.join(runtime.closurePath, "llvm", "lib", "clang", "22")}`],
      );
      await writeLockedLlvmWrapper(linkerWrapper, loader, runtimeLibraries, lld);
      await writeLockedLlvmWrapper(arWrapper, loader, runtimeLibraries, llvmAr);
      await writeLockedLlvmWrapper(ranlibWrapper, loader, runtimeLibraries, llvmRanlib);
    }
    const sandboxPolicy = {
      readOnly: [sourceRoot],
      readExecute: [runtime.closurePath, controlRoot],
      readWrite: [workRoot],
      root: sandboxRoot,
      shell: lockedShell,
    };
    for (const step of steps) {
      if (sandboxRequired) {
        const command = step.tool === "cmake" ? loader : step.executable;
        const commandArguments = step.tool === "cmake"
          ? [
              "--inhibit-cache",
              "--library-path",
              runtimeLibraries,
              step.executable,
              ...step.arguments,
            ]
          : step.arguments;
        runBuildTool(
          step.tool,
          sandboxExecutable,
          sandboxArguments(sandboxPolicy, command, commandArguments),
          sourceRoot,
          environment,
          true,
        );
      } else {
        runBuildTool(step.tool, step.executable, step.arguments, sourceRoot, environment);
      }
    }
    const cppBytes = await readRegularFile(cppOutput, "C++ smoke build output")
      .catch((error) => { throw new BuildFailureError(error.message); });
    const publishedCpp = path.join(binRoot, "tsfg-r00-cpp-smoke");
    const zigBytes = await readRegularFile(zigOutput, "Zig smoke build output")
      .catch((error) => { throw new BuildFailureError(error.message); });
    const normalizedZigBytes = normalizeEmbeddedPaths(zigBytes, [
      [sourceRoot, ".workspace"],
      [runtime.closurePath, ".toolchain"],
      [workRoot, ".build"],
      ["/workspace", ".workspace"],
      ["/toolchain", ".toolchain"],
      ["/build", ".build"],
    ]);
    const publishedZig = path.join(binRoot, "tsfg-r00-zig-smoke");
    await writeFile(publishedCpp, cppBytes, { flag: "wx" });
    await writeFile(publishedZig, normalizedZigBytes, { flag: "wx" });
    if (process.platform !== "win32") {
      await chmod(publishedCpp, 0o755);
      await chmod(publishedZig, 0o755);
    }
    const payloads = await Promise.all([
      "bin/tsfg-r00-cpp-smoke",
      "bin/tsfg-r00-zig-smoke",
    ].map(async (payloadPath) => ({
      path: payloadPath,
      sha256: await digestFile(path.join(publishRoot, ...payloadPath.split("/"))),
    })));
    const metadata = {
      buildPolicy,
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      contractSetId: identity.contractSetId,
      development: workspaceState.development,
      dirty: workspaceState.dirty,
      inputAudit: {
        mode: sandboxRequired
          ? "materialized-build-input-set+namespaces"
          : "materialized-build-input-set",
        undeclaredReads: "blocked",
      },
      networkCanary,
      payloads,
      producer: await createProducerEvidence(identity, target, profile, workspaceState.root, workRoot),
      productVersion: identity.productVersion,
      publishable: workspaceState.publishable,
      schemaVersion: "1",
      toolchainClosureDigest: runtime.lockDigest,
    };
    await writeFile(
      path.join(publishRoot, "build-metadata.json"),
      `${canonicalize(metadata)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    const publication = await publishDirectory(publishRoot, output, runtime);
    const result = {
      buildPolicy,
      buildIdentity: identity.buildIdentity,
      contractSetId: identity.contractSetId,
      development: workspaceState.development,
      dirty: workspaceState.dirty,
      inputAudit: metadata.inputAudit,
      networkCanary,
      outputs: [
        "bin/tsfg-r00-cpp-smoke",
        "bin/tsfg-r00-zig-smoke",
        "build-metadata.json",
      ],
      profile,
      publishable: workspaceState.publishable,
      steps,
      target,
    };
    Object.defineProperty(result, "publication", { value: publication });
    return result;
  } finally {
    await rm(stagingRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 5 : 0,
      retryDelay: 100,
    });
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}
