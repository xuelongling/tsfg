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
  inspectMlirSdkProvenance, readGpuFunctionComponentDescriptor, readGpuFunctionComponentMember } from "../../eng/mlir-sdk.mjs";
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

// Only the nine stable fields from the actual M39 component candidate are
// retained here. Physical locations/current8/legal records stay outside it.
const gpuDescriptorRaw=await fs.readFile(new URL('./testdata/gpu-function-component-descriptor.json',import.meta.url));
const gpuDescriptor=JSON.parse(gpuDescriptorRaw.toString('utf8'));
const gpuHeader='source/llvm/include/llvm/Support/LogicalResult.h';
const gpuHeaderHash='sha256:69470b3902e9e2c7a955c5fc01cd915bff5ed95a86086241e84191c7a611d788';

test('explicit GPU component reader owns the real stable descriptor without adopting SDK or grammar3',async()=>{
  assert.equal(hash(gpuDescriptorRaw),'sha256:0502ccdab0e3e9e8de7c415b4a42e3af6ebaf5ae7eadcb4341da5734095c9f3e');
  assert.equal(gpuDescriptorRaw.toString('utf8'),independentJson(gpuDescriptor)+'\n');
  const input=Buffer.from(gpuDescriptorRaw),component=readGpuFunctionComponentDescriptor(input,canonical);
  input.fill(0);
  assert.deepEqual(component.descriptor,gpuDescriptor);assert.equal(component.descriptorHash,hash(gpuDescriptorRaw));
  assert.deepEqual(Object.keys(component.descriptor).sort(),['archives','buildRole','files','includeDirectories','normalizedMode','profile','projectId','roots','target']);
  assert.equal(component.descriptor.projectId,'llvm-gpu-function-ir');assert.equal(component.descriptor.files.length,392);
  for(const [role,count] of [['source-include',274],['generated-include',72],['generic-ir-link-archive',42],['spirv-emit-link-archive',4]])
    assert.equal(component.descriptor.files.filter(file=>file.role===role).length,count);
  assert.equal(component.descriptor.roots.length,2);assert.equal(component.descriptor.includeDirectories.length,4);
  assert.equal(component.descriptor.archives.length,46);assert.deepEqual(component.descriptor.archives,gpuDescriptor.archives);
  assert.ok(Object.isFrozen(component)&&Object.isFrozen(component.descriptor)&&Object.isFrozen(component.descriptor.files[0]));
  assert.throws(()=>component.descriptor.files[0].path='changed',TypeError);
  assert.equal('executionAuthority' in component,false);assert.equal('root' in component,false);
  assert.throws(()=>inspectMlirSdkProvenance(component,productRoot),/authenticated live provenance/);
  await assert.rejects(readMlirSdkDependency(component,'E:/must-not-read-component-as-sdk',productRoot),/authenticated live provenance/);
  const declaration=await readJson('eng/build-inputs.json'),lock=await readJson('eng/mlir-sdk.lock.json');
  validateMlirSdkInputDeclaration(declaration,canonical);assert.equal(declaration.schemaVersion,'2');assert.equal(lock.files.length,6601);
  assert.throws(()=>validateMlirSdkInputDeclaration({...declaration,schemaVersion:'3',componentInputSets:[gpuDescriptor]},canonical),/grammar 2/);
  assert.equal(lock.files.find(file=>file.path===gpuHeader).sha256,gpuHeaderHash,'single real member already belongs to the old 6601');
});

test('GPU component boundary rejects altered roles, provenance, aliases and archive coverage',()=>{
  const changes=[
    value=>{value.projectId='llvm-sdk';},value=>{value.buildRole='mlir-core';},value=>{value.profile='release';},
    value=>{value.target='other';},value=>{value.normalizedMode='100755';},
    value=>{value.qualificationRecords={};},value=>{value.roots[0].currentAbsolutePath='E:/physical';},
    value=>{value.roots[0].rootEnvironment='TSFG_MLIR_SDK_ROOT';},value=>{value.roots[1]=value.roots[0];},
    value=>{value.includeDirectories.reverse();},value=>{value.files.push(value.files[0]);},
    value=>{value.files.splice(1,0,{...value.files[0],path:value.files[0].path.toUpperCase()});},
    value=>{value.files[0].rootId='foreign';},value=>{value.files[0].rootId={};},
    value=>{value.files[0].path='../escape.h';},value=>{value.files[0].path='build/include/../escape.h';},
    value=>{value.files[0].role='source-include';},value=>{value.files[0].sha256='unknown';},
    value=>{value.files[0].qualificationRefs=[];},value=>{value.files.pop();},value=>{value.archives.pop();},
    value=>{value.archives.push(value.archives[0]);},
    value=>{value.archives[0]={rootId:'spirv-emit/build',path:'lib/MLIRSPIRVSerialization.lib'};},
    value=>{value.archives[0]={rootId:'sdk-current',path:gpuHeader};},
  ];
  for(const change of changes){
    const value=structuredClone(gpuDescriptor);change(value);
    assert.throws(()=>readGpuFunctionComponentDescriptor(Buffer.from(canonical(value)+'\n'),canonical),/GPU component/);
  }
  for(const bytes of [Buffer.from(' '+gpuDescriptorRaw),gpuDescriptorRaw.subarray(0,-1),Buffer.concat([gpuDescriptorRaw,Buffer.from('\n')]),
    Buffer.from('{"projectId":"llvm-gpu-function-ir",'+gpuDescriptorRaw.toString('utf8').slice(1)),Buffer.from([0xc0,0xaf]),Buffer.alloc(8388609)])
    assert.throws(()=>readGpuFunctionComponentDescriptor(bytes,canonical),/GPU component/);
  assert.throws(()=>readGpuFunctionComponentDescriptor(Buffer.from(canonical({component:gpuDescriptor})+'\n'),canonical),/GPU component/);
});

