// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const entry = fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url));
test("source repro-check requires two distinct verified workspace paths", () => {
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", "E:/same", "--workspace-b", "E:/same", "--out", "E:/out"],
  { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 2);
  assert.match(child.stderr, /two distinct.*workspace/);
});

test("source build declares its complete reproducibility payload separately from evidence", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_BUILD !== "1" ? "requires pinned real source closure" : false,
}, async () => {
  const product = fileURLToPath(new URL("../../", import.meta.url));
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  const child = spawnSync(process.execPath, [entry, "build", "--dev", "--source-target", "typescript-ast",
    "--generation", "replay", "--workspace", product, "--intake-plan", path.join(product, "eng/intake-declarations/typescript-ast.json"),
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", path.join(root, "producer"), "--report", path.join(root, "build.json")],
  { env: { ...process.env, TSFG_RUNTIME_LOCK: path.join(product, "eng/go-ast-toolchains.lock.json"),
    TSFG_RUNTIME_CACHE: process.env.TSFG_TEST_GO_CACHE, TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" },
    encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const manifest = JSON.parse(await readFile(path.join(root, "producer/artifact-manifest.json"), "utf8"));
  assert.deepEqual(manifest.members.map(member => member.path), ["ast.json", "build-metadata.json", "probes.json", "tsfg-ast.exe"]);
  assert.equal(manifest.kind, "typescript-source-probe");
  const report = JSON.parse(await readFile(path.join(root, "build.json"), "utf8")).result;
  assert.deepEqual(manifest.buildIdentity, report.buildIdentity);
  assert.equal(report.execution.cachesInitiallyEmpty, true);
  assert.equal(report.execution.nativeExitCode, 0);
});

test("source repro-check rejects paths without verified integration metadata", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "source-repro-workspace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--workspace-a", path.join(root, "a"),
    "--workspace-b", path.join(root, "b"), "--out", path.join(root, "out"),
    "--manifest-revision", "a".repeat(40), "--manifest", "candidates/tsfg-v0.2.0.xml"],
  { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 10, child.stderr);
  assert.match(child.stderr, /workspace|manifest|Git/);
});
