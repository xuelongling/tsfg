#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import {
  chmod,
  copyFile,
  mkdir,
  lstat,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

class ConfigurationError extends Error {}
class BuildFailureError extends Error {}
class TestFailureError extends Error {}
class WorkspaceMismatchError extends Error {
  constructor(code, message) {
    super(message);
    this.issueCode = code;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function digestFile(filePath) {
  const hasher = createHash("sha256");
  const handle = await open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) hasher.update(chunk);
  } finally {
    await handle.close().catch(() => undefined);
  }
  return `sha256:${hasher.digest("hex")}`;
}

async function writeReport(reportPath, report) {
  await writeAtomicText(reportPath, `${canonicalize(report)}\n`);
}

async function writeAtomicText(destinationPath, contents) {
  const absolutePath = path.resolve(destinationPath);
  const parent = path.dirname(absolutePath);
  const temporaryPath = path.join(
    parent,
    `.${path.basename(absolutePath)}.${randomUUID()}.tmp`,
  );
  await mkdir(parent, { recursive: true });
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await renameWithRetry(temporaryPath, absolutePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function renameWithRetry(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EPERM", "EBUSY"].includes(error.code) ||
        attempt >= 7
      ) {
        throw error;
      }
      await delay(50 * 2 ** Math.min(attempt, 4));
    }
  }
}

async function publishDirectory(source, destination) {
  if (!(await pathExists(destination))) {
    await renameWithRetry(source, destination);
    return;
  }
  const backup = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}.previous`,
  );
  await renameWithRetry(destination, backup);
  try {
    await renameWithRetry(source, destination);
  } catch (error) {
    await renameWithRetry(backup, destination);
    throw error;
  }
  await rm(backup, { recursive: true, force: true }).catch(() => undefined);
}

function parseReportPath(arguments_) {
  const index = arguments_.indexOf("--report");
  if (index === -1 || !arguments_[index + 1]) {
    return undefined;
  }
  return arguments_[index + 1];
}

function parseOptions(arguments_, allowed) {
  const options = new Map();
  for (let index = 1; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new ConfigurationError(`invalid argument: ${name ?? "<missing>"}`);
    }
    if (!allowed.has(name)) {
      throw new ConfigurationError(`unknown option: ${name}`);
    }
    if (options.has(name)) {
      throw new ConfigurationError(`duplicate argument: ${name}`);
    }
    options.set(name, value);
  }
  return options;
}

async function fail(command, code, category, issue, reportPath, network) {
  const report = {
    schemaVersion: "1",
    command,
    status: "failure",
    network,
    telemetry: false,
    error: {
      code: String(code),
      category,
      issues: [issue],
    },
  };
  if (reportPath) {
    try {
      await writeReport(reportPath, report);
    } catch (error) {
      process.stderr.write(`cannot write Build Report: ${error.message}\n`);
      return 30;
    }
  }
  process.stderr.write(`${issue.message}\n`);
  return code;
}

async function succeed(command, result, reportPath, network) {
  const report = {
    schemaVersion: "1",
    command,
    status: "success",
    network,
    telemetry: false,
    result,
  };
  if (reportPath) {
    await writeReport(reportPath, report);
  }
  process.stderr.write(`${command} completed\n`);
  return 0;
}

async function hashTree(root) {
  const entries = [];
  async function visit(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) =>
      Buffer.from(left.name).compare(Buffer.from(right.name)),
    );
    for (const child of children) {
      const relativePath = path.posix.join(relativeDirectory, child.name);
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (child.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          type: "symlink",
          target: (await readlink(absolutePath)).split(path.sep).join("/"),
        });
      } else if (child.isFile()) {
        entries.push({
          path: relativePath,
          type: "file",
          sha256: await digestFile(absolutePath),
        });
      } else {
        throw new Error(`unsupported unpacked entry type: ${relativePath}`);
      }
    }
  }
  await visit(root, "");
  return digest(canonicalize({ schemaVersion: "1", entries }));
}

function selectArtifact(toolId, tool, platform) {
  if (
    typeof tool?.version !== "string" ||
    typeof tool.license !== "string" ||
    tool.license.length === 0 ||
    typeof tool.signature?.kind !== "string" ||
    tool.signature.kind.length === 0 ||
    !Array.isArray(tool.artifacts)
  ) {
    throw new Error(`invalid lock entry for ${toolId}`);
  }
  if (
    typeof tool.signature?.signer !== "string" ||
    tool.signature.signer.length === 0
  ) {
    throw new Error(`invalid signer metadata for ${toolId}`);
  }
  const matches = tool.artifacts.filter(
    (artifact) => artifact.platform === platform,
  );
  if (matches.length !== 1) {
    throw new Error(
      `lock must contain exactly one ${toolId} artifact for ${platform}`,
    );
  }
  const artifact = matches[0];
  const digestPattern = /^sha256:[0-9a-f]{64}$/;
  const commonMetadataValid =
    /^(0|[1-9][0-9]*)$/.test(artifact.byteSize) &&
    digestPattern.test(artifact.archiveSha256) &&
    digestPattern.test(artifact.unpackedTreeSha256);
  const archiveSetValid =
    artifact.archiveFormat === "deb-xz-set" &&
    Array.isArray(artifact.archives) &&
    artifact.archives.length > 0 &&
    artifact.archives.every((member) =>
      typeof member.id === "string" &&
      member.id.length > 0 &&
      /^https?:\/\//.test(member.url) &&
      /^(0|[1-9][0-9]*)$/.test(member.byteSize) &&
      digestPattern.test(member.archiveSha256) &&
      typeof member.license === "string" &&
      member.license.length > 0);
  if (
    !commonMetadataValid ||
    (!archiveSetValid && !/^https?:\/\//.test(artifact.url))
  ) {
    throw new Error(`invalid lock artifact metadata for ${toolId}`);
  }
  if (archiveSetValid) {
    const identities = artifact.archives.map(({ id, byteSize, archiveSha256 }) => ({
      id,
      byteSize,
      archiveSha256,
    }));
    const sorted = [...identities].sort((left, right) =>
      Buffer.from(left.id).compare(Buffer.from(right.id)),
    );
    if (
      canonicalize(identities) !== canonicalize(sorted) ||
      new Set(identities.map(({ id }) => id)).size !== identities.length ||
      digest(canonicalize(identities)) !== artifact.archiveSha256 ||
      String(identities.reduce((total, member) => total + Number(member.byteSize), 0)) !== artifact.byteSize
    ) {
      throw new Error(`invalid archive set metadata for ${toolId}`);
    }
  }
  return artifact;
}

function selectToolchain(lock, platform) {
  const configured = lock.targets?.[platform]?.tools;
  const toolIds = configured ?? Object.keys(lock.tools).sort();
  if (
    !Array.isArray(toolIds) ||
    toolIds.length === 0 ||
    toolIds.some((id) => typeof id !== "string" || !(id in lock.tools)) ||
    new Set(toolIds).size !== toolIds.length
  ) {
    throw new Error(`invalid tool selection for ${platform}`);
  }
  const sortedToolIds = [...toolIds].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  if (canonicalize(toolIds) !== canonicalize(sortedToolIds)) {
    throw new Error(`tool selection for ${platform} must be sorted`);
  }
  return toolIds.map((id) => ({
    id,
    tool: lock.tools[id],
    artifact: selectArtifact(id, lock.tools[id], platform),
  }));
}

function toolchainClosureDigest(lock, selections, platform) {
  if (!Array.isArray(lock.dependencyLocks)) {
    throw new Error("toolchain lock must declare dependencyLocks");
  }
  const dependencyLocks = lock.dependencyLocks.map((dependency) => {
    if (
      typeof dependency?.projectId !== "string" ||
      dependency.projectId.length === 0 ||
      typeof dependency.path !== "string" ||
      dependency.path.length === 0 ||
      !/^sha256:[0-9a-f]{64}$/.test(dependency.sha256)
    ) {
      throw new Error("invalid dependency lock identity");
    }
    return {
      projectId: dependency.projectId,
      path: dependency.path,
      sha256: dependency.sha256,
    };
  }).sort((left, right) => {
    const projectOrder = Buffer.from(left.projectId).compare(Buffer.from(right.projectId));
    return projectOrder || Buffer.from(left.path).compare(Buffer.from(right.path));
  });
  const identities = dependencyLocks.map(({ projectId, path: dependencyPath }) =>
    `${projectId}\0${dependencyPath}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error("duplicate dependency lock identity");
  }
  return digest(canonicalize({
    dependencyLocks,
    schemaVersion: lock.schemaVersion,
    target: platform,
    tools: selections.map(({ id, tool, artifact }) => ({
      id,
      version: tool.version,
      platform: artifact.platform,
      archiveSha256: artifact.archiveSha256,
      unpackedTreeSha256: artifact.unpackedTreeSha256,
    })),
  }));
}

