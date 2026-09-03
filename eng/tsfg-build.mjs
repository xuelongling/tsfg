#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import {
  mkdir,
  lstat,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";

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
    await rename(temporaryPath, absolutePath);
  } finally {
    await rm(temporaryPath, { force: true });
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
      return 2;
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
  } else if (["zip", "tar.gz", "tar.xz"].includes(artifact.archiveFormat)) {
    const archivePath = `${toolRoot}.${toolId}.archive`;
    const stripComponents = artifact.stripComponents ?? "0";
    if (!/^(0|[1-9][0-9]*)$/.test(stripComponents)) {
      throw new Error(`invalid stripComponents for ${toolId}`);
    }
    await mkdir(toolRoot, { recursive: true });
    await writeFile(archivePath, bytes, { flag: "wx" });
    try {
      const tarArguments = ["-xf", archivePath, "-C", toolRoot];
      if (stripComponents !== "0") {
        tarArguments.push("--strip-components", stripComponents);
      }
      execFileSync("tar", tarArguments, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const detail = Buffer.isBuffer(error.stderr)
        ? error.stderr.toString("utf8").trim()
        : error.message;
      throw new Error(`${toolId} archive extraction failed: ${detail}`);
    } finally {
      await rm(archivePath, { force: true });
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
  const lockDigest = digest(canonicalize(lock));
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
      await rename(stagingPath, finalPath);
    } finally {
      await rm(stagingPath, { recursive: true, force: true });
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

/**
 * @param {string} cwd
 * @param {string[]} arguments_
 * @param {BufferEncoding | "buffer"} encoding
 * @returns {any}
 */
function gitOutput(cwd, arguments_, encoding = "utf8") {
  try {
    const bytes = execFileSync(process.env.TSFG_GIT ?? "git", arguments_, {
      cwd,
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

if (command === "prefetch") {
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
