// SPDX-License-Identifier: MIT
// Independent whole values were frozen before consumer implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  importNullableCapturedResponse, nullableSnapshotFacts,
  verifyNullableSnapshot, matchesNullableSnapshot,
} from '../../compiler/nullable-frontend.mjs';

const S4 = 'sha256:4205bc18e817d983dd0f91d5b1c1d92b99cff5f6e32eca419d22530bfdcf41ac';
const S5 = 'sha256:1c1e5c0e7b43a0a70fce4f73173033ad8a60554d8557533f6343b29c8c4cf5ce';
const fixtureSHA = 'sha256:bd97533ad248e12d60595a61b43d02d9453fe23298835b61405caf64f1b10da3';
const fixtureBytes = 286323;
const names = ['mask1-undefined', 'mask2-null', 'mask3-null-undefined', 'mask3-undefined-null'];

// These literal JSON graphs have ASCII keys and safe integer numbers. This
// independent standard-library recipe never imports a product canonicalizer.
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const digest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const fresh = value => JSON.parse(jcs(value));
function identityInput(input) {
  return { ...fresh(input), files: input.files.map(file => ({ path: file.path, content: file.content }))
    .sort((a,b) => Buffer.from(a.path).compare(Buffer.from(b.path))) };
}
function checkRanges(row, source) {
  for (const anchor of row.ranges) {
    const [start,end] = anchor.range;
    assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end) && !Object.is(start,-0)
      && !Object.is(end,-0) && start >= 0 && start < end && end <= source.length, anchor.label);
    for (const at of [start,end]) assert.ok(!(at > 0 && at < source.length
      && source.charCodeAt(at) >= 0xdc00 && source.charCodeAt(at) <= 0xdfff
      && source.charCodeAt(at-1) >= 0xd800 && source.charCodeAt(at-1) <= 0xdbff), anchor.label);
    assert.equal(source.slice(start,end), anchor.text, anchor.label);
  }
}
function sourceControls(row) {
  const request = JSON.parse(row.requestText), response = JSON.parse(row.responseText);
  assert.equal(jcs(request), row.requestText);
  assert.equal(jcs(response), row.responseText);
  assert.equal(digest(row.requestText), row.sourceOrigin.requestSha256);
  assert.equal(digest(row.responseText), row.sourceOrigin.responseSha256);
  assert.deepStrictEqual(Object.keys(row.sourceOrigin).sort(),
    ['kind','producerBaseOid','producerDirty','requestSha256','responseSha256','testedInputSetHash'].sort());
  assert.equal(row.sourceOrigin.kind, 'owned-go-nullable-response');
  assert.equal(row.sourceOrigin.producerBaseOid, '66b8cb886a2a5b233ca919775d918de22e45d292');
  assert.equal(row.sourceOrigin.producerDirty, true);
  assert.equal(row.sourceOrigin.testedInputSetHash,
    'sha256:cf338b02379c6688df8a82b7e604b0093d0a1e46879d8fe95697075cfe057ab5');
  const expected = row.expectedImportWrapper.snapshot;
  // The selected four literal requests have their two original path/content
  // files already in byte-path order and no optional checksum properties.
  assert.deepStrictEqual(request, { family:'tsfg.nullable-facts-request-candidate',
    version:4, schemaHash:S4, input:expected.identityInput });
  const input = identityInput(request.input), inputId = digest(jcs(input));
  const files = input.files.map(file => ({ path:file.path, digest:digest(file.content),
    byteLength:Buffer.byteLength(file.content), length:file.content.length, positionUnit:'utf16' }));
  assert.deepStrictEqual(row.expectedLegacy.inputs, files.map(file => file.path));
  assert.equal(row.expectedLegacy.status, 'ok');
  const payload = { inputIdentity:inputId, files, facts:row.expectedLegacy, exports:expected.exports };
  const requestId = digest('tsfg.nullable-facts.request.v4\0' + row.requestText);
  const packageId = digest('tsfg.nullable-facts.package.v4\0' + S4 + '\0' + jcs(payload));
  assert.deepStrictEqual(response, { family:'tsfg.nullable-facts-package-candidate', version:4,
    schemaHash:S4, requestId, packageId, payload });
  assert.deepStrictEqual(row.context, { sourceVersion:4, sourceSchemaHash:S4,
    expectedPackageId:packageId, expectedOrigin:row.sourceOrigin });
  const root = input.files.find(file => file.path === input.rootFile);
  assert.ok(root);
  checkRanges(row, root.content);
  assert.ok(root.content.startsWith('// 🧭 20k\r\n'));
  const snapshotId = digest('tsfg.frontend-nullable-candidate.snapshot.v4\0' + S5 + '\0'
    + jcs({ inputIdentity:inputId, sourceOrigin:row.sourceOrigin }));
  const whole = { format:{ family:'tsfg.frontend-nullable-candidate', version:4, schemaHash:S5 },
    snapshotId, sourceOrigin:row.sourceOrigin, inputIdentity:inputId, identityInput:input,
    source:{ path:root.path, content:root.content, hash:digest(root.content) }, target:input.target,
    inputs:files, functions:row.expectedLegacy.functions, symbols:row.expectedLegacy.symbols,
    exports:expected.exports, capture:{ request:row.requestText, response:row.responseText } };
  assert.deepStrictEqual(expected, whole);
  assert.deepStrictEqual(Object.keys(expected).sort(), ['format','snapshotId','sourceOrigin','inputIdentity',
    'identityInput','source','target','inputs','functions','symbols','exports','capture'].sort());
  assert.deepStrictEqual(row.expectedImportWrapper, { status:'ok', snapshot:whole });
  assert.equal(jcs(whole), row.snapshotJcsNoLf);
  assert.equal(jcs(row.expectedImportWrapper), row.importWrapperJcsNoLf);
  assert.equal(whole.functions.length, 2);
  assert.equal(whole.symbols.length, 5);
  // Manual full corpus: choose has only guards/refs/absence; entry has one call.
  assert.equal(whole.functions[1].body[0].expression.kind, 'call');
  assert.equal(whole.functions[1].body[0].expression.target, 's1');
  assert.deepStrictEqual(row.expectedVerifyNullableSnapshot, { snapshotId, functions:2, calls:1 });
  assert.equal(jcs(row.expectedVerifyNullableSnapshot), row.verifyJcsNoLf);
  assert.equal(row.expectedMatchesNullableSnapshot, true);
}