function checkedInstallPath(toolRoot, installPath) {
  if (typeof installPath !== "string" || installPath.length === 0) {
    throw new Error("artifact installPath must be a non-empty string");
  }
  const destination = path.resolve(toolRoot, ...installPath.split("/"));
  const relative = path.relative(toolRoot, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`artifact installPath escapes tool root: ${installPath}`);
  }
  return destination;
}

async function verifyInstalledTool(toolRoot, artifact) {
  const actualTreeDigest = await hashTree(toolRoot);
  if (actualTreeDigest !== artifact.unpackedTreeSha256) {
    throw new Error(
      `unpacked tree digest mismatch: expected ${artifact.unpackedTreeSha256}, got ${actualTreeDigest}`,
    );
  }
}

function archivePath(root, name, stripComponents) {
  if (typeof name !== "string" || name.includes("\0") || name.includes("\\") || name.startsWith("/")) {
    throw new Error(`unsafe archive path: ${JSON.stringify(name)}`);
  }
  const parts = name.split("/");
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`unsafe archive path: ${JSON.stringify(name)}`);
  }
  while (parts.at(-1) === "") parts.pop();
  if (parts.length <= stripComponents) return undefined;
  const retained = parts.slice(stripComponents);
  if (retained.some((part) => part.length === 0)) {
    throw new Error(`unsafe archive path: ${JSON.stringify(name)}`);
  }
  const destination = path.resolve(root, ...retained);
  const relative = path.relative(root, destination);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`archive path escapes tool root: ${name}`);
  }
  return destination;
}

function tarString(bytes, start, length) {
  const end = bytes.indexOf(0, start);
  return bytes.subarray(start, end === -1 || end > start + length ? start + length : end).toString("utf8");
}

function tarNumber(bytes, start, length) {
  const value = tarString(bytes, start, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new Error(`invalid tar number: ${value}`);
  return value === "" ? 0 : Number.parseInt(value, 8);
}

/** @returns {Record<string, string>} */
function parsePax(bytes) {
  /** @type {Record<string, string>} */
  const attributes = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space === -1) throw new Error("invalid pax record length");
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/.test(lengthText)) throw new Error("invalid pax record length");
    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (end > bytes.length || bytes[end - 1] !== 0x0a) throw new Error("truncated pax record");
    const record = bytes.subarray(space + 1, end - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals === -1) throw new Error("invalid pax record");
    attributes[record.slice(0, equals)] = record.slice(equals + 1);
    offset = end;
  }
  return attributes;
}

