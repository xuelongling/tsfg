// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { repositoryRoot, windowsLauncher } from "./build-entry-paths.mjs";
import { compileWindowsSandbox, windowsSandboxArguments, verifyWindowsSandboxBoundary } from "../../eng/build-windows-sandbox.mjs";
import { WINDOWS_SANDBOX_EXECUTABLE_DIGEST } from "../../eng/build-errors.mjs";
import { buildWindows } from "../../eng/build-windows.mjs";
import { buildLinux } from "../../eng/build-linux.mjs";
import { normalizeWindowsExecutable } from "../../eng/build-normalization.mjs";

test("Windows sandbox control uses the locked normative compiler and R00 CPU baseline", async () => {
  const controlCompiler = compileWindowsSandbox.toString();
  assert.equal(typeof compileWindowsSandbox, "function");
  assert.ok(controlCompiler.length > 0);
  const launcher = await readFile(windowsLauncher, "utf8");
  assert.match(controlCompiler, /runBuildTool\([\s\S]*?tools\.clangcl/);
  assert.match(controlCompiler, /"\/clang:-march=x86-64-v2"/);
  assert.match(controlCompiler, /"\/clang:-mtune=generic"/);
  assert.doesNotMatch(controlCompiler, /const zig =/);
  const digest = WINDOWS_SANDBOX_EXECUTABLE_DIGEST.slice("sha256:".length);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.match(launcher, new RegExp(`set "TSFG_CONTROL_ID=${digest}"`));
});

test("Windows network canary starts Node under WFP without the path-restricted token", async () => {
  const sandboxSource = await readFile(path.join(repositoryRoot, "eng", "windows-sandbox-run.c"), "utf8");
  const argumentsSource = windowsSandboxArguments.toString();
  const verifier = verifyWindowsSandboxBoundary.toString();
  assert.equal(typeof windowsSandboxArguments, "function");
  assert.ok(argumentsSource.length > 0);
  assert.equal(typeof verifyWindowsSandboxBoundary, "function");
  assert.ok(verifier.length > 0);
  assert.match(argumentsSource, /if \(policy\.networkOnly\)[\s\S]*"--network-only"/);
  assert.match(verifier, /"network-canary"[\s\S]*boundaryStatus: 123, networkOnly: true/);
  assert.match(verifier, /copyFileSync\(process\.env\.ComSpec, undeclaredInputCanary\)/);
  assert.match(verifier, /"undeclared-input-canary"[\s\S]*boundaryStatus: 124[\s\S]*undeclaredInputCanary/);
  assert.doesNotMatch(verifier.slice(verifier.indexOf('"undeclared-input-canary"')), /networkOnly: true/);
  assert.doesNotMatch(sandboxSource, /command_grant/);
  assert.match(sandboxSource, /validate restricted read path/);
});

test("MSVC compatibility compilation writes its compiler PDB inside the writable boundary", () => {
  const buildWindowsSource = buildWindows.toString();
  assert.equal(typeof buildWindows, "function");
  assert.ok(buildWindowsSource.length > 0);
  assert.match(buildWindowsSource, /const compatibilityPdb = path\.join\(compatibilityRoot, "compiler\.pdb"\)/);
  assert.match(buildWindowsSource, /`\/Fd\$\{compatibilityPdb\}`/);
});

test("Windows executable normalization fails closed on malformed PE data directories", () => {
  const normalizer = normalizeWindowsExecutable.toString();
  assert.equal(typeof normalizeWindowsExecutable, "function");
  assert.ok(normalizer.length > 0);
  assert.match(normalizer, /readUInt32LE\(optionalOffset \+ 108\) < 7/);
  assert.match(normalizer, /debugDirectorySize <= rawSize - relativeOffset/);
  assert.match(normalizer, /debugDirectorySize <= bytes\.length - rawOffset - relativeOffset/);
});

test("native debug identities exclude serializer layout noise and embedded build roots", async () => {
  const pdbNormalizer = await readFile(new URL("../../eng/build-normalization.mjs", import.meta.url), "utf8");
  const linuxNormalizer = buildLinux.toString();
  assert.match(pdbNormalizer, /function canonicalWindowsPdbStringTable\(/);
  assert.match(pdbNormalizer, /function neutralizeWindowsPdbIdentity\(/);
  assert.equal(typeof buildLinux, "function");
  assert.ok(linuxNormalizer.length > 0);
  assert.match(pdbNormalizer, /StreamSizes:[\s\S]*\[ 0, 0,/);
  assert.match(pdbNormalizer, /new Set\(features\.split\(","\)/);
  assert.match(pdbNormalizer, /canonicalWindowsPdbSemantics\(preliminaryNeutral\) !== semanticIdentityYaml/);
  assert.match(pdbNormalizer, /fixed-point canonicalization/);
  assert.match(pdbNormalizer, /canonicalWindowsPdbStringTable\(preliminaryNeutral\)/);
  assert.match(pdbNormalizer, /neutralizeWindowsPdbIdentity\(verified\)/);
  assert.match(pdbNormalizer, /replace\(\/\^MSF:[\s\S]*StringTable:/);
  assert.match(pdbNormalizer, /new Set\(entries\)/);
  assert.match(pdbNormalizer, /entry === "  - '\.external'" \? "  - \.external"/);
  assert.match(pdbNormalizer, /replaceAll\("'\.external'", "\.external"\)/);
  assert.match(pdbNormalizer, /replaceAll\("'\.'", "\."\)/);
  assert.match(pdbNormalizer, /publicRecords\.sort\(/);
  assert.match(pdbNormalizer, /PublicsStream:\\n  Records:/);
  assert.match(linuxNormalizer, /normalizeEmbeddedPaths\(zigBytes/);
  assert.match(linuxNormalizer, /\[sourceRoot, "\.workspace"\]/);
  assert.match(linuxNormalizer, /\[runtime\.closurePath, "\.toolchain"\]/);
  assert.match(linuxNormalizer, /\[workRoot, "\.build"\]/);
  assert.match(linuxNormalizer, /writeFile\(publishedZig, normalizedZigBytes/);
});
