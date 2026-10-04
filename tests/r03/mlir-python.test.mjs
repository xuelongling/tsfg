// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { cp, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readMlirPythonTool } from "../../eng/mlir-python.mjs";
import { createMlirFixture } from "./mlir-fixtures.mjs";

test("MLIR build preparation verifies the exact approved Python package before execution", async () => {
  const tool = await readMlirPythonTool({ toolRoot: process.env.TSFG_MLIR_PYTHON_TOOL_ROOT });
  assert.equal(tool.version, "3.14.8");
  assert.equal(tool.archiveSha256, "sha256:a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310");
  assert.equal(tool.files, 37);
  assert.equal(tool.role, "build-only");
  assert.equal(tool.executed, false);
});

test("MLIR Python input guard refuses ambient, relative and system-drive tools", async () => {
  for (const toolRoot of [undefined, "python-tool", "C:\\python-tool"]) {
    await assert.rejects(readMlirPythonTool({ toolRoot }), { issueCode: "mlir-python-integrity" });
  }
});

async function damagedCopy(filter) {
  assert.ok(process.env.TSFG_MLIR_PYTHON_TOOL_ROOT, "actual prepared Python closure must be explicit");
  const root = await createMlirFixture("mlir-python-damaged-");
  await cp(process.env.TSFG_MLIR_PYTHON_TOOL_ROOT, root, { recursive: true, filter });
  // Retain these task-owned corruption fixtures for the single validated cleanup phase.
  return root;
}

test("MLIR Python input guard rejects a changed executable before any execution", async () => {
  const root = await damagedCopy(undefined);
  const executable = path.join(root, "runtime", "python.exe");
  const bytes = await readFile(executable);
  bytes[0] ^= 1;
  await writeFile(executable, bytes);
  await assert.rejects(readMlirPythonTool({ toolRoot: root }), { issueCode: "mlir-python-integrity" });
});

test("MLIR Python input guard rejects missing original component legal materials", async () => {
  const root = await damagedCopy(source => path.basename(source) !== "python-original-LICENSE.txt");
  await assert.rejects(readMlirPythonTool({ toolRoot: root }), { issueCode: "mlir-python-integrity" });
});

test("MLIR Python input guard rejects changed signature trust metadata", async () => {
  const root = await damagedCopy(undefined);
  const trustedRoot = path.join(root, "sigstore-tuf", "tuf-repo-cdn.sigstore.dev", "targets", "trusted_root.json");
  await writeFile(trustedRoot, "{}\n");
  await assert.rejects(readMlirPythonTool({ toolRoot: root }), { issueCode: "mlir-python-integrity" });
});

test("MLIR Python input guard refuses edits that expand the fixed tool-lock approval", async () => {
  const root = await createMlirFixture("mlir-python-lock-damaged-");
  const modulePath = path.join(root, "mlir-python.mjs");
  await copyFile(new URL("../../eng/mlir-python.mjs", import.meta.url), modulePath);
  const lock = JSON.parse(await readFile(new URL("../../eng/mlir-python.lock.json", import.meta.url), "utf8"));
  lock.role = "game-runtime";
  await writeFile(path.join(root, "mlir-python.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  const isolated = await import(pathToFileURL(modulePath).href);
  await assert.rejects(isolated.readMlirPythonTool({ toolRoot: process.env.TSFG_MLIR_PYTHON_TOOL_ROOT }),
    { issueCode: "mlir-python-integrity" });
});
