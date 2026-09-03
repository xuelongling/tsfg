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
import { constants as fsConstants } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { connect as connectNetwork } from "node:net";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import {
  constants as zlibConstants,
  gunzipSync,
  inflateRawSync,
  zstdCompressSync,
} from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

class ConfigurationError extends Error {}
class BuildFailureError extends Error {}
class TestFailureError extends Error {}
class PackageFailureError extends Error {}
class OfflineBoundaryError extends Error {}
class UndeclaredInputError extends Error {}
class SandboxBoundaryError extends Error {}

const SANDBOX_NETWORK_BOUNDARY_STATUS = 123;
const SANDBOX_UNDECLARED_INPUT_STATUS = 124;
const SANDBOX_SETUP_FAILURE_STATUS = 125;
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

async function readRegularFile(filePath, description) {
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const file = await handle.stat();
    if (!file.isFile()) throw new Error("not a regular file");
    return await handle.readFile();
  } catch (error) {
    throw new Error(`${description} is not a stable regular file: ${error.message}`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
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
    injectPublishFailure("report-before-rename");
    await renameWithRetry(temporaryPath, absolutePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function injectPublishFailure(point) {
  if (process.env.TSFG_TEST_FAIL_PUBLISH_AT === point) {
    throw new Error(`injected publish failure at ${point}`);
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
  const parent = path.dirname(destination);
  const versionsRoot = path.join(parent, `.${path.basename(destination)}.versions`);
  let previousVersion;
  let previousLinkTarget;
  try {
    const destinationStat = await lstat(destination);
    if (!destinationStat.isSymbolicLink()) {
      throw new Error(
        `refusing to replace unmanaged output directory: ${destination}`,
      );
    }
    const linkTarget = await readlink(destination);
    previousLinkTarget = linkTarget;
    previousVersion = path.resolve(parent, linkTarget);
    if (path.dirname(previousVersion) !== versionsRoot) {
      throw new Error(`output link escapes its managed versions directory: ${destination}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await mkdir(versionsRoot, { recursive: true });
  for (const entry of await readdir(versionsRoot)) {
    const candidate = path.join(versionsRoot, entry);
    if (candidate !== previousVersion) {
      await rm(candidate, { recursive: true, force: true });
    }
  }

  const versionPath = path.join(versionsRoot, randomUUID());
  const temporaryLink = path.join(
    parent,
    `.${path.basename(destination)}.${randomUUID()}.link`,
  );
  let swapped = false;
  let rolledBack = false;
  const rollback = async () => {
    if (rolledBack) return;
    rolledBack = true;
    if (swapped) {
      if (previousVersion) {
        const rollbackLink = path.join(
          parent,
          `.${path.basename(destination)}.${randomUUID()}.rollback`,
        );
        try {
          await symlink(
            previousLinkTarget,
            rollbackLink,
            process.platform === "win32" ? "junction" : "dir",
          );
          await renameWithRetry(rollbackLink, destination);
        } finally {
          await rm(rollbackLink, { force: true });
        }
      } else {
        await rm(destination, { force: true });
      }
    }
    await rm(versionPath, { recursive: true, force: true });
  };
  await renameWithRetry(source, versionPath);
  try {
    injectPublishFailure("output-version");
    const linkTarget = process.platform === "win32"
      ? versionPath
      : path.relative(parent, versionPath);
    await symlink(
      linkTarget,
      temporaryLink,
      process.platform === "win32" ? "junction" : "dir",
    );
    injectPublishFailure("output-link");
    await renameWithRetry(temporaryLink, destination);
    swapped = true;
    injectPublishFailure("output-swapped");
  } catch (error) {
    await rm(temporaryLink, { force: true });
    await rollback();
    throw error;
  }
  return { rollback };
}

function parseReportPath(arguments_) {
  const index = arguments_.indexOf("--report");
  if (index === -1 || !arguments_[index + 1]) {
    return undefined;
  }
  return arguments_[index + 1];
}

function parseOptions(arguments_, allowed, flags = new Set()) {
  const options = new Map();
  for (let index = 1; index < arguments_.length;) {
    const name = arguments_[index];
    if (!name?.startsWith("--")) {
      throw new ConfigurationError(`invalid argument: ${name ?? "<missing>"}`);
    }
    if (!allowed.has(name)) {
      throw new ConfigurationError(`unknown option: ${name}`);
    }
    if (options.has(name)) {
      throw new ConfigurationError(`duplicate argument: ${name}`);
    }
    if (flags.has(name)) {
      options.set(name, true);
      index += 1;
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined) {
      throw new ConfigurationError(`invalid argument: ${name}`);
    }
    options.set(name, value);
    index += 2;
  }
  return options;
}

function validateSmokeOptions(options, command, requireInput = false) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const output = options.get("--out");
  const input = options.get("--input");
  if (!target || !profile || !output || (requireInput && !input)) {
    throw new ConfigurationError(
      `${command} requires --target, --profile, ${requireInput ? "--input, " : ""}and --out`,
    );
  }
  if (!["linux-x86_64-gnu", "windows-x86_64-msvc"].includes(target) || profile !== "debug") {
    throw new ConfigurationError(`R00 ${command} supports only declared Linux and Windows debug targets`);
  }
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

async function networkCanaryConnects(host) {
  return await new Promise((resolve) => {
    let socket;
    try {
      socket = connectNetwork({ host, port: 443 });
    } catch {
      resolve(false);
      return;
    }
    const finish = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

async function verifyOfflineBoundary() {
  for (const host of ["1.1.1.1", "8.8.8.8"]) {
    if (await networkCanaryConnects(host)) {
      throw new OfflineBoundaryError(
        `network canary unexpectedly connected to ${host}:443`,
      );
    }
  }
  if (process.platform === "linux") {
    const ipv4Routes = await readFile("/proc/net/route", "utf8");
    const externalIpv4Route = ipv4Routes
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .some((fields) => fields.length > 1 && fields[0] !== "lo");
    const ipv6Routes = await readFile("/proc/net/ipv6_route", "utf8");
    const externalIpv6Route = ipv6Routes
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .some((fields) => fields.length > 9 && fields[9] !== "lo");
    if (externalIpv4Route || externalIpv6Route) {
      throw new OfflineBoundaryError(
        "offline network isolation is not established: a non-loopback route is present",
      );
    }
  }
  return "blocked";
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
  const bootstrapValid = artifact.archiveFormat !== "7zip-bootstrap" || (
    /^https?:\/\//.test(artifact.bootstrap?.url) &&
    /^(0|[1-9][0-9]*)$/.test(artifact.bootstrap?.byteSize) &&
    digestPattern.test(artifact.bootstrap?.archiveSha256)
  );
  const archiveSetValid =
    ["deb-xz-set", "zip-set"].includes(artifact.archiveFormat) &&
    Array.isArray(artifact.archives) &&
    artifact.archives.length > 0 &&
    artifact.archives.every((member) =>
      typeof member.id === "string" &&
      member.id.length > 0 &&
      /^https?:\/\//.test(member.url) &&
      /^(0|[1-9][0-9]*)$/.test(member.byteSize) &&
      digestPattern.test(member.archiveSha256) &&
      (artifact.archiveFormat !== "zip-set" || member.archiveFormat === "zip") &&
      typeof member.license === "string" &&
      member.license.length > 0);
  if (
    !commonMetadataValid ||
    !bootstrapValid ||
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

async function extractArchive(bytes, format, toolRoot, stripComponents, includePrefix) {
  const included = (entries) => includePrefix
    ? entries.filter(({ name }) => name.startsWith(includePrefix))
    : entries;
  if (format === "zip") await extractEntries(included(parseZip(bytes)), toolRoot, stripComponents);
  else if (["tar.gz", "apk-v2"].includes(format)) {
    await extractEntries(included(parseTar(gunzipSync(bytes))), toolRoot, stripComponents);
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

function archiveSources(selections) {
  return selections.flatMap(({ artifact }) => [
    ...(artifact.archives ?? [artifact]),
    ...(artifact.bootstrap ? [artifact.bootstrap] : []),
  ]);
}

async function verifyCachedArchive(source, archivePath) {
  const archiveStat = await lstat(archivePath).catch(() => undefined);
  if (!archiveStat?.isFile() || archiveStat.isSymbolicLink()) {
    throw new Error(`cached archive is missing or has invalid type: ${source.archiveSha256}`);
  }
  if (String(archiveStat.size) !== source.byteSize) {
    throw new Error(`cached archive byte size mismatch: ${source.archiveSha256}`);
  }
  const actual = await digestFile(archivePath);
  if (actual !== source.archiveSha256) {
    throw new Error(
      `cached archive digest mismatch: expected ${source.archiveSha256}, got ${actual}`,
    );
  }
}

async function publishCachedArchive(sourcePath, archivePath) {
  const parent = path.dirname(archivePath);
  const temporaryPath = path.join(parent, `.${path.basename(archivePath)}.${randomUUID()}.tmp`);
  await mkdir(parent, { recursive: true });
  try {
    await copyFile(sourcePath, temporaryPath);
    await renameWithRetry(temporaryPath, archivePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function acquireArchive(toolId, source, destination, archiveCacheRoot) {
  const archivePath = path.join(
    archiveCacheRoot,
    source.archiveSha256.slice("sha256:".length),
  );
  if (await pathExists(archivePath)) {
    await verifyCachedArchive(source, archivePath);
    await copyFile(archivePath, destination);
    return;
  }
  await downloadToFile(toolId, source, destination);
  await publishCachedArchive(destination, archivePath);
}

async function verifyArchiveCache(archiveCacheRoot, selections, requireComplete) {
  const sources = archiveSources(selections);
  const expected = new Map(sources.map((source) => [
    source.archiveSha256.slice("sha256:".length),
    source,
  ]));
  const entries = await readdir(archiveCacheRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!entries) {
    if (requireComplete) throw new Error("cached archive set is missing");
    return;
  }
  for (const entry of entries) {
    const source = expected.get(entry.name);
    if (!source) throw new Error(`unexpected cached archive object: ${entry.name}`);
    if (!entry.isFile()) throw new Error(`cached archive has invalid type: ${entry.name}`);
    await verifyCachedArchive(source, path.join(archiveCacheRoot, entry.name));
    expected.delete(entry.name);
  }
  if (requireComplete && expected.size > 0) {
    throw new Error(`cached archive is missing: ${[...expected.keys()][0]}`);
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
  if (extractor.kind === "7zip") {
    const extractionRoot = path.join(temporaryRoot, `.extract.${randomUUID()}`);
    const expandedRoot = path.join(extractionRoot, "expanded");
    await mkdir(expandedRoot, { recursive: true });
    try {
      runArchiveExtractor(
        extractor.executable,
        ["x", "-y", "-bd", "-bb0", `-o${extractionRoot}`, archive],
        temporaryRoot,
      );
      const firstPass = (await readdir(extractionRoot, { withFileTypes: true }))
        .filter(({ name }) => name !== "expanded");
      if (firstPass.length !== 1 || !firstPass[0].isFile()) {
        throw new Error("7-Zip xz extraction did not produce exactly one tar archive");
      }
      runArchiveExtractor(
        extractor.executable,
        ["x", "-y", "-bd", "-bb0", `-o${expandedRoot}`, path.join(extractionRoot, firstPass[0].name)],
        temporaryRoot,
      );
      let sourceRoot = expandedRoot;
      for (let depth = 0; depth < stripComponents; depth += 1) {
        const children = await readdir(sourceRoot, { withFileTypes: true });
        if (children.length !== 1 || !children[0].isDirectory()) {
          throw new Error("7-Zip archive cannot apply the requested stripComponents");
        }
        sourceRoot = path.join(sourceRoot, children[0].name);
      }
      for (const child of await readdir(sourceRoot)) {
        await rename(path.join(sourceRoot, child), path.join(toolRoot, child));
      }
    } finally {
      await rm(extractionRoot, { recursive: true, force: true });
    }
    return;
  }
  runArchiveExtractor(
    extractor.executable,
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

async function downloadArtifact(
  toolId,
  artifact,
  toolRoot,
  downloadsRoot,
  extractor,
  archiveCacheRoot,
) {
  await mkdir(downloadsRoot, { recursive: true });
  if (artifact.archiveFormat === "deb-xz-set") {
    if (!extractor) throw new Error("locked archive extractor is unavailable");
    for (const member of artifact.archives) {
      const archive = path.join(downloadsRoot, `${toolId}-${member.id}.deb`);
      await acquireArchive(`${toolId}/${member.id}`, member, archive, archiveCacheRoot);
      const dataArchive = path.join(downloadsRoot, `${toolId}-${member.id}.data.tar.xz`);
      await writeFile(dataArchive, debianDataArchive(await readFile(archive)), { flag: "wx" });
      await extractTar(extractor, dataArchive, toolRoot, 0, downloadsRoot, "xz");
    }
    await normalizeSysrootLinks(toolRoot);
  } else if (artifact.archiveFormat === "zip-set") {
    const stripComponents = artifact.stripComponents ?? "0";
    if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
      throw new Error(`invalid stripComponents for ${toolId}`);
    }
    if (
      typeof artifact.includePrefix !== "string" ||
      !artifact.includePrefix.endsWith("/") ||
      artifact.includePrefix.startsWith("/") ||
      artifact.includePrefix.includes("..")
    ) {
      throw new Error(`invalid includePrefix for ${toolId}`);
    }
    await mkdir(toolRoot, { recursive: true });
    for (const member of artifact.archives) {
      const archive = path.join(downloadsRoot, `${toolId}-${member.id}.zip`);
      await acquireArchive(`${toolId}/${member.id}`, member, archive, archiveCacheRoot);
      try {
        await extractArchive(
          await readFile(archive),
          member.archiveFormat,
          toolRoot,
          Number.parseInt(stripComponents, 10),
          artifact.includePrefix,
        );
      } catch (error) {
        throw new Error(`${toolId}/${member.id} archive extraction failed: ${error.message}`);
      }
    }
  } else {
    const archive = path.join(downloadsRoot, `${toolId}.archive`);
    await acquireArchive(toolId, artifact, archive, archiveCacheRoot);
    if (artifact.archiveFormat === "7zip-bootstrap") {
      const bootstrap = path.join(downloadsRoot, `${toolId}-bootstrap.exe`);
      await acquireArchive(`${toolId}/bootstrap`, artifact.bootstrap, bootstrap, archiveCacheRoot);
      await mkdir(toolRoot, { recursive: true });
      runArchiveExtractor(
        bootstrap,
        ["x", "-y", "-bd", "-bb0", `-o${toolRoot}`, archive],
        downloadsRoot,
      );
    } else if (artifact.archiveFormat === "raw") {
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

async function verifyCachedClosure(closurePath, selections, lockDigest, platform) {
  const expected = new Set(["ready.json", ...selections.map(({ id }) => id)]);
  const entries = await readdir(closurePath, { withFileTypes: true });
  for (const entry of entries) {
    if (!expected.has(entry.name)) {
      throw new Error(`unexpected cached closure object: ${entry.name}`);
    }
    if (entry.name === "ready.json" ? !entry.isFile() : !entry.isDirectory()) {
      throw new Error(`cached closure object has invalid type: ${entry.name}`);
    }
    expected.delete(entry.name);
  }
  if (expected.size > 0) {
    throw new Error(`cached closure object is missing: ${[...expected][0]}`);
  }
  const ready = JSON.parse(await readFile(path.join(closurePath, "ready.json"), "utf8"));
  if (
    ready.status !== "ready" ||
    ready.lockDigest !== lockDigest ||
    ready.platform !== platform
  ) {
    throw new Error("cached closure readiness identity mismatch");
  }
  for (const selection of selections) {
    await verifyInstalledTool(
      path.join(closurePath, selection.id),
      selection.artifact,
    );
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
  const archiveCacheRoot = path.join(
    absoluteCache,
    "archives",
    "sha256",
    lockHex,
    platform,
  );

  if (await pathExists(finalPath)) {
    try {
      await verifyArchiveCache(archiveCacheRoot, selections, true);
      await verifyCachedClosure(finalPath, selections, lockDigest, platform);
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
      await verifyArchiveCache(archiveCacheRoot, selections, false);
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
          archiveCacheRoot,
        );
        if (selection.id.includes("archive-extractor")) {
          extractor = {
            executable: checkedInstallPath(
              path.join(stagingPath, selection.id),
              selection.artifact.installPath,
            ),
            kind: selection.artifact.extractorKind ?? "busybox",
          };
        }
      }
      await rm(downloadsRoot, { recursive: true, force: true });
      await verifyArchiveCache(archiveCacheRoot, selections, true);
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
    cacheKey: `${platform}/sha256/${lockHex}`,
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
  await verifyCachedClosure(closurePath, selections, lockDigest, platform);
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

function inspectProductWorkspace(options, allowDevelopment) {
  const workspace = path.resolve(options.get("--workspace") ?? repositoryRoot);
  const status = gitOutput(workspace, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  const dirty = status.length !== 0;
  const development = options.has("--dev");
  if (development && !allowDevelopment) {
    throw new WorkspaceMismatchError(
      "development-mode-forbidden",
      `${command} does not permit development mode`,
    );
  }
  if (dirty && !development) {
    throw new WorkspaceMismatchError("dirty-project", `${workspace} is dirty`);
  }
  requireVisibleTrackedFiles(workspace);
  return {
    development,
    dirty,
    publishable: !development && !dirty,
    root: workspace,
  };
}

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
    environment.APPDATA = temporaryRoot;
    environment.ComSpec = process.env.ComSpec;
    environment.LOCALAPPDATA = temporaryRoot;
    environment.SystemRoot = process.env.SystemRoot;
    environment.TEMP = temporaryRoot;
    environment.TMP = temporaryRoot;
    environment.USERPROFILE = temporaryRoot;
  }
  return environment;
}

function throwSandboxBoundaryFailure(detail, operation, status) {
  if (status === SANDBOX_NETWORK_BOUNDARY_STATUS) {
    throw new OfflineBoundaryError(`sandbox network isolation failed during ${operation}: ${detail}`);
  }
  if (status === SANDBOX_UNDECLARED_INPUT_STATUS) {
    throw new UndeclaredInputError(`sandbox denied an undeclared ${operation} input: ${detail}`);
  }
  if (status === SANDBOX_SETUP_FAILURE_STATUS) {
    throw new SandboxBoundaryError(`sandbox setup failed during ${operation}: ${detail}`);
  }
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

function runBuildTool(
  toolId,
  executable,
  arguments_,
  cwd,
  environment,
  sandboxProtocol = false,
) {
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
    if (sandboxProtocol) throwSandboxBoundaryFailure(detail, "build", error.status);
    throw new BuildFailureError(`${toolId} failed${detail ? `: ${detail}` : ""}`);
  }
}

function sandboxArguments(
  { readOnly = [], readExecute = [], readWrite = [], root, shell },
  executable,
  arguments_,
) {
  return [
    "--root", root,
    "--shell", shell,
    ...readOnly.flatMap((allowedPath) => ["--ro", allowedPath]),
    ...readExecute.flatMap((allowedPath) => ["--rx", allowedPath]),
    ...readWrite.flatMap((allowedPath) => ["--rw", allowedPath]),
    "--",
    executable,
    ...arguments_,
  ];
}

async function compileSandbox(runtime, sourceRoot, controlRoot) {
  const zig = closureToolPath(runtime, "zig");
  const executable = path.join(controlRoot, "sandbox-run");
  await mkdir(controlRoot, { recursive: true });
  runBuildTool(
    "sandbox-bootstrap",
    zig,
    [
      "cc",
      "-target", "x86_64-linux-musl",
      "-static",
      "-O2",
      path.join(sourceRoot, "eng", "sandbox-run.c"),
      "-o", executable,
    ],
    sourceRoot,
    buildEnvironment(controlRoot, [path.dirname(zig)]),
  );
  await readRegularFile(executable, "sandbox executable");
  await chmod(executable, 0o755);
  return { executable };
}

function windowsSandboxArguments(policy, executable, arguments_) {
  return [
    ...policy.readOnly.flatMap((allowedPath) => ["--ro", allowedPath]),
    ...policy.readExecute.flatMap((allowedPath) => ["--rx", allowedPath]),
    ...policy.readWrite.flatMap((allowedPath) => ["--rw", allowedPath]),
    "--",
    executable,
    ...arguments_,
  ];
}

async function compileWindowsSandbox(runtime, sourceRoot, controlRoot) {
  const zig = closureToolPath(runtime, "zig");
  const executable = path.join(controlRoot, "windows-sandbox-run.exe");
  await mkdir(controlRoot, { recursive: true });
  runBuildTool(
    "windows-sandbox-bootstrap",
    zig,
    [
      "cc",
      "-target", "x86_64-windows-msvc",
      "-O2",
      "-municode",
      path.join(sourceRoot, "eng", "windows-sandbox-run.c"),
      "-ladvapi32",
      "-luserenv",
      "-o", executable,
    ],
    sourceRoot,
    buildEnvironment(controlRoot, [path.dirname(zig)]),
  );
  await readRegularFile(executable, "Windows sandbox executable");
  return { executable };
}

function verifyWindowsSandboxBoundary(
  sandboxExecutable,
  runtime,
  sourceRoot,
  workRoot,
  undeclaredRoot,
) {
  const node = closureToolPath(runtime, "node");
  const policy = {
    readOnly: [sourceRoot],
    readExecute: [runtime.closurePath, path.dirname(sourceRoot)],
    readWrite: [workRoot],
  };
  const environment = buildEnvironment(workRoot, [path.dirname(node)]);
  runBuildTool(
    "network-canary",
    sandboxExecutable,
    windowsSandboxArguments(policy, node, [
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
    windowsSandboxArguments(policy, node, [
      "-e",
      `require('node:fs').readFile(${JSON.stringify(path.join(undeclaredRoot, "version.json"))},e=>process.exit(e?0:124))`,
    ]),
    sourceRoot,
    environment,
    true,
  );
}

async function buildLinuxDebug(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const outputOption = options.get("--out");
  if (!target || !profile || !outputOption) {
    throw new ConfigurationError("build requires --target, --profile, and --out");
  }
  if (target !== "linux-x86_64-gnu" || profile !== "debug") {
    throw new ConfigurationError("R00-06 build supports only linux-x86_64-gnu debug");
  }
  let identity;
  try {
    identity = await createBuildIdentity(runtime, target, profile, workspaceState.root);
  } catch (error) {
    throw new BuildFailureError(`cannot derive Build Identity: ${error.message}`);
  }

  const output = path.resolve(outputOption);
  const stagingRoot = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${randomUUID()}.tmp`,
  );
  const sourceRoot = path.join(stagingRoot, "source");
  const workRoot = path.join(stagingRoot, "work");
  const controlRoot = path.join(stagingRoot, "control");
  const sandboxRoot = `${stagingRoot}-sandbox`;
  const publishRoot = path.join(stagingRoot, "publish");
  const cppWork = path.join(workRoot, "cpp");
  const wrapperRoot = path.join(controlRoot, "llvm-wrappers");
  const zigPrefix = path.join(workRoot, "zig-install");
  const sandboxExecutable = path.join(controlRoot, "sandbox-run");
  const sandboxRequired = process.platform === "linux";
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
  const lockedShell = closureToolPath(runtime, "archive-extractor");
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
  environment.SOURCE_DATE_EPOCH = identity.buildIdentity.source_date_epoch;
  const debugPathFlags = [
    `-ffile-prefix-map=${sourceRoot}=.`,
    `-fdebug-prefix-map=${sourceRoot}=.`,
    `-fmacro-prefix-map=${sourceRoot}=.`,
    `-ffile-prefix-map=${runtime.closurePath}=.toolchain`,
    `-fdebug-prefix-map=${runtime.closurePath}=.toolchain`,
    `-fmacro-prefix-map=${runtime.closurePath}=.toolchain`,
    `-ffile-prefix-map=${workRoot}=.build`,
    `-fdebug-prefix-map=${workRoot}=.build`,
    `-fmacro-prefix-map=${workRoot}=.build`,
    "-fdebug-compilation-dir=.",
  ];
  const cmakeArguments = [
    "-S", path.join(sourceRoot, "tests", "r00", "smoke", "cpp"),
    "-B", cppWork,
    "-G", "Ninja",
    `-DCMAKE_MAKE_PROGRAM=${ninja}`,
    `-DCMAKE_CXX_COMPILER=${compilerWrapper}`,
    `-DCMAKE_AR=${arWrapper}`,
    `-DCMAKE_RANLIB=${ranlibWrapper}`,
    "-DCMAKE_BUILD_TYPE=Debug",
    "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY",
    `-DCMAKE_SYSROOT=${sysroot}`,
    `-DCMAKE_CXX_FLAGS_DEBUG=-O0 -g3 -UNDEBUG -fno-omit-frame-pointer ${debugPathFlags.join(" ")}`,
    `-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=${linkerWrapper} --rtlib=compiler-rt -unwindlib=none`,
  ];
  const ninjaArguments = ["-C", cppWork, "tsfg-r00-cpp-smoke"];
  const zigArguments = [
    "build",
    "--build-file", "tests/r00/smoke/zig/build.zig",
    "--prefix", zigPrefix,
    "--cache-dir", path.join(workRoot, "zig-cache"),
    "--global-cache-dir", path.join(workRoot, "zig-global-cache"),
    "-Dtarget=x86_64-linux-gnu",
    "-Doptimize=Debug",
    "--seed", "0",
  ];
  const steps = [
    { tool: "cmake", executable: cmake, arguments: cmakeArguments },
    { tool: "ninja", executable: ninja, arguments: ninjaArguments },
    { tool: "zig", executable: zig, arguments: zigArguments },
  ];

  try {
    await materializeBuildInputs(
      workspaceState.root,
      identity.buildInputSet,
      sourceRoot,
    );
    await mkdir(cppWork, { recursive: true });
    await mkdir(wrapperRoot, { recursive: true });
    await mkdir(path.join(zigPrefix, "bin"), { recursive: true });
    await mkdir(binRoot, { recursive: true });
    if (sandboxRequired) {
      await compileSandbox(runtime, sourceRoot, controlRoot);
      environment.TSFG_LOCKED_LOADER = loader;
      environment.TSFG_LOCKED_LIBRARIES = runtimeLibraries;
      environment.TSFG_LOCKED_CLANGXX = clangxx;
      environment.TSFG_LOCKED_CLANG_RESOURCE = `-resource-dir=${path.join(
        runtime.closurePath,
        "llvm",
        "lib",
        "clang",
        "22",
      )}`;
      environment.TSFG_LOCKED_LLD = lld;
      environment.TSFG_LOCKED_AR = llvmAr;
      environment.TSFG_LOCKED_RANLIB = llvmRanlib;
    }
    if (sandboxRequired) {
      for (const wrapper of [compilerWrapper, linkerWrapper, arWrapper, ranlibWrapper]) {
        await copyFile(sandboxExecutable, wrapper);
        await chmod(wrapper, 0o755);
      }
    } else {
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
    }
    const sandboxPolicy = {
      readOnly: [sourceRoot],
      readExecute: [runtime.closurePath, controlRoot],
      readWrite: [workRoot],
      root: sandboxRoot,
      shell: lockedShell,
    };
    for (const step of steps) {
      if (sandboxRequired) {
        const command = step.tool === "cmake" ? loader : step.executable;
        const commandArguments = step.tool === "cmake"
          ? ["--library-path", runtimeLibraries, step.executable, ...step.arguments]
          : step.arguments;
        runBuildTool(
          step.tool,
          sandboxExecutable,
          sandboxArguments(sandboxPolicy, command, commandArguments),
          sourceRoot,
          environment,
          true,
        );
      } else {
        runBuildTool(step.tool, step.executable, step.arguments, sourceRoot, environment);
      }
    }
    const cppBytes = await readRegularFile(cppOutput, "C++ smoke build output")
      .catch((error) => { throw new BuildFailureError(error.message); });
    const publishedCpp = path.join(binRoot, "tsfg-r00-cpp-smoke");
    const zigOutput = path.join(zigPrefix, "bin", "tsfg-r00-zig-smoke");
    const zigBytes = await readRegularFile(zigOutput, "Zig smoke build output")
      .catch((error) => { throw new BuildFailureError(error.message); });
    const publishedZig = path.join(binRoot, "tsfg-r00-zig-smoke");
    await writeFile(publishedCpp, cppBytes, { flag: "wx" });
    await writeFile(publishedZig, zigBytes, { flag: "wx" });
    if (process.platform !== "win32") {
      await chmod(publishedCpp, 0o755);
      await chmod(publishedZig, 0o755);
    }
    const payloads = await Promise.all([
      "bin/tsfg-r00-cpp-smoke",
      "bin/tsfg-r00-zig-smoke",
    ].map(async (payloadPath) => ({
      path: payloadPath,
      sha256: await digestFile(path.join(publishRoot, ...payloadPath.split("/"))),
    })));
    const metadata = {
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      contractSetId: identity.contractSetId,
      development: workspaceState.development,
      dirty: workspaceState.dirty,
      inputAudit: {
        mode: sandboxRequired
          ? "materialized-build-input-set+namespaces"
          : "materialized-build-input-set",
        undeclaredReads: "blocked",
      },
      networkCanary,
      payloads,
      productVersion: identity.productVersion,
      publishable: workspaceState.publishable,
      schemaVersion: "1",
      toolchainClosureDigest: runtime.lockDigest,
    };
    await writeFile(
      path.join(publishRoot, "build-metadata.json"),
      `${canonicalize(metadata)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    const publication = await publishDirectory(publishRoot, output);
    const result = {
      buildIdentity: identity.buildIdentity,
      contractSetId: identity.contractSetId,
      development: workspaceState.development,
      dirty: workspaceState.dirty,
      inputAudit: metadata.inputAudit,
      networkCanary,
      outputs: [
        "bin/tsfg-r00-cpp-smoke",
        "bin/tsfg-r00-zig-smoke",
        "build-metadata.json",
      ],
      profile,
      publishable: workspaceState.publishable,
      steps,
      target,
    };
    Object.defineProperty(result, "publication", { value: publication });
    return result;
  } finally {
    await rm(stagingRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 5 : 0,
      retryDelay: 100,
    });
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

function windowsToolchain(runtime) {
  const msvcRoot = path.join(runtime.closurePath, "msvc-tools", "VC", "Tools", "MSVC", "14.44.35207");
  const sdkRoot = path.join(runtime.closurePath, "windows-sdk", "c");
  const sdkVersion = "10.0.26100.0";
  return {
    clangcl: closureToolPath(runtime, "llvm", "clangcl"),
    cl: closureToolPath(runtime, "msvc-tools", "cl"),
    cmake: closureToolPath(runtime, "cmake"),
    include: [
      path.join(msvcRoot, "include"),
      ...["ucrt", "shared", "um", "winrt", "cppwinrt"].map((directory) =>
        path.join(sdkRoot, "Include", sdkVersion, directory)),
    ],
    lib: [
      path.join(msvcRoot, "lib", "x64"),
      path.join(sdkRoot, "ucrt", "x64"),
      path.join(sdkRoot, "um", "x64"),
    ],
    link: closureToolPath(runtime, "msvc-tools", "link"),
    lld: closureToolPath(runtime, "llvm", "lld"),
    mt: closureToolPath(runtime, "windows-sdk", "mt"),
    ninja: closureToolPath(runtime, "ninja"),
    pdbutil: closureToolPath(runtime, "llvm", "pdbutil"),
    rc: closureToolPath(runtime, "windows-sdk", "rc"),
    zig: closureToolPath(runtime, "zig"),
  };
}

async function normalizeWindowsPdb(pdbPath, pdbutil, pathMappings, workRoot, environment) {
  const yamlPath = path.join(workRoot, `${path.basename(pdbPath)}.${randomUUID()}.yaml`);
  const normalizedPath = path.join(workRoot, `${path.basename(pdbPath)}.${randomUUID()}.pdb`);
  const dumped = spawnSync(pdbutil, ["pdb2yaml", "--all", pdbPath], {
    cwd: workRoot,
    encoding: "utf8",
    env: environment,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (dumped.error || dumped.status !== 0) {
    throw new BuildFailureError(
      `llvm-pdbutil pdb2yaml failed: ${(dumped.stderr || dumped.error?.message || "unknown failure").trim()}`,
    );
  }
  let yaml = dumped.stdout;
  for (const [source, replacement] of pathMappings) {
    yaml = yaml.replaceAll(source, replacement);
    yaml = yaml.replaceAll(source.replaceAll("\\", "/"), replacement);
  }
  await writeFile(yamlPath, yaml, { encoding: "utf8", flag: "wx" });
  try {
    runBuildTool(
      "llvm-pdbutil",
      pdbutil,
      ["yaml2pdb", `--pdb=${normalizedPath}`, yamlPath],
      workRoot,
      environment,
    );
    await copyFile(normalizedPath, pdbPath);
  } finally {
    await rm(yamlPath, { force: true });
    await rm(normalizedPath, { force: true });
  }
}

async function buildWindowsDebug(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const outputOption = options.get("--out");
  if (!target || !profile || !outputOption) {
    throw new ConfigurationError("build requires --target, --profile, and --out");
  }
  if (target !== "windows-x86_64-msvc" || profile !== "debug") {
    throw new ConfigurationError("R00-09 Windows build supports only windows-x86_64-msvc debug");
  }
  if (process.platform !== "win32") {
    throw new ConfigurationError("windows-x86_64-msvc debug builds require a Windows host");
  }

  let identity;
  try {
    identity = await createBuildIdentity(runtime, target, profile, workspaceState.root);
  } catch (error) {
    throw new BuildFailureError(`cannot derive Build Identity: ${error.message}`);
  }
  const output = path.resolve(outputOption);
  const stagingRoot = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp`);
  const sourceRoot = path.join(stagingRoot, "source");
  const workRoot = path.join(stagingRoot, "work");
  const controlRoot = path.join(stagingRoot, "control");
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
  const cmakeArguments = [
    "-S", cmakePath(path.join(sourceRoot, "tests", "r00", "smoke", "cpp")),
    "-B", cmakePath(cppWork),
    "-G", "Ninja",
    `-DCMAKE_MAKE_PROGRAM=${cmakePath(tools.ninja)}`,
    `-DCMAKE_CXX_COMPILER=${cmakePath(tools.clangcl)}`,
    `-DCMAKE_LINKER=${cmakePath(tools.lld)}`,
    `-DCMAKE_RC_COMPILER=${cmakePath(tools.rc)}`,
    `-DCMAKE_MT=${cmakePath(tools.mt)}`,
    "-DCMAKE_BUILD_TYPE=Debug",
    "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY",
    "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDebug",
    `-DCMAKE_CXX_FLAGS_DEBUG=/Od /Zi /UNDEBUG /Brepro ${clangPathMapFlags.join(" ")} /clang:-fdebug-compilation-dir=.`,
    "-DCMAKE_EXE_LINKER_FLAGS=/debug:full /Brepro /pdbaltpath:%_PDB% /nodefaultlib libcmtd.lib libvcruntimed.lib libucrtd.lib kernel32.lib /entry:mainCRTStartup",
  ];
  const zigArguments = [
    "build",
    "--build-file", "tests/r00/smoke/zig/build.zig",
    "--prefix", zigPrefix,
    "--cache-dir", path.join(workRoot, "zig-cache"),
    "--global-cache-dir", path.join(workRoot, "zig-global-cache"),
    "-Dtarget=x86_64-windows-msvc",
    "-Doptimize=Debug",
    "--seed", "0",
  ];
  const compatibilityObject = path.join(compatibilityRoot, "main.obj");
  const compatibilityExecutable = path.join(compatibilityRoot, "tsfg-r00-msvc-compat.exe");
  const steps = [
    { role: "normative", tool: "cmake", executable: tools.cmake, arguments: cmakeArguments },
    { role: "normative", tool: "ninja", executable: tools.ninja, arguments: ["-C", cppWork, "tsfg-r00-cpp-smoke"] },
    { role: "normative", tool: "zig", executable: tools.zig, arguments: zigArguments },
    {
      role: "compatibility-only",
      tool: "cl",
      executable: tools.cl,
      arguments: ["/nologo", "/c", "/Od", "/Zi", "/MTd", "/Brepro", ...msvcPathMapFlags,
        path.join(sourceRoot, "tests", "r00", "smoke", "cpp", "main.cpp"), `/Fo${compatibilityObject}`],
    },
    {
      role: "compatibility-only",
      tool: "link",
      executable: tools.link,
      arguments: ["/nologo", "/debug:full", "/Brepro", "/pdbaltpath:%_PDB%", "/nodefaultlib",
        "/subsystem:console", "/entry:mainCRTStartup", compatibilityObject, "libcmtd.lib",
        "libvcruntimed.lib", "libucrtd.lib", "kernel32.lib", `/out:${compatibilityExecutable}`],
    },
  ];

  try {
    await materializeBuildInputs(workspaceState.root, identity.buildInputSet, sourceRoot);
    await Promise.all([cppWork, path.join(zigPrefix, "bin"), compatibilityRoot, binRoot, symbolRoot]
      .map((directory) => mkdir(directory, { recursive: true })));
    let sandboxExecutable;
    if (runtime.platform === target) {
      ({ executable: sandboxExecutable } = await compileWindowsSandbox(runtime, sourceRoot, controlRoot));
      verifyWindowsSandboxBoundary(
        sandboxExecutable,
        runtime,
        sourceRoot,
        workRoot,
        workspaceState.root,
      );
    }
    for (const step of steps) {
      runBuildTool(
        step.tool,
        step.executable,
        step.arguments,
        sourceRoot,
        environment,
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
      const executableBytes = await readRegularFile(item.source, item.destination)
        .catch((error) => { throw new BuildFailureError(error.message); });
      await normalizeWindowsPdb(
        item.symbolSource,
        tools.pdbutil,
        [
          [sourceRoot, "."],
          [runtime.closurePath, ".toolchain"],
          [workRoot, ".build"],
          [stagingRoot, ".build"],
        ],
        workRoot,
        environment,
      );
      const symbolBytes = await readRegularFile(item.symbolSource, item.symbolDestination)
        .catch((error) => { throw new BuildFailureError(error.message); });
      await writeFile(path.join(publishRoot, ...item.destination.split("/")), executableBytes, { flag: "wx" });
      await writeFile(path.join(publishRoot, ...item.symbolDestination.split("/")), symbolBytes, { flag: "wx" });
      payloads.push({ path: item.destination, sha256: digest(executableBytes) });
      symbols.push({ path: item.symbolDestination, sha256: digest(symbolBytes) });
    }
    const metadata = {
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      contractSetId: identity.contractSetId,
      development: workspaceState.development,
      dirty: workspaceState.dirty,
      inputAudit: { mode: "materialized-build-input-set+appcontainer-canaries", undeclaredReads: "blocked" },
      networkCanary,
      payloads,
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
    const publication = await publishDirectory(publishRoot, output);
    const result = {
      buildIdentity: identity.buildIdentity,
      contractSetId: identity.contractSetId,
      development: workspaceState.development,
      dirty: workspaceState.dirty,
      inputAudit: metadata.inputAudit,
      networkCanary,
      outputs: [...payloads, ...symbols].map(({ path: outputPath }) => outputPath).concat("build-metadata.json"),
      profile,
      publishable: workspaceState.publishable,
      steps,
      target,
    };
    Object.defineProperty(result, "publication", { value: publication });
    return result;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function runSmokeExecutable(
  name,
  executable,
  outputRoot,
  runtime,
  sandboxExecutable,
  sandboxRoot,
  lockedShell,
) {
  const sysroot = path.join(runtime.closurePath, "debian-sysroot");
  const command = runtime.platform === "linux-x86_64-gnu"
    ? path.join(sysroot, "lib", "x86_64-linux-gnu", "ld-linux-x86-64.so.2")
    : executable;
  const commandArguments = runtime.platform === "linux-x86_64-gnu"
    ? [
        "--library-path",
        [
          path.join(sysroot, "lib", "x86_64-linux-gnu"),
          path.join(sysroot, "usr", "lib", "x86_64-linux-gnu"),
        ].join(":"),
        executable,
      ]
    : [];
  const result = spawnSync(
    sandboxExecutable ?? command,
    sandboxExecutable
      ? runtime.platform === "windows-x86_64-msvc"
        ? windowsSandboxArguments(
          { readOnly: [], readExecute: [outputRoot, runtime.closurePath], readWrite: [] },
          command,
          commandArguments,
        )
        : sandboxArguments(
          {
            readExecute: [outputRoot, runtime.closurePath],
            root: sandboxRoot,
            shell: lockedShell,
          },
          command,
          commandArguments,
        )
      : commandArguments,
    {
      cwd: outputRoot,
      encoding: "utf8",
      env: buildEnvironment(outputRoot, []),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (sandboxExecutable) throwSandboxBoundaryFailure(detail, "test", result.status);
    throw new TestFailureError(
      `${name} failed${detail ? `: ${detail}` : result.error ? `: ${result.error.message}` : ""}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

async function testDebug(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const outputOption = options.get("--out");
  if (!target || !profile || !outputOption) {
    throw new ConfigurationError("test requires --target, --profile, and --out");
  }
  if (!["linux-x86_64-gnu", "windows-x86_64-msvc"].includes(target) || profile !== "debug") {
    throw new ConfigurationError("R00 debug test supports only declared Linux and Windows targets");
  }
  if (target === "windows-x86_64-msvc" && process.platform !== "win32") {
    throw new ConfigurationError("windows-x86_64-msvc debug tests require a Windows host");
  }

  const output = path.resolve(outputOption);
  const testRoot = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${randomUUID()}.test`,
  );
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
    typeof metadata.development !== "boolean" ||
    typeof metadata.dirty !== "boolean" ||
    typeof metadata.publishable !== "boolean"
  ) {
    throw new TestFailureError("Build Metadata does not match the requested test target");
  }
  let identity;
  try {
    identity = await createBuildIdentity(runtime, target, profile, workspaceState.root);
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
    const controlRoot = path.join(testRoot, "control");
    await materializeBuildInputs(workspaceState.root, identity.buildInputSet, sourceRoot);
    const compiled = await compileWindowsSandbox(runtime, sourceRoot, controlRoot);
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
  const cases = [
    {
      source: path.join(output, "bin", `tsfg-r00-cpp-smoke${executableSuffix}`),
      name: "cpp-smoke",
      stderr: "",
      stdout: target === "windows-x86_64-msvc"
        ? "tsfg-r00-cpp-smoke: ok\r\n"
        : "tsfg-r00-cpp-smoke: ok\n",
    },
    {
      source: path.join(output, "bin", `tsfg-r00-zig-smoke${executableSuffix}`),
      name: "zig-smoke",
      stderr: "tsfg-r00-zig-smoke: ok\n",
      stdout: "",
    },
  ];
  if (
    !Array.isArray(metadata.payloads) ||
    canonicalize(metadata.payloads.map(({ path: payloadPath }) => payloadPath))
      !== canonicalize(cases.map(({ source }) => path.relative(output, source).replaceAll("\\", "/")))
  ) {
    throw new TestFailureError("Build Metadata does not declare the expected smoke payloads");
  }
  const tests = [];
  try {
    for (const [index, smoke] of cases.entries()) {
      const bytes = await readRegularFile(smoke.source, `${smoke.name} executable`)
        .catch((error) => { throw new TestFailureError(error.message); });
      const executable = path.join(testRoot, ...metadata.payloads[index].path.split("/"));
      await mkdir(path.dirname(executable), { recursive: true });
      if (digest(bytes) !== metadata.payloads[index].sha256) {
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
    development: metadata.development || workspaceState.development,
    dirty: metadata.dirty || workspaceState.dirty,
    networkCanary,
    profile,
    publishable: metadata.publishable && workspaceState.publishable,
    target,
    tests,
  };
}

async function readCanonicalJson(filePath, name) {
  const bytes = await readFile(filePath, "utf8");
  if (bytes.charCodeAt(0) === 0xfeff) {
    throw new PackageFailureError(`${name} must not contain a BOM`);
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    throw new PackageFailureError(`${name} is not valid JSON: ${error.message}`);
  }
  const canonical = canonicalize(value);
  if (bytes !== canonical && bytes !== `${canonical}\n`) {
    throw new PackageFailureError(`${name} must use canonical JSON`);
  }
  return value;
}

function compareInputEntries(left, right) {
  const projectOrder = Buffer.from(left.projectId).compare(Buffer.from(right.projectId));
  return projectOrder || Buffer.from(left.path).compare(Buffer.from(right.path));
}

async function buildInputSet(workspaceRoot) {
  const declaration = await readCanonicalJson(
    path.join(workspaceRoot, "eng", "build-inputs.json"),
    "Build Input declaration",
  );
  if (declaration.schemaVersion !== "1" || !Array.isArray(declaration.entries)) {
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

async function materializeBuildInputs(workspaceRoot, buildInputSet, destination) {
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

async function createBuildIdentity(runtime, target, profile, workspaceRoot = repositoryRoot) {
  const version = await readCanonicalJson(path.join(workspaceRoot, "version.json"), "Product Version");
  if (typeof version.version !== "string" || version.version.length === 0) {
    throw new PackageFailureError("Product Version is missing");
  }
  const registry = await readCanonicalJson(
    path.join(workspaceRoot, "contracts", "registry.json"),
    "Contract Registry",
  );
  if (canonicalize(registry) !== "{}") {
    throw new PackageFailureError("R00 Contract Registry must be empty");
  }
  const { buildInputSet: inputSet, sourceDateEpoch } = await buildInputSet(workspaceRoot);
  const buildIdentityPayload = {
    buildInputSetDigest: inputSet.digest,
    options: {},
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
    contractSetId: digest(canonicalize(registry)),
    contractSet: canonicalize(registry),
    productVersion: version.version,
  };
}

function formatTarNumber(value, length) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length >= length) throw new PackageFailureError("tar number exceeds field width");
  return `${encoded}\0`;
}

function tarHeader(entry, sourceDateEpoch) {
  const header = Buffer.alloc(512);
  const name = Buffer.from(entry.path, "utf8");
  if (name.length === 0 || name.length > 100) {
    throw new PackageFailureError(`package member path is not representable in ustar: ${entry.path}`);
  }
  name.copy(header, 0);
  header.write(formatTarNumber(entry.mode, 8), 100, "ascii");
  header.write(formatTarNumber(0, 8), 108, "ascii");
  header.write(formatTarNumber(0, 8), 116, "ascii");
  header.write(formatTarNumber(entry.bytes.length, 12), 124, "ascii");
  header.write(formatTarNumber(sourceDateEpoch, 12), 136, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  header.write(formatTarNumber(0, 8), 329, "ascii");
  header.write(formatTarNumber(0, 8), 337, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return header;
}

function createTar(entries, sourceDateEpoch) {
  const sorted = [...entries].sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)));
  const chunks = [];
  for (const entry of sorted) {
    chunks.push(tarHeader(entry, sourceDateEpoch), entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function createZip(entries, sourceDateEpoch) {
  const date = new Date(Math.max(sourceDateEpoch * 1000, Date.UTC(1980, 0, 1)));
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5)
    | Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5)
    | date.getUTCDate();
  const sorted = [...entries].sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)));
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of sorted) {
    const name = Buffer.from(entry.path, "utf8");
    const checksum = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((entry.mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, entry.bytes);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function runPackageTool(executable, arguments_, cwd, environment, sandboxProtocol = false) {
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
    const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString("utf8") : "";
    const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : "";
    const detail = `${stdout}${stderr}`.trim() || error.message;
    if (sandboxProtocol) throwSandboxBoundaryFailure(detail, "package", error.status);
    throw new PackageFailureError(`llvm-objcopy failed${detail ? `: ${detail}` : ""}`);
  }
}

async function packageLinuxDebug(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const inputOption = options.get("--input");
  const outputOption = options.get("--out");
  if (!target || !profile || !inputOption || !outputOption) {
    throw new ConfigurationError("package requires --target, --profile, --input, and --out");
  }
  if (target !== "linux-x86_64-gnu" || profile !== "debug") {
    throw new ConfigurationError("R00-07 package supports only linux-x86_64-gnu debug");
  }

  const identity = await createBuildIdentity(runtime, target, profile, workspaceState.root);
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
      metadata.contractSetId !== identity.contractSetId ||
      metadata.development !== false ||
      metadata.dirty !== false ||
      metadata.productVersion !== identity.productVersion ||
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
      canonicalize(metadata.payloads.map(({ path: payloadPath }) => payloadPath))
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
          ["--library-path", runtimeLibraries, objcopy, ...toolArguments],
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
          throw new PackageFailureError(
            `package member contains host-specific data: ${member.path}`,
          );
        }
      }
    }
    const artifactManifest = {
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
    const publication = await publishDirectory(publishRoot, output);
    const result = {
      archive: archiveName,
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      checksums: `${archiveName}.checksums.json`,
      contractSetId: identity.contractSetId,
      development: false,
      dirty: false,
      input: path.resolve(inputOption),
      networkCanary,
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

async function packageWindowsDebug(options, runtime, workspaceState, networkCanary) {
  const target = options.get("--target");
  const profile = options.get("--profile");
  const inputOption = options.get("--input");
  const outputOption = options.get("--out");
  if (!target || !profile || !inputOption || !outputOption) {
    throw new ConfigurationError("package requires --target, --profile, --input, and --out");
  }
  if (target !== "windows-x86_64-msvc" || profile !== "debug") {
    throw new ConfigurationError("R00-09 Windows package supports only windows-x86_64-msvc debug");
  }
  if (process.platform !== "win32") {
    throw new ConfigurationError("windows-x86_64-msvc debug packages require a Windows host");
  }

  const identity = await createBuildIdentity(runtime, target, profile, workspaceState.root);
  const archiveName = `tsfg-v${identity.productVersion}-${target}-${profile}-${identity.buildIdentity.digest.slice(7, 23)}.zip`;
  const output = path.resolve(outputOption);
  const input = path.resolve(inputOption);
  const stagingRoot = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp`);
  const sourceRoot = path.join(stagingRoot, "source");
  const workRoot = path.join(stagingRoot, "work");
  const controlRoot = path.join(stagingRoot, "control");
  const publishRoot = path.join(stagingRoot, "publish");
  try {
    await Promise.all([workRoot, publishRoot].map((directory) => mkdir(directory, { recursive: true })));
    const metadata = await readCanonicalJson(path.join(input, "build-metadata.json"), "build metadata");
    if (
      canonicalize(metadata.buildIdentity) !== canonicalize(identity.buildIdentity) ||
      canonicalize(metadata.buildInputSet) !== canonicalize(identity.buildInputSet) ||
      metadata.contractSetId !== identity.contractSetId ||
      metadata.development !== false ||
      metadata.dirty !== false ||
      metadata.productVersion !== identity.productVersion ||
      metadata.publishable !== true ||
      metadata.toolchainClosureDigest !== runtime.lockDigest
    ) {
      throw new PackageFailureError("build metadata does not match the current Build Identity");
    }
    const expectedPayloads = ["bin/tsfg-r00-cpp-smoke.exe", "bin/tsfg-r00-zig-smoke.exe"];
    const expectedSymbols = ["symbols/tsfg-r00-cpp-smoke.pdb", "symbols/tsfg-r00-zig-smoke.pdb"];
    if (
      !Array.isArray(metadata.payloads) ||
      !Array.isArray(metadata.symbols) ||
      canonicalize(metadata.payloads.map(({ path: memberPath }) => memberPath)) !== canonicalize(expectedPayloads) ||
      canonicalize(metadata.symbols.map(({ path: memberPath }) => memberPath)) !== canonicalize(expectedSymbols)
    ) {
      throw new PackageFailureError("build metadata does not declare the expected Windows payload and symbol set");
    }
    if (runtime.platform === target) {
      await materializeBuildInputs(workspaceState.root, identity.buildInputSet, sourceRoot);
      const { executable } = await compileWindowsSandbox(runtime, sourceRoot, controlRoot);
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
    const publication = await publishDirectory(publishRoot, output);
    const result = {
      archive: archiveName,
      buildIdentity: identity.buildIdentity,
      buildInputSet: identity.buildInputSet,
      checksums: `${archiveName}.checksums.json`,
      contractSetId: identity.contractSetId,
      development: false,
      dirty: false,
      input,
      networkCanary,
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
  }
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
  let publication;
  try {
    const options = parseOptions(
      arguments_,
      new Set(["--dev", "--target", "--profile", "--workspace", "--out", "--report"]),
      new Set(["--dev"]),
    );
    validateSmokeOptions(options, "build");
    const workspaceState = inspectProductWorkspace(options, true);
    if (!runtimeClosure) throw new Error("locked runtime closure is unavailable");
    const networkCanary = options.get("--target") === "windows-x86_64-msvc"
      ? "blocked"
      : await verifyOfflineBoundary();
    const result = options.get("--target") === "windows-x86_64-msvc"
      ? await buildWindowsDebug(options, runtimeClosure, workspaceState, networkCanary)
      : await buildLinuxDebug(
      options,
      runtimeClosure,
      workspaceState,
      networkCanary,
      );
    publication = result.publication;
    process.exitCode = await succeed(command, result, reportPath, "offline");
  } catch (error) {
    if (publication) await publication.rollback();
    const isConfigurationError = error instanceof ConfigurationError;
    const isBuildFailure = error instanceof BuildFailureError;
    const isWorkspaceMismatch = error instanceof WorkspaceMismatchError;
    const isOfflineBoundary = error instanceof OfflineBoundaryError;
    const isUndeclaredInput = error instanceof UndeclaredInputError;
    const isSandboxBoundary = error instanceof SandboxBoundaryError;
    process.exitCode = await fail(
      command,
      isConfigurationError
        ? 2
        : isWorkspaceMismatch
          ? 10
          : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
            ? 12
            : isBuildFailure ? 20 : 30,
      isConfigurationError
        ? "usage/configuration"
        : isWorkspaceMismatch
          ? "workspace mismatch"
          : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
            ? "offline input missing"
          : isBuildFailure ? "build failure" : "internal control-plane failure",
      {
        code: isConfigurationError
          ? "invalid-configuration"
          : isWorkspaceMismatch
            ? error.issueCode
            : isOfflineBoundary
              ? "network-boundary"
              : isUndeclaredInput
                ? "undeclared-build-input"
                : isSandboxBoundary
                  ? "sandbox-boundary"
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
      new Set(["--dev", "--target", "--profile", "--workspace", "--out", "--report"]),
      new Set(["--dev"]),
    );
    validateSmokeOptions(options, "test");
    const workspaceState = inspectProductWorkspace(options, true);
    if (!runtimeClosure) throw new Error("locked runtime closure is unavailable");
    const networkCanary = options.get("--target") === "windows-x86_64-msvc"
      ? "blocked"
      : await verifyOfflineBoundary();
    const result = await testDebug(options, runtimeClosure, workspaceState, networkCanary);
    process.exitCode = await succeed(command, result, reportPath, "offline");
  } catch (error) {
    const isConfigurationError = error instanceof ConfigurationError;
    const isTestFailure = error instanceof TestFailureError;
    const isWorkspaceMismatch = error instanceof WorkspaceMismatchError;
    const isOfflineBoundary = error instanceof OfflineBoundaryError;
    const isUndeclaredInput = error instanceof UndeclaredInputError;
    const isSandboxBoundary = error instanceof SandboxBoundaryError;
    process.exitCode = await fail(
      command,
      isConfigurationError
        ? 2
        : isWorkspaceMismatch
          ? 10
          : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
            ? 12
            : isTestFailure ? 21 : 30,
      isConfigurationError
        ? "usage/configuration"
        : isWorkspaceMismatch
          ? "workspace mismatch"
          : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
            ? "offline input missing"
          : isTestFailure ? "test failure" : "internal control-plane failure",
      {
        code: isConfigurationError
          ? "invalid-configuration"
          : isWorkspaceMismatch
            ? error.issueCode
            : isOfflineBoundary
              ? "network-boundary"
              : isUndeclaredInput
                ? "undeclared-test-input"
                : isSandboxBoundary
                  ? "sandbox-boundary"
                  : isTestFailure ? "native-test" : "internal-control-plane",
        message: error.message,
      },
      reportPath,
      "offline",
    );
  }
} else if (command === "package") {
  let publication;
  try {
    const options = parseOptions(
      arguments_,
      new Set(["--dev", "--target", "--profile", "--workspace", "--input", "--out", "--report"]),
      new Set(["--dev"]),
    );
    validateSmokeOptions(options, "package", true);
    const workspaceState = inspectProductWorkspace(options, false);
    if (!runtimeClosure) throw new PackageFailureError("locked runtime closure is unavailable");
    const networkCanary = options.get("--target") === "windows-x86_64-msvc"
      ? "blocked"
      : await verifyOfflineBoundary();
    const result = options.get("--target") === "windows-x86_64-msvc"
      ? await packageWindowsDebug(options, runtimeClosure, workspaceState, networkCanary)
      : await packageLinuxDebug(options, runtimeClosure, workspaceState, networkCanary);
    publication = result.publication;
    process.exitCode = await succeed(command, result, reportPath, "offline");
  } catch (error) {
    if (publication) await publication.rollback();
    const isConfigurationError = error instanceof ConfigurationError;
    const isWorkspaceMismatch = error instanceof WorkspaceMismatchError;
    const isOfflineBoundary = error instanceof OfflineBoundaryError;
    const isUndeclaredInput = error instanceof UndeclaredInputError;
    const isSandboxBoundary = error instanceof SandboxBoundaryError;
    process.exitCode = await fail(
      command,
      isConfigurationError
        ? 2
        : isWorkspaceMismatch
          ? 10
          : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary) ? 12 : 22,
      isConfigurationError
        ? "usage/configuration"
        : isWorkspaceMismatch
          ? "workspace mismatch"
          : (isOfflineBoundary || isUndeclaredInput || isSandboxBoundary)
            ? "offline input missing"
            : "package failure",
      {
        code: isConfigurationError
          ? "invalid-configuration"
          : isWorkspaceMismatch
            ? error.issueCode
            : isOfflineBoundary
              ? "network-boundary"
              : isUndeclaredInput
                ? "undeclared-package-input"
                : isSandboxBoundary ? "sandbox-boundary" : "artifact-package",
        message: error.message,
      },
      reportPath,
      "offline",
    );
  }
} else if (command === "repro-check") {
  try {
    const options = parseOptions(
      arguments_,
      new Set(["--dev", "--workspace", "--report"]),
      new Set(["--dev"]),
    );
    if (!options.has("--dev")) {
      throw new ConfigurationError("repro-check is not implemented before R00-12");
    }
    inspectProductWorkspace(options, false);
  } catch (error) {
    const isWorkspaceMismatch = error instanceof WorkspaceMismatchError;
    process.exitCode = await fail(
      command,
      isWorkspaceMismatch ? 10 : 2,
      isWorkspaceMismatch ? "workspace mismatch" : "usage/configuration",
      {
        code: isWorkspaceMismatch ? error.issueCode : "invalid-configuration",
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
