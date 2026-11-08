// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { IntakeLedgerError } from "./intake-ledger.mjs";

const registrations = {
  build: ["mlir-source-build-legal.lock.json", "sha256:dfd4975652b31eb99a24f2a2465cee566d5241c240e63c34ba96f01772c91bd9"],
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
