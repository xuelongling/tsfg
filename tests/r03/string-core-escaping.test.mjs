// SPDX-License-Identifier: MIT
// Fixed cold protocol values only: no Source/admission/guest execution claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readStringFactsCandidate, writeStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { assertStringCoreSemantics } from './string-core-structural-oracle.mjs';

/** @param {string | Uint8Array} bytes */
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** @returns {Promise<any>} */
async function frozenOracle() {
  const bytes = await readFile(new URL('./string-core-escaping-oracle.json', import.meta.url));
  assert.equal(bytes.length, 56974);
  assert.equal(sha(bytes), 'd3fae8bd05dfb90b7700ea925cc622400e96794ce30db8a66a0f99458bbe636e');
  const oracle = JSON.parse(bytes.toString('utf8'));
  assert.equal(oracle.provenance.newOutputSampled, false);
  assert.equal(oracle.provenance.productImported, false);
  assert.equal(oracle.cases.length, 4);
  for (const c of oracle.cases) {
    for (const kind of ['facts', 'hir', 'core']) {
      const text = kind === 'core' ? c.core : c[kind + 'Text'];
      assert.equal(Buffer.byteLength(text), c[kind + 'Bytes']);
      assert.equal(sha(text), c[kind + 'SHA256']);
    }
    assert.equal('sha256:' + sha(Buffer.from(c.identityPreimages.requestHex, 'hex')), c.facts.requestId);
    assert.equal('sha256:' + sha(Buffer.from(c.identityPreimages.packageHex, 'hex')), c.expectedPackageId);
    assert.equal('sha256:' + sha(Buffer.from(c.identityPreimages.functionHex, 'hex')), c.hir.functions[0].id);
    assert.equal(c.facts.payload.files.find(file => file.path === c.facts.payload.rootFile).content, c.hir.source.content);
  }
  return oracle;
}

test('24g escaping FIRST: complete legal cold name/path controls precede whole Core equality', async t => {
  const oracle = await frozenOracle();
  /** @type {Array<{c:any,hir:any,context:any}>} */
  const prepared = [];
  for (const c of oracle.cases) {
    const factsBytes = Buffer.from(c.factsText), hirBytes = Buffer.from(c.hirText);
    const facts = readStringFactsCandidate(factsBytes);
    assert.deepEqual(facts, c.facts); assert.deepEqual(writeStringFactsCandidate(facts), factsBytes);
    const context = {factsBytes: Buffer.from(factsBytes), expectedPackageId: c.expectedPackageId};
    const built = buildHir(facts, context);
    assert.equal(built.status, 'ok', c.name + ' complete legal upstream control');
    assert.deepEqual(built.hir, c.hir);
    assert.deepEqual(verifyHir(c.hir, context), c.hir);
    assert.equal(printHir(c.hir, context), c.hirText);
    assert.deepEqual(readHir(hirBytes, context), c.hir);
    prepared.push({c, hir: JSON.parse(c.hirText), context});
  }
  t.diagnostic('24g escaping complete facts/HIR controls passed: CR/BS/FF name+path and literal backslash tokens; first lowerHir follows');
  // Natural RED is the first CR whole-Core mismatch. Do not catch it as success.
  // Later output assertions receive RED credit only if the actual run reaches them.
  for (const {c, hir, context} of prepared) {
    assert.equal(lowerHir(hir, context), c.core, c.name + ' complete independently frozen Core');
    assert.deepEqual(hir, c.hir); assert.equal(sha(context.factsBytes), c.factsSHA256);
  }
});

test('24g escaping same real C++ consumer retains exact decoded names and paths', {
  skip: process.env.TSFG_CORE_IR_EXE ? false : 'Root must explicitly supply the changed source-built Core CLI',
}, async t => {
  const oracle = await frozenOracle();
  for (const c of oracle.cases) await t.test(c.name, async () => {
    const first = await invokeCore(c.core, '--canonicalize'); accepted(first);
    assertStringCoreSemantics(first.stdout.toString('utf8'), c);
    const reread = await invokeCore(first.stdout, '--canonicalize'); accepted(reread);
    assert.deepEqual(reread.stdout, first.stdout);
    const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
    assert.deepEqual(optimized.stdout, first.stdout);
    assertStringCoreSemantics(optimized.stdout.toString('utf8'), c);
    const direct = await invokeCore(c.core, '--optimize'); accepted(direct);
    assert.deepEqual(direct.stdout, first.stdout);
  });
});
