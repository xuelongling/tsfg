// SPDX-License-Identifier: MIT
import path from "node:path";
import { readdir } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { parseTar, parseZip } from "./build-archive-readers.mjs";
import { canonicalize, digest, hasLoneSurrogate, readRegularFile } from "./build-data.mjs";
import { ReproducibilityMismatchError } from "./build-errors.mjs";
import { producerEvidenceIssue } from "./build-identity.mjs";

function hasLoneSurrogateInJson(value) {
  if (typeof value === "string") return hasLoneSurrogate(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogateInJson);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, member]) => hasLoneSurrogate(key) || hasLoneSurrogateInJson(member),
    );
  }
  return false;
}

export function parseReproJson(bytes, name, trailingNewline) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ReproducibilityMismatchError(name, `${name} must be I-JSON encoded as UTF-8`);
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw new ReproducibilityMismatchError(name, `${name} must not contain a BOM`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ReproducibilityMismatchError(name, `${name} is not valid JSON: ${error.message}`);
  }
  if (hasLoneSurrogateInJson(value)) {
    throw new ReproducibilityMismatchError(
      name,
      `${name} must use I-JSON strings without lone surrogate code units`,
    );
  }
  const expected = `${canonicalize(value)}${trailingNewline ? "\n" : ""}`;
  if (text !== expected) {
    throw new ReproducibilityMismatchError(name, `${name} must use canonical JSON`);
  }
  return value;
}

function reproSidecarKind(name) {
  if (name === "producer-attestation.json" || name.endsWith(".attestation.json")) {
    return "external-attestation";
  }
  if (name === "build-report.json" || name.endsWith(".report.json")) return "build-report";
  if (name.endsWith(".log")) return "log";
  if (name.endsWith(".sig") || name.endsWith(".signature")) return "signature";
  if (name.endsWith(".trusted-timestamp.json") || name.endsWith(".timestamp")) {
    return "trusted-timestamp";
  }
  return undefined;
}

const REPRO_FULL_DIGEST = /^sha256:[0-9a-f]{64}$/;

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalize(Object.keys(value).sort()) === canonicalize([...keys].sort())
  );
}

function compareBuildInputEntries(left, right) {
  const projectOrder = Buffer.from(left.projectId).compare(Buffer.from(right.projectId));
  return projectOrder || Buffer.from(left.repositoryRelativePath).compare(
    Buffer.from(right.repositoryRelativePath),
  );
}

function validBuildInputEntry(entry) {
  if (!hasExactKeys(entry, [
    "normalizedMode",
    "projectId",
    "repositoryRelativePath",
    "sha256",
  ])) return false;
  if (
    typeof entry.projectId !== "string" ||
    entry.projectId.length === 0 ||
    typeof entry.repositoryRelativePath !== "string" ||
    entry.repositoryRelativePath.length === 0 ||
    !["100644", "100755"].includes(entry.normalizedMode) ||
    !REPRO_FULL_DIGEST.test(entry.sha256)
  ) return false;
  const normalized = path.posix.normalize(entry.repositoryRelativePath);
  return (
    normalized === entry.repositoryRelativePath &&
    normalized !== "." &&
    !normalized.startsWith("../") &&
    !normalized.startsWith("/") &&
    !entry.repositoryRelativePath.includes("\\")
  );
}

