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

test("typed consumer replays its committed generated sources through the build entry", {
  skip: process.env.TSFG_TEST_GENERATION !== "1" ? "requires pinned generation closure" : false,
}, async () => {
  const product = fileURLToPath(new URL("../../", import.meta.url));
  const root = process.env.TSFG_TEST_GENERATION_EVIDENCE;
  const report = path.join(root, "replay.json");
  const child = spawnSync(process.execPath, [entry, "build", "--dev", "--source-target", "typescript-ast",
    "--generation", "replay", "--workspace", product, "--intake-plan", path.join(product, "eng/intake-declarations/typescript-ast.json"),
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", path.join(root, "replay-output"), "--report", report],
  { env: { ...process.env, TSFG_RUNTIME_LOCK: path.join(product, "eng/go-ast-toolchains.lock.json"),
    TSFG_RUNTIME_CACHE: process.env.TSFG_TEST_GO_CACHE, TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" },
    encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(await readFile(report, "utf8")).result;
  assert.equal(result.generation.status, "passed");
  assert.equal(result.generation.mode, "replayed");
  assert.equal(result.generation.differences.length, 0);
  assert.ok(result.generation.outputs.some(item => item.path === "internal/ast/ast_generated.go"));
  assert.ok(result.generation.outputs.some(item => item.path === "internal/stringutil/js_case_generated.go"));
  assert.equal(result.probes.status, "passed");
});
