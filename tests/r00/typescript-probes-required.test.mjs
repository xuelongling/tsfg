// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";

const product = fileURLToPath(new URL("../../", import.meta.url));
const realInputs = { skip: process.env.TSFG_TEST_AST_ACCEPTANCE !== "1" ? "requires pinned real source and tool inputs" : false };
const environment = () => ({ ...process.env, TSFG_GIT: TEST_GIT_EXECUTABLE,
  TSFG_RUNTIME_LOCK: path.join(product, "eng/go-ast-toolchains.lock.json"),
  TSFG_RUNTIME_CACHE: process.env.TSFG_TEST_GO_CACHE, TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" });

async function run(control, root, plan, name, exitCode = 10) {
  const output = path.join(root, `${name}-output`), report = path.join(root, `${name}-report.json`);
  const child = spawnSync(process.execPath, [path.join(control, "eng/tsfg-build.mjs"), "build", "--dev",
    "--source-target", "typescript-ast", "--workspace", product, "--intake-plan", plan,
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", output, "--report", report],
  { env: environment(), encoding: "utf8", timeout: 600000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(child.error);
  assert.equal(child.status, exitCode, child.stdout + child.stderr);
  const issue = JSON.parse(await readFile(report, "utf8")).error.issues[0];
  assert.equal(issue.probes.status, exitCode === 10 ? "not-run" : "failed");
  await assert.rejects(readFile(path.join(output, "source-build.json")), { code: "ENOENT" });
  return issue;
}

test("required probe inputs cannot be missing or removed from the fixed suite", realInputs, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "typed-required-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const control = path.join(root, "control");
  function git(cwd, ...args) {
    const child = spawnSync(TEST_GIT_EXECUTABLE, ["-c", "core.longpaths=true", "-C", cwd, ...args],
      { encoding: "utf8", windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr);
  }
  // Only the controller is isolated; it checks the unchanged, exact real fork.
  git(root, "clone", "--quiet", "--shared", product, control);
  const review = path.join(control, "eng/probes/js-isolation.json");
  const plan = path.join(product, "eng/intake-declarations/typescript-ast.json");
  await rm(review);
  const missingReview = await run(control, root, plan, "missing-js-review");
  assert.equal(missingReview.jsIsolation.status, "not-run");
  assert.match(missingReview.message, /missing required probe input: eng\/probes\/js-isolation.json/);
  git(control, "restore", "--worktree", "--", "eng/probes/js-isolation.json");
  const source = path.join(control, "eng/probes/syntax-error.ts");
  await rm(source);
  const missing = await run(control, root, plan, "missing-source");
  assert.match(missing.message, /missing required probe input/);
  git(control, "restore", "--worktree", "--", "eng/probes/syntax-error.ts");

  const manifestPath = path.join(control, "eng/probes/typescript.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const originalManifest = JSON.stringify(manifest);
  manifest.cases.pop();
  await writeFile(manifestPath, JSON.stringify(manifest));
  git(control, "add", "eng/probes/typescript.json");
  git(control, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Omit required probe in isolated control fixture");
  const omitted = await run(control, root, plan, "missing-case");
  assert.match(omitted.message, /all fixed TypeScript probes are required/);

  await writeFile(manifestPath, originalManifest);
  await writeFile(source, '/// <reference path="../../../internal/bundled/libs/lib.es2015.core.d.ts" />\n'
    + await readFile(source, "utf8"));
  git(control, "add", "eng/probes/typescript.json", "eng/probes/syntax-error.ts");
  git(control, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Reference an unapproved Program input in isolated control fixture");
  const expanded = await run(control, root, plan, "expanded-program", 21);
  assert.match(expanded.probes.cases.find(item => item.id === "syntax-error").message,
    /unapproved Program input: \/internal\/bundled\/libs\/lib.es2015.core.d.ts/);
});

test("a declaration required by the real typed probe cannot be omitted from intake", realInputs, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "typed-declaration-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const declaration = JSON.parse(await readFile(path.join(product, "eng/intake-declarations/typescript-ast.json"), "utf8"));
  const entries = declaration.sources[0].entries;
  const index = entries.findIndex(entry => entry.path === "tsc/internal/bundled/libs/lib.es5.d.ts");
  assert.ok(index >= 0);
  entries.splice(index, 1);
  const plan = path.join(root, "intake.json");
  await writeFile(plan, JSON.stringify(declaration));
  const omitted = await run(product, root, plan, "unregistered-declaration");
  assert.match(omitted.message, /extra or duplicate consumption entry/);
});
