// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { constants as zlibConstants, zstdCompressSync } from "node:zlib";
import { createTar, createZip } from "./build-archive-writers.mjs";
import { canonicalize, digest, readCanonicalJson, readRegularFile } from "./build-data.mjs";
import { ConfigurationError, OfflineBoundaryError, PackageFailureError, SandboxBoundaryError, UndeclaredInputError, WINDOWS_NETWORK_ISOLATION } from "./build-errors.mjs";
import { createBuildIdentity, materializeBuildInputs, sortedUtf8Strings, validProducerEvidence, writeProducerAttestation } from "./build-identity.mjs";
import { compileSandbox, sandboxArguments } from "./build-linux-sandbox.mjs";
import { payloadOptions } from "./build-options.mjs";
import { createBuildPolicy } from "./build-policy.mjs";
import { buildEnvironment, runPackageTool } from "./build-process.mjs";
import { publishDirectory } from "./build-publication.mjs";
import { closureToolPath } from "./build-toolchain.mjs";
import { verifyWindowsSandboxBoundary, verifyWindowsSandboxControl } from "./build-windows-sandbox.mjs";

export async function packageLinux(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const inputOption = options.get("--input");
  const outputOption = options.get("--out");
  if (!target || !profile || !inputOption || !outputOption) {
    throw new ConfigurationError("package requires --target, --profile, --input, and --out");
  }
  if (target !== "linux-x86_64-gnu" || !["debug", "release"].includes(profile)) {
    throw new ConfigurationError("R00 package supports only linux-x86_64-gnu debug/release");
  }

  const identity = await createBuildIdentity(
    runtime,
    target,
    profile,
    workspaceState.root,
    payloadOptions(options),
  );
  const buildPolicy = createBuildPolicy(target, profile, identity.buildIdentity.options);
  const archiveName = `tsfg-v${identity.productVersion}-${target}-${profile}-${identity.buildIdentity.digest.slice(7, 23)}.tar.zst`;
  const output = path.resolve(outputOption);
  const stagingRoot = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${randomUUID()}.tmp`,
  );
  const packageSandboxRoot = `${stagingRoot}-sandbox`;
  const packageControlRoot = `${stagingRoot}-control`;
  const packageSourceRoot = `${stagingRoot}-source`;
  const publishRoot = path.join(stagingRoot, "publish");
  try {
    await mkdir(publishRoot, { recursive: true });
    const input = path.resolve(inputOption);
    const metadata = await readCanonicalJson(
      path.join(input, "build-metadata.json"),
      "build metadata",
    );
    if (
      canonicalize(metadata.buildIdentity) !== canonicalize(identity.buildIdentity) ||
      canonicalize(metadata.buildInputSet) !== canonicalize(identity.buildInputSet) ||
      canonicalize(metadata.buildPolicy) !== canonicalize(buildPolicy) ||
      metadata.contractSetId !== identity.contractSetId ||
      metadata.development !== false ||
      metadata.dirty !== false ||
      metadata.productVersion !== identity.productVersion ||
      !(await validProducerEvidence(metadata.producer, identity, target, profile, workspaceState.root)) ||
      metadata.publishable !== true ||
      metadata.toolchainClosureDigest !== runtime.lockDigest
    ) {
      throw new PackageFailureError("build metadata does not match the current Build Identity");
    }
    const expectedPayloads = [
      "bin/tsfg-r00-cpp-smoke",
      "bin/tsfg-r00-zig-smoke",
    ];
    if (
      !Array.isArray(metadata.payloads) ||
      canonicalize(sortedUtf8Strings(metadata.payloads.map(({ path: payloadPath }) => payloadPath)))
        !== canonicalize(expectedPayloads)
    ) {
      throw new PackageFailureError("build metadata does not declare the expected smoke payloads");
    }
    const objcopy = closureToolPath(runtime, "llvm", "objcopy");
    const packageEnvironment = buildEnvironment(stagingRoot, [path.dirname(objcopy)]);
    packageEnvironment.SOURCE_DATE_EPOCH = identity.buildIdentity.source_date_epoch;
    let sandboxExecutable;
    let loader;
    let runtimeLibraries;
    if (process.platform === "linux") {
      await materializeBuildInputs(
        workspaceState.root,
        identity.buildInputSet,
        packageSourceRoot,
      );
      const compiled = await compileSandbox(runtime, packageSourceRoot, packageControlRoot);
      sandboxExecutable = compiled.executable;
      const sysroot = path.join(runtime.closurePath, "debian-sysroot");
      loader = path.join(sysroot, "lib", "x86_64-linux-gnu", "ld-linux-x86-64.so.2");
      runtimeLibraries = [
        path.join(sysroot, "lib", "x86_64-linux-gnu"),
        path.join(sysroot, "usr", "lib", "x86_64-linux-gnu"),
      ].join(":");
    }
    const lockedShell = closureToolPath(runtime, "archive-extractor");
    const packageToolArguments = (toolArguments) => sandboxExecutable
      ? sandboxArguments(
          {
            readExecute: [runtime.closurePath, packageControlRoot],
            readWrite: [stagingRoot],
            root: packageSandboxRoot,
            shell: lockedShell,
          },
          loader,
          ["--inhibit-cache", "--library-path", runtimeLibraries, objcopy, ...toolArguments],
        )
      : toolArguments;
    const packageTool = sandboxExecutable ?? objcopy;
    const members = [];
    for (const payload of metadata.payloads) {
      const source = path.join(input, ...payload.path.split("/"));
      const bytes = await readRegularFile(source, `smoke payload ${payload.path}`)
        .catch((error) => { throw new PackageFailureError(error.message); });
      const packagedPayload = path.join(stagingRoot, "members", ...payload.path.split("/"));
      const symbolPath = `symbols/${path.posix.basename(payload.path)}.debug`;
      const packagedSymbol = path.join(stagingRoot, "members", ...symbolPath.split("/"));
      await mkdir(path.dirname(packagedPayload), { recursive: true });
      await mkdir(path.dirname(packagedSymbol), { recursive: true });
      if (digest(bytes) !== payload.sha256) {
        throw new PackageFailureError(`smoke payload digest does not match build metadata: ${payload.path}`);
      }
      await writeFile(packagedPayload, bytes, { flag: "wx" });
      await chmod(packagedPayload, 0o755);
      runPackageTool(
        packageTool,
        packageToolArguments(["--only-keep-debug", packagedPayload, packagedSymbol]),
        stagingRoot,
        packageEnvironment,
        Boolean(sandboxExecutable),
      );
      runPackageTool(
        packageTool,
        packageToolArguments(["--strip-debug", packagedPayload]),
        stagingRoot,
        packageEnvironment,
        Boolean(sandboxExecutable),
      );
      const symbolStat = await stat(packagedSymbol).catch(() => undefined);
      if (!symbolStat?.isFile()) {
        throw new PackageFailureError(`detached symbols were not produced: ${symbolPath}`);
      }
      await chmod(packagedSymbol, 0o644);
      members.push(
        { bytes: await readFile(packagedPayload), mode: 0o755, path: payload.path },
        { bytes: await readFile(packagedSymbol), mode: 0o644, path: symbolPath },
      );
    }
    members.push({ bytes: Buffer.from(identity.contractSet), mode: 0o644, path: "contract-set.json" });
    members.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
    const forbiddenValues = [
      { kind: "workspace", value: workspaceState.root },
      { kind: "toolchain", value: runtime.closurePath },
      { kind: "package-staging", value: stagingRoot },
      { kind: "build-input", value: input },
      { kind: "package-output", value: output },
      { kind: "ci-run-id", value: process.env.CI_RUN_ID },
      { kind: "github-run-id", value: process.env.GITHUB_RUN_ID },
      { kind: "hostname", value: process.env.HOSTNAME },
      { kind: "computer-name", value: process.env.COMPUTERNAME },
    ].filter(({ value }) => typeof value === "string" && value.length > 0);
    for (const { kind, value } of [...forbiddenValues]) {
      forbiddenValues.push(
        { kind, value: value.replaceAll("\\", "/") },
        { kind, value: value.replaceAll("/", "\\") },
      );
    }
    for (const member of members) {
      for (const { kind, value } of forbiddenValues) {
        if (member.bytes.includes(Buffer.from(value))) {
          throw new PackageFailureError(
            `package member contains host-specific ${kind} data: ${member.path}`,
          );
        }
      }
    }
    const artifactManifest = {
      buildPolicy,
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      contractSetId: identity.contractSetId,
      members: members.map((member) => ({
        path: member.path,
        sha256: digest(member.bytes),
      })),
      productVersion: identity.productVersion,
      schemaVersion: "1",
      toolchainClosureDigest: runtime.lockDigest,
    };
    const artifactManifestBytes = Buffer.from(canonicalize(artifactManifest));
    const archiveMembers = [
      { bytes: artifactManifestBytes, mode: 0o644, path: "artifact-manifest.json" },
      ...members,
    ];
    const tar = createTar(
      archiveMembers,
      Number.parseInt(identity.buildIdentity.source_date_epoch, 10),
    );
    const archive = zstdCompressSync(tar, {
      params: {
        [zlibConstants.ZSTD_c_checksumFlag]: 1,
        [zlibConstants.ZSTD_c_compressionLevel]: 19,
        [zlibConstants.ZSTD_c_contentSizeFlag]: 1,
        [zlibConstants.ZSTD_c_nbWorkers]: 0,
      },
    });
    const archivePath = path.join(publishRoot, archiveName);
    await writeFile(archivePath, archive, { flag: "wx" });
    await writeFile(
      `${archivePath}.checksums.json`,
      `${canonicalize({
        archive: { name: archiveName, sha256: digest(archive) },
        artifactManifest: {
          path: "artifact-manifest.json",
          sha256: digest(artifactManifestBytes),
        },
        schemaVersion: "1",
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    const producerAttestation = await writeProducerAttestation(
      publishRoot,
      archiveName,
      identity,
      metadata.producer,
    );
    const publication = await publishDirectory(publishRoot, output, runtime);
    const result = {
      archive: archiveName,
      buildPolicy,
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      checksums: `${archiveName}.checksums.json`,
      contractSetId: identity.contractSetId,
      development: false,
      dirty: false,
      input: path.resolve(inputOption),
      networkCanary,
      producerAttestation,
      publishable: true,
    };
    Object.defineProperty(result, "publication", { value: publication });
    return result;
  } catch (error) {
    if (
      error instanceof ConfigurationError ||
      error instanceof OfflineBoundaryError ||
      error instanceof PackageFailureError ||
      error instanceof SandboxBoundaryError ||
      error instanceof UndeclaredInputError
    ) throw error;
    throw new PackageFailureError(error.message);
  } finally {
    await rm(stagingRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 5 : 0,
      retryDelay: 100,
    });
    await rm(packageSandboxRoot, { recursive: true, force: true });
    await rm(packageControlRoot, { recursive: true, force: true });
    await rm(packageSourceRoot, { recursive: true, force: true });
  }
}

export async function packageWindows(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const inputOption = options.get("--input");
  const outputOption = options.get("--out");
  if (!target || !profile || !inputOption || !outputOption) {
    throw new ConfigurationError("package requires --target, --profile, --input, and --out");
  }
  if (target !== "windows-x86_64-msvc" || !["debug", "release"].includes(profile)) {
    throw new ConfigurationError("R00 package supports only windows-x86_64-msvc debug/release");
  }
  if (process.platform !== "win32") {
    throw new ConfigurationError("windows-x86_64-msvc packages require a Windows host");
  }

  const identity = await createBuildIdentity(
    runtime,
    target,
    profile,
    workspaceState.root,
    payloadOptions(options),
  );
  const buildPolicy = createBuildPolicy(target, profile, identity.buildIdentity.options);
  const archiveName = `tsfg-v${identity.productVersion}-${target}-${profile}-${identity.buildIdentity.digest.slice(7, 23)}.zip`;
  const output = path.resolve(outputOption);
  const input = path.resolve(inputOption);
  const boundaryRoot = await mkdtemp(path.join(tmpdir(), "tsfg-windows-package-"));
  const stagingRoot = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp`);
  const sourceRoot = path.join(boundaryRoot, "source");
  const workRoot = path.join(boundaryRoot, "work");
  const publishRoot = path.join(stagingRoot, "publish");
  try {
    await Promise.all([workRoot, publishRoot].map((directory) => mkdir(directory, { recursive: true })));
    const metadata = await readCanonicalJson(path.join(input, "build-metadata.json"), "build metadata");
    if (
      canonicalize(metadata.buildIdentity) !== canonicalize(identity.buildIdentity) ||
      canonicalize(metadata.buildInputSet) !== canonicalize(identity.buildInputSet) ||
      canonicalize(metadata.buildPolicy) !== canonicalize(buildPolicy) ||
      metadata.contractSetId !== identity.contractSetId ||
      metadata.development !== false ||
      metadata.dirty !== false ||
      metadata.productVersion !== identity.productVersion ||
      !(await validProducerEvidence(metadata.producer, identity, target, profile, workspaceState.root)) ||
      metadata.publishable !== true ||
      metadata.toolchainClosureDigest !== runtime.lockDigest ||
      canonicalize(metadata.networkIsolation) !== canonicalize(WINDOWS_NETWORK_ISOLATION)
    ) {
      throw new PackageFailureError("build metadata does not match the current Build Identity");
    }
    const expectedPayloads = ["bin/tsfg-r00-cpp-smoke.exe", "bin/tsfg-r00-zig-smoke.exe"];
    const expectedSymbols = ["symbols/tsfg-r00-cpp-smoke.pdb", "symbols/tsfg-r00-zig-smoke.pdb"];
    if (
      !Array.isArray(metadata.payloads) ||
      !Array.isArray(metadata.symbols) ||
      canonicalize(sortedUtf8Strings(metadata.payloads.map(({ path: memberPath }) => memberPath)))
        !== canonicalize(expectedPayloads) ||
      canonicalize(sortedUtf8Strings(metadata.symbols.map(({ path: memberPath }) => memberPath)))
        !== canonicalize(expectedSymbols)
    ) {
      throw new PackageFailureError("build metadata does not declare the expected Windows payload and symbol set");
    }
    if (runtime.platform === target) {
      await materializeBuildInputs(workspaceState.root, identity.buildInputSet, sourceRoot);
      const { executable } = await verifyWindowsSandboxControl(runtime);
      verifyWindowsSandboxBoundary(executable, runtime, sourceRoot, workRoot, workspaceState.root);
    }
    const members = [];
    for (const declared of [...metadata.payloads, ...metadata.symbols]) {
      const bytes = await readRegularFile(
        path.join(input, ...declared.path.split("/")),
        `Windows package member ${declared.path}`,
      ).catch((error) => { throw new PackageFailureError(error.message); });
      if (digest(bytes) !== declared.sha256) {
        throw new PackageFailureError(`package member digest does not match build metadata: ${declared.path}`);
      }
      members.push({
        bytes,
        mode: declared.path.startsWith("bin/") ? 0o755 : 0o644,
        path: declared.path,
      });
    }
    members.push({ bytes: Buffer.from(identity.contractSet), mode: 0o644, path: "contract-set.json" });
    const forbiddenValues = new Set([
      workspaceState.root,
      runtime.closurePath,
      stagingRoot,
      input,
      output,
      process.env.CI_RUN_ID,
      process.env.GITHUB_RUN_ID,
      process.env.HOSTNAME,
      process.env.COMPUTERNAME,
    ].filter((value) => typeof value === "string" && value.length > 0));
    for (const value of [...forbiddenValues]) {
      forbiddenValues.add(value.replaceAll("\\", "/"));
      forbiddenValues.add(value.replaceAll("/", "\\"));
    }
    for (const member of members) {
      for (const forbidden of forbiddenValues) {
        if (member.bytes.includes(Buffer.from(forbidden))) {
          throw new PackageFailureError(`package member contains host-specific data: ${member.path}`);
        }
      }
    }
    members.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
    const artifactManifest = {
      buildPolicy,
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      contractSetId: identity.contractSetId,
      members: members.map((member) => ({ path: member.path, sha256: digest(member.bytes) })),
      productVersion: identity.productVersion,
      schemaVersion: "1",
      toolchainClosureDigest: runtime.lockDigest,
    };
    const artifactManifestBytes = Buffer.from(canonicalize(artifactManifest));
    const archive = createZip([
      { bytes: artifactManifestBytes, mode: 0o644, path: "artifact-manifest.json" },
      ...members,
    ], Number.parseInt(identity.buildIdentity.source_date_epoch, 10));
    const archivePath = path.join(publishRoot, archiveName);
    await writeFile(archivePath, archive, { flag: "wx" });
    await writeFile(`${archivePath}.checksums.json`, `${canonicalize({
      archive: { name: archiveName, sha256: digest(archive) },
      artifactManifest: { path: "artifact-manifest.json", sha256: digest(artifactManifestBytes) },
      buildIdentity: identity.buildIdentity,
      schemaVersion: "1",
    })}\n`, { encoding: "utf8", flag: "wx" });
    const producerAttestation = await writeProducerAttestation(
      publishRoot,
      archiveName,
      identity,
      metadata.producer,
    );
    const publication = await publishDirectory(publishRoot, output, runtime);
    const result = {
      archive: archiveName,
      buildPolicy,
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      checksums: `${archiveName}.checksums.json`,
      contractSetId: identity.contractSetId,
      development: false,
      dirty: false,
      input,
      networkCanary,
      networkIsolation: WINDOWS_NETWORK_ISOLATION,
      producerAttestation,
      publishable: true,
    };
    Object.defineProperty(result, "publication", { value: publication });
    return result;
  } catch (error) {
    if (
      error instanceof ConfigurationError ||
      error instanceof OfflineBoundaryError ||
      error instanceof PackageFailureError ||
      error instanceof SandboxBoundaryError ||
      error instanceof UndeclaredInputError
    ) throw error;
    throw new PackageFailureError(error.message);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(boundaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