function parseTar(bytes) {
  const entries = [];
  let offset = 0;
  /** @type {Record<string, string>} */
  let extended = {};
  /** @type {Record<string, string>} */
  let global = {};
  let longName;
  let longLink;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      offset += 512;
      continue;
    }
    const expectedChecksum = tarNumber(header, 148, 8);
    let actualChecksum = 0;
    for (let index = 0; index < 512; index += 1) {
      actualChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (actualChecksum !== expectedChecksum) throw new Error("tar header checksum mismatch");
    const size = tarNumber(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const payloadStart = offset + 512;
    const payloadEnd = payloadStart + size;
    if (payloadEnd > bytes.length) throw new Error("truncated tar entry");
    const payload = bytes.subarray(payloadStart, payloadEnd);
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const headerName = prefix ? `${prefix}/${name}` : name;
    if (type === "x" || type === "g") {
      const values = parsePax(payload);
      if (type === "g") global = { ...global, ...values };
      else extended = values;
    } else if (type === "L") {
      longName = payload.subarray(0, payload.at(-1) === 0 ? -1 : undefined).toString("utf8");
    } else if (type === "K") {
      longLink = payload.subarray(0, payload.at(-1) === 0 ? -1 : undefined).toString("utf8");
    } else {
      const attributes = { ...global, ...extended };
      entries.push({
        name: attributes.path ?? longName ?? headerName,
        linkName: attributes.linkpath ?? longLink ?? tarString(header, 157, 100),
        mode: tarNumber(header, 100, 8) & 0o777,
        type,
        bytes: Buffer.from(payload),
      });
      extended = {};
      longName = undefined;
      longLink = undefined;
    }
    offset = payloadStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function findZipEnd(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("zip end record is missing");
}

function parseZip(bytes) {
  const end = findZipEnd(bytes);
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid zip central directory");
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("invalid zip local header");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw new Error("truncated zip entry");
    const contents = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : undefined;
    if (!contents) throw new Error(`unsupported zip compression method: ${method}`);
    if (contents.length !== uncompressedSize) throw new Error(`zip size mismatch for ${name}`);
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) throw new Error(`zip symlink is unsupported: ${name}`);
    entries.push({ name, type: name.endsWith("/") ? "5" : "0", mode: unixMode & 0o777, bytes: contents, linkName: "" });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function extractEntries(entries, toolRoot, stripComponents) {
  const prepared = [];
  const destinations = new Set();
  for (const entry of entries) {
    const destination = archivePath(toolRoot, entry.name, stripComponents);
    if (!destination) continue;
    const key = process.platform === "win32" ? destination.toLowerCase() : destination;
    if (destinations.has(key)) throw new Error(`duplicate archive path: ${entry.name}`);
    destinations.add(key);
    if (!["0", "5", "2"].includes(entry.type)) throw new Error(`unsupported archive entry type ${entry.type}: ${entry.name}`);
    prepared.push({ ...entry, destination });
  }
  prepared.sort((left, right) => ({ "5": 0, "0": 1, "2": 2 })[left.type] - ({ "5": 0, "0": 1, "2": 2 })[right.type]);
  for (const entry of prepared) {
    await mkdir(entry.type === "5" ? entry.destination : path.dirname(entry.destination), { recursive: true });
    if (entry.type === "5") {
      if (entry.mode && process.platform !== "win32") await chmod(entry.destination, entry.mode);
    } else if (entry.type === "0") {
      await writeFile(entry.destination, entry.bytes, { flag: "wx", mode: entry.mode || 0o644 });
      if (entry.mode && process.platform !== "win32") await chmod(entry.destination, entry.mode);
    } else {
      if (entry.linkName.includes("\0") || path.isAbsolute(entry.linkName)) throw new Error(`unsafe archive link target: ${entry.linkName}`);
      const target = path.resolve(path.dirname(entry.destination), ...entry.linkName.split("/"));
      const targetRelative = path.relative(toolRoot, target).split(path.sep).join("/");
      archivePath(toolRoot, targetRelative, 0);
      await symlink(entry.linkName, entry.destination);
    }
  }
}

async function extractArchive(bytes, format, toolRoot, stripComponents) {
  if (format === "zip") await extractEntries(parseZip(bytes), toolRoot, stripComponents);
  else if (["tar.gz", "apk-v2"].includes(format)) {
    await extractEntries(parseTar(gunzipSync(bytes)), toolRoot, stripComponents);
  }
  else throw new Error(`unsupported archive format: ${format}`);
}

async function downloadToFile(toolId, source, destination) {
  const response = await fetch(source.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`${toolId} download failed with HTTP ${response.status}`);
  }
  const hasher = createHash("sha256");
  let byteSize = 0;
  const handle = await open(destination, "wx");
  try {
    for await (const chunk of response.body) {
      hasher.update(chunk);
      byteSize += chunk.length;
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  if (String(byteSize) !== source.byteSize) {
    throw new Error(
      `${toolId} byte size mismatch: expected ${source.byteSize}, got ${byteSize}`,
    );
  }
  const actualArchiveDigest = `sha256:${hasher.digest("hex")}`;
  if (actualArchiveDigest !== source.archiveSha256) {
    throw new Error(
      `${toolId} archive digest mismatch: expected ${source.archiveSha256}, got ${actualArchiveDigest}`,
    );
  }
}

function extractionEnvironment(temporaryRoot) {
  return {
    HOME: temporaryRoot,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "",
    TMPDIR: temporaryRoot,
    TZ: "UTC",
  };
}

function runArchiveExtractor(extractor, arguments_, temporaryRoot) {
  try {
    execFileSync(extractor, arguments_, {
      cwd: temporaryRoot,
      env: extractionEnvironment(temporaryRoot),
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    const detail = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8").trim()
      : error.message;
    throw new Error(detail || "archive extractor failed");
  }
}

function debianDataArchive(bytes) {
  if (bytes.subarray(0, 8).toString("ascii") !== "!<arch>\n") {
    throw new Error("invalid Debian ar archive");
  }
  let offset = 8;
  while (offset + 60 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 60);
    if (header.subarray(58, 60).toString("ascii") !== "`\n") {
      throw new Error("invalid Debian ar member");
    }
    const name = header.subarray(0, 16).toString("ascii").trim().replace(/\/$/, "");
    const sizeText = header.subarray(48, 58).toString("ascii").trim();
    if (!/^(0|[1-9][0-9]*)$/.test(sizeText)) {
      throw new Error("invalid Debian ar member size");
    }
    const size = Number.parseInt(sizeText, 10);
    const start = offset + 60;
    const end = start + size;
    if (end > bytes.length) throw new Error("truncated Debian ar member");
    if (name === "data.tar.xz") return Buffer.from(bytes.subarray(start, end));
    offset = end + (size % 2);
  }
  throw new Error("Debian package has no data.tar.xz member");
}

async function extractTar(
  extractor,
  archive,
  toolRoot,
  stripComponents,
  temporaryRoot,
  compression,
) {
  await mkdir(toolRoot, { recursive: true });
  runArchiveExtractor(
    extractor,
    [
      "tar",
      compression === "xz" ? "-xJf" : "-xzf",
      archive,
      "-C",
      toolRoot,
      "--strip-components",
      String(stripComponents),
      "--numeric-owner",
    ],
    temporaryRoot,
  );
}

async function normalizeSysrootLinks(root) {
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(childPath);
      } else if (child.isSymbolicLink()) {
        const target = await readlink(childPath);
        if (path.posix.isAbsolute(target)) {
          const lockedTarget = checkedInstallPath(root, target.slice(1));
          const relativeTarget = path.relative(path.dirname(childPath), lockedTarget);
          await rm(childPath);
          await symlink(relativeTarget, childPath);
        }
      }
    }
  }
  await visit(root);
}

async function downloadArtifact(toolId, artifact, toolRoot, downloadsRoot, extractor) {
  await mkdir(downloadsRoot, { recursive: true });
  if (artifact.archiveFormat === "deb-xz-set") {
    if (!extractor) throw new Error("locked archive extractor is unavailable");
    for (const member of artifact.archives) {
      const archive = path.join(downloadsRoot, `${toolId}-${member.id}.deb`);
      await downloadToFile(`${toolId}/${member.id}`, member, archive);
      const dataArchive = path.join(downloadsRoot, `${toolId}-${member.id}.data.tar.xz`);
      await writeFile(dataArchive, debianDataArchive(await readFile(archive)), { flag: "wx" });
      await extractTar(extractor, dataArchive, toolRoot, 0, downloadsRoot, "xz");
    }
    await normalizeSysrootLinks(toolRoot);
  } else {
    const archive = path.join(downloadsRoot, `${toolId}.archive`);
    await downloadToFile(toolId, artifact, archive);
    if (artifact.archiveFormat === "raw") {
      const destination = checkedInstallPath(toolRoot, artifact.installPath);
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(archive, destination);
      if (process.platform !== "win32") await chmod(destination, 0o755);
    } else if (artifact.archiveFormat === "tar.gz" && extractor) {
      const stripComponents = artifact.stripComponents ?? "0";
      if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
        throw new Error(`invalid stripComponents for ${toolId}`);
      }
      await extractTar(
        extractor,
        archive,
        toolRoot,
        Number.parseInt(stripComponents, 10),
        downloadsRoot,
        "gz",
      );
    } else if (["zip", "tar.gz", "apk-v2"].includes(artifact.archiveFormat)) {
      const stripComponents = artifact.stripComponents ?? "0";
      if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
        throw new Error(`invalid stripComponents for ${toolId}`);
      }
      await mkdir(toolRoot, { recursive: true });
      try {
        await extractArchive(
          await readFile(archive),
          artifact.archiveFormat,
          toolRoot,
          Number.parseInt(stripComponents, 10),
        );
      } catch (error) {
        throw new Error(`${toolId} archive extraction failed: ${error.message}`);
      }
    } else if (artifact.archiveFormat === "tar.xz") {
      if (!extractor) throw new Error("locked archive extractor is unavailable");
      const stripComponents = artifact.stripComponents ?? "0";
      if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
        throw new Error(`invalid stripComponents for ${toolId}`);
      }
      await extractTar(
        extractor,
        archive,
        toolRoot,
        Number.parseInt(stripComponents, 10),
        downloadsRoot,
        "xz",
      );
    } else {
      throw new Error(`unsupported archive format: ${artifact.archiveFormat}`);
    }
  }
  const installed = checkedInstallPath(toolRoot, artifact.installPath);
  const installedStat = await stat(installed).catch(() => undefined);
  if (!installedStat) {
    throw new Error(`${toolId} install path is missing after extraction`);
  }
  await verifyInstalledTool(toolRoot, artifact);
}

