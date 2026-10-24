// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readMlirSourceLegalFiles } from "../../eng/mlir-source-legal.mjs";
import { selectMlirConfigurationPaths } from "../../eng/mlir-sdk-paths.mjs";
import { readMlirLegalRegistration } from "../../eng/mlir-source-registration.mjs";
import { createMlirFixture } from "./mlir-fixtures.mjs";

test("M14 direct configuration selects its source templates before configure", () => {
  const paths = ["llvm/CMakeLists.txt", "llvm/include/module.modulemap.build",
    "llvm/tools/llvm-config/BuildVariables.inc.in", "llvm/utils/llvm-lit/llvm-lit.in",
    "llvm/utils/llvm-lit/llvm-lit.cmd.in", "cmake/ordinary-config.h.in"];
  const excluded = ["llvm/test/ordinary.in", "mlir/examples/ordinary.in", "cmake/docs/ordinary.in",
    "llvm/benchmarks/ordinary.in", "third-party/ordinary.in", "llvm/include/ordinary.build", "llvm/lib/ordinary.cpp"];
  const sourceEntries = [...paths, ...excluded].map(repositoryRelativePath =>
    ({ repositoryRelativePath, blob: "0".repeat(40), sha256: "sha256:" + "0".repeat(64) }));
  assert.deepEqual(selectMlirConfigurationPaths({ sourceEntries }), paths);
  assert.deepEqual(selectMlirConfigurationPaths({ sourceEntries: [] }), [], "classification cannot discover another input");
});

test("M14 configuration registration binds four fixed original templates and notices", async () => {
  const { lock } = await readMlirLegalRegistration("build");
  const expected = [
    ["llvm/include/module.modulemap.build", "100644", "2a5b23f2a41283a208a55a94418fda5374d5c0b7",
      "sha256:5d9e46ce85116d9bc6593ac2af296c60c57852a1d9227ff99eaca7ecaef2d2d5", "72",
      "sha256:23eac7ddbbf0db3c74e20cafb5a3070996f3cb99a201631e1d71fe941ef8a653"],
    ["llvm/tools/llvm-config/BuildVariables.inc.in", "100644", "e4e1d449bf4d707dec3a13ac98fe4bb32ea758f8",
      "sha256:88cf17b87211fa4a649a450dffb1e032e3fc94df0ba5ddba78e1023024294feb", "732",
      "sha256:2a319994a36aad15409e16714407308ee4f4397b1cfef39b4861f8ee28ba3350"],
    ["llvm/utils/llvm-lit/llvm-lit.cmd.in", "100644", "a18d5316cc8d61d5f0da8ca924b081c781de8089",
      "sha256:056076a30657f45315f23be88d0e056c7f1f10370271ce0a276dfac3ad44a95a", "0",
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["llvm/utils/llvm-lit/llvm-lit.in", "100755", "0b6683b6b62300f2f63df6a2ad98d96615739dfe",
      "sha256:927f66770d42360a62788466e0114e25b144ead94af513cd766f550feaebcb85", "48",
      "sha256:f1db4f136ffa12d14cea29ff1114e28917e836ff4917da3ad563de886ff72113"]
  ];
  const added = lock.files.slice(6952, 6956);
  assert.deepEqual(added.map(file => [file.path, file.mode, file.blob, file.sha256, file.noticeEnd, file.noticeSha256]), expected);
  assert.equal(lock.sourceCommit, "4cb57d27ddcad7c3a89d23ef576662a5c891e8c8");
  assert.equal(lock.baseCommit, "fc4aad7b5db3fff421df9a9637605b9ca5667881");
  assert.equal(lock.licenseMaterials.length, 5);
  for (const file of added) {
    assert.equal(file.role, "compiler-side-M01");
    assert.equal(file.license, "Apache-2.0 WITH LLVM-exception");
    assert.deepEqual(file.licenseMaterialPaths, ["llvm/LICENSE.TXT"]);
    assert.equal(file.noticeStart, "0");
    assert.equal(Buffer.byteLength(file.completeOriginalAttribution), Number(file.noticeEnd));
    assert.equal(file.completeOriginalNotice, file.completeOriginalAttribution);
    assert.equal("sha256:" + createHash("sha256").update(file.completeOriginalAttribution).digest("hex"), file.noticeSha256);
    if (file.path.includes("BuildVariables"))
      assert.match(file.completeOriginalAttribution, /SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception/);
    else {
      assert.doesNotMatch(file.completeOriginalAttribution, /SPDX-License-Identifier/);
      assert.match(file.licenseBasis.join(" "), /project grant/);
    }
  }
  const approval = await readMlirLegalRegistration("file");
  assert.equal(approval.sha256, "sha256:30024bdeb99966ec45d01961b675bcc5e8f8fa94c7cab3208a205b68a325f04c");
  assert.ok(added.every(file => !approval.lock.files.some(prior => prior.path === file.path)));
});

test("M14 template classification cannot approve an unknown input or Runtime role", async () => {
  const { readMlirSourceBuildLegalInputs } = await import("../../eng/mlir-source-legal.mjs");
  const name = "llvm/include/not-registered-config-template.in";
  const paths = selectMlirConfigurationPaths({ sourceEntries: [
    { repositoryRelativePath: name, blob: "0".repeat(40), sha256: "sha256:" + "0".repeat(64) }] });
  assert.deepEqual(paths, [name]);
  await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: undefined, git: undefined, paths }),
    /No qualified mandatory build input: llvm\/include\/not-registered-config-template\.in/);
  await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: undefined, git: undefined,
    paths: ["llvm/include/module.modulemap.build"], role: "game-runtime" }), /compiler-side M01 only/);
});

