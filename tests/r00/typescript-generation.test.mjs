// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
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
    "--cache", path.join(root, "cache"), "--platform", "windows-x86_64-msvc"], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 11);
  assert.match(child.stderr, /generation dependency lock unavailable/);
});

test("missing locked generator archive blocks the public offline build", {
  skip: process.env.TSFG_TEST_GENERATION_NEGATIVES !== "1" ? "requires pinned preparation; synthetic missing archive" : false,
}, async () => {
  const product = fileURLToPath(new URL("../../", import.meta.url));
  const root = path.join(process.env.TSFG_TEST_GENERATION_EVIDENCE, "missing-tool");
  const report = path.join(root, "report.json"), output = path.join(root, "out");
  const fixture = new URL("./generation-process-fixture.mjs?mode=missing-tool", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--import", fixture, entry, "build", "--dev", "--source-target", "typescript-ast",
    "--generation", "replay", "--workspace", product, "--intake-plan", path.join(product, "eng/intake-declarations/typescript-ast.json"),
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", output, "--report", report],
  { env: { ...process.env, TSFG_RUNTIME_LOCK: path.join(product, "eng/go-ast-toolchains.lock.json"),
    TSFG_RUNTIME_CACHE: process.env.TSFG_TEST_GO_CACHE, TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" },
    encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 12, child.stdout + child.stderr);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.error.issues[0].generation.status, "not-run");
  assert.equal(result.error.issues[0].requiredTests.status, "not-run");
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("prefetch rejects a floating npm generation input", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "generation-npm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = JSON.stringify({ schemaVersion: "1", packages: [{ name: "dprint", version: "latest" }] });
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  await writeFile(path.join(root, "generation.json"), bytes);
  const lock = JSON.parse(await readFile(new URL("../../eng/go-ast-toolchains.lock.json", import.meta.url), "utf8"));
  delete lock.goDependencies;
  lock.generationDependencies = { path: "generation.json", sha256 };
  lock.dependencyLocks = [{ projectId: "tsfg", path: "eng/generation.json", sha256 }];
  await writeFile(path.join(root, "lock.json"), JSON.stringify(lock));
  const child = spawnSync(process.execPath, [entry, "prefetch", "--dev", "--lock", path.join(root, "lock.json"),
    "--cache", path.join(root, "cache"), "--platform", "windows-x86_64-msvc"], { encoding: "utf8", windowsHide: true });
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
  assert.equal(result.generation.intakeLedger?.status, "matched");
  assert.ok(result.generation.intakeLedger.files.some(item => item.source === "npm:@unicode/unicode-15.1.0@1.6.17"));
  assert.ok(result.buildInputSet.entries.some(item => item.repositoryRelativePath === "tsc/_submodules/TypeScript/src/compiler/diagnosticMessages.json"));
  assert.equal(result.generation.inputsRechecked, true);
  assert.equal(result.generation.binding.buildInputSetDigest, result.buildInputSet.digest);
  assert.equal(result.generation.replayProductOid, result.provenance.find(item => item.projectId === "tsfg").projectOid);
  assert.equal(result.executionResources.goMaxProcs, "2");
  assert.equal(result.generation.executionResources.goMaxProcs, "2");
});

test("source test reports actual required upstream suites without skips", {
  skip: process.env.TSFG_TEST_REQUIRED_UPSTREAM !== "1" ? "requires pinned source test closure" : false,
}, async () => {
  const product = fileURLToPath(new URL("../../", import.meta.url));
  const root = process.env.TSFG_TEST_GENERATION_EVIDENCE;
  const report = path.join(root, "required-tests.json");
  const child = spawnSync(process.execPath, [entry, "test", "--dev", "--source-target", "typescript-ast",
    "--generation", "reuse",
    "--workspace", product, "--intake-plan", path.join(product, "eng/intake-declarations/typescript-ast.json"),
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", path.join(root, "test-output"), "--report", report],
  { env: { ...process.env, TSFG_RUNTIME_LOCK: path.join(product, "eng/go-ast-toolchains.lock.json"),
    TSFG_RUNTIME_CACHE: process.env.TSFG_TEST_GO_CACHE, TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" },
    encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(await readFile(report, "utf8")).result;
  assert.equal(result.requiredTests?.status, "passed");
  assert.deepEqual(result.requiredTests.skipped, []);
  assert.ok(result.requiredTests.passed.some(item => item.test === "TestDeepCloneNodeSanityCheck"));
  assert.ok(result.requiredTests.passed.some(item => item.test === "TestLocalize"));
  assert.ok(result.requiredTests.passed.some(item => item.test === "TestJSCasing"));
  assert.equal(result.requiredTests.intakeLedger?.status, "matched");
  assert.ok(result.requiredTests.intakeLedger.files.some(item => item.source === "module:gotest.tools/v3@v3.5.2"));
  assert.equal(result.generation.status, "passed");
  assert.equal(result.generation.mode, "reused");
  assert.match(result.generation.receiptSha256, /^sha256:[a-f0-9]{64}$/);
});

for (const scenario of [
  { name: "build-exit", fixture: "build-exit", generation: "replay", exit: 20 },
  { name: "build-start", fixture: "build-start", generation: "replay", exit: 20 },
  { name: "missing-source", fixture: "missing-source", generation: "replay", exit: 10 },
  { name: "difference", fixture: "difference", generation: "replay", exit: 20 },
  { name: "skip", fixture: "skip", generation: "reuse", exit: 21 },
  { name: "changed-input-reuse", fixture: "changed-input", generation: "reuse", exit: 20 },
  { name: "changed-input-auto", fixture: "changed-input", generation: undefined, exit: 0 },
]) test(`public generation acceptance: ${scenario.name}`, {
  skip: process.env.TSFG_TEST_GENERATION_NEGATIVES !== "1" ? "requires pinned closure; synthetic boundary/input scenario" : false,
}, async () => {
  const product = fileURLToPath(new URL("../../", import.meta.url));
  const root = path.join(process.env.TSFG_TEST_GENERATION_EVIDENCE, scenario.name);
  const report = path.join(root, "report.json"), output = path.join(root, "out");
  const receiptPath = path.join(product, "eng/probes/generation.json");
  const receiptBytes = await readFile(receiptPath), receipt = JSON.parse(receiptBytes.toString("utf8"));
  const original = await readFile(path.join(product, "../typescript/tsc/internal/ast/ast_generated.go"));
  const fixture = new URL(`./generation-process-fixture.mjs?mode=${scenario.fixture}`, import.meta.url).href;
  const child = spawnSync(process.execPath, ["--import", fixture, entry, "build", "--dev", "--source-target", "typescript-ast",
    ...(scenario.generation ? ["--generation", scenario.generation] : []),
    "--workspace", product, "--intake-plan", path.join(product, "eng/intake-declarations/typescript-ast.json"),
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", output, "--report", report],
  { env: { ...process.env, TSFG_RUNTIME_LOCK: path.join(product, "eng/go-ast-toolchains.lock.json"),
    TSFG_RUNTIME_CACHE: process.env.TSFG_TEST_GO_CACHE, TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" },
    encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, scenario.exit, child.stdout + child.stderr);
  const record = JSON.parse(await readFile(report, "utf8"));
  assert.ok(receiptBytes.equals(await readFile(receiptPath)), "entry must not overwrite a committed receipt");
  assert.ok(original.equals(await readFile(path.join(product, "../typescript/tsc/internal/ast/ast_generated.go"))), "entry must not overwrite the source baseline");
  if (scenario.name === "changed-input-auto") {
    assert.equal(record.result.generation.status, "passed");
    assert.equal(record.result.generation.mode, "replayed");
    assert.notEqual(record.result.generation.binding.digest, receipt.binding.digest);
    assert.equal(record.result.generation.commands.length, 14);
    assert.equal(record.result.requiredTests.status, "passed");
    assert.equal(record.result.probes.status, "passed");
    assert.equal(record.result.intakeComplete, false);
    return;
  }
  await assert.rejects(stat(output), { code: "ENOENT" });
  const issue = record.error.issues[0];
  if (scenario.name === "build-exit" || scenario.name === "build-start") {
    assert.equal(record.status, "failure");
    assert.equal(issue.generation.status, "passed");
    assert.equal(issue.requiredTests.status, "passed");
    assert.deepEqual(issue.requiredTests.skipped, []);
    assert.match(issue.message, scenario.name === "build-exit" ? /synthetic final build failure/ : /ENOENT/);
  } else if (scenario.name === "difference") {
    assert.equal(issue.generation.status, "failed");
    assert.equal(issue.generation.differences.length, 1);
    assert.equal(issue.generation.differences[0].path, "internal/ast/ast_generated.go");
    assert.ok(issue.generation.commands.every(command => command.exitCode === 0));
    assert.equal(issue.requiredTests.status, "not-run");
  } else if (scenario.name === "skip") {
    assert.equal(issue.generation.status, "passed");
    assert.equal(issue.requiredTests.status, "failed");
    assert.equal(issue.requiredTests.command.exitCode, 0);
    assert.equal(issue.requiredTests.skipped.length, 1);
    assert.equal(issue.requiredTests.skipped[0].test, "TestDeepCloneNodeSanityCheck");
  } else {
    assert.equal(issue.generation.status, "not-run");
    assert.equal(issue.requiredTests.status, "not-run");
    assert.match(issue.message, scenario.name === "missing-source" ? /synthetic missing exact subsource/ : /does not match current inputs/);
  }
});
