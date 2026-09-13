// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GoSourceResultError, readGoSourceExecutionResult } from "../../eng/go-source-result.mjs";

test("a completed native Go execution yields its verified result without publishing it", async () => {
  const stage = await mkdtemp(path.join(tmpdir(), "go-result-"));
  await mkdir(path.join(stage, "work"));
  const bytes = Buffer.from('{"ImportPath":"example.com/parser"}\n');
  const worker = { status: "success", outputSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  await writeFile(path.join(stage, "work", "worker-result.json"), JSON.stringify(worker));
  await writeFile(path.join(stage, "work", "go-list.jsonstream"), bytes);
  const result = await readGoSourceExecutionResult(stage, { status: 0 });
  assert.deepEqual(result.worker, worker);
  assert.deepEqual(result.outputBytes, bytes);
  assert.deepEqual(await readFile(path.join(stage, "work", "go-list.jsonstream")), bytes);
});

test("a partial worker receipt cannot hide the native supervisor failure", async () => {
  const stage = await mkdtemp(path.join(tmpdir(), "go-result-"));
  await mkdir(path.join(stage, "work"));
  await writeFile(path.join(stage, "work", "worker-result.json"), '{"status":');
  await assert.rejects(readGoSourceExecutionResult(stage, { status: 125, stderr: "native setup refused" }),
    (error) => error instanceof GoSourceResultError && error.kind === "native"
      && error.message.includes("native setup refused"));
});

test("native success without a readable worker receipt is an execution boundary failure", async () => {
  const stage = await mkdtemp(path.join(tmpdir(), "go-result-"));
  await mkdir(path.join(stage, "work"));
  await writeFile(path.join(stage, "work", "worker-result.json"), '{"status":');
  await assert.rejects(readGoSourceExecutionResult(stage, { status: 0 }),
    (error) => error instanceof GoSourceResultError && error.kind === "native"
      && error.message.includes("worker receipt"));
});

test("Go phase attribution requires the matching native exit status", async () => {
  const stage = await mkdtemp(path.join(tmpdir(), "go-result-"));
  await mkdir(path.join(stage, "work"));
  const worker = { status: "failure", phase: "dependency-resolution", message: "missing locked module" };
  await writeFile(path.join(stage, "work", "worker-result.json"), JSON.stringify(worker));
  await assert.rejects(readGoSourceExecutionResult(stage, { status: 20 }),
    (error) => error instanceof GoSourceResultError && error.kind === "go"
      && error.message === "missing locked module" && error.worker.phase === "dependency-resolution");
  await assert.rejects(readGoSourceExecutionResult(stage, { status: 125, stderr: "job cleanup failed" }),
    (error) => error instanceof GoSourceResultError && error.kind === "native"
      && error.message.includes("job cleanup failed"));
  await assert.rejects(readGoSourceExecutionResult(stage, { status: 20, error: new Error("supervisor timed out") }),
    (error) => error instanceof GoSourceResultError && error.kind === "native"
      && error.message.includes("supervisor timed out"));
});

test("a successful worker cannot authorize changed dependency output", async () => {
  const stage = await mkdtemp(path.join(tmpdir(), "go-result-"));
  await mkdir(path.join(stage, "work"));
  const original = Buffer.from("original dependency stream");
  const worker = { status: "success", outputSha256: `sha256:${createHash("sha256").update(original).digest("hex")}` };
  await writeFile(path.join(stage, "work", "worker-result.json"), JSON.stringify(worker));
  await writeFile(path.join(stage, "work", "go-list.jsonstream"), "changed dependency stream");
  await assert.rejects(readGoSourceExecutionResult(stage, { status: 0 }),
    (error) => error instanceof GoSourceResultError && error.kind === "integrity");
});

test("native success without a worker result cannot publish a dependency result", async () => {
  const stage = await mkdtemp(path.join(tmpdir(), "go-result-"));
  await mkdir(path.join(stage, "work"));
  await assert.rejects(readGoSourceExecutionResult(stage, { status: 0 }),
    (error) => error instanceof GoSourceResultError && error.kind === "native"
      && error.message.includes("without a worker result"));
});

test("completed dependency files publish together through the result seam", async () => {
  const { publishGoSourceExecutionResult, bindGoSourceCompletion } = await import("../../eng/go-source-result.mjs");
  const stage = await mkdtemp(path.join(tmpdir(), "go-publication-"));
  await mkdir(path.join(stage, "work"));
  const bytes = Buffer.from('{"ImportPath":"example.com/parser"}\n');
  const worker = { status: "success", outputSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  await writeFile(path.join(stage, "work", "worker-result.json"), JSON.stringify(worker));
  await writeFile(path.join(stage, "work", "go-list.jsonstream"), bytes);
  const output = path.join(stage, "published");
  const session = bindGoSourceCompletion({ cwd: stage },
    (nativeResult) => publishGoSourceExecutionResult(stage, nativeResult, output, JSON.stringify));
  const result = await session.complete({ status: 0 });
  assert.deepEqual(result.worker, worker);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "dependencies.json"), "utf8")), worker);
  assert.deepEqual(await readFile(path.join(output, "go-list.jsonstream")), bytes);
});

