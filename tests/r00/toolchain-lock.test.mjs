// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

test("minimal toolchain lock content-locks Node.js and pnpm for both R00 hosts", async () => {
  const lockBytes = await readFile(path.join(repositoryRoot, "eng", "toolchains.lock.json"), "utf8");
  const lock = JSON.parse(lockBytes);
  assert.equal(lock.schemaVersion, "1");
  assert.equal(lock.unpackedTreeAlgorithm, "tsfg-tree-sha256-v1");
  assert.deepEqual(Object.keys(lock.tools).sort(), ["node", "pnpm"]);
  assert.equal(lock.tools.node.version, "24.20.0");
  assert.equal(lock.tools.pnpm.version, "11.25.0");
  for (const tool of Object.values(lock.tools)) {
    assert.equal(tool.license, "MIT");
    assert.notEqual(tool.signature.kind, "");
    assert.notEqual(tool.signature.signer, "");
    assert.deepEqual(
      tool.artifacts.map(({ platform }) => platform).sort(),
      ["linux-x86_64", "windows-x86_64"],
    );
    for (const artifact of tool.artifacts) {
      assert.match(artifact.url, /^https:\/\//);
      assert.match(artifact.byteSize, /^[1-9][0-9]*$/);
      assert.match(artifact.archiveSha256, /^sha256:[0-9a-f]{64}$/);
      assert.match(artifact.unpackedTreeSha256, /^sha256:[0-9a-f]{64}$/);
    }
  }

  assert.deepEqual(
    lock.tools.node.artifacts.map(({ platform, byteSize, archiveSha256, unpackedTreeSha256 }) => ({
      platform,
      byteSize,
      archiveSha256,
      unpackedTreeSha256,
    })),
    [
      {
        platform: "linux-x86_64",
        byteSize: "58006679",
        archiveSha256: "sha256:855d581f8a4eb1a8117e3426de25fe02770592febcfb31369aee1ffbfee9e8ec",
        unpackedTreeSha256: "sha256:bc82944c0f67b447ef59239765344b4a1be75aa2752a7a958693c8ba6e118427",
      },
      {
        platform: "windows-x86_64",
        byteSize: "37539751",
        archiveSha256: "sha256:6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba",
        unpackedTreeSha256: "sha256:d3c8d5a3cd0b70b8ca9184537edd6d221b3dea6b006de0e348308f102a7822e9",
      },
    ],
  );
  assert.deepEqual(
    lock.tools.pnpm.artifacts.map(({ platform, byteSize, archiveSha256, unpackedTreeSha256 }) => ({
      platform,
      byteSize,
      archiveSha256,
      unpackedTreeSha256,
    })),
    [
      {
        platform: "linux-x86_64",
        byteSize: "51293579",
        archiveSha256: "sha256:11caeed8b581d460638f836f10f6ead19cbf08d774a5b8e502628b20ebf3ac43",
        unpackedTreeSha256: "sha256:286c1dc4795dd9e1344075a0587eef58d57866ccfd6588e9679363e0727cb178",
      },
      {
        platform: "windows-x86_64",
        byteSize: "41121270",
        archiveSha256: "sha256:2d0203af85fc6fbb40f786a2671f175e9119a7c6dfcc4f30b1fa17e0f072c301",
        unpackedTreeSha256: "sha256:ec42c6f14b4d5b21f98c61ec41ff1019d1e2c5c70867cc1417f0d740b7d584af",
      },
    ],
  );

  const closureIdentities = {};
  for (const target of ["linux-x86_64", "windows-x86_64"]) {
    const tools = Object.keys(lock.tools).sort().map((id) => {
      const tool = lock.tools[id];
      const artifact = tool.artifacts.find(({ platform }) => platform === target);
      return {
        id,
        version: tool.version,
        platform: artifact.platform,
        archiveSha256: artifact.archiveSha256,
        unpackedTreeSha256: artifact.unpackedTreeSha256,
      };
    });
    closureIdentities[target] = createHash("sha256")
      .update(canonicalize({ schemaVersion: lock.schemaVersion, target, tools }))
      .digest("hex");
  }
  assert.deepEqual(closureIdentities, {
    "linux-x86_64": "af94259f095e563d0c3f6d370c9085e3fc10f406b56b368b22c6fea399804793",
    "windows-x86_64": "120ce553cd29c0cf5584101ec422491570410560797b9ca6e253e79580304291",
  });
  for (const [launcher, target] of [["tsfg-build", "linux-x86_64"], ["tsfg-build.cmd", "windows-x86_64"]]) {
    assert.match(
      await readFile(path.join(repositoryRoot, "eng", launcher), "utf8"),
      new RegExp(closureIdentities[target]),
    );
  }
  assert.doesNotMatch(
    await readFile(path.join(repositoryRoot, "eng", "tsfg-build.mjs"), "utf8"),
    /execFileSync\(["']tar["']/,
    "prefetch must not fall back to a system tar executable",
  );
});
