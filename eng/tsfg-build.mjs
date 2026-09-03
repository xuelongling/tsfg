#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import {
  chmod,
  mkdir,
  lstat,
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
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";

class ConfigurationError extends Error {}
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
          sha256: digest(await readFile(absolutePath)),
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
  if (
    !/^https?:\/\//.test(artifact.url) ||
    !/^(0|[1-9][0-9]*)$/.test(artifact.byteSize) ||
    !digestPattern.test(artifact.archiveSha256) ||
    !digestPattern.test(artifact.unpackedTreeSha256)
  ) {
    throw new Error(`invalid lock artifact metadata for ${toolId}`);
  }
  return artifact;
}

function toolchainClosureDigest(lock, selections, platform) {
  return digest(canonicalize({
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
    if (header.every((byte) => byte === 0)) break;
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
  else if (format === "tar.gz") await extractEntries(parseTar(gunzipSync(bytes)), toolRoot, stripComponents);
  else throw new Error(`unsupported archive format: ${format}`);
}

async function downloadArtifact(toolId, artifact, toolRoot) {
  const response = await fetch(artifact.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${toolId} download failed with HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (String(bytes.length) !== artifact.byteSize) {
    throw new Error(
      `${toolId} byte size mismatch: expected ${artifact.byteSize}, got ${bytes.length}`,
    );
  }
  const actualArchiveDigest = digest(bytes);
  if (actualArchiveDigest !== artifact.archiveSha256) {
    throw new Error(
      `${toolId} archive digest mismatch: expected ${artifact.archiveSha256}, got ${actualArchiveDigest}`,
    );
  }
  if (artifact.archiveFormat === "raw") {
    const destination = checkedInstallPath(toolRoot, artifact.installPath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  } else if (["zip", "tar.gz"].includes(artifact.archiveFormat)) {
    const stripComponents = artifact.stripComponents ?? "0";
    if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
      throw new Error(`invalid stripComponents for ${toolId}`);
    }
    await mkdir(toolRoot, { recursive: true });
    try {
      await extractArchive(bytes, artifact.archiveFormat, toolRoot, Number.parseInt(stripComponents, 10));
    } catch (error) {
      throw new Error(`${toolId} archive extraction failed: ${error.message}`);
    }
    const executable = checkedInstallPath(toolRoot, artifact.installPath);
    const executableStat = await stat(executable).catch(() => undefined);
    if (!executableStat?.isFile()) {
      throw new Error(`${toolId} executable is missing after extraction`);
    }
  } else {
    throw new Error(`unsupported archive format: ${artifact.archiveFormat}`);
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
  const toolIds = Object.keys(lock.tools).sort();
  if (toolIds.join(",") !== "node,pnpm") {
    throw new Error("minimal toolchain lock must contain only node and pnpm");
  }
  const selections = toolIds.map((id) => ({
    id,
    tool: lock.tools[id],
    artifact: selectArtifact(id, lock.tools[id], platform),
  }));
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
      for (const selection of selections) {
        await downloadArtifact(
          selection.id,
          selection.artifact,
          path.join(stagingPath, selection.id),
        );
      }
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
  const toolIds = Object.keys(lock.tools).sort();
  if (toolIds.join(",") !== "node,pnpm") {
    throw new Error("minimal toolchain lock must contain only node and pnpm");
  }
  const selections = toolIds.map((id) => ({
    id,
    tool: lock.tools[id],
    artifact: selectArtifact(id, lock.tools[id], platform),
  }));
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

const arguments_ = process.argv.slice(2);
const command = arguments_[0] ?? "";
const reportPath = parseReportPath(arguments_);
let runtimeIntegrityError;
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
    await verifyRuntimeClosure(
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
