// SPDX-License-Identifier: MIT
import path from "node:path";
import { lstatSync, readdirSync } from "node:fs";
import { TextDecoder } from "node:util";
import { canonicalize, digest } from "./build-data.mjs";
import { WorkspaceMismatchError } from "./build-errors.mjs";
import { committedBlob, gitOutput } from "./build-git.mjs";

function decodePortablePath(repository, entry) {
  if (entry.pathBytes.some((byte) => byte < 0x20 || byte > 0x7e)) {
    throw new WorkspaceMismatchError(
      "path-ascii-lowercase",
      `${repository.workspacePath} contains a non-ASCII repository path`,
    );
  }
  return entry.pathBytes.toString("ascii");
}

export function verifyPortablePaths(repository, entries, definition) {
  const paths = entries.map((entry) => decodePortablePath(repository, entry));
  const folded = new Map();
  for (const relativePath of paths) {
    const segments = relativePath.split("/");
    for (let length = 1; length <= segments.length; length += 1) {
      const prefix = segments.slice(0, length).join("/");
      const key = prefix.toLowerCase();
      const previous = folded.get(key);
      if (previous !== undefined && previous !== prefix) {
        throw new WorkspaceMismatchError(
          "path-case-collision",
          `${repository.workspacePath}/${prefix} collides with ${repository.workspacePath}/${previous}`,
        );
      }
      folded.set(key, prefix);
    }
  }

  const whitelist = new Set(definition.pathCasingWhitelist);
  const controlPaths = new Set(definition.controlPathCasingWhitelist
    .filter((entry) => entry.projectId === repository.id).map((entry) => entry.path));
  const maximum = Number.parseInt(definition.maxRelativePathLength, 10);
  for (const [index, relativePath] of paths.entries()) {
    if (Buffer.byteLength(relativePath, "ascii") > maximum) {
      throw new WorkspaceMismatchError(
        "path-too-long",
        `${repository.workspacePath}/${relativePath} exceeds ${maximum} repository-relative characters`,
      );
    }
    const segments = relativePath.split("/");
    for (const [segmentIndex, segment] of segments.entries()) {
      if (/[. ]$/.test(segment)) {
        throw new WorkspaceMismatchError(
          "path-trailing-dot-space",
          `${repository.workspacePath}/${relativePath} contains a trailing dot or space`,
        );
      }
      const stem = segment.split(".", 1)[0].toLowerCase();
      if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem)) {
        throw new WorkspaceMismatchError(
          "path-windows-reserved",
          `${repository.workspacePath}/${relativePath} contains a Windows reserved name`,
        );
      }
      const controlException = controlPaths.has(relativePath) ||
        (controlPaths.has("skills/**/SKILL.md") && /^skills\/(?:[a-z0-9._-]+\/)+SKILL\.md$/.test(relativePath));
      const basenameException =
        segmentIndex === segments.length - 1 && whitelist.has(segment);
      if (!/^[a-z0-9._-]+$/.test(segment) && !basenameException && !controlException) {
        throw new WorkspaceMismatchError(
          "path-ascii-lowercase",
          `${repository.workspacePath}/${relativePath} is not a portable lowercase path or a versioned exception`,
        );
      }
    }
    if (entries[index].mode === "120000") {
      throw new WorkspaceMismatchError(
        "repository-symlink",
        `${repository.workspacePath}/${relativePath} is a repository symlink; only manifest-managed Agent Activation Surface links are allowed outside repositories`,
      );
    }
  }
}

function matchesPolicyPattern(relativePath, pattern) {
  if (pattern.startsWith("**/*")) return relativePath.endsWith(pattern.slice(4));
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  }
  return relativePath === pattern;
}

export function licenseMapping(relativePath, definition) {
  return definition.licenseMappings.find((mapping) =>
    matchesPolicyPattern(relativePath, mapping.pattern),
  );
}

