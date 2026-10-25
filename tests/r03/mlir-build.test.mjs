// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMlirFixture } from "./mlir-fixtures.mjs";
import { MlirBuildError, readMlirBuildTrace } from "../../eng/mlir-build.mjs";

async function stagedNoticeFixture(change = undefined) {
  const root = await createMlirFixture("mlir-staged-notice-");
  const eng = path.join(root, "eng"), source = path.join(root, "source");
  await cp(new URL("../../eng/", import.meta.url), eng,
    { recursive: true, filter: name => !path.extname(name) || name.endsWith(".mjs") });
  const name = "mlir/lib/Conversion/MPIToLLVM/MPIToLLVM.cpp";
  const attribution = "// Owned original attribution.\n";
  const original = Buffer.from(attribution + "int ordinary = 7;\n");
  const notice = "Fixture copyright.\n";
  // A worked byte golden, independent of the production transformation.
  const expected = Buffer.from("/*\nFixture copyright.\n\n*/\n// Owned original attribution.\nint ordinary = 7;\n");
  const hash = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
  const blob = bytes => createHash("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
  for (const directory of [path.dirname(name), "llvm"])
    await mkdir(path.join(source, directory), { recursive: true });
  await writeFile(path.join(source, name), original);
  for (const component of ["llvm", "mlir"])
    await writeFile(path.join(source, component, "LICENSE.TXT"), "Owned fixture license.\n");
  const git = (...args) => {
    const result = spawnSync(process.env.TSFG_GIT, ["-C", source, ...args],
      { env: { ...process.env, GIT_AUTHOR_DATE: "2026-10-25T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-25T00:00:00Z" },
        windowsHide: true, encoding: "utf8" });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const sourceLock = JSON.parse(await readFile(new URL("../../eng/mlir-source.lock.json", import.meta.url), "utf8"));
  git("init", "-b", "r03-m01-source");
  git("config", "user.name", "Owned fixture"); git("config", "user.email", "fixture@example.invalid");
  git("config", "core.autocrlf", "false"); git("remote", "add", "origin", sourceLock.carrierUrl);
  git("add", "."); git("commit", "-m", "owned fixture base");
  const baseCommit = git("rev-parse", "HEAD"), localChanges = "owned provenance fixture only";
  await writeFile(path.join(source, "UPSTREAM.toml"), `base_oid = "${baseCommit}"\ncanonical_url = "${sourceLock.canonicalUrl}"\nlicense = "${sourceLock.license}"\nsync_branch = "refs/heads/r03-m01-source"\nlocal_changes = "${localChanges}"\n`);
  git("add", "UPSTREAM.toml"); git("commit", "-m", "owned fixture provenance");
  const sourceCommit = git("rev-parse", "HEAD"), sourceTree = git("rev-parse", "HEAD^{tree}");
  const identity = { sourceRoot: source, baseCommit, sourceCommit, sourceTree, inspectedFiles: [] };
  sourceLock.baseCommit = baseCommit; sourceLock.sourceCommit = sourceCommit;
  sourceLock.sourceTree = sourceTree; sourceLock.localChanges = localChanges;
  sourceLock.files = await Promise.all(sourceLock.files.map(async file => ({ path: file.path,
    blob: git("rev-parse", `${sourceCommit}:${file.path}`), sha256: hash(await readFile(path.join(source, file.path))) })));
  const descriptor = { schemaVersion: "1", kind: "prepend-mpich-copyright-comment-v1", path: name,
    sourceCommit, role: "compiler-side-M01", consumer: "direct-source-static",
    original: { blob: blob(original), sha256: hash(original), bytes: original.length },
    notice: { repository: "pmodels/mpich", path: "COPYRIGHT", commit: "e0b3d1dd2c62c80048e5fc3b60d0b24e0d2a863d",
      blob: blob(notice), sha256: hash(notice), bytes: Buffer.byteLength(notice), expression: "mpich2", completeOriginalNotice: notice },
    staged: { sha256: hash(expected), bytes: expected.length } };
  const row = { mode: "100644", path: name, blob: blob(original), sha256: hash(original), role: "compiler-side-M01",
    license: "(Apache-2.0 WITH LLVM-exception) AND mpich2", noticeStart: "0", noticeEnd: String(Buffer.byteLength(attribution)),
    completeOriginalAttribution: attribution, completeOriginalNotice: attribution, noticeSha256: hash(attribution),
    stagedTransform: descriptor };
  const lock = { schemaVersion: "1", baseCommit, sourceCommit, role: "compiler-side-M01", files: [row], licenseMaterials: [] };
  if (change) change(lock);
  const empty = { ...lock, files: [], purpose: "owned fixture notice retention" };
  const buildRaw = JSON.stringify(lock) + "\n", fileRaw = JSON.stringify(empty) + "\n";
  let registration = await readFile(path.join(eng, "mlir-source-registration.mjs"), "utf8");
  registration = registration.replace(/(build: \["mlir-source-build-legal.lock.json", ")[^"]+/, `$1${hash(buildRaw)}`)
    .replace(/(file: \["mlir-source-legal.lock.json", ")[^"]+/, `$1${hash(fileRaw)}`);
  for (const [file, bytes] of [["mlir-source-registration.mjs", registration], ["mlir-source-build-legal.lock.json", buildRaw],
    ["mlir-source-legal.lock.json", fileRaw], ["mlir-source-notices.lock.json", fileRaw], ["mlir-source.lock.json", JSON.stringify(sourceLock)]])
    await writeFile(path.join(eng, file), bytes);
  const inputs = await import(pathToFileURL(path.join(eng, "mlir-build-inputs.mjs")).href);
  const legal = await import(pathToFileURL(path.join(eng, "mlir-source-legal.mjs")).href);
  const selection = await import(pathToFileURL(path.join(eng, "mlir-static-closure.mjs")).href);
  return { root, eng, source, name, identity, original, expected, descriptor, row, inputs, legal, selection, git: process.env.TSFG_GIT };
}

test("M14 staged notice preserves original provenance and retains configure-only attribution", async () => {
  const f = await stagedNoticeFixture();
  const legal = await f.legal.readMlirSourceBuildLegalInputs({ sourceRoot: f.source, git: f.git, paths: [f.name] });
  const selected = await f.selection.readMlirDirectSourceSelection(f.identity, { role: "static" });
  const staged = path.join(f.root, "staged");
  const result = await f.inputs.materializeSource(f.identity, f.git, staged, selected);
  assert.deepEqual(await readFile(path.join(staged, f.name)), f.expected);
  assert.deepEqual(await readFile(path.join(f.source, f.name)), f.original);
  const entry = result.entries.find(row => row.repositoryRelativePath === f.name);
  assert.equal(entry.sha256, f.descriptor.staged.sha256);
  assert.equal(entry.stagedTransform.original.sha256, f.row.sha256);
  await f.inputs.verifyMlirStagedSourceInputs({ source: staged, sourceEntries: result.entries, files: legal.files, identity: f.identity });
  const retained = await f.inputs.retainedNoticeBundle({ source: staged, sourceEntries: result.entries,
    productRoot: f.root, identity: f.identity, legal: { approvalLockSha256: "fixture-only" }, serialize: JSON.stringify });
  assert.equal(retained.bundle.materializedSourceNotices[0].notice.completeOriginalNotice, "Fixture copyright.\n");
  assert.equal(retained.bundle.materializedSourceNotices[0].original.sha256, f.row.sha256);
  assert.equal(retained.bundle.materializedSourceNotices[0].staged.sha256, entry.sha256);
  assert.deepEqual(retained.inputs.map(row => row.repositoryRelativePath), [f.name]);
  assert.equal(retained.bundle.actualConsumption, undefined, "materialization does not invent target consumption");
});

test("M14 staged notice rejects unknown pinned descriptors before source bodies", async () => {
  for (const change of [lock => { lock.files[0].stagedTransform.kind = "unknown-transform"; },
    lock => { lock.files[0].stagedTransform.path = "../foreign.cpp"; },
    lock => { lock.files[0].stagedTransform.role = "game-runtime"; },
    lock => { lock.files[0].stagedTransform.sourceCommit = "0".repeat(40); },
    lock => { lock.files[0].stagedTransform.original.sha256 = "sha256:" + "0".repeat(64); },
    lock => { lock.files[0].stagedTransform.notice.localPath = "E:/must-not-open/COPYRIGHT"; },
    lock => { lock.files[0].stagedTransform.notice.sha256 = "sha256:" + "0".repeat(64); },
    lock => {
      const d = lock.files[0].stagedTransform, notice = "Fixture copyright.*/\n";
      d.notice.completeOriginalNotice = notice; d.notice.bytes = Buffer.byteLength(notice);
      d.notice.sha256 = "sha256:" + createHash("sha256").update(notice).digest("hex");
      d.notice.blob = createHash("sha1").update(`blob ${Buffer.byteLength(notice)}\0`).update(notice).digest("hex");
      const expected = "/*\nFixture copyright.*/\n\n*/\n// Owned original attribution.\nint ordinary = 7;\n";
      d.staged.bytes = Buffer.byteLength(expected);
      d.staged.sha256 = "sha256:" + createHash("sha256").update(expected).digest("hex");
    }]) {
    const f = await stagedNoticeFixture(change);
    await assert.rejects(f.legal.readMlirSourceBuildLegalInputs({ sourceRoot: undefined, git: undefined, paths: [f.name] }),
      /Invalid independently registered staged transformation:/);
    await assert.rejects(f.selection.readMlirDirectSourceSelection(f.identity, { role: "static" }),
      /Invalid independently registered staged transformation:/);
  }
});

test("M14 staged notice refuses caller overrides and distinct original or staged byte damage", async () => {
  const f = await stagedNoticeFixture();
  const selected = await f.selection.readMlirDirectSourceSelection(f.identity, { role: "static" });
  const override = JSON.parse(JSON.stringify(selected));
  override.entries[0].stagedTransform.staged.sha256 = "sha256:" + "0".repeat(64);
  const staged = path.join(f.root, "staged");
  await assert.rejects(f.inputs.materializeSource({ ...f.identity, sourceRoot: path.join(f.root, "must-not-read") },
    f.git, staged, override), /Unregistered staged transformation override:/);
  assert.ok(!(await readdir(f.root)).includes("staged"));
  const result = await f.inputs.materializeSource(f.identity, f.git, staged, selected);
  await writeFile(path.join(staged, f.name), f.original);
  await assert.rejects(f.inputs.verifyMlirStagedSourceInputs({ source: staged, sourceEntries: result.entries,
    files: [f.row], identity: f.identity }), /Changed physical source dependency:/);
  await assert.rejects(f.inputs.retainedNoticeBundle({ source: staged, sourceEntries: result.entries,
    productRoot: f.root, identity: f.identity, legal: { approvalLockSha256: "fixture-only" }, serialize: JSON.stringify }),
  /Changed physical source dependency:/);
  const forged = result.entries.map(row => ({ ...row, sha256: f.row.sha256 }));
  await assert.rejects(f.inputs.verifyMlirStagedSourceInputs({ source: staged, sourceEntries: forged,
    files: [f.row], identity: f.identity }), /Changed staged source provenance:/);
  await writeFile(path.join(f.source, f.name), Buffer.concat([f.original, Buffer.from("// changed\n")]));
  await assert.rejects(f.inputs.materializeSource(f.identity, f.git, path.join(f.root, "other-stage"), selected),
    /Source differs beyond Git checkout line endings:/);
  assert.ok(!(await readdir(f.root)).includes("other-stage"));
});

test("M14 activated MPI mapping refuses foreign identity, native role and overrides before body access", async () => {
  const root = await createMlirFixture("mlir-mpi-identity-");
  const legal = await import("../../eng/mlir-source-legal.mjs");
  const inputs = await import("../../eng/mlir-build-inputs.mjs");
  const { readMlirLegalRegistration } = await import("../../eng/mlir-source-registration.mjs");
  const { lock, sha256 } = await readMlirLegalRegistration("build");
  const row = lock.files.find(file => file.path === "mlir/lib/Conversion/MPIToLLVM/MPIToLLVM.cpp");
  const identity = { baseCommit: lock.baseCommit, sourceCommit: lock.sourceCommit,
    sourceTree: "0".repeat(40), sourceRoot: path.join(root, "must-not-open") };
  const selection = { ...identity, registrationLockSha256: sha256, entries: [{ repositoryRelativePath: row.path,
    blob: row.blob, sha256: row.sha256, stagedTransform: row.stagedTransform }] };
  const foreign = { ...identity, sourceCommit: "0".repeat(40) }, destination = path.join(root, "must-not-create");
  for (const selected of [selection, null])
    await assert.rejects(inputs.materializeSource(foreign, undefined, destination, selected), /another immutable source identity/);
  await assert.rejects(inputs.materializeSource(identity, undefined, destination, null), /require direct-source static selection/);
  const override = JSON.parse(JSON.stringify(selection));
  override.entries[0].stagedTransform.role = "game-runtime";
  await assert.rejects(inputs.materializeSource(identity, undefined, destination, override), /Unregistered staged transformation override:/);
  const policy = await legal.readMlirStagedSourcePolicy(foreign);
  assert.throws(() => legal.deriveMlirStagedSource(policy, row.path, Buffer.from("owned fixture")), /another immutable source identity/);
  assert.throws(() => legal.qualifyMlirStagedSourceEntry(policy, { repositoryRelativePath: row.path }), /another immutable source identity/);
  assert.deepEqual(await readdir(root), [], "no source or stage body exists or can be consumed by these refusals");
});

test("MLIR trace reader requires a physical EVAL CODE command, not a CALL, comment or string", async () => {
  const root = await createMlirFixture("mlir-eval-origin-");
  const file = path.join(root, "GNUInstallDirs.cmake");
  // Independent physical goldens reproduce the locked module's three line identities.
  const lines = Array(488).fill("");
  lines[289] = "  cmake_language(CALL set result value)";
  lines[483] = "  # Using cmake_language(EVAL) to call a short wrapper function instead";
  lines[484] = '  cmake_language(EVAL CODE "set(result value)")';
  await writeFile(file, lines.join("\n"));
  const trace = line => [
    { file, line, cmd: "cmake_language", args: ["EVAL", "CODE", "set(result value)"] },
    { file: `${file}:${line}:EVAL`, line: 1, cmd: "set", args: ["result", "value"] }
  ].map(record => JSON.stringify(record)).join("\n");
  const result = await readMlirBuildTrace({ cmakeTrace: trace(485), build: root, inputRoots: [root] });
  assert.deepEqual(result.files, [file]);
  assert.equal(result.evaluationFrames[0].physicalFile, file);
  assert.deepEqual(result.evaluationFrames[0].evaluationLines, ["485"]);
  for (const line of [290, 484]) await assert.rejects(
    readMlirBuildTrace({ cmakeTrace: trace(line), build: root, inputRoots: [root] }),
    error => error instanceof MlirBuildError && error.issueCode === "mlir-source-integrity");
  for (const text of ['set(text "\ncmake_language(EVAL CODE fake)\n")',
    'set(text [=[\ncmake_language(EVAL CODE fake)\n]=])',
    '#[=[\ncmake_language(EVAL CODE fake)\n]=]',
    'set(text\ncmake_language(EVAL CODE fake)\n)']) {
    await writeFile(file, text);
    await assert.rejects(readMlirBuildTrace({ cmakeTrace: trace(2), build: root, inputRoots: [root] }),
      error => error instanceof MlirBuildError && error.issueCode === "mlir-source-integrity");
  }
  await assert.rejects(readMlirBuildTrace({ cmakeTrace: trace(485), build: root, inputRoots: [] }),
    error => error instanceof MlirBuildError && error.issueCode === "mlir-source-integrity");
});

test("M01 internal compiler launcher preserves CodeView and anonymous namespace identity across owned roots", async () => {
  const compiler = process.env.TSFG_MLIR_CLANG_CL;
  assert.ok(compiler, "the exact verified clang-cl must be explicit");
  const launcher = fileURLToPath(new URL("../../eng/mlir-compiler-launcher.mjs", import.meta.url));
  const root = await createMlirFixture("mlir-compiler-repro-");
  const outputs = [];
  for (const name of ["first", "second"]) {
    const source = path.join(root, name, "source"), product = path.join(root, name, "product"), build = path.join(root, name, "build");
    for (const directory of [source, product, build]) await mkdir(directory, { recursive: true });
    await writeFile(path.join(source, "probe.cpp"), "namespace { struct Marker { int value; }; Marker value; }\nint probe() { return value.value; }\n");
    const mapped = source.replaceAll("\\", "/");
    const flags = ["/Od", "/Z7", "/Brepro", "/clang:-fdebug-compilation-dir=.", "/clang:-gno-codeview-command-line",
      `/clang:-ffile-prefix-map=${mapped}=.source`, `/clang:-fdebug-prefix-map=${mapped}=.source`,
      "/Foprobe.obj", "-c", "--", path.join(source, "probe.cpp")];
    const child = spawnSync(process.execPath, [launcher, compiler, source, product, build, compiler, ...flags],
      { cwd: build, env: process.env, encoding: "utf8", windowsHide: true });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    outputs.push(await readFile(path.join(build, "probe.obj")));
    await writeFile(path.join(source, "broken.cpp"), "this is invalid C++\n");
    const failed = spawnSync(process.execPath, [launcher, compiler, source, product, build, compiler,
      "/c", "/Fobroken.obj", path.join(source, "broken.cpp")], { cwd: build, env: process.env, encoding: "utf8", windowsHide: true });
    assert.equal(failed.status, 1, "the real compiler failure must retain its exit code");
    assert.match(failed.stderr, /error:/);
  }
  assert.deepEqual(outputs[0], outputs[1], "full COFF bytes must reproduce; this is a compiler probe, not Core IR execution");
  const source = path.join(root, "first", "source"), product = path.join(root, "first", "product"), build = path.join(root, "first", "build");
  const flags = ["/c", "/Foblocked.obj", path.join(source, "probe.cpp")];
  const wrongTool = spawnSync(process.execPath, [launcher, compiler, source, product, build, process.execPath, ...flags],
    { cwd: build, env: process.env, encoding: "utf8", windowsHide: true });
  assert.equal(wrongTool.status, 11);
  assert.match(wrongTool.stderr, /Compiler or working directory differs/);
  const missingInput = spawnSync(process.execPath, [launcher, compiler, source, product, build, compiler, "-c", "--"],
    { cwd: build, env: process.env, encoding: "utf8", windowsHide: true });
  assert.equal(missingInput.status, 11);
  assert.match(missingInput.stderr, /Expected one CMake compile input/);
  const redirect = path.join(root, "redirected-source");
  await symlink(source, redirect, "junction");
  const redirected = spawnSync(process.execPath, [launcher, compiler, redirect, product, build, compiler, ...flags],
    { cwd: build, env: process.env, encoding: "utf8", windowsHide: true });
  assert.equal(redirected.status, 11);
  assert.match(redirected.stderr, /Nonordinary compiler input/);
  assert.ok(!(await readdir(build)).includes("blocked.obj"), "rejected compiler contexts must not compile");
});

test("Hermetic Build Entry classifies unsupported MLIR configurations before reading missing inputs", async () => {
  const root = await createMlirFixture("mlir-configuration-");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_MLIR_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  }
  const configurations = [[], ["--dev", "--target", "linux-x86_64-gnu"], ["--dev", "--profile", "release"]];
  const invalidLock = path.join(root, "invalid-runtime-lock.json");
  const cache = path.join(root, "runtime-cache");
  await writeFile(invalidLock, "{}\n");
  await mkdir(cache);
  const environments = [{ name: "no-runtime", values: {}, validStatus: 10, validCode: "mlir-source-identity" },
    { name: "partial-runtime", values: { TSFG_RUNTIME_LOCK: invalidLock }, validStatus: 11, validCode: "runtime-closure" },
    { name: "invalid-runtime", values: { TSFG_RUNTIME_LOCK: invalidLock, TSFG_RUNTIME_CACHE: cache,
      TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc", TSFG_WINDOWS_OFFLINE_ACTIVE: "0" }, validStatus: 11, validCode: "runtime-closure" },
    { name: "boundary-bootstrap", values: { TSFG_WINDOWS_BOUNDARY_ERROR: "test boundary bootstrap unavailable",
      TSFG_RUNTIME_LOCK: invalidLock, TSFG_RUNTIME_CACHE: cache, TSFG_RUNTIME_PLATFORM: "windows-x86_64-msvc" },
      validStatus: 12, validCode: "sandbox-boundary" }];
  const results = [];
  const controls = [];
  for (const environment of environments) {
    for (const configuration of configurations) {
      const index = results.length;
      const report = path.join(root, `report-${index}.json`);
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
        "build", ...configuration, "--source-target", "mlir-core",
        ...(configuration.includes("--target") ? [] : ["--target", "windows-x86_64-msvc"]),
        ...(configuration.includes("--profile") ? [] : ["--profile", "debug"]),
        "--out", path.join(root, `out-${index}`), "--report", report],
        { env: { ...env, ...environment.values }, encoding: "utf8", windowsHide: true });
      assert.ifError(child.error);
      results.push({ environment: environment.name, configuration, status: child.status,
        report: JSON.parse(await readFile(report, "utf8")) });
    }
    const report = path.join(root, `control-${controls.length}.json`);
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
      "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
      "--out", path.join(root, "control-out"), "--report", report],
      { env: { ...env, ...environment.values }, encoding: "utf8", windowsHide: true });
    assert.ifError(child.error);
    controls.push({ status: child.status, expectedStatus: environment.validStatus, expectedCode: environment.validCode,
      report: JSON.parse(await readFile(report, "utf8")) });
  }
  await writeFile(path.join(root, "configuration-results.json"), JSON.stringify({ results, controls }));
  for (const result of results) {
    assert.equal(result.status, 2);
    assert.equal(result.report.error.category, "usage/configuration");
    assert.equal(result.report.error.issues[0].code, "mlir-configuration");
  }
  for (const control of controls) {
    assert.equal(control.status, control.expectedStatus);
    assert.equal(control.report.error.issues[0].code, control.expectedCode);
  }
  assert.deepEqual(await readdir(cache), [], "configuration rejection must not populate the runtime cache");
  assert.equal(await readFile(invalidLock, "utf8"), "{}\n");
  assert.ok((await readdir(root)).every(name => ["configuration-results.json", "invalid-runtime-lock.json", "runtime-cache"].includes(name)
    || /^(report|control)-\d+\.json$/.test(name)), "refusal must not create build/boundary outputs");
});

test("Hermetic Build Entry refuses MLIR consumption without an explicit source checkout", async () => {
  const root = await createMlirFixture("mlir-input-");
  const report = path.join(root, "report.json");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_MLIR_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  }
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
    "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--out", path.join(root, "out"), "--report", report], { env, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.error.issues[0].code, "mlir-source-identity");
});

