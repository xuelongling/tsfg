// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_GIT_EXECUTABLE } from "./test-tools.mjs";

const entry = fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url));
test("source-built AST requires an exact approved consumption plan", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_")) delete env[key];
  const result = spawnSync(process.execPath, [entry, "build", "--dev", "--source-target", "typescript-ast",
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", "E:/unused-ast-output"],
  { env, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /AST requires.*intake-plan/);
});

test("AST does not silently map an unimplemented release profile to debug", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_")) delete env[key];
  const child = spawnSync(process.execPath, [entry, "build", "--dev", "--source-target", "typescript-ast",
    "--intake-plan", "E:/unused-plan.json", "--target", "windows-x86_64-msvc", "--profile", "release",
    "--out", "E:/unused-ast-output"], { env, encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 2, child.stdout + child.stderr);
  assert.match(child.stderr, /AST.*debug/);
});

test("fixed fork source rebuilds a real TypeScript AST after consumption governance", {
  skip: process.env.TSFG_TEST_AST_ACCEPTANCE !== "1" ? "requires the pinned real source and Go cache" : false,
}, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ast-acceptance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const product = fileURLToPath(new URL("../../", import.meta.url));
  const report = path.join(root, "report.json");
  const child = spawnSync(process.execPath, [entry, "build", "--dev", "--source-target", "typescript-ast",
    "--workspace", product, "--intake-plan", path.join(product, "eng/intake-declarations/typescript-ast.json"),
    "--target", "windows-x86_64-msvc", "--profile", "debug", "--out", path.join(root, "out"), "--report", report],
  { env: { ...process.env, TSFG_GIT: TEST_GIT_EXECUTABLE,
    TSFG_RUNTIME_LOCK: path.join(product, "eng/go-ast-toolchains.lock.json"),
    TSFG_RUNTIME_CACHE: process.env.TSFG_TEST_GO_CACHE,
    TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" }, encoding: "utf8", timeout: 600000, windowsHide: true });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(await readFile(report, "utf8")).result;
  assert.equal(result.status, "ast-observed");
  assert.equal(result.ast.kind, "KindSourceFile");
  assert.equal(result.ast.statements[0].kind, "KindVariableStatement");
  assert.deepEqual(result.ast.identifiers, ["answer"]);
  assert.equal(result.ast.parseDiagnosticCount, 0);
  assert.equal(result.intakeComplete, false);
  assert.equal(result.generation.status, "not-run");
  assert.equal(result.buildInputSet.schemaVersion, "1");
  assert.ok(result.buildInputSet.entries.some(entry => entry.projectId === "tsfg"
    && entry.repositoryRelativePath === "eng/typescript-ast.mjs" && entry.normalizedMode === "100644"));
  assert.ok(result.ledger.files.some(file => file.path === "tsc/NOTICE.txt" && file.role === "build-only"));
  assert.ok(result.toolchainInputs.files.some(file => file.source === "go" && file.path === "src/runtime/proc.go"
    && file.role === "compiler-payload" && file.license === "BSD-3-Clause"));
  assert.equal(result.toolchainInputs.status, "matched");
  if (process.env.TSFG_TEST_AST_EVIDENCE) {
    const evidence = path.resolve(process.env.TSFG_TEST_AST_EVIDENCE);
    assert.ok(evidence.startsWith("E:"));
    await mkdir(evidence, { recursive: true });
    await writeFile(path.join(evidence, "ast-build.json"), await readFile(report));
  }
});