export function verifyTrackedText(repository, entry, mapping) {
  if (entry.mode === "120000") return;
  if (mapping?.contentKind === "binary") return;
  const bytes = committedBlob(repository.root, entry.oid);
  const relativePath = entry.pathBytes.toString("utf8");
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new WorkspaceMismatchError(
      "text-bom",
      `${repository.workspacePath}/${relativePath} contains a UTF-8 BOM`,
    );
  }
  if (bytes.includes(0x00)) {
    throw new WorkspaceMismatchError(
      "text-encoding",
      `${repository.workspacePath}/${relativePath} is not valid UTF-8 text`,
    );
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new WorkspaceMismatchError(
      "text-encoding",
      `${repository.workspacePath}/${relativePath} is not valid UTF-8`,
    );
  }
  if (bytes.includes(0x0d)) {
    throw new WorkspaceMismatchError(
      "text-line-endings",
      `${repository.workspacePath}/${relativePath} does not use canonical LF line endings`,
    );
  }
}

export function verifyLineEndingAttributes(repository, entries) {
  const attributes = entries.find(
    (entry) => entry.pathBytes.toString("ascii") === ".gitattributes",
  );
  if (!attributes || attributes.mode === "120000") {
    throw new WorkspaceMismatchError(
      "text-attributes",
      `${repository.workspacePath}/.gitattributes is missing`,
    );
  }
  const lines = committedBlob(repository.root, attributes.oid)
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .sort();
  const expected = [
    "* text=auto eol=lf",
    "*.bat text eol=crlf",
    "*.cmd text eol=crlf",
  ].sort();
  if (canonicalize(lines) !== canonicalize(expected)) {
    throw new WorkspaceMismatchError(
      "text-attributes",
      `${repository.workspacePath}/.gitattributes must enforce LF Git text and CRLF checkout only for .cmd/.bat`,
    );
  }
}

function isSpdxSource(relativePath, bytes, definition) {
  if (definition.nonAnnotatablePaths.includes(relativePath)) return false;
  const basename = path.posix.basename(relativePath);
  const extension = path.posix.extname(relativePath).toLowerCase();
  return (
    definition.spdxSourceNames.includes(basename) ||
    definition.spdxSourceExtensions.includes(extension) ||
    (extension === "" && bytes.subarray(0, 2).toString("ascii") === "#!")
  );
}

export function verifyFirstPartyLicense(repository, entries, definition) {
  const licenseEntry = entries.find(
    (entry) => entry.pathBytes.toString("ascii") === "LICENSE" && entry.mode !== "120000",
  );
  const licenseBytes = licenseEntry
    ? committedBlob(repository.root, licenseEntry.oid)
    : Buffer.alloc(0);
  const licenseText = new TextDecoder("utf-8", { fatal: true }).decode(licenseBytes);
  if (
    digest(licenseBytes) !== definition.firstPartyLicenseSha256 ||
    !licenseText.includes("Copyright (c) 2026 xuelongling\n")
  ) {
    throw new WorkspaceMismatchError(
      "license-root",
      `${repository.workspacePath}/LICENSE must declare MIT and copyright holder xuelongling`,
    );
  }

  const coverage = [];
  for (const entry of entries) {
    const relativePath = entry.pathBytes.toString("ascii");
    const bytes = committedBlob(repository.root, entry.oid);
    const mapping = licenseMapping(relativePath, definition);
    if (isSpdxSource(relativePath, bytes, definition)) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (
        !/^(?:\/\/|#|@?rem) SPDX-License-Identifier: MIT$/imu.test(text) &&
        !/^<!-- SPDX-License-Identifier: MIT -->$/mu.test(text)
      ) {
        throw new WorkspaceMismatchError(
          "license-spdx",
          `${repository.workspacePath}/${relativePath} lacks SPDX-License-Identifier: MIT`,
        );
      }
      coverage.push({ mechanism: "spdx", path: relativePath });
    } else if (mapping !== undefined) {
      coverage.push({ mechanism: "mapping", path: relativePath });
    } else {
      throw new WorkspaceMismatchError(
        "license-coverage",
        `${repository.workspacePath}/${relativePath} has no machine-readable MIT license mapping`,
      );
    }
  }
  return coverage;
}

export function committedEntryMap(repository, entries) {
  return new Map(
    entries.map((entry) => [
      entry.pathBytes.toString("ascii"),
      { ...entry, bytes: entry.mode === "160000" ? undefined : committedBlob(repository.root, entry.oid) },
    ]),
  );
}

