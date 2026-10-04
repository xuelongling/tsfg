// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const sha = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
// Independent encoding of this string-only identity domain. Do not use the
// producer's identity/digest helper to verify its own output.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function inspect(root) {
  assert.ok(root, "TSFG_MLIR_BUILD_A/B must name actual independent clean source builds");
  assert.match(root, /^E:[\\/]/i);
  const manifestBytes = await readFile(path.join(root, "artifact-manifest.json"), "utf8");
  const manifest = JSON.parse(manifestBytes);
  const { digest: inputDigest, ...inputPayload } = manifest.buildInputSet;
  assert.equal(inputDigest, sha(canonical(inputPayload)));
  const { digest: identityDigest, ...identityPayload } = manifest.buildIdentity;
  assert.equal(identityDigest, sha(canonical(identityPayload)));
  assert.equal(identityPayload.buildInputSetDigest, inputDigest);
  assert.equal(identityPayload.toolchainClosureDigest, manifest.toolchainClosureDigest);
  assert.equal(identityPayload.options.sourceTarget, "mlir-core");
  assert.equal(identityPayload.profile, "debug");
  assert.equal(identityPayload.target, "windows-x86_64-msvc");
  assert.match(manifest.contractSetId, /^sha256:[0-9a-f]{64}$/);
  const identities = manifest.buildInputSet.entries.map(entry => `${entry.projectId}\0${entry.repositoryRelativePath}`);
  assert.deepEqual(identities, [...identities].sort((a, b) => Buffer.from(a).compare(Buffer.from(b))));
  assert.equal(new Set(identities).size, identities.length);
  for (const name of ["compiler/core-ir/main.cpp", "compiler/core-ir/CMakeLists.txt", "eng/mlir-source-legal.lock.json"])
    assert.ok(identities.includes(`tsfg\0${name}`), `owned input absent: ${name}`);
  for (const name of ["UPSTREAM.toml", "llvm/lib/Support/xxhash.cpp", "llvm/include/llvm/Support/xxhash.h",
    "llvm/lib/Support/MD5.cpp", "llvm/include/llvm/Support/MD5.h", "llvm/lib/Support/UnicodeNameToCodepointGenerated.cpp"])
    assert.ok(identities.includes(`llvm-project.git\0${name}`), `actual source input absent: ${name}`);
  for (const entry of manifest.buildInputSet.entries) {
    assert.ok(["100644", "100755"].includes(entry.normalizedMode));
    assert.match(entry.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.ok(!path.isAbsolute(entry.repositoryRelativePath) && !entry.repositoryRelativePath.split("/").includes(".."));
  }
  assert.deepEqual((await readdir(root)).sort(), ["artifact-manifest.json", ...manifest.outputs.map(output => output.path)].sort());
  for (const output of manifest.outputs) {
    assert.ok(!path.isAbsolute(output.path) && !output.path.split("/").includes(".."));
    assert.notEqual(output.path, "artifact-manifest.json", "manifest must not hash itself");
    assert.equal(sha(await readFile(path.join(root, output.path))), output.sha256);
  }
  return { root: await realpath(root), manifest, manifestSha256: sha(manifestBytes) };
}

test("two independent clean MLIR builds reproduce all payload and detached debug identities", async () => {
  const first = await inspect(process.env.TSFG_MLIR_BUILD_A);
  const second = await inspect(process.env.TSFG_MLIR_BUILD_B);
  assert.notEqual(first.root.toLowerCase(), second.root.toLowerCase(), "rebuilds cannot reuse one output");
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.ok(first.manifest.outputs.some(output => output.path === "tsfg-core-ir.exe"));
  assert.ok(first.manifest.outputs.some(output => output.path === "tsfg-core-ir.pdb"));
});
