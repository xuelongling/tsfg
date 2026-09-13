// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyGoWorkAccess } from "../../eng/go-work-access.mjs";

test("Go work access probe creates and reads a real file in the declared work root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-go-work-"));
  assert.equal(await verifyGoWorkAccess(root), "allowed");
  assert.equal(await readFile(path.join(root, "work-write-canary.txt"), "utf8"), "tsfg declared work write\n");
});

test("Go work access probe refuses to overwrite an existing canary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-go-work-"));
  const canary = path.join(root, "work-write-canary.txt");
  await writeFile(canary, "prior evidence");
  await assert.rejects(verifyGoWorkAccess(root), { code: "EEXIST" });
  assert.equal(await readFile(canary, "utf8"), "prior evidence");
});
