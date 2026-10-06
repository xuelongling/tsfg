// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readMlirSourceLegalFiles } from "../../eng/mlir-source-legal.mjs";
import { createMlirFixture } from "./mlir-fixtures.mjs";

test("M05 mandatory control flow source registration retains exact fixed-source original terms", async () => {
  const { readMlirSourceBuildLegalInputs } = await import("../../eng/mlir-source-legal.mjs");
  const paths = ["mlir/lib/Dialect/ControlFlow/IR/ControlFlowOps.cpp", "mlir/lib/Dialect/Arith/IR/ArithOps.cpp",
    "mlir/lib/Dialect/Arith/IR/ArithDialect.cpp", "mlir/lib/Dialect/Arith/IR/InferIntRangeInterfaceImpls.cpp",
    "mlir/lib/Dialect/Traits.cpp", "mlir/lib/Dialect/UB/IR/UBOps.cpp", "mlir/lib/Dialect/Arith/IR/ArithCanonicalization.td"];
  const result = await readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE, git: process.env.TSFG_GIT, paths });
  assert.deepEqual(result.files.map(file => file.path), paths);
  for (const file of result.files) {
    assert.equal(file.license, "Apache-2.0 WITH LLVM-exception");
    assert.match(file.completeOriginalNotice, /SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception/);
    assert.equal(file.completeOriginalNotice, file.completeOriginalAttribution);
  }
  assert.equal(result.sourceCommit, "4cb57d27ddcad7c3a89d23ef576662a5c891e8c8");
  assert.equal(result.intakeComplete, false); assert.equal(result.sourceBuild, "not-run");
});

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
  for (const input of [{ paths: ["llvm/lib/Support/xxhash-foreign.h"] },
    { paths: ["llvm/lib/Support/unknown.cpp"] }, { baseCommit: "0".repeat(40) }, { role: "game-runtime" }]) {
    await assert.rejects(readMlirSourceLegalFiles({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
      git: process.env.TSFG_GIT, ...input }), { issueCode: "mlir-source-license" });
  }
});

test("M01 finite supplement admits exact mandatory components and retains the original regex companion", async () => {
  const paths = ["llvm/include/llvm/Support/xxhash.h", "llvm/include/llvm/Support/MD5.h",
    "llvm/lib/Support/UnicodeNameToCodepointGenerated.cpp", "llvm/lib/Support/COPYRIGHT.regex"];
  const result = await readMlirSourceLegalFiles({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths });
  assert.deepEqual(result.files.map(file => file.path), paths);
  assert.deepEqual(result.files.slice(0, 3).map(file => file.license), ["BSD-2-Clause",
    "LicenseRef-LLVM-MD5-public-domain-fallback", "Apache-2.0 WITH LLVM-exception AND Unicode-DFS-2016"]);
  assert.equal(result.files[3].consumption, "original-notice-retention-only");
  assert.match(result.files[3].completeOriginalNotice, /Redistribution and use/);
  assert.equal(result.intakeComplete, false);
  assert.equal(result.sourceBuild, "not-run");
});

test("M01 selected build legal inventory binds mandatory configuration and transitive headers without approving optional scope", async () => {
  const { readMlirSourceBuildLegalInputs } = await import("../../eng/mlir-source-legal.mjs");
  const paths = ["llvm/CMakeLists.txt", "llvm/cmake/modules/HandleLLVMOptions.cmake",
    "llvm/include/llvm/ADT/StringRef.h", "mlir/include/mlir/IR/Operation.h",
    "llvm/include/llvm/Support/xxhash.h", "llvm/include/llvm/Support/MD5.h"];
  const result = await readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths });
  assert.deepEqual(result.files.map(file => file.path), paths);
  assert.equal(result.role, "compiler-side-M01");
  for (const file of result.files) {
    assert.match(file.blob, /^[0-9a-f]{40}$/);
    assert.match(file.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.ok(file.completeOriginalNotice.length > 0);
    assert.ok(file.licenseBasis.length > 0);
  }
  for (const extra of ["third-party/unittest/googletest/src/gtest.cc", "llvm/lib/Support/COPYRIGHT.regex",
    "llvm/lib/Support/unknown.cpp", "mlir/include/mlir/Conversion/ArithAndMathToAPFloat/ArithToAPFloat.h"]) {
    await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
      git: process.env.TSFG_GIT, paths: [extra] }), { issueCode: "mlir-source-license" });
  }
  await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths, role: "game-runtime" }), { issueCode: "mlir-source-license" });
});

