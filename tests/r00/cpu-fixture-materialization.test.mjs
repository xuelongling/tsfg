// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as identityModule from "../../eng/build-identity.mjs";
import * as linuxSandbox from "../../eng/build-linux-sandbox.mjs";
import * as windowsSandbox from "../../eng/build-windows-sandbox.mjs";
import * as toolchain from "../../eng/build-toolchain.mjs";
import { canonicalize } from "../../eng/build-data.mjs";
import { WINDOWS_NETWORK_ISOLATION } from "../../eng/build-errors.mjs";
import { createBuildPolicy } from "../../eng/build-policy.mjs";
import { payloadOptions } from "../../eng/build-options.mjs";

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
  const metadata = {
    ...identity,
    buildPolicy: createBuildPolicy(target, profile, payloadOptions(new Map())),
    development: false, dirty: false, publishable: true,
    networkIsolation: WINDOWS_NETWORK_ISOLATION, payloads,
  };
  const calls = [];
  const writes = [];
  let preservedCollision;
  const moduleMocks = [];
  try {
    await mkdir(path.join(output, "bin"), { recursive: true });
    await writeFile(cppPath, cpp, { flag: "wx" });
    await writeFile(path.join(output, ...payloads[1].path.split("/")), zig, { flag: "wx" });
    await writeFile(path.join(output, "build-metadata.json"), `${canonicalize(metadata)}\n`, { flag: "wx" });
    // Execute the complete production function, including case construction,
    // metadata checks, real file reads/hashes/exclusive writes and cleanup.
    // Module mocks replace only identity/sandbox preparation and native execution;
    // this regression never starts a compiler, sandbox, or native smoke process.
    const mockModule = (specifier, namedExports) => {
      // Builtin namespaces contain a default object with nonconfigurable constants.
      // Mock only named bindings; preserve the real functions for unrelated exports.
      const { default: _default, ...exports } = namedExports;
      moduleMocks.push(mock.module(new URL(specifier, import.meta.url).href, { namedExports: exports }));
    };
    moduleMocks.push(mock.module("node:process", {
      defaultExport: { platform: windows ? "win32" : "linux" },
    }));
    mockModule("node:os", { ...os, tmpdir: () => root });
    mockModule("node:fs/promises", { ...fsPromises, writeFile: async (file, bytes, options) => {
        assert.equal(options.flag, "wx", "payload writes must remain exclusive");
        writes.push(file);
        if (collision) await writeFile(file, "existing unrelated bytes", { flag: "wx" });
        try {
          await writeFile(file, bytes, options);
        } catch (error) {
          if (collision) preservedCollision = await readFile(file, "utf8");
          throw error;
        }
      } });
    mockModule("../../eng/build-identity.mjs", {
      ...identityModule,
      createBuildIdentity: async () => identity,
      materializeBuildInputs: async () => {},
    });
    mockModule("../../eng/build-linux-sandbox.mjs", {
      ...linuxSandbox,
      compileSandbox: async () => ({ executable: "unused-sandbox" }),
    });
    mockModule("../../eng/build-windows-sandbox.mjs", {
      ...windowsSandbox,
      verifyWindowsSandboxControl: async () => ({ executable: "unused-sandbox" }),
      verifyWindowsSandboxBoundary: () => {},
    });
    mockModule("../../eng/build-toolchain.mjs", { ...toolchain, closureToolPath: () => "unused-shell" });
    mockModule("../../eng/build-runtime-execution.mjs", {
      observeHostPlatform: async () => { throw new Error("package runtime seam is outside this fixture"); },
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
    });
    const { testSmoke } = await import(new URL(
      `../../eng/build-smoke.mjs?cpu-fixture=${randomUUID()}`, import.meta.url,
    ).href);
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
    for (const moduleMock of moduleMocks.reverse()) moduleMock.restore();
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
