// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { IntakeLedgerError, sourceGitEnvironment } from "./intake-ledger.mjs";
import { readMlirSourceIdentity } from "./mlir-source.mjs";

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const reject = message => { throw new IntakeLedgerError("mlir-source-license", message); };

/**
 * Verify only explicitly approved legal files. This is not whole-build intake.
 * No caller-supplied approval or license expression can extend this selection.
 * @param {{sourceRoot?: string, git?: string, role?: string, baseCommit?: string, paths?: string[]}} input
 */
export async function readMlirSourceLegalFiles({ sourceRoot, git, role = "compiler-side-M01",
  baseCommit = "fc4aad7b5db3fff421df9a9637605b9ca5667881", paths }) {
  try {
    if (role !== "compiler-side-M01" || baseCommit !== "fc4aad7b5db3fff421df9a9637605b9ca5667881")
      reject("The legal decision is limited to compiler-side M01 at the exact approved base");
    const bytes = await readFile(new URL("./mlir-source-legal.lock.json", import.meta.url));
    // Finite approval, pinned independently of mutable caller/evidence inputs.
    if (digest(bytes) !== "sha256:1f06c3b1b7180cf4e7ddbea629cb2899b4c74cec433574824ebcc7024c9eb40b")
      reject("The exact five-file approval mapping or complete original notice changed");
    const lock = JSON.parse(bytes.toString("utf8"));
    const requested = paths ?? lock.files.map(file => file.path);
    if (!Array.isArray(requested) || requested.length === 0 || new Set(requested).size !== requested.length)
      reject("Legal coverage requires distinct explicit source paths");
    const selected = requested.map(name => {
      const entry = lock.files.find(file => file.path === name);
      if (!entry) reject(`No file-qualified legal approval for ${name}`);
      return entry;
    });
    const identity = await readMlirSourceIdentity({ sourceRoot, git });
    if (identity.baseCommit !== lock.baseCommit || identity.sourceCommit !== lock.sourceCommit)
      reject("Legal approval cannot be reused for a different source identity");
    const committed = (...args) => {
      const child = spawnSync(git, ["-C", sourceRoot, ...args], { env: sourceGitEnvironment(),
        windowsHide: true, encoding: "buffer", maxBuffer: 1024 * 1024 });
      if (child.error || child.status !== 0) reject(`Cannot inspect approved source blob: ${args[0]}`);
      return child.stdout;
    };
    const files = [];
    for (const file of selected) {
      let absolute = sourceRoot;
      const parts = file.path.split("/");
      for (const [index, part] of parts.entries()) {
        absolute = path.join(absolute, part);
        const state = await lstat(absolute);
        if (state.isSymbolicLink() || (index === parts.length - 1 ? !state.isFile() : !state.isDirectory()))
          reject(`Nonregular approved source input: ${file.path}`);
      }
      const raw = await readFile(absolute);
      const blob = committed("rev-parse", `${baseCommit}:${file.path}`).toString("utf8").trim();
      const notice = raw.subarray(Number(file.noticeStart), Number(file.noticeEnd));
      if (blob !== file.blob || digest(raw) !== file.sha256 ||
          !committed("cat-file", "blob", file.blob).equals(raw) || digest(notice) !== file.noticeSha256 ||
          !notice.equals(Buffer.from(file.notice, "utf8"))) reject(`Approved bytes or complete notice mismatch: ${file.path}`);
      files.push({ path: file.path, blob: file.blob, sha256: file.sha256, license: file.license,
        noticeSha256: file.noticeSha256, completeOriginalNotice: file.notice, consumptionBasis: file.consumptionBasis });
    }
    return { schemaVersion: "1", status: "selected-legal-files-verified", intakeComplete: false,
      sourceBuild: "not-run", role, baseCommit, sourceCommit: identity.sourceCommit,
      approvalLockSha256: digest(bytes), files };
  } catch (error) {
    if (error instanceof IntakeLedgerError) throw error;
    reject(`MLIR file-qualified legal inspection failed: ${error.message}`);
  }
}
