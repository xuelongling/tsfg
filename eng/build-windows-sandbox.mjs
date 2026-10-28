// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { digest, digestFile, pathExists, readRegularFile, renameWithRetry } from "./build-data.mjs";
import { BuildFailureError, WINDOWS_PUBLICATION_EXECUTABLE_DIGEST, WINDOWS_SANDBOX_EXECUTABLE_DIGEST } from "./build-errors.mjs";
import { buildEnvironment, runBuildTool, throwSandboxBoundaryFailure } from "./build-process.mjs";
import { closureToolPath, windowsToolchain } from "./build-toolchain.mjs";

export function windowsSandboxArguments(policy, executable, arguments_) {
  if (!policy) return arguments_;
  if (policy.networkOnly) {
    return [
      "--network-only",
      ...(policy.networkDenied ?? []).flatMap((program) => ["--deny-network", program]),
      ...(policy.boundaryStatus ? ["--allow-boundary-status", String(policy.boundaryStatus)] : []),
      "--",
      executable,
      ...arguments_,
    ];
  }
  return [
    ...(policy.networkDenied ?? []).flatMap((program) => ["--deny-network", program]),
    ...(policy.boundaryStatus ? ["--allow-boundary-status", String(policy.boundaryStatus)] : []),
    ...(policy.deniedRead ?? []).flatMap((deniedPath) => ["--deny-read", deniedPath]),
    ...policy.readOnly.flatMap((allowedPath) => ["--ro", allowedPath]),
    ...policy.readExecute.flatMap((allowedPath) => ["--rx", allowedPath]),
    ...policy.readWrite.flatMap((allowedPath) => ["--rw", allowedPath]),
    "--",
    executable,
    ...arguments_,
  ];
}

export async function compileWindowsSandbox(runtime, sourceRoot, controlRoot,
  sourceName = "windows-sandbox-run.c", executableName = "windows-sandbox-run.exe") {
  const tools = windowsToolchain(runtime);
  const executable = path.join(controlRoot, executableName);
  await mkdir(controlRoot, { recursive: true });
  const environment = buildEnvironment(controlRoot, [
    path.dirname(tools.clangcl),
    path.dirname(tools.lld),
  ]);
  environment.INCLUDE = tools.include.join(";");
  environment.LIB = tools.lib.join(";");
  environment.LIBPATH = tools.lib.join(";");
  runBuildTool(
    "windows-sandbox-bootstrap",
    tools.clangcl,
    [
      "/nologo",
      "/TC",
      "/O2",
      "/MT",
      "/Brepro",
      "/DUNICODE",
      "/D_UNICODE",
      "/X",
      "/clang:-march=x86-64-v2",
      "/clang:-mtune=generic",
      "/clang:-mno-avx",
      "/clang:-fno-lto",
      "/clang:-fno-profile-generate",
      "/clang:-fno-profile-use",
      "/clang:-fno-fast-math",
      "/clang:-fdebug-compilation-dir=.",
      "/clang:-fuse-ld=lld",
      ...tools.include.flatMap((includePath) => ["/imsvc", includePath]),
      path.join(sourceRoot, "eng", sourceName),
      `/Fo${path.join(controlRoot, `${sourceName}.obj`)}`,
      "/link",
      ...(sourceName === "windows-sandbox-run.c" ? ["/DEPENDENTLOADFLAG:0x800"] : []),
      "/Brepro",
      "/nodefaultlib",
      "libcmt.lib",
      "libvcruntime.lib",
      "libucrt.lib",
      "advapi32.lib",
      "fwpuclnt.lib",
      "ole32.lib",
      "userenv.lib",
      "uuid.lib",
      "kernel32.lib",
      "/subsystem:console",
      "/entry:wmainCRTStartup",
      `/out:${executable}`,
    ],
    sourceRoot,
    environment,
  );
  await readRegularFile(executable, "Windows sandbox executable");
  return { executable };
}

function windowsSandboxControlPath(runtime) {
  return path.join(
    runtime.cachePath,
    "controls",
    WINDOWS_SANDBOX_EXECUTABLE_DIGEST.slice("sha256:".length),
    "windows-sandbox-run.exe",
  );
}