test("M14 configured source presence binds the exact reviewed supplement without granting unresolved sources", async () => {
  const { lock } = await readMlirLegalRegistration("build");
  const hash = value => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(hash(lock.files.slice(0, 6956)), "sha256:a6fe96cc53e5da87ebab9347d554800e1b22623206e7a1fa6dd658a97876737c");
  assert.equal(hash(lock.licenseMaterials), "sha256:1362f33d6d0378ac7e10464f28c2d025e9332f12e8e7eabe7422921412ea1755");
  const added = lock.files.slice(6956);
  assert.equal(added.length, 1188);
  assert.equal(hash(added.slice(0, 1186).map(file => [file.path, file.mode, file.blob, file.sha256, file.noticeSha256])),
    "sha256:b270e56a365edfc50c462819d3094b9796b9fdce311ad4fcd577547ee9d35d59");
  assert.deepEqual(added.slice(1186).map(file => [file.path, file.blob, file.sha256, file.noticeEnd, file.noticeSha256]), [
    ["mlir/lib/Conversion/ComplexToStandard/ComplexToStandard.cpp", "9e46b7d78baca6db65c31e44292420509769fbf4",
      "sha256:17d923a6f93461cdfb7787b85c7100df7c9a8055ad8eca24e8b34c566a07173c", "370",
      "sha256:f0b96cbbaeddba106cee8d4eca6ea19fa04fd2859a80192dc2bec7c5a00fd2d4"],
    ["mlir/lib/Dialect/Math/Transforms/PolynomialApproximation.cpp", "cd014f5f530f0ebf704c5440d82c97caaaaf7c86",
      "sha256:bd1506b56e0f3583b62b87c0fca272805d1d043421d4f7af25b8b86fbc8b7168", "586",
      "sha256:bab2911d3215ee7e3cef8d18bf3d1dfa9b6f5213e63947197167bbdd654c23ee"]
  ]);
  assert.match(added[1186].licenseBasis.join("\n"), /Algorithm copied from cephes cosm1\./);
  for (const reference of ["stackoverflow.com/a/42683455", "35966695", "Shepherd and J. G. Laframboise", "Polynomial approximation from Cephes."])
    assert.ok(added[1187].licenseBasis.join("\n").includes(reference));
  assert.equal(added.filter(file => file.completeOriginalAttribution.includes("SPDX-License-Identifier")).length, 1172);
  for (const file of added) {
    assert.equal(file.mode, "100644"); assert.equal(file.role, "compiler-side-M01");
    assert.equal(file.license, "Apache-2.0 WITH LLVM-exception");
    assert.equal(file.checkoutByteNormalization, "none"); assert.equal(file.observedCheckoutSha256, file.sha256);
    assert.equal(file.noticeStart, "0");
    assert.equal(Buffer.byteLength(file.completeOriginalAttribution), Number(file.noticeEnd));
    assert.equal(file.completeOriginalNotice, file.completeOriginalAttribution);
    assert.equal("sha256:" + createHash("sha256").update(file.completeOriginalNotice).digest("hex"), file.noticeSha256);
    assert.deepEqual(file.licenseMaterialPaths, [file.path.startsWith("llvm/") ? "llvm/LICENSE.TXT" : "mlir/LICENSE.TXT"]);
    assert.match(file.use, /configuration source presence/); assert.match(file.use, /no optional-library\/backend compilation/);
  }
  const { readMlirDirectSourceSelection } = await import("../../eng/mlir-static-closure.mjs");
  const selected = await readMlirDirectSourceSelection({ baseCommit: lock.baseCommit, sourceCommit: lock.sourceCommit,
    sourceTree: "1ad1b903614825daa3ca3a5258fbb21e08d3c580", inspectedFiles: [] }, { role: "static" });
  assert.match(selected.qualification, /finite registered candidate/);
  const visible = new Set(selected.entries.map(file => file.repositoryRelativePath));
  assert.ok(added.every(file => visible.has(file.path)));
  const { readMlirSourceBuildLegalInputs } = await import("../../eng/mlir-source-legal.mjs");
  for (const name of ["mlir/lib/Conversion/MPIToLLVM/MPIToLLVM.cpp", "mlir/lib/Dialect/GPU/Transforms/EliminateBarriers.cpp",
    "llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp"]) {
    assert.ok(!visible.has(name));
    await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: undefined, git: undefined, paths: [name] }),
      /No qualified mandatory build input:/);
  }
  await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: undefined, git: undefined,
    paths: [added[0].path], role: "game-runtime" }), /compiler-side M01 only/);
});

