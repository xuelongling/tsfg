// SPDX-License-Identifier: MIT
import path from "node:path";
import { TextDecoder } from "node:util";
import { digest } from "./build-data.mjs";
import { WorkspaceMismatchError } from "./build-errors.mjs";
import { committedBlob } from "./build-git.mjs";
import { committedEntryMap, licenseMapping, parseCommittedCanonicalJson } from "./build-source-policy.mjs";

function agentStatePathIssue(relativePath) {
  const lower = relativePath.toLowerCase();
  const segments = lower.split("/");
  const basename = segments.at(-1) ?? "";
  if (
    /^(?:auth|credentials|oauth(?:[-_.]?(?:session|tokens?))?|session|tokens?)(?:[-_.].*)?\.(?:db|json|jsonl|sqlite|sqlite3)$/.test(
      basename,
    ) ||
    segments.includes("node_modules") ||
    segments.some((segment) =>
      [".cache", ".mypy_cache", ".pytest_cache", ".ruff_cache", "__pycache__", "cache", "caches", "logs"].includes(segment),
    ) ||
    /\.(?:db|log|sqlite|sqlite3|wal)$/.test(lower) ||
    basename === ".codex-global-state.json" ||
    /^(?:events|history|sessions)(?:[-_.].*)?\.jsonl$/.test(basename)
  ) {
    return "agent-personal-state";
  }
  return undefined;
}

