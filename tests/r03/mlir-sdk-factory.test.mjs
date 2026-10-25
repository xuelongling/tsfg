// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeMlirTarget } from "../../eng/mlir-build.mjs";
import { projectMlirSdkBuildIdentity, verifyMlirSdkBuildInputSet, verifyMlirSdkSourceInputs,
  validateMlirSdkInputDeclaration, readMlirSourceSdk, readMlirSdkDependency,
  inspectMlirSdkProvenance } from "../../eng/mlir-sdk.mjs";
import { verifyMlirSdkSourceRegistration } from "../../eng/mlir-sdk-admission.mjs";
import { readMlirLegalRegistration } from "../../eng/mlir-source-registration.mjs";
import { readMlirSourceBuildLegalInputs } from "../../eng/mlir-source-legal.mjs";
import { canonical } from "../../compiler/identity.mjs";
import { createMlirFixture } from "./mlir-fixtures.mjs";

const productRoot = fileURLToPath(new URL("../../", import.meta.url));
const readJson = async name => JSON.parse(await fs.readFile(path.join(productRoot, name), "utf8"));
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const independentJson = value => Array.isArray(value) ? `[${value.map(independentJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${independentJson(value[key])}`).join(",")}}` : JSON.stringify(value);

function selectEnvironment(t, root, artifact) {
  const keys = { TSFG_MLIR_SDK_ROOT: root, TSFG_MLIR_SDK_ARTIFACT_ROOT: artifact };
  for (const [key, value] of Object.entries(keys)) {
    const prior = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
}
const factory = root => executeMlirTarget({ options: new Map(), runtime: null, tools: null,
  productRoot: root, workspaceState: null, serialize: canonical,
  createIdentity: null, scopedToolchainDigest: null, verifyTools: null });

function observeExternalReads(t, roots) {
  const reads = [];
  const original = fs.readFile;
  t.mock.method(fs, "readFile", async function(file, ...rest) {
    const name = file instanceof URL ? fileURLToPath(file) : String(file);
    if (roots.some(root => name.startsWith(root))) reads.push(name);
    return original.call(this, file, ...rest);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return reads;
}

test("normal Core factory refuses a partial SDK selection before source fallback", async t => {
  selectEnvironment(t, "E:/sdk-fixture-must-not-be-read", undefined);
  await assert.rejects(factory("E:/unused-product"),
  /** @param {any} error */ error => error.issueCode === "mlir-source-integrity" && /SDK requires both/.test(error.message));
});

test("normal factory selects SDK declaration admission with zero external bodies and no source fallback", async t => {
  const fixture = await createMlirFixture("sdk-declaration-");
  const product = path.join(fixture, "product"), root = path.join(fixture, "sdk"), artifactRoot = path.join(fixture, "artifact");
  await fs.mkdir(path.join(product, "eng"), { recursive: true });
  await fs.writeFile(path.join(product, "eng/build-inputs.json"), canonical({ entries: [], schemaVersion: "1" }) + "\n");
  selectEnvironment(t, root, artifactRoot);
  const reads = observeExternalReads(t, [root, artifactRoot]);
  await assert.rejects(factory(product), /SDK requires declaration grammar 2/);
  assert.deepEqual(reads, [], "v1 must refuse before root/provenance/payload intake");
});

test("current locked SDK source gaps fail in the normal factory before any external body", async t => {
  const root = "E:/sdk-negative-control-does-not-exist", artifactRoot = "E:/sdk-artifact-negative-control-does-not-exist";
  selectEnvironment(t, root, artifactRoot);
  const reads = observeExternalReads(t, [root, artifactRoot]);
  await assert.rejects(factory(productRoot), /** @param {any} error */ error => {
    assert.equal(error.issueCode, "mlir-source-license");
    assert.deepEqual(error.missingPaths, ["llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp"]);
    assert.deepEqual(error.mismatchedPaths, []);
    assert.equal(error.sdkBodyRead, false);
    return true;
  });
  assert.deepEqual(reads, []);
});

test("current finite registration admits the SDK source supplement and refuses the unresolved copied table", async t => {
  const result = await readMlirLegalRegistration("build");
  assert.equal(result.lock.files.length, 8146);
  assert.equal(result.lock.licenseMaterials.length, 5);
  assert.equal(result.lock.sourceCommit, "4cb57d27ddcad7c3a89d23ef576662a5c891e8c8");
  const local = result.lock.files.find(file => file.path === "llvm/lib/Bitcode/Reader/MetadataLoader.h");
  assert.equal(local.role, "compiler-side-M01");
  assert.equal(local.license, "Apache-2.0 WITH LLVM-exception");
  assert.match(local.completeOriginalAttribution, /SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception/);
  const projectGrant = result.lock.files.find(file => file.path === "llvm/lib/CodeGen/AsmPrinter/DIEHashAttributes.def");
  assert.equal(projectGrant.completeOriginalAttribution, "");
  assert.equal(projectGrant.noticeEnd, "0");
  assert.match(projectGrant.licenseBasis.join(" "), /no local SPDX/);
  const sourceRoot = path.join(await createMlirFixture("sdk-legal-refusal-"), "unused-source");
  const reads = observeExternalReads(t, [sourceRoot]);
  await assert.rejects(readMlirSourceBuildLegalInputs({ sourceRoot, git: undefined,
    paths: ["llvm/lib/Target/X86/MCTargetDesc/X86InstComments.cpp"] }), { issueCode: "mlir-source-license" });
  assert.deepEqual(reads, []);
});

test("the accepted descriptor is closed and keeps the 6601 payload separate from three admission roles", async () => {
  const declaration = await readJson("eng/build-inputs.json"), lock = await readJson("eng/mlir-sdk.lock.json");
  validateMlirSdkInputDeclaration(declaration, canonical);
  assert.equal(lock.files.length, 6601);
  assert.equal(declaration.supplementalInputSets[0].provenanceOnlyReads.length, 3);
  for (const name of ["eng/mlir-build-inputs.mjs", "eng/mlir-sdk.mjs", "eng/mlir-sdk.lock.json",
    "eng/mlir-sdk-admission.mjs", "eng/mlir-sdk-paths.mjs", "eng/mlir-source-registration.mjs"])
    assert.ok(declaration.entries.some(entry => entry.projectId === "tsfg" && entry.path === name), name);
  for (const change of [d => d.extra = true, d => d.schemaVersion = "1",
    d => d.supplementalInputSets[0].maxFiles++, d => d.supplementalInputSets[0].rootEnvironment = "OTHER",
    d => d.supplementalInputSets[0].provenanceOnlyReads.push({ path: "extra" }),
    d => d.entries.push(d.entries[0]), d => d.entries[0].path = "../escape"]) {
    const changed = structuredClone(declaration); change(changed);
    assert.throws(() => validateMlirSdkInputDeclaration(changed, canonical), /SDK/);
  }
  assert.ok(lock.files.every(file => !file.path.includes("tsfg-core-ir")));
});

async function identityFixture() {
  const actual = await readJson("eng/build-inputs.json");
  const declaration = { ...actual, entries: [{ path: "eng/build-inputs.json", projectId: "tsfg" },
    { path: "eng/mlir-sdk.lock.json", projectId: "tsfg" }] };
  const declarationHash = hash(canonical(declaration) + "\n"), lockFileHash = hash("fixture lock");
  const entries = declaration.entries.map(entry => ({ projectId: "tsfg", repositoryRelativePath: entry.path,
    normalizedMode: "100644", sha256: entry.path.endsWith("build-inputs.json") ? declarationHash : lockFileHash }));
  const payload = { schemaVersion: "1", entries }, buildInputSet = { ...payload, digest: hash(canonical(payload)) };
  const identity = { buildInputSetDigest: buildInputSet.digest, options: { sourceTarget: "mlir-core" },
    profile: "debug", target: "windows-x86_64-msvc", source_date_epoch: "2000000000", toolchainClosureDigest: hash("tool fixture") };
  const sdk = { files: [{ path: "build/lib/Fixture.lib", sha256: hash("library fixture") },
    { path: "source/fixture.h", sha256: hash("header fixture") }], declarationInput: { declaration, declarationHash }, lockFileHash,
    identity: { originBuildIdentity: hash("historical fixture"), source_date_epoch: "1000000000" } };
  return { product: { buildInputSet, buildIdentity: { ...identity, digest: hash(canonical(identity)) } }, sdk };
}

test("SDK projection independently preserves four-key schema1 payload and fresh product identity", async () => {
  const { product, sdk } = await identityFixture();
  const result = projectMlirSdkBuildIdentity(product, sdk, canonical);
  const entries = [...sdk.files.map(file => ({ normalizedMode: "100644", projectId: "llvm-sdk",
    repositoryRelativePath: file.path, sha256: file.sha256 })), ...product.buildInputSet.entries];
  assert.deepEqual(result.buildInputSet.entries, entries);
  assert.equal(result.buildInputSet.digest, hash(independentJson({ entries, schemaVersion: "1" })));
  const { digest, ...identity } = result.buildIdentity;
  assert.equal(digest, hash(independentJson(identity)));
  assert.equal(identity.source_date_epoch, product.buildIdentity.source_date_epoch);
  assert.notEqual(digest, sdk.identity.originBuildIdentity);
  assert.notEqual(digest, product.buildIdentity.digest);
  verifyMlirSdkBuildInputSet(result.buildInputSet, sdk, canonical);
  verifyMlirSdkSourceInputs(sdk, [{ projectId: "llvm-project.git", repositoryRelativePath: "fixture.h", sha256: hash("header fixture") }]);
  assert.throws(() => verifyMlirSdkSourceInputs(sdk, [{ projectId: "llvm-project.git", repositoryRelativePath: "unknown.h", sha256: hash("header fixture") }]));
  for (const files of [[...sdk.files, sdk.files[0]], [{ path: "../escape", sha256: hash("x") }],
    [{ path: "tsfg-core-ir.exe", sha256: hash("x") }], [{ path: "build/lib/Fixture.lib", sha256: "unknown" }]])
    assert.throws(() => projectMlirSdkBuildIdentity(product, { ...sdk, files }, canonical));
  const changed = structuredClone(product); changed.buildInputSet.entries[0].sha256 = hash("drift");
  assert.throws(() => projectMlirSdkBuildIdentity(changed, sdk, canonical));
});

test("source metadata gate distinguishes source identity, absent path and raw hash mismatch", async () => {
  const sourceLock = { sourceCommit: "fixture-commit", sourceTree: "fixture-tree", baseCommit: "fixture-base", files: [{ path: "UPSTREAM.toml", sha256: hash("metadata") }] };
  const buildLegal = { ...sourceLock, role: "compiler-side-M01", files: [{ path: "known.h", sha256: hash("header") }], licenseMaterials: [] };
  const fileLegal = { ...buildLegal, files: [] };
  const sdkLock = { ...sourceLock, files: [{ path: "source/known.h", sha256: hash("header") }, { path: "source/UPSTREAM.toml", sha256: hash("metadata") }] };
  const input = { sdkLock, sourceLock, buildLegal, fileLegal };
  verifyMlirSdkSourceRegistration(input);
  assert.throws(() => verifyMlirSdkSourceRegistration({ ...input, sdkLock: { ...sdkLock, sourceCommit: "other" } }), /different source identities/);
  assert.throws(() => verifyMlirSdkSourceRegistration({ ...input, sdkLock: { ...sdkLock, files: [{ path: "source/missing.h", sha256: hash("x") }] } }),
    /** @param {any} error */ error => error.missingPaths[0] === "missing.h" && error.mismatchedPaths.length === 0);
  assert.throws(() => verifyMlirSdkSourceRegistration({ ...input, sdkLock: { ...sdkLock, files: [{ path: "source/known.h", sha256: hash("x") }] } }),
    /** @param {any} error */ error => error.mismatchedPaths[0] === "known.h" && error.missingPaths.length === 0);
});

async function dataOnlySdkFixture() {
  const fixture = await createMlirFixture("sdk-intake-data-");
  const product = path.join(fixture, "product"), root = path.join(fixture, "sdk"), artifactRoot = path.join(fixture, "artifact");
  await fs.mkdir(path.join(product, "eng"), { recursive: true });
  await fs.mkdir(root); await fs.mkdir(artifactRoot);
  const source = await readJson("eng/mlir-source.lock.json"), template = await readJson("eng/mlir-sdk.lock.json");
  const legal = await readJson("eng/mlir-source-build-legal.lock.json");
  const material = legal.licenseMaterials.find(file => file.path === "llvm/LICENSE.TXT");
  const consumption = { schemaVersion: "1", role: "compiler-side-M01", sourceCommit: source.sourceCommit,
    baseCommit: source.baseCommit, status: "selected-build-legal-inputs-verified", intakeComplete: false,
    sourceBuild: "not-run", files: [], licenseMaterials: legal.licenseMaterials };
  const values = new Map([
    ["source-snapshot.json", canonical({ sourceCommit: source.sourceCommit, sourceTree: source.sourceTree,
      entries: [{ ...source.files.find(file => file.path === material.path), repositoryRelativePath: material.path,
        projectId: "llvm-project.git", normalizedMode: "100644" }], unmaterialized: [], checkoutDifferences: [] })],
    ["input-trace.json", "{}"], ["epoch-proof.json", canonical({ method: "product-maximum-dominates-all-source-ancestor-times",
      sourceCommit: source.sourceCommit, sourceHistoryMaximum: 1, productEpoch: Number(template.source_date_epoch) })],
    ["actual-consumption-legal.json", canonical(consumption)],
    ["configure.log.command.json", "{}"], ["configure.log.exit.json", '{"code":0,"signal":null}'],
    ["build.log.command.json", "{}"], ["build.log.exit.json", '{"code":0,"signal":null}'],
    ["build/lib/LLVMMC.lib", "data-only library fixture; never linked"],
    ["build/lib/cmake/llvm/LLVMConfig.cmake", "# data-only fixture; never evaluated\n"],
    ["build/lib/cmake/mlir/MLIRConfig.cmake", "# data-only fixture; never evaluated\n"],
    ["source/llvm/LICENSE.TXT", material.completeOriginalNotice]
  ]);
  const files = [];
  for (const [name, value] of values) {
    const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, value); files.push({ path: name, sha256: hash(value) });
  }
  files.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  const original = { profile: template.profile, target: template.target, toolchainClosureDigest: template.toolchainClosureDigest,
    options: template.options, source_date_epoch: template.source_date_epoch };
  const executable = "data-only EXE provenance fixture; never executed";
  const notice = canonical({ schemaVersion: "1", role: "compiler-side-M01", sourceCommit: source.sourceCommit,
    baseCommit: source.baseCommit, actualConsumption: consumption });
  const manifest = canonical({ buildIdentity: { ...original, digest: hash(canonical(original)) }, outputs: [
    { path: "tsfg-core-ir.exe", sha256: hash(executable) }, { path: "source-notices.json", sha256: hash(notice) }] });
  const lock = { ...template, files, originManifestHash: hash(manifest), originExecutableHash: hash(executable),
    originBuildIdentity: hash(canonical(original)) };
  const declaration = (await identityFixture()).sdk.declarationInput.declaration;
  await fs.writeFile(path.join(product, "eng/build-inputs.json"), canonical(declaration) + "\n");
  await fs.writeFile(path.join(product, "eng/mlir-sdk.lock.json"), canonical(lock) + "\n");
  for (const [name, value] of [["artifact-manifest.json", manifest], ["tsfg-core-ir.exe", executable], ["source-notices.json", notice]])
    await fs.writeFile(path.join(artifactRoot, name), value);
  return { root, artifactRoot, productRoot: product, canonicalize: canonical };
}

test("data-only SDK intake binds three provenance roles and refuses unlisted, changed and redirected dependencies", async t => {
  const fixture = await dataOnlySdkFixture();
  const sdk = await readMlirSourceSdk(fixture);
  assert.equal(sdk.executionAuthority, false, "fixture admission never authorizes execution");
  assert.ok(!sdk.files.some(file => ["artifact-manifest.json", "tsfg-core-ir.exe", "source-notices.json"].includes(file.path)));
  assert.throws(() => inspectMlirSdkProvenance({ ...sdk }, fixture.productRoot), /authenticated live provenance/);
  const member = path.join(fixture.root, "source/llvm/LICENSE.TXT");
  await readMlirSdkDependency(sdk, member, fixture.productRoot);
  const unlisted = path.join(fixture.root, "unlisted.h"), historicalExe = path.join(fixture.artifactRoot, "tsfg-core-ir.exe");
  const reads = observeExternalReads(t, [unlisted, historicalExe]);
  await fs.writeFile(unlisted, "unlisted fixture");
  await assert.rejects(readMlirSdkDependency(sdk, unlisted, fixture.productRoot), /undeclared observed dependency/);
  await assert.rejects(readMlirSdkDependency(sdk, historicalExe, fixture.productRoot), /undeclared observed dependency/);
  assert.deepEqual(reads, [], "unlisted body must not be read");
  const originalExe = await fs.readFile(historicalExe);
  await fs.writeFile(historicalExe, "changed provenance fixture");
  await assert.rejects(readMlirSourceSdk(fixture), /original publication/);
  await fs.writeFile(historicalExe, originalExe);
  const library = path.join(fixture.root, "build/lib/LLVMMC.lib");
  await fs.writeFile(library, "changed fixture");
  await assert.rejects(readMlirSdkDependency(sdk, library, fixture.productRoot), /changed observed dependency/);
  await assert.rejects(readMlirSourceSdk(fixture), /changed dependency/);
  const directory = path.join(fixture.root, "source");
  await fs.rename(directory, `${directory}.retained`);
  await fs.symlink(`${directory}.retained`, directory, "junction");
  await assert.rejects(readMlirSdkDependency(sdk, member, fixture.productRoot), /nonordinary input/);
});
