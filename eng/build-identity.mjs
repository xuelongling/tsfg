// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { verifiedContractSet } from "./contract-set.mjs";
import { validateMlirSdkInputDeclaration } from "./mlir-sdk.mjs";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { canonicalize, digest, digestFile, readCanonicalJson, readRegularFile } from "./build-data.mjs";
import { BuildFailureError, PackageFailureError } from "./build-errors.mjs";
import { gitOutput } from "./build-git.mjs";
import { repositoryRoot } from "./build-product.mjs";

export async function createProducerEvidence(identity, target, profile, workspacePath, compilationRoot) {
  return {
    buildExecutionId: randomUUID(),
    compilationCache: {
      initialState: "empty",
      root: await realpath(compilationRoot),
      sharing: "none",
    },
    pathCanonicalization: "realpath",
    profile,
    target,
    toolchainClosure: {
      cacheAddressing: "sha256",
      digest: identity.buildIdentity.toolchainClosureDigest,
      objectVerification: "complete",
    },
    workspacePath: await realpath(workspacePath),
  };
}

export function producerEvidenceIssue(producer, target, profile) {
  if (
    typeof producer?.buildExecutionId !== "string" ||
    producer.buildExecutionId.length === 0 ||
    producer.compilationCache?.initialState !== "empty" ||
    typeof producer.compilationCache?.root !== "string" ||
    !path.isAbsolute(producer.compilationCache.root) ||
    producer.compilationCache.sharing !== "none" ||
    producer.pathCanonicalization !== "realpath" ||
    producer.profile !== profile ||
    producer.target !== target ||
    producer.toolchainClosure?.cacheAddressing !== "sha256" ||
    !/^sha256:[0-9a-f]{64}$/.test(producer.toolchainClosure?.digest) ||
    producer.toolchainClosure?.objectVerification !== "complete" ||
    typeof producer.workspacePath !== "string" ||
    !path.isAbsolute(producer.workspacePath)
  ) {
    return "producer does not prove an independent empty compilation cache and reverified content-addressed Toolchain Closure";
  }
  return undefined;
}

export async function validProducerEvidence(producer, identity, target, profile, workspacePath) {
  return (
    !producerEvidenceIssue(producer, target, profile) &&
    producer.toolchainClosure?.digest === identity.buildIdentity.toolchainClosureDigest &&
    producer.workspacePath === await realpath(workspacePath)
  );
}

