// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, readFile, mkdir, cp, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const entry = fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url));
const fixtureJson = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(fixtureJson).join(",")}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${fixtureJson(value[key])}`).join(",")}}`;
const fixtureHash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("source repro-check detects a shared absolute UTF-16 workspace path in equal payloads", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_PATH !== "1" ? "requires real producers for deliberate path leakage" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  for (const [index, label] of ["a", "b"].entries()) {
    const producer = path.join(root, label);
    await cp(original.producers[index].output, producer, { recursive: true, errorOnExist: true, force: false });
    const binary = Buffer.concat([await readFile(path.join(producer, "tsfg-ast.exe")),
      Buffer.from(original.producers[0].workspaceRoot, "utf16le")]);
    await writeFile(path.join(producer, "tsfg-ast.exe"), binary);
    const build = JSON.parse(await readFile(path.join(producer, "source-build.json"), "utf8"));
    build.executableSha256 = fixtureHash(binary);
    build.jsIsolation.artifact.sha256 = build.executableSha256;
    await writeFile(path.join(producer, "js-isolation.json"), fixtureJson(build.jsIsolation));
    await writeFile(path.join(producer, "source-build.json"), fixtureJson(build));
    const manifest = JSON.parse(await readFile(path.join(producer, "artifact-manifest.json"), "utf8"));
    for (const member of manifest.members) member.sha256 = fixtureHash(await readFile(path.join(producer, member.path)));
    await writeFile(path.join(producer, "artifact-manifest.json"), fixtureJson(manifest));
  }
  const output = path.join(root, "out"), report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", path.join(root, "a"), "--producer-b", path.join(root, "b"),
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", "candidates/tsfg-v0.2.0.xml",
    "--out", output, "--report", report], { encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 23, child.stdout + child.stderr);
  const issue = JSON.parse(await readFile(report, "utf8")).error.issues[0];
  assert.match(issue.message, /absolute.*path.*leak/i);
  assert.equal(issue.evidence.reproducibility.bytes.status, "passed");
  assert.equal(issue.evidence.reproducibility.semantics.status, "passed");
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("source repro-check rejects self-consistent evidence for different effective build options", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_STALE !== "1" ? "requires real producers for deliberate stale identity" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  for (const [index, label] of ["a", "b"].entries()) {
    const producer = path.join(root, label);
    await cp(original.producers[index].output, producer, { recursive: true, errorOnExist: true, force: false });
    const build = JSON.parse(await readFile(path.join(producer, "source-build.json"), "utf8"));
    const { digest, ...identity } = build.buildIdentity;
    identity.options.goamd64 = "v3";
    build.buildIdentity = { ...identity, digest: fixtureHash(fixtureJson(identity)) };
    await writeFile(path.join(producer, "source-build.json"), fixtureJson(build));
    const metadata = JSON.parse(await readFile(path.join(producer, "build-metadata.json"), "utf8"));
    metadata.buildIdentity = build.buildIdentity;
    await writeFile(path.join(producer, "build-metadata.json"), fixtureJson(metadata));
    const manifest = JSON.parse(await readFile(path.join(producer, "artifact-manifest.json"), "utf8"));
    manifest.buildIdentity = build.buildIdentity;
    for (const member of manifest.members) member.sha256 = fixtureHash(await readFile(path.join(producer, member.path)));
    await writeFile(path.join(producer, "artifact-manifest.json"), fixtureJson(manifest));
  }
  const output = path.join(root, "out"), report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", path.join(root, "a"), "--producer-b", path.join(root, "b"),
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", "candidates/tsfg-v0.2.0.xml",
    "--out", output, "--report", report], { encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 23, child.stdout + child.stderr);
  assert.match(JSON.parse(await readFile(report, "utf8")).error.issues[0].message, /current.*identity|identity.*current/i);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("source repro-check rejects identical wrong semantics independently of equal payload bytes", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_WRONG_SEMANTICS !== "1" ? "requires real producers for deliberate corruption" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  for (const [index, label] of ["a", "b"].entries()) {
    const producer = path.join(root, label);
    await cp(original.producers[index].output, producer, { recursive: true, errorOnExist: true, force: false });
    const build = JSON.parse(await readFile(path.join(producer, "source-build.json"), "utf8"));
    build.ast.kind = "DeliberatelyWrongSourceFile";
    build.probes.cases[0].observation.kind = "DeliberatelyWrongSourceFile";
    const ast = fixtureJson(build.ast), probes = fixtureJson(build.probes);
    build.observationSha256 = fixtureHash(ast);
    build.probeObservationSha256 = fixtureHash(probes);
    await writeFile(path.join(producer, "ast.json"), ast);
    await writeFile(path.join(producer, "probes.json"), probes);
    await writeFile(path.join(producer, "source-build.json"), fixtureJson(build));
    const manifest = JSON.parse(await readFile(path.join(producer, "artifact-manifest.json"), "utf8"));
    for (const member of manifest.members) member.sha256 = fixtureHash(await readFile(path.join(producer, member.path)));
    await writeFile(path.join(producer, "artifact-manifest.json"), fixtureJson(manifest));
  }
  const output = path.join(root, "out"), report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", path.join(root, "a"), "--producer-b", path.join(root, "b"),
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", "candidates/tsfg-v0.2.0.xml",
    "--out", output, "--report", report], { encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 23, child.stdout + child.stderr);
  const evidence = JSON.parse(await readFile(report, "utf8")).error.issues[0].evidence;
  assert.equal(evidence.reproducibility.bytes.status, "passed");
  assert.equal(evidence.reproducibility.semantics.status, "failed");
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("source repro-check reports an existing output as a configuration failure before verification", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "source-repro-existing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, "existing"), report = path.join(root, "report.json");
  await mkdir(output);
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--workspace-a", path.join(root, "a"),
    "--workspace-b", path.join(root, "b"), "--out", output, "--report", report], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 2, child.stderr);
  assert.match(JSON.parse(await readFile(report, "utf8")).error.issues[0].message, /output already exists/);
});

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
  for (const name of ["contracts/registry.json", "eng/probes/typescript.json", "eng/probes/syntax-error.ts",
    "eng/probes/type-error.ts", "eng/probes/js-isolation.json", "LICENSE"]) {
    assert.ok(manifest.buildInputSet.entries.some(input => input.projectId === "tsfg"
      && input.repositoryRelativePath === name), `missing consumed Build Input: ${name}`);
  }
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

