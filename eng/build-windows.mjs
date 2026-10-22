// SPDX-License-Identifier: MIT
import process from "node:process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { canonicalize, digest, readRegularFile } from "./build-data.mjs";
import { BuildFailureError, ConfigurationError, SandboxBoundaryError, WINDOWS_NETWORK_ISOLATION } from "./build-errors.mjs";
import { createBuildIdentity, createProducerEvidence, materializeBuildInputs } from "./build-identity.mjs";
import { normalizeWindowsExecutable, normalizeWindowsPdb } from "./build-normalization.mjs";
import { payloadOptions } from "./build-options.mjs";
import { createBuildPolicy, validateDeclaredBuildPolicy } from "./build-policy.mjs";
import { buildEnvironment, runBuildTool } from "./build-process.mjs";
import { publishDirectory } from "./build-publication.mjs";
import { windowsToolchain } from "./build-toolchain.mjs";
import { verifyWindowsSandboxBoundary, verifyWindowsSandboxControl, windowsSandboxArguments, windowsSandboxPolicy } from "./build-windows-sandbox.mjs";

export async function buildWindows(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const outputOption = options.get("--out");
  if (!target || !profile || !outputOption) {
    throw new ConfigurationError("build requires --target, --profile, and --out");
  }
  if (target !== "windows-x86_64-msvc" || !["debug", "release"].includes(profile)) {
    throw new ConfigurationError("R00 build supports only windows-x86_64-msvc debug/release");
  }
  if (process.platform !== "win32") {
    throw new ConfigurationError("windows-x86_64-msvc builds require a Windows host");
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
  const boundaryRoot = await mkdtemp(path.join(tmpdir(), "tsfg-windows-build-"));
  const stagingRoot = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp`);
  const sourceRoot = path.join(boundaryRoot, "source");
  const workRoot = path.join(boundaryRoot, "work");
  const publishRoot = path.join(stagingRoot, "publish");
  const cppWork = path.join(workRoot, "cpp");
  const zigPrefix = path.join(workRoot, "zig-install");
  const compatibilityRoot = path.join(workRoot, "msvc-compatibility");
  const binRoot = path.join(publishRoot, "bin");
  const symbolRoot = path.join(publishRoot, "symbols");
  const tools = windowsToolchain(runtime);
  const environment = buildEnvironment(workRoot, [
    path.dirname(tools.cmake),
    path.dirname(tools.ninja),
    path.dirname(tools.clangcl),
    path.dirname(tools.lld),
    path.dirname(tools.rc),
    path.dirname(tools.zig),
  ]);
  environment.INCLUDE = tools.include.join(";");
  environment.LIB = tools.lib.join(";");
  environment.LIBPATH = tools.lib.join(";");
  environment.SOURCE_DATE_EPOCH = identity.buildIdentity.source_date_epoch;
  const msvcPathMapFlags = [sourceRoot, runtime.closurePath, workRoot]
    .map((source, index) => `/pathmap:${source}=${[".", ".toolchain", ".build"][index]}`);
  const clangPathMapFlags = [sourceRoot, runtime.closurePath, workRoot]
    .flatMap((source, index) => [
      `/clang:-ffile-prefix-map=${source}=${[".", ".toolchain", ".build"][index]}`,
      `/clang:-fdebug-prefix-map=${source}=${[".", ".toolchain", ".build"][index]}`,
    ]);
  const cmakePath = (value) => value.replaceAll("\\", "/");
  const cmakeBuildType = profile === "debug" ? "Debug" : "Release";
  const runtimeLibrary = profile === "debug" ? "MultiThreadedDebug" : "MultiThreaded";
  const runtimeLibraries = profile === "debug"
    ? ["libcmtd.lib", "libvcruntimed.lib", "libucrtd.lib"]
    : ["libcmt.lib", "libvcruntime.lib", "libucrt.lib"];
  const cxxProfileFlags = [
    profile === "debug" ? "/Od" : "/O2",
    "/Zi",
    "/UNDEBUG",
    "/clang:-march=x86-64-v2",
    "/clang:-mtune=generic",
    "/clang:-mno-avx",
    "/clang:-fno-lto",
    "/clang:-fno-profile-generate",
    "/clang:-fno-profile-use",
    "/clang:-fno-fast-math",
  ].join(" ");
  const cmakeArguments = [
    "-S", cmakePath(path.join(sourceRoot, "tests", "r00", "smoke", "cpp")),
    "-B", cmakePath(cppWork),
    "-G", "Ninja",
    `-DCMAKE_MAKE_PROGRAM=${cmakePath(tools.ninja)}`,
    `-DCMAKE_CXX_COMPILER=${cmakePath(tools.clangcl)}`,
    `-DCMAKE_LINKER=${cmakePath(tools.lld)}`,
    `-DCMAKE_RC_COMPILER=${cmakePath(tools.rc)}`,
    `-DCMAKE_MT=${cmakePath(tools.mt)}`,
    `-DCMAKE_BUILD_TYPE=${cmakeBuildType}`,
    "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY",
    `-DCMAKE_MSVC_RUNTIME_LIBRARY=${runtimeLibrary}`,
    "-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF",
    `-DCMAKE_CXX_FLAGS_${cmakeBuildType.toUpperCase()}=${cxxProfileFlags} ${clangPathMapFlags.join(" ")} /clang:-fdebug-compilation-dir=.`,
    `-DTSFG_R00_SIMD_DISPATCH_RUNTIME=${buildPolicy.simd.dispatch === "runtime-detected" ? "1" : "0"}`,
    `-DCMAKE_EXE_LINKER_FLAGS=/debug:full /timestamp:${identity.buildIdentity.source_date_epoch} /pdbaltpath:%_PDB% /nodefaultlib ${runtimeLibraries.join(" ")} kernel32.lib /entry:mainCRTStartup`,
  ];
  const zigArguments = [
    "build",
    "--build-file", "tests/r00/smoke/zig/build.zig",
    "--zig-lib-dir", path.join(path.dirname(tools.zig), "lib"),
    "--prefix", zigPrefix,
    "--cache-dir", path.join(workRoot, "zig-cache"),
    "--global-cache-dir", path.join(workRoot, "zig-global-cache"),
    "-Dtarget=x86_64-windows-msvc",
    `-Doptimize=${buildPolicy.zig.optimization}`,
    "-Dcpu=x86_64_v2",
    "-j1",
    "-fno-incremental",
    "--seed", "0",
  ];
  const compatibilityObject = path.join(compatibilityRoot, "main.obj");
  const compatibilityPdb = path.join(compatibilityRoot, "compiler.pdb");
  const compatibilityExecutable = path.join(compatibilityRoot, "tsfg-r00-msvc-compat.exe");
  const steps = [
    { role: "normative", tool: "cmake", executable: tools.cmake, arguments: cmakeArguments },
    { role: "normative", tool: "ninja", executable: tools.ninja, arguments: ["-C", cppWork, "tsfg-r00-cpp-smoke"] },
    { role: "normative", tool: "zig", executable: tools.zig, arguments: zigArguments },
    {
      role: "compatibility-only",
      tool: "cl",
      executable: tools.cl,
      arguments: ["/nologo", "/c", profile === "debug" ? "/Od" : "/O2", "/Zi",
        profile === "debug" ? "/MTd" : "/MT", "/Brepro", ...msvcPathMapFlags,
        path.join(sourceRoot, "tests", "r00", "smoke", "cpp", "main.cpp"),
        `/Fo${compatibilityObject}`, `/Fd${compatibilityPdb}`],
    },
    {
      role: "compatibility-only",
      tool: "link",
      executable: tools.link,
      arguments: ["/nologo", "/debug:full", "/Brepro", "/pdbaltpath:%_PDB%", "/nodefaultlib",
        "/subsystem:console", "/entry:mainCRTStartup", compatibilityObject, ...runtimeLibraries,
        "kernel32.lib", `/out:${compatibilityExecutable}`],
    },
  ];

  try {
    await materializeBuildInputs(workspaceState.root, identity.buildInputSet, sourceRoot);
    await validateDeclaredBuildPolicy(sourceRoot);
    await Promise.all([cppWork, path.join(zigPrefix, "bin"), compatibilityRoot, binRoot, symbolRoot]
      .map((directory) => mkdir(directory, { recursive: true })));
    if (runtime.platform !== target) {
      throw new SandboxBoundaryError("Windows runtime closure cannot establish the target boundary");
    }
    const { executable: sandboxExecutable } = await verifyWindowsSandboxControl(runtime);
    verifyWindowsSandboxBoundary(
      sandboxExecutable,
      runtime,
      sourceRoot,
      workRoot,
      workspaceState.root,
    );
    const sandboxPolicy = windowsSandboxPolicy(runtime, {
      deniedRead: [workspaceState.root],
      readOnly: [sourceRoot],
      readExecute: [runtime.closurePath],
      readWrite: [workRoot],
    });
    for (const step of steps) {
      runBuildTool(
        step.tool,
        sandboxExecutable,
        windowsSandboxArguments(sandboxPolicy, step.executable, step.arguments),
        sourceRoot,
        environment,
        true,
      );
    }
    const outputs = [
      {
        source: path.join(cppWork, "tsfg-r00-cpp-smoke.exe"),
        destination: "bin/tsfg-r00-cpp-smoke.exe",
        symbolSource: path.join(cppWork, "tsfg-r00-cpp-smoke.pdb"),
        symbolDestination: "symbols/tsfg-r00-cpp-smoke.pdb",
      },
      {
        source: path.join(zigPrefix, "bin", "tsfg-r00-zig-smoke.exe"),
        destination: "bin/tsfg-r00-zig-smoke.exe",
        symbolSource: path.join(zigPrefix, "bin", "tsfg-r00-zig-smoke.pdb"),
        symbolDestination: "symbols/tsfg-r00-zig-smoke.pdb",
      },
    ];
    const payloads = [];
    const symbols = [];
    for (const item of outputs) {
      const pdbGuid = await normalizeWindowsPdb(
        item.symbolSource,
        tools.pdbutil,
        [
          [sourceRoot, "."],
          [runtime.closurePath, ".toolchain"],
          [workRoot, ".build"],
          [boundaryRoot, ".build"],
        ],
        workRoot,
        environment,
        sandboxExecutable,
        sandboxPolicy,
      );
      const executableBytes = await normalizeWindowsExecutable(
        item.source,
        pdbGuid,
        Number.parseInt(identity.buildIdentity.source_date_epoch, 10),
      ).catch((error) => { throw new BuildFailureError(error.message); });
      const symbolBytes = await readRegularFile(item.symbolSource, item.symbolDestination)
        .catch((error) => { throw new BuildFailureError(error.message); });
      await writeFile(path.join(publishRoot, ...item.destination.split("/")), executableBytes, { flag: "wx" });
      await writeFile(path.join(publishRoot, ...item.symbolDestination.split("/")), symbolBytes, { flag: "wx" });
      payloads.push({ path: item.destination, sha256: digest(executableBytes) });
      symbols.push({ path: item.symbolDestination, sha256: digest(symbolBytes) });
    }
    const metadata = {
      buildPolicy,
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      contractSetId: identity.contractSetId,
      development: workspaceState.development,
      dirty: workspaceState.dirty,
      inputAudit: {
        mode: "materialized-build-input-set+restricted-token",
        scope: "repository-workspace",
        undeclaredReads: "blocked",
      },
      networkCanary,
      networkIsolation: WINDOWS_NETWORK_ISOLATION,
      payloads,
      producer: await createProducerEvidence(identity, target, profile, workspaceState.root, workRoot),
      productVersion: identity.productVersion,
      publishable: workspaceState.publishable,
      schemaVersion: "1",
      symbols,
      toolchainClosureDigest: runtime.lockDigest,
      toolchainRoles: { compatibilityOnly: ["cl", "link"], normative: ["clang-cl", "lld-link", "zig"] },
    };
    await writeFile(path.join(publishRoot, "build-metadata.json"), `${canonicalize(metadata)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    const publication = await publishDirectory(publishRoot, output, runtime);
    const result = {
      buildPolicy,
      buildIdentity: identity.buildIdentity,
      contractSetId: identity.contractSetId,
      development: workspaceState.development,
      dirty: workspaceState.dirty,
      inputAudit: metadata.inputAudit,
      networkCanary,
      networkIsolation: WINDOWS_NETWORK_ISOLATION,
      outputs: [...payloads, ...symbols].map(({ path: outputPath }) => outputPath).concat("build-metadata.json"),
      profile,
      publishable: workspaceState.publishable,
      steps: steps.map(({ role, tool }) => ({ role, tool })),
      target,
    };
    Object.defineProperty(result, "publication", { value: publication });
    return result;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(boundaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
