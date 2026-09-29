// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, readFile, mkdir, cp, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifiedContractSet } from "../../eng/contract-set.mjs";

const entry = fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url));
const manifestName = process.env.TSFG_TEST_MANIFEST_NAME ?? "candidates/tsfg-v0.2.0.xml";
if (!/^candidates\/tsfg-v\d+\.\d+\.\d+\.xml$/.test(manifestName)) throw new Error("Invalid test manifest name");
const fixtureJson = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(fixtureJson).join(",")}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${fixtureJson(value[key])}`).join(",")}}`;
const fixtureHash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("source intake completes only the reviewed real TypeScript candidate", {
  skip: process.env.TSFG_TEST_SOURCE_INTAKE !== "1" ? "requires a real candidate pair and bound consumption review" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", original.producers[0].output, "--producer-b", original.producers[1].output,
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
    "--intake-review", process.env.TSFG_TEST_INTAKE_REVIEW,
    "--out", path.join(root, "comparison"), "--report", path.join(root, "report.json")],
  { encoding: "utf8", timeout: 1200000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(await readFile(path.join(root, "report.json"), "utf8")).result;
  assert.equal(result.intakeComplete, true);
  assert.equal(result.risks.evidenceKind, "real-source");
  assert.equal(result.risks.decision, "continue");
  assert.ok(result.risks.dependencies.some(file => file.source === "TypeScript.git"
    && file.path === "tsc/internal/parser/parser.go" && file.consumer === "tsfg-ast"));
  assert.ok(result.risks.dependencies.some(file => file.source === "go" && file.role === "compiler-payload"));
  assert.ok(result.risks.dependencies.some(file => file.phase === "generation"));
  assert.ok(result.risks.dependencies.some(file => file.phase === "required-tests"));
  assert.ok(result.risks.dependencies.every(file => file.role !== "game-runtime"));
  assert.equal(result.intakeScope.source, "TypeScript");
  assert.equal(result.intakeScope.r02aComplete, false);
  assert.equal(result.intakeScope.languageImplementationComplete, false);
});

for (const scenario of ["source", "toolchain", "generation", "required-tests", "stale-binding", "reported-impacts"]) {
  test(`source intake rejects a replaced review: ${scenario}`, {
    skip: process.env.TSFG_TEST_SOURCE_INTAKE_REVIEW_NEGATIVES !== "1" ? "requires real producers for review mutation checks" : false,
  }, async () => {
    const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
    const review = JSON.parse(await readFile(process.env.TSFG_TEST_INTAKE_REVIEW, "utf8"));
    const root = path.join(process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE, scenario);
    await mkdir(root, { recursive: true });
    if (scenario === "stale-binding") review.binding.productOid = "0".repeat(40);
    else if (scenario === "reported-impacts") {
      const build = JSON.parse(await readFile(path.join(original.producers[0].output, "source-build.json"), "utf8"));
      const file = build.ledger.files.find(file => file.role === "compiler-payload");
      const subject = { phase: "source", source: file.projectId, sourceIdentity: file.forkOid,
        path: file.path, sha256: file.sha256, role: file.role, consumer: file.consumer };
      review.records = ["unknown", "exploitable", "trust-integrity", "not-applicable", "exception-required"].map(impact => ({
        id: `acceptance-mutation:${impact}`, subject, impact,
        reachability: impact === "not-applicable" ? "unreachable" : "reachable",
        basis: "Deliberate test-only review mutation against a real dependency; not a real vulnerability allegation or user approval.",
        owner: "acceptance test", deadline: "2099-01-01", reviewPoint: "Never use this mutated review as actual intake evidence.",
      }));
    } else review.coverage = review.coverage.filter(item => item.phase !== scenario);
    const reviewPath = path.join(root, "test-only-review.json"), report = path.join(root, "report.json"), output = path.join(root, "out");
    await writeFile(reviewPath, fixtureJson(review));
    const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
      "--target", "windows-x86_64-msvc", "--profile", "debug",
      "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
      "--producer-a", original.producers[0].output, "--producer-b", original.producers[1].output,
      "--cache", process.env.TSFG_TEST_GO_CACHE,
      "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
      "--intake-review", reviewPath, "--out", output, "--report", report],
    { encoding: "utf8", timeout: 1200000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    assert.equal(child.status, 23, `${scenario}: ${child.stdout}${child.stderr}`);
    const evidence = JSON.parse(await readFile(report, "utf8")).error.issues[0].evidence;
    assert.equal(evidence.intakeComplete, false);
    if (scenario === "reported-impacts") {
      assert.equal(evidence.risks.decision, "blocked");
      assert.deepEqual(evidence.risks.records.map(record => record.decision),
        ["pending-verification", "blocked", "blocked", "not-applicable", "blocked"]);
      assert.ok(evidence.risks.records.every(record => record.approval === null));
      assert.ok(evidence.risks.dependencies.some(file => file.riskIds.length === 5 && file.impactReview === "reported-impact"));
    } else {
      assert.equal(evidence.risks.decision, "pending-verification");
      if (scenario === "stale-binding") assert.match(evidence.risks.reasons.join("; "), /binding differs/);
      else assert.equal(evidence.risks.coverage.find(item => item.phase === scenario).status, "missing");
    }
    await assert.rejects(stat(output), { code: "ENOENT" });
  });
}

