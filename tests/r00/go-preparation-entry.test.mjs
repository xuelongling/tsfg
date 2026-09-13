// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("importing the Hermetic Build Entry does not dispatch a CLI operation", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval",
    "await import('./eng/tsfg-build.mjs')"], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
});

test("private Go preparation validates its authority lock without executing a native process", async () => {
  const { prepareGoSourceAcceptance } = await import("../../eng/tsfg-build.mjs");
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-go-prepare-"));
  const lockPath = path.join(root, "lock.json");
  await writeFile(lockPath, JSON.stringify({ schemaVersion: "unsupported", tools: {} }));
  await assert.rejects(prepareGoSourceAcceptance({ lockPath, cachePath: root,
    output: path.join(root, "out"), profile: "debug" }), /unsupported toolchain lock schema/);
});

test("private Go preparation rejects non-E destinations before opening inputs", async () => {
  const { prepareGoSourceAcceptance } = await import("../../eng/tsfg-build.mjs");
  await assert.rejects(prepareGoSourceAcceptance({ lockPath: "C:\\uncreated-lock.json",
    cachePath: "E:\\uncreated-cache", output: "E:\\uncreated-output", profile: "debug" }),
  /absolute E: lock, cache and output paths/);
});
