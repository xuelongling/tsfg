// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { canonicalize, digest, readCanonicalJson, readRegularFile } from "./build-data.mjs";
import { ConfigurationError, TestFailureError, WINDOWS_NETWORK_ISOLATION, WorkspaceMismatchError } from "./build-errors.mjs";
import { createBuildIdentity, materializeBuildInputs } from "./build-identity.mjs";
import { compileSandbox } from "./build-linux-sandbox.mjs";
import { verifyOfflineBoundary } from "./build-offline-boundary.mjs";
import { payloadOptions } from "./build-options.mjs";
import { createBuildPolicy } from "./build-policy.mjs";
import { loadReproProducer } from "./build-repro-producer.mjs";
import { observeHostPlatform, runSmokeExecutable } from "./build-runtime-execution.mjs";
import { closureToolPath } from "./build-toolchain.mjs";
import { verifyWindowsSandboxBoundary, verifyWindowsSandboxControl } from "./build-windows-sandbox.mjs";

export async function testPackageRuntime(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const host = await observeHostPlatform(target);
  if (!runtime) {
    throw new TestFailureError(
      "package runtime smoke requires the verified target Toolchain Closure",
      "runtime-closure",
    );
  }
  let bundle;
  try {
    bundle = await loadReproProducer(
      options.get("--package"),
      target,
      profile,
      "runtime smoke",
    );
  } catch (error) {
    throw new TestFailureError(error.message, "package-integrity");
  }
  let identity;
  try {
    identity = await createBuildIdentity(
      runtime,
      target,
      profile,
      workspaceState.root,
      bundle.manifest.buildIdentity.options,
    );
  } catch (error) {
    throw new TestFailureError(
      `cannot derive package runtime Build Identity: ${error.message}`,
      "build-identity-mismatch",
    );
  }
  if (
    canonicalize(bundle.manifest.buildIdentity) !== canonicalize(identity.buildIdentity) ||
    canonicalize(bundle.manifest.buildInputSet) !== canonicalize(identity.buildInputSet) ||
    bundle.manifest.contractSetId !== identity.contractSetId
  ) {
    throw new TestFailureError(
      "package Build Identity does not match the current workspace and Toolchain Closure",
      "build-identity-mismatch",
    );
  }
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), "tsfg-package-runtime-"));
  try {
    const suffix = target === "windows-x86_64-msvc" ? ".exe" : "";
    const cases = [
      {
        name: "cpp-package-smoke",
        path: `bin/tsfg-r00-cpp-smoke${suffix}`,
        stderr: "",
        stdout: target === "windows-x86_64-msvc"
          ? "tsfg-r00-cpp-smoke: ok\r\n"
          : "tsfg-r00-cpp-smoke: ok\n",
      },
      {
        name: "zig-package-smoke",
        path: `bin/tsfg-r00-zig-smoke${suffix}`,
        stderr: "tsfg-r00-zig-smoke: ok\n",
        stdout: "",
      },
    ];
    let sandboxExecutable;
    if (target === "windows-x86_64-msvc") {
      if (!runtime || runtime.platform !== target) {
        throw new TestFailureError(
          "Windows package runtime smoke requires the verified target Toolchain Closure",
          "package-runtime-smoke",
        );
      }
      sandboxExecutable = (await verifyWindowsSandboxControl(runtime)).executable;
    }
    const entries = new Map(bundle.archiveEntries.map(
      (entry) => /** @type {[string, any]} */ ([entry.name, entry]),
    ));
    const tests = [];
    for (const smoke of cases) {
      const entry = entries.get(smoke.path);
      if (!entry) throw new TestFailureError(`package member is missing: ${smoke.path}`, "package-integrity");
      const executable = path.join(runtimeRoot, path.basename(smoke.path));
      await writeFile(executable, entry.bytes, { flag: "wx" });
      if (process.platform !== "win32") await chmod(executable, 0o755);
      const observed = runSmokeExecutable(
        smoke.name,
        executable,
        runtimeRoot,
        runtime,
        sandboxExecutable,
        runtimeRoot,
        undefined,
        workspaceState.root,
        [],
        "native-host",
      );
      if (observed.stdout !== smoke.stdout || observed.stderr !== smoke.stderr) {
        throw new TestFailureError(
          `${smoke.name} produced unexpected output: ${JSON.stringify(observed)}`,
          "package-runtime-smoke",
        );
      }
      tests.push({ name: smoke.name, status: "passed" });
    }
    const afterCanary = await verifyOfflineBoundary();
    return {
      buildIdentity: bundle.manifest.buildIdentity,
      contractSetId: bundle.manifest.contractSetId,
      host,
      networkCanary,
      networkCanaries: { before: networkCanary, after: afterCanary },
      ...(target === "windows-x86_64-msvc" ? { networkIsolation: WINDOWS_NETWORK_ISOLATION } : {}),
      package: {
        archive: bundle.attestation.archive,
        archiveSha256: digest(bundle.archiveBytes),
        artifactManifestSha256: digest(bundle.manifestBytes),
      },
      profile,
      publishable: true,
      target,
      tests,
      toolchainClosureDigest: bundle.manifest.toolchainClosureDigest,
    };
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export async function testSmoke(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const outputOption = options.get("--out");
  if (!target || !profile || !outputOption) {
    throw new ConfigurationError("test requires --target, --profile, and --out");
  }
  if (
    !["linux-x86_64-gnu", "windows-x86_64-msvc"].includes(target) ||
    !["debug", "release"].includes(profile)
  ) {
    throw new ConfigurationError("R00 test supports only declared Linux and Windows debug/release targets");
  }
  if (target === "windows-x86_64-msvc" && process.platform !== "win32") {
    throw new ConfigurationError("windows-x86_64-msvc tests require a Windows host");
  }

  const output = path.resolve(outputOption);
  const testRoot = target === "windows-x86_64-msvc"
    ? await mkdtemp(path.join(tmpdir(), "tsfg-windows-test-"))
    : path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.test`);
  let metadata;
  try {
    metadata = await readCanonicalJson(
      path.join(output, "build-metadata.json"),
      "Build Metadata",
    );
  } catch (error) {
    throw new TestFailureError(`cannot validate Build Metadata: ${error.message}`);
  }
  if (
    metadata?.buildIdentity?.target !== target ||
    metadata?.buildIdentity?.profile !== profile ||
    canonicalize(metadata?.buildPolicy) !== canonicalize(
      createBuildPolicy(target, profile, payloadOptions(options)),
    ) ||
    typeof metadata.development !== "boolean" ||
    typeof metadata.dirty !== "boolean" ||
    typeof metadata.publishable !== "boolean"
  ) {
    throw new TestFailureError("Build Metadata does not match the requested test target");
  }
  if (
    target === "windows-x86_64-msvc" &&
    canonicalize(metadata.networkIsolation) !== canonicalize(WINDOWS_NETWORK_ISOLATION)
  ) {
    throw new TestFailureError("Build Metadata does not prove Windows network isolation");
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
    throw new TestFailureError(`cannot derive test Build Identity: ${error.message}`);
  }
  if (
    canonicalize(metadata.buildIdentity) !== canonicalize(identity.buildIdentity) ||
    canonicalize(metadata.buildInputSet) !== canonicalize(identity.buildInputSet)
  ) {
    throw new TestFailureError("Build Metadata does not match the current Build Identity");
  }
  if (metadata.development && !workspaceState.development) {
    throw new WorkspaceMismatchError(
      "development-mode-required",
      "testing a development build requires --dev",
    );
  }
  let sandboxExecutable;
  let sandboxRoot;
  let lockedShell;
  if (process.platform === "linux") {
    const sourceRoot = path.join(testRoot, "source");
    const controlRoot = path.join(testRoot, "control");
    await materializeBuildInputs(workspaceState.root, identity.buildInputSet, sourceRoot);
    const compiled = await compileSandbox(runtime, sourceRoot, controlRoot);
    sandboxExecutable = compiled.executable;
    sandboxRoot = path.join(
      path.dirname(output),
      `.${path.basename(output)}.${randomUUID()}.test-sandbox`,
    );
    lockedShell = closureToolPath(runtime, "archive-extractor");
  } else if (target === "windows-x86_64-msvc" && runtime.platform === target) {
    const sourceRoot = path.join(testRoot, "source");
    await materializeBuildInputs(workspaceState.root, identity.buildInputSet, sourceRoot);
    const compiled = await verifyWindowsSandboxControl(runtime);
    sandboxExecutable = compiled.executable;
    sandboxRoot = path.join(testRoot, "work");
    await mkdir(sandboxRoot, { recursive: true });
    verifyWindowsSandboxBoundary(
      sandboxExecutable,
      runtime,
      sourceRoot,
      sandboxRoot,
      workspaceState.root,
    );
  }
  const executableSuffix = target === "windows-x86_64-msvc" ? ".exe" : "";
  const cpuFixture = options.get("--cpu-fixture");
  const cases = [
    {
      arguments: [],
      source: path.join(output, "bin", `tsfg-r00-cpp-smoke${executableSuffix}`),
      name: "cpp-smoke",
      stderr: "",
      stdout: target === "windows-x86_64-msvc"
        ? "tsfg-r00-cpp-smoke: ok\r\n"
        : "tsfg-r00-cpp-smoke: ok\n",
    },
    ...(cpuFixture === "x86-64-v2" ? [{
      arguments: ["--cpu-fixture=x86-64-v2"],
      source: path.join(output, "bin", `tsfg-r00-cpp-smoke${executableSuffix}`),
      name: "cpp-smoke-baseline-fallback",
      stderr: "",
      stdout: target === "windows-x86_64-msvc"
        ? "tsfg-r00-cpp-smoke: baseline fallback ok\r\n"
        : "tsfg-r00-cpp-smoke: baseline fallback ok\n",
    }] : []),
    {
      arguments: [],
      source: path.join(output, "bin", `tsfg-r00-zig-smoke${executableSuffix}`),
      name: "zig-smoke",
      stderr: "tsfg-r00-zig-smoke: ok\n",
      stdout: "",
    },
  ];
  if (
    !Array.isArray(metadata.payloads) ||
    canonicalize(metadata.payloads.map(({ path: payloadPath }) => payloadPath))
      !== canonicalize([...new Set(cases.map(
        ({ source }) => path.relative(output, source).replaceAll("\\", "/"),
      ))])
  ) {
    throw new TestFailureError("Build Metadata does not declare the expected smoke payloads");
  }
  const tests = [];
  try {
    for (const smoke of cases) {
      const bytes = await readRegularFile(smoke.source, `${smoke.name} executable`)
        .catch((error) => { throw new TestFailureError(error.message); });
      const relativeSource = path.relative(output, smoke.source).replaceAll("\\", "/");
      const declaredPayload = metadata.payloads.find(({ path: payloadPath }) =>
        payloadPath === relativeSource);
      // CPU fixture cases can share a payload; keep each exclusive write separate.
      const executable = path.join(testRoot, smoke.name, ...declaredPayload.path.split("/"));
      await mkdir(path.dirname(executable), { recursive: true });
      if (digest(bytes) !== declaredPayload.sha256) {
        throw new TestFailureError(`${smoke.name} executable does not match Build Metadata`);
      }
      await writeFile(executable, bytes, { flag: "wx" });
      if (process.platform !== "win32") await chmod(executable, 0o755);
      const observed = runSmokeExecutable(
        smoke.name,
        executable,
        testRoot,
        runtime,
        sandboxExecutable,
        sandboxRoot,
        lockedShell,
        workspaceState.root,
        smoke.arguments,
        target === "linux-x86_64-gnu" && smoke.name === "zig-smoke"
          ? "direct-executable"
          : "toolchain-runtime",
      );
      if (observed.stdout !== smoke.stdout || observed.stderr !== smoke.stderr) {
        throw new TestFailureError(
          `${smoke.name} produced unexpected output: ${JSON.stringify(observed)}`,
        );
      }
      tests.push({ name: smoke.name, status: "passed" });
    }
  } finally {
    if (sandboxRoot) await rm(sandboxRoot, { recursive: true, force: true });
    await rm(testRoot, { recursive: true, force: true });
  }
  return {
    buildIdentity: identity.buildIdentity,
    buildPolicy: metadata.buildPolicy,
    development: metadata.development || workspaceState.development,
    dirty: metadata.dirty || workspaceState.dirty,
    ...(cpuFixture ? { cpuFixture } : {}),
    networkCanary,
    ...(target === "windows-x86_64-msvc"
      ? { networkIsolation: WINDOWS_NETWORK_ISOLATION }
      : {}),
    profile,
    publishable: metadata.publishable && workspaceState.publishable,
    target,
    tests,
  };
}
