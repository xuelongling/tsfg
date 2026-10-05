// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sha = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
// An independent encoding of the manifest's string-only identity domain.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function inspect(root) {
  assert.match(root, /^E:[\\/]/i, "TSFG_VM_BUILD_A/B must name independent formal source builds");
  const bytes = await readFile(path.join(root, "artifact-manifest.json"));
  const manifest = JSON.parse(bytes.toString("utf8"));
  const { digest: inputDigest, ...inputPayload } = manifest.buildInputSet;
  assert.equal(inputDigest, sha(canonical(inputPayload)));
  const { digest: identityDigest, ...identityPayload } = manifest.buildIdentity;
  assert.equal(identityDigest, sha(canonical(identityPayload)));
  assert.equal(identityPayload.buildInputSetDigest, inputDigest);
  assert.equal(identityPayload.toolchainClosureDigest,
    "sha256:a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85");
  assert.equal(identityPayload.options.sourceTarget, "tsfg-vm");
  assert.equal(identityPayload.profile, "debug");
  assert.equal(identityPayload.target, "windows-x86_64-msvc");
  assert.equal(manifest.contractSetId, sha(manifest.contractSet));
  const product = fileURLToPath(new URL("../../", import.meta.url));
  for (const entry of manifest.buildInputSet.entries) {
    assert.equal(entry.projectId, "tsfg");
    assert.ok(!path.isAbsolute(entry.repositoryRelativePath) && !entry.repositoryRelativePath.split("/").includes(".."));
    assert.equal(entry.sha256, sha(await readFile(path.join(product, entry.repositoryRelativePath))),
      `final production input differs: ${entry.repositoryRelativePath}`);
  }
  for (const name of ["root", "bytecode", "vm", "runtime", "main", "contract"])
    assert.ok(manifest.buildInputSet.entries.some(entry => entry.repositoryRelativePath === `runtime/${name}.zig`));
  assert.deepEqual((await readdir(root)).sort(), ["artifact-manifest.json", "tsfg-vm.exe", "tsfg-vm.pdb"]);
  for (const output of manifest.outputs) assert.equal(output.sha256, sha(await readFile(path.join(root, output.path))));
  return { root: await realpath(root), manifest, manifestSha256: sha(bytes) };
}

test("two independent formal Zig VM builds reproduce EXE, PDB and final input identity", async () => {
  const first = await inspect(process.env.TSFG_VM_BUILD_A);
  const second = await inspect(process.env.TSFG_VM_BUILD_B);
  assert.notEqual(first.root.toLowerCase(), second.root.toLowerCase());
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifestSha256, second.manifestSha256);
});
