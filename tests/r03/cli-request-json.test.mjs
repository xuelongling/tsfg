// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sourceInput } from "../../compiler/pipeline.mjs";
import { decodeReferenceFacts } from "../../compiler/reference-facts.mjs";
import { buildReferenceHir, printReferenceHir } from "../../compiler/reference-hir.mjs";

const cli = fileURLToPath(new URL("../../tooling/tsfgc.mjs", import.meta.url));

/**
 * @param {string} name
 * @param {{emit?: string, requests?: string, inputText?: string|Uint8Array, inputArgument?: string, omitInput?: boolean, inputKind?: string}} [options]
 */
async function runCli(name, { emit, requests, inputText, inputArgument, omitInput = false, inputKind } = {}) {
  const storage = process.env.TSFG_TEST_STORAGE;
  assert.ok(storage, "TSFG_TEST_STORAGE must name an owned test directory");
  await mkdir(storage, { recursive: true });
  const root = await mkdtemp(path.join(storage, `${name}-`));
  const input = path.join(root, "input.json");
  if (!omitInput) await writeFile(input, inputText ?? JSON.stringify(await sourceInput("export function answer(): i32 { return 42; }")));
  // Omitting every executable option stops valid inputs at the existing missing-frontend boundary.
  const args = [cli, ...(omitInput ? [] : ["--input", inputArgument ?? input]),
    ...(inputKind === undefined ? [] : ["--input-kind", inputKind]),
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

test("cold Reference HIR keeps its exact bytes and accepts only text outputs", async () => {
  const prefix = "./fixtures/reference-source/constructor";
  const [facts, binding] = await Promise.all([
    readFile(new URL(prefix + ".facts.json", import.meta.url)),
    readFile(new URL(prefix + ".binding.json", import.meta.url), "utf8"),
  ]);
  const inputText = printReferenceHir(buildReferenceHir(decodeReferenceFacts(facts, JSON.parse(binding))));
  const options = { inputKind: "hir", inputText };
  const inspected = await runCli("reference-hir", { ...options, emit: "hir" });
  assert.equal(inspected.status, 0, inspected.stderr.toString());
  assert.equal(inspected.stderr.length, 0);
  assert.deepEqual(inspected.stdout, Buffer.from(inputText));
  for (const emit of ["bytecode", "run", "program-object"]) {
    const rejected = await runCli("reference-" + emit, { ...options, emit });
    assert.equal(rejected.status, 2);
    assert.equal(rejected.stdout.length, 0);
    assert.match(rejected.stderr.toString(), /private Reference HIR requires --emit hir\|core/);
  }
});

test("cold HIR CLI admits the transport boundary and rejects oversized files before JSON parsing", async () => {
  const storage = process.env.TSFG_TEST_STORAGE;
  assert.ok(storage);
  await mkdir(storage, { recursive: true });
  const directory = await mkdtemp(path.join(storage, "hir-wire-limit-"));
  const input = path.join(directory, "hir.json");
  const handle = await open(input, "wx");
  const limit = 16 * 1024 * 1024;
  try { await handle.truncate(limit); }
  finally { await handle.close(); }
  const options = { inputKind: "hir", emit: "hir", inputArgument: input };
  const atLimit = await runCli("hir-at-limit", options);
  assert.equal(atLimit.status, 2);
  assert.equal(atLimit.stdout.length, 0);
  assert.match(atLimit.stderr.toString(), /HIR must contain valid UTF-8 JSON/);
  const overflow = await open(input, "r+");
  try { await overflow.truncate(limit + 1); }
  finally { await overflow.close(); }
  const rejected = await runCli("hir-over-limit", options);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.stdout.length, 0);
  assert.match(rejected.stderr.toString(), /HIR input file exceeds the wire byte limit/);
});

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

// Owned Source JSON must fail at decoding before any frontend admission.
test("source CLI rejects malformed UTF-8 in otherwise valid JSON", async () => {
  const marker = "UTF8_SOURCE_MARKER";
  const input = Buffer.from(JSON.stringify(await sourceInput(`// ${marker}\nexport function answer(): i32 { return 42; }`)));
  const offset = input.indexOf(marker);
  assert.ok(offset >= 0);
  const replace = value => Buffer.concat([input.subarray(0, offset), value, input.subarray(offset + marker.length)]);
  const invalid = await runCli("source-invalid-utf8", { emit: "hir", inputText: replace(Buffer.from([0xc3])) });
  assert.equal(invalid.status, 2, invalid.stdout.toString() + invalid.stderr.toString());
  assert.equal(invalid.stdout.length, 0);
  assert.match(invalid.stderr.toString(), /utf-8/i);
  const valid = await runCli("source-valid-utf8", { emit: "hir", inputText: replace(Buffer.from("中�")) });
  assert.equal(valid.status, 11, valid.stdout.toString() + valid.stderr.toString());
  assert.equal(valid.stderr.length, 0);
  assert.equal(JSON.parse(valid.stdout.toString()).message, "frontend executable is required");
});

for (const { name, options, diagnostic } of [
  { name: "missing-input", options: { omitInput: true }, diagnostic: /--input .* is required \(--emit defaults to run\)/ },
  { name: "missing-input-value", options: { inputArgument: "--emit" }, diagnostic: /^r03-cli-options: --input requires a value\n$/ },
  { name: "missing-emit-value", options: { emit: "--requests" }, diagnostic: /^r03-cli-options: --emit requires a value\n$/ },
  { name: "unsupported-emit", options: { emit: "query-invalid" }, diagnostic: /unsupported --emit .*query-tmeta\|borrow-proof/ },
  { name: "unsupported-emit-with-hir", options: { inputKind: "hir", emit: "query-invalid" }, diagnostic: /unsupported --emit .*query-tmeta\|borrow-proof/ },
  { name: "query-emit-with-hir", options: { inputKind: "hir", emit: "query-tmeta" }, diagnostic: /HIR requires --emit/ }
]) {
  test(name + " reports the applicable CLI usage error", async () => {
    const child = await runCli(name, options);
    assert.equal(child.status, 2, child.stdout.toString() + child.stderr.toString());
    assert.equal(child.stdout.length, 0);
    assert.match(child.stderr.toString(), /r03-cli-options:/);
    assert.match(child.stderr.toString(), diagnostic);
  });
}
