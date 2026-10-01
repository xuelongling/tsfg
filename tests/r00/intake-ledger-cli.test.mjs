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
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fixtureParent = tmpdir();
const projectId = "TypeScript.git";
const consumer = "fixture-parser-probe";

function git(cwd, ...args) {
  const child = spawnSync(TEST_GIT_EXECUTABLE, args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim();
}

async function fixture(t, { modified = false, sourceProjectId = projectId,
  canonicalOwner = "microsoft" } = {}) {
  await mkdir(fixtureParent, { recursive: true });
  const root = await mkdtemp(path.join(fixtureParent, "intake-ledger-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(fixtureParent));
    await rm(root, { recursive: true, force: true });
  });
  const product = path.join(root, "product"), source = path.join(root, "typescript");
  await mkdir(path.join(product, "eng"), { recursive: true });
  await mkdir(path.join(source, "src"), { recursive: true });
  git(source, "init", "--quiet");
  git(source, "config", "core.autocrlf", "false");
  git(source, "config", "user.name", "Intake governance fixture");
  git(source, "config", "user.email", "intake-fixture@tsfg.invalid");
  git(source, "remote", "add", "origin", `https://github.com/xuelongling/${sourceProjectId}`);
  const files = {
    ".gitattributes": "* -text\n",
    LICENSE: "Apache License 2.0\nCopyright fixture authors\n",
    NOTICE: "Original fixture notice\n",
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 2;\n",
  };
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(source, name), bytes);
  git(source, "add", ".");
  git(source, "commit", "--quiet", "-m", "fixture upstream base");
  const baseOid = git(source, "rev-parse", "HEAD");
  const branch = "refs/heads/tsfg-ledger-fixture";
  git(source, "checkout", "--quiet", "-b", "tsfg-ledger-fixture");
  files["UPSTREAM.toml"] = `canonical_url = "https://github.com/${canonicalOwner}/${sourceProjectId}"\nbase_oid = "${baseOid}"\nlicense = "Apache-2.0"\nsync_branch = "${branch}"\nlocal_changes = "isolated governance fixture"\n`;
  if (modified) files["src/a.ts"] = "export const a = 3;\n";
  for (const name of ["UPSTREAM.toml", "src/a.ts"]) await writeFile(path.join(source, name), files[name]);
  git(source, "add", ".");
  git(source, "commit", "--quiet", "-m", "fixture fork provenance");
  const forkOid = git(source, "rev-parse", "HEAD");
  const admission = { schemaVersion: "2", sources: [{
    projectId: sourceProjectId, path: "typescript", remoteUrl: `https://github.com/xuelongling/${sourceProjectId}`,
    canonicalUrl: `https://github.com/${canonicalOwner}/${sourceProjectId}`, baseOid, forkOid, branch,
    license: "Apache-2.0", files: Object.entries(files).map(([name, bytes]) => ({
      path: name, contentKind: "text", sha256: hash(bytes),
    })), legal: { license: "LICENSE", notice: "NOTICE", copyright: "LICENSE" },
  }] };
  const declaration = { schemaVersion: "1", evidenceKind: "fixture", sources: [{
    projectId: sourceProjectId, forkOid, baseOid, entries: [{ path: "src/a.ts", role: "compiler-payload", consumer,
      affectsPayload: true, localModification: modified ? "Fixture changes a for a declared probe; expected value is checked by its consumer." : null,
      licenseException: null }], excludedReason: "Other admitted files are not consumed by this declared fixture target.",
  }], attributions: [] };
  const consumption = { schemaVersion: "1", evidenceKind: "fixture", entries: [{
    projectId: sourceProjectId, path: "src/a.ts", role: "compiler-payload", consumer,
  }] };
  async function run() {
    const plan = path.join(root, "plan.json"), consumed = path.join(root, "consumption.json");
    const report = path.join(root, "report.json"), output = path.join(root, "out");
    await writeFile(path.join(product, "eng/source-admissions.json"), JSON.stringify(admission));
    await writeFile(plan, JSON.stringify(declaration));
    await writeFile(consumed, JSON.stringify(consumption));
    const environment = { ...process.env, TSFG_GIT: TEST_GIT_EXECUTABLE };
    for (const key of Object.keys(environment)) {
      if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_WINDOWS_")) delete environment[key];
    }
    const child = spawnSync(process.execPath, [entry, "build", "--dev", "--source-target", "intake-ledger",
      "--workspace", product, "--intake-plan", plan, "--intake-consumption", consumed,
      "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", output, "--report", report],
    { env: environment, encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.ifError(child.error);
    return { status: child.status, text: child.stdout + child.stderr,
      report: JSON.parse(await readFile(report, "utf8")), output };
  }
  return { root, source, admission, declaration, consumption, run };
}

test("ledger CLI expands declared fixture files without claiming executed intake", async (t) => {
  const f = await fixture(t);
  f.declaration.sources[0].entries.push({ path: "src/b.ts", role: "build-only", consumer: "fixture-lint",
    affectsPayload: false, localModification: null, licenseException: null });
  f.consumption.entries.push({ projectId, path: "src/b.ts", role: "build-only", consumer: "fixture-lint" });
  const result = await f.run();
  assert.equal(result.status, 0, result.text);
  assert.equal(result.report.status, "success");
  const ledger = result.report.result;
  assert.equal(ledger.status, "declared");
  assert.equal(ledger.evidenceKind, "fixture");
  assert.equal(ledger.intakeComplete, false);
  assert.equal(ledger.executionConsumption.status, "not-run");
  assert.equal(ledger.operation, "declared-consumption-governance");
  assert.equal(ledger.isolation, "not-enforced");
  assert.equal(ledger.files.length, 2);
  assert.equal(ledger.files[0].path, "src/a.ts");
  assert.equal(ledger.files[0].role, "compiler-payload");
  assert.equal(ledger.files[0].consumer, consumer);
  assert.equal(ledger.files[0].sha256, hash("export const a = 1;\n"));
  assert.equal(ledger.files[0].baseOid, f.admission.sources[0].baseOid);
  assert.equal(ledger.files[0].forkOid, f.admission.sources[0].forkOid);
  assert.deepEqual(ledger.buildInputEntries.map(item => item.path), ["typescript/src/a.ts"]);
  for (const name of ["typescript/LICENSE", "typescript/NOTICE", "typescript/UPSTREAM.toml", "typescript/src/b.ts"]) {
    assert.ok(ledger.auditInputEntries.some(item => item.path === name), `missing audit identity: ${name}`);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(result.output, "intake-ledger.json"), "utf8")), ledger);
});