test("source intake refuses governance risk fixtures before consuming real evidence", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "source-intake-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const review = path.join(root, "review.json"), output = path.join(root, "out");
  await writeFile(review, fixtureJson({ schemaVersion: "1", evidenceKind: "fixture", records: [] }));
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--intake-review", review, "--out", output], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 2, child.stderr);
  assert.match(child.stderr, /intake review requires real-source evidence/i);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("source intake requires exact binding and reviewed dependency coverage", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "source-intake-binding-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const review = path.join(root, "review.json");
  await writeFile(review, fixtureJson({ schemaVersion: "1", evidenceKind: "real-source", records: [] }));
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--intake-review", review], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 2, child.stderr);
  assert.match(child.stderr, /intake review requires exact binding and dependency coverage/i);
});

// Deliberately corrupted copies can remain internally consistent so the public
// entry must check the independent oracle/current identity, not only checksums.
async function refreshFixtureAttestation(producer) {
  const file = path.join(producer, "producer-attestation.json");
  const attestation = JSON.parse(await readFile(file, "utf8"));
  const build = JSON.parse(await readFile(path.join(producer, "source-build.json"), "utf8"));
  attestation.buildIdentityDigest = build.buildIdentity.digest;
  for (const member of attestation.members) member.sha256 = fixtureHash(await readFile(path.join(producer, member.path)));
  await writeFile(file, fixtureJson(attestation));
}

test("source intake refuses failed or unrun consumption audits despite matching file bytes", {
  skip: process.env.TSFG_TEST_SOURCE_INTAKE_AUDITS !== "1" ? "requires actual source producers and a bound review" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  for (const scenario of ["failed-tool-audit", "unrun-test-audit", "fixture-source-audit"]) {
    const root = path.join(process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE, scenario), producer = path.join(root, "a");
    await cp(original.producers[0].output, producer, { recursive: true, errorOnExist: true, force: false });
    const buildPath = path.join(producer, "source-build.json"), build = JSON.parse(await readFile(buildPath, "utf8"));
    if (scenario === "failed-tool-audit") build.toolchainInputs.status = "failed";
    if (scenario === "unrun-test-audit") {
      build.requiredTests.intakeLedger.status = "not-run";
      await writeFile(path.join(producer, "required-tests.json"), fixtureJson(build.requiredTests));
    }
    if (scenario === "fixture-source-audit") {
      build.ledger.evidenceKind = "fixture";
      await writeFile(path.join(producer, "intake-ledger.json"), fixtureJson(build.ledger));
    }
    await writeFile(buildPath, fixtureJson(build));
    await refreshFixtureAttestation(producer);
    const output = path.join(root, "out"), report = path.join(root, "report.json");
    const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
      "--target", "windows-x86_64-msvc", "--profile", "debug",
      "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
      "--producer-a", producer, "--producer-b", original.producers[1].output,
      "--cache", process.env.TSFG_TEST_GO_CACHE,
      "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
      "--intake-review", process.env.TSFG_TEST_INTAKE_REVIEW, "--out", output, "--report", report],
    { encoding: "utf8", timeout: 1200000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    assert.equal(child.status, 23, `${scenario}: ${child.stdout}${child.stderr}`);
    const failure = JSON.parse(await readFile(report, "utf8")).error.issues[0];
    assert.match(failure.message, /consumption audit/i);
    assert.equal(failure.evidence.intakeComplete, false);
    assert.equal(failure.evidence.producers[0].validation.evidenceState,
      scenario === "unrun-test-audit" ? "not-run" : "failed");
    await assert.rejects(stat(output), { code: "ENOENT" });
  }
});

