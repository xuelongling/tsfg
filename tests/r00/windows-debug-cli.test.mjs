// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const acceptanceRoot = process.env.TSFG_WINDOWS_ACCEPTANCE_ROOT;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function zipEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const time = bytes.readUInt16LE(offset + 10);
    const date = bytes.readUInt16LE(offset + 12);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataOffset = offset + 30 + nameLength + extraLength;
    assert.equal(method, 0, `${name} must use deterministic STORE compression`);
    entries.push({ bytes: bytes.subarray(dataOffset, dataOffset + size), date, mode: 0, name, time });
    offset = dataOffset + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  for (const entry of entries) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    assert.equal(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"), entry.name);
    entry.mode = bytes.readUInt32LE(offset + 38) >>> 16;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("Windows debug build, smoke test, and package share one normalized Build Identity", {
  skip: process.platform !== "win32" || !acceptanceRoot,
}, async () => {
  const buildRoot = path.join(acceptanceRoot, "tsfg-r00-win-build-final");
  const packageRoot = path.join(acceptanceRoot, "tsfg-r00-win-package-final");
  const [buildReport, testReport, packageReport] = await Promise.all([
    "tsfg-r00-win-build-final-report.json",
    "tsfg-r00-win-test-final-report.json",
    "tsfg-r00-win-package-final-report.json",
  ].map(async (name) => JSON.parse(await readFile(path.join(acceptanceRoot, name), "utf8"))));
  for (const report of [buildReport, testReport, packageReport]) {
    assert.equal(report.status, "success");
    assert.equal(report.network, "offline");
    assert.equal(report.result.networkCanary, "blocked");
  }
  assert.deepEqual(testReport.result.tests, [
    { name: "cpp-smoke", status: "passed" },
    { name: "zig-smoke", status: "passed" },
  ]);
  assert.equal(buildReport.result.publishable, true);
  assert.deepEqual(packageReport.result.buildIdentity, buildReport.result.buildIdentity);

  const files = await readdir(packageRoot);
  assert.deepEqual(files.sort(), [packageReport.result.archive, packageReport.result.checksums].sort());
  const archiveBytes = await readFile(path.join(packageRoot, packageReport.result.archive));
  const checksums = JSON.parse(await readFile(path.join(packageRoot, packageReport.result.checksums), "utf8"));
  assert.equal(checksums.archive.sha256, sha256(archiveBytes));
  assert.deepEqual(checksums.buildIdentity, buildReport.result.buildIdentity);
  const entries = zipEntries(archiveBytes);
  assert.deepEqual(entries.map(({ name }) => name), [
    "artifact-manifest.json",
    "bin/tsfg-r00-cpp-smoke.exe",
    "bin/tsfg-r00-zig-smoke.exe",
    "contract-set.json",
    "symbols/tsfg-r00-cpp-smoke.pdb",
    "symbols/tsfg-r00-zig-smoke.pdb",
  ]);
  assert.deepEqual(entries.map(({ mode }) => mode), [0o644, 0o755, 0o755, 0o644, 0o644, 0o644]);
  assert.equal(new Set(entries.map(({ date, time }) => `${date}:${time}`)).size, 1);
  const manifestEntry = entries[0];
  const manifest = JSON.parse(manifestEntry.bytes.toString("utf8"));
  assert.equal(checksums.artifactManifest.sha256, sha256(manifestEntry.bytes));
  assert.deepEqual(manifest.buildIdentity, buildReport.result.buildIdentity);
  assert.deepEqual(manifest.members, entries.slice(1).map((entry) => ({
    path: entry.name,
    sha256: sha256(entry.bytes),
  })));
  for (const entry of entries) {
    assert.equal(entry.bytes.includes(Buffer.from(acceptanceRoot)), false, entry.name);
    assert.equal(entry.bytes.includes(Buffer.from(buildRoot)), false, entry.name);
  }
});