function normalizeWindowsSandboxControl(bytes) {
  const normalized = Buffer.from(bytes);
  if (
    normalized.length < 0x40 ||
    normalized.readUInt16LE(0) !== 0x5a4d
  ) throw new Error("Windows sandbox control is not a PE image");
  const peOffset = normalized.readUInt32LE(0x3c);
  if (
    peOffset + 24 > normalized.length ||
    normalized.readUInt32LE(peOffset) !== 0x00004550
  ) throw new Error("Windows sandbox control has an invalid PE header");
  normalized.fill(0, peOffset + 8, peOffset + 12);
  const sectionCount = normalized.readUInt16LE(peOffset + 6);
  const optionalSize = normalized.readUInt16LE(peOffset + 20);
  const optionalOffset = peOffset + 24;
  const magic = normalized.readUInt16LE(optionalOffset);
  const directoryOffset = optionalOffset + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0);
  if (directoryOffset === optionalOffset) {
    throw new Error("Windows sandbox control has an unsupported PE optional header");
  }
  const debugRva = normalized.readUInt32LE(directoryOffset + 6 * 8);
  const debugSize = normalized.readUInt32LE(directoryOffset + 6 * 8 + 4);
  const sectionsOffset = optionalOffset + optionalSize;
  let debugOffset;
  for (let index = 0; index < sectionCount; index += 1) {
    const section = sectionsOffset + index * 40;
    const virtualAddress = normalized.readUInt32LE(section + 12);
    const rawSize = normalized.readUInt32LE(section + 16);
    const rawOffset = normalized.readUInt32LE(section + 20);
    if (debugRva >= virtualAddress && debugRva < virtualAddress + rawSize) {
      debugOffset = rawOffset + debugRva - virtualAddress;
      break;
    }
  }
  if (debugSize > 0 && debugOffset === undefined) {
    throw new Error("Windows sandbox control debug directory is outside the PE image");
  }
  for (let offset = debugOffset; offset !== undefined && offset < debugOffset + debugSize; offset += 28) {
    normalized.fill(0, offset + 4, offset + 8);
    const type = normalized.readUInt32LE(offset + 12);
    const dataSize = normalized.readUInt32LE(offset + 16);
    const dataOffset = normalized.readUInt32LE(offset + 24);
    if (
      type === 2 &&
      dataSize >= 24 &&
      dataOffset + dataSize <= normalized.length &&
      normalized.toString("ascii", dataOffset, dataOffset + 4) === "RSDS"
    ) normalized.fill(0, dataOffset + 4, dataOffset + 20);
  }
  return normalized;
}

export async function verifyWindowsSandboxControl(runtime) {
  const executable = windowsSandboxControlPath(runtime);
  await readRegularFile(executable, "Windows sandbox control");
  const actual = await digestFile(executable);
  if (actual !== WINDOWS_SANDBOX_EXECUTABLE_DIGEST) {
    throw new Error(
      `Windows sandbox control digest mismatch: expected ${WINDOWS_SANDBOX_EXECUTABLE_DIGEST}, got ${actual}`,
    );
  }
  return { executable };
}

