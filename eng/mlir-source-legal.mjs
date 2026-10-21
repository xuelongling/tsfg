// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { IntakeLedgerError, sourceGitEnvironment } from "./intake-ledger.mjs";
import { readMlirSourceIdentity } from "./mlir-source.mjs";

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const reject = message => { throw new IntakeLedgerError("mlir-source-license", message); };

/** Read only bytes proven to be the exact immutable Git object, never a guessed normalization. */
export function mlirCommittedSourceBytes(checkout, blob, name) {
  const oid = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (oid(checkout) === blob) return checkout;
  if (!Buffer.from(checkout.toString("utf8"), "utf8").equals(checkout))
    reject(`Binary source differs from committed input: ${name}`);
  const canonical = Buffer.from(checkout.toString("utf8").replaceAll("\r\n", "\n"), "utf8");
  if (oid(canonical) !== blob) reject(`Source differs beyond Git checkout line endings: ${name}`);
  return canonical;
}

/** Conditional finite-delegation inventory; only actual fixed-target dependencies may consume its entries. */
export async function readMlirSourceBuildLegalInputs({ sourceRoot, git, paths, role = "compiler-side-M01" }) {
  try {
    if (role !== "compiler-side-M01") reject("Selected build registration is compiler-side M01 only");
    const bytes = await readFile(new URL("./mlir-source-build-legal.lock.json", import.meta.url));
    if (digest(bytes) !== "sha256:82f6b176b903df342a2a2d50553b1cc70c5152f6104a0155c7fcd20c348655fd")
      reject("The committed selected-build legal inventory or complete original materials changed");
    const lock = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length)
      reject("Actual build dependencies require distinct explicit paths");
    const entries = new Map(lock.files.map(file => [file.path, file]));
    const selected = paths.map(name => {
      const file = entries.get(name);
      if (!file) reject(`No qualified mandatory build input: ${name}`);
      return file;
    });
    const identity = await readMlirSourceIdentity({ sourceRoot, git });
    if (identity.baseCommit !== lock.baseCommit || identity.sourceCommit !== lock.sourceCommit || lock.role !== "compiler-side-M01")
      reject("Selected build registration cannot transfer source, version or role");
    for (const file of [...selected, ...lock.licenseMaterials]) {
      let absolute = sourceRoot;
      const parts = file.path.split("/");
      for (const [index, part] of parts.entries()) {
        absolute = path.join(absolute, part);
        const state = await lstat(absolute);
        if (state.isSymbolicLink() || (index === parts.length - 1 ? !state.isFile() : !state.isDirectory()))
          reject(`Nonregular registered source input: ${file.path}`);
      }
      const raw = mlirCommittedSourceBytes(await readFile(absolute), file.blob, file.path);
      if (digest(raw) !== file.sha256) reject(`Registered committed raw SHA mismatch: ${file.path}`);
      if (file.noticeStart !== undefined) {
        const notice = raw.subarray(Number(file.noticeStart), Number(file.noticeEnd));
        if (digest(notice) !== file.noticeSha256 || !notice.equals(Buffer.from(file.completeOriginalAttribution)))
          reject(`Registered complete original attribution changed: ${file.path}`);
      } else if (!raw.equals(Buffer.from(file.completeOriginalNotice))) reject(`Complete legal material changed: ${file.path}`);
    }
    return { schemaVersion: "1", status: "selected-build-legal-inputs-verified", role: lock.role,
      sourceCommit: lock.sourceCommit, baseCommit: lock.baseCommit, registrationLockSha256: digest(bytes),
      files: selected, licenseMaterials: lock.licenseMaterials, intakeComplete: false, sourceBuild: "not-run" };
  } catch (error) {
    if (error instanceof IntakeLedgerError) throw error;
    reject(`Selected build legal input inspection failed: ${error.message}`);
  }
}

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
    if (digest(bytes) !== "sha256:30024bdeb99966ec45d01961b675bcc5e8f8fa94c7cab3208a205b68a325f04c")
      reject("The finite file-qualified approval mapping or complete original notice changed");
    const lock = JSON.parse(bytes.toString("utf8"));
    const requested = paths ?? lock.defaultPaths;
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
        windowsHide: true, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
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
        noticeSha256: file.noticeSha256, completeOriginalNotice: file.notice, consumptionBasis: file.consumptionBasis, consumption: file.consumption ?? "compiler-side-source" });
    }
    return { schemaVersion: "1", status: "selected-legal-files-verified", intakeComplete: false,
      sourceBuild: "not-run", role, baseCommit, sourceCommit: identity.sourceCommit,
      approvalLockSha256: digest(bytes), files };
  } catch (error) {
    if (error instanceof IntakeLedgerError) throw error;
    reject(`MLIR file-qualified legal inspection failed: ${error.message}`);
  }
}