export function parseCommittedCanonicalJson(repository, entryMap, relativePath, code) {
  const entry = entryMap.get(relativePath);
  if (!entry || entry.mode === "120000") {
    throw new WorkspaceMismatchError(code, `${repository.workspacePath}/${relativePath} is missing`);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.bytes);
  } catch {
    throw new WorkspaceMismatchError(
      code,
      `${repository.workspacePath}/${relativePath} must be I-JSON encoded as UTF-8`,
    );
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new WorkspaceMismatchError(
      code,
      `${repository.workspacePath}/${relativePath} is not valid JSON`,
    );
  }
  let canonical;
  try {
    canonical = canonicalize(value);
  } catch (error) {
    throw new WorkspaceMismatchError(
      code,
      `${repository.workspacePath}/${relativePath} is not I-JSON: ${error.message}`,
    );
  }
  if (text !== canonical && text !== `${canonical}\n`) {
    throw new WorkspaceMismatchError(
      code,
      `${repository.workspacePath}/${relativePath} is not canonical JSON`,
    );
  }
  return value;
}

export function knownLicense(value, definition) {
  return typeof value === "string" && definition.approvedLicenseExpressions.includes(value);
}

function parseUpstreamToml(bytes) {
  const values = {};
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  for (const sourceLine of text.split("\n")) {
    const line = sourceLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([a-z_]+)\s*=\s*"([^"\r\n]+)"$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) return undefined;
    values[match[1]] = match[2];
  }
  return values;
}

function verifySourceFileBytes(repository, entries, approval, entryMap) {
  const mappings = new Map(approval.files.map((file) => [file.path, file]));
  const retained = new Set(["UPSTREAM.toml", ...Object.values(approval.legal)]);
  const blobs = entries.filter((entry) => entry.mode !== "160000");
  for (let offset = 0; offset < blobs.length; offset += 128) {
    const batch = blobs.slice(offset, offset + 128);
    const output = gitOutput(repository.root, ["cat-file", "--batch"], "buffer", batch.map((entry) => `${entry.oid}\n`).join(""));
    let cursor = 0;
    for (const entry of batch) {
      const end = output.indexOf(10, cursor);
      const [oid, type, length] = output.subarray(cursor, end).toString("ascii").split(" ");
      const size = Number(length);
      if (end < cursor || oid !== entry.oid || type !== "blob" || !Number.isSafeInteger(size) || size < 0 ||
          end + size + 1 >= output.length || output[end + size + 1] !== 10) {
        throw new WorkspaceMismatchError("source-admission", "invalid Git source batch response");
      }
      const bytes = output.subarray(end + 1, end + size + 1);
      cursor = end + size + 2;
      const relativePath = entry.pathBytes.toString("ascii");
      const mapping = mappings.get(relativePath);
      if (digest(bytes) !== mapping.sha256) throw new WorkspaceMismatchError("source-admission", `source file mapping is stale: ${relativePath}`);
      if (mapping.contentKind === "text") {
        try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
          throw new WorkspaceMismatchError("source-admission", "mapped source text is not UTF-8");
        }
      }
      if (retained.has(relativePath)) entryMap.get(relativePath).bytes = Buffer.from(bytes);
    }
    if (cursor !== output.length) throw new WorkspaceMismatchError("source-admission", "unexpected Git source batch output");
  }
}