async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function prefetch(options) {
  const lockPath = options.get("--lock");
  const cachePath = options.get("--cache");
  const platform = options.get("--platform");
  if (!lockPath || !cachePath || !platform) {
    throw new ConfigurationError(
      "prefetch requires --lock, --cache, and --platform",
    );
  }
  const lock = JSON.parse(await readFile(path.resolve(lockPath), "utf8"));
  if (lock.schemaVersion !== "1" || typeof lock.tools !== "object") {
    throw new Error("unsupported toolchain lock schema");
  }
  const selections = selectToolchain(lock, platform);
  const lockDigest = toolchainClosureDigest(lock, selections, platform);
  const lockHex = lockDigest.slice("sha256:".length);
  const absoluteCache = path.resolve(cachePath);
  const finalPath = path.join(
    absoluteCache,
    "closures",
    "sha256",
    lockHex,
    platform,
  );
  const activePath = path.join(absoluteCache, "active", platform);

  if (await pathExists(finalPath)) {
    try {
      const ready = JSON.parse(await readFile(path.join(finalPath, "ready.json"), "utf8"));
      if (
        ready.status !== "ready" ||
        ready.lockDigest !== lockDigest ||
        ready.platform !== platform
      ) {
        throw new Error("cached closure readiness identity mismatch");
      }
      for (const selection of selections) {
        await verifyInstalledTool(
          path.join(finalPath, selection.id),
          selection.artifact,
        );
      }
    } catch (error) {
      await rm(activePath, { force: true });
      throw error;
    }
  } else {
    const stagingPath = path.join(
      absoluteCache,
      ".staging",
      `${lockHex}.${platform}.${randomUUID()}`,
    );
    try {
      await mkdir(stagingPath, { recursive: true });
      const downloadsRoot = path.join(stagingPath, ".downloads");
      let extractor;
      for (const selection of selections) {
        await downloadArtifact(
          selection.id,
          selection.artifact,
          path.join(stagingPath, selection.id),
          downloadsRoot,
          extractor,
        );
        if (selection.id === "archive-extractor") {
          extractor = checkedInstallPath(
            path.join(stagingPath, selection.id),
            selection.artifact.installPath,
          );
        }
      }
      await rm(downloadsRoot, { recursive: true, force: true });
      await writeFile(
        path.join(stagingPath, "ready.json"),
        `${canonicalize({ status: "ready", lockDigest, platform })}\n`,
        "utf8",
      );
      await mkdir(path.dirname(finalPath), { recursive: true });
      await renameWithRetry(stagingPath, finalPath);
    } finally {
      await rm(stagingPath, {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 5 : 0,
        retryDelay: 100,
      });
    }
  }

  const activeRelativePath = [
    "closures",
    "sha256",
    lockHex,
    platform,
  ].join("/");
  await writeAtomicText(
    activePath,
    `${activeRelativePath}\n`,
  );

  return {
    lockDigest,
    platform,
    tools: selections.map(({ id, tool }) => ({ id, version: tool.version })),
  };
}

async function verifyRuntimeClosure(lockPath, cachePath, platform) {
  const lock = JSON.parse(await readFile(path.resolve(lockPath), "utf8"));
  if (lock.schemaVersion !== "1" || typeof lock.tools !== "object") {
    throw new Error("unsupported toolchain lock schema");
  }
  const selections = selectToolchain(lock, platform);
  const lockDigest = toolchainClosureDigest(lock, selections, platform);
  const expectedRelative = [
    "closures",
    "sha256",
    lockDigest.slice("sha256:".length),
    platform,
  ].join("/");
  const absoluteCache = path.resolve(cachePath);
  const activePath = path.join(absoluteCache, "active", platform);
  const activeBytes = await readFile(activePath, "utf8");
  if (activeBytes !== `${expectedRelative}\n`) {
    throw new Error("active closure identity does not match the toolchain lock");
  }
  const closurePath = path.resolve(absoluteCache, ...expectedRelative.split("/"));
  const relative = path.relative(absoluteCache, closurePath);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("active closure escapes the toolchain cache");
  }
  const ready = JSON.parse(await readFile(path.join(closurePath, "ready.json"), "utf8"));
  if (ready.status !== "ready" || ready.lockDigest !== lockDigest || ready.platform !== platform) {
    throw new Error("cached closure readiness identity mismatch");
  }
  for (const selection of selections) {
    await verifyInstalledTool(path.join(closurePath, selection.id), selection.artifact);
  }
  return { closurePath, lock, lockDigest, platform, selections };
}

/**
 * @param {string} cwd
 * @param {string[]} arguments_
 * @param {BufferEncoding | "buffer"} encoding
 * @returns {any}
 */