test("source repro-check rebuilds the same verified candidate in two independent paths", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO !== "1" ? "requires two real materialized candidate workspaces" : false,
}, async () => {
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", process.env.TSFG_TEST_REPRO_A, "--workspace-b", process.env.TSFG_TEST_REPRO_B,
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", process.env.TSFG_TEST_REPRO_MANIFEST, "--manifest", "candidates/tsfg-v0.2.0.xml",
    "--out", path.join(root, "comparison"), "--report", path.join(root, "report.json")],
  { env: { ...process.env, TSFG_RUNTIME_LOCK: undefined, TSFG_RUNTIME_CACHE: undefined, TSFG_RUNTIME_PLATFORM: undefined },
    encoding: "utf8", timeout: 2400000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(await readFile(path.join(root, "report.json"), "utf8")).result;
  assert.equal(result.reproducibility.bytes.status, "passed");
  assert.equal(result.reproducibility.semantics.status, "passed");
  assert.equal(result.isolation, "not-enforced");
  assert.equal(result.producers.length, 2);
  assert.notEqual(result.producers[0].execution.compileCache, result.producers[1].execution.compileCache);
  assert.ok(result.producers.every(producer => producer.workspace.dirty === false && producer.build.status === "passed"));
});

test("source repro-check revalidates existing real producers without claiming a new build", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_RECHECK !== "1" ? "requires real source producer evidence" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", original.producers[0].output, "--producer-b", original.producers[1].output,
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", "candidates/tsfg-v0.2.0.xml",
    "--out", path.join(root, "comparison"), "--report", path.join(root, "report.json")],
  { encoding: "utf8", timeout: 1200000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(await readFile(path.join(root, "report.json"), "utf8")).result;
  assert.equal(result.operation, "compare-existing");
  assert.ok(result.producers.every(producer => producer.command === null && producer.build.mode === "recorded"));
  assert.equal(result.reproducibility.bytes.status, "passed");
  assert.equal(result.reproducibility.semantics.status, "passed");
});
