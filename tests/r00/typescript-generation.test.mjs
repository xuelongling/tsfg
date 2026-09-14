// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url));
test("prefetch refuses a missing locked generation dependency before downloading tools", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "generation-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = JSON.parse(await readFile(new URL("../../eng/go-ast-toolchains.lock.json", import.meta.url), "utf8"));
  delete lock.goDependencies;
  lock.generationDependencies = { path: "missing-generation.json", sha256: `sha256:${"a".repeat(64)}` };
  const lockPath = path.join(root, "lock.json");
  await writeFile(lockPath, JSON.stringify(lock));
  const child = spawnSync(process.execPath, [entry, "prefetch", "--dev", "--lock", lockPath,
    "--cache", path.join(root, "cache"), "--platform", "invalid-target"], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 11);
  assert.match(child.stderr, /generation dependency lock unavailable/);
});
