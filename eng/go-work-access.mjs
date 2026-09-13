// SPDX-License-Identifier: MIT

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Retain the canary with the execution evidence. Never overwrite a prior run.
export async function verifyGoWorkAccess(workRoot) {
  const canary = path.join(workRoot, "work-write-canary.txt");
  const contents = "tsfg declared work write\n";
  await writeFile(canary, contents, { flag: "wx" });
  if (await readFile(canary, "utf8") !== contents) throw new Error("declared work readback differs");
  return "allowed";
}