test("MLIR test runner refuses redirected temporary storage before creating fixtures", async () => {
  // This red fixture is deliberately E-to-E: it never points at C or old roots.
  const root = await createMlirFixture("mlir-temp-boundary-");
  const results = [];
  for (const [file, pattern] of [["mlir-build.test.mjs", "^Hermetic Build Entry"],
    ["mlir-legal.test.mjs", "mutable approvals"], ["mlir-python.test.mjs", "changed executable"],
    ["mlir-python.test.mjs", "expand the fixed tool-lock"]]) {
    const index = results.length;
    const target = path.join(root, `owned-target-${index}`);
    const redirected = path.join(root, `redirected-${index}`);
    await mkdir(target);
    await symlink(target, redirected, "junction");
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, TEMP: redirected, TMP: redirected, TMPDIR: redirected,
      TSFG_MLIR_TEST_TEMP_ROOT: redirected };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ["--test", "--test-name-pattern", pattern,
      fileURLToPath(new URL(file, import.meta.url))], { encoding: "utf8", windowsHide: true, env });
    assert.ifError(child.error);
    results.push({ file, pattern, status: child.status, stdout: child.stdout, stderr: child.stderr,
      targetMembers: await readdir(target) });
  }
  await writeFile(path.join(root, "runner-results.json"), JSON.stringify(results));
  for (const result of results) {
    assert.deepEqual(result.targetMembers, [], `${result.file}/${result.pattern} must leave the destination untouched`);
    assert.notEqual(result.status, 0, "redirected fixture storage must be rejected before mkdtemp");
    assert.match(result.stdout + result.stderr, /temporary storage.*ordinary|temporary storage.*redirected/);
  }
});

