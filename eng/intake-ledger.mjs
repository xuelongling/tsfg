// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { validateSourceAdmission } from "./source-admission.mjs";

export class IntakeLedgerError extends Error {
  constructor(issueCode, message) {
    super(`intake ledger: ${message}`);
    this.name = "IntakeLedgerError";
    this.issueCode = issueCode;
  }
}

// Shared source-inspection environment; never inherit arbitrary host variables.
export function sourceGitEnvironment() {
  /** @type {NodeJS.ProcessEnv} */
  const environment = {};
  for (const requested of ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "HOME", "USERPROFILE",
    "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]) {
    const actual = Object.keys(process.env).find(name => name.toLowerCase() === requested.toLowerCase());
    if (actual && process.env[actual] !== undefined) environment[requested] = process.env[actual];
  }
  return Object.assign(environment, { GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" });
}

const fail = (message, code = "intake-ledger") => { throw new IntakeLedgerError(code, message); };
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const shape = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === keys.split(",").sort().join(",");
const note = (value) => typeof value === "string" && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
const safePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 4096 &&
  !/[^\x20-\x7e]|[<>:"\\|?*]/.test(value) && value.split("/").every(part => part.length > 0 &&
    part.length <= 255 && ![".", "..", ".git"].includes(part.toLowerCase()) && !/[. ]$/.test(part) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const roles = new Set(["build-only", "compiler-payload", "game-runtime"]);
const consumptionKey = (entry) => JSON.stringify([entry.projectId, entry.path, entry.role, entry.consumer]);

async function regularPath(root, relative, directory = false) {
  if (!safePath(relative)) fail(`unsafe source path: ${relative}`, "intake-ledger-path");
  let current = root;
  const pieces = relative.split("/");
  for (const [index, part] of pieces.entries()) {
    current = path.join(current, part);
    const state = await lstat(current);
    if (state.isSymbolicLink() || ((directory || index !== pieces.length - 1)
      ? !state.isDirectory() : !state.isFile())) fail(`nonregular source path: ${relative}`, "intake-ledger-path");
  }
  return current;
}

export function parseUpstreamProvenance(bytes) {
  const result = {};
  for (const raw of new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([a-z_]+)\s*=\s*"([^"\r\n]+)"$/.exec(line);
    if (!match || Object.hasOwn(result, match[1])) fail("invalid UPSTREAM.toml provenance", "intake-ledger-identity");
    result[match[1]] = match[2];
  }
  return result;
}

function treeEntries(bytes) {
  const entries = new Map();
  for (const line of bytes.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(line);
    if (!match || entries.has(match[4])) fail("invalid committed source tree", "intake-ledger-identity");
    entries.set(match[4], { mode: match[1], type: match[2], oid: match[3] });
  }
  return entries;
}

/** Schema 1 receipts describe declarations, never actual execution evidence. */
export function requireRealIntakeEvidence(_report) {
  fail("declared governance receipts cannot prove real intake; runtime consumption evidence is not implemented",
    "intake-ledger-execution-evidence");
}

export async function createIntakeLedger({ workspaceRoot, admission, declaration, consumption,
  gitExecutable, approvedLicenses }) {
  try {
    return await createLedger({ workspaceRoot, admission, declaration, consumption, gitExecutable, approvedLicenses });
  } catch (error) {
    if (error instanceof IntakeLedgerError) throw error;
    throw new IntakeLedgerError("intake-ledger", error.message);
  }
}

async function createLedger({ workspaceRoot, admission, declaration, consumption, gitExecutable, approvedLicenses }) {
  if (!path.isAbsolute(workspaceRoot) || !path.isAbsolute(gitExecutable)) fail("workspace and Git paths must be absolute");
  if (!Array.isArray(approvedLicenses) || approvedLicenses.some(value => !note(value))) fail("invalid approved licenses");
  try { validateSourceAdmission(admission, { approvedLicenseExpressions: approvedLicenses }); }
  catch (error) { fail(error.message, "intake-ledger-license"); }
  if (!shape(declaration, "schemaVersion,evidenceKind,sources,attributions") || declaration.schemaVersion !== "1" ||
      !["real-source", "fixture"].includes(declaration.evidenceKind) || !Array.isArray(declaration.sources) ||
      !Array.isArray(declaration.attributions)) fail("invalid declaration schema");
  if (!shape(consumption, "schemaVersion,evidenceKind,entries") || consumption.schemaVersion !== "1" ||
      consumption.evidenceKind !== declaration.evidenceKind || !Array.isArray(consumption.entries)) fail("invalid consumption schema", "intake-ledger-consumption");
  const rootState = await lstat(workspaceRoot);
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) fail("workspace must be an ordinary directory", "intake-ledger-path");
  const approvals = new Map(admission.sources.map(source => [source.projectId, source]));
  if (declaration.sources.length !== approvals.size ||
      new Set(declaration.sources.map(source => source?.projectId)).size !== approvals.size) fail("declaration must cover each admitted source exactly once");
  const expectedConsumption = new Set();
  const selectedFiles = new Set();
  for (const source of declaration.sources) {
    const approved = approvals.get(source?.projectId);
    if (!shape(source, "projectId,forkOid,baseOid,entries,excludedReason") || !approved ||
        source.forkOid !== approved.forkOid || source.baseOid !== approved.baseOid || !Array.isArray(source.entries) ||
        typeof source.excludedReason !== "string" ||
        (source.excludedReason !== "" && !note(source.excludedReason)) || (!source.entries.length && !note(source.excludedReason))) {
      fail("unknown, duplicate, or mismatched declared source identity", "intake-ledger-identity");
    }
    for (const entry of source.entries) {
      if (!shape(entry, "path,role,consumer,affectsPayload,localModification,licenseException") || !safePath(entry.path) ||
          !roles.has(entry.role) || !note(entry.consumer) || typeof entry.affectsPayload !== "boolean" ||
          !(entry.localModification === null || note(entry.localModification)) || entry.licenseException !== null) fail("invalid consumed-file declaration or unapproved license exception");
      if ((/typescript/i.test(approved.projectId) || approved.projectId.toLowerCase() === "llvm-project.git") &&
          entry.role === "game-runtime") fail(`Compiler source ${approved.projectId} cannot be game-runtime`, "intake-ledger-role");
      if (entry.role !== "build-only" && !entry.affectsPayload) fail("payload and runtime roles must affect payload", "intake-ledger-role");
      const fileKey = `${source.projectId}/${entry.path.toLowerCase()}`;
      if (selectedFiles.has(fileKey)) fail("duplicate declared file");
      selectedFiles.add(fileKey);
      expectedConsumption.add(consumptionKey({ projectId: source.projectId, ...entry }));
    }
  }
  const actualConsumption = new Set();
  for (const entry of consumption.entries) {
    if (!shape(entry, "projectId,path,role,consumer") || !safePath(entry.path) || !roles.has(entry.role) || !note(entry.consumer)) fail("invalid consumption entry", "intake-ledger-consumption");
    const key = consumptionKey(entry);
    if (actualConsumption.has(key) || !expectedConsumption.has(key)) fail("extra or duplicate consumption entry", "intake-ledger-consumption");
    actualConsumption.add(key);
  }
  if (actualConsumption.size !== expectedConsumption.size) fail("missing consumption entry", "intake-ledger-consumption");

  const gitEnvironment = sourceGitEnvironment();
  const git = (root, args) => {
    const result = spawnSync(gitExecutable, ["--no-replace-objects", "-c", "core.longpaths=true", "-C", root, ...args], {
      env: gitEnvironment,
      encoding: "buffer", maxBuffer: 128 * 1024 * 1024, timeout: 120000, windowsHide: true,
    });
    if (result.error || result.status !== 0) fail(`Git ${args[0]} failed: ${result.error?.message ?? result.stderr.toString("utf8").trim()}`, "intake-ledger-identity");
    return result.stdout;
  };
  const projects = [];
  const files = [];
  const inputMap = new Map();
  const verifiedPaths = new Map();
  for (const source of declaration.sources) {
    const approved = approvals.get(source.projectId);
    const root = await regularPath(workspaceRoot, approved.path, true);
    const remoteName = git(root, ["remote"]).toString("utf8").trim().split(/\r?\n/).includes("origin") ? "origin" : "github-xuelongling";
    if (await realpath(git(root, ["rev-parse", "--show-toplevel"]).toString("utf8").trim()) !== await realpath(root) ||
        git(root, ["rev-parse", "HEAD"]).toString("utf8").trim() !== approved.forkOid ||
        git(root, ["remote", "get-url", remoteName]).toString("utf8").trim() !== approved.remoteUrl) fail("source checkout identity differs", "intake-ledger-identity");
    git(root, ["cat-file", "-e", `${approved.baseOid}^{commit}`]);
    git(root, ["merge-base", "--is-ancestor", approved.baseOid, approved.forkOid]);
    const tree = treeEntries(git(root, ["ls-tree", "-r", "-z", "--full-tree", approved.forkOid]));
    const base = treeEntries(git(root, ["ls-tree", "-r", "-z", "--full-tree", approved.baseOid]));
    const mappings = new Map(approved.files.map(file => [file.path, file]));
    if (tree.size !== mappings.size || [...tree.keys()].some(name => !mappings.has(name))) fail("admission committed-file set differs", "intake-ledger-identity");
    const cache = new Map();
    const inspect = async (name) => {
      if (cache.has(name)) return cache.get(name);
      const mapping = mappings.get(name), committed = tree.get(name);
      if (!mapping || !committed || !["100644", "100755"].includes(committed.mode) || committed.type !== "blob" || mapping.contentKind === "gitlink") fail(`unapproved or nonregular consumed file: ${name}`, "intake-ledger-path");
      const location = await regularPath(root, name);
      const bytes = git(root, ["cat-file", "blob", committed.oid]);
      if (hash(bytes) !== mapping.sha256 || !(await readFile(location)).equals(bytes)) fail(`source file identity differs: ${name}`, "intake-ledger-identity");
      if (mapping.contentKind === "text") new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const original = base.get(name);
      const baseBytes = original?.type === "blob" ? git(root, ["cat-file", "blob", original.oid]) : null;
      const data = { bytes, sha256: hash(bytes), blobOid: committed.oid,
        baseBlobOid: original?.oid ?? null, changed: baseBytes === null || !baseBytes.equals(bytes) };
      cache.set(name, data);
      return data;
    };
    const legal = {};
    for (const role of ["license", "notice", "copyright"]) {
      const name = approved.legal[role];
      const material = await inspect(name);
      if (!material.bytes.toString("utf8").trim() || material.changed) fail(`original legal ${role} bytes not preserved`, "intake-ledger-license");
      legal[role] = { path: name, sha256: material.sha256, blobOid: material.blobOid };
    }
    const upstream = await inspect("UPSTREAM.toml");
    const origin = parseUpstreamProvenance(upstream.bytes);
    if (!shape(origin, "base_oid,canonical_url,license,local_changes,sync_branch") || origin.base_oid !== approved.baseOid ||
        origin.canonical_url !== approved.canonicalUrl || origin.license !== approved.license || origin.sync_branch !== approved.branch ||
        !note(origin.local_changes)) fail("UPSTREAM.toml does not match admitted provenance", "intake-ledger-identity");
    const project = { projectId: source.projectId, path: approved.path, baseOid: approved.baseOid,
      forkOid: approved.forkOid, remoteUrl: approved.remoteUrl, canonicalUrl: approved.canonicalUrl,
      license: approved.license, legal, provenance: origin, excludedReason: source.excludedReason };
    projects.push(project);
    for (const entry of source.entries) {
      const material = await inspect(entry.path);
      if (material.changed && !note(entry.localModification)) fail(`changed file requires local modification explanation: ${entry.path}`);
      files.push({ projectId: source.projectId, sourcePath: approved.path, baseOid: approved.baseOid,
        forkOid: approved.forkOid, ...entry, sha256: material.sha256, blobOid: material.blobOid,
        baseBlobOid: material.baseBlobOid, changedFromBase: material.changed, license: approved.license, legal,
        verification: { committedIdentity: "passed", workingBytes: "passed", legalPreservation: "passed", consumption: "declared" } });
    }
    verifiedPaths.set(source.projectId, { inspect, cache, project });
  }
  const attributionKeys = new Set();
  for (const attribution of declaration.attributions) {
    if (!shape(attribution, "projectId,path,reason") || !safePath(attribution.path) || !note(attribution.reason) ||
        !verifiedPaths.has(attribution.projectId)) fail("invalid attribution");
    const key = `${attribution.projectId}/${attribution.path.toLowerCase()}`;
    if (attributionKeys.has(key) || selectedFiles.has(key)) fail("attribution must name a distinct, nonconsumed file");
    attributionKeys.add(key);
    await verifiedPaths.get(attribution.projectId).inspect(attribution.path);
  }
  for (const [projectId, { cache, project }] of verifiedPaths) {
    for (const [name, material] of cache) {
      inputMap.set(`${projectId}/${name}`, { projectId, projectOid: project.forkOid,
        path: `${project.path}/${name}`, sha256: material.sha256, blobOid: material.blobOid });
    }
  }
  return { schemaVersion: "1", status: "declared", evidenceKind: declaration.evidenceKind,
    sources: projects, files,
    derivationStatus: "declared-candidates",
    buildInputEntries: files.filter(file => file.affectsPayload).map(file => ({
      projectId: file.projectId, projectOid: file.forkOid, path: `${file.sourcePath}/${file.path}`,
      sha256: file.sha256, blobOid: file.blobOid, role: file.role, consumer: file.consumer, affectsPayload: true,
    })).sort((a, b) => a.path.localeCompare(b.path)),
    auditInputEntries: [...inputMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
    attributions: declaration.attributions.map(entry => ({ ...entry })),
    executionConsumption: { status: "not-run" }, intakeComplete: false };
}
