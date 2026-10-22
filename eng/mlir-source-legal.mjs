// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IntakeLedgerError, sourceGitEnvironment } from "./intake-ledger.mjs";
import { readMlirSourceIdentity } from "./mlir-source.mjs";
import { inspectMlirSdkProvenance, verifyMlirSdkLicenseMaterial, verifyMlirSdkNoticeRecord } from "./mlir-sdk.mjs";
import { readMlirLegalRegistration } from "./mlir-source-registration.mjs";

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
export async function readMlirSourceBuildLegalInputs({ sourceRoot, git, paths, role = "compiler-side-M01", sdk = null, canonicalize = undefined }) {
  try {
    const proof = sdk ? inspectMlirSdkProvenance(sdk, fileURLToPath(new URL("..", import.meta.url))) : null;
    if (role !== "compiler-side-M01") reject("Selected build registration is compiler-side M01 only");
    const { lock, sha256: registrationHash } = await readMlirLegalRegistration("build");
    if (!Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length)
      reject("Actual build dependencies require distinct explicit paths");
    const entries = new Map(lock.files.map(file => [file.path, file]));
    const selected = paths.map(name => {
      const file = entries.get(name);
      if (!file) reject(`No qualified mandatory build input: ${name}`);
      return file;
    });
    // Historical registration hashes identify the original build. The current
    // finite mapping independently qualifies every selected physical member.
    const identity = proof ? { baseCommit: proof.sourceNotices.baseCommit, sourceCommit: proof.identity.sourceCommit } :
      await readMlirSourceIdentity({ sourceRoot, git });
    if (identity.baseCommit !== lock.baseCommit || identity.sourceCommit !== lock.sourceCommit || lock.role !== "compiler-side-M01")
      reject("Selected build registration cannot transfer source, version or role");
    for (const file of [...selected, ...lock.licenseMaterials]) {
      if (proof && lock.licenseMaterials.includes(file)) {
        const material = proof.consumptionLegal.licenseMaterials.find(material => material.path === file.path);
        verifyMlirSdkLicenseMaterial(file, material, canonicalize);
        continue;
      }
      if (proof) {
        const member = proof.files.find(member => member.path === "source/" + file.path);
        const entry = proof.sourceEntries.find(entry => entry.repositoryRelativePath === file.path);
        if (!member || member.sha256 !== file.sha256 || !entry || entry.blob !== file.blob || entry.sha256 !== file.sha256)
          reject(`Selected physical source is not an exact SDK inventory member: ${file.path}`);
      }
      let absolute = proof ? proof.source : sourceRoot;
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
      sourceCommit: lock.sourceCommit, baseCommit: lock.baseCommit, registrationLockSha256: registrationHash,
      files: selected, licenseMaterials: lock.licenseMaterials, intakeComplete: false, sourceBuild: "not-run" };
  } catch (error) {
    if (error instanceof IntakeLedgerError) throw error;
    reject(`Selected build legal input inspection failed: ${error.message}`);
  }
}

/**
 * Verify only explicitly approved legal files. This is not whole-build intake.
 * No caller-supplied approval or license expression can extend this selection.
 * @param {{sourceRoot?: string, git?: string, role?: string, baseCommit?: string, paths?: string[], sdk?: object, canonicalize?: (value: unknown) => string}} input
 */
