// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";
import { requireRealIntakeEvidence } from "../../eng/intake-ledger.mjs";

const entry = fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url));
const sha = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const manifestUrl = "https://github.com/xuelongling/manifests.git";
const projectId = "TypeScript.git";
const required = ["semantics", "diagnostics", "license", "generation", "reproducibility", "jsIsolation"];
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
function git(cwd, ...args) {
  const r = spawnSync(TEST_GIT_EXECUTABLE, args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
async function put(root, name, value) {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), value);
}
async function init(root) {
  await mkdir(root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.name", "Upgrade governance fixture");
  git(root, "config", "user.email", "upgrade@tsfg.invalid");
  git(root, "config", "core.autocrlf", "false");
}
function commit(root, message) {
  git(root, "add", "."); git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD");
}
async function fixture(t, sourceId = projectId, role = "compiler-payload") {
  const projectId = sourceId;
  const canonicalUrl = `https://github.com/${sourceId === "TypeScript.git" ? "microsoft" : "fixture-upstream"}/${sourceId}`;
  const root = await mkdtemp(path.join(tmpdir(), "upgrade-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); });
  const oldRoot = path.join(root, "accepted"), newRoot = path.join(root, "candidate");
  const source = path.join(newRoot, "typescript");
  await init(source);
  git(source, "remote", "add", "origin", `https://github.com/xuelongling/${projectId}`);
  for (const [name, bytes] of Object.entries({ ".gitattributes": "* -text\n", LICENSE: "Apache License 2.0\n", NOTICE: "Original notice\n", "src/parser.ts": "export const upstream = 1;\n" })) await put(source, name, bytes);
  const baseOid = commit(source, "upstream baseline fixture");
  git(source, "checkout", "-qb", "tsfg-accepted");
  await put(source, "src/local.ts", "export const localChange = true;\n");
  const provenance = (oid, branch) => `canonical_url = "${canonicalUrl}"\nbase_oid = "${oid}"\nlicense = "Apache-2.0"\nsync_branch = "refs/heads/${branch}"\nlocal_changes = "preserve local parser policy"\n`;
  await put(source, "UPSTREAM.toml", provenance(baseOid, "tsfg-accepted"));
  const acceptedOid = commit(source, "accepted local policy");
  git(source, "tag", "accepted-fixture", acceptedOid);
  await mkdir(oldRoot, { recursive: true });
  git(source, "worktree", "add", "--detach", path.join(oldRoot, "typescript"), acceptedOid);
  git(source, "checkout", "-qb", "upstream-patch", baseOid);
  await put(source, "src/parser.ts", "export const upstream = 2;\n");
  const upstreamOid = commit(source, "upstream patch fixture");
  git(source, "checkout", "-qb", "tsfg-candidate", acceptedOid);
  git(source, "merge", "--no-ff", "--no-edit", upstreamOid);
  const mergeOid = git(source, "rev-parse", "HEAD");
  await put(source, "UPSTREAM.toml", provenance(upstreamOid, "tsfg-candidate"));
  const candidateOid = commit(source, "candidate provenance");
  const manifests = path.join(root, "manifests");
  await init(manifests);
  git(manifests, "remote", "add", "origin", manifestUrl);
  const snapshots = [];
  for (const [workspaceRoot, forkOid, upstream, branch, version] of [[oldRoot, acceptedOid, baseOid, "tsfg-accepted", "0.2.0"], [newRoot, candidateOid, upstreamOid, "tsfg-candidate", "0.2.1"]]) {
    const fork = path.join(workspaceRoot, "typescript");
    const admission = { schemaVersion: "2", sources: [{ projectId, path: "typescript", remoteUrl: `https://github.com/xuelongling/${projectId}`, canonicalUrl, baseOid: upstream, forkOid, branch: `refs/heads/${branch}`, license: "Apache-2.0", legal: { license: "LICENSE", notice: "NOTICE", copyright: "LICENSE" }, files: git(fork, "ls-files").split("\n").map(name => ({ path: name, contentKind: "text", sha256: sha(spawnSync(TEST_GIT_EXECUTABLE, ["show", `${forkOid}:${name}`], { cwd: fork }).stdout) })) }] };
    const declaration = { schemaVersion: "1", evidenceKind: "fixture", sources: [{ projectId, baseOid: upstream, forkOid, excludedReason: "unconsumed fixture metadata", entries: ["src/parser.ts", "src/local.ts"].map(name => ({ path: name, role, consumer: role === "game-runtime" ? "fixture-game-runtime" : "fixture-parser", affectsPayload: true, localModification: name.includes("local") ? "local parser policy" : null, licenseException: null })) }], attributions: [] };
    const consumption = { schemaVersion: "1", evidenceKind: "fixture", entries: declaration.sources[0].entries.map(e => ({ projectId, path: e.path, role: e.role, consumer: e.consumer })) };
    const product = path.join(workspaceRoot, "tsfg");
    await init(product);
    await put(product, "eng/source-admissions.json", JSON.stringify(admission));
    const productOid = commit(product, "fixture approval");
    const manifest = `candidates/tsfg-v${version}.xml`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest>\n<remote name="github-xuelongling" fetch="https://github.com/xuelongling/" />\n<project name="tsfg.git" path="tsfg" remote="github-xuelongling" revision="${productOid}" upstream="refs/heads/main" />\n<project name="${projectId}" path="typescript" remote="github-xuelongling" revision="${forkOid}" upstream="refs/heads/${branch}" />\n<project name=".agents.git" path=".agents" remote="github-xuelongling" revision="${productOid}" upstream="refs/heads/main"><linkfile src="AGENTS.md" dest="AGENTS.md" /><linkfile src="codex/config.toml" dest=".codex/config.toml" /><linkfile src="codex/hooks.json" dest=".codex/hooks.json" /></project>\n</manifest>\n`;
    if (!snapshots.length) await put(manifests, "bootstrap/r00.xml", xml.replace(/<project name="[^"]+" path="typescript"[^\n]+\n/, ""));
    await put(manifests, manifest, xml);
    await put(manifests, `${manifest}.sources.json`, JSON.stringify(admission));
    const manifestRevision = commit(manifests, `fixture combination ${version}`);
    snapshots.push({ workspaceRoot, manifestRevision, manifest, declaration, consumption, languageBaseline: "7.0.2", engineeringContract: "fixture-fixed-contract", generationDependencies: [], performanceClaim: null,
      evidence: Object.fromEntries([...required, "performance"].map(name => [name, { status: name === "performance" ? "not-applicable" : "passed", reason: name === "performance" ? "No performance claim" : "Given governance fixture result", subject: { forkOid, manifestRevision }, reference: `fixture:${name}` }])) });
  }
  for (const snapshot of snapshots) {
    const inputs = Object.fromEntries(["declaration", "consumption", "languageBaseline", "engineeringContract", "generationDependencies", "performanceClaim"].map(key => [key, snapshot[key]]));
    for (const evidence of Object.values(snapshot.evidence)) evidence.subject.reviewInputsSha256 = sha(canonical(inputs));
  }
  /** @type {any} */
  const plan = { schemaVersion: "1", evidenceKind: "governance-fixture", action: "review", projectId, manifestRepository: manifests, accepted: snapshots[0], candidate: snapshots[1], mergeOid,
    risks: fixtureRiskReview({ accepted: snapshots[0], candidate: snapshots[1] }) };
  let runs = 0;
  async function run() {
    const folder = path.join(root, `run-${++runs}`); await mkdir(folder);
    const planFile = path.join(folder, "plan.json"), reportFile = path.join(folder, "report.json");
    await writeFile(planFile, JSON.stringify(plan));
    const env = { ...process.env, TSFG_GIT: TEST_GIT_EXECUTABLE };
    for (const key of Object.keys(env)) if (/^TSFG_(RUNTIME|WINDOWS)_/.test(key)) delete env[key];
    const r = spawnSync(process.execPath, [entry, "build", "--dev", "--source-target", "upgrade-review", "--workspace", path.join(newRoot, "tsfg"), "--upgrade-plan", planFile, "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", path.join(folder, "out"), "--report", reportFile], { env, encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.ifError(r.error);
    return { status: r.status, text: r.stderr, report: JSON.parse(await readFile(reportFile, "utf8")), folder };
  }
  return { root, source, manifests, acceptedOid, candidateOid, upstreamOid, plan, run };
}

async function archiveFixture(f, result, name) {
  if (!process.env.TSFG_UPGRADE_EVIDENCE) return;
  const destination = path.join(process.env.TSFG_UPGRADE_EVIDENCE, name);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "build-report.json"), JSON.stringify(result.report, null, 2));
  await writeFile(path.join(destination, "plan.json"), JSON.stringify(f.plan));
  for (const [label, repository] of [["source", f.source], ["manifests", f.manifests],
    ["accepted-product", path.join(f.plan.accepted.workspaceRoot, "tsfg")], ["candidate-product", path.join(f.plan.candidate.workspaceRoot, "tsfg")]]) {
    git(repository, "bundle", "create", path.join(destination, `${label}.bundle`), "--all");
  }
}

test("upgrade review uses exact merged Git history and retains the accepted combination", async t => {
  const f = await fixture(t);
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  const result = r.report.result;
  assert.equal(result.decision, "admitted-fixture");
  assert.equal(result.intakeComplete, false);
  assert.equal(result.promotionState, "Candidate");
  assert.throws(() => requireRealIntakeEvidence(result), /cannot prove real intake/);
  assert.equal(result.sources.accepted.forkOid, f.acceptedOid);
  assert.equal(result.sources.candidate.baseOid, f.upstreamOid);
  assert.match(result.diff.patch, /export const upstream = 2/);
  assert.match(result.localModifications.candidate.patch, /localChange = true/);
  assert.equal(git(f.source, "rev-parse", "accepted-fixture"), f.acceptedOid);
  await archiveFixture(f, r, "admitted");
});

test("patch review distinguishes missing, failed, not-run and inapplicable required evidence", async t => {
  const f = await fixture(t);
  const original = structuredClone(f.plan.candidate.evidence);
  for (const category of required) for (const status of ["missing", "failed", "not-run", "not-applicable"]) {
    f.plan.candidate.evidence = structuredClone(original);
    if (status === "missing") delete f.plan.candidate.evidence[category];
    else f.plan.candidate.evidence[category].status = status;
    const r = await f.run();
    assert.equal(r.status, 0, r.text);
    assert.equal(r.report.result.decision, "rejected");
    assert.equal(r.report.result.evidence.candidate[category].status, status);
    assert.ok(r.report.result.reasons.some(reason => reason.includes(category)));
    const stored = JSON.parse(await readFile(path.join(r.folder, "out/upgrade-review.json"), "utf8"));
    assert.equal(stored.decision, "rejected");
    assert.equal(stored.replay.plan.candidate.manifestRevision, f.plan.candidate.manifestRevision);
  }
  assert.equal(git(f.source, "rev-parse", "accepted-fixture"), f.acceptedOid);
});

test("review binds evidence to the candidate and preserves language and engineering commitments", async t => {
  const f = await fixture(t);
  const saved = structuredClone(f.plan.candidate);
  for (const mutate of [
    s => { s.languageBaseline = "7.0.3"; },
    s => { s.engineeringContract = "changed-contract"; },
    s => { s.evidence.semantics.subject.forkOid = f.acceptedOid; },
    s => { s.evidence.diagnostics.subject.manifestRevision = f.plan.accepted.manifestRevision; },
    s => { s.performanceClaim = { description: "faster parser", criterion: "maintainer-defined criterion" }; },
  ]) {
    f.plan.candidate = structuredClone(saved); mutate(f.plan.candidate);
    const r = await f.run();
    assert.equal(r.status, 0, r.text);
    assert.equal(r.report.result.decision, "rejected");
  }
  f.plan.candidate = saved;
  const r = await f.run();
  assert.equal(r.report.result.decision, "admitted-fixture");
  assert.deepEqual(r.report.result.affectedConsumers, ["fixture-parser"]);
  assert.deepEqual(r.report.result.generationDependencies, { accepted: [], candidate: [] });
  assert.equal(r.report.result.performance.candidate.claim, null);
  assert.equal(r.report.result.baseline.candidate.language, "7.0.2");
});

test("rollback appends a replayable combination pointing to verified accepted identities", async t => {
  const f = await fixture(t);
  f.plan.candidate.evidence.semantics.status = "failed";
  const rejection = await f.run();
  assert.equal(rejection.report.result.decision, "rejected");
  const old = f.plan.accepted;
  const manifest = "candidates/tsfg-v0.2.2.xml";
  for (const suffix of ["", ".sources.json"]) await put(f.manifests, manifest + suffix, git(f.manifests, "show", `${old.manifestRevision}:${old.manifest}${suffix}`) + "\n");
  const revision = commit(f.manifests, "append rollback to verified fixture combination");
  f.plan.action = "rollback";
  f.plan.rollback = { manifest, manifestRevision: revision, reason: "candidate semantics failed" };
  const result = await f.run();
  assert.equal(result.status, 0, result.text);
  assert.equal(result.report.result.decision, "rollback-fixture");
  assert.equal(result.report.result.rollback.revision, revision);
  assert.equal(result.report.result.rollback.target.revision, old.manifestRevision);
  assert.equal(result.report.result.rollback.projects.find(p => p.id === projectId).revision, f.acceptedOid);
  await archiveFixture(f, result, "rollback");
  if (process.env.TSFG_MANIFEST_CI) {
    const gate = spawnSync(process.execPath, [process.env.TSFG_MANIFEST_CI, "gate", "--repository", f.manifests,
      "--base", f.plan.candidate.manifestRevision, "--head", revision, "--upgrade-review-report", path.join(result.folder, "report.json"),
      "--out", path.join(f.root, "rollback-gate")], { encoding: "utf8", env: process.env, windowsHide: true });
    assert.equal(gate.status, 0, gate.stderr);
    assert.equal(JSON.parse(await readFile(path.join(f.root, "rollback-gate/upgrade-governance.json"), "utf8")).decision, "rollback-fixture");
  }
  const replay = await f.run();
  assert.deepEqual(replay.report.result, result.report.result);
  const savedCandidate = structuredClone(f.plan.candidate);
  for (const { label, mutate, reason } of [
    { label: "language", mutate: s => { s.languageBaseline = "7.0.3"; }, reason: /language baseline/ },
    { label: "engineering", mutate: s => { s.engineeringContract = "changed-contract"; }, reason: /engineering commitments/ },
    { label: "generation", mutate: s => { s.generationDependencies = [{ projectId, path: "missing-generator.ts", sha256: sha("missing") }]; }, reason: /generation dependency/ },
  ]) {
    f.plan.candidate = structuredClone(savedCandidate);
    mutate(f.plan.candidate);
    const recovery = await f.run();
    assert.equal(recovery.status, 0, recovery.text);
    assert.equal(recovery.report.result.decision, "rollback-fixture", label);
    assert.equal(recovery.report.result.candidateDecision, "rejected");
    assert.match(recovery.report.result.reasons.join(" "), reason);
    assert.deepEqual(recovery.report.result.rollback, result.report.result.rollback);
    if (process.env.TSFG_MANIFEST_CI) {
      const gate = spawnSync(process.execPath, [process.env.TSFG_MANIFEST_CI, "gate", "--repository", f.manifests,
        "--base", f.plan.candidate.manifestRevision, "--head", revision, "--upgrade-review-report", path.join(recovery.folder, "report.json"),
        "--out", path.join(f.root, `rollback-${label}-gate`)], { encoding: "utf8", env: process.env, windowsHide: true });
      assert.equal(gate.status, 0, gate.stderr);
    }
  }
  f.plan.candidate = savedCandidate;
  assert.equal(git(f.source, "rev-parse", "accepted-fixture"), f.acceptedOid);
  assert.equal(git(f.source, "rev-parse", "tsfg-candidate"), f.candidateOid);
  f.plan.accepted.evidence.reproducibility.status = "not-run";
  const refused = await f.run();
  assert.equal(refused.report.result.decision, "rejected");
});

test("changing declared consumers cannot reuse evidence for the same Git combination", async t => {
  const f = await fixture(t);
  f.plan.candidate.declaration.sources[0].entries[0].consumer = "different-consumer";
  f.plan.candidate.consumption.entries[0].consumer = "different-consumer";
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.decision, "rejected");
  assert.match(r.report.result.reasons.join(" "), /bound evidence/);
});

test("manifest gate consumes the exact review and refuses rejected, stale or promoted fixtures", { skip: !process.env.TSFG_MANIFEST_CI }, async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f, "exception-required");
  f.plan.risks = fixtureRiskReview(f.plan, [risk], [fixtureApproval(f, risk)]);
  const reviewed = await f.run();
  assert.equal(reviewed.status, 0, reviewed.text);
  const reviewPath = path.join(f.root, "review-for-manifest.json");
  let number = 0;
  const gate = async report => {
    await writeFile(reviewPath, JSON.stringify(report));
    const output = path.join(f.root, `gate-${++number}`);
    const r = spawnSync(process.execPath, [process.env.TSFG_MANIFEST_CI, "gate", "--repository", f.manifests,
      "--base", f.plan.accepted.manifestRevision, "--head", f.plan.candidate.manifestRevision,
      "--upgrade-review-report", reviewPath, "--out", output], { encoding: "utf8", env: process.env, windowsHide: true });
    return { status: r.status, text: r.stderr, output };
  };
  const admitted = await gate(reviewed.report);
  assert.equal(admitted.status, 0, admitted.text);
  const receipt = JSON.parse(await readFile(path.join(admitted.output, "upgrade-governance.json"), "utf8"));
  assert.equal(receipt.evidenceKind, "governance-fixture");
  assert.equal(receipt.intakeComplete, false);
  for (const mutate of [
    r => { r.result.risks.candidate.records[0].approval = null; },
    r => {
      r.result.risks.candidate.records[0].impact = "unknown";
      r.result.replay.plan.risks.records[0].impact = "unknown";
    },
    r => {
      r.result.risks.candidate.records[0].subject.sha256 = "sha256:" + "0".repeat(64);
      r.result.replay.plan.risks.records[0].subject.sha256 = "sha256:" + "0".repeat(64);
      r.result.risks.candidate.records[0].decision = "unaffected-identity";
      r.result.risks.candidate.records[0].approval = null;
      r.result.risks.candidate.records[0].license = null;
    },
    r => { r.result.risks.candidate.records = []; },
    r => { r.result.schemaVersion = "1"; },
    r => { r.result.risks.candidate.coverage.reviewInputsSha256 = "sha256:" + "0".repeat(64); },
    r => { r.result.decision = "rejected"; },
    r => { r.result.integrations.candidate.revision = f.plan.accepted.manifestRevision; },
    r => { r.result.evidenceKind = "real-source"; },
    r => { r.result.promotionState = "Stable"; },
    r => { r.result.evidence.candidate.generation.status = "not-run"; },
    r => { r.result.evidence.candidate.jsIsolation.status = "failed"; },
    r => { r.result.risks.candidate.decision = "pending-verification"; },
  ]) {
    const report = structuredClone(reviewed.report); mutate(report);
    const rejected = await gate(report);
    assert.notEqual(rejected.status, 0, rejected.text);
    await assert.rejects(readFile(path.join(rejected.output, "upgrade-governance.json")), { code: "ENOENT" });
  }
});

test("Git replacement refs cannot substitute the candidate history or diff", async t => {
  const f = await fixture(t);
  git(f.source, "replace", f.candidateOid, f.acceptedOid);
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.decision, "admitted-fixture");
  assert.match(r.report.result.diff.patch, /export const upstream = 2/);
});

test("an upgrade cannot overwrite the accepted manifest record", async t => {
  const f = await fixture(t);
  await put(f.manifests, f.plan.accepted.manifest, "<manifest>overwritten</manifest>\n");
  const revision = commit(f.manifests, "attempt to overwrite accepted combination");
  f.plan.candidate.manifestRevision = revision;
  for (const evidence of Object.values(f.plan.candidate.evidence)) /** @type {any} */ (evidence).subject.manifestRevision = revision;
  const r = await f.run();
  assert.equal(r.status, 10, r.text);
  assert.match(r.report.error.issues[0].message, /preserv|accepted/i);
});

test("incomplete review inputs fail without publishing a malformed success record", async t => {
  const f = await fixture(t);
  delete f.plan.candidate.generationDependencies;
  const r = await f.run();
  assert.equal(r.status, 10, r.text);
  assert.equal(r.report.status, "failure");
  await assert.rejects(readFile(path.join(r.folder, "out/upgrade-review.json")), { code: "ENOENT" });
});

test("review rejects floating identities, fabricated merge claims and real-source markers", async t => {
  const f = await fixture(t);
  const saved = structuredClone(f.plan);
  for (const mutate of [
    p => { p.evidenceKind = "real-source"; },
    p => { p.candidate.manifestRevision = "HEAD"; },
    p => { p.mergeOid = f.candidateOid; },
    p => { p.mergeOid = "f".repeat(40); },
    p => { p.candidate.declaration.evidenceKind = "real-source"; },
  ]) {
    Object.assign(f.plan, structuredClone(saved)); mutate(f.plan);
    const r = await f.run();
    assert.equal(r.status, 10, r.text);
    assert.equal(r.report.status, "failure");
    await assert.rejects(readFile(path.join(r.folder, "out/upgrade-review.json")), { code: "ENOENT" });
  }
});

function fixtureRisk(f, impact = "exploitable", name = "candidate", filePath = "src/parser.ts") {
  const snapshot = f.plan[name];
  const entry = snapshot.declaration.sources[0].entries.find(file => file.path === filePath);
  return { id: "fixture:simulated-risk", evidenceKind: "fixture", impact,
    subject: { projectId: f.plan.projectId, forkOid: snapshot.declaration.sources[0].forkOid, path: filePath,
      sha256: sha(git(path.join(snapshot.workspaceRoot, "typescript"), "show", `HEAD:${filePath}`) + "\n"),
      role: entry.role, consumer: entry.consumer },
    reachability: "reachable", basis: "fixture: simulated reachable input; not a real vulnerability",
    owner: "fixture:maintainer", deadline: "2099-01-01", reviewPoint: "fixture:before-next-candidate" };
}

function fixtureRiskReview(plan, records = [], approvals = []) {
  return { schemaVersion: "1", evidenceKind: "fixture", records, approvals,
    coverage: [plan.accepted, plan.candidate].map(snapshot => ({ manifestRevision: snapshot.manifestRevision,
      manifest: snapshot.manifest, reviewInputsSha256: snapshot.evidence.semantics.subject.reviewInputsSha256,
      basis: "fixture: all declared consumers reviewed for this simulated scenario; no real-source assessment" })) };
}

test("candidate review blocks a simulated exploitable compiler dependency", async t => {
  const f = await fixture(t);
  f.plan.risks = fixtureRiskReview(f.plan, [fixtureRisk(f)]);
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.decision, "rejected");
  assert.equal(r.report.result.risks.candidate.decision, "blocked");
  assert.equal(r.report.result.risks.candidate.records[0].subject.consumer, "fixture-parser");
  await archiveFixture(f, r, "risk-exploitable");
});

test("unknown build-only impact stays pending even when all given tests are green", async t => {
  const f = await fixture(t, projectId, "build-only");
  f.plan.risks = fixtureRiskReview(f.plan, [fixtureRisk(f, "unknown")]);
  f.plan.risks.records[0].reachability = "unknown";
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.risks.candidate.decision, "pending-verification");
  assert.equal(r.report.result.decision, "rejected");
  assert.deepEqual(r.report.result.reasons, ["candidate.risks: pending-verification"]);
  assert.equal(r.report.result.risks.candidate.records[0].subject.role, "build-only");
  await archiveFixture(f, r, "risk-unknown");
});

test("evidenced inapplicability preserves its rationale and permits the candidate", async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f, "not-applicable");
  risk.reachability = "unreachable";
  risk.basis = "fixture: consumer excludes the simulated vulnerable entry path";
  f.plan.risks = fixtureRiskReview(f.plan, [risk]);
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.decision, "admitted-fixture");
  assert.equal(r.report.result.risks.candidate.records[0].decision, "not-applicable");
  assert.equal(r.report.result.risks.candidate.records[0].basis, risk.basis);
  await archiveFixture(f, r, "risk-not-applicable");
});

function fixtureApproval(f, risk) {
  return { evidenceKind: "fixture", riskId: risk.id, subject: structuredClone(risk.subject),
    riskSha256: sha(canonical(risk)), reviewInputsSha256: f.plan.candidate.evidence.semantics.subject.reviewInputsSha256,
    manifestRevision: f.plan.candidate.manifestRevision, manifest: f.plan.candidate.manifest,
    decision: "approved", actor: "fixture:user", authority: "explicit-user",
    reference: "fixture:simulated-user-approval-not-real-authorization", expiresOn: "2099-01-01" };
}

test("only a matching explicit fixture user approval permits an exception", async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f, "exception-required");
  f.plan.risks = fixtureRiskReview(f.plan, [risk], [fixtureApproval(f, risk)]);
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.decision, "admitted-fixture");
  assert.equal(r.report.result.risks.candidate.records[0].decision, "exception-approved");
  assert.equal(r.report.result.risks.candidate.records[0].approval.reference, "fixture:simulated-user-approval-not-real-authorization");
  await archiveFixture(f, r, "risk-exception-approved");
});

test("risk review refuses records without traceable fixture evidence and responsibility", async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f, "not-applicable");
  risk.reachability = "unreachable";
  risk.owner = "";
  f.plan.risks = fixtureRiskReview(f.plan, [risk]);
  const r = await f.run();
  assert.equal(r.status, 10, r.text);
  assert.match(r.report.error.issues[0].message, /risk record/);
});

test("missing risk assessment is pending instead of an admitted candidate", async t => {
  const f = await fixture(t);
  delete f.plan.risks;
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.decision, "rejected");
  assert.equal(r.report.result.risks.candidate.decision, "pending-verification");
});

test("empty findings without an exact reviewed scope remain pending", async t => {
  const f = await fixture(t);
  f.plan.risks = { schemaVersion: "1", evidenceKind: "fixture", records: [], approvals: [] };
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.risks.candidate.decision, "pending-verification");
  assert.equal(r.report.result.decision, "rejected");
});

test("a matching risk exception cannot bypass the JS capability gate", async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f, "exception-required");
  f.plan.risks = fixtureRiskReview(f.plan, [risk], [fixtureApproval(f, risk)]);
  f.plan.candidate.evidence.jsIsolation.status = "failed";
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.risks.candidate.decision, "continue");
  assert.equal(r.report.result.decision, "rejected");
  assert.ok(r.report.result.reasons.some(reason => reason.includes("jsIsolation")));
});

test("a risk confined to the old identity does not block an assessed unaffected new combination", async t => {
  const f = await fixture(t);
  f.plan.risks = fixtureRiskReview(f.plan, [fixtureRisk(f, "trust-integrity", "accepted")]);
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.risks.accepted.decision, "blocked");
  assert.equal(r.report.result.risks.candidate.decision, "continue");
  assert.equal(r.report.result.risks.candidate.records[0].decision, "unaffected-identity");
  assert.equal(r.report.result.decision, "admitted-fixture");
});

test("an exception cannot turn unknown reachability into verified impact", async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f, "exception-required");
  risk.reachability = "unknown";
  f.plan.risks = fixtureRiskReview(f.plan, [risk], [fixtureApproval(f, risk)]);
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.risks.candidate.decision, "pending-verification");
  assert.equal(r.report.result.decision, "rejected");
});

test("an approval cannot be reused after the reviewed risk rationale changes", async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f, "exception-required");
  f.plan.risks = fixtureRiskReview(f.plan, [risk], [fixtureApproval(f, risk)]);
  risk.basis = "fixture: changed risk assessment outside the prior approval";
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.risks.candidate.decision, "blocked");
  assert.equal(r.report.result.decision, "rejected");
});

test("risk exception rejects absent, mismatched, expired and automated authorizations", async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f, "exception-required");
  let attempt = 0;
  for (const mutate of [
    a => { a.length = 0; },
    a => { a[0].subject.consumer = "fixture:another-consumer"; },
    a => { a[0].manifestRevision = f.plan.accepted.manifestRevision; },
    a => { a[0].expiresOn = "2000-01-01"; },
    a => { a[0].authority = "automated-tests"; },
    a => { a[0].evidenceKind = "real-user-approval"; },
    a => { a[0].decision = "denied"; },
  ]) {
    const approvals = [fixtureApproval(f, risk)]; mutate(approvals);
    f.plan.risks = fixtureRiskReview(f.plan, [risk], approvals);
    const r = await f.run();
    assert.equal(r.status, 0, r.text);
    assert.equal(r.report.result.risks.candidate.decision, "blocked");
    assert.equal(r.report.result.decision, "rejected");
    assert.equal(r.report.result.risks.candidate.records[0].approval, null);
    await archiveFixture(f, r, `risk-exception-rejected-${++attempt}`);
  }
});

for (const role of ["build-only", "compiler-payload", "game-runtime"]) {
  test(`trust/integrity risk blocks the ${role} governance fixture despite an exception`, async t => {
    // The runtime source is imaginary and exists only in these isolated Git fixtures.
    const f = await fixture(t, role === "game-runtime" ? "GovernanceRuntimeFixture.git" : projectId, role);
    const risk = fixtureRisk(f, "trust-integrity");
    f.plan.risks = fixtureRiskReview(f.plan, [risk], [fixtureApproval(f, risk)]);
    const r = await f.run();
    assert.equal(r.status, 0, r.text);
    assert.equal(r.report.result.decision, "rejected");
    assert.equal(r.report.result.risks.candidate.records[0].decision, "blocked");
    assert.equal(r.report.result.risks.candidate.records[0].subject.role, role);
    assert.equal(r.report.result.risks.candidate.records[0].approval, null);
    await archiveFixture(f, r, `risk-trust-${role}`);
  });
}

test("risk approval cannot bypass unknown source, license or source-byte integrity", async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f, "exception-required");
  f.plan.risks = fixtureRiskReview(f.plan, [risk], [fixtureApproval(f, risk)]);
  const sourceRecord = f.plan.candidate.declaration.sources[0];
  sourceRecord.projectId = "UnknownFixture.git";
  let r = await f.run();
  assert.equal(r.status, 10, r.text);
  assert.equal(r.report.error.issues[0].code, "intake-ledger-identity");
  sourceRecord.projectId = projectId;

  await put(f.source, "src/parser.ts", "tampered fixture bytes\n");
  r = await f.run();
  assert.equal(r.status, 10, r.text);
  assert.equal(r.report.error.issues[0].code, "intake-ledger-identity");
  await put(f.source, "src/parser.ts", "export const upstream = 2;\n");

  const snapshot = f.plan.candidate;
  const approval = JSON.parse(git(f.manifests, "show", `${snapshot.manifestRevision}:${snapshot.manifest}.sources.json`));
  approval.sources[0].license = "Unknown-Fixture-License";
  const product = path.join(snapshot.workspaceRoot, "tsfg");
  await put(product, "eng/source-admissions.json", JSON.stringify(approval));
  const productOid = commit(product, "fixture unapproved license");
  const xml = git(f.manifests, "show", `${snapshot.manifestRevision}:${snapshot.manifest}`)
    .replace(/(<project name="tsfg.git"[^>]*revision=")[^"]+/, `$1${productOid}`);
  await put(f.manifests, snapshot.manifest, xml + "\n");
  await put(f.manifests, `${snapshot.manifest}.sources.json`, JSON.stringify(approval));
  snapshot.manifestRevision = commit(f.manifests, "fixture unknown license candidate");
  r = await f.run();
  assert.equal(r.status, 10, r.text);
  assert.equal(r.report.error.issues[0].code, "intake-ledger-license");
});

test("rollback cannot reuse an exception authorized only for the old manifest record", async t => {
  const f = await fixture(t);
  const old = f.plan.accepted, manifest = "candidates/tsfg-v0.2.2.xml";
  for (const suffix of ["", ".sources.json"]) await put(f.manifests, manifest + suffix,
    git(f.manifests, "show", `${old.manifestRevision}:${old.manifest}${suffix}`) + "\n");
  const revision = commit(f.manifests, "fixture new rollback combination");
  f.plan.action = "rollback";
  f.plan.rollback = { manifest, manifestRevision: revision, reason: "fixture rollback" };
  const risk = fixtureRisk(f, "exception-required", "accepted");
  const approval = { ...fixtureApproval(f, risk), manifestRevision: old.manifestRevision, manifest: old.manifest,
    reviewInputsSha256: old.evidence.semantics.subject.reviewInputsSha256 };
  f.plan.risks = fixtureRiskReview(f.plan, [risk], [approval]);
  const r = await f.run();
  assert.equal(r.status, 0, r.text);
  assert.equal(r.report.result.decision, "rejected");
  assert.equal(r.report.result.risks.accepted.decision, "blocked");
  approval.manifestRevision = revision;
  approval.manifest = manifest;
  const allowed = await f.run();
  assert.equal(allowed.status, 0, allowed.text);
  assert.equal(allowed.report.result.decision, "rollback-fixture");
  await archiveFixture(f, allowed, "risk-rollback-explicit-scope");
});

test("a risk cannot claim different bytes for an already verified fork and file", async t => {
  const f = await fixture(t);
  const risk = fixtureRisk(f);
  risk.subject.sha256 = "sha256:" + "0".repeat(64);
  f.plan.risks = fixtureRiskReview(f.plan, [risk]);
  const r = await f.run();
  assert.equal(r.status, 10, r.text);
  assert.equal(r.report.error.issues[0].code, "vulnerability-admission");
});
