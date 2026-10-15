// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileProgram, sourceInput } from "../../compiler/pipeline.mjs";
import { intakeUnqualifiedHostCounter, verifyUnqualifiedHostCounterInputs } from "../../eng/host-counter.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function filesUnder(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new TypeError("SDK input must be a regular file or directory");
    if (item.isDirectory()) files.push(...await filesUnder(file));
    else if (item.isFile()) files.push(file);
    else throw new TypeError("unsupported SDK entry");
  }
  return files;
}

// Match the normal vm-build source contract without importing its execution entry.
// This test stages its own input copies and never writes into repository runtime/.
const runtimeSources = [...["root", "bytecode", "vm", "runtime", "main", "contract",
  "module_format", "module", "request", "host_counter", "clock", "execution_frame", "scalar"].map(name => `runtime/${name}.zig`),
  "runtime/host_counter.c", "runtime/host_counter_bridge.c"];
const metadata = value => Object.fromEntries(["dev", "ino", "mode", "nlink", "size",
  "mtimeNs", "ctimeNs", "birthtimeNs"].map(key => [key, String(value[key])]));

/** @param {{ path: string, sha256: string, bytes?: number }} pin */
async function readPinnedJson(pin) {
  assert.match(pin.path, /^E:[\\/]/i);
  assert.match(pin.sha256, /^(?:sha256:)?[0-9a-f]{64}$/);
  const stat = await lstat(pin.path, { bigint: true }), before = metadata(stat);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1048576n);
  assert.equal(path.resolve(await realpath(pin.path)).toLowerCase(), path.resolve(pin.path).toLowerCase());
  if (pin.bytes !== undefined) assert.equal(stat.size, BigInt(pin.bytes));
  const bytes = Buffer.alloc(Number(stat.size)), source = await open(pin.path, "r");
  let fdBefore, fdAfter, eof, at = 0;
  try {
    fdBefore = metadata(await source.stat({ bigint: true }));
    assert.deepEqual(fdBefore, before);
    while (at < bytes.length) {
      const read = await source.read(bytes, at, bytes.length - at, at);
      assert.ok(read.bytesRead > 0); at += read.bytesRead;
    }
    eof = (await source.read(Buffer.alloc(1), 0, 1, at)).bytesRead;
    fdAfter = metadata(await source.stat({ bigint: true }));
  } finally { await source.close(); }
  const after = metadata(await lstat(pin.path, { bigint: true }));
  assert.equal(eof, 0); assert.deepEqual(fdAfter, before); assert.deepEqual(after, before);
  const sha256 = digest(bytes);
  assert.equal(sha256, pin.sha256.replace(/^sha256:/, ""));
  return { value: JSON.parse(bytes.toString("utf8")),
    receipt: { path: pin.path, bytes: bytes.length, sha256, before, fdBefore, fdAfter, after, EOF: eof, sourceClosed: true } };
}

