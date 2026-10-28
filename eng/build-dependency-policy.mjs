// SPDX-License-Identifier: MIT
import { validateMlirSdkInputDeclaration } from "./mlir-sdk.mjs";
import { TextDecoder } from "node:util";
import { canonicalize, digest } from "./build-data.mjs";
import { WorkspaceMismatchError } from "./build-errors.mjs";
import { compareInputEntries } from "./build-identity.mjs";
import { committedEntryMap, knownLicense, parseCommittedCanonicalJson } from "./build-source-policy.mjs";

function dependencyNotice(entry, product, entryMap) {
  if (entry.notice?.status === "not-required" && Object.keys(entry.notice).length === 1) {
    return "not-required";
  }
  if (
    entry.notice?.status !== "required" ||
    typeof entry.notice.path !== "string" ||
    !/^(?:NOTICE|third_party\/notices\/[a-z0-9._/-]+)$/.test(entry.notice.path) ||
    entryMap.get(entry.notice.path)?.mode === "120000" ||
    !entryMap.get(entry.notice.path)?.bytes.toString("utf8").trim()
  ) {
    throw new WorkspaceMismatchError(
      "dependency-notice",
      `${product.workspacePath} dependency ${entry.id} has no required notice`,
    );
  }
  return entry.notice.path;
}

