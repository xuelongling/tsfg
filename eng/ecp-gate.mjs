#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

class GateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!option?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new GateError("invalid-arguments", "options must be supplied as --name value pairs");
    }
    if (values.has(option)) throw new GateError("invalid-arguments", `duplicate option ${option}`);
    values.set(option, value);
  }
  const allowed = new Set(["--repository", "--base", "--head", "--event", "--report"]);
  for (const option of values.keys()) {
    if (!allowed.has(option)) throw new GateError("invalid-arguments", `unknown option ${option}`);
  }
  for (const option of allowed) {
    if (!values.has(option)) throw new GateError("invalid-arguments", `missing required option ${option}`);
  }
  return Object.fromEntries([...values].map(([key, value]) => [key.slice(2), value]));
}

function git(repository, ...arguments_) {
  const result = spawnSync("git", arguments_, { cwd: repository, encoding: "utf8" });
  if (result.status !== 0) {
    throw new GateError("git-failure", result.stderr.trim() || `git ${arguments_.join(" ")} failed`);
  }
  return result.stdout;
}

function gitFile(repository, revision, relativePath) {
  const result = spawnSync("git", ["show", `${revision}:${relativePath}`], {
    cwd: repository,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new GateError(
      "ecp-not-preceding",
      `ECP ${relativePath} must exist in the pull request base commit`,
    );
  }
  return result.stdout;
}

function gitFileMaybe(repository, revision, relativePath) {
  const result = spawnSync("git", ["show", `${revision}:${relativePath}`], {
    cwd: repository,
    encoding: "utf8",
  });
  if (result.status === 0) return result.stdout;
  const exists = spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], {
    cwd: repository,
    encoding: "utf8",
  });
  if (exists.status !== 0) throw new GateError("git-failure", `commit ${revision} is unavailable`);
  return null;
}

function changedPaths(repository, base, head) {
  const output = git(repository, "diff", "--name-only", "-z", `${base}...${head}`);
  return output.split("\0").filter(Boolean).sort();
}

function jsonAtRevision(repository, revision, relativePath) {
  try {
    return JSON.parse(gitFile(repository, revision, relativePath));
  } catch (error) {
    if (error instanceof GateError) throw error;
    throw new GateError("invalid-governed-data", `${relativePath} must contain valid JSON at ${revision}`);
  }
}

function majorMinor(version) {
  const match = /^(\d+)\.(\d+)(?:\.|$)/u.exec(version);
  return match ? `${match[1]}.${match[2]}` : null;
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new GateError("invalid-governed-data", "governed JSON contains an unsupported value");
}

function sortedKeys(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value).sort();
}

function classifyToolchainChange(repository, base, head, required) {
  const relativePath = "eng/toolchains.lock.json";
  const before = jsonAtRevision(repository, base, relativePath);
  const after = jsonAtRevision(repository, head, relativePath);
  const beforeTools = before?.tools;
  const afterTools = after?.tools;
  if (
    beforeTools === null || typeof beforeTools !== "object" || Array.isArray(beforeTools) ||
    afterTools === null || typeof afterTools !== "object" || Array.isArray(afterTools)
  ) {
    throw new GateError("invalid-governed-data", `${relativePath} tools must be objects`);
  }
  const toolIds = new Set([...Object.keys(beforeTools), ...Object.keys(afterTools)]);
  for (const toolId of toolIds) {
    const oldVersion = beforeTools[toolId]?.version;
    const newVersion = afterTools[toolId]?.version;
    if (oldVersion === newVersion) continue;
    if (
      typeof oldVersion !== "string" || typeof newVersion !== "string" ||
      majorMinor(oldVersion) !== majorMinor(newVersion)
    ) {
      required.add("toolchain-major-minor");
    }
  }
  const beforeTargets = sortedKeys(before?.targets);
  const afterTargets = sortedKeys(after?.targets);
  if (beforeTargets === null || afterTargets === null) {
    throw new GateError("invalid-governed-data", `${relativePath} targets must be objects`);
  }
  if (
    JSON.stringify(beforeTargets) !== JSON.stringify(afterTargets) ||
    canonicalize(before.targets) !== canonicalize(after.targets)
  ) {
    required.add("tier-1");
  }
  if (
    before.schemaVersion !== after.schemaVersion ||
    before.unpackedTreeAlgorithm !== after.unpackedTreeAlgorithm
  ) {
    required.add("build-identity");
  }
}