test("source-produced float packets preserve actual caller FP state on success, trap and abort", async () => {
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const temp = process.env.TSFG_MLIR_TEST_TEMP_ROOT;
  const zig = process.env.TSFG_ZIG_EXE;
  assert.match(temp, /^E:[\\/]/i);
  assert.match(zig, /^E:[\\/]/i);
  const bundlePath = process.env.TSFG_FP_COUNTER_BUNDLE;
  const expectedBundleSHA = process.env.TSFG_FP_COUNTER_BUNDLE_SHA256;
  assert.match(bundlePath, /^E:[\\/]/i);
  assert.match(expectedBundleSHA, /^sha256:[0-9a-f]{64}$/);
  // Root pins the header independently. Its parameters are trusted only after that check.
  const bundle = await readPinnedJson({ path: bundlePath, sha256: expectedBundleSHA });
  assert.equal(bundle.value.version, 1);
  assert.equal(bundle.value.purpose, "unqualified-runtime-bootstrap");
  const parameters = await readPinnedJson(bundle.value.parameters);
  const root = await mkdtemp(path.join(temp, "r03-float-environment-"));
  const product = path.join(root, "product"), stage = path.join(root, "runtime-inputs");
  await mkdir(path.join(product, "runtime"), { recursive: true });
  await mkdir(stage);
  const tools = { frontend: process.env.TSFG_FRONTEND_EXE,
    core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE };
  const lib = path.join(path.dirname(zig), "lib");
  const inputPaths = [process.execPath, zig, ...Object.values(tools),
    ...[tools.core, tools.vm].map(file => path.join(path.dirname(file), "artifact-manifest.json")),
    path.join(path.dirname(tools.frontend), "intake-ledger.json"),
    ...runtimeSources.map(name => path.join(repo, name)),
    ...["pipeline", "frontend", "hir", "identity", "float", "module-facts", "module-hir", "modules"]
      .map(name => path.join(repo, "compiler", `${name}.mjs`)),
    ...["host-counter.mjs", "host-counter-binary.mjs", "host-cost-source.lock.json", "build-inputs.json", "vm-build.mjs"]
      .map(name => path.join(repo, "eng", name)),
    bundlePath, bundle.value.parameters.path,
    ...["registry.json", "bytecode.schema.json", "hir.schema.json", "frontend-snapshot.schema.json"].map(name => path.join(repo, "contracts", name)),
    path.join(repo, "compiler/minimal-floats-v4.d.ts"), path.join(repo, "eng/frontend-source.lock.json"),
    path.join(repo, "eng/toolchains.lock.json"), import.meta.filename,
    path.join(repo, "tests/r03/fixtures/float-environment.zig"), ...await filesUnder(lib)];
  const inputs = [];
  for (const file of [...new Set(inputPaths)].sort()) {
    inputs.push({ path: file, sha256: digest(await readFile(file)) });
  }
  const record = { qualification: "actual native host probe; formal VMCLI is separately tested",
    root, node: process.execPath, zig, inputs, sdkRoot: lib, sources: [], packets: [], runtimeInputs: null,
    startedUtc: new Date().toISOString() };
  await writeFile(path.join(root, "before.json"), JSON.stringify(record, null, 2) + "\n");
  for (const type of ["f32", "f64"]) for (const kind of ["success", "trap"]) {
    const source = kind === "success"
      ? `function main(a:${type},b:${type}):${type}{return a+b;}`
      : `function main(a:${type},z:i32):${type}{const n:${type}=a+0.0;const v:i32=1/z;return n;}`;
    const actual = await compileProgram(await sourceInput(source), tools);
    assert.equal(actual.status, "ok", JSON.stringify(actual));
    const file = `${type}-${kind}.tbc`;
    await writeFile(path.join(root, file), actual.bytecode);
    record.sources.push({ file, source, sourceSha256: digest(source), hir: actual.hir, core: actual.core });
    record.packets.push({ path: file, sha256: digest(actual.bytecode) });
  }
  await writeFile(path.join(root, "probe.zig"), await readFile(path.join(repo, "tests/r03/fixtures/float-environment.zig")));
  for (const name of runtimeSources) {
    const source = path.join(repo, name), copied = path.join(product, name);
    await copyFile(source, copied);
    assert.equal(digest(await readFile(copied)), inputs.find(item => item.path === source).sha256);
  }
  // The sealed input supplies real objects and a false certificate, not execution authority.
  const prepared = await intakeUnqualifiedHostCounter({ bundlePath, expectedBundleSHA,
    product, stage, tools: parameters.value.tools });
  const counter = await verifyUnqualifiedHostCounterInputs(prepared, { product, stage });
  record.runtimeInputs = { product, stage, bundle: bundle.receipt, parameters: parameters.receipt, prepared };
  const args = ["test", counter.object, counter.bridgeObject, "--zig-lib-dir", lib, "--cache-dir", path.join(root, "local"),
    "--global-cache-dir", path.join(root, "global"), "-target", "x86_64-windows-msvc",
    "-mcpu", "x86_64_v2", "-ODebug", "-fno-lto", "--dep", "runtime", `-Mroot=${path.join(root, "probe.zig")}`,
    `-Mruntime=${path.join(product, "runtime/root.zig")}`];
  record.command = { executable: zig, args, cwd: root };
  await writeFile(path.join(root, "command.json"), JSON.stringify(record, null, 2) + "\n");
  const result = spawnSync(zig, args, { cwd: root, windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(path.join(root, "probe.log"), Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]));
  let runtimeInputRecheckError = null;
  try { assert.strictEqual(await verifyUnqualifiedHostCounterInputs(prepared, { product, stage }), counter); }
  catch (error) { runtimeInputRecheckError = String(error); }
  const changed = [];
  for (const item of inputs) if (digest(await readFile(item.path)) !== item.sha256) changed.push(item.path);
  const after = { status: result.status, signal: result.signal, error: result.error?.message,
    changed, runtimeInputRecheckError, finishedUtc: new Date().toISOString(), observationCount: result.stderr?.toString().match(/full-x87-environment equal/g)?.length ?? 0 };
  await writeFile(path.join(root, "after.json"), JSON.stringify(after, null, 2) + "\n");
  console.log(`FP environment evidence ${root}`);
  assert.deepEqual(changed, []);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.match(result.stderr.toString(), /All 1 tests passed/);
  assert.equal(after.observationCount, 80);
  assert.equal(runtimeInputRecheckError, null);
});
