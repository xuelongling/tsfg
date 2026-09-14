// SPDX-License-Identifier: MIT
// Private generation stage of the Hermetic Build Entry.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export async function readGenerationLock(lockPath, lock) {
  const reference = lock.generationDependencies;
  if (!reference) return undefined;
  if (!/^[a-z0-9][a-z0-9.-]*\.json$/.test(reference.path)) throw new Error("invalid generation dependency lock path");
  const bytes = await readFile(path.join(path.dirname(path.resolve(lockPath)), reference.path))
    .catch(error => { throw new Error(`generation dependency lock unavailable: ${error.message}`); });
  if (hash(bytes) !== reference.sha256) throw new Error("generation dependency lock digest mismatch");
  if (!lock.dependencyLocks?.some(entry => entry.projectId === "tsfg"
      && entry.path === `eng/${reference.path}` && entry.sha256 === reference.sha256)) {
    throw new Error("generation dependency lock must participate in Toolchain Closure");
  }
  const declaration = JSON.parse(bytes.toString("utf8"));
  if (declaration.schemaVersion !== "1") throw new Error("unsupported generation dependency schema");
  return declaration;
}
