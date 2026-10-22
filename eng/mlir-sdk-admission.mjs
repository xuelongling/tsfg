// SPDX-License-Identifier: MIT
import { readFile } from "node:fs/promises";
import { IntakeLedgerError } from "./intake-ledger.mjs";
import { readMlirLegalRegistration } from "./mlir-source-registration.mjs";

/** Metadata comparison only. A locked derived library cannot supersede current source admission. */
export function verifyMlirSdkSourceRegistration({ sdkLock, sourceLock, buildLegal, fileLegal }) {
  const reject = message => { throw new IntakeLedgerError("mlir-source-license", message); };
  if (sdkLock.sourceCommit !== sourceLock.sourceCommit || sdkLock.sourceTree !== sourceLock.sourceTree ||
      [buildLegal, fileLegal].some(lock => lock.sourceCommit !== sdkLock.sourceCommit ||
        lock.baseCommit !== sourceLock.baseCommit || lock.role !== "compiler-side-M01"))
    reject("SDK and current finite source registrations have different source identities");
  const known = new Map([...buildLegal.files, ...buildLegal.licenseMaterials, ...fileLegal.files,
    ...sourceLock.files].map(file => [file.path, file]));
  const missingPaths = [], mismatchedPaths = [];
  for (const file of sdkLock.files) {
    if (!file.path.startsWith("source/")) continue;
    const name = file.path.slice(7), registered = known.get(name);
    if (!registered) missingPaths.push(name);
    else if (registered.sha256 !== file.sha256) mismatchedPaths.push(name);
  }
  if (missingPaths.length || mismatchedPaths.length) {
    const error = new IntakeLedgerError("mlir-source-license",
      `SDK source admission is unresolved: ${missingPaths.length} unregistered paths, ${mismatchedPaths.length} raw SHA mismatches; first: ${missingPaths[0] ?? mismatchedPaths[0]}`);
    Object.assign(error, { missingPaths, mismatchedPaths, sdkBodyRead: false });
    throw error;
  }
}

/** Run before any external SDK body read, using only current product lock metadata. */
export async function readMlirSdkSourceAdmission(sdkLock) {
  const build = await readMlirLegalRegistration("build");
  const file = await readMlirLegalRegistration("file");
  const sourceLock = JSON.parse(await readFile(new URL("./mlir-source.lock.json", import.meta.url), "utf8"));
  verifyMlirSdkSourceRegistration({ sdkLock, sourceLock, buildLegal: build.lock, fileLegal: file.lock });
}
