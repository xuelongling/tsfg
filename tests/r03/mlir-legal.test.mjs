// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readMlirSourceBuildLegalInputs, readMlirSourceLegalFiles } from "../../eng/mlir-source-legal.mjs";
import { selectMlirConfigurationPaths } from "../../eng/mlir-sdk-paths.mjs";
import { readMlirLegalRegistration } from "../../eng/mlir-source-registration.mjs";
import { createMlirFixture } from "./mlir-fixtures.mjs";

test("M39 mandatory private headers reader retains exact18 identities and complete notices", async t => {
  t.diagnostic(`actual source-reader PID ${process.pid}`);
  const expected = [
    ["llvm/lib/ExecutionEngine/MCJIT/MCJIT.h","fbe64fabd3240f180ea2d91ffceee98dceb4802a","sha256:45aa87ede2f6f3bd5a7bfa7c8cf29e5697ecd7edae73dea542b977ec8cad4a49",13272,"369","sha256:206bb3d746d32e37780b364a6c5b8fb234489ed4e05982e3223abe5c4a9be5da"],
    ["llvm/lib/ExecutionEngine/Orc/TargetProcess/OrcRTBootstrap.h","92b513d0bb53d90d97704de092cf848a75bf674b","sha256:9cd93b406affb8fef16db11679bc7345c906565d7f7e8f77c92dfe9d32c8b6f5",1287,"369","sha256:c1df0b0d639458e8955e9457397c200d08faf42fa27ef1b0e81a5e88b6b4906b"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/RuntimeDyldCOFF.h","8ca1c2e4efc3f4dd2420c211dd323a5a34750ba1","sha256:fe0d99f91e0b07bcdc658c3dace068d7613e7ee3562a95721a0318ea0ec51903",2131,"369","sha256:a7df3bbe07db2c73c2a8f07f3c76003f101f1db233b2d0a01b6f237724c930ea"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/RuntimeDyldCheckerImpl.h","bda554e9e5b673c61e6685081af2fe57d44636b6","sha256:25501c8916207267390fd8c88d40a17d46c935e0f69a165b6641e646191e68b1",3178,"369","sha256:136cb2607e38f49c2047e3726e67237c77ebabb520a5191b471952b3bf9192fd"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/RuntimeDyldELF.h","deb623b1a4bef24cb570291191898d9ddc140648","sha256:c35654e200db387f9f0a972c7e338f6fef692f90fbcd23fd1602f1a012c42c08",10820,"369","sha256:c61c93988aea256428ac2dc2006bd8561818d8f712abe326cdbdb108afe69cad"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/RuntimeDyldImpl.h","89b20978c40e6722604d73b9d3d64ef1e46c3dd3","sha256:2bd2d6e2960d1203e29b55d7c9f24a0196ef572638c710eb766bef775c040e8c",22651,"369","sha256:a91bf7b493bff89ef5cba7c4e76301ebc0aa4d588c739948b62cb8011b46785d"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/RuntimeDyldMachO.h","061d0e8cbe94329bce66d2a8ab8a70ca01b074ef","sha256:689a67195791c313d88c356f31a2a9baf4e9240e3a4528fae1ad3547dc8303a1",6617,"369","sha256:b55c3c43cefbbe1f75b09b9e64032edfb398d9bac7492a797776575c74f542e0"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/Targets/RuntimeDyldCOFFAArch64.h","3ca6309874de5f2febe47aa9e4a10f270e769d3d","sha256:950342887f8108dc9a8773ef3d4c966609238d49358caac32237a9f2ae305ec0",13860,"369","sha256:5869c1e2496debaf807a2153dbce11fed67ab48300eecceff3e80805935bcb3f"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/Targets/RuntimeDyldCOFFI386.h","0d5afc289b8c5acd1fd3210070279bd3f85f344b","sha256:ee00c262e935e23852c9ca9ee5fd9fbae2db8b4cd94960e859a52b03b3c437c9",8501,"369","sha256:c49212a7db96af2806a9b6146bf1806c70816e2a38184179cee7b0342eb3c36b"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/Targets/RuntimeDyldCOFFThumb.h","19e42253ab1d79f76467b2d7e786d34fc1c95344","sha256:9e4171ed0e2234e234a509a4658bc75921d2d13889529cecd37c07c96753848c",13626,"369","sha256:86becb6b73d057b15c93102feaf14349ff9e9f548199218882d56128daf22d8c"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/Targets/RuntimeDyldCOFFX86_64.h","2a45535f68fa0834b2c0aae6073ee5137a142928","sha256:3f9779b3a49a2250480f6f9ebe947c9989b30d3fce59c8d28446fafc2054e730",12714,"369","sha256:a07b2fecd86231d5d12d503a41ba3f7695946535e6b9e48e72ade29d853b0ce5"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/Targets/RuntimeDyldELFMips.h","f03acb41d6703e21f381b36343a6c37227153ef3","sha256:46418b40bde19d3ee39ebd03fdaff277cfefdd16db966d433203bd178ad01ed1",2631,"369","sha256:f866c0f8816273d65dfd35aa262ddbf8e69b215c43a486f835c6ac8474a279aa"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/Targets/RuntimeDyldMachOAArch64.h","222928e1a2d2048efadbd650b127eed937b56a92","sha256:35345e3fcabc15294073967536344657334c3de214ddf7d5c35cfada51e87435",22078,"369","sha256:cc0962886c3936f21349964021a578adac56bfbdbec6c7992eff62894d3394c1"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/Targets/RuntimeDyldMachOARM.h","79b558eb7796dd0c0ab580c0fe524f5aa7b7f54a","sha256:a1ab5d73b786a8f236654c29e7a2b553c7fdbba7c241171553c595a15f0c41a3",16969,"369","sha256:99b8088029749f74738f1e7be2e2f242ce8be5d3caf1766bbe3ddb3ecdeab553"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/Targets/RuntimeDyldMachOI386.h","a983e22671b24e8858221133cc134c794f0ad3ae","sha256:c60ef55428b954f50752a3d355f84f66ca5a1a6b078945469bbda5e641f740dc",9741,"369","sha256:137642374f50c4d98dbb0e352d9bb7b41c795ca52e9bf6e930c640a9d190cc9c"],
    ["llvm/lib/ExecutionEngine/RuntimeDyld/Targets/RuntimeDyldMachOX86_64.h","0e95369fbedb03b7f22c2d85ac2f027066ffbe9b","sha256:782039ba4d83ab4537f27cbddb662ca3b021e4420e9b988c3a3893b4cc6b4452",8614,"369","sha256:823bf6620f2066c642c5cbf07fe5a1bf00932bd45bc2e8e00041d8fe3a6a5070"],
    ["llvm/lib/Target/X86/AsmParser/X86AsmParserCommon.h","b39cb33604ea525c2ee1164907a37415a31287e6","sha256:3e5129e516bc919e385543ab17a21f4be714768be6bd494ee5bffdfc8bfbf95d",1305,"368","sha256:078f0c28aef07eb5aa7b9a19baf02387655fe5ed097cc0f8f98deeaa66a4aa6b"],
    ["llvm/lib/Target/X86/AsmParser/X86Operand.h","acc5caa9c436f148919a82dff308d83b0f6878db","sha256:7ba827019878bf7e84b5243ee606f627bceb7dbb81391ec868f7ed4b0f332e25",25636,"369","sha256:306113407cd6c291ea9fe6a9a469a0f1e2dfa29d1fefff1975a472a47cd8b203"]
  ];
  const result = await readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths: expected.map(file => file[0]) });
  assert.equal(result.status, "selected-build-legal-inputs-verified");
  assert.equal(result.sourceCommit, "4cb57d27ddcad7c3a89d23ef576662a5c891e8c8");
  assert.equal(result.baseCommit, "fc4aad7b5db3fff421df9a9637605b9ca5667881");
  assert.equal(result.role, "compiler-side-M01");
  assert.equal(result.sourceBuild, "not-run");
  assert.equal(result.intakeComplete, false);
  const registration = await readMlirLegalRegistration("build");
  assert.equal(registration.lock.files.length, 8166);
  assert.equal("sha256:" + createHash("sha256").update(JSON.stringify(registration.lock.files.slice(0, 8148))).digest("hex"), "sha256:4202b4f33fdbd901a29af59679864b68c127dee62b094a19e22803d224b63ba2");
  assert.deepEqual(result.files.map(file => [file.path, file.mode, file.blob, file.sha256]),
    expected.map(([name, blob, sha256]) => [name, "100644", blob, sha256]));
  assert.deepEqual(result.licenseMaterials, registration.lock.licenseMaterials);
  for (const [index, file] of result.files.entries()) {
    const [, , sha256, bytes, noticeEnd, noticeSha256] = expected[index];
    assert.equal(file.license, "Apache-2.0 WITH LLVM-exception");
    assert.deepEqual(file.licenseMaterialPaths, ["llvm/LICENSE.TXT"]);
    assert.deepEqual([file.noticeStart, file.noticeEnd, file.noticeSha256], ["0", noticeEnd, noticeSha256]);
    const raw = await readFile(path.join(process.env.TSFG_MLIR_SOURCE, file.path));
    assert.equal(raw.length, bytes);
    assert.equal("sha256:" + createHash("sha256").update(raw).digest("hex"), sha256);
    const notice = raw.subarray(0, Number(noticeEnd));
    assert.ok(notice.equals(Buffer.from(file.completeOriginalAttribution)));
    assert.equal("sha256:" + createHash("sha256").update(notice).digest("hex"), noticeSha256);
    assert.equal(file.completeOriginalNotice, file.completeOriginalAttribution);
    assert.match(file.completeOriginalNotice, /SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception/);
  }
});