test("source repro-check rejects missing and damaged attested members", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_DAMAGE !== "1" ? "requires real producers for evidence damage checks" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const missingMembers = process.env.TSFG_TEST_SOURCE_REPRO_ALL_MEMBERS === "1"
    ? ["artifact-manifest.json", "ast.json", "build-metadata.json", "generation.json", "go-list.jsonstream",
      "intake-ledger.json", "js-isolation.json", "probes.json", "required-test-events.jsonstream",
      "required-tests.json", "source-build.json", "tsfg-ast.exe", "producer-attestation.json"].map(name => `missing-${name}`)
    : ["missing-attestation"];
  for (const damage of [...missingMembers, "damaged-generation", "damaged-payload"]) {
    const root = path.join(process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE, damage), producer = path.join(root, "a");
    await cp(original.producers[0].output, producer, { recursive: true, errorOnExist: true, force: false });
    if (damage.startsWith("missing-")) await rm(path.join(producer,
      damage === "missing-attestation" ? "producer-attestation.json" : damage.slice("missing-".length)));
    else {
      const file = path.join(producer, damage === "damaged-generation" ? "generation.json" : "tsfg-ast.exe");
      await writeFile(file, Buffer.concat([await readFile(file), Buffer.from("deliberate-corruption")]));
    }
    const output = path.join(root, "out"), report = path.join(root, "report.json");
    const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
      "--target", "windows-x86_64-msvc", "--profile", "debug",
      "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
      "--producer-a", producer, "--producer-b", original.producers[1].output,
      "--cache", process.env.TSFG_TEST_GO_CACHE,
      "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
      "--out", output, "--report", report], { encoding: "utf8", timeout: 1200000, windowsHide: true });
    assert.equal(child.status, 23, `${damage}: ${child.stdout}${child.stderr}`);
    const evidence = JSON.parse(await readFile(report, "utf8")).error.issues[0].evidence;
    assert.equal(evidence.producers[0].validation.status, "failed");
    assert.equal(evidence.producers[1].validation.status, "not-run");
    assert.equal(evidence.producers[0].validation.evidenceState, damage.startsWith("missing-") ? "missing" : "failed");
    assert.equal(evidence.producers[1].validation.evidenceState, "not-run");
    await assert.rejects(stat(output), { code: "ENOENT" });
  }
});

test("source build refuses an old generation receipt after actual control input perturbation", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_PERTURB !== "1" ? "requires an isolated verified source checkout and current replay receipt" : false,
}, async () => {
  const product = path.join(process.env.TSFG_TEST_REPRO_A, "tsfg");
  const input = path.join(product, "eng/typescript-ast-inputs.mjs"), before = await readFile(input);
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE, output = path.join(root, "out"), report = path.join(root, "report.json");
  try {
    await writeFile(input, Buffer.concat([before, Buffer.from("\n// Deliberate ticket08 applicability perturbation.\n")]));
    const child = spawnSync(process.execPath, [path.join(product, "eng/tsfg-build.mjs"), "build", "--dev",
      "--source-target", "typescript-ast", "--generation", "reuse", "--workspace", product,
      "--intake-plan", path.join(product, "eng/intake-declarations/typescript-ast.json"),
      "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", output, "--report", report],
    { env: { ...process.env, TSFG_RUNTIME_LOCK: path.join(product, "eng/go-ast-toolchains.lock.json"),
      TSFG_RUNTIME_CACHE: process.env.TSFG_TEST_GO_CACHE, TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" },
      encoding: "utf8", timeout: 1200000, windowsHide: true });
    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    const result = JSON.parse(await readFile(report, "utf8"));
    assert.match(result.error.issues[0].message, /generation receipt does not match current inputs/i);
    assert.equal(result.error.issues[0].generation.mode, "reuse-refused");
    await assert.rejects(stat(output), { code: "ENOENT" });
  } finally {
    await writeFile(input, before);
    assert.ok((await readFile(input)).equals(before));
  }
});

