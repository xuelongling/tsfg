// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createCommonProgramPublication } from '../../compiler/common-program-analysis.mjs';
import { commonProgramCore } from '../../compiler/common-program-core.mjs';
import { readCommonProgramFacts } from '../../compiler/common-program-facts.mjs';
import { projectCommonProgram } from '../../compiler/common-program-hir.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const reportRoot = process.env.TSFG_NATIVE_CATCH_REPORT_ROOT;
const reports = reportRoot
  ? JSON.parse(await fs.readFile(path.join(reportRoot, 'index.json'), 'utf8'))
  : {};
const fixtures = [{
  name: 'native-catch-control',
  unknown: false,
  pins: [
    '26a6d0ab1b69842b50022e003d234395957fd1e2014588dddddbeaf0425b4c3c',
    '0034872cbb55cdefc2e91b57543848cea4eddf7481ee29bb6528e38a74acca30',
    '193ef8a40e17722526e2f05442ab843cc468c755770fba8eb87dd151999ae817',
  ],
}, {
  name: 'managed-catch-control',
  unknown: true,
  pins: [
    '0d121a4a9fdd8fc9bec2122005e2361e08960b07a4ac8d17d88225662644e8f0',
    '794edc53f521848e1c0aa15b3ebf3d811d384e62f3dfab208f06e95f96a3a477',
    '8ed3f8300792e6ac2bcd1208d62501172b57ed1d3607f5a701ff0824e44d190b',
  ],
}];

for (const fixture of fixtures) {
  const files = await Promise.all(['package.json', 'official-oracle.json', 'source.ts']
    .map(name => fs.readFile(new URL('./testdata/common-native-catch/' + fixture.name + '/' + name, import.meta.url))));
  assert.deepEqual(files.map(sha), fixture.pins);
  const [packet, oracleBytes, sourceBytes] = files;
  const oracle = JSON.parse(oracleBytes.toString('utf8'));
  const source = sourceBytes.toString('utf8');
  const hir = projectCommonProgram(readCommonProgramFacts(packet));
  const publication = createCommonProgramPublication(hir);
  const core = commonProgramCore(hir, publication, {
    targets: hir.closure.requiredRoots.filter(row => row.kind === 'kernel').map(row => row.target).sort(),
  });
  const caller = hir.functions.find(row => row.name === oracle.target);
  const box = hir.types.find(row => row.name === 'Box');
  assert.ok(caller && box);
  const field = box.fields.find(row => row.name === 'n');
  assert.ok(field);
  const expectedField = publication.scope.storage.fields.find(row => row.fieldId === field.id);
  assert.ok(expectedField);

  test('official ' + fixture.name + ' retains its original catch and fixed field capacity', () => {
    assert.equal(oracle.sourceSha256, sha(sourceBytes));
    assert.deepEqual(oracle.diagnostics, []);
    assert.equal(hir.sources.find(row => row.path === '/src/main.ts').content, source);
    assert.equal(hir.functions.length, oracle.functions.length);
    for (const original of oracle.functions) {
      const fn = hir.functions.find(row => row.sourceBinding === original.id);
      assert.ok(fn);
      assert.deepEqual([fn.name, fn.range], [original.name, original.range]);
    }
    const caught = caller.body[0].catchClause;
    assert.equal(caller.body[0].kind, 'try');
    assert.deepEqual(caught.range, oracle.catchControl.range);
    assert.equal(caught.binding.id, oracle.catchControl.binding);
    assert.equal(oracle.catchControl.declaredType, 'unknown');
    assert.equal(hir.types.find(row => row.id === caught.binding.type).kind, 'unknown');
    assert.deepEqual(oracle.catchControl.writes, []);
    const returned = caught.block.body[0];
    assert.equal(caught.block.body.length, 1);
    assert.deepEqual([returned.kind, returned.value.kind, returned.value.expression.binding],
      ['return', 'as', caught.binding.id]);
    const throwing = hir.functions.find(row => row.name === (fixture.unknown ? 'failManaged' : 'failNative'));
    assert.ok(throwing);
    assert.deepEqual(throwing.body[0].range, oracle.catchControl.throws[0].range);
    assert.equal(throwing.body[0].kind, 'throw');
    assert.equal(oracle.catchControl.throws[0].text, fixture.unknown ? 'new Box()' : '7');
    assert.equal(expectedField.unknown, fixture.unknown);
    assert.deepEqual(expectedField.actualTypes, fixture.unknown ? [] : [field.type]);
  });

  test('complete C++ verifier accepts ' + fixture.name + ' with its exact fixed upper',
    {skip: reportRoot ? false : 'TSFG_NATIVE_CATCH_REPORT_ROOT is not supplied'}, async () => {
      assert.ok(path.isAbsolute(reportRoot));
      const directory = reports[fixture.name];
      assert.ok(path.isAbsolute(directory));
      const observed = JSON.parse(await fs.readFile(path.join(directory, 'observed.json'), 'utf8'));
      assert.equal(observed.qualified, true);
      assert.deepEqual(observed.first, []);
      assert.deepEqual([observed.exit.code, observed.close.code], [0, 0]);
      assert.equal(await fs.readFile(path.join(directory, 'raw/stderr.bin'), 'utf8'), '');
      const config = JSON.parse(await fs.readFile(path.join(directory, 'config.json'), 'utf8'));
      assert.equal(config.args.length, 1);
      assert.equal(sha(await fs.readFile(config.args[0])), sha(Buffer.from(core.text)));
      const result = JSON.parse(await fs.readFile(path.join(directory, 'raw/stdout.bin'), 'utf8'));
      assert.equal(result.completeCoreVerified, true);
      assert.equal(result.inputIdentity, hir.inputIdentity);
      assert.equal(result.functions, hir.functions.length + hir.modules.length);
      assert.ok(result.remainingWork > 0 && result.remainingWork < 4_000_000);
      assert.equal(result.executionAuthority, false);
      const actual = result.fixedFields.find(row => row.fieldId === field.id);
      assert.deepEqual(actual, expectedField);
    });
}
