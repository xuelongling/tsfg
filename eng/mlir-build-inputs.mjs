// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { sourceGitEnvironment } from "./intake-ledger.mjs";
import { mlirCommittedSourceBytes } from "./mlir-source-legal.mjs";
import { inspectMlirSdkProvenance, verifyMlirSdkNoticeRecord } from "./mlir-sdk.mjs";
const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
export class MlirBuildError extends Error {
  constructor(message, issueCode = "mlir-source-build") { super(message); this.issueCode = issueCode; }
}
export function gitBytes(git, root, args) {
  const child = spawnSync(git, ["-C", root, ...args], { env: sourceGitEnvironment(), encoding: "buffer",
    windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (child.error || child.status !== 0) throw new MlirBuildError(`Git source inspection failed: ${args[0]}`);
  return child.stdout;
}

async function ordinaryAncestor(directory) {
  let current = directory;
  for (;;) {
    const state = await lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (state) {
      if (!state.isDirectory() || state.isSymbolicLink() || path.relative(current, await realpath(current)) !== "")
        throw new MlirBuildError("Selected source root/destination ancestor is redirected", "mlir-source-integrity");
      return;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new MlirBuildError("Selected source destination has no ordinary ancestor", "mlir-source-integrity");
    current = parent;
  }
}

/** Registered staged source bodies require an ordinary physical path before
 * opening, even when redirected bytes would happen to have the expected hash.
 * Inspect every component so an intermediate junction cannot escape or alias
 * the admitted source root. Unknown identities are rejected by the caller first.
 */
export async function readMlirPhysicalSource(source, absolute, entry) {
  const relative = path.relative(source, absolute).replaceAll("\\", "/");
  if (!within(source, absolute) || relative.toLowerCase() !== entry?.repositoryRelativePath?.toLowerCase() ||
      !/^sha256:[0-9a-f]{64}$/.test(entry?.sha256 ?? ""))
    throw new MlirBuildError(`Missing or mismatched physical source identity: ${relative}`, "mlir-source-integrity");
  try {
    await ordinaryAncestor(source);
    let current = source;
    const parts = relative.split("/");
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const state = await lstat(current);
      if (state.isSymbolicLink() || (index === parts.length - 1 ? !state.isFile() : !state.isDirectory()))
        throw new MlirBuildError(`Nonregular or redirected source dependency: ${relative}`, "mlir-source-integrity");
      const actual = await realpath(current);
      if (path.relative(current, actual) !== "" || !within(source, actual))
        throw new MlirBuildError(`Nonregular or redirected source dependency: ${relative}`, "mlir-source-integrity");
    }
    const bytes = await readFile(absolute);
    if (digest(bytes) !== entry.sha256)
      throw new MlirBuildError(`Changed physical source dependency: ${relative}`, "mlir-source-integrity");
    return bytes;
  } catch (error) {
    if (error instanceof MlirBuildError) throw error;
    throw new MlirBuildError(`Cannot inspect physical source dependency ${relative}: ${error.message}`, "mlir-source-integrity");
  }
}

export async function materializeSource(identity, git, destination, selection = null) {
  const rawTree = gitBytes(git, identity.sourceRoot,
    ["ls-tree", "-r", "-z", identity.sourceCommit, "--", "llvm", "mlir", "cmake", "third-party", "UPSTREAM.toml"]);
  const tree = rawTree.toString("utf8").split("\0").filter(Boolean).map(line => {
    const match = /^(100644|100755|120000) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match) throw new MlirBuildError("Source materialization contains an unsupported Git entry", "mlir-source-integrity");
    return { mode: match[1], blob: match[2], name: match[3] };
  });
  /** @type {Array<{mode:string,blob:string,name:string,sha256?:string}>} */
  let selected = tree;
  if (selection) {
    if (selection.sourceCommit !== identity.sourceCommit || selection.sourceTree !== identity.sourceTree ||
        !Array.isArray(selection.entries) || !selection.entries.length)
      throw new MlirBuildError("Source selection has another or missing immutable identity", "mlir-source-integrity");
    const byName = new Map(tree.map(entry => [entry.name, entry]));
    const seen = new Set();
    selected = selection.entries.map(entry => {
      const name = entry.repositoryRelativePath;
      if (typeof name !== "string" || !/^(?:llvm|mlir|cmake|third-party)\/.+|^UPSTREAM\.toml$/.test(name) ||
          name.split("/").some(part => !part || part === "." || part === ".." || /[\\:\x00-\x1f]|[. ]$/.test(part)) ||
          seen.has(name.toLowerCase()) || !/^sha256:[0-9a-f]{64}$/.test(entry.sha256 ?? ""))
        throw new MlirBuildError(`Invalid or duplicate qualified source path: ${name}`, "mlir-source-integrity");
      seen.add(name.toLowerCase());
      const tracked = byName.get(name);
      if (!tracked || tracked.mode === "120000" || tracked.blob !== entry.blob ||
          (entry.normalizedMode && tracked.mode !== entry.normalizedMode))
        throw new MlirBuildError(`Qualified source is absent or differs from the immutable tree: ${name}`, "mlir-source-integrity");
      return { ...tracked, sha256: entry.sha256 };
    });
    if (!path.isAbsolute(destination) || within(identity.sourceRoot, destination) || within(destination, identity.sourceRoot))
      throw new MlirBuildError("Selected source requires an independent destination", "mlir-source-integrity");
    await ordinaryAncestor(identity.sourceRoot);
    await ordinaryAncestor(destination);
  }
  const entries = [];
  const unmaterialized = [];
  const checkoutDifferences = [];
  for (const entry of selected) {
    if (entry.mode === "120000") {
      unmaterialized.push({ path: entry.name, mode: "120000", blob: entry.blob, reason: "nonregular input is never materialized or admitted for consumption" });
      continue;
    }
    const name = entry.name;
    const original = path.join(identity.sourceRoot, name);
    if (selection) {
      let parent = identity.sourceRoot;
      for (const part of name.split("/").slice(0, -1)) {
        parent = path.join(parent, part);
        const state = await lstat(parent);
        if (!state.isDirectory() || state.isSymbolicLink() || path.relative(parent, await realpath(parent)) !== "")
          throw new MlirBuildError(`Redirected selected source parent: ${name}`, "mlir-source-integrity");
      }
    }
    const state = await lstat(original);
    if (!state.isFile() || state.isSymbolicLink() || !within(identity.sourceRoot, await realpath(original)))
      throw new MlirBuildError(`Nonregular source input: ${name}`, "mlir-source-integrity");
    const checkout = await readFile(original);
    let bytes;
    try { bytes = mlirCommittedSourceBytes(checkout, entry.blob, name); }
    catch (error) { throw new MlirBuildError(error.message, "mlir-source-integrity"); }
    if (selection && digest(bytes) !== entry.sha256)
      throw new MlirBuildError(`Qualified source raw SHA mismatch: ${name}`, "mlir-source-integrity");
    if (!bytes.equals(checkout)) checkoutDifferences.push({ path: name, observedCheckoutSha256: digest(checkout),
      committedBlob: entry.blob, consumedRawSha256: digest(bytes), method: "only CRLF-to-LF; exact immutable Git object equality proven" });
    const target = path.join(destination, name);
    if (selection) await ordinaryAncestor(path.dirname(target));
    await mkdir(path.dirname(target), { recursive: true });
    if (selection) await ordinaryAncestor(path.dirname(target));
    await writeFile(target, bytes, { flag: "wx" });
    entries.push({ projectId: "llvm-project.git", repositoryRelativePath: name,
      normalizedMode: entry.mode, sha256: digest(bytes), blob: entry.blob });
  }
  return { entries, unmaterialized, checkoutDifferences };
}

export async function retainedNoticeBundle({ source, sourceEntries, productRoot, identity, legal, sdk = null, serialize }) {
  const lock = JSON.parse(await readFile(path.join(productRoot, "eng/mlir-source-notices.lock.json"), "utf8"));
  if (lock.schemaVersion !== "1" || lock.baseCommit !== identity.baseCommit || lock.sourceCommit !== identity.sourceCommit)
    throw new MlirBuildError("Original notice retention mapping has another source identity", "mlir-source-license");
  if (sdk) {
    const proof = inspectMlirSdkProvenance(sdk, productRoot);
    verifyMlirSdkNoticeRecord(lock, proof.sourceNotices, identity, serialize, legal.approvalLockSha256);
    return { inputs: [], bundle: { schemaVersion: "1", baseCommit: identity.baseCommit, sourceCommit: identity.sourceCommit,
      role: "compiler-side-M01", approvalLockSha256: legal.approvalLockSha256, purpose: lock.purpose, files: lock.files } };
  }
  const entries = new Map(sourceEntries.map(entry => [entry.repositoryRelativePath, entry]));
  const inputs = [];
  for (const file of lock.files) {
    const entry = entries.get(file.path);
    if (!entry || entry.blob !== file.blob || entry.sha256 !== file.sha256)
      throw new MlirBuildError(`Original notice input differs from committed source: ${file.path}`, "mlir-source-license");
    const bytes = await readFile(path.join(source, file.path));
    const notice = bytes.subarray(file.noticeStart, file.noticeEnd);
    if (digest(bytes) !== file.sha256 || digest(notice) !== file.noticeSha256 ||
      !notice.equals(Buffer.from(file.completeOriginalNotice, "utf8")))
      throw new MlirBuildError(`Complete original notice changed: ${file.path}`, "mlir-source-license");
    inputs.push(entry);
  }
  return { inputs, bundle: { schemaVersion: "1", baseCommit: identity.baseCommit, sourceCommit: identity.sourceCommit,
    role: "compiler-side-M01", approvalLockSha256: legal.approvalLockSha256,
    purpose: lock.purpose, files: lock.files } };
}