test("source repro-check reconstructs current inputs instead of trusting a self-consistent omission", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_INPUTS !== "1" ? "requires real producers for deliberate incomplete input identity" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  for (const [index, label] of ["a", "b"].entries()) {
    const producer = path.join(root, label);
    await cp(original.producers[index].output, producer, { recursive: true, errorOnExist: true, force: false });
    const build = JSON.parse(await readFile(path.join(producer, "source-build.json"), "utf8"));
    const inputs = { schemaVersion: "1", entries: build.buildInputSet.entries.slice(1) };
    build.buildInputSet = { ...inputs, digest: fixtureHash(fixtureJson(inputs)) };
    const { digest, ...identity } = build.buildIdentity;
    identity.buildInputSetDigest = build.buildInputSet.digest;
    build.buildIdentity = { ...identity, digest: fixtureHash(fixtureJson(identity)) };
    const { digest: oldBinding, ...binding } = build.generation.binding;
    binding.buildInputSetDigest = build.buildInputSet.digest;
    build.generation.binding = { ...binding, digest: fixtureHash(fixtureJson(binding)) };
    await writeFile(path.join(producer, "generation.json"), fixtureJson(build.generation));
    await writeFile(path.join(producer, "source-build.json"), fixtureJson(build));
    const metadata = JSON.parse(await readFile(path.join(producer, "build-metadata.json"), "utf8"));
    metadata.buildIdentity = build.buildIdentity;
    await writeFile(path.join(producer, "build-metadata.json"), fixtureJson(metadata));
    const manifest = JSON.parse(await readFile(path.join(producer, "artifact-manifest.json"), "utf8"));
    manifest.buildIdentity = build.buildIdentity;
    manifest.buildInputSet = build.buildInputSet;
    for (const member of manifest.members) member.sha256 = fixtureHash(await readFile(path.join(producer, member.path)));
    await writeFile(path.join(producer, "artifact-manifest.json"), fixtureJson(manifest));
    await refreshFixtureAttestation(producer);
  }
  const output = path.join(root, "out"), report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", path.join(root, "a"), "--producer-b", path.join(root, "b"),
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
    "--out", output, "--report", report], { encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 23, child.stdout + child.stderr);
  assert.match(JSON.parse(await readFile(report, "utf8")).error.issues[0].message, /current.*input|current.*identity/i);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("source repro-check rejects undeclared host and wall-clock metadata even when equal", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_METADATA !== "1" ? "requires real producers for deliberate metadata corruption" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  const undeclared = { host: process.env.COMPUTERNAME ?? "deliberate-host", ciRun: "deliberate-ci-run", wallClock: new Date().toISOString() };
  for (const [index, label] of ["a", "b"].entries()) {
    const producer = path.join(root, label);
    await cp(original.producers[index].output, producer, { recursive: true, errorOnExist: true, force: false });
    const metadata = JSON.parse(await readFile(path.join(producer, "build-metadata.json"), "utf8"));
    metadata.undeclared = undeclared;
    await writeFile(path.join(producer, "build-metadata.json"), fixtureJson(metadata));
    const manifest = JSON.parse(await readFile(path.join(producer, "artifact-manifest.json"), "utf8"));
    for (const member of manifest.members) member.sha256 = fixtureHash(await readFile(path.join(producer, member.path)));
    await writeFile(path.join(producer, "artifact-manifest.json"), fixtureJson(manifest));
    await refreshFixtureAttestation(producer);
  }
  const output = path.join(root, "out"), report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", path.join(root, "a"), "--producer-b", path.join(root, "b"),
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
    "--out", output, "--report", report], { encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 23, child.stdout + child.stderr);
  assert.match(JSON.parse(await readFile(report, "utf8")).error.issues[0].message, /metadata.*recipe|metadata.*declaration/i);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("source repro-check distinguishes missing producer evidence from an unrun second producer", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_MISSING !== "1" ? "requires verified real source workspaces" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  const output = path.join(root, "out"), report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", path.join(root, "missing"), "--producer-b", original.producers[1].output,
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
    "--out", output, "--report", report], { encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 23, child.stdout + child.stderr);
  const evidence = JSON.parse(await readFile(report, "utf8")).error.issues[0].evidence;
  assert.equal(evidence.producers.length, 2);
  assert.equal(evidence.producers[0].validation.status, "failed");
  assert.equal(evidence.producers[1].validation.status, "not-run");
  assert.equal(evidence.producers[1].build.status, "not-run");
  assert.equal(evidence.producers[1].stages.generation, "not-run");
  assert.equal(evidence.reproducibility.bytes.status, "not-run");
  assert.equal(evidence.reproducibility.semantics.status, "not-run");
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("source repro-check keeps the Build Report outside its comparison output", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "source-repro-report-overlap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, "out"), report = path.join(output, "comparison.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--workspace-a", path.join(root, "a"), "--workspace-b", path.join(root, "b"),
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", output, "--report", report],
  { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 2, child.stderr);
  assert.match(child.stderr, /report.*outside.*output/i);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("source repro-check withdraws success output when its Build Report cannot publish", {
  skip: process.env.TSFG_TEST_SOURCE_REPRO_REPORT_FAILURE !== "1" ? "requires real valid producers and a blocked report destination" : false,
}, async () => {
  const original = JSON.parse(await readFile(process.env.TSFG_TEST_REPRO_ORIGINAL, "utf8")).result;
  const root = process.env.TSFG_TEST_SOURCE_REPRO_EVIDENCE;
  const output = path.join(root, "out"), report = path.join(root, "blocked-report");
  await mkdir(report, { recursive: true });
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", original.producers[0].output, "--producer-b", original.producers[1].output,
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
    "--out", output, "--report", report], { encoding: "utf8", timeout: 1200000, windowsHide: true });
  assert.equal(child.status, 30, child.stdout + child.stderr);
  assert.match(child.stderr, /report/i);
  await assert.rejects(stat(output), { code: "ENOENT" });
  assert.equal((await stat(report)).isDirectory(), true);
});

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
    await refreshFixtureAttestation(producer);
  }
  const output = path.join(root, "out"), report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", path.join(root, "a"), "--producer-b", path.join(root, "b"),
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
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
    await refreshFixtureAttestation(producer);
  }
  const output = path.join(root, "out"), report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", path.join(root, "a"), "--producer-b", path.join(root, "b"),
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
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
    const corrupt = observation => {
      if (process.env.TSFG_TEST_SOURCE_REPRO_AST_CONTENT === "1") {
        observation.statements = [];
        observation.identifiers = ["wrong"];
        observation.parseDiagnosticCount = 99;
      } else observation.kind = "DeliberatelyWrongSourceFile";
    };
    corrupt(build.ast);
    if (process.env.TSFG_TEST_SOURCE_REPRO_AST_ONLY !== "1") corrupt(build.probes.cases[0].observation);
    const ast = fixtureJson(build.ast), probes = fixtureJson(build.probes);
    build.observationSha256 = fixtureHash(ast);
    build.probeObservationSha256 = fixtureHash(probes);
    await writeFile(path.join(producer, "ast.json"), ast);
    await writeFile(path.join(producer, "probes.json"), probes);
    await writeFile(path.join(producer, "source-build.json"), fixtureJson(build));
    const manifest = JSON.parse(await readFile(path.join(producer, "artifact-manifest.json"), "utf8"));
    for (const member of manifest.members) member.sha256 = fixtureHash(await readFile(path.join(producer, member.path)));
    await writeFile(path.join(producer, "artifact-manifest.json"), fixtureJson(manifest));
    await refreshFixtureAttestation(producer);
  }
  const output = path.join(root, "out"), report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace-a", original.producers[0].workspaceRoot, "--workspace-b", original.producers[1].workspaceRoot,
    "--producer-a", path.join(root, "a"), "--producer-b", path.join(root, "b"),
    "--cache", process.env.TSFG_TEST_GO_CACHE,
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
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