test('GPU component member identity and explicit root failures are cold',async t=>{
  const component=readGpuFunctionComponentDescriptor(gpuDescriptorRaw,canonical);
  const roots={'sdk-current':'E:/gpu-component-unused-sdk','spirv-emit':'E:/gpu-component-unused-emit'};
  const reads=observeExternalReads(t,Object.values(roots));
  await assert.rejects(readGpuFunctionComponentMember({...component},roots,'sdk-current',gpuHeader),/live handle/);
  for(const [rootId,name] of [['foreign',gpuHeader],['sdk-current/source','llvm/include/llvm/Support/LogicalResult.h'],
    ['sdk-current','../LogicalResult.h'],['sdk-current',gpuHeader.toUpperCase()],['sdk-current','build/lib/cmake/llvm/LLVMExports.cmake']])
    await assert.rejects(readGpuFunctionComponentMember(component,roots,rootId,name),/undeclared member/);
  await assert.rejects(readGpuFunctionComponentMember(component,{},'sdk-current',gpuHeader),/explicit physical roots/);
  await assert.rejects(readGpuFunctionComponentMember(component,{'sdk-current':'C:/outside','spirv-emit':roots['spirv-emit']},'sdk-current',gpuHeader),/absolute E roots/);
  await assert.rejects(readGpuFunctionComponentMember(component,{'sdk-current':roots['sdk-current'],'spirv-emit':roots['sdk-current']},'sdk-current',gpuHeader),/physical root alias/);
  assert.deepEqual(reads,[],'rejected logical identities/root mappings read no external body');
});

test('explicit GPU component reads only the qualified old header and rejects its wrong declared hash',{
  skip:process.env.TSFG_GPU_FUNCTION_IR_SDK_ROOT&&process.env.TSFG_GPU_FUNCTION_IR_SPIRV_ROOT?false:'both explicit GPU component roots are not supplied',
},async t=>{
  const sdkRoot=process.env.TSFG_GPU_FUNCTION_IR_SDK_ROOT,emitRoot=process.env.TSFG_GPU_FUNCTION_IR_SPIRV_ROOT;assert.ok(sdkRoot&&emitRoot);
  const roots={'sdk-current':sdkRoot,'spirv-emit':emitRoot},component=readGpuFunctionComponentDescriptor(gpuDescriptorRaw,canonical);
  const member=component.descriptor.files.find(file=>file.rootId==='sdk-current'&&file.path===gpuHeader);
  assert.equal(member.sha256,gpuHeaderHash);assert.equal(member.role,'source-include');
  const reads=observeExternalReads(t,Object.values(roots).map(root=>path.resolve(root)));
  const bytes=await readGpuFunctionComponentMember(component,roots,'sdk-current',gpuHeader);assert.equal(hash(bytes),gpuHeaderHash);
  const altered=structuredClone(gpuDescriptor);altered.files.find(file=>file.rootId==='sdk-current'&&file.path===gpuHeader).sha256='sha256:'+'0'.repeat(64);
  const wrong=readGpuFunctionComponentDescriptor(Buffer.from(canonical(altered)+'\n'),canonical);
  await assert.rejects(readGpuFunctionComponentMember(wrong,roots,'sdk-current',gpuHeader),/changed declared member/);
  assert.deepEqual(reads,[path.join(path.resolve(sdkRoot),gpuHeader),path.join(path.resolve(sdkRoot),gpuHeader)],
    'positive and wrong-hash checks read the same one header; no archives or other SDK bodies');
});