test("ledger CLI refuses caller-supplied source approval promoted to real-source", async (t) => {
  const f = await fixture(t);
  f.declaration.evidenceKind = "real-source";
  f.consumption.evidenceKind = "real-source";
  const result = await f.run();
  assert.equal(result.status, 10, result.text);
  assert.equal(result.report.error.issues[0].code, "intake-ledger-authority");
  await assert.rejects(readFile(path.join(result.output, "intake-ledger.json")), { code: "ENOENT" });
});

test("ledger CLI rejects LLVM and MLIR sources declared as game runtime", async (t) => {
  const f = await fixture(t, { sourceProjectId: "llvm-project.git", canonicalOwner: "llvm" });
  f.declaration.sources[0].entries[0].role = "game-runtime";
  f.consumption.entries[0].role = "game-runtime";
  const result = await f.run();
  assert.equal(result.status, 10, result.text);
  assert.equal(result.report.error.issues[0].code, "intake-ledger-role");
  await assert.rejects(readFile(path.join(result.output, "intake-ledger.json")), { code: "ENOENT" });
});

test("ledger CLI permits LLVM and MLIR compiler and build declarations without claiming intake", async (t) => {
  const f = await fixture(t, { sourceProjectId: "llvm-project.git", canonicalOwner: "llvm" });
  f.declaration.sources[0].entries.push({ path: "src/b.ts", role: "build-only", consumer: "fixture-lint",
    affectsPayload: false, localModification: null, licenseException: null });
  f.consumption.entries.push({ projectId: "llvm-project.git", path: "src/b.ts", role: "build-only", consumer: "fixture-lint" });
  const result = await f.run();
  assert.equal(result.status, 0, result.text);
  assert.deepEqual(result.report.result.files.map(file => file.role), ["compiler-payload", "build-only"]);
  assert.equal(result.report.result.evidenceKind, "fixture");
  assert.equal(result.report.result.intakeComplete, false);
  assert.equal(result.report.result.executionConsumption.status, "not-run");
});

