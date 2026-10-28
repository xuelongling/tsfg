// SPDX-License-Identifier: MIT
import path from "node:path";
import { canonicalize, digest } from "./build-data.mjs";
import { ConfigurationError, ReproducibilityMismatchError } from "./build-errors.mjs";
import { createBuildIdentity } from "./build-identity.mjs";
import { loadReproProducer } from "./build-repro-producer.mjs";

function firstDifferentByte(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? undefined : sharedLength;
}

function compareReproBytes(member, left, right, issueCode = "member-mismatch") {
  if (left.equals(right)) return;
  const offset = firstDifferentByte(left, right);
  throw new ReproducibilityMismatchError(
    member,
    `Reproducibility Set differs at ${member}, byte ${offset}`,
    issueCode,
    { leftSha256: digest(left), offset: String(offset), rightSha256: digest(right) },
  );
}

export function validateReproOptions(options) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const producerA = options.get("--producer-a");
  const producerB = options.get("--producer-b");
  if (!target || !profile || !producerA || !producerB) {
    throw new ConfigurationError(
      "repro-check requires --target, --profile, --producer-a, and --producer-b",
    );
  }
  if (
    !["linux-x86_64-gnu", "windows-x86_64-msvc"].includes(target) ||
    !["debug", "release"].includes(profile)
  ) {
    throw new ConfigurationError("R00 repro-check supports only declared Tier 1 targets and profiles");
  }
  return { producerA, producerB, profile, target };
}

function producerPathIdentity(target, value) {
  const normalized = path.normalize(value).replaceAll("\\", "/");
  return target === "windows-x86_64-msvc" ? normalized.toLowerCase() : normalized;
}

export async function reproCheck(options, runtime, workspaceState, networkCanary) {
  const { producerA, producerB, profile, target } = validateReproOptions(options);
  const first = await loadReproProducer(producerA, target, profile, "first");
  const second = await loadReproProducer(producerB, target, profile, "second");
  if (
    producerPathIdentity(target, first.attestation.workspacePath)
      === producerPathIdentity(target, second.attestation.workspacePath) ||
    producerPathIdentity(target, first.attestation.compilationCache.root)
      === producerPathIdentity(target, second.attestation.compilationCache.root) ||
    first.attestation.buildExecutionId === second.attestation.buildExecutionId ||
    first.root === second.root
  ) {
    throw new ReproducibilityMismatchError(
      "producer-attestation.json",
      "producers must use different absolute workspace and artifact paths",
      "producer-independence",
    );
  }
  if (canonicalize(first.manifest.buildIdentity) !== canonicalize(second.manifest.buildIdentity)) {
    throw new ReproducibilityMismatchError(
      "artifact-manifest.json",
      "producer Build Identities differ",
      "build-identity-mismatch",
    );
  }
  let comparatorIdentity;
  try {
    comparatorIdentity = await createBuildIdentity(
      runtime,
      target,
      profile,
      workspaceState.root,
      first.manifest.buildIdentity.options,
    );
  } catch (error) {
    throw new ReproducibilityMismatchError(
      "comparator-workspace#buildIdentity",
      `cannot derive the current comparator Build Identity: ${error.message}`,
      "build-identity-mismatch",
    );
  }
  if (
    canonicalize(first.manifest.buildIdentity) !== canonicalize(comparatorIdentity.buildIdentity) ||
    canonicalize(first.manifest.buildInputSet) !== canonicalize(comparatorIdentity.buildInputSet) ||
    first.manifest.contractSetId !== comparatorIdentity.contractSetId ||
    first.manifest.productVersion !== comparatorIdentity.productVersion
  ) {
    throw new ReproducibilityMismatchError(
      "comparator-workspace#buildIdentity",
      "producer packages do not match the current comparator Build Identity",
      "build-identity-mismatch",
    );
  }
  const firstEntries = new Map(first.archiveEntries.map(
    (entry) => /** @type {[string, any]} */ ([entry.name, entry]),
  ));
  const secondEntries = new Map(second.archiveEntries.map(
    (entry) => /** @type {[string, any]} */ ([entry.name, entry]),
  ));
  const memberNames = [...new Set([
    ...firstEntries.keys(),
    ...secondEntries.keys(),
  ])]
    .filter((name) => name !== "artifact-manifest.json")
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  for (const member of memberNames) {
    const left = firstEntries.get(member);
    const right = secondEntries.get(member);
    if (!left || !right) {
      throw new ReproducibilityMismatchError(
        member,
        `Reproducibility Set member is ${left ? "missing from second" : "missing from first"}: ${member}`,
        "member-mismatch",
      );
    }
    if (left.mode !== right.mode || left.type !== right.type) {
      throw new ReproducibilityMismatchError(
        member,
        `Reproducibility Set member metadata differs at ${member}`,
        "member-mismatch",
      );
    }
    compareReproBytes(member, left.bytes, right.bytes);
  }
  compareReproBytes(
    "artifact-manifest.json",
    first.manifestBytes,
    second.manifestBytes,
    "manifest-mismatch",
  );
  compareReproBytes(
    first.attestation.archive,
    first.archiveBytes,
    second.archiveBytes,
    "archive-mismatch",
  );
  compareReproBytes(
    `${first.attestation.archive}.checksums.json`,
    first.checksumsBytes,
    second.checksumsBytes,
    "checksums-mismatch",
  );
  return {
    buildExecuted: false,
    buildIdentity: comparatorIdentity.buildIdentity,
    buildInputSet: comparatorIdentity.buildInputSet,
    compared: first.compared,
    comparator: {
      buildIdentityDigest: comparatorIdentity.buildIdentity.digest,
      buildInputSetDigest: comparatorIdentity.buildInputSet.digest,
      workspacePath: workspaceState.root,
    },
    contractSetId: comparatorIdentity.contractSetId,
    excludedSidecars: [
      "build-report",
      "external-attestation",
      "log",
      "signature",
      "trusted-timestamp",
    ],
    networkCanary,
    observedSidecars: { a: first.sidecars, b: second.sidecars },
    producers: [
      {
        archive: first.attestation.archive,
        archiveSha256: digest(first.archiveBytes),
        artifactPath: first.root,
        buildExecutionId: first.attestation.buildExecutionId,
        buildIdentityDigest: first.manifest.buildIdentity.digest,
        checksumsSha256: digest(first.checksumsBytes),
        label: "a",
        workspacePath: first.attestation.workspacePath,
      },
      {
        archive: second.attestation.archive,
        archiveSha256: digest(second.archiveBytes),
        artifactPath: second.root,
        buildExecutionId: second.attestation.buildExecutionId,
        buildIdentityDigest: second.manifest.buildIdentity.digest,
        checksumsSha256: digest(second.checksumsBytes),
        label: "b",
        workspacePath: second.attestation.workspacePath,
      },
    ],
    profile,
    productVersion: comparatorIdentity.productVersion,
    reproducibilitySetDigest: digest(canonicalize({ entries: first.compared, schemaVersion: "1" })),
    target,
  };
}
