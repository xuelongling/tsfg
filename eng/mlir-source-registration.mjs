// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { IntakeLedgerError } from "./intake-ledger.mjs";

const registrations = {
  build: ["mlir-source-build-legal.lock.json", "sha256:8dd21ea165bf1d1b0f778c4023dc0900838413599a5f216d607ce28192ab08be"],
  file: ["mlir-source-legal.lock.json", "sha256:30024bdeb99966ec45d01961b675bcc5e8f8fa94c7cab3208a205b68a325f04c"]
};

/** The same fixed finite registrations govern source builds and SDK intake. */
export async function readMlirLegalRegistration(kind) {
  const [name, expected] = registrations[kind] ?? [];
  if (!name) throw new IntakeLedgerError("mlir-source-license", "Unknown finite legal registration");
  const bytes = await readFile(new URL(name, import.meta.url));
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (sha256 !== expected)
    throw new IntakeLedgerError("mlir-source-license", "The committed finite legal registration or original materials changed");
  return { lock: JSON.parse(bytes.toString("utf8")), sha256 };
}