export async function loadReproProducer(rootOption, target, profile, label) {
  const root = path.resolve(rootOption);
  const attestationPath = path.join(root, "producer-attestation.json");
  const attestationBytes = await readRegularFile(
    attestationPath,
    `${label} producer attestation`,
  ).catch((error) => {
    throw new ReproducibilityMismatchError("producer-attestation.json", error.message);
  });
  const attestation = parseReproJson(
    attestationBytes,
    "producer-attestation.json",
    true,
  );
  const evidenceIssue = producerEvidenceIssue(attestation, target, profile);
  if (
    evidenceIssue ||
    attestation.schemaVersion !== "1" ||
    typeof attestation.archive !== "string" ||
    !REPRO_FULL_DIGEST.test(attestation.buildIdentityDigest)
  ) {
    throw new ReproducibilityMismatchError(
      "producer-attestation.json",
      `${label} ${evidenceIssue ?? "producer attestation is invalid"}`,
      "producer-independence",
    );
  }
  const extension = target === "windows-x86_64-msvc" ? ".zip" : ".tar.zst";
  if (!attestation.archive.endsWith(extension) || path.basename(attestation.archive) !== attestation.archive) {
    throw new ReproducibilityMismatchError(
      "producer-attestation.json",
      `${label} producer archive does not match target ${target}`,
    );
  }
  const archiveBytes = await readRegularFile(
    path.join(root, attestation.archive),
    `${label} producer archive`,
  ).catch((error) => {
    throw new ReproducibilityMismatchError(attestation.archive, error.message);
  });
  /** @type {any[]} */
  let archiveEntries;
  try {
    archiveEntries = target === "windows-x86_64-msvc"
      ? parseZip(archiveBytes)
      : parseTar(zstdDecompressSync(archiveBytes));
  } catch (error) {
    throw new ReproducibilityMismatchError(attestation.archive, `${label} archive is invalid: ${error.message}`);
  }
  const entryNames = archiveEntries.map(({ name }) => name);
  const sortedNames = [...entryNames].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (canonicalize(entryNames) !== canonicalize(sortedNames) || new Set(entryNames).size !== entryNames.length) {
    throw new ReproducibilityMismatchError(attestation.archive, `${label} archive member order is not canonical`);
  }
  const expectedArchiveMembers = target === "windows-x86_64-msvc"
    ? [
        "artifact-manifest.json",
        "bin/tsfg-r00-cpp-smoke.exe",
        "bin/tsfg-r00-zig-smoke.exe",
        "contract-set.json",
        "symbols/tsfg-r00-cpp-smoke.pdb",
        "symbols/tsfg-r00-zig-smoke.pdb",
      ]
    : [
        "artifact-manifest.json",
        "bin/tsfg-r00-cpp-smoke",
        "bin/tsfg-r00-zig-smoke",
        "contract-set.json",
        "symbols/tsfg-r00-cpp-smoke.debug",
        "symbols/tsfg-r00-zig-smoke.debug",
      ];
  if (canonicalize(entryNames) !== canonicalize(expectedArchiveMembers)) {
    const member = expectedArchiveMembers.find((name) => !entryNames.includes(name))
      ?? entryNames.find((name) => !expectedArchiveMembers.includes(name))
      ?? attestation.archive;
    throw new ReproducibilityMismatchError(
      member,
      `${label} archive does not contain the complete R00 Reproducibility Set`,
      "member-mismatch",
    );
  }
  const entries = new Map(archiveEntries.map(
    (entry) => /** @type {[string, any]} */ ([entry.name, entry]),
  ));
  const manifestEntry = entries.get("artifact-manifest.json");
  if (!manifestEntry) {
    throw new ReproducibilityMismatchError("artifact-manifest.json", `${label} artifact manifest is missing`);
  }
  const manifest = parseReproJson(
    manifestEntry.bytes,
    "artifact-manifest.json",
    false,
  );
  if (
    manifest.schemaVersion !== "1" ||
    manifest.buildIdentity?.digest !== attestation.buildIdentityDigest ||
    manifest.buildIdentity?.target !== target ||
    manifest.buildIdentity?.profile !== profile ||
    manifest.toolchainClosureDigest !== attestation.toolchainClosure.digest ||
    !Array.isArray(manifest.members)
  ) {
    throw new ReproducibilityMismatchError(
      "artifact-manifest.json",
      `${label} artifact manifest identity does not match its producer attestation`,
    );
  }
  const inputSet = manifest.buildInputSet;
  const inputSetPayload = {
    entries: inputSet?.entries,
    schemaVersion: inputSet?.schemaVersion,
  };
  const sortedInputEntries = Array.isArray(inputSet?.entries)
    ? [...inputSet.entries].sort(compareBuildInputEntries)
    : [];
  const inputIdentities = new Set(
    sortedInputEntries.map((entry) => `${entry?.projectId}\0${entry?.repositoryRelativePath}`),
  );
  if (
    !hasExactKeys(inputSet, ["digest", "entries", "schemaVersion"]) ||
    inputSet?.schemaVersion !== "1" ||
    !Array.isArray(inputSet.entries) ||
    !inputSet.entries.every(validBuildInputEntry) ||
    inputIdentities.size !== inputSet.entries.length ||
    canonicalize(inputSet.entries) !== canonicalize(sortedInputEntries) ||
    !REPRO_FULL_DIGEST.test(inputSet.digest) ||
    digest(canonicalize(inputSetPayload)) !== inputSet.digest ||
    manifest.buildIdentity.buildInputSetDigest !== inputSet.digest
  ) {
    throw new ReproducibilityMismatchError(
      "artifact-manifest.json#buildInputSet",
      `${label} Build Input Set digest is invalid`,
      "build-identity-mismatch",
    );
  }
  const claimedBuildIdentityDigest = manifest.buildIdentity.digest;
  const buildIdentityPayload = {
    buildInputSetDigest: manifest.buildIdentity.buildInputSetDigest,
    options: manifest.buildIdentity.options,
    profile: manifest.buildIdentity.profile,
    source_date_epoch: manifest.buildIdentity.source_date_epoch,
    target: manifest.buildIdentity.target,
    toolchainClosureDigest: manifest.buildIdentity.toolchainClosureDigest,
  };
  if (
    !hasExactKeys(manifest.buildIdentity, [
      "buildInputSetDigest",
      "digest",
      "options",
      "profile",
      "source_date_epoch",
      "target",
      "toolchainClosureDigest",
    ]) ||
    !REPRO_FULL_DIGEST.test(claimedBuildIdentityDigest) ||
    !REPRO_FULL_DIGEST.test(manifest.buildIdentity.buildInputSetDigest) ||
    !REPRO_FULL_DIGEST.test(manifest.buildIdentity.toolchainClosureDigest) ||
    !/^[1-9][0-9]*$/.test(manifest.buildIdentity.source_date_epoch) ||
    digest(canonicalize(buildIdentityPayload)) !== claimedBuildIdentityDigest
  ) {
    throw new ReproducibilityMismatchError(
      "artifact-manifest.json#buildIdentity",
      `${label} Build Identity digest is invalid`,
      "build-identity-mismatch",
    );
  }
  const expectedArchive = `tsfg-v${manifest.productVersion}-${target}-${profile}-${claimedBuildIdentityDigest.slice(7, 23)}${extension}`;
  if (attestation.archive !== expectedArchive) {
    throw new ReproducibilityMismatchError(
      "producer-attestation.json",
      `${label} archive name does not represent its complete Build Identity`,
      "build-identity-mismatch",
    );
  }
  const sourceDateEpoch = Number.parseInt(manifest.buildIdentity.source_date_epoch, 10);
  const zipDate = new Date(Math.max(sourceDateEpoch * 1000, Date.UTC(1980, 0, 1)));
  const expectedDosTime = (zipDate.getUTCHours() << 11) | (zipDate.getUTCMinutes() << 5)
    | Math.floor(zipDate.getUTCSeconds() / 2);
  const expectedDosDate = ((zipDate.getUTCFullYear() - 1980) << 9)
    | ((zipDate.getUTCMonth() + 1) << 5) | zipDate.getUTCDate();
  for (const entry of archiveEntries) {
    const expectedMode = entry.name.startsWith("bin/") ? 0o755 : 0o644;
    const normalizedPath = path.posix.normalize(entry.name);
    const unsafePath = (
      !entry.name ||
      normalizedPath !== entry.name ||
      normalizedPath.startsWith("../") ||
      normalizedPath.startsWith("/") ||
      entry.name.includes("\\")
    );
    const nonCanonicalMetadata = target === "linux-x86_64-gnu"
      ? entry.uid !== 0 || entry.gid !== 0 || entry.mtime !== sourceDateEpoch
      : entry.dosTime !== expectedDosTime || entry.dosDate !== expectedDosDate;
    if (
      unsafePath ||
      entry.type !== "0" ||
      entry.mode !== expectedMode ||
      nonCanonicalMetadata
    ) {
      throw new ReproducibilityMismatchError(
        entry.name || attestation.archive,
        `${label} archive member metadata is not canonical: ${entry.name || "<empty>"}`,
        "archive-normalization",
      );
    }
  }
  const declaredPaths = manifest.members.map(({ path: memberPath }) => memberPath);
  if (
    new Set(declaredPaths).size !== declaredPaths.length ||
    canonicalize(declaredPaths) !== canonicalize(
      [...declaredPaths].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
    ) ||
    canonicalize(declaredPaths) !== canonicalize(entryNames.filter((name) => name !== "artifact-manifest.json"))
  ) {
    throw new ReproducibilityMismatchError(
      "artifact-manifest.json",
      `${label} artifact manifest does not declare every archive member`,
    );
  }
  for (const member of manifest.members) {
    const entry = entries.get(member.path);
    if (!entry || digest(entry.bytes) !== member.sha256) {
      throw new ReproducibilityMismatchError(
        member.path,
        `${label} archive member does not match Artifact Manifest: ${member.path}`,
      );
    }
  }
  const contractSetEntry = entries.get("contract-set.json");
  if (!contractSetEntry) {
    throw new ReproducibilityMismatchError(
      "contract-set.json",
      `${label} Contract Set is missing`,
      "member-mismatch",
    );
  }
  const contractSet = parseReproJson(contractSetEntry.bytes, "contract-set.json", false);
  if (
    !contractSetEntry.bytes.equals(Buffer.from(canonicalize(contractSet))) ||
    manifest.contractSetId !== digest(canonicalize(contractSet))
  ) {
    throw new ReproducibilityMismatchError(
      "contract-set.json",
      `${label} Contract Set ID is invalid`,
      "member-mismatch",
    );
  }
  const checksumsName = `${attestation.archive}.checksums.json`;
  const checksumsBytes = await readRegularFile(
    path.join(root, checksumsName),
    `${label} external checksums`,
  ).catch((error) => {
    throw new ReproducibilityMismatchError(checksumsName, error.message);
  });
  const checksums = parseReproJson(checksumsBytes, checksumsName, true);
  if (
    checksums.schemaVersion !== "1" ||
    checksums.archive?.name !== attestation.archive ||
    checksums.archive?.sha256 !== digest(archiveBytes) ||
    checksums.artifactManifest?.path !== "artifact-manifest.json" ||
    checksums.artifactManifest?.sha256 !== digest(manifestEntry.bytes)
  ) {
    throw new ReproducibilityMismatchError(
      checksumsName,
      `${label} external checksums do not bind the archive and Artifact Manifest`,
    );
  }
  const expectedBundleEntries = new Set([
    attestation.archive,
    checksumsName,
    "producer-attestation.json",
  ]);
  const sidecars = [];
  const bundleEntries = await readdir(root, { withFileTypes: true });
  bundleEntries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  for (const entry of bundleEntries) {
    if (expectedBundleEntries.has(entry.name)) {
      if (!entry.isFile()) {
        throw new ReproducibilityMismatchError(
          entry.name,
          `${label} bundle member is not a regular file: ${entry.name}`,
          "unexpected-bundle-member",
        );
      }
      continue;
    }
    const kind = entry.isFile() ? reproSidecarKind(entry.name) : undefined;
    if (!kind) {
      throw new ReproducibilityMismatchError(
        entry.name,
        `${label} bundle contains an unclassified member: ${entry.name}`,
        "unexpected-bundle-member",
      );
    }
    sidecars.push({ kind, path: entry.name });
  }
  sidecars.push({ kind: "external-attestation", path: "producer-attestation.json" });
  sidecars.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const compared = archiveEntries.map((entry) => ({
    path: `archive/${entry.name}`,
    sha256: digest(entry.bytes),
  }));
  compared.push(
    { path: `package/${attestation.archive}`, sha256: digest(archiveBytes) },
    { path: `package/${checksumsName}`, sha256: digest(checksumsBytes) },
  );
  return {
    archiveBytes,
    archiveEntries,
    attestation,
    checksumsBytes,
    compared,
    manifest,
    manifestBytes: manifestEntry.bytes,
    root,
    sidecars,
  };
}