function agentSecretContent(content) {
  const knownToken = /sk-[A-Za-z0-9_-]{16,}|gh[oprsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/;
  const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  const credential = /(?:^|[,{;\r\n])\s*["']?(?:[A-Za-z0-9]+[_. -]+)*(?:client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|api[_ -]?key|oauth[_ -]?(?:session|token)|token|authorization|password|passwd|session[_ -]?cookie)["']?\s*[:=]\s*(?:"(?!<|\$\{|%)[^"\r\n]+"|'(?!<|\$\{|%)[^'\r\n]+'|(?!["'<$%])[^\s#;,]+)/im;
  const windowsAbsolute = /(?:^|[^A-Za-z0-9_])(?:[A-Za-z]:[\\/]|\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9$._-]+\\)/im;
  const posixHome = /\/(?:home|Users)\/[^/\s"']+|\/root(?:\/|\b)/;
  return knownToken.test(content) || privateKey.test(content) || credential.test(content) ||
    windowsAbsolute.test(content) || posixHome.test(content);
}

export function verifyAgentPrivateState(repository, entries, definition) {
  if (repository.id !== ".agents.git") return;
  for (const entry of entries) {
    const relativePath = entry.pathBytes.toString("ascii");
    const stateIssue = agentStatePathIssue(relativePath);
    if (stateIssue) {
      throw new WorkspaceMismatchError(
        stateIssue,
        `${repository.workspacePath}/${relativePath} is credential, cache, log, or personal agent state`,
      );
    }
    if (licenseMapping(relativePath, definition)?.contentKind === "binary") continue;
    const content = new TextDecoder("utf-8", { fatal: true }).decode(
      committedBlob(repository.root, entry.oid),
    );
    if (agentSecretContent(content)) {
      throw new WorkspaceMismatchError(
        "agent-secret",
        `${repository.workspacePath}/${relativePath} contains a credential or personal absolute path`,
      );
    }
  }
}

function generatedProjectRoot(relativePath) {
  const segments = relativePath.split("/");
  const index = segments.findIndex((segment) =>
    ["build", "dist", "generated", "out"].includes(segment),
  );
  if (index < 0 || index === segments.length - 1) return undefined;
  return segments.slice(0, index).join("/");
}

function joinedRepositoryPath(prefix, relativePath) {
  const joined = path.posix.normalize(prefix ? `${prefix}/${relativePath}` : relativePath);
  if (joined === ".." || joined.startsWith("../") || path.posix.isAbsolute(joined)) return undefined;
  return joined;
}

export function verifyGeneratedProvenance(repository, entries, definition) {
  const entryMap = committedEntryMap(repository, entries);
  const generated = new Map();
  for (const relativePath of entryMap.keys()) {
    if (relativePath.split("/").includes("out")) {
      throw new WorkspaceMismatchError(
        "repository-local-output",
        `${repository.workspacePath}/${relativePath} is repository-local output and must remain untracked`,
      );
    }
    const projectRoot = generatedProjectRoot(relativePath);
    if (projectRoot === undefined) continue;
    const outputs = generated.get(projectRoot) ?? [];
    outputs.push(relativePath);
    generated.set(projectRoot, outputs);
  }
  for (const [projectRoot, outputs] of generated) {
    const provenancePath = projectRoot
      ? `${projectRoot}/artifact-provenance.json`
      : "artifact-provenance.json";
    const issueCode =
      repository.id === ".agents.git" && projectRoot.startsWith("mcp/")
        ? "agent-dist-only-mcp"
        : "generated-provenance";
    const provenanceEntry = entryMap.get(provenancePath);
    if (!provenanceEntry) {
      throw new WorkspaceMismatchError(
        issueCode,
        `${repository.workspacePath}/${outputs[0]} is an unexplained generated output`,
      );
    }
    const provenance = parseCommittedCanonicalJson(
      repository,
      entryMap,
      provenancePath,
      issueCode,
    );
    if (provenance.schema_version !== "1" || !Array.isArray(provenance.artifacts)) {
      throw new WorkspaceMismatchError(issueCode, `${provenancePath} has invalid provenance`);
    }
    const declared = new Set();
    for (const artifact of provenance.artifacts) {
      const outputPath = joinedRepositoryPath(projectRoot, artifact?.path);
      const output = outputPath ? entryMap.get(outputPath) : undefined;
      if (
        !output ||
        !/^sha256:[0-9a-f]{64}$/.test(artifact.digest) ||
        digest(output.bytes) !== artifact.digest ||
        !Array.isArray(artifact.sources) ||
        artifact.sources.length === 0 ||
        !Array.isArray(artifact.locks) ||
        artifact.locks.length === 0
      ) {
        throw new WorkspaceMismatchError(issueCode, `${provenancePath} does not explain its output`);
      }
      let hasMaintainedMcpSource = false;
      for (const [kind, inputs] of [
        ["source", artifact.sources],
        ["lock", artifact.locks],
      ]) {
        for (const input of inputs) {
          const inputPath = joinedRepositoryPath(projectRoot, input?.path);
          const inputEntry = inputPath ? entryMap.get(inputPath) : undefined;
          const generatedInput = inputPath ? generatedProjectRoot(inputPath) : undefined;
          const authoritativeLock =
            kind !== "lock" ||
            /(?:^|\/)(?:[^/]+\.lock|[^/]+-lock\.(?:json|ya?ml)|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(
              inputPath ?? "",
            );
          if (
            !inputEntry ||
            inputPath === outputPath ||
            generatedInput !== undefined ||
            !authoritativeLock ||
            !/^sha256:[0-9a-f]{64}$/.test(input.digest) ||
            digest(inputEntry.bytes) !== input.digest
          ) {
            throw new WorkspaceMismatchError(
              issueCode,
              `${provenancePath} has an unknown source or lock`,
            );
          }
          if (
            kind === "source" &&
            inputPath.startsWith(`${projectRoot}/${definition.agentMcpSourceDirectory}/`) &&
            definition.agentMcpSourceExtensions.includes(path.posix.extname(inputPath))
          ) {
            hasMaintainedMcpSource = true;
          }
        }
      }
      if (issueCode === "agent-dist-only-mcp" && !hasMaintainedMcpSource) {
        throw new WorkspaceMismatchError(
          issueCode,
          `${provenancePath} has no maintained MCP source under ${definition.agentMcpSourceDirectory}/`,
        );
      }
      declared.add(outputPath);
    }
    const unexplained = outputs.find((output) => !declared.has(output));
    if (unexplained) {
      throw new WorkspaceMismatchError(
        issueCode,
        `${repository.workspacePath}/${unexplained} is not declared by ${provenancePath}`,
      );
    }
  }
}
