// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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

test("prefetch rejects a floating npm generation input", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "generation-npm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = JSON.stringify({ schemaVersion: "1", packages: [{ name: "dprint", version: "latest" }] });
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  await writeFile(path.join(root, "generation.json"), bytes);
  const lock = { schemaVersion: "1", tools: {}, generationDependencies: { path: "generation.json", sha256 },
    dependencyLocks: [{ projectId: "tsfg", path: "eng/generation.json", sha256 }] };
  await writeFile(path.join(root, "lock.json"), JSON.stringify(lock));
  const child = spawnSync(process.execPath, [entry, "prefetch", "--dev", "--lock", path.join(root, "lock.json"),
    "--cache", path.join(root, "cache"), "--platform", "invalid-target"], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 11);
  assert.match(child.stderr, /generation package requires exact identity/);
});