test("M01 selected build registration refuses changed original legal materials before source consumption", async () => {
  const root = await createMlirFixture("mlir-build-legal-damaged-");
  for (const name of ["mlir-source-legal.mjs", "mlir-source.mjs", "intake-ledger.mjs", "source-admission.mjs"])
    await copyFile(new URL(`../../eng/${name}`, import.meta.url), path.join(root, name));
  const lock = JSON.parse(await readFile(new URL("../../eng/mlir-source-build-legal.lock.json", import.meta.url), "utf8"));
  lock.licenseMaterials[0].completeOriginalNotice = "incomplete original terms";
  await writeFile(path.join(root, "mlir-source-build-legal.lock.json"), `${JSON.stringify(lock)}\n`);
  const isolated = await import(pathToFileURL(path.join(root, "mlir-source-legal.mjs")).href);
  await assert.rejects(isolated.readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths: ["llvm/CMakeLists.txt"] }), { issueCode: "mlir-source-license" });
});

test("M01 selected build legal reader admits mandatory IR and YAML generators observed in the real target graph", async () => {
  const { readMlirSourceBuildLegalInputs } = await import("../../eng/mlir-source-legal.mjs");
  const paths = ["llvm/lib/IR/LLVMContext.cpp", "llvm/lib/Remarks/YAMLRemarkParser.cpp",
    "mlir/lib/Tools/mlir-tblgen/MlirTblgenMain.cpp", "mlir/include/mlir/Dialect/Linalg/IR/LinalgNamedStructuredOps.yaml"];
  const result = await readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths });
  assert.deepEqual(result.files.map(file => file.path), paths);
  for (const file of result.files) {
    assert.equal(file.license, "Apache-2.0 WITH LLVM-exception");
    assert.equal(file.role, "compiler-side-M01");
  }
  for (const file of result.files.slice(0, 3))
    assert.match(file.completeOriginalNotice, /SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception/);
  assert.equal(result.files[3].completeOriginalNotice,
    "### AUTOGENERATED from core_named_ops.py\n### To regenerate, run: bin/update_core_linalg_named_ops.sh\n");
  assert.ok(result.licenseMaterials.some(material => material.path === "mlir/LICENSE.TXT" &&
    material.completeOriginalNotice.includes("The LLVM Project is under the Apache License v2.0 with LLVM Exceptions:")));
  assert.equal(result.intakeComplete, false);
  assert.equal(result.sourceBuild, "not-run");
});

test("M01 legal reader qualifies mandatory shared TargetParser TableGen includes for the fixed target", async () => {
  const { readMlirSourceBuildLegalInputs } = await import("../../eng/mlir-source-legal.mjs");
  const paths = ["llvm/lib/Target/AArch64/AArch64CallingConvention.td",
    "llvm/lib/Target/ARM/ARMCallingConv.td", "llvm/lib/Target/RISCV/RISCVCallingConv.td"];
  const result = await readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths });
  assert.deepEqual(result.files.map(file => file.path), paths);
  for (const file of result.files) {
    assert.equal(file.license, "Apache-2.0 WITH LLVM-exception");
    assert.equal(file.role, "compiler-side-M01");
    assert.match(file.blob, /^[0-9a-f]{40}$/);
    assert.match(file.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.match(file.completeOriginalNotice, /SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception/);
  }
  assert.equal(result.intakeComplete, false);
});

test("M01 legal reader preserves legacy local notices while selecting the proven approved Apache branch", async () => {
  const { readMlirSourceBuildLegalInputs } = await import("../../eng/mlir-source-legal.mjs");
  const result = await readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths: ["llvm/lib/Target/PowerPC/PPCInstrFuture.td", "llvm/lib/Target/PowerPC/PPCInstrFutureMMA.td"] });
  for (const file of result.files) {
    assert.match(file.completeOriginalNotice, /University of Illinois Open Source/);
    assert.doesNotMatch(file.completeOriginalNotice, /SPDX-License-Identifier/);
    assert.equal(file.originalTermsClassification, "University of Illinois/NCSA Open Source License");
    assert.equal(file.selectedConsumptionExpression, "Apache-2.0 WITH LLVM-exception");
    assert.equal(file.historicalDualLicenseBasis.introductionCommit, "9df924a634ac5ea702b0d8d0d8b737c819a98095");
    assert.equal(file.historicalDualLicenseBasis.policyBlob, "e3b55f832d51ab034e16c3827eb17b789d61f120");
    assert.match(file.historicalDualLicenseBasis.completeOriginalPolicy,
      /all contributions to the project will be made under\s+the terms of both the new license and the legacy license scheme/);
  }
});

test("M01 legal decision refuses mutable approvals, altered notices and transferred file mappings", async () => {
  for (const mutate of [lock => { lock.files[0].path = "llvm/include/llvm/Support/xxhash.h"; },
    lock => { lock.files[0].sha256 = `sha256:${"0".repeat(64)}`; },
    lock => { lock.files[0].notice = ""; }, lock => { lock.baseCommit = "0".repeat(40); }]) {
    const root = await createMlirFixture("mlir-legal-capsule-");
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