test("source build declares complete payload and identity-bound execution evidence", {
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
  for (const name of ["contracts/registry.json", "eng/upgrade-review.mjs", "eng/intake-declarations/typescript-ast-toolchain.json",
    "eng/probes/typescript.json", "eng/probes/syntax-error.ts",
    "eng/probes/type-error.ts", "eng/probes/js-isolation.json", "LICENSE"]) {
    assert.ok(manifest.buildInputSet.entries.some(input => input.projectId === "tsfg"
      && input.repositoryRelativePath === name), `missing consumed Build Input: ${name}`);
  }
  const report = JSON.parse(await readFile(path.join(root, "build.json"), "utf8")).result;
  assert.deepEqual(manifest.buildIdentity, report.buildIdentity);
  assert.equal(report.execution.cachesInitiallyEmpty, true);
  assert.equal(report.execution.nativeExitCode, 0);
  assert.equal(report.execution.build.sourceDateEpoch, report.buildIdentity.source_date_epoch);
  const attestation = JSON.parse(await readFile(path.join(root, "producer/producer-attestation.json"), "utf8"));
  assert.equal(attestation.buildIdentityDigest, report.buildIdentity.digest);
  assert.deepEqual(attestation.members.map(member => member.path), ["artifact-manifest.json", "ast.json", "build-metadata.json",
    "generation.json", "go-list.jsonstream", "intake-ledger.json", "js-isolation.json", "probes.json",
    "required-test-events.jsonstream", "required-tests.json", "source-build.json", "tsfg-ast.exe"]);
  for (const member of attestation.members) assert.equal(member.sha256,
    fixtureHash(await readFile(path.join(root, "producer", member.path))), `unbound source producer member: ${member.path}`);
});