test("M39 llvm-config source reader retains fixed identity and complete original notice", async t => {
  t.diagnostic(`actual source-reader PID ${process.pid}`);
  const name = "llvm/tools/llvm-config/llvm-config.cpp";
  const result = await readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths: [name] });
  assert.equal(result.status, "selected-build-legal-inputs-verified");
  assert.equal(result.sourceCommit, "4cb57d27ddcad7c3a89d23ef576662a5c891e8c8");
  assert.equal(result.baseCommit, "fc4aad7b5db3fff421df9a9637605b9ca5667881");
  assert.equal(result.role, "compiler-side-M01");
  assert.equal(result.sourceBuild, "not-run");
  assert.equal(result.intakeComplete, false);
  assert.equal(result.files.length, 1);
  const registration = await readMlirLegalRegistration("build");
  assert.equal(registration.lock.files.length, 8166);
  assert.equal("sha256:" + createHash("sha256").update(JSON.stringify(registration.lock.files.slice(0, 8147))).digest("hex"),
    "sha256:4b72673f8c78e24e16e961b44b48b7766eebd5749e3ecb912388c6556fb9084c");
  const file = result.files[0];
  assert.deepEqual([file.path, file.mode, file.blob, file.sha256], [name, "100644",
    "24ea264419af4a5be8c994e0ae98aca3738e77b1",
    "sha256:db054b58b71a339b02b5ff1612da22d52ff567d4dea5544c29897d246042d111"]);
  assert.equal(file.license, "Apache-2.0 WITH LLVM-exception");
  assert.deepEqual(file.licenseMaterialPaths, ["llvm/LICENSE.TXT"]);
  assert.equal(file.noticeStart, "0");
  assert.equal(file.noticeEnd, "369");
  assert.equal(file.noticeSha256, "sha256:180d5824cd28cfbbddc8734ed986d676aa021d42551b251193f307a7d8d75b47");
  const raw = await readFile(path.join(process.env.TSFG_MLIR_SOURCE, name));
  assert.equal(raw.length, 29159);
  assert.equal("sha256:" + createHash("sha256").update(raw).digest("hex"), file.sha256);
  assert.ok(raw.subarray(0, 369).equals(Buffer.from(file.completeOriginalAttribution)));
  assert.equal(file.completeOriginalNotice, file.completeOriginalAttribution);
  assert.match(file.completeOriginalNotice, /SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception/);
});

