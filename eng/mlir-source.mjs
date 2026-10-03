// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { sourceGitEnvironment, parseUpstreamProvenance, IntakeLedgerError } from "./intake-ledger.mjs";
import { isPermittedSourceCarrier } from "./source-admission.mjs";

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const reject = message => { throw new IntakeLedgerError("mlir-source-identity", message); };

/**
 * Read-only provenance phase. This does not authorize or execute source builds.
 * @param {{sourceRoot?: string, git?: string}} input
 */
export async function readMlirSourceIdentity({ sourceRoot, git }) {
  try {
    if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot) ||
        typeof git !== "string" || !path.isAbsolute(git)) reject("MLIR checkout and Git executable must be explicit absolute paths");
    const state = await lstat(sourceRoot);
    if (!state.isDirectory() || state.isSymbolicLink() || path.resolve(await realpath(sourceRoot)) !== path.resolve(sourceRoot))
      reject("MLIR checkout must be an ordinary directory");
    const tool = await lstat(git);
    if (!tool.isFile() || tool.isSymbolicLink()) reject("Git executable must be a regular file");
    const lockBytes = await readFile(new URL("./mlir-source.lock.json", import.meta.url));
    const lock = JSON.parse(lockBytes.toString("utf8"));
    if (Object.keys(lock).sort().join(",") !== "authorization,baseCommit,branch,canonicalUrl,carrierUrl,files,license,localChanges,projectId,schemaVersion,sourceCommit,sourceTree" ||
        lock.schemaVersion !== "1" || lock.projectId !== "llvm-project.git" ||
        !isPermittedSourceCarrier(lock.projectId, lock.carrierUrl, lock.canonicalUrl) ||
        lock.canonicalUrl !== "https://github.com/llvm/llvm-project.git" ||
        lock.license !== "Apache-2.0 WITH LLVM-exception" ||
        !/^[0-9a-f]{40}$/.test(lock.baseCommit) || !/^[0-9a-f]{40}$/.test(lock.sourceCommit) ||
        lock.branch !== "refs/heads/r03-m01-source" ||
        !/^[0-9a-f]{40}$/.test(lock.sourceTree) || typeof lock.localChanges !== "string" ||
        !Array.isArray(lock.files) || lock.files.length !== 3 ||
        lock.files.map(file => file.path).join(",") !== "UPSTREAM.toml,llvm/LICENSE.TXT,mlir/LICENSE.TXT" ||
        lock.files.some(file => Object.keys(file).sort().join(",") !== "blob,path,sha256" ||
          !/^[0-9a-f]{40}$/.test(file.blob) || !/^sha256:[0-9a-f]{64}$/.test(file.sha256))) reject("invalid MLIR provenance lock");
    const run = (...args) => {
      const child = spawnSync(git, ["-C", sourceRoot, ...args], { env: sourceGitEnvironment(),
        windowsHide: true, maxBuffer: 1024 * 1024, encoding: "buffer" });
      if (child.error || child.status !== 0) reject(`Git source inspection failed: ${args[0]}`);
      return child.stdout;
    };
    const text = (...args) => run(...args).toString("utf8").trim();
    if (path.resolve(text("rev-parse", "--show-toplevel")) !== path.resolve(sourceRoot) ||
        text("rev-parse", "HEAD") !== lock.sourceCommit ||
        text("rev-parse", "HEAD^{tree}") !== lock.sourceTree ||
        text("rev-parse", "--is-shallow-repository") !== "false" ||
        text("symbolic-ref", "HEAD") !== lock.branch ||
        text("config", "--get", "remote.origin.url") !== lock.carrierUrl ||
        text("status", "--porcelain=v1", "--untracked-files=all") !== "") reject("MLIR Git identity or clean-state mismatch");
    run("merge-base", "--is-ancestor", lock.baseCommit, lock.sourceCommit);
    if (text("diff", "--no-ext-diff", "--no-textconv", "--name-only", lock.baseCommit, lock.sourceCommit, "--") !== "UPSTREAM.toml")
      reject("MLIR provenance commit changes source or legal files");
    const inspected = [];
    for (const file of lock.files) {
      let absolute = sourceRoot;
      for (const [index, part] of file.path.split("/").entries()) {
        absolute = path.join(absolute, part);
        const entry = await lstat(absolute);
        if (entry.isSymbolicLink() || (index === file.path.split("/").length - 1 ? !entry.isFile() : !entry.isDirectory()))
          reject(`nonregular MLIR provenance file: ${file.path}`);
      }
      const raw = await readFile(absolute);
      if (text("rev-parse", `${lock.sourceCommit}:${file.path}`) !== file.blob || digest(raw) !== file.sha256 ||
          !run("cat-file", "blob", file.blob).equals(raw)) reject(`MLIR provenance bytes mismatch: ${file.path}`);
      inspected.push({ path: file.path, blob: file.blob, sha256: file.sha256 });
    }
    const bytes = await readFile(path.join(sourceRoot, "UPSTREAM.toml"));
    let upstream;
    try { upstream = parseUpstreamProvenance(bytes); }
    catch { reject("invalid UPSTREAM metadata syntax"); }
    if (Object.keys(upstream).sort().join(",") !== "base_oid,canonical_url,license,local_changes,sync_branch" ||
        upstream.base_oid !== lock.baseCommit || upstream.canonical_url !== lock.canonicalUrl ||
        upstream.license !== lock.license || upstream.sync_branch !== lock.branch ||
        upstream.local_changes !== lock.localChanges) reject("UPSTREAM metadata does not match the product lock");
    return { schemaVersion: "1", status: "metadata-verified", intakeComplete: false,
      sourceBuild: "not-run", sourceRoot, sourceCommit: lock.sourceCommit, sourceTree: lock.sourceTree,
      baseCommit: lock.baseCommit, carrierUrl: lock.carrierUrl, canonicalUrl: lock.canonicalUrl,
      branch: lock.branch, lockSha256: digest(lockBytes), metadata: upstream, inspectedFiles: inspected,
      workingTreeInspection: "Git clean; selected metadata and legal files match raw committed blobs",
      consumedFileLegalReview: "pending", wholeRepositoryRawAudit: "not-performed" };
  } catch (error) {
    if (error instanceof IntakeLedgerError) throw error;
    reject(`MLIR source provenance inspection failed: ${error.message}`);
  }
}
