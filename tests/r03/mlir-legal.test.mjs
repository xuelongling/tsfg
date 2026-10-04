// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readMlirSourceLegalFiles } from "../../eng/mlir-source-legal.mjs";

test("M01 legal reader binds the five approved original files to their exact source base", async () => {
  const { readMlirSourceLegalFiles } = await import("../../eng/mlir-source-legal.mjs");
  const result = await readMlirSourceLegalFiles({ sourceRoot: process.env.TSFG_MLIR_SOURCE, git: process.env.TSFG_GIT });
  assert.equal(result.status, "selected-legal-files-verified");
  assert.equal(result.intakeComplete, false);
  assert.equal(result.baseCommit, "fc4aad7b5db3fff421df9a9637605b9ca5667881");
  assert.equal(result.role, "compiler-side-M01");
  assert.deepEqual(result.files.map(file => file.path), ["llvm/lib/Support/xxhash.cpp", "llvm/lib/Support/regstrlcpy.c",
    "llvm/lib/Support/MD5.cpp", "llvm/lib/Support/ConvertUTF.cpp", "llvm/include/llvm/Support/ConvertUTF.h"]);
});

test("M01 legal decision refuses another path, version, unknown component or game-runtime role", async () => {
  for (const input of [{ paths: ["llvm/include/llvm/Support/xxhash.h"] },
    { paths: ["llvm/lib/Support/unknown.cpp"] }, { baseCommit: "0".repeat(40) }, { role: "game-runtime" }]) {
    await assert.rejects(readMlirSourceLegalFiles({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
      git: process.env.TSFG_GIT, ...input }), { issueCode: "mlir-source-license" });
  }
});

test("M01 legal decision refuses mutable approvals, altered notices and transferred file mappings", async () => {
  assert.match(tmpdir(), /^E:[\\/]/i, "negative capsules must remain in the ticket E root");
  for (const mutate of [lock => { lock.files[0].path = "llvm/include/llvm/Support/xxhash.h"; },
    lock => { lock.files[0].sha256 = `sha256:${"0".repeat(64)}`; },
    lock => { lock.files[0].notice = ""; }, lock => { lock.baseCommit = "0".repeat(40); }]) {
    const root = await mkdtemp(path.join(tmpdir(), "mlir-legal-capsule-"));
    for (const name of ["mlir-source-legal.mjs", "mlir-source.mjs", "intake-ledger.mjs", "source-admission.mjs"])
      await copyFile(new URL(`../../eng/${name}`, import.meta.url), path.join(root, name));
    const lock = JSON.parse(await readFile(new URL("../../eng/mlir-source-legal.lock.json", import.meta.url), "utf8"));
    mutate(lock);
    await writeFile(path.join(root, "mlir-source-legal.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    const isolated = await import(pathToFileURL(path.join(root, "mlir-source-legal.mjs")).href);
    await assert.rejects(isolated.readMlirSourceLegalFiles({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
      git: process.env.TSFG_GIT }), { issueCode: "mlir-source-license" });
    // Retain exact owned corruption fixtures for the single validated cleanup phase.
  }
});
