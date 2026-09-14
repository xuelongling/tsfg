// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";

const product = fileURLToPath(new URL("../../", import.meta.url));
const entry = path.join(product, "eng/tsfg-build.mjs");
test("real fork corruption is rejected by the same build entry's intake gate", {
  skip: process.env.TSFG_TEST_AST_ACCEPTANCE !== "1" ? "requires the admitted real fork" : false,
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "ast-governance-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const source = path.join(root, "typescript");
  const isolatedProduct = path.join(root, "tcfg");
  await mkdir(path.join(isolatedProduct, "eng"), { recursive: true });
  const admissionBytes = await readFile(path.join(product, "eng/source-admissions.json"));
  const admission = JSON.parse(admissionBytes);
  const declared = JSON.parse(await readFile(path.join(product, "eng/intake-declarations/typescript-ast.json")));
  const approved = admission.sources.find(s => s.projectId === "TypeScript.git");
  function git(cwd, ...args) {
    const child = spawnSync(TEST_GIT_EXECUTABLE, ["-c", "core.longpaths=true", "-C", cwd, ...args],
      { encoding: "utf8", windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout;
  }
  // Shared objects retain the real full commit graph; only working files are
  // copied selectively. No source or controller checkout is modified.
  git(root, "clone", "--quiet", "--shared", "--no-checkout", path.join(product, "../typescript"), source);
  git(source, "remote", "set-url", "origin", approved.remoteUrl);
  git(source, "update-ref", "HEAD", approved.forkOid);
  const paths = [...new Set([...declared.sources.flatMap(s => s.entries.map(e => e.path)),
    ...Object.values(approved.legal), "UPSTREAM.toml"])];
  git(source, "restore", "--source=HEAD", "--worktree", "--", ...paths);
  const consumed = { schemaVersion: "1", evidenceKind: "real-source", entries: declared.sources.flatMap(s =>
    s.entries.map(e => ({ projectId: s.projectId, path: e.path, role: e.role, consumer: e.consumer }))) };
  let serial = 0;
  async function run(declaration = declared, bytes = admissionBytes) {
    await writeFile(path.join(isolatedProduct, "eng/source-admissions.json"), bytes);
    await writeFile(path.join(root, "declaration.json"), JSON.stringify(declaration));
    await writeFile(path.join(root, "consumption.json"), JSON.stringify(consumed));
    const env = { ...process.env, TSFG_GIT: TEST_GIT_EXECUTABLE };
    for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
    const result = spawnSync(process.execPath, [entry, "build", "--dev", "--source-target", "intake-ledger",
      "--workspace", isolatedProduct, "--intake-plan", path.join(root, "declaration.json"),
      "--intake-consumption", path.join(root, "consumption.json"), "--target", "windows-x86_64-msvc",
      "--profile", "debug", "--out", path.join(root, `out-${serial++}`)],
    { env, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    assert.ifError(result.error);
    return { status: result.status, text: result.stdout + result.stderr };
  }
  const good = await run();
  assert.equal(good.status, 0, good.text);
  for (const [name, mutate, pattern] of [
    ["unknown source", d => { d.sources[0].projectId = "unapproved-source"; }, /unknown.*source identity/],
    ["unapproved license exception", d => { d.sources[0].entries[0].licenseException = "Unapproved-License"; }, /unapproved license exception/],
    ["game runtime role", d => { d.sources[0].entries[0].role = "game-runtime"; }, /cannot be game-runtime/],
    ["dangerous path", d => { d.sources[0].entries[0].path = "../outside.go"; }, /invalid consumed-file/],
    ["consumption expansion", d => { d.sources[0].entries.pop(); }, /extra or duplicate consumption/],
  ]) {
    await t.test(name, async () => {
      const copy = structuredClone(declared); mutate(copy);
      const rejected = await run(copy);
      assert.equal(rejected.status, 10, rejected.text);
      assert.match(rejected.text, pattern);
    });
  }
  await t.test("unknown license cannot replace committed approval", async () => {
    const copy = structuredClone(admission); copy.sources[0].license = "Unapproved-License";
    const rejected = await run(declared, JSON.stringify(copy));
    assert.equal(rejected.status, 10, rejected.text);
    assert.match(rejected.text, /committed source approval/);
  });
  await t.test("missing mandatory legal material in the real source copy", async () => {
    const legal = path.join(source, approved.legal.notice);
    const original = await readFile(legal);
    await rm(legal);
    const rejected = await run();
    assert.equal(rejected.status, 10, rejected.text);
    assert.match(rejected.text, /ENOENT/);
    await writeFile(legal, original);
  });
});