export async function writeProducerAttestation(publishRoot, archiveName, identity, producer) {
  const name = "producer-attestation.json";
  await writeFile(
    path.join(publishRoot, name),
    `${canonicalize({
      archive: archiveName,
      buildIdentityDigest: identity.buildIdentity.digest,
      ...producer,
      schemaVersion: "1",
    })}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return name;
}

export function compareInputEntries(left, right) {
  const projectOrder = Buffer.from(left.projectId).compare(Buffer.from(right.projectId));
  return projectOrder || Buffer.from(left.path).compare(Buffer.from(right.path));
}

export function sortedUtf8Strings(values) {
  return [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

async function buildInputSet(workspaceRoot) {
  const declaration = await readCanonicalJson(
    path.join(workspaceRoot, "eng", "build-inputs.json"),
    "Build Input declaration",
  );
  if (declaration.schemaVersion === "2") validateMlirSdkInputDeclaration(declaration, canonicalize);
  else if (declaration.schemaVersion !== "1" || !Array.isArray(declaration.entries)) {
    throw new PackageFailureError("unsupported Build Input declaration schema");
  }
  const sortedDeclarations = [...declaration.entries].sort(compareInputEntries);
  if (canonicalize(declaration.entries) !== canonicalize(sortedDeclarations)) {
    throw new PackageFailureError("Build Input declaration must be sorted");
  }
  const identities = new Set();
  const entries = [];
  const epochs = [];
  for (const declared of declaration.entries) {
    if (
      declared?.projectId !== "tsfg" ||
      typeof declared.path !== "string" ||
      declared.path.length === 0 ||
      path.isAbsolute(declared.path) ||
      declared.path.split("/").some((segment) => !segment || segment === "..")
    ) {
      throw new PackageFailureError("invalid Build Input declaration entry");
    }
    const identity = `${declared.projectId}\0${declared.path}`;
    if (identities.has(identity)) {
      throw new PackageFailureError("duplicate Build Input declaration entry");
    }
    identities.add(identity);
    const indexLine = gitOutput(workspaceRoot, [
      "ls-files",
      "--stage",
      "--",
      declared.path,
    ]).trim();
    const match = /^(100644|100755) [0-9a-f]{40} 0\t/.exec(indexLine);
    if (!match) {
      throw new PackageFailureError(`Build Input is not a regular tracked file: ${declared.path}`);
    }
    const epoch = gitOutput(workspaceRoot, [
      "log",
      "-1",
      "--format=%ct",
      "--",
      declared.path,
    ]).trim();
    if (!/^[1-9][0-9]*$/.test(epoch)) {
      throw new PackageFailureError(`Build Input has no last-touch commit: ${declared.path}`);
    }
    epochs.push(BigInt(epoch));
    entries.push({
      projectId: declared.projectId,
      repositoryRelativePath: declared.path,
      normalizedMode: match[1],
      sha256: await digestFile(path.join(workspaceRoot, ...declared.path.split("/"))),
    });
  }
  const payload = { entries, schemaVersion: "1" };
  return {
    buildInputSet: {
      digest: digest(canonicalize(payload)),
      ...payload,
    },
    sourceDateEpoch: String(epochs.reduce((maximum, epoch) => epoch > maximum ? epoch : maximum)),
  };
}

export async function materializeBuildInputs(workspaceRoot, buildInputSet, destination) {
  for (const entry of buildInputSet.entries) {
    const source = path.join(
      workspaceRoot,
      ...entry.repositoryRelativePath.split("/"),
    );
    const bytes = await readRegularFile(
      source,
      `declared Build Input ${entry.repositoryRelativePath}`,
    ).catch((error) => { throw new BuildFailureError(error.message); });
    const target = path.join(
      destination,
      ...entry.repositoryRelativePath.split("/"),
    );
    await mkdir(path.dirname(target), { recursive: true });
    if (digest(bytes) !== entry.sha256) {
      throw new BuildFailureError(
        `declared Build Input changed during materialization: ${entry.repositoryRelativePath}`,
      );
    }
    await writeFile(target, bytes, { flag: "wx" });
    if (process.platform !== "win32") {
      await chmod(target, entry.normalizedMode === "100755" ? 0o755 : 0o644);
    }
  }
}

export async function createBuildIdentity(
  runtime,
  target,
  profile,
  workspaceRoot = repositoryRoot,
  buildOptions = { simdDispatch: "runtime-detected" },
) {
  const version = await readCanonicalJson(path.join(workspaceRoot, "version.json"), "Product Version");
  if (typeof version.version !== "string" || version.version.length === 0) {
    throw new PackageFailureError("Product Version is missing");
  }
  const registry = await readCanonicalJson(
    path.join(workspaceRoot, "contracts", "registry.json"),
    "Contract Registry",
  );
  let contractSet;
  try { contractSet = canonicalize(await verifiedContractSet(workspaceRoot, registry, canonicalize)); }
  catch (error) { throw new PackageFailureError(error.message); }
  const { buildInputSet: inputSet, sourceDateEpoch } = await buildInputSet(workspaceRoot);
  const buildIdentityPayload = {
    buildInputSetDigest: inputSet.digest,
    options: buildOptions,
    profile,
    source_date_epoch: sourceDateEpoch,
    target,
    toolchainClosureDigest: runtime.lockDigest,
  };
  return {
    buildIdentity: {
      ...buildIdentityPayload,
      digest: digest(canonicalize(buildIdentityPayload)),
    },
    buildInputSet: inputSet,
    contractSetId: digest(contractSet),
    contractSet,
    productVersion: version.version,
  };
}
