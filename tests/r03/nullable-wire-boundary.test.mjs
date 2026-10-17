// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { canonical, coreCandidateSchema, nullableCoreFixture, scalarCoreControl,
  sha256 } from './nullable-core-fixtures.mjs';

// Root executes only the qualified Core CLI. These are entry/serialization
// boundaries, with no packet execution or new Source/Runtime/BIS claim.
const command = '--emit-nullable-candidate';
/** @param {{exit: {code: number, signal: string | null}, close: {code: number, signal: string | null}, stdout: Buffer, stderr: Buffer}} result @param {string} diagnostic */
function rejectedExactly(result, diagnostic) {
  assert.deepEqual(result.exit, {code: 3, signal: null});
  assert.deepEqual(result.close, {code: 3, signal: null});
  assert.equal(result.stdout.length, 0, 'rejection publishes no partial packet');
  assert.equal(result.stderr.toString('utf8').replace(/\r\n/g, '\n'), diagnostic + '\n');
}

test('private wire requires a marked and fully validated Core candidate', async () => {
  const scalar = scalarCoreControl();
  accepted(await invokeCore(scalar));
  rejectedExactly(await invokeCore(scalar, command),
    '[r04-core-nullable-required] --emit-nullable-candidate requires a marked nullable candidate module');

  // One invalid entity identity tests this new command's validation ordering.
  // The existing Core boundary suite owns the larger metadata/tagproof matrix.
  const fixture = nullableCoreFixture(), entry = fixture.functions[0];
  const original = 'tsfg_core.function_id = "' + entry.id + '"';
  assert.equal(fixture.core.split(original).length - 1, 1, 'one authored mutation anchor');
  const invalid = fixture.core.replace(original, 'tsfg_core.function_id = "sha256:' + '0'.repeat(64) + '"');
  rejectedExactly(await invokeCore(invalid, command),
    '[core-ir-nullable-metadata] recomputed candidate entity identity differs');
});

/** @param {ReturnType<typeof nullableCoreFixture>} fixture */
function packetBudgetCore(fixture) {
  const functionCount = 512, constantsPerFunction = 120;
  const span = 'tsfg_source.start = 0 : i64, tsfg_source.end = 1 : i64';
  const coreStart = fixture.core.indexOf('func.func @');
  assert.ok(coreStart > 0, 'preserve the exact existing marked module header');
  const hashRecord = (/** @type {string} */ domain, /** @type {unknown} */ record) =>
    sha256(domain + '\0' + coreCandidateSchema + '\0' + canonical(record));
  const typeId = hashRecord('tsfg.core-nullable-candidate.type.v1', {kind: 'scalar', name: 'i32'});
  const signature = hashRecord('tsfg.core-nullable-candidate.signature.v1', {parameters: [], returnType: typeId});
  const constants = Array.from({length: constantsPerFunction}, (_, i) =>
    '  %v' + i + ' = "tsfg_core.constant"() {value = 0 : i32, ' + span + '} : () -> i32').join('\n');
  const functions = Array.from({length: functionCount}, (_, i) => {
    const name = 'budget' + String(i).padStart(3, '0');
    const id = hashRecord('tsfg.core-nullable-candidate.function.v1',
      {name, signatureHash: signature, source: {digest: fixture.source.hash, path: fixture.source.path}});
    // Each function has one block,120 scalar registers, a unique entry fuel and
    // a dominating return value. Every original UTF16 anchor is the valid0..1.
    return 'func.func @' + name + '() -> i32 attributes {tsfg_core.function_id = "' + id
      + '", tsfg_core.signature_hash = "' + signature + '", tsfg_core.type_id = "' + typeId
      + '", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 1 : i64, tsfg_nullable.role = "'
      + (i === 0 ? 'entry' : 'internal') + '"} {\n'
      + '  "tsfg_core.fuel"() {event = 1 : i32, ' + span + '} : () -> ()\n'
      + constants + '\n  "func.return"(%v119) {' + span + '} : (i32) -> ()\n}';
  });
  const core = fixture.core.slice(0, coreStart) + functions.join('\n') + '\n}\n';
  // This lower bound needs no producer mirror: only the frozen80-byte header,
  // each function's4-byte role plus three32-byte identities, and base16 records.
  // It deliberately omits all names, types, block tables and global metadata.
  const packetLowerBound = 80 + functionCount * (100 + 16 * (constantsPerFunction + 2));
  return {core, packetLowerBound};
}

test('private packet budget rejects valid Core below the separate input/output Core budget', async () => {
  const {core, packetLowerBound} = packetBudgetCore(nullableCoreFixture());
  assert.ok(Buffer.byteLength(core, 'utf8') < 8388608, 'generated Core remains under8MiB');
  assert.equal(packetLowerBound, 1050704);
  assert.ok(packetLowerBound > 1048576, 'mandatory packet fields alone exceed1MiB');
  // This real positive MUST finish before the serialization negative. A Core
  // parse/metadata/SSA/proof/print failure cannot count as a packet budget test.
  const canonicalControl = await invokeCore(core);
  accepted(canonicalControl);
  assert.ok(canonicalControl.stdout.length > 0 && canonicalControl.stdout.length <= 8388608);
  rejectedExactly(await invokeCore(core, command),
    '[r04-core-nullable-invalid] private packet identity, encoding or byte budget differs');
});