function pnpmPackages(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const packages = /(?:^|\n)packages:\n([\s\S]*?)(?:\nsnapshots:|$)/.exec(text)?.[1] ?? "";
  return [...packages.matchAll(/^  (.+):$/gm)].map((match) =>
    match[1].replace(/^['"]|['"]$/g, ""),
  );
}

function validDependencyLocation(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function requireDependencyIdentity(id, input) {
  if (
    !/^sha256:[0-9a-f]{64}$/.test(input?.archiveSha256) ||
    !validDependencyLocation(input?.url)
  ) {
    throw new WorkspaceMismatchError(
      "dependency-provenance",
      `dependency input ${id} has no authenticated HTTPS source identity`,
    );
  }
}

function dependencyInputs(toolId, tool, definition) {
  const inputs = [];
  for (const artifact of tool.artifacts ?? []) {
    if (Array.isArray(artifact.archives) && artifact.archives.length !== 0) {
      for (const member of artifact.archives) {
        if (!knownLicense(member.license, definition)) {
          throw new WorkspaceMismatchError(
            "dependency-license",
            `toolchain input ${toolId}/${member.id ?? "member"} has an unknown license`,
          );
        }
        requireDependencyIdentity(`${toolId}/${member.id ?? "member"}`, member);
        inputs.push({
          id: `${toolId}/${member.id}`,
          license: member.license,
          sha256: member.archiveSha256,
          source: member.url,
        });
      }
    } else {
      requireDependencyIdentity(toolId, artifact);
      inputs.push({
        id: toolId,
        license: tool.license,
        sha256: artifact.archiveSha256,
        source: artifact.url,
      });
    }
    if (artifact.bootstrap) {
      requireDependencyIdentity(`${toolId}/bootstrap`, artifact.bootstrap);
      inputs.push({
        id: `${toolId}/bootstrap`,
        license: tool.license,
        sha256: artifact.bootstrap.archiveSha256,
        source: artifact.bootstrap.url,
      });
    }
  }
  return inputs;
}

export function verifyDependencyProvenance(product, entries, definition) {
  const entryMap = committedEntryMap(product, entries);
  const metadata = parseCommittedCanonicalJson(
    product,
    entryMap,
    "eng/dependency-sources.json",
    "dependency-metadata",
  );
  const lock = parseCommittedCanonicalJson(
    product,
    entryMap,
    "eng/toolchains.lock.json",
    "dependency-metadata",
  );
  if (
    metadata.schemaVersion !== "1" ||
    !Array.isArray(metadata.dependencies) ||
    typeof lock.tools !== "object" ||
    lock.tools === null ||
    !Array.isArray(lock.dependencyLocks)
  ) {
    throw new WorkspaceMismatchError(
      "dependency-metadata",
      "dependency source or toolchain metadata has an invalid shape",
    );
  }

  const expected = new Map();
  for (const [toolId, tool] of Object.entries(lock.tools)) {
    if (!knownLicense(tool?.license, definition)) {
      throw new WorkspaceMismatchError(
        "dependency-license",
        `toolchain input ${toolId} has an unknown license`,
      );
    }
    expected.set(`tool:${toolId}`, {
      license: tool.license,
      source: { kind: "toolchain", toolId },
      inputs: dependencyInputs(toolId, tool, definition),
    });
  }
  for (const dependencyLock of lock.dependencyLocks) {
    const lockEntry = entryMap.get(dependencyLock.path);
    if (!lockEntry || dependencyLock.projectId !== "tsfg") {
      throw new WorkspaceMismatchError(
        "dependency-coverage",
        `dependency lock ${dependencyLock.path} is not traceable to the product repository`,
      );
    }
    if (
      !/^sha256:[0-9a-f]{64}$/.test(dependencyLock.sha256) ||
      digest(lockEntry.bytes) !== dependencyLock.sha256
    ) {
      throw new WorkspaceMismatchError(
        "dependency-provenance",
        `dependency lock ${dependencyLock.path} does not match its declared digest`,
      );
    }
    for (const packageId of pnpmPackages(lockEntry.bytes)) {
      expected.set(`pnpm:${packageId}`, {
        source: { kind: "dependency-lock", lockPath: dependencyLock.path, package: packageId },
        inputs: [{ id: packageId, sha256: dependencyLock.sha256, source: dependencyLock.path }],
      });
    }
  }

  const seen = new Set();
  const report = { buildOnly: [], payload: [] };
  for (const entry of metadata.dependencies) {
    const expectedEntry = expected.get(entry?.id);
    if (
      !expectedEntry ||
      seen.has(entry.id) ||
      (entry.scope !== "build-only" && entry.scope !== "payload") ||
      canonicalize(entry.source) !== canonicalize(expectedEntry.source)
    ) {
      throw new WorkspaceMismatchError(
        "dependency-coverage",
        `dependency metadata entry ${entry?.id ?? "<invalid>"} does not trace an actual input`,
      );
    }
    if (
      !knownLicense(entry.license, definition) ||
      (expectedEntry.license !== undefined && entry.license !== expectedEntry.license)
    ) {
      throw new WorkspaceMismatchError(
        "dependency-license",
        `dependency ${entry.id} has an unknown or mismatched license`,
      );
    }
    const notice = dependencyNotice(entry, product, entryMap);
    const item = {
      id: entry.id,
      inputs: expectedEntry.inputs,
      license: entry.license,
      notice,
    };
    report[entry.scope === "build-only" ? "buildOnly" : "payload"].push(item);
    seen.add(entry.id);
  }
  const missing = [...expected.keys()].filter((id) => !seen.has(id));
  if (missing.length !== 0) {
    throw new WorkspaceMismatchError(
      "dependency-coverage",
      `actual dependency inputs lack review metadata: ${missing.join(",")}`,
    );
  }
  report.buildOnly.sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
  report.payload.sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
  return report;
}

export function verifyBuildInputLicenses(product, entries, coverage) {
  const entryMap = committedEntryMap(product, entries);
  const declaration = parseCommittedCanonicalJson(
    product,
    entryMap,
    "eng/build-inputs.json",
    "license-input-coverage",
  );
  if (declaration.schemaVersion === "2") validateMlirSdkInputDeclaration(declaration, canonicalize);
  else if (declaration.schemaVersion !== "1" || !Array.isArray(declaration.entries)) {
    throw new WorkspaceMismatchError(
      "license-input-coverage",
      "Build Input Set declaration has an invalid shape",
    );
  }
  const mechanisms = new Map(coverage.map((entry) => [entry.path, entry.mechanism]));
  const report = [];
  for (const entry of declaration.entries) {
    if (
      entry?.projectId !== "tsfg" ||
      typeof entry.path !== "string" ||
      !entryMap.has(entry.path) ||
      !mechanisms.has(entry.path)
    ) {
      throw new WorkspaceMismatchError(
        "license-input-coverage",
        `Build Input ${entry?.projectId ?? "<invalid>"}:${entry?.path ?? "<invalid>"} lacks first-party license provenance`,
      );
    }
    report.push({
      license: "MIT",
      mechanism: mechanisms.get(entry.path),
      path: entry.path,
      projectId: entry.projectId,
    });
  }
  report.sort(compareInputEntries);
  return report;
}