export async function readMlirSourceLegalFiles({ sourceRoot, git, role = "compiler-side-M01",
  baseCommit = "fc4aad7b5db3fff421df9a9637605b9ca5667881", paths, sdk = null, canonicalize }) {
  try {
    if (role !== "compiler-side-M01" || baseCommit !== "fc4aad7b5db3fff421df9a9637605b9ca5667881")
      reject("The legal decision is limited to compiler-side M01 at the exact approved base");
    const { lock, sha256: approvalHash } = await readMlirLegalRegistration("file");
    const requested = paths ?? lock.defaultPaths;
    if (!Array.isArray(requested) || requested.length === 0 || new Set(requested).size !== requested.length)
      reject("Legal coverage requires distinct explicit source paths");
    const selected = requested.map(name => {
      const entry = lock.files.find(file => file.path === name);
      if (!entry) reject(`No file-qualified legal approval for ${name}`);
      return entry;
    });
    const proof = sdk ? inspectMlirSdkProvenance(sdk, fileURLToPath(new URL("..", import.meta.url))) : null;
    if (proof && proof.sourceNotices.approvalLockSha256 !== approvalHash) reject("SDK legal carrier has another fixed file approval");
    const identity = proof ? { baseCommit: proof.sourceNotices.baseCommit, sourceCommit: proof.identity.sourceCommit } :
      await readMlirSourceIdentity({ sourceRoot, git });
    if (identity.baseCommit !== lock.baseCommit || identity.sourceCommit !== lock.sourceCommit)
      reject("Legal approval cannot be reused for a different source identity");
    if (proof && selected.some(file => file.consumption === "original-notice-retention-only")) {
      const notices = JSON.parse(await readFile(new URL("./mlir-source-notices.lock.json", import.meta.url), "utf8"));
      verifyMlirSdkNoticeRecord(notices, proof.sourceNotices, identity, canonicalize, approvalHash);
    }
    const committed = (...args) => {
      const child = spawnSync(git, ["-C", sourceRoot, ...args], { env: sourceGitEnvironment(),
        windowsHide: true, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
      if (child.error || child.status !== 0) reject(`Cannot inspect approved source blob: ${args[0]}`);
      return child.stdout;
    };
    const files = [];
    for (const file of selected) {
      // The fixed approval distinguishes complete retained notices from physical compiler inputs.
      if (proof && file.consumption === "original-notice-retention-only") {
        const notice = proof.sourceNotices.files.find(notice => notice.path === file.path);
        const raw = typeof notice?.completeOriginalNotice === "string" ? Buffer.from(notice.completeOriginalNotice, "utf8") : null;
        if (!notice || !raw || notice.blob !== file.blob || notice.sha256 !== file.sha256 ||
            String(notice.noticeStart) !== String(file.noticeStart) || String(notice.noticeEnd) !== String(file.noticeEnd) ||
            notice.noticeSha256 !== file.noticeSha256 || Number(file.noticeStart) !== 0 || Number(file.noticeEnd) !== raw.length ||
            digest(raw) !== file.sha256 || digest(raw) !== file.noticeSha256 || !raw.equals(Buffer.from(file.notice, "utf8")))
          reject(`Authenticated complete retained notice differs from fixed approval: ${file.path}`);
        files.push({ path: file.path, blob: file.blob, sha256: file.sha256, license: file.license,
          noticeSha256: file.noticeSha256, completeOriginalNotice: file.notice, consumptionBasis: file.consumptionBasis, consumption: file.consumption });
        continue;
      }
      if (proof) {
        const member = proof.files.find(member => member.path === "source/" + file.path);
        const entry = proof.sourceEntries.find(entry => entry.repositoryRelativePath === file.path);
        if (!member || member.sha256 !== file.sha256 || !entry || entry.blob !== file.blob || entry.sha256 !== file.sha256)
          reject(`Approved physical source is not an exact SDK inventory member: ${file.path}`);
      }
      let absolute = proof ? proof.source : sourceRoot;
      const parts = file.path.split("/");
      for (const [index, part] of parts.entries()) {
        absolute = path.join(absolute, part);
        const state = await lstat(absolute);
        if (state.isSymbolicLink() || (index === parts.length - 1 ? !state.isFile() : !state.isDirectory()))
          reject(`Nonregular approved source input: ${file.path}`);
      }
      const raw = await readFile(absolute);
      const blob = proof ? file.blob : committed("rev-parse", `${baseCommit}:${file.path}`).toString("utf8").trim();
      const notice = raw.subarray(Number(file.noticeStart), Number(file.noticeEnd));
      if (blob !== file.blob || digest(raw) !== file.sha256 ||
          (proof ? !mlirCommittedSourceBytes(raw, file.blob, file.path).equals(raw) : !committed("cat-file", "blob", file.blob).equals(raw)) || digest(notice) !== file.noticeSha256 ||
          !notice.equals(Buffer.from(file.notice, "utf8"))) reject(`Approved bytes or complete notice mismatch: ${file.path}`);
      files.push({ path: file.path, blob: file.blob, sha256: file.sha256, license: file.license,
        noticeSha256: file.noticeSha256, completeOriginalNotice: file.notice, consumptionBasis: file.consumptionBasis, consumption: file.consumption ?? "compiler-side-source" });
    }
    return { schemaVersion: "1", status: "selected-legal-files-verified", intakeComplete: false,
      sourceBuild: "not-run", role, baseCommit, sourceCommit: identity.sourceCommit,
      approvalLockSha256: approvalHash, files };
  } catch (error) {
    if (error instanceof IntakeLedgerError) throw error;
    reject(`MLIR file-qualified legal inspection failed: ${error.message}`);
  }
}
