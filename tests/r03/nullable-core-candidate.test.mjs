// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { canonical, coreCandidateSchema, descriptorFileSha256, nullableCoreFixture,
  scalarCoreControl, sha256 } from './nullable-core-fixtures.mjs';

// Only the qualified native C++ CLI is executed, by Root through invokeCore.
// This synthetic Core conformance fixture claims no Source, VM or runtime credit.
test('private nullable Core preserves declared masks, phi and proven internal calls without formal wire adoption', async () => {
  const descriptorBytes = await readFile(new URL('../../contracts/core-nullable-candidate.schema.json', import.meta.url));
  assert.equal(sha256(descriptorBytes), 'sha256:' + descriptorFileSha256);
  const descriptor = JSON.parse(descriptorBytes.toString('utf8'));
  assert.equal(sha256(canonical(descriptor)), coreCandidateSchema);

  // This must succeed first. Old0.8 helper fixtures would produce a mechanical
  // identity failure rather than a nullable capability RED.
  const scalar = await invokeCore(scalarCoreControl());
  accepted(scalar);

  const fixture = nullableCoreFixture();
  const first = await invokeCore(fixture.core);
  // RED belongs here only when the actual old CLI rejects nullable types/ops;
  // Root retains and classifies raw stderr. Missing tools/identity gates do not count.
  accepted(first);
  const printed = first.stdout.toString('utf8');
  assert.match(printed, /tsfg_core\.nullable\s*=\s*\{/);
  assert.ok(printed.includes('schema = "' + coreCandidateSchema + '"'));
  assert.ok(printed.includes('tsfg_core.source_hash = "' + fixture.source.hash + '"'));
  assert.equal((printed.match(/tsfg_nullable\.role = "entry"/g) ?? []).length, 1);
  assert.equal((printed.match(/tsfg_nullable\.role = "internal"/g) ?? []).length, 4);
  for (const mask of [1, 2, 3]) assert.match(printed, new RegExp('!tsfg_nullable\\.i32<\\s*' + mask + '\\s*>'));
  // Independently authored counts describe this five-function Core fixture.
  // They check preservation, not a private SSA numbering or a computed result.
  for (const [name, count] of /** @type {[string, number][]} */ ([['wrap_i32', 1], ['absence', 2], ['tag_test', 2], ['get', 1], ['retype', 3]])) {
    assert.equal(printed.split('"tsfg_nullable.' + name + '"').length - 1, count, name);
  }
  assert.equal(printed.split('"cf.br"').length - 1, 3);
  assert.equal(printed.split('"cf.cond_br"').length - 1, 4);
  assert.equal(printed.split('"func.call"').length - 1, 4);
  assert.equal(printed.split('"func.return"').length - 1, 7);
  for (const fn of fixture.functions) {
    assert.ok(printed.includes('tsfg_core.function_id = "' + fn.id + '"'), fn.name);
    assert.ok(printed.includes('tsfg_core.signature_hash = "' + fn.signatureHash + '"'), fn.name);
    assert.ok(printed.includes('tsfg_core.type_id = "' + fn.returnType + '"'), fn.name);
    assert.ok(printed.includes('tsfg_core.function_start = ' + fn.range.start + ' : i64'), fn.name);
    assert.ok(printed.includes('tsfg_core.function_end = ' + fn.range.end + ' : i64'), fn.name);
  }

  const again = await invokeCore(first.stdout);
  accepted(again);
  assert.deepEqual(again.stdout, first.stdout, 'canonical read/print is byte stable');
  const optimized = await invokeCore(first.stdout, '--optimize');
  accepted(optimized);
  assert.deepEqual(optimized.stdout, first.stdout, 'verified identity optimization preserves the complete Core');

  const formal = await invokeCore(first.stdout, '--emit-bytecode');
  assert.deepEqual(formal.exit, {code: 3, signal: null});
  assert.deepEqual(formal.close, {code: 3, signal: null});
  assert.equal(formal.stdout.length, 0, 'the private candidate cannot publish a formal packet');
  const diagnosticIds = [...formal.stderr.toString('utf8').matchAll(/\[[a-z0-9-]+\]/g)].map(match => match[0]);
  assert.deepEqual(diagnosticIds, ['[r04-core-nullable-unsupported]']);
});
