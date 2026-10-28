// SPDX-License-Identifier: MIT
// Root alone launches this test with one freshly built Core CLI and owned storage.
// Per-child evidence uses the unchanged existing helper; this is not a new launcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { assertStringCoreSemantics } from './string-core-structural-oracle.mjs';

/** @param {Uint8Array} bytes */
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {string | URL} file @param {number} bytes @param {string} digest */
async function pinned(file, bytes, digest) {
  const raw = await readFile(file);
  assert.equal(raw.length, bytes, String(file) + ' whole length');
  assert.equal(sha(raw), digest, String(file) + ' whole immutable identity');
  return raw;
}
/** No fallback regex grants credit when parsing/traits reject before the String gate.
 * @param {any} actual @param {string} diagnostic */
function refused(actual, diagnostic) {
  assert.equal(actual.close.code, 3, actual.stderr.toString('utf8'));
  assert.equal(actual.stdout.length, 0, 'failure must not publish a partial output');
  assert.ok(actual.stderr.toString('utf8').includes(diagnostic), 'exact frozen diagnostic ' + diagnostic
    + '; earlier parser rejection is UNREACHED String gate:\n' + actual.stderr.toString('utf8'));
}

test('24g same real C++ CLI verifies every frozen String function and refuses malformed or unsupported output', async t => {
  const manifestPath = process.env.TSFG_STRING_CORE_CASES;
  assert.ok(manifestPath, 'TSFG_STRING_CORE_CASES must identify the independent frozen manifest');
  const raw = await pinned(manifestPath, 38390, '03ff00b51946ee63bbf2479c9544ef239985f77c602aa878978734f3df5ce2c2');
  const manifest = JSON.parse(raw.toString('utf8')), directory = path.dirname(manifestPath);
  assert.equal(manifest.provenance.newCppOutputSampled, false);
  await pinned(path.join(directory, manifest.descriptor.file), manifest.descriptor.bytes, manifest.descriptor.sha256);
  for (const p of Object.values(manifest.repositoryInputs)) {
    const item = /** @type {any} */ (p);
    await pinned(new URL('./' + item.file, import.meta.url), item.bytes, item.sha256);
  }
  const oracle = JSON.parse((await readFile(new URL('./string-core-oracle.json', import.meta.url))).toString('utf8'));
  const scalar = JSON.parse((await readFile(new URL('./string-core-default-scalar.json', import.meta.url))).toString('utf8'));
  /** @type {Map<string, Buffer>} */
  const inputs = new Map();
  // All immutable inputs and whole upstream independent controls finish before any CLI call.
  for (const c of manifest.cases) inputs.set(c.input,
    await pinned(path.join(directory, c.input), c.bytes, c.sha256));
  assert.equal(manifest.cases.length, 36);
  for (const c of oracle.cases) {
    const input = inputs.get('inputs/positive-' + c.name + '.mlir'); assert.ok(input);
    assert.deepEqual(input, Buffer.from(c.core));
    const counts = assertStringCoreSemantics(c.core, c);
    assert.equal(counts.functions, c.semantic.length);
  }
  const totals = oracle.cases.reduce((out, c) => {
    const n = assertStringCoreSemantics(c.core, c);
    return {functions: out.functions + n.functions, leaves: out.leaves + n.leaves, concats: out.concats + n.concats};
  }, {functions: 0, leaves: 0, concats: 0});
  assert.deepEqual(totals, {functions: 21, leaves: 27, concats: 6});
  const asi = oracle.cases.find(c => c.name === 'asi'); assert.ok(asi);
  assert.throws(() => assertStringCoreSemantics(asi.core.replace('array<i32: 65>', 'array<i32: 66>'), asi),
    {code: 'ERR_ASSERTION'});
  t.diagnostic('24g C++ independent whole oracle/input controls complete:21functions/27leaves/6concat');

  for (const c of manifest.cases.filter(c => c.expected.exitCode === 0)) await t.test(c.id, async () => {
    const input = inputs.get(c.input); assert.ok(input);
    const expected = oracle.cases.find(row => row.name === c.sourceOracle); assert.ok(expected);
    const first = await invokeCore(input, '--canonicalize'); accepted(first);
    assertStringCoreSemantics(first.stdout.toString('utf8'), expected);
    const reread = await invokeCore(first.stdout, '--canonicalize'); accepted(reread);
    assert.deepEqual(reread.stdout, first.stdout, 'same CLI complete canonical reread');
    const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
    assert.deepEqual(optimized.stdout, first.stdout, 'existing identity optimize preserves every canonical byte');
    assertStringCoreSemantics(optimized.stdout.toString('utf8'), expected);
    const direct = await invokeCore(input, '--optimize'); accepted(direct);
    assert.deepEqual(direct.stdout, first.stdout, 'original input identity optimize reaches same whole canonical bytes');
  });

  for (const c of manifest.cases.filter(c => c.expected.exitCode === 3)) await t.test(c.id, async () => {
    const input = inputs.get(c.input); assert.ok(input);
    refused(await invokeCore(input, c.expected.command), c.expected.diagnostic);
  });
  for (const c of manifest.wire) await t.test(c.sourceOracle + '/' + c.command, async () => {
    const input = inputs.get(c.input); assert.ok(input);
    refused(await invokeCore(input, c.command), '[r04-core-string-unsupported]');
  });
  await t.test('existing scalar branch canonical reread and identity optimize', async () => {
    assert.equal(scalar.provenance.emitterCalled, false);
    const first = await invokeCore(scalar.core, '--canonicalize'); accepted(first);
    const reread = await invokeCore(first.stdout, '--canonicalize'); accepted(reread);
    assert.deepEqual(reread.stdout, first.stdout);
    const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
    assert.deepEqual(optimized.stdout, first.stdout);
    const direct = await invokeCore(scalar.core, '--optimize'); accepted(direct);
    assert.deepEqual(direct.stdout, first.stdout);
  });
});
// No Source, VM, native instruction, guest execution, wire success or ResourceProof credit.
// Unreachable/unexercised output defenses remain explicitly static-only in the manifest.