test('nullable presence capture v4 whole cold snapshot FIRST', async t => {
  const bytes = readFileSync(new URL('./nullable-presence-capture-first.json', import.meta.url));
  assert.equal(bytes.length, fixtureBytes);
  assert.equal(digest(bytes), fixtureSHA);
  const fixture = JSON.parse(bytes.toString('utf8'));
  assert.equal(jcs(fixture), bytes.toString('utf8'));
  assert.equal(fixture.sourceSchemaHash, S4);
  assert.equal(fixture.snapshotSchemaHash, S5);
  assert.deepStrictEqual(fixture.cases.map(row => row.name), names);
  let ranges = 0;
  // These synchronous assertions must all succeed before the FIRST import.
  // No product validator/helper is called by the complete Source controls.
  for (const row of fixture.cases) {
    sourceControls(row);
    ranges += row.ranges.length;
    t.diagnostic('TSFG_20L_SOURCE_CONTROL_COMPLETE ' + row.name);
  }
  assert.equal(ranges, 256);
  t.diagnostic('TSFG_20L_ALL_FOUR_SOURCE_CONTROLS_COMPLETE');
  for (const row of fixture.cases) {
    await t.test('public capture and cold whole values/' + row.name, () => {
      // BASE may naturally reject schema4 through its existing schema3 path.
      // Preserve that real exception; do not turn it into a passing throws test.
      const imported = importNullableCapturedResponse(Buffer.from(row.requestText),
        Buffer.from(row.responseText), fresh(row.sourceOrigin), fresh(row.context));
      assert.deepStrictEqual(imported, row.expectedImportWrapper);
      assert.equal(jcs(imported), row.importWrapperJcsNoLf);
      const cold = nullableSnapshotFacts(imported.snapshot, fresh(row.context));
      assert.deepStrictEqual(cold, row.expectedImportWrapper.snapshot);
      assert.equal(jcs(cold), row.snapshotJcsNoLf);
      const verified = verifyNullableSnapshot(imported.snapshot, fresh(row.context));
      assert.deepStrictEqual(verified, row.expectedVerifyNullableSnapshot);
      assert.equal(jcs(verified), row.verifyJcsNoLf);
      assert.equal(matchesNullableSnapshot(imported.snapshot, fresh(row.context)), true);
      t.diagnostic('TSFG_20L_WHOLE_PUBLIC_COLD_COMPLETE ' + row.name + ' ' + digest(jcs(imported)));
    });
  }
});