test("M18 normal Core mandatory AOT sources retain exact standard and project-grant inputs", async () => {
  const { readMlirSourceBuildLegalInputs } = await import("../../eng/mlir-source-legal.mjs");
  const paths = ["llvm/lib/Analysis/AliasAnalysis.cpp", "llvm/lib/CodeGen/SelectionDAG/TargetLowering.cpp",
    "llvm/lib/Analysis/StaticDataProfileInfo.cpp", "mlir/lib/Analysis/SliceWalk.cpp"];
  const result = await readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths });
  assert.deepEqual(result.files.map(file => file.path), paths);
  for (const file of result.files) {
    assert.equal(file.license, "Apache-2.0 WITH LLVM-exception");
    assert.equal(file.role, "compiler-side-M01");
    assert.match(file.blob, /^[0-9a-f]{40}$/);
    assert.match(file.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.ok(file.licenseBasis.length > 0);
  }
  for (const file of result.files.slice(0, 2))
    assert.match(file.completeOriginalAttribution, /SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception/);
  for (const file of result.files.slice(2)) {
    assert.equal(file.noticeStart, "0"); assert.equal(file.noticeEnd, "0");
    assert.equal(file.completeOriginalAttribution, "");
  }
  await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths: ["llvm/lib/Target/AArch64/AArch64TargetMachine.cpp"] }),
  { issueCode: "mlir-source-license" });
  // The copied table's source-specific grant remains unresolved.
  await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths: ["llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp"] }),
  { issueCode: "mlir-source-license" });
});

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
  for (const name of ["mlir-source-registration.mjs", "intake-ledger.mjs", "source-admission.mjs"])
    await copyFile(new URL(`../../eng/${name}`, import.meta.url), path.join(root, name));
  const lock = JSON.parse(await readFile(new URL("../../eng/mlir-source-build-legal.lock.json", import.meta.url), "utf8"));
  lock.licenseMaterials[0].completeOriginalNotice = "incomplete original terms";
  await writeFile(path.join(root, "mlir-source-build-legal.lock.json"), `${JSON.stringify(lock)}\n`);
  const isolated = await import(pathToFileURL(path.join(root, "mlir-source-registration.mjs")).href);
  await assert.rejects(isolated.readMlirLegalRegistration("build"), { issueCode: "mlir-source-license" });
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