function gitOutput(cwd, arguments_, encoding = "utf8") {
  try {
    /** @type {NodeJS.ProcessEnv} */
    const environment = {};
    const allowed = [
      "PATH",
      "SystemRoot",
      "ComSpec",
      "PATHEXT",
      "HOME",
      "USERPROFILE",
      "HOMEDRIVE",
      "HOMEPATH",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
    ];
    for (const requested of allowed) {
      const actual = Object.keys(process.env).find(
        (name) => name.toLowerCase() === requested.toLowerCase(),
      );
      if (actual && process.env[actual] !== undefined) {
        environment[requested] = process.env[actual];
      }
    }
    environment.GIT_CONFIG_NOSYSTEM = "1";
    environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
    environment.GIT_OPTIONAL_LOCKS = "0";
    environment.GIT_TERMINAL_PROMPT = "0";
    const bytes = execFileSync(process.env.TSFG_GIT ?? "git", arguments_, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return encoding === "buffer" ? bytes : bytes.toString(encoding);
  } catch (error) {
    const detail = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8").trim()
      : String(error.stderr ?? error.message).trim();
    throw new WorkspaceMismatchError(
      "git-state",
      `cannot inspect Git state at ${cwd}: ${detail}`,
    );
  }
}

function requireVisibleTrackedFiles(repositoryRoot) {
  const assumeUnchanged = gitOutput(repositoryRoot, ["ls-files", "-v", "-z"])
    .split("\0")
    .filter((entry) => /^[a-z] /.test(entry))
    .map((entry) => entry.slice(2));
  const skipWorktree = gitOutput(repositoryRoot, ["ls-files", "-t", "-z"])
    .split("\0")
    .filter((entry) => entry.startsWith("S "))
    .map((entry) => entry.slice(2));
  const hidden = [...new Set([...assumeUnchanged, ...skipWorktree])].sort(
    (left, right) => Buffer.from(left).compare(Buffer.from(right)),
  );
  if (hidden.length !== 0) {
    throw new WorkspaceMismatchError(
      "dirty-project",
      `tracked files are hidden from workspace status: ${hidden.join(",")}`,
    );
  }
}

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

function parseManifest(xml) {
  if (xml.charCodeAt(0) === 0xfeff || !/<manifest(?:\s|>)/.test(xml)) {
    throw new WorkspaceMismatchError("manifest-content", "invalid manifest XML");
  }
  if (/<(?:include|extend-project|remove-project|submanifest|copyfile)(?:\s|>)/.test(xml)) {
    throw new WorkspaceMismatchError(
      "manifest-content",
      "unsupported manifest composition in R00 bootstrap manifest",
    );
  }
  const remotes = new Map();
  for (const match of xml.matchAll(/<remote\s+([^>]*?)\s*\/>/g)) {
    const attributes = parseAttributes(match[1]);
    if (!attributes.name || !attributes.fetch || remotes.has(attributes.name)) {
      throw new WorkspaceMismatchError("manifest-content", "invalid manifest remote");
    }
    remotes.set(attributes.name, attributes.fetch);
  }
  const projects = [];
  const projectPattern = /<project\s+([^>]*?)(?:\s*\/\s*>|>([\s\S]*?)<\/project\s*>)/g;
  for (const match of xml.matchAll(projectPattern)) {
    const attributes = parseAttributes(match[1]);
    const required = ["name", "path", "remote", "revision"];
    if (required.some((key) => !attributes[key])) {
      throw new WorkspaceMismatchError(
        "manifest-content",
        "manifest project is missing required identity",
      );
    }
    if (!/^[0-9a-f]{40}$/.test(attributes.revision)) {
      throw new WorkspaceMismatchError(
        "manifest-content",
        `project ${attributes.path} revision is not a complete OID`,
      );
    }
    const fetch = remotes.get(attributes.remote);
    if (!fetch) {
      throw new WorkspaceMismatchError(
        "manifest-content",
        `project ${attributes.path} references an unknown remote`,
      );
    }
    const linkfiles = [];
    for (const linkMatch of (match[2] ?? "").matchAll(
      /<linkfile\s+([^>]*?)\s*\/>/g,
    )) {
      const link = parseAttributes(linkMatch[1]);
      if (!link.src || !link.dest) {
        throw new WorkspaceMismatchError(
          "manifest-content",
          `project ${attributes.path} has an invalid linkfile`,
        );
      }
      linkfiles.push({ src: link.src, dest: link.dest });
    }
    projects.push({
      id: attributes.name,
      path: attributes.path,
      remoteName: attributes.remote,
      remoteUrl: new URL(attributes.name, fetch).href,
      revision: attributes.revision,
      linkfiles,
    });
  }
  if (projects.length === 0) {
    throw new WorkspaceMismatchError(
      "manifest-content",
      "manifest contains no projects",
    );
  }
  projects.sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
  return projects;
}

function normalizedRelative(root, candidate) {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    return relative.split(path.sep).join("/");
  }
  throw new WorkspaceMismatchError(
    "workspace-containment",
    `path escapes Repo Workspace: ${candidate}`,
  );
}

async function requirePlainAncestors(workspace, candidate) {
  const relative = normalizedRelative(workspace, candidate);
  if (!relative) return;
  let current = workspace;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const currentStat = await lstat(current).catch(() => undefined);
    if (!currentStat) break;
    if (currentStat.isSymbolicLink()) {
      throw new WorkspaceMismatchError(
        "activation-link-parent",
        `${normalizedRelative(workspace, current)} redirects an activation path`,
      );
    }
  }
}

async function requireCanonicalSymlink(workspace, destination, source) {
  await requirePlainAncestors(workspace, path.dirname(destination));
  await requirePlainAncestors(workspace, path.dirname(source));
  const destinationStat = await lstat(destination).catch(() => undefined);
  if (!destinationStat?.isSymbolicLink()) {
    throw new WorkspaceMismatchError(
      "activation-link-type",
      `${normalizedRelative(workspace, destination)} is not a symbolic link`,
    );
  }
  const rawTarget = await readlink(destination);
  const lexicalTarget = path.resolve(path.dirname(destination), rawTarget);
  if (path.resolve(source) !== lexicalTarget) {
    throw new WorkspaceMismatchError(
      "activation-link-target",
      `${normalizedRelative(workspace, destination)} has a non-canonical target`,
    );
  }
  normalizedRelative(workspace, lexicalTarget);
  const [physicalTarget, physicalSource] = await Promise.all([
    realpath(destination),
    realpath(source),
  ]);
  normalizedRelative(workspace, physicalTarget);
  normalizedRelative(workspace, physicalSource);
  if (physicalTarget !== physicalSource) {
    throw new WorkspaceMismatchError(
      "activation-link-target",
      `${normalizedRelative(workspace, destination)} resolves to the wrong target`,
    );
  }
}