test("downstream real-intake consumer refuses governance receipts and flipped completion flags", () => {
  const fixtureReceipt = { schemaVersion: "1", status: "declared", evidenceKind: "fixture",
    executionConsumption: { status: "not-run" }, intakeComplete: false };
  const forgedReceipt = { ...fixtureReceipt, status: "success", evidenceKind: "real-source",
    executionConsumption: { status: "passed" }, intakeComplete: true };
  for (const receipt of [fixtureReceipt, forgedReceipt]) {
    assert.throws(() => requireRealIntakeEvidence(receipt),
      error => /** @type {Error & {issueCode: string}} */ (error).issueCode === "intake-ledger-execution-evidence");
  }
});

test("ledger CLI accepts explained fork modification without changing upstream legal bytes", async (t) => {
  const f = await fixture(t, { modified: true });
  const result = await f.run();
  assert.equal(result.status, 0, result.text);
  assert.equal(result.report.result.files[0].sha256, hash("export const a = 3;\n"));
  assert.equal(await readFile(path.join(f.source, "LICENSE"), "utf8"), "Apache License 2.0\nCopyright fixture authors\n");
});

/** @type {Array<[string, (fixture: any) => void | Promise<void>]>} */
const negatives = [
  ["missing declared consumption", (f) => { f.consumption.entries = []; }],
  ["extra consumed file despite existing source approval", (f) => {
    f.consumption.entries.push({ projectId, path: "src/b.ts", role: "compiler-payload", consumer });
  }],
  ["mismatched exact fork identity", (f) => { f.declaration.sources[0].forkOid = f.declaration.sources[0].baseOid; }],
  ["dangerous traversal path", (f) => { f.declaration.sources[0].entries[0].path = "../escape.ts"; }],
  ["unknown source license", (f) => { f.admission.sources[0].license = "Unapproved-Fixture-License"; }],
  ["missing admitted file mapping", (f) => {
    f.admission.sources[0].files = f.admission.sources[0].files.filter((file) => file.path !== "src/a.ts");
  }],
  ["legal material corruption", async (f) => { await writeFile(path.join(f.source, "LICENSE"), "changed legal text"); }],
  ["unsupported consumption role", (f) => { f.declaration.sources[0].entries[0].role = "unrestricted"; }],
  ["TypeScript game runtime consumption", (f) => {
    f.declaration.sources[0].entries[0].role = "game-runtime";
    f.consumption.entries[0].role = "game-runtime";
  }],
  ["consumed bytes differing from committed source", async (f) => { await writeFile(path.join(f.source, "src/a.ts"), "changed input"); }],
  ["fixture evidence passed as real source consumption", (f) => { f.consumption.evidenceKind = "real-source"; }],
];
for (const [name, mutate] of negatives) test(`ledger CLI rejects ${name}`, async (t) => {
  const f = await fixture(t);
  await mutate(f);
  const result = await f.run();
  assert.equal(result.status, 10, result.text);
  assert.equal(result.report.status, "failure");
  assert.ok(result.report.error.issues[0].message.length > 0);
  assert.equal(result.report.result, undefined);
  await assert.rejects(readFile(path.join(result.output, "intake-ledger.json")), { code: "ENOENT" });
});

test("ledger CLI rejects unexplained local modification", async (t) => {
  const f = await fixture(t, { modified: true });
  f.declaration.sources[0].entries[0].localModification = null;
  const result = await f.run();
  assert.equal(result.status, 10, result.text);
  assert.match(result.report.error.issues[0].message, /modif|expla/i);
});