function classifyBuildInputChange(repository, base, head, required) {
  const relativePath = "eng/build-inputs.json";
  const before = jsonAtRevision(repository, base, relativePath);
  const after = jsonAtRevision(repository, head, relativePath);
  if (!Array.isArray(before?.entries) || !Array.isArray(after?.entries)) {
    throw new GateError("invalid-governed-data", `${relativePath} entries must be arrays`);
  }
  const beforeShape = sortedKeys(before)?.filter((key) => key !== "entries");
  const afterShape = sortedKeys(after)?.filter((key) => key !== "entries");
  if (
    before.schemaVersion !== after.schemaVersion ||
    JSON.stringify(beforeShape) !== JSON.stringify(afterShape)
  ) {
    required.add("build-input-set");
  }
}

function topLevelDirectories(repository, revision) {
  return git(repository, "ls-tree", "-d", "--name-only", revision).split(/\r?\n/u).filter(Boolean).sort();
}

function yamlTopLevelBlock(source, key) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => new RegExp(`^${key}:`, "u").test(line));
  if (start < 0) return [];
  let end = start + 1;
  while (end < lines.length && (lines[end] === "" || /^\s/u.test(lines[end]) || /^#/u.test(lines[end]))) end += 1;
  return lines.slice(start, end);
}

function workflowProjection(source, kind) {
  const patterns = kind === "runner"
    ? [/^\s*runs-on:\s*.+$/u]
    : [
      /^\s*(?:pull_request_target|workflow_run|permissions|contents|actions|checks|deployments|id-token|packages|security-events|statuses):(?:\s*.*)?$/u,
      /^\s*persist-credentials:\s*.+$/u,
      /^\s*(?:secrets|environment):(?:\s*.*)?$/u,
    ];
  const selected = source.split(/\r?\n/u).filter((line) =>
    patterns.some((pattern) => pattern.test(line.trimEnd()))
  );
  if (kind !== "runner") {
    selected.unshift(...yamlTopLevelBlock(source, "on"), ...yamlTopLevelBlock(source, "permissions"));
  }
  return selected;
}

function classifyWorkflowChange(repository, base, head, relativePath, required) {
  const before = gitFileMaybe(repository, base, relativePath) ?? "";
  const after = gitFileMaybe(repository, head, relativePath) ?? "";
  if (JSON.stringify(workflowProjection(before, "runner")) !== JSON.stringify(workflowProjection(after, "runner"))) {
    required.add("tier-1");
  }
  if (JSON.stringify(workflowProjection(before, "security")) !== JSON.stringify(workflowProjection(after, "security"))) {
    required.add("release-security");
  }
}

function markdownSection(source, number) {
  const headings = [...source.matchAll(/^## (\d+)\.[^\r\n]*$/gmu)];
  const headingIndex = headings.findIndex((match) => match[1] === String(number));
  if (headingIndex < 0) return null;
  const start = headings[headingIndex].index;
  const end = headings[headingIndex + 1]?.index ?? source.length;
  return source.slice(start, end).trim();
}

function classifyCharterChange(repository, base, head, required) {
  const relativePath = "docs/r00-engineering-charter.md";
  const before = gitFile(repository, base, relativePath);
  const after = gitFile(repository, head, relativePath);
  const governedSections = new Map([
    [3, ["repository-topology"]],
    [6, ["tier-1"]],
    [7, ["compatibility-window", "contract-schema"]],
    [8, ["build-identity", "build-input-set"]],
    [9, ["toolchain-major-minor"]],
    [13, ["release-security"]],
  ]);
  for (const [number, boundaries] of governedSections) {
    if (markdownSection(before, number) !== markdownSection(after, number)) {
      for (const boundary of boundaries) required.add(boundary);
    }
  }
}

function classify(repository, base, head, paths) {
  const required = new Set();
  if (
    JSON.stringify(topLevelDirectories(repository, base)) !==
    JSON.stringify(topLevelDirectories(repository, head))
  ) {
    required.add("repository-topology");
  }
  for (const changedPath of paths) {
    if (changedPath === ".gitmodules") required.add("repository-topology");
    if (changedPath === "contracts" || changedPath.startsWith("contracts/")) {
      required.add("contract-schema");
    }
    if (changedPath === "contracts/registry.json") required.add("compatibility-window");
    if (changedPath === "eng/toolchains.lock.json") {
      classifyToolchainChange(repository, base, head, required);
    }
    if (changedPath === "eng/build-inputs.json") {
      classifyBuildInputChange(repository, base, head, required);
    }
    if (/^\.github\/workflows\/[a-z0-9-]+\.ya?ml$/u.test(changedPath)) {
      classifyWorkflowChange(repository, base, head, changedPath, required);
    }
    if (changedPath === "docs/r00-engineering-charter.md") {
      classifyCharterChange(repository, base, head, required);
    }
    if (/^docs\/adr\/\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(changedPath)) {
      required.add("durable-decision");
    }
  }
  return [...required].sort();
}

const requiredSections = [
  "Context",
  "Goals",
  "Non-goals",
  "Affected contracts",
  "Alternatives",
  "Compatibility",
  "Migration and rollback",
  "Security and licensing",
  "Verification evidence",
  "Decision",
];
const allowedBoundaries = new Set([
  "build-identity",
  "build-input-set",
  "compatibility-window",
  "contract-schema",
  "durable-decision",
  "release-security",
  "repository-topology",
  "tier-1",
  "toolchain-major-minor",
]);

function singleField(source, name) {
  const matches = [...source.matchAll(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "gmu"))];
  if (matches.length !== 1) {
    throw new GateError("invalid-ecp", `ECP must contain exactly one ${name} field`);
  }
  return matches[0][1];
}

function parseProposal(relativePath, source, requiredBoundaries, requireAccepted = true) {
  const pathMatch = /^docs\/proposals\/(\d{4}-\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(relativePath);
  if (!pathMatch || relativePath.includes("..") || relativePath.includes("\\")) {
    throw new GateError("invalid-ecp-path", "ECP path must use docs/proposals/<year>-<sequence>-<slug>.md");
  }
  if (!/^<!-- SPDX-License-Identifier: MIT -->\r?\n\r?\n/u.test(source)) {
    throw new GateError("invalid-ecp", "ECP must begin with the canonical MIT SPDX marker");
  }
  const firstSection = source.search(/^## /mu);
  if (firstSection < 0) throw new GateError("invalid-ecp", "ECP must contain the required sections");
  const header = source.slice(0, firstSection);
  const titleMatches = [...header.matchAll(/^# ECP (\d{4}-\d{4}):\s+\S.*$/gmu)];
  if (titleMatches.length !== 1 || titleMatches[0][1] !== pathMatch[1]) {
    throw new GateError("invalid-ecp", "ECP title identifier must match its file name");
  }
  const status = singleField(header, "Status");
  if (!["accepted", "draft", "rejected", "superseded"].includes(status)) {
    throw new GateError("invalid-ecp", "ECP Status must be draft, accepted, rejected, or superseded");
  }
  if (requireAccepted && status !== "accepted") {
    throw new GateError("ecp-not-accepted", "the preceding ECP must have Status: accepted");
  }
  const owner = singleField(header, "Owner");
  if (!/^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
    throw new GateError("invalid-ecp", "ECP Owner must be a concrete GitHub login");
  }
  const affectedBoundaries = singleField(header, "Affected boundaries")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (affectedBoundaries.length === 0 || new Set(affectedBoundaries).size !== affectedBoundaries.length) {
    throw new GateError("invalid-ecp", "ECP Affected boundaries must be a unique non-empty list");
  }
  for (const boundary of affectedBoundaries) {
    if (!allowedBoundaries.has(boundary)) {
      throw new GateError("invalid-ecp", `ECP contains unknown affected boundary ${boundary}`);
    }
  }
  for (const boundary of requiredBoundaries) {
    if (!affectedBoundaries.includes(boundary)) {
      throw new GateError("ecp-boundary-mismatch", `ECP does not cover required boundary ${boundary}`);
    }
  }
  const sectionMatches = [...source.matchAll(/^## ([^\r\n]+)\r?$/gmu)];
  const sections = new Map();
  for (const [index, match] of sectionMatches.entries()) {
    if (sections.has(match[1])) throw new GateError("invalid-ecp", `duplicate ECP section ${match[1]}`);
    const start = match.index + match[0].length;
    const end = sectionMatches[index + 1]?.index ?? source.length;
    sections.set(match[1], source.slice(start, end).trim());
  }
  for (const section of requiredSections) {
    const contents = sections.get(section);
    const decisionText = contents?.replace(/<!--[\s\S]*?-->/gu, "").trim();
    if (!decisionText || (status === "accepted" && /^(?:TODO|TBD|N\/A|None)[.!]?$/iu.test(decisionText))) {
      throw new GateError("invalid-ecp", `accepted ECP section ${section} must be substantive`);
    }
  }
  return { affectedBoundaries: [...affectedBoundaries].sort(), owner, path: relativePath, status };
}

function proposalReference(eventSource) {
  let event;
  try {
    event = JSON.parse(eventSource);
  } catch {
    throw new GateError("invalid-event", "event file must contain valid JSON");
  }
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new GateError("invalid-event", "event file must contain a pull_request object");
  }
  const pullRequest = event.pull_request;
  if (pullRequest === null || typeof pullRequest !== "object" || Array.isArray(pullRequest)) {
    throw new GateError("invalid-event", "event file must contain a pull_request object");
  }
  const body = pullRequest.body ?? "";
  if (typeof body !== "string") throw new GateError("invalid-event", "pull request body must be text or null");
  const references = [...body.matchAll(/^ECP:\s*(\S+)\s*$/gmu)].map((match) => match[1]);
  if (references.length > 1) throw new GateError("invalid-ecp-reference", "pull request body has multiple ECP references");
  return references[0] ?? null;
}

async function atomicWrite(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx" });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  let options;
  let changed = [];
  let proposalChanges = [];
  let requiredBoundaries = [];
  try {
    options = parseArguments(process.argv.slice(2));
    if (!/^[0-9a-f]{40}$/.test(options.base) || !/^[0-9a-f]{40}$/.test(options.head)) {
      throw new GateError("invalid-revision", "base and head must be complete lowercase commit OIDs");
    }
    const eventSource = await readFile(options.event, "utf8");
    changed = changedPaths(options.repository, options.base, options.head);
    requiredBoundaries = classify(options.repository, options.base, options.head, changed);
    proposalChanges = changed.filter((relativePath) =>
      /^docs\/proposals\/(?!template\.md$|README\.md$).+\.md$/u.test(relativePath)
    );
    for (const relativePath of proposalChanges) {
      const source = gitFileMaybe(options.repository, options.head, relativePath);
      if (source === null) {
        throw new GateError("proposal-history", `ECP ${relativePath} must not be deleted`);
      }
      parseProposal(relativePath, source, [], false);
    }
    const reference = proposalReference(eventSource);
    let proposal = null;
    const issues = [];
    if (requiredBoundaries.length > 0 && reference === null) {
      issues.push({
        code: "ecp-reference-required",
        message: "this change crosses an engineering boundary and requires a preceding accepted ECP",
      });
    } else if (requiredBoundaries.length > 0) {
      proposal = parseProposal(
        reference,
        gitFile(options.repository, options.base, reference),
        requiredBoundaries,
      );
    }
    const report = {
      base: options.base,
      changedPaths: changed,
      head: options.head,
      issues,
      proposal,
      proposalChanges,
      requiredBoundaries,
      schemaVersion: "1",
      status: issues.length === 0 ? "passed" : "blocked",
    };
    await atomicWrite(options.report, report);
    if (issues.length > 0) {
      process.stderr.write(`${issues[0].message}\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    const issue = {
      code: error instanceof GateError ? error.code : "internal-error",
      message: error instanceof Error ? error.message : String(error),
    };
    if (options?.report) {
      await atomicWrite(options.report, {
        ...(options.base ? { base: options.base } : {}),
        changedPaths: changed,
        ...(options.head ? { head: options.head } : {}),
        issues: [issue],
        proposalChanges,
        requiredBoundaries,
        schemaVersion: "1",
        status: "blocked",
      });
    }
    process.stderr.write(`${issue.message}\n`);
    process.exitCode = 1;
  }
}

await main();