test("M39 fixed X86 source reader retains declared license and original attributions", async t => {
  t.diagnostic(`actual source-reader PID ${process.pid}`);
  const name = "llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp";
  const result = await readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths: [name] });
  assert.equal(result.status, "selected-build-legal-inputs-verified");
  assert.equal(result.sourceCommit, "4cb57d27ddcad7c3a89d23ef576662a5c891e8c8");
  assert.equal(result.baseCommit, "fc4aad7b5db3fff421df9a9637605b9ca5667881");
  assert.equal(result.intakeComplete, false);
  assert.equal(result.sourceBuild, "not-run");
  assert.equal(result.files.length, 1);
  const registration = await readMlirLegalRegistration("build");
  assert.equal(registration.lock.files.length, 8166);
  assert.equal("sha256:" + createHash("sha256").update(JSON.stringify(registration.lock.files.slice(0, 8146))).digest("hex"),
    "sha256:89a0b879eaa69d89dda4bdbcbb8a0f3fa564c23ca7230d417e5855c687bba163");
  const file = result.files[0];
  assert.deepEqual([file.path, file.mode, file.blob, file.sha256], [name, "100644",
    "76731437931a74f405d37e57365c0df86e81f9f4",
    "sha256:a4229a4f46ebea0949314e557aacebe05ba2566850b20e5e2631ef5c5e336e85"]);
  assert.equal(file.license, "Apache-2.0 WITH LLVM-exception");
  assert.deepEqual(file.licenseMaterialPaths, ["llvm/LICENSE.TXT"]);
  const raw = await readFile(path.join(process.env.TSFG_MLIR_SOURCE, name));
  assert.equal(raw.length, 61437);
  const hash = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(raw), file.sha256);
  assert.equal(file.noticeStart, "0");
  assert.equal(file.noticeEnd, "574");
  assert.equal(file.noticeSha256, "sha256:225f924c484b1fc72887210372ab563b14d791d1ee85121761f242ab78482389");
  assert.ok(raw.subarray(0, 574).equals(Buffer.from(file.completeOriginalAttribution)));
  assert.match(file.completeOriginalNotice, /SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception/);
  const copied = file.copiedMaterial;
  assert.equal(copied.sourceUrl, "https://gist.github.com/dougallj/81a80cd381988466c4e1c4889ecac95b#file-2-x86-base-txt");
  assert.equal(copied.sourceFileBlob, file.blob);
  assert.equal(copied.gistRevision, "UNKNOWN");
  assert.equal(copied.policyScope, "UNKNOWN");
  assert.equal(copied.releaseReview, "consolidated-pre-release");
  assert.equal(copied.developmentDecision, "ECP2026-0007");
  assert.equal(copied.supplementaryGrant, "UNKNOWN");
  assert.equal(copied.noticeStart, "23042");
  assert.equal(copied.noticeEnd, "23360");
  assert.equal(copied.noticeSha256, "sha256:2d1f6042176f47540d12b99db2de8f78f9f1e3eb958d1f5dac7d1f43b4974b0e");
  assert.ok(raw.subarray(23042, 23360).equals(Buffer.from(copied.completeOriginalAttribution)));
  assert.equal(hash(Buffer.from(copied.completeOriginalAttribution)), copied.noticeSha256);
  assert.match(copied.completeOriginalAttribution, /This table was taken from/);
  assert.match(copied.completeOriginalAttribution, /with slight massaging\./);
  assert.equal(file.completeOriginalNotice, file.completeOriginalAttribution + copied.completeOriginalAttribution);
});