test("source repro-check rejects paths without verified integration metadata", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "source-repro-workspace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [entry, "repro-check", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--workspace-a", path.join(root, "a"),
    "--workspace-b", path.join(root, "b"), "--out", path.join(root, "out"),
    "--manifest-revision", "a".repeat(40), "--manifest", manifestName],
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
    "--manifest-revision", process.env.TSFG_TEST_REPRO_MANIFEST, "--manifest", manifestName,
    "--out", path.join(root, "comparison"), "--report", path.join(root, "report.json")],
  { env: { ...process.env, TSFG_RUNTIME_LOCK: undefined, TSFG_RUNTIME_CACHE: undefined, TSFG_RUNTIME_PLATFORM: undefined },
    encoding: "utf8", timeout: 3600000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(await readFile(path.join(root, "report.json"), "utf8")).result;
  assert.equal(result.reproducibility.bytes.status, "passed");
  assert.equal(result.reproducibility.semantics.status, "passed");
  assert.equal(result.isolation, "not-enforced");
  const productRoot = path.join(process.env.TSFG_TEST_REPRO_A, "tsfg");
  const registry = JSON.parse(await readFile(path.join(productRoot, "contracts/registry.json"), "utf8"));
  const contractSetId = fixtureHash(fixtureJson(await verifiedContractSet(productRoot, registry, fixtureJson)));
  for (const producer of result.producers) {
    const manifest = JSON.parse(await readFile(path.join(producer.output, "artifact-manifest.json"), "utf8"));
    assert.equal(manifest.contractSetId, contractSetId);
  }
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
    "--manifest-revision", original.producers[0].workspace.manifest.revision, "--manifest", manifestName,
    "--out", path.join(root, "comparison"), "--report", path.join(root, "report.json")],
  { encoding: "utf8", timeout: 1200000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(await readFile(path.join(root, "report.json"), "utf8")).result;
  assert.equal(result.operation, "compare-existing");
  assert.ok(result.producers.every(producer => producer.command === null && producer.build.mode === "recorded"));
  assert.equal(result.reproducibility.bytes.status, "passed");
  assert.equal(result.reproducibility.semantics.status, "passed");
});