test("Hermetic Build Entry reports an invalid Python input with its integrity identity", async () => {
  const root = await createMlirFixture("mlir-python-report-");
  const report = path.join(root, "report.json");
  const env = { ...process.env, TSFG_MLIR_PYTHON_TOOL_ROOT: path.join(root, "missing-python") };
  for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
    "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--out", path.join(root, "missing-parent", "out"), "--report", report], { env, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.error.issues[0].code, "mlir-python-integrity");
  assert.equal(child.status, 11);
  assert.equal(result.error.category, "lock/integrity");
  assert.deepEqual(await readdir(root), ["report.json"], "read-only input refusal must not create output parents");
});

test("Hermetic Build Entry rejects a redirected output ancestor before creating a missing parent", async () => {
  const root = await createMlirFixture("mlir-output-boundary-");
  const target = path.join(root, "owned-target");
  const redirected = path.join(root, "redirected");
  await mkdir(target);
  await symlink(target, redirected, "junction");
  const report = path.join(root, "report.json");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
    "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--out", path.join(redirected, "missing-parent", "out"), "--report", report], { env, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.error.issues[0].code, "mlir-output-integrity");
  assert.equal(child.status, 11);
  assert.equal(result.error.category, "lock/integrity");
  assert.deepEqual(await readdir(target), [], "a rejected ancestor must not receive the missing parent");
});