test("M39 fixed X86 source reader refuses unknown input and Runtime role", async () => {
  await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths: ["llvm/lib/Target/X86/MCTargetDesc/NotRegistered.cpp"] }),
  /No qualified mandatory build input:/);
  await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: process.env.TSFG_MLIR_SOURCE,
    git: process.env.TSFG_GIT, paths: ["llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp"], role: "game-runtime" }),
  /compiler-side M01 only/);
});

test("M39 fixed copied-material registration refuses changed identity grant and attribution", async () => {
  const original = (await readMlirLegalRegistration("build")).lock;
  for (const changed of ["identity", "grant", "attribution"]) {
    const root = await createMlirFixture("mlir-x86-" + changed + "-");
    for (const name of ["mlir-source-registration.mjs", "intake-ledger.mjs", "source-admission.mjs"])
      await copyFile(new URL(`../../eng/${name}`, import.meta.url), path.join(root, name));
    const lock = structuredClone(original);
    const file = lock.files.find(file => file.path === "llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp");
    if (changed === "identity") lock.sourceCommit = "0".repeat(40);
    if (changed === "grant") file.copiedMaterial.supplementaryGrant = "MIT";
    if (changed === "attribution") file.copiedMaterial.completeOriginalAttribution = "incomplete attribution";
    await writeFile(path.join(root, "mlir-source-build-legal.lock.json"), `${JSON.stringify(lock)}\n`);
    const isolated = await import(pathToFileURL(path.join(root, "mlir-source-registration.mjs")).href);
    await assert.rejects(isolated.readMlirLegalRegistration("build"), { issueCode: "mlir-source-license" });
  }
});

