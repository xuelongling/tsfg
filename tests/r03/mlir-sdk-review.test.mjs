// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canonical } from "../../compiler/identity.mjs";
import { executeMlirTarget } from "../../eng/mlir-build.mjs";
import { MlirSdkError } from "../../eng/mlir-sdk.mjs";
import { sourceGitEnvironment } from "../../eng/intake-ledger.mjs";
import { createMlirFixture } from "./mlir-fixtures.mjs";

const product = fileURLToPath(new URL("../../", import.meta.url));
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function fixture(t) {
  const base = await createMlirFixture("sdk-review-");
  const root = path.join(base, "sdk"), artifactRoot = path.join(base, "artifact"), productRoot = path.join(base, "product");
  for (const directory of [root, artifactRoot, path.join(productRoot, "eng")]) await fs.mkdir(directory, { recursive: true });
  const declaration = JSON.parse(await fs.readFile(path.join(product, "eng/build-inputs.json"), "utf8"));
  declaration.entries = [{ path: "eng/build-inputs.json", projectId: "tsfg" }, { path: "eng/mlir-sdk.lock.json", projectId: "tsfg" }];
  const lock = JSON.parse(await fs.readFile(path.join(product, "eng/mlir-sdk.lock.json"), "utf8"));
  lock.files = ["source-snapshot.json", "input-trace.json", "epoch-proof.json", "actual-consumption-legal.json",
    "configure.log.command.json", "configure.log.exit.json", "build.log.command.json", "build.log.exit.json",
    "build/lib/LLVMMC.lib", "build/lib/cmake/llvm/LLVMConfig.cmake", "build/lib/cmake/mlir/MLIRConfig.cmake"]
    .map(name => ({ path: name, sha256: hash("unused fixture") }));
  lock.originManifestHash = hash("{}");
  await fs.writeFile(path.join(artifactRoot, "artifact-manifest.json"), "{}");
  const declarationPath = path.join(productRoot, "eng/build-inputs.json"), lockPath = path.join(productRoot, "eng/mlir-sdk.lock.json");
  await fs.writeFile(declarationPath, canonical(declaration) + "\n");
  await fs.writeFile(lockPath, canonical(lock) + "\n");
  for (const [key, value] of Object.entries({ TSFG_MLIR_SDK_ROOT: root, TSFG_MLIR_SDK_ARTIFACT_ROOT: artifactRoot })) {
    const prior = process.env[key]; process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  const original = fs.readFile, reads = [], lockReads = [];
  t.mock.method(fs, "readFile", async function(file, ...rest) {
    const name = file instanceof URL ? fileURLToPath(file) : String(file);
    if (path.relative(lockPath, name) === "") lockReads.push(name);
    if ([root, artifactRoot].some(directory => path.relative(directory, name) === "" ||
      (!path.relative(directory, name).startsWith("..") && !path.isAbsolute(path.relative(directory, name))))) reads.push(name);
    return original.call(this, file, ...rest);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const run = () => executeMlirTarget({ options: new Map(), productRoot, runtime: null, tools: null,
    workspaceState: null, serialize: canonical, createIdentity: null, scopedToolchainDigest: null, verifyTools: null });
  return { base, root, artifactRoot, productRoot, declaration, declarationPath, lockPath, reads, lockReads, run };
}

async function assertIntegrityCli(input, expectedMessage = undefined) {
  const git = process.env.TSFG_GIT;
  assert.ok(git && path.isAbsolute(git), "the ordinary Git fixture uses the explicitly selected Git");
  const initialized = spawnSync(git, ["-c", "init.templateDir=", "init", "-q", input.productRoot],
    { env: sourceGitEnvironment(), windowsHide: true, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const environment = { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec,
    TSFG_GIT: git, TSFG_MLIR_SDK_ROOT: input.root, TSFG_MLIR_SDK_ARTIFACT_ROOT: input.artifactRoot,
    TEMP: input.base, TMP: input.base, TMPDIR: input.base, HOME: input.base, USERPROFILE: input.base,
    APPDATA: input.base, LOCALAPPDATA: input.base };
  const report = path.join(input.base, "report.json");
  const child = spawnSync(process.execPath, [path.join(product, "eng/tsfg-build.mjs"), "build", "--dev",
    "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--workspace", input.productRoot, "--out", path.join(input.base, "out"), "--report", report],
    { cwd: input.productRoot, env: environment, windowsHide: true, encoding: "utf8" });
  assert.ifError(child.error);
  assert.equal(child.status, 11, child.stderr + child.stdout);
  const result = JSON.parse(await fs.readFile(report, "utf8"));
  assert.equal(result.error.issues[0].code, "mlir-source-integrity");
  if (expectedMessage) assert.match(result.error.issues[0].message, expectedMessage);
  await assert.rejects(fs.lstat(path.join(input.base, "out")), { code: "ENOENT" });
}

test("review: missing inventory lock declaration refuses the normal factory before first SDK body", async t => {
  const input = await fixture(t);
  input.declaration.entries = input.declaration.entries.filter(entry => entry.path !== "eng/mlir-sdk.lock.json");
  await fs.writeFile(input.declarationPath, canonical(input.declaration) + "\n");
  let error;
  try { await input.run(); } catch (caught) { error = caught; }
  assert.deepEqual(input.reads, [], "an undeclared inventory lock cannot trigger provenance or payload reads");
  assert.deepEqual(input.lockReads, [], "the undeclared product lock body must also remain unread");
  assert.ok(error instanceof MlirSdkError);
  assert.match(error.message, /required.*eng\/mlir-sdk\.lock\.json/);
});

for (const name of ["declaration", "lock"]) for (const [kind, bytes] of [
  ["syntax", Buffer.from("{")], ["duplicate", Buffer.from('{"schemaVersion":"2","schemaVersion":"2"}')],
  ["utf8", Buffer.from([0xff])], ["surrogate", Buffer.from('{"value":"\\ud800"}')]
]) test(`review: ${name} ${kind} corruption is SDK integrity exit11 through the normal CLI`, async t => {
  const input = await fixture(t);
  await fs.writeFile(name === "declaration" ? input.declarationPath : input.lockPath, bytes);
  await assertIntegrityCli(input);
  await assert.rejects(input.run(), error => error instanceof MlirSdkError && error.issueCode === "mlir-source-integrity"
    && (kind === "surrogate" || error.cause instanceof Error));
  assert.deepEqual(input.reads, []);
});

test("review: manifest option IJSON corruption is SDK integrity exit11 before later bodies", async t => {
  const input = await fixture(t);
  const lock = JSON.parse(await fs.readFile(input.lockPath, "utf8"));
  const manifest = { buildIdentity: { digest: lock.originBuildIdentity, source_date_epoch: lock.source_date_epoch,
    profile: lock.profile, target: lock.target, toolchainClosureDigest: lock.toolchainClosureDigest,
    options: { ...lock.options, simdDispatch: "\ud800" } },
    outputs: [{ path: "tsfg-core-ir.exe", sha256: lock.originExecutableHash },
      { path: "source-notices.json", sha256: hash("unused notices fixture") }] };
  const raw = JSON.stringify(manifest), manifestPath = path.join(input.artifactRoot, "artifact-manifest.json");
  lock.originManifestHash = hash(raw);
  await fs.writeFile(manifestPath, raw);
  await fs.writeFile(input.lockPath, canonical(lock) + "\n");
  await assertIntegrityCli(input, /invalid original manifest JSON/);
  await assert.rejects(input.run(), error => error instanceof MlirSdkError && error.issueCode === "mlir-source-integrity"
    && error.cause instanceof TypeError);
  assert.deepEqual(input.reads, [manifestPath], "no executable, notices or inventory bodies follow the bad manifest");
});
