// SPDX-License-Identifier: MIT
// Independent complete String Core oracle; no Source/VM/native execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readStringFactsCandidate, writeStringFactsCandidate } from "../../compiler/string-facts.mjs";
import { readStringFactsV2Candidate, writeStringFactsV2Candidate } from "../../compiler/string-facts-v2.mjs";
import { buildHir, verifyHir, printHir, readHir, lowerHir } from "../../compiler/hir.mjs";

/** @param {string | Uint8Array} bytes */
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
/** @param {string} file @param {number} length @param {string} digest */
async function frozen(file, length, digest) {
  const bytes = await readFile(new URL(file, import.meta.url));
  assert.equal(bytes.length, length, file + " complete byte count");
  assert.equal(sha(bytes), digest, file + " complete frozen identity");
  return bytes;
}

test("24g FIRST: every frozen whole String HIR lowers to independently fixed complete Core", async t => {
  const oracleBytes = await frozen("./string-core-oracle.json", 43500, "966556b4d767fe0643b1e52eb3df477c931e5107cbf510ccf30a60a805230e04");
  const oracle = JSON.parse(oracleBytes.toString("utf8"));
  assert.equal(oracle.provenance.newOutputSampled, false);
  assert.equal(oracle.provenance.lowerHirCalled, false);
  /** @type {Array<{hir:any,context:any,expected:any}>} */
  const prepared = [];
  // Finish ALL six immutable input checks and complete public controls first.
  for (const c of oracle.cases) {
    const factsBytes = await frozen("./" + c.factsFile, c.factsBytes, c.factsSHA256);
    const hirBytes = await frozen("./" + c.hirFile, c.hirBytes, c.hirSHA256);
    const readFacts = c.factsVersion === 1 ? readStringFactsCandidate : readStringFactsV2Candidate;
    const writeFacts = c.factsVersion === 1 ? writeStringFactsCandidate : writeStringFactsV2Candidate;
    const facts = readFacts(factsBytes);
    assert.deepEqual(facts, JSON.parse(factsBytes.toString("utf8")));
    assert.deepEqual(writeFacts(facts), factsBytes);
    assert.equal(facts.packageId, c.expectedPackageId);
    const expectedHir = JSON.parse(hirBytes.toString("utf8"));
    const context = { factsBytes: Buffer.from(factsBytes), expectedPackageId: c.expectedPackageId,
      ...(c.factsVersion === 2 ? { factsVersion: 2 } : {}) };
    const built = buildHir(facts, context);
    assert.equal(built.status, "ok", c.name + " full existing HIR positive control");
    assert.deepEqual(built.hir, expectedHir);
    assert.deepEqual(verifyHir(expectedHir, context), expectedHir);
    assert.equal(printHir(expectedHir, context), hirBytes.toString("utf8"));
    assert.deepEqual(readHir(hirBytes, context), expectedHir);
    assert.equal(Buffer.byteLength(c.core), c.coreBytes);
    assert.equal(sha(c.core), c.coreSHA256);
    prepared.push({ hir: expectedHir, context, expected: c });
  }
  assert.equal(prepared.length, 3);
  t.diagnostic("24g complete frozen facts/HIR controls passed: lossless14, ASI1, concat6; first lowerHir follows");
  // BASE naturally throws its current String capability error on the first call.
  // Do not catch it as expected success or claim later calls were reached in RED.
  for (const { hir, context, expected } of prepared) {
    assert.equal(lowerHir(hir, context), expected.core, expected.name + " whole Core output");
  }
});