async function verifyWorkspace(options) {
  const workspaceOption = options.get("--workspace");
  const manifestUrl = options.get("--manifest-url");
  const manifestRevision = options.get("--manifest-revision");
  const manifestName = options.get("--manifest");
  if (!workspaceOption || !manifestUrl || !manifestRevision || !manifestName) {
    throw new ConfigurationError(
      "verify-workspace requires --workspace, --manifest-url, --manifest-revision, and --manifest",
    );
  }
  if (!/^[0-9a-f]{40}$/.test(manifestRevision)) {
    throw new ConfigurationError("--manifest-revision must be a complete commit OID");
  }
  if (
    path.isAbsolute(manifestName) ||
    manifestName.split(/[\\/]/).some((part) => part === ".." || part === "")
  ) {
    throw new ConfigurationError("--manifest must be a repository-relative path");
  }
  const workspace = path.resolve(workspaceOption);
  const manifestsRoot = path.join(workspace, ".repo", "manifests");
  const manifestGit = path.join(workspace, ".repo", "manifests.git");
  const manifestPath = path.join(
    manifestsRoot,
    ...manifestName.split(/[\\/]/),
  );
  const manifestLink = path.join(workspace, ".repo", "manifest.xml");

  const initializedRevision = gitOutput(manifestGit, [
    "config",
    "--get",
    "branch.default.merge",
  ]).trim();
  const initializedUrl = gitOutput(manifestGit, [
    "config",
    "--get",
    "remote.origin.url",
  ]).trim();
  const actualManifestHead = gitOutput(manifestsRoot, ["rev-parse", "HEAD"]).trim();
  const actualManifestUrl = gitOutput(manifestsRoot, [
    "config",
    "--get",
    "remote.origin.url",
  ]).trim();
  if (
    initializedRevision !== manifestRevision ||
    actualManifestHead !== manifestRevision
  ) {
    throw new WorkspaceMismatchError(
      "manifest-revision",
      `manifest revision mismatch: expected ${manifestRevision}, initialized ${initializedRevision}, actual ${actualManifestHead}`,
    );
  }
  if (initializedUrl !== manifestUrl || actualManifestUrl !== manifestUrl) {
    throw new WorkspaceMismatchError(
      "manifest-remote",
      `manifest repository URL mismatch: expected ${manifestUrl}`,
    );
  }
  await requireCanonicalSymlink(workspace, manifestLink, manifestPath);
  const expectedManifestBytes = gitOutput(
    manifestsRoot,
    ["show", `${manifestRevision}:${manifestName}`],
    "buffer",
  );
  const actualManifestBytes = await readFile(manifestPath);
  if (!expectedManifestBytes.equals(actualManifestBytes)) {
    throw new WorkspaceMismatchError(
      "manifest-content",
      "selected manifest does not match the locked manifest commit",
    );
  }
  const manifestStatus = gitOutput(manifestsRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  if (manifestStatus.length !== 0) {
    throw new WorkspaceMismatchError(
      "dirty-project",
      "manifest repository is dirty",
    );
  }
  requireVisibleTrackedFiles(manifestsRoot);
  const expectedProjects = parseManifest(actualManifestBytes.toString("utf8"));
  const actualProjectList = (await readFile(
    path.join(workspace, ".repo", "project.list"),
    "utf8",
  ))
    .split(/\r?\n/)
    .filter(Boolean)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const expectedProjectList = expectedProjects.map((project) => project.path);
  const discoveredProjects = [];
  for (const entry of await readdir(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".repo") continue;
    const gitMarker = path.join(workspace, entry.name, ".git");
    if (await lstat(gitMarker).catch(() => undefined)) {
      discoveredProjects.push(entry.name);
    }
  }
  discoveredProjects.sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  if (
    canonicalize(actualProjectList) !== canonicalize(expectedProjectList) ||
    canonicalize(discoveredProjects) !== canonicalize(expectedProjectList)
  ) {
    throw new WorkspaceMismatchError(
      "project-set",
      `project set mismatch: expected ${expectedProjectList.join(",")}, repo metadata has ${actualProjectList.join(",")}, workspace has ${discoveredProjects.join(",")}`,
    );
  }

  const projects = [];
  const activation = [];
  for (const project of expectedProjects) {
    const projectRoot = path.resolve(workspace, ...project.path.split("/"));
    normalizedRelative(workspace, projectRoot);
    const head = gitOutput(projectRoot, ["rev-parse", "HEAD"]).trim();
    if (head !== project.revision) {
      throw new WorkspaceMismatchError(
        "project-head",
        `${project.path} HEAD mismatch: expected ${project.revision}, got ${head}`,
      );
    }
    const remote = gitOutput(projectRoot, [
      "config",
      "--get",
      `remote.${project.remoteName}.url`,
    ]).trim();
    if (remote !== project.remoteUrl) {
      throw new WorkspaceMismatchError(
        "project-remote",
        `${project.path} remote mismatch: expected ${project.remoteUrl}, got ${remote}`,
      );
    }
    const status = gitOutput(projectRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]);
    if (status.length !== 0) {
      throw new WorkspaceMismatchError(
        "dirty-project",
        `${project.path} is dirty`,
      );
    }
    requireVisibleTrackedFiles(projectRoot);
    projects.push({
      id: project.id,
      path: project.path,
      head,
      remote,
      dirty: false,
    });
    for (const link of project.linkfiles) {
      const source = path.resolve(projectRoot, ...link.src.split("/"));
      const destination = path.resolve(workspace, ...link.dest.split("/"));
      normalizedRelative(projectRoot, source);
      normalizedRelative(workspace, destination);
      await requireCanonicalSymlink(workspace, destination, source);
      const sourceStat = await lstat(source);
      if (
        !sourceStat.isFile() ||
        sourceStat.isSymbolicLink() ||
        sourceStat.nlink !== 1
      ) {
        throw new WorkspaceMismatchError(
          "activation-source-type",
          `${project.path}/${link.src} is not a regular managed file`,
        );
      }
      const committedBytes = gitOutput(
        projectRoot,
        ["show", `${project.revision}:${link.src}`],
        "buffer",
      );
      const sourceBytes = await readFile(source);
      if (!committedBytes.equals(sourceBytes)) {
        throw new WorkspaceMismatchError(
          "activation-content",
          `${project.path}/${link.src} does not match the pinned commit`,
        );
      }
      activation.push({
        destination: link.dest,
        source: `${project.path}/${link.src}`,
        type: "symbolic-link",
        sha256: digest(sourceBytes),
      });
    }
  }
  activation.sort((left, right) =>
    Buffer.from(left.destination).compare(Buffer.from(right.destination)),
  );
  return {
    manifest: {
      repositoryUrl: manifestUrl,
      revision: manifestRevision,
      selected: manifestName,
    },
    projects,
    activation,
    dirty: false,
  };
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function closureToolPath(runtime, toolId, executableId = toolId) {
  const selection = runtime.selections.find(({ id }) => id === toolId);
  if (!selection) throw new Error(`locked tool is not selected: ${toolId}`);
  const installPath = selection.artifact.executables?.[executableId]
    ?? selection.artifact.installPath;
  return checkedInstallPath(
    path.join(runtime.closurePath, toolId),
    installPath,
  );
}

function buildEnvironment(temporaryRoot, toolDirectories) {
  const environment = {
    HOME: temporaryRoot,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: toolDirectories.join(path.delimiter),
    TMPDIR: temporaryRoot,
    TZ: "UTC",
  };
  if (process.platform === "win32") {
    environment.ComSpec = process.env.ComSpec;
    environment.SystemRoot = process.env.SystemRoot;
    environment.TEMP = temporaryRoot;
    environment.TMP = temporaryRoot;
  }
  return environment;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function writeLockedLlvmWrapper(
  destination,
  loader,
  libraries,
  executable,
  leadingArguments = [],
) {
  const command = [loader, "--library-path", libraries, executable, ...leadingArguments]
    .map(shellQuote)
    .join(" ");
  await writeFile(destination, `#!/bin/sh\nexec ${command} "$@"\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o755,
  });
  if (process.platform !== "win32") await chmod(destination, 0o755);
}

function runBuildTool(toolId, executable, arguments_, cwd, environment) {
  try {
    if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
      execFileSync(process.env.ComSpec, ["/d", "/c", executable, ...arguments_], {
        cwd,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      execFileSync(executable, arguments_, {
        cwd,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
  } catch (error) {
    const stdout = Buffer.isBuffer(error.stdout)
      ? error.stdout.toString("utf8")
      : "";
    const stderr = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8")
      : "";
    const detail = `${stdout}${stderr}`.trim() || error.message;
    throw new BuildFailureError(`${toolId} failed${detail ? `: ${detail}` : ""}`);
  }
}

async function buildLinuxDebug(options, runtime) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const outputOption = options.get("--out");
  if (!target || !profile || !outputOption) {
    throw new ConfigurationError("build requires --target, --profile, and --out");
  }
  if (target !== "linux-x86_64-gnu" || profile !== "debug") {
    throw new ConfigurationError("R00-06 build supports only linux-x86_64-gnu debug");
  }

  const output = path.resolve(outputOption);
  const stagingRoot = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${randomUUID()}.tmp`,
  );
  const workRoot = path.join(stagingRoot, "work");
  const publishRoot = path.join(stagingRoot, "publish");
  const cppWork = path.join(workRoot, "cpp");
  const wrapperRoot = path.join(workRoot, "llvm-wrappers");
  const zigPrefix = path.join(workRoot, "zig-install");
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
  const loader = path.join(sysroot, "lib", "x86_64-linux-gnu", "ld-linux-x86-64.so.2");
  const runtimeLibraries = [
    path.join(sysroot, "lib", "x86_64-linux-gnu"),
    path.join(sysroot, "usr", "lib", "x86_64-linux-gnu"),
  ].join(":");
  const compilerWrapper = path.join(wrapperRoot, "clang++");
  const linkerWrapper = path.join(wrapperRoot, "ld.lld");
  const arWrapper = path.join(wrapperRoot, "llvm-ar");
  const ranlibWrapper = path.join(wrapperRoot, "llvm-ranlib");
  const environment = buildEnvironment(workRoot, [
    path.dirname(cmake),
    path.dirname(ninja),
    path.dirname(clangxx),
    path.dirname(lld),
    path.dirname(zig),
  ]);
  const cmakeArguments = [
    "-S", path.join(repositoryRoot, "tests", "r00", "smoke", "cpp"),
    "-B", cppWork,
    "-G", "Ninja",
    `-DCMAKE_MAKE_PROGRAM=${ninja}`,
    `-DCMAKE_CXX_COMPILER=${compilerWrapper}`,
    `-DCMAKE_AR=${arWrapper}`,
    `-DCMAKE_RANLIB=${ranlibWrapper}`,
    "-DCMAKE_BUILD_TYPE=Debug",
    "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY",
    `-DCMAKE_SYSROOT=${sysroot}`,
    "-DCMAKE_CXX_FLAGS_DEBUG=-O0 -g3 -UNDEBUG -fno-omit-frame-pointer",
    `-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=${linkerWrapper} --rtlib=compiler-rt -unwindlib=none`,
  ];
  const ninjaArguments = ["-C", cppWork, "tsfg-r00-cpp-smoke"];
  const zigArguments = [
    "build",
    "--build-file", path.join(repositoryRoot, "tests", "r00", "smoke", "zig", "build.zig"),
    "--prefix", zigPrefix,
    "--cache-dir", path.join(workRoot, "zig-cache"),
    "--global-cache-dir", path.join(workRoot, "zig-global-cache"),
    "-Dtarget=x86_64-linux-gnu",
    "-Doptimize=Debug",
  ];
  const steps = [
    { tool: "cmake", executable: cmake, arguments: cmakeArguments },
    { tool: "ninja", executable: ninja, arguments: ninjaArguments },
    { tool: "zig", executable: zig, arguments: zigArguments },
  ];

  try {
    await mkdir(cppWork, { recursive: true });
    await mkdir(wrapperRoot, { recursive: true });
    await mkdir(binRoot, { recursive: true });
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
    runBuildTool("cmake", cmake, cmakeArguments, repositoryRoot, environment);
    runBuildTool("ninja", ninja, ninjaArguments, repositoryRoot, environment);
    runBuildTool("zig", zig, zigArguments, repositoryRoot, environment);
    const cppStat = await stat(cppOutput).catch(() => undefined);
    if (!cppStat?.isFile()) {
      throw new BuildFailureError("C++ smoke build produced no executable");
    }
    const publishedCpp = path.join(binRoot, "tsfg-r00-cpp-smoke");
    const zigOutput = path.join(zigPrefix, "bin", "tsfg-r00-zig-smoke");
    const zigStat = await stat(zigOutput).catch(() => undefined);
    if (!zigStat?.isFile()) {
      throw new BuildFailureError("Zig smoke build produced no executable");
    }
    const publishedZig = path.join(binRoot, "tsfg-r00-zig-smoke");
    await copyFile(cppOutput, publishedCpp);
    await copyFile(zigOutput, publishedZig);
    if (process.platform !== "win32") {
      await chmod(publishedCpp, 0o755);
      await chmod(publishedZig, 0o755);
    }
    await publishDirectory(publishRoot, output);
    return {
      outputs: ["bin/tsfg-r00-cpp-smoke", "bin/tsfg-r00-zig-smoke"],
      profile,
      steps,
      target,
    };
  } finally {
    await rm(stagingRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 5 : 0,
      retryDelay: 100,
    });
  }
}

function runSmokeExecutable(name, executable, outputRoot) {
  const result = spawnSync(
    executable,
    [],
    {
      cwd: outputRoot,
      encoding: "utf8",
      env: buildEnvironment(outputRoot, []),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new TestFailureError(
      `${name} failed${detail ? `: ${detail}` : result.error ? `: ${result.error.message}` : ""}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

async function testLinuxDebug(options) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const outputOption = options.get("--out");
  if (!target || !profile || !outputOption) {
    throw new ConfigurationError("test requires --target, --profile, and --out");
  }
  if (target !== "linux-x86_64-gnu" || profile !== "debug") {
    throw new ConfigurationError("R00-06 test supports only linux-x86_64-gnu debug");
  }

  const output = path.resolve(outputOption);
  const cases = [
    {
      executable: path.join(output, "bin", "tsfg-r00-cpp-smoke"),
      name: "cpp-smoke",
      stderr: "",
      stdout: "tsfg-r00-cpp-smoke: ok\n",
    },
    {
      executable: path.join(output, "bin", "tsfg-r00-zig-smoke"),
      name: "zig-smoke",
      stderr: "tsfg-r00-zig-smoke: ok\n",
      stdout: "",
    },
  ];
  const tests = [];
  for (const smoke of cases) {
    const file = await stat(smoke.executable).catch(() => undefined);
    if (!file?.isFile()) {
      throw new TestFailureError(`${smoke.name} executable is missing`);
    }
    const observed = runSmokeExecutable(smoke.name, smoke.executable, output);
    if (observed.stdout !== smoke.stdout || observed.stderr !== smoke.stderr) {
      throw new TestFailureError(
        `${smoke.name} produced unexpected output: ${JSON.stringify(observed)}`,
      );
    }
    tests.push({ name: smoke.name, status: "passed" });
  }
  return { profile, target, tests };
}

const arguments_ = process.argv.slice(2);
const command = arguments_[0] ?? "";
const reportPath = parseReportPath(arguments_);
let runtimeIntegrityError;
let runtimeClosure;
if (
  process.env.TSFG_RUNTIME_LOCK ||
  process.env.TSFG_RUNTIME_CACHE ||
  process.env.TSFG_RUNTIME_PLATFORM
) {
  try {
    if (
      !process.env.TSFG_RUNTIME_LOCK ||
      !process.env.TSFG_RUNTIME_CACHE ||
      !process.env.TSFG_RUNTIME_PLATFORM
    ) {
      throw new Error("incomplete runtime closure identity");
    }
    runtimeClosure = await verifyRuntimeClosure(
      process.env.TSFG_RUNTIME_LOCK,
      process.env.TSFG_RUNTIME_CACHE,
      process.env.TSFG_RUNTIME_PLATFORM,
    );
  } catch (error) {
    runtimeIntegrityError = error;
  }
}

if (runtimeIntegrityError) {
  process.exitCode = await fail(
    command,
    11,
    "lock/integrity",
    { code: "runtime-closure", message: runtimeIntegrityError.message },
    reportPath,
    "offline",
  );
} else if (command === "prefetch") {
  try {
    const options = parseOptions(
      arguments_,
      new Set(["--lock", "--cache", "--platform", "--report"]),
    );
    const result = await prefetch(options);
    process.exitCode = await succeed(
      command,
      result,
      reportPath,
      "online",
    );
  } catch (error) {
    const isConfigurationError = error instanceof ConfigurationError;
    process.exitCode = await fail(
      command,
      isConfigurationError ? 2 : 11,
      isConfigurationError ? "usage/configuration" : "lock/integrity",
      {
        code: isConfigurationError
          ? "invalid-configuration"
          : "prefetch-integrity",
        message: error.message,
      },
      reportPath,
      "online",
    );
  }
} else if (command === "verify-workspace") {
  try {
    const options = parseOptions(
      arguments_,
      new Set([
        "--workspace",
        "--manifest-url",
        "--manifest-revision",
        "--manifest",
        "--report",
      ]),
    );
    const result = await verifyWorkspace(options);
    process.exitCode = await succeed(
      command,
      result,
      reportPath,
      "offline",
    );
  } catch (error) {
    const isConfigurationError = error instanceof ConfigurationError;
    process.exitCode = await fail(
      command,
      isConfigurationError ? 2 : 10,
      isConfigurationError ? "usage/configuration" : "workspace mismatch",
      {
        code: isConfigurationError
          ? "invalid-configuration"
          : (error.issueCode ?? "workspace-state"),
        message: error.message,
      },
      reportPath,
      "offline",
    );
  }
} else if (command === "build") {
  try {
    const options = parseOptions(
      arguments_,
      new Set(["--target", "--profile", "--out", "--report"]),
    );
    if (!runtimeClosure) throw new Error("locked runtime closure is unavailable");
    const result = await buildLinuxDebug(options, runtimeClosure);
    process.exitCode = await succeed(command, result, reportPath, "offline");
  } catch (error) {
    const isConfigurationError = error instanceof ConfigurationError;
    const isBuildFailure = error instanceof BuildFailureError;
    process.exitCode = await fail(
      command,
      isConfigurationError ? 2 : isBuildFailure ? 20 : 30,
      isConfigurationError
        ? "usage/configuration"
        : isBuildFailure ? "build failure" : "internal control-plane failure",
      {
        code: isConfigurationError
          ? "invalid-configuration"
          : isBuildFailure ? "native-build" : "internal-control-plane",
        message: error.message,
      },
      reportPath,
      "offline",
    );
  }
} else if (command === "test") {
  try {
    const options = parseOptions(
      arguments_,
      new Set(["--target", "--profile", "--out", "--report"]),
    );
    if (!runtimeClosure) throw new Error("locked runtime closure is unavailable");
    const result = await testLinuxDebug(options);
    process.exitCode = await succeed(command, result, reportPath, "offline");
  } catch (error) {
    const isConfigurationError = error instanceof ConfigurationError;
    const isTestFailure = error instanceof TestFailureError;
    process.exitCode = await fail(
      command,
      isConfigurationError ? 2 : isTestFailure ? 21 : 30,
      isConfigurationError
        ? "usage/configuration"
        : isTestFailure ? "test failure" : "internal control-plane failure",
      {
        code: isConfigurationError
          ? "invalid-configuration"
          : isTestFailure ? "native-test" : "internal-control-plane",
        message: error.message,
      },
      reportPath,
      "offline",
    );
  }
} else {
  process.exitCode = await fail(
    command,
    2,
    "usage/configuration",
    {
      code: "unsupported-operation",
      message: `unsupported operation: ${command || "<missing>"}`,
    },
    reportPath,
    "disabled",
  );
}
