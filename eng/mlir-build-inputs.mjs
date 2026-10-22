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


export async function materializeSource(identity, git, destination) {
  const rawTree = gitBytes(git, identity.sourceRoot,
    ["ls-tree", "-r", "-z", identity.sourceCommit, "--", "llvm", "mlir", "cmake", "third-party", "UPSTREAM.toml"]);
  const entries = [];
  const unmaterialized = [];
  const checkoutDifferences = [];
  for (const line of rawTree.toString("utf8").split("\0").filter(Boolean)) {
    const link = /^120000 blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (link) {
      unmaterialized.push({ path: link[2], mode: "120000", blob: link[1], reason: "nonregular input is never materialized or admitted for consumption" });
      continue;
    }
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match) throw new MlirBuildError("Source materialization contains an unsupported Git entry", "mlir-source-integrity");
    const name = match[3];
    const original = path.join(identity.sourceRoot, name);
    const state = await lstat(original);
    if (!state.isFile() || state.isSymbolicLink() || !within(identity.sourceRoot, await realpath(original)))
      throw new MlirBuildError(`Nonregular source input: ${name}`, "mlir-source-integrity");
    const checkout = await readFile(original);
    let bytes;
    try { bytes = mlirCommittedSourceBytes(checkout, match[2], name); }
    catch (error) { throw new MlirBuildError(error.message, "mlir-source-integrity"); }
    if (!bytes.equals(checkout)) checkoutDifferences.push({ path: name, observedCheckoutSha256: digest(checkout),
      committedBlob: match[2], consumedRawSha256: digest(bytes), method: "only CRLF-to-LF; exact immutable Git object equality proven" });
    const target = path.join(destination, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
    entries.push({ projectId: "llvm-project.git", repositoryRelativePath: name,
      normalizedMode: match[1], sha256: digest(bytes), blob: match[2] });
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
