// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const worker = fileURLToPath(new URL("../../eng/go-source-worker.mjs", import.meta.url));
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

// The worker runs in a real Node child; only Go execution is a fixture. This
// tests worker control flow and evidence, not actual Go dependency consumption.
async function execute({ mode = "local-development", scenario = "success", beforeMismatch = false,
  modules = [{ path: "example.test/dependency", version: "v1.0.0" }] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-local-worker-"));
  const inputRoot = path.join(root, "inputs"), workRoot = path.join(root, "work");
  await mkdir(inputRoot); await mkdir(workRoot);
  const input = path.join(inputRoot, "go.mod");
  await writeFile(input, "declared input");
  const calls = path.join(root, "calls.jsonl");
  const hook = path.join(root, "fake-go.mjs");
  await writeFile(hook, `
import childProcess from "node:child_process";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, writeFileSync } from "node:fs";
const scenario = ${JSON.stringify(scenario)};
childProcess.spawnSync = (executable, args) => {
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({executable,args}) + "\\n");
  if (executable !== "fixture-go") throw new Error("unexpected executable: " + executable);
  if (args[0] === "version") return {status:0, stdout:scenario === "version" ? "wrong version" : "go version go1.25.0 windows/amd64"};
  if (args[0] !== "list") throw new Error("network negative must not run");
  if (scenario === "mutation") writeFileSync(${JSON.stringify(input)}, "mutated");
  const packages = [
    {ImportPath:"github.com/microsoft/typescript-go/internal/ast"},
    {ImportPath:"github.com/microsoft/typescript-go/internal/parser"},
    {ImportPath:"example.test/dependency", Module:{Path:"example.test/dependency", Version:"v1.0.0"}}
  ];
  if (scenario === "target") packages.shift();
  if (scenario === "incomplete") packages[0].Incomplete = true;
  if (scenario === "replacement") packages[2].Module.Replace = {Path:"elsewhere"};
  return {status:0, stdout:packages.map(value => JSON.stringify(value)).join("\\n")};
};
net.connect = () => { throw new Error("network probe must not run"); };
syncBuiltinESMExports();
`);
  const plan = { executionMode: mode, helper: "missing-helper", go: "fixture-go", goVersion: "1.25.0",
    inputRoot, workRoot, moduleRoot: inputRoot, environment: {},
    undeclaredCanary: input, networkCanaryPort: 12345, modules,
    inputs: [{ path: input, sha256: hash(beforeMismatch ? "other input" : "declared input") }],
    arguments: ["list", "-deps", "-json", "./internal/ast", "./internal/parser"] };
  if (mode === "default") delete plan.executionMode;
  const planPath = path.join(root, "plan.json");
  await writeFile(planPath, JSON.stringify(plan));
  const child = spawnSync(process.execPath, ["--import", pathToFileURL(hook).href, worker, planPath], {
    encoding: "utf8", windowsHide: true, timeout: 30000,
  });
  assert.ifError(child.error);
  assert.ok([0, 20].includes(child.status), child.stderr);
  const result = JSON.parse(await readFile(path.join(workRoot, "worker-result.json"), "utf8"));
  const called = await readFile(calls, "utf8").then(text => text.trim().split("\n").map(line => JSON.parse(line)),
    error => { if (error.code === "ENOENT") return []; throw error; });
  return { result, child, called, inputRoot, workRoot };
}

test("local worker needs no helper and explicitly reports unenforced isolation", async () => {
  const { result, child, called, inputRoot, workRoot } = await execute();
  assert.equal(child.status, 0, child.stderr);
  assert.equal(result.status, "success");
  assert.equal(result.executionMode, "local-development");
  assert.equal(result.isolation, "not-enforced");
  assert.equal(result.token, null);
  assert.deepEqual(result.checks, { workWrite: "allowed", read: "not-enforced", write: "not-enforced" });
  assert.deepEqual(result.canaries, {});
  assert.deepEqual(result.missingModuleNetwork, { status: "not-run" });
  assert.deepEqual(called.map(call => call.args[0]), ["version", "list"]);
  await assert.rejects(access(path.join(inputRoot, "forbidden-write")), { code: "ENOENT" });
  assert.equal(hash(await readFile(path.join(workRoot, "go-list.jsonstream"))), result.outputSha256);
});

/** @type {Array<[string, Parameters<typeof execute>[0], RegExp]>} */
const failureCases = [
  ["pre-execution input hash", { beforeMismatch: true }, /staged input changed/],
  ["post-execution input hash", { scenario: "mutation" }, /input mutated/],
  ["locked Go version", { scenario: "version" }, /unexpected Go identity/],
  ["declared module closure", { modules: [] }, /modules differ/],
  ["both declared targets", { scenario: "target" }, /both declared targets/],
  ["complete package stream", { scenario: "incomplete" }, /incomplete package/],
  ["module replacement refusal", { scenario: "replacement" }, /replacements are forbidden/],
];
for (const [name, options, message] of failureCases) test(`local worker retains ${name} validation`, async () => {
  const { result, child, workRoot } = await execute(options);
  assert.equal(child.status, 20);
  assert.equal(result.status, "failure");
  assert.match(result.message, message);
  assert.equal(result.executionMode, "local-development");
  assert.equal(result.isolation, "not-enforced");
  await assert.rejects(access(path.join(workRoot, "go-list.jsonstream")), { code: "ENOENT" });
});

test("unspecified execution mode retains the required restriction helper", async () => {
  const { result, child, called } = await execute({ mode: "default" });
  assert.equal(child.status, 20);
  assert.equal(result.executionMode, "restricted");
  assert.match(result.message, /missing-helper/);
  assert.deepEqual(called, [{ executable: "missing-helper", args: ["--verify-restriction"] }]);
});

test("worker rejects an unknown mode before invoking any executable", async () => {
  const { result, child, called } = await execute({ mode: "typo" });
  assert.equal(child.status, 20);
  assert.match(result.message, /unsupported execution mode/);
  assert.deepEqual(called, []);
});
