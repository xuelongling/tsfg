// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { IntakeLedgerError } from "./intake-ledger.mjs";

const registrations = {
  build: ["mlir-source-build-legal.lock.json", "sha256:13863192bcde3ab82329e8ed7b142bc916a33623afc91a542e4cfbf89069fe6f"],
  file: ["mlir-source-legal.lock.json", "sha256:30024bdeb99966ec45d01961b675bcc5e8f8fa94c7cab3208a205b68a325f04c"]
};

/** The fixed finite registrations govern approved direct-source consumption. */
export async function readMlirLegalRegistration(kind) {
  const [name, expected] = registrations[kind] ?? [];
  if (!name) throw new IntakeLedgerError("mlir-source-license", "Unknown finite legal registration");
  const bytes = await readFile(new URL(name, import.meta.url));
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (sha256 !== expected)
    throw new IntakeLedgerError("mlir-source-license", "The committed finite legal registration or original materials changed");
  return { lock: JSON.parse(bytes.toString("utf8")), sha256 };
}

const mesaDeclarationUses = new Set([
  "exact source declaration only; actual external-Mesa-LLVM source-only target use is bound by ECP2026-0008 and the role-specific source identity; execution boundaries remain unchanged",
  "exact source declaration only; actual external-Mesa-LLVM source-only target use bound by ECP2026-0008 and immutable e2 role; execution boundaries unchanged"
]);

/** Select consumption from the pinned declaration records for the caller's existing role. */
export function selectMlirBuildLegalFiles(lock, role = "compiler-side-M01") {
  if (role !== "compiler-side-M01" && (role !== "external-Mesa-LLVM" || lock.externalMesa?.role !== role))
    throw new IntakeLedgerError("mlir-source-license", "Unknown build legal source role");
  return lock.files.filter(file => role === "external-Mesa-LLVM" || !mesaDeclarationUses.has(file.use));
}