export function verifyUpstreamProvenance(repository, entries, definition, approval) {
  if (approval && entries.some((entry) => !["100644", "100755", "160000"].includes(entry.mode))) {
    throw new WorkspaceMismatchError("source-admission", "source mappings require regular files or explicitly unmaterialized gitlinks");
  }
  const entryMap = approval
    ? new Map(entries.map((entry) => [entry.pathBytes.toString("ascii"), { ...entry, bytes: undefined }]))
    : committedEntryMap(repository, entries);
  if (approval) {
    try { gitOutput(repository.root, ["check-ref-format", approval.branch]); } catch {
      throw new WorkspaceMismatchError("source-admission", "invalid source branch hint");
    }
    if (!Array.isArray(approval.files) || approval.files.length !== entries.length ||
        new Set(approval.files.map((file) => file.path)).size !== entries.length ||
        approval.files.some((file) => !entryMap.has(file.path) || (file.contentKind === "gitlink"
          ? entryMap.get(file.path).mode !== "160000" || entryMap.get(file.path).oid !== file.oid
          : entryMap.get(file.path).mode === "160000"))) {
      throw new WorkspaceMismatchError("source-admission", "source file mapping is missing or stale");
    }
    verifySourceFileBytes(repository, entries, approval, entryMap);
    for (const file of approval.files.filter((entry) => entry.contentKind === "gitlink")) {
      let location = repository.root;
      const segments = file.path.split("/");
      for (const [index, segment] of segments.entries()) {
        location = path.join(location, segment);
        let entry;
        try { entry = lstatSync(location); } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (!entry) break;
        if (!entry.isDirectory() || entry.isSymbolicLink() ||
            (index === segments.length - 1 && readdirSync(location).length !== 0)) {
          throw new WorkspaceMismatchError("source-admission", "admission-only gitlinks must remain unmaterialized with ordinary directory parents");
        }
      }
    }
    for (const role of ["license", "notice", "copyright"]) {
      const material = entryMap.get(approval.legal?.[role]);
      if (!material || material.bytes.toString("utf8").trim() === "") {
        throw new WorkspaceMismatchError("source-admission", `source ${role} material is missing`);
      }
      let original;
      try { original = gitOutput(repository.root, ["show", `${approval.baseOid}:${approval.legal[role]}`], "buffer"); } catch { /* rejected below */ }
      if (!original || !original.equals(material.bytes)) {
        throw new WorkspaceMismatchError("source-admission", `original source ${role} material was not preserved`);
      }
    }
  }
  const upstream = entryMap.get("UPSTREAM.toml");
  const license = entryMap.get(approval?.legal?.license ?? "LICENSE");
  const notice = entryMap.get(approval?.legal?.notice ?? "NOTICE");
  if (!upstream || !license || !notice || license.bytes.length === 0 || notice.bytes.length === 0) {
    throw new WorkspaceMismatchError(
      "upstream-provenance",
      `${repository.workspacePath} must preserve LICENSE, NOTICE, and UPSTREAM.toml`,
    );
  }
  const values = parseUpstreamToml(upstream.bytes);
  const required = ["base_oid", "canonical_url", "license", "local_changes", "sync_branch"];
  if (!values || canonicalize(Object.keys(values).sort()) !== canonicalize(required)) {
    throw new WorkspaceMismatchError(
      "upstream-provenance",
      `${repository.workspacePath}/UPSTREAM.toml has an invalid provenance shape`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(values.base_oid)) {
    throw new WorkspaceMismatchError(
      "upstream-provenance",
      `${repository.workspacePath}/UPSTREAM.toml has an unknown base OID`,
    );
  }
  try {
    gitOutput(repository.root, ["cat-file", "-e", `${values.base_oid}^{commit}`]);
    gitOutput(repository.root, [
      "merge-base",
      "--is-ancestor",
      values.base_oid,
      repository.revision,
    ]);
  } catch {
    throw new WorkspaceMismatchError(
      "upstream-provenance",
      `${repository.workspacePath}/UPSTREAM.toml has an unknown base OID`,
    );
  }
  let canonicalUrl;
  try {
    canonicalUrl = new URL(values.canonical_url);
  } catch {
    canonicalUrl = undefined;
  }
  if (
    canonicalUrl?.protocol !== "https:" ||
    !knownLicense(values.license, definition) ||
    !values.sync_branch.startsWith("refs/heads/") ||
    values.local_changes.trim() === ""
  ) {
    throw new WorkspaceMismatchError(
      "upstream-provenance",
      `${repository.workspacePath}/UPSTREAM.toml contains incomplete origin metadata`,
    );
  }
  if (approval && approval.baseOid === values.base_oid &&
      approval.forkOid === repository.revision && approval.canonicalUrl === values.canonical_url &&
      approval.license === values.license && approval.branch === values.sync_branch) return approval;
  throw new WorkspaceMismatchError(
    "upstream-not-approved",
    `${repository.workspacePath} has valid fork provenance but is not approved in R00`,
  );
}
