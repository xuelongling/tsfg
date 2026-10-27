// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sourceInput } from "../../compiler/pipeline.mjs";

const cli = fileURLToPath(new URL("../../tooling/tsfgc.mjs", import.meta.url));

/**
 * @param {string} name
 * @param {{emit?: string, requests?: string, inputText?: string}} [options]
 */
async function runCli(name, { emit, requests, inputText } = {}) {
  const storage = process.env.TSFG_TEST_STORAGE;
  assert.ok(storage, "TSFG_TEST_STORAGE must name an owned test directory");
  await mkdir(storage, { recursive: true });
  const root = await mkdtemp(path.join(storage, `${name}-`));
  const input = path.join(root, "input.json");
  await writeFile(input, inputText ?? JSON.stringify(await sourceInput("export function answer(): i32 { return 42; }")));
  // Omitting every executable option stops valid inputs at the existing missing-frontend boundary.
  const args = [cli, "--input", input,
    ...(emit === undefined ? [] : ["--emit", emit]),
    ...(requests === undefined ? [] : ["--requests", requests])];
  const child = spawnSync(process.execPath, args, { windowsHide: true });
  await Promise.all([
    writeFile(path.join(root, "command.json"), JSON.stringify({ program: process.execPath, args })),
    writeFile(path.join(root, "stdout.bin"), child.stdout),
    writeFile(path.join(root, "stderr.bin"), child.stderr),
    writeFile(path.join(root, "terminal.json"), JSON.stringify({ pid: child.pid, status: child.status,
      signal: child.signal, error: child.error?.message ?? null }))
  ]);
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  return child;
}

test("run rejects malformed request JSON before the missing frontend", async () => {
  const child = await runCli("run-invalid-json", { emit: "run", requests: "[{" });
  assert.equal(child.status, 2, child.stdout.toString() + child.stderr.toString());
  assert.equal(child.stdout.length, 0);
  assert.match(child.stderr.toString(), /JSON/);
});

test("default run rejects malformed request JSON before the missing frontend", async () => {
  const child = await runCli("default-invalid-json", { requests: "[{" });
  assert.equal(child.status, 2, child.stdout.toString() + child.stderr.toString());
  assert.equal(child.stdout.length, 0);
  assert.match(child.stderr.toString(), /JSON/);
});

for (const { name, emit, requests } of [
  { name: "run-valid-json", emit: "run", requests: "[{}]" },
  { name: "default-run-default-requests", emit: undefined, requests: undefined },
  { name: "run-null-shape", emit: "run", requests: "null" },
  { name: "run-null-item-shape", emit: "run", requests: "[null]" },
  ...["hir", "core", "bytecode"].map(emit => ({ name: `${emit}-ignores-requests`, emit, requests: "[{" }))
]) {
  test(`${name} preserves the missing-frontend result`, async () => {
    const child = await runCli(name, { emit, requests });
    assert.equal(child.status, 11, child.stdout.toString() + child.stderr.toString());
    assert.equal(child.stderr.length, 0);
    const diagnostic = JSON.parse(child.stdout.toString("utf8"));
    assert.equal(diagnostic.status, "tool-error");
    assert.equal(diagnostic.message, "frontend executable is required");
  });
}

test("input file JSON is parsed before request JSON", async () => {
  const child = await runCli("invalid-input-first", { emit: "run", requests: "[{", inputText: "invalid-input-json" });
  assert.equal(child.status, 2, child.stdout.toString() + child.stderr.toString());
  assert.equal(child.stdout.length, 0);
  assert.match(child.stderr.toString(), /invalid-input-json/);
});