test("Hermetic Build Entry requires a verified native closure after the approved source supplement", async () => {
  assert.ok(process.env.TSFG_MLIR_SOURCE, "actual source must be explicit");
  const root = await createMlirFixture("mlir-legal-gate-");
  const report = path.join(root, "report.json");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../eng/tsfg-build.mjs", import.meta.url)),
    "build", "--dev", "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
    "--out", path.join(root, "out"), "--report", report], { env, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  const result = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.error.issues[0].code, "mlir-tool-integrity");
  assert.equal(child.status, 11);
  assert.equal(result.error.category, "lock/integrity");
  assert.match(result.error.issues[0].message, /verified native tool closure/);
  assert.deepEqual(await readdir(root), ["report.json"], "missing tools must refuse before staging source");
  // Keep this exact non-configured fixture for the validated cleanup phase.
});

test("Hermetic Build Entry classifies missing or corrupted MLIR legal inputs as lock integrity", async () => {
  const workspace = fileURLToPath(new URL("../../", import.meta.url));
  for (const damage of ["missing-lock", "truncated-original-notice"]) {
    const root = await createMlirFixture(`mlir-legal-cli-${damage}-`);
    const eng = path.join(root, "eng");
    await cp(new URL("../../eng/", import.meta.url), eng, { recursive: true,
      filter: source => damage !== "missing-lock" || path.basename(source) !== "mlir-source-legal.lock.json" });
    if (damage === "truncated-original-notice") {
      const lock = JSON.parse(await readFile(path.join(eng, "mlir-source-legal.lock.json"), "utf8"));
      lock.files[0].notice = "incomplete original terms";
      await writeFile(path.join(eng, "mlir-source-legal.lock.json"), `${JSON.stringify(lock)}\n`);
    }
    const report = path.join(root, "report.json");
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("TSFG_RUNTIME_") || key.startsWith("TSFG_WINDOWS_")) delete env[key];
    const child = spawnSync(process.execPath, [path.join(eng, "tsfg-build.mjs"), "build", "--dev", "--workspace", workspace,
      "--source-target", "mlir-core", "--target", "windows-x86_64-msvc", "--profile", "debug",
      "--out", path.join(root, "out"), "--report", report], { env, encoding: "utf8", windowsHide: true });
    assert.ifError(child.error);
    const result = JSON.parse(await readFile(report, "utf8"));
    assert.equal(result.error.issues[0].code, "mlir-source-license");
    assert.equal(child.status, 11);
    assert.equal(result.error.category, "lock/integrity");
    assert.deepEqual((await readdir(root)).sort(), ["eng", "report.json"],
      "legal integrity must refuse before staging or configuring source");
  }
});