export async function provisionWindowsSandboxControl(runtime) {
  const executable = windowsSandboxControlPath(runtime);
  if (await pathExists(executable)) {
    const bytes = await readRegularFile(executable, "Windows sandbox control");
    const normalized = normalizeWindowsSandboxControl(bytes);
    if (digest(normalized) !== WINDOWS_SANDBOX_EXECUTABLE_DIGEST) {
      return await verifyWindowsSandboxControl(runtime);
    }
    if (digest(bytes) !== WINDOWS_SANDBOX_EXECUTABLE_DIGEST) {
      await writeFile(executable, normalized);
    }
    return await verifyWindowsSandboxControl(runtime);
  }
  const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  await mkdir(runtime.cachePath, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(runtime.cachePath, ".windows-control-"));
  try {
    const compiled = await compileWindowsSandbox(runtime, repositoryRoot, stagingRoot);
    const bytes = await readRegularFile(compiled.executable, "Windows sandbox control");
    const normalized = normalizeWindowsSandboxControl(bytes);
    const actual = digest(normalized);
    if (actual !== WINDOWS_SANDBOX_EXECUTABLE_DIGEST) {
      const diagnosticRoot = path.join(runtime.cachePath, "windows-sandbox-control-failure");
      await mkdir(diagnosticRoot, { recursive: true });
      await writeFile(path.join(diagnosticRoot, "windows-sandbox-run.exe"), normalized);
      await writeFile(
        path.join(diagnosticRoot, "digest.json"),
        `${JSON.stringify({ actual, expected: WINDOWS_SANDBOX_EXECUTABLE_DIGEST, schemaVersion: "1" })}\n`,
      );
      throw new Error(
        `Windows sandbox control build mismatch: expected ${WINDOWS_SANDBOX_EXECUTABLE_DIGEST}, got ${actual}`,
      );
    }
    await writeFile(compiled.executable, normalized);
    await mkdir(path.dirname(executable), { recursive: true });
    try {
      await renameWithRetry(compiled.executable, executable);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    return await verifyWindowsSandboxControl(runtime);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function windowsPublicationControlPath(runtime) {
  return path.join(runtime.cachePath, "controls",
    WINDOWS_PUBLICATION_EXECUTABLE_DIGEST.slice("sha256:".length), "windows-publish.exe");
}

export async function verifyWindowsPublicationControl(runtime) {
  const executable = windowsPublicationControlPath(runtime);
  const bytes = await readRegularFile(executable, "Windows publication control");
  if (digest(bytes) !== WINDOWS_PUBLICATION_EXECUTABLE_DIGEST) {
    throw new Error("Windows publication control digest mismatch; run prefetch with the current source");
  }
  return executable;
}

export async function provisionWindowsPublicationControl(runtime) {
  const executable = windowsPublicationControlPath(runtime);
  if (await pathExists(executable)) return await verifyWindowsPublicationControl(runtime);
  const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const stagingRoot = await mkdtemp(path.join(runtime.cachePath, ".windows-publication-"));
  try {
    const compiled = await compileWindowsSandbox(runtime, repositoryRoot, stagingRoot,
      "windows-publish.c", "windows-publish.exe");
    const bytes = normalizeWindowsSandboxControl(await readRegularFile(compiled.executable, "publication control"));
    if (digest(bytes) !== WINDOWS_PUBLICATION_EXECUTABLE_DIGEST) {
      throw new Error(`Windows publication control build mismatch: ${digest(bytes)}`);
    }
    await mkdir(path.dirname(executable), { recursive: true });
    try {
      await writeFile(executable, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    return await verifyWindowsPublicationControl(runtime);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export function windowsNetworkPrograms(runtime, additional = []) {
  const tools = windowsToolchain(runtime);
  return [...new Set([
    closureToolPath(runtime, "node"),
    tools.cmake,
    tools.ninja,
    tools.clangcl,
    tools.lld,
    tools.rc,
    tools.mt,
    tools.mspdbsrv,
    tools.zig,
    tools.cl,
    tools.link,
    tools.pdbutil,
    windowsPublicationControlPath(runtime),
    process.env.ComSpec,
    process.env.TSFG_GIT,
    ...additional,
  ].filter((program) => typeof program === "string" && program.length > 0)
    .map((program) => path.resolve(program)))];
}

export function windowsSandboxPolicy(
  runtime,
  {
    additionalNetwork = [],
    boundaryStatus = undefined,
    deniedRead = [],
    readExecute = [],
    readOnly = [],
    readWrite = [],
  },
) {
  return {
    boundaryStatus,
    deniedRead,
    networkDenied: windowsNetworkPrograms(runtime, additionalNetwork),
    readExecute,
    readOnly,
    readWrite,
  };
}

export function verifyWindowsSandboxBoundary(
  sandboxExecutable,
  runtime,
  sourceRoot,
  workRoot,
  undeclaredRoot,
) {
  const node = closureToolPath(runtime, "node");
  const basePolicy = windowsSandboxPolicy(runtime, {
    deniedRead: [undeclaredRoot],
    readOnly: [sourceRoot],
    readExecute: [runtime.closurePath, path.dirname(sourceRoot)],
    readWrite: [workRoot],
  });
  const environment = buildEnvironment(workRoot, [path.dirname(node)]);
  const undeclaredInputCanary = path.join(workRoot, "tsfg-undeclared-input-canary.exe");
  copyFileSync(process.env.ComSpec, undeclaredInputCanary);
  runBuildTool(
    "network-canary",
    sandboxExecutable,
    windowsSandboxArguments({ ...basePolicy, boundaryStatus: 123, networkOnly: true }, node, [
      "-e",
      "const n=require('node:net').connect({host:'1.1.1.1',port:443});n.on('connect',()=>process.exit(123));n.on('error',()=>process.exit(0));setTimeout(()=>process.exit(0),1500)",
    ]),
    sourceRoot,
    environment,
    true,
  );
  runBuildTool(
    "undeclared-input-canary",
    sandboxExecutable,
    windowsSandboxArguments({ ...basePolicy, boundaryStatus: 124 }, undeclaredInputCanary, [
      "/d",
      "/s",
      "/c",
      `type "${path.join(undeclaredRoot, "version.json")}" >NUL 2>&1 && exit 124 || exit 0`,
    ]),
    sourceRoot,
    environment,
    true,
  );
}

export function runWindowsSandboxedCapture(
  toolId,
  sandboxExecutable,
  sandboxPolicy,
  executable,
  arguments_,
  cwd,
  environment,
) {
  const result = spawnSync(
    sandboxExecutable ?? executable,
    sandboxExecutable ? windowsSandboxArguments(sandboxPolicy, executable, arguments_) : arguments_,
    {
      cwd,
      encoding: "utf8",
      env: environment,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
      || result.error?.message
      || "unknown failure";
    throwSandboxBoundaryFailure(detail, "build", result.status);
    throw new BuildFailureError(`${toolId} failed: ${detail}`);
  }
  return result;
}
