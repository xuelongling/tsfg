// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const source = await readFile(new URL("../../eng/tsfg-build.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function testSmoke(");
const end = source.indexOf("\nconst SYNTHETIC_CHANGE_SEMANTICS", start);
assert.ok(start >= 0 && end > start);
const testSmokeSource = source.slice(start, end);
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function exercise({ target = "windows-x86_64-msvc", profile = "debug",
  baseline = true, tamper = false, collision = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "tsfg-cpu-fixture-regression-"));
  const output = path.join(root, "build");
  const windows = target === "windows-x86_64-msvc";
  const cpp = Buffer.from("declared cpp payload");
  const zig = Buffer.from("declared zig payload");
  const suffix = windows ? ".exe" : "";
  const cppPath = path.join(output, "bin", `tsfg-r00-cpp-smoke${suffix}`);
  const payloads = [cpp, zig].map((bytes, index) => ({
    path: `bin/tsfg-r00-${index === 0 ? "cpp" : "zig"}-smoke${suffix}`,
    sha256: digest(bytes),
  }));
  const identity = { buildIdentity: { target, profile }, buildInputSet: { entries: [] } };
  const metadata = { ...identity, buildPolicy: {}, development: false, dirty: false,
    publishable: true, networkIsolation: {}, payloads };
  const calls = [];
  const writes = [];
  let preservedCollision;
  try {
    await mkdir(path.join(output, "bin"), { recursive: true });
    await writeFile(cppPath, cpp, { flag: "wx" });
    await writeFile(path.join(output, ...payloads[1].path.split("/")), zig, { flag: "wx" });
    await writeFile(path.join(output, "build-metadata.json"), JSON.stringify(metadata), { flag: "wx" });
    // Execute the complete production function, including case construction,
    // metadata checks, real file reads/hashes/exclusive writes and cleanup.
    // Only identity/sandbox preparation and native execution are test doubles;
    // this regression never starts a compiler, sandbox, or native smoke process.
    const dependencies = {
      path, randomUUID, mkdir, mkdtemp, rm, chmod, digest,
      tmpdir: () => root,
      process: { platform: windows ? "win32" : "linux" },
      ConfigurationError: Error, TestFailureError: Error, WorkspaceMismatchError: Error,
      canonicalize: JSON.stringify,
      readCanonicalJson: async (file) => JSON.parse(await readFile(file, "utf8")),
      readRegularFile: (file) => readFile(file),
      payloadOptions: () => ({}), createBuildPolicy: () => ({}),
      createBuildIdentity: async () => identity,
      WINDOWS_NETWORK_ISOLATION: {},
      materializeBuildInputs: async () => {},
      compileSandbox: async () => ({ executable: "unused-sandbox" }),
      verifyWindowsSandboxControl: async () => ({ executable: "unused-sandbox" }),
      verifyWindowsSandboxBoundary: () => {}, closureToolPath: () => "unused-shell",
      writeFile: async (file, bytes, options) => {
        assert.equal(options.flag, "wx", "payload writes must remain exclusive");
        writes.push(file);
        if (collision) await writeFile(file, "existing unrelated bytes", { flag: "wx" });
        try {
          await writeFile(file, bytes, options);
        } catch (error) {
          if (collision) preservedCollision = await readFile(file, "utf8");
          throw error;
        }
      },
      runSmokeExecutable: (name, executable, outputRoot, _runtime, _sandbox,
        _sandboxRoot, _shell, _deniedRoot, arguments_, executionMode) => {
        assert.deepEqual(readFileSync(executable), name === "zig-smoke" ? zig : cpp);
        const relative = path.relative(outputRoot, executable);
        assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
        calls.push({ name, executable, arguments: arguments_, executionMode });
        if (tamper && name === "cpp-smoke") writeFileSync(cppPath, "changed between cases");
        return name === "zig-smoke"
          ? { stdout: "", stderr: "tsfg-r00-zig-smoke: ok\n" }
          : { stdout: `tsfg-r00-cpp-smoke: ${arguments_.length ? "baseline fallback ok" : "ok"}${windows ? "\r\n" : "\n"}`, stderr: "" };
      },
    };
    const testSmoke = new Function(...Object.keys(dependencies), `return (${testSmokeSource});`)(
      ...Object.values(dependencies),
    );
    const options = new Map([["--target", target], ["--profile", profile], ["--out", output]]);
    if (baseline) options.set("--cpu-fixture", "x86-64-v2");
    const run = testSmoke(options, { platform: target }, { root }, "blocked");
    if (tamper) {
      await assert.rejects(run, /cpp-smoke-baseline-fallback executable does not match Build Metadata/);
      assert.equal(calls.length, 1);
    } else if (collision) {
      await assert.rejects(run, { code: "EEXIST" });
      assert.equal(preservedCollision, "existing unrelated bytes");
      assert.equal(calls.length, 0);
    } else {
      const result = await run;
      const expected = ["cpp-smoke", ...(baseline ? ["cpp-smoke-baseline-fallback"] : []), "zig-smoke"];
      assert.deepEqual(result.tests, expected.map((name) => ({ name, status: "passed" })));
      assert.deepEqual(calls.map(({ name }) => name), expected);
      assert.deepEqual(calls.map(({ arguments: args }) => args),
        [[], ...(baseline ? [["--cpu-fixture=x86-64-v2"]] : []), []]);
      assert.equal(new Set(writes).size, writes.length);
      assert.equal(calls.at(-1).executionMode, windows ? "toolchain-runtime" : "direct-executable");
    }
    for (const file of writes) await assert.rejects(readFile(file), { code: "ENOENT" });
  } finally {
    const relative = path.relative(tmpdir(), root);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await rm(root, { recursive: true, force: true });
  }
}

for (const target of ["windows-x86_64-msvc", "linux-x86_64-gnu"]) {
  for (const profile of ["debug", "release"]) {
    test(`CPU fixture materializes repeated C++ payload: ${target} ${profile}`,
      () => exercise({ target, profile }));
  }
}
test("ordinary smoke materialization remains valid", () => exercise({ baseline: false }));
test("CPU fixture rejects payload changed between cases", () => exercise({ tamper: true }));
test("smoke materialization refuses to overwrite an existing destination", () => exercise({ collision: true }));