test("prepared completion owns its launch snapshot and permits only one result consumption", async () => {
  const { bindGoSourceCompletion } = await import("../../eng/go-source-result.mjs");
  const launch = { arguments: ["fixed"], environment: { TEMP: "E:/work" } };
  let calls = 0;
  const session = bindGoSourceCompletion(launch, async (nativeResult) => {
    calls++;
    assert.equal(nativeResult.status, 125);
    throw new Error("native refusal");
  });
  launch.arguments[0] = "changed";
  assert.equal(session.launch.arguments[0], "fixed");
  assert.throws(() => { session.launch.arguments[0] = "replacement"; }, TypeError);
  const first = session.complete({ status: 125 });
  await assert.rejects(session.complete({ status: 0 }), /already consumed/);
  await assert.rejects(first, /native refusal/);
  await assert.rejects(session.complete({ status: 0 }), /already consumed/);
  assert.equal(calls, 1);
});

test("failed or damaged native results never publish and existing results survive replacement", async () => {
  const { publishGoSourceExecutionResult } = await import("../../eng/go-source-result.mjs");
  const stage = await mkdtemp(path.join(tmpdir(), "go-publication-refusal-"));
  await mkdir(path.join(stage, "work"));
  const bytes = Buffer.from("verified stream");
  const worker = { status: "success", outputSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  await writeFile(path.join(stage, "work", "worker-result.json"), JSON.stringify(worker));
  await writeFile(path.join(stage, "work", "go-list.jsonstream"), bytes);
  const output = path.join(stage, "published");
  await assert.rejects(publishGoSourceExecutionResult(stage, { status: 125 }, output, JSON.stringify),
    (error) => error instanceof GoSourceResultError && error.kind === "native");
  await assert.rejects(readFile(path.join(output, "dependencies.json")), { code: "ENOENT" });
  await writeFile(path.join(stage, "work", "go-list.jsonstream"), "damaged");
  await assert.rejects(publishGoSourceExecutionResult(stage, { status: 0 }, output, JSON.stringify),
    (error) => error instanceof GoSourceResultError && error.kind === "integrity");
  await assert.rejects(readFile(path.join(output, "dependencies.json")), { code: "ENOENT" });
  await writeFile(path.join(stage, "work", "go-list.jsonstream"), bytes);
  await mkdir(output);
  await writeFile(path.join(output, "previous.txt"), "keep previous publication");
  await assert.rejects(publishGoSourceExecutionResult(stage, { status: 0 }, output, JSON.stringify));
  assert.equal(await readFile(path.join(output, "previous.txt"), "utf8"), "keep previous publication");
  await assert.rejects(readFile(path.join(output, "dependencies.json")), { code: "ENOENT" });
});
