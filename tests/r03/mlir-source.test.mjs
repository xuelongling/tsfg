// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { readMlirSourceIdentity } from "../../eng/mlir-source.mjs";

test("MLIR source provenance reads the pinned complete real source without claiming build intake", async () => {
  const identity = await readMlirSourceIdentity({ sourceRoot: process.env.TSFG_MLIR_SOURCE, git: process.env.TSFG_GIT });
  assert.equal(identity.sourceCommit, "4cb57d27ddcad7c3a89d23ef576662a5c891e8c8");
  assert.equal(identity.baseCommit, "fc4aad7b5db3fff421df9a9637605b9ca5667881");
  assert.equal(identity.carrierUrl, "https://github.com/ifeuille/llvm-project.git");
  assert.equal(identity.canonicalUrl, "https://github.com/llvm/llvm-project.git");
  assert.equal(identity.status, "metadata-verified");
  assert.equal(identity.intakeComplete, false);
  assert.equal(identity.sourceBuild, "not-run");
});

test("MLIR provenance refuses implicit source and tool discovery", async () => {
  for (const input of [{ git: process.env.TSFG_GIT }, { sourceRoot: process.env.TSFG_MLIR_SOURCE },
    { sourceRoot: "llvm-project", git: process.env.TSFG_GIT }]) {
    await assert.rejects(readMlirSourceIdentity(input), { issueCode: "mlir-source-identity" });
  }
});

test("MLIR provenance rejects the original release checkout without the admitted metadata commit", async () => {
  assert.ok(process.env.TSFG_MLIR_BASE_SOURCE, "actual original release checkout must be explicit");
  await assert.rejects(readMlirSourceIdentity({ sourceRoot: process.env.TSFG_MLIR_BASE_SOURCE,
    git: process.env.TSFG_GIT }), { issueCode: "mlir-source-identity" });
});