test("M14 pinned MPI transformation binds its original notice and refuses caller grants", async () => {
  const legal = await import("../../eng/mlir-source-legal.mjs");
  const { lock, sha256 } = await readMlirLegalRegistration("build");
  const policy = await legal.readMlirStagedSourcePolicy(lock);
  const name = "mlir/lib/Conversion/MPIToLLVM/MPIToLLVM.cpp";
  const descriptor = legal.mlirStagedSourceDescriptor(policy, name);
  assert.ok(descriptor);
  assert.deepEqual(descriptor.original, { blob: "59a16df9c59d32c9fe64d941289bcb1aa1070cc5",
    sha256: "sha256:03f6877003751099bbfcf06b1baf976969f74f9b040a09544f97279ae6590349", bytes: 31514 });
  assert.deepEqual(descriptor.staged, { sha256: "sha256:fb3c5a436b11efc34f1ba733636688d1f377c673504da4e2fa2f4be0b26ba7c0", bytes: 33414 });
  assert.equal(descriptor.notice.commit, "e0b3d1dd2c62c80048e5fc3b60d0b24e0d2a863d");
  assert.equal(descriptor.notice.blob, "f33ad73b89bf3e3a967fba9650df0e6d28e5a569");
  assert.equal(descriptor.notice.expression, "mpich2");
  assert.equal(Buffer.byteLength(descriptor.notice.completeOriginalNotice), 1893);
  assert.equal(createHash("sha256").update(descriptor.notice.completeOriginalNotice).digest("hex"),
    "60fc73dd0d561c98aa1987fcd68c57be2fcb55add62ad69d3a35f42e10967399");
  assert.throws(() => legal.deriveMlirStagedSource(policy, name, Buffer.from("owned ordinary fixture")),
    /Original staged-transformation source changed:/);
  assert.throws(() => legal.deriveMlirStagedSource({ registrationLockSha256: sha256 }, name, Buffer.from("owned")),
    /Unknown staged transformation policy/);
  assert.throws(() => legal.assertMlirStagedSourceSelection(policy, null), /require direct-source static selection/);
  const foreign = await legal.readMlirStagedSourcePolicy({ ...lock, sourceCommit: "0".repeat(40) });
  assert.throws(() => legal.mlirStagedSourceDescriptor(foreign, name), /another immutable source identity/);
  await assert.rejects(legal.readMlirSourceBuildLegalInputs({ sourceRoot: undefined, git: undefined, paths: [name], role: "game-runtime" }),
    /compiler-side M01 only/);
});

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
  const added = lock.files.slice(6956, 8146);
  assert.equal(added.length, 1190);
  assert.equal(hash(lock.files.slice(0, 8145)), "sha256:9e0ada822845e0a3647dbc5df332f975cf2d2e4a2ea1183f7a033cf39675c3b4");
  assert.equal(hash(lock.files.slice(0, 8144)), "sha256:55e7288987a41e996e9e73779085bfe6f229d1182b1a1d2b9ec6bc2c772b4ef9");
  assert.equal(hash(added.slice(0, 1186).map(file => [file.path, file.mode, file.blob, file.sha256, file.noticeSha256])),
    "sha256:b270e56a365edfc50c462819d3094b9796b9fdce311ad4fcd577547ee9d35d59");
  assert.deepEqual(added.slice(1186).map(file => [file.path, file.blob, file.sha256, file.noticeEnd, file.noticeSha256]), [
    ["mlir/lib/Conversion/ComplexToStandard/ComplexToStandard.cpp", "9e46b7d78baca6db65c31e44292420509769fbf4",
      "sha256:17d923a6f93461cdfb7787b85c7100df7c9a8055ad8eca24e8b34c566a07173c", "370",
      "sha256:f0b96cbbaeddba106cee8d4eca6ea19fa04fd2859a80192dc2bec7c5a00fd2d4"],
    ["mlir/lib/Dialect/Math/Transforms/PolynomialApproximation.cpp", "cd014f5f530f0ebf704c5440d82c97caaaaf7c86",
      "sha256:bd1506b56e0f3583b62b87c0fca272805d1d043421d4f7af25b8b86fbc8b7168", "586",
      "sha256:bab2911d3215ee7e3cef8d18bf3d1dfa9b6f5213e63947197167bbdd654c23ee"],
    ["mlir/lib/Dialect/GPU/Transforms/EliminateBarriers.cpp", "025d1acf8d6bacc00453a61f56ede30f878c0bb2",
      "sha256:970ed0542ebc35d104f4a0ca58fce37cd14f8efbeb284cd6da96b6d571e00fca", "867",
      "sha256:13b6829ab88fd594694f8ff7d7e0eca620cc9205e90b86e082109bff68b74f74"],
    ["mlir/lib/Conversion/MPIToLLVM/MPIToLLVM.cpp", "59a16df9c59d32c9fe64d941289bcb1aa1070cc5",
      "sha256:03f6877003751099bbfcf06b1baf976969f74f9b040a09544f97279ae6590349", "502",
      "sha256:39002e3c6bdae8c7af60b088b6f617c822893e9b054f6aa403b06b3f58327043"]
  ]);
  assert.match(added[1186].licenseBasis.join("\n"), /Algorithm copied from cephes cosm1\./);
  for (const reference of ["stackoverflow.com/a/42683455", "35966695", "Shepherd and J. G. Laframboise", "Polynomial approximation from Cephes."])
    assert.ok(added[1187].licenseBasis.join("\n").includes(reference));
  assert.equal(added.filter(file => file.completeOriginalAttribution.includes("SPDX-License-Identifier")).length, 1174);
  assert.match(added[1188].completeOriginalAttribution, /implementation in Polygeist\./);
  for (const reference of ["c0fd591a92ba5ed26ecd0a8df4732c71d6730255", "117691b3b9af2be33ef2f5e3aa4e28a43ec4a616",
    "f2db94d30c9657f2556732f3e80973d49fc4d093eede0a54ffda88152296f695", "e288f7b56fe108435b99a6ffcc3f64958dca1ff3",
    "9ab34689b08ee66f0868d38456fccc8b80d1b656", "https://github.com/llvm/Polygeist/blob/"])
    assert.ok(added[1188].licenseBasis.join("\n").includes(reference));
  for (const file of added) {
    assert.equal(file.mode, "100644"); assert.equal(file.role, "compiler-side-M01");
    assert.equal(file.license, file.path === "mlir/lib/Conversion/MPIToLLVM/MPIToLLVM.cpp"
      ? "(Apache-2.0 WITH LLVM-exception) AND mpich2" : "Apache-2.0 WITH LLVM-exception");
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
  for (const name of ["llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp"]) {
    assert.ok(!visible.has(name));
    assert.ok(lock.files.some(file => file.path === name));
    await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot: undefined, git: undefined,
      paths: ["llvm/lib/Target/X86/MCTargetDesc/NotRegistered.cpp"] }),
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
  const { lock } = await readMlirLegalRegistration("build");
  const copied = lock.files.find(file => file.path === "llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp");
  assert.equal(copied.copiedMaterial.policyScope, "UNKNOWN");
  assert.equal(copied.copiedMaterial.releaseReview, "consolidated-pre-release");
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
