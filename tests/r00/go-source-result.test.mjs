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
