// SPDX-License-Identifier: MIT
// Private Hermetic Build Entry seam. A caller supplies a native process result,
// never a worker-authored substitute for the supervisor's exit status.
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export class GoSourceResultError extends Error {
  constructor(kind, message, worker = undefined) {
    super(message);
    this.kind = kind;
    this.worker = worker;
  }
}

async function readResultFile(file, description) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isFile()) throw new Error("not a regular file");
    return await handle.readFile();
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    throw new Error(`${description} is not a stable regular file: ${error.message}`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** @param {{status: number | null, error?: Error, stderr?: string}} nativeResult */
export async function readGoSourceExecutionResult(stageRoot, nativeResult) {
  const workRoot = path.join(stageRoot, "work");
  let worker, receiptError;
  try {
    worker = JSON.parse((await readResultFile(path.join(workRoot, "worker-result.json"), "Go worker result")).toString("utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") receiptError = error;
  }
  if (nativeResult.error || nativeResult.status !== 0) {
    if (!nativeResult.error && nativeResult.status === 20
        && ["go-version", "dependency-resolution"].includes(worker?.phase)) {
      throw new GoSourceResultError("go", worker.message, worker);
    }
    throw new GoSourceResultError("native",
      `Go native supervisor failed (${nativeResult.status}): ${nativeResult.error?.message ?? nativeResult.stderr}`
        + (receiptError ? `; worker receipt unavailable: ${receiptError.message}` : ""), worker);
  }
  if (receiptError) throw new GoSourceResultError("native", `Go worker receipt unavailable: ${receiptError.message}`);
  if (!worker) throw new GoSourceResultError("native", "Go supervisor returned without a worker result");
  if (worker.status !== "success") throw new GoSourceResultError("worker", worker.message ?? "Go dependency resolution failed", worker);
  const outputBytes = await readResultFile(path.join(workRoot, "go-list.jsonstream"), "Go dependency output");
  const actual = `sha256:${createHash("sha256").update(outputBytes).digest("hex")}`;
  if (actual !== worker.outputSha256) throw new GoSourceResultError("integrity", "Go dependency output changed", worker);
  return { worker, outputBytes };
}
