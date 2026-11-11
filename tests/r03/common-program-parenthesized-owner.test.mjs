// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {analyzeCommonProgram,createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {sha256} from '../../compiler/identity.mjs';

const fixture = name => readFileSync(new URL('./testdata/common-parenthesized-owner/' + name, import.meta.url));

test('Common Array effects follow the local owner after a parenthesized assignment', () => {
  const facts = readCommonProgramFacts(fixture('package.json'));
  const oracle = JSON.parse(fixture('official-oracle.json').toString('utf8'));
  const source = facts.payload.files.find(file => file.path === '/src/main.ts');
  assert.equal(sha256(source.content), 'sha256:' + oracle.sourceSha256);
  const hir = projectCommonProgram(facts);
  const publication = createCommonProgramPublication(hir);
  const report = analyzeCommonProgram(hir, publication);
  for (const name of ['direct', 'untouched', 'wrapped']) {
    const expected = oracle.functions[name];
    const fn = hir.functions.find(row => row.name === name);
    assert.deepEqual(fn.range, expected.function);
    assert.deepEqual(fn.body.at(-1).value.range, expected.read);
    if (expected.assignment) assert.deepEqual(fn.body[1].value.range, expected.assignment);
    const row = report.functions.find(item => item.functionId === fn.id);
    const reads = [expected.selectedOwner === 0, expected.selectedOwner === 1];
    assert.deepEqual(row.derived.parameters.map(parameter => parameter.read), reads, name + ' Derived read owners');
    assert.deepEqual(row.effective.parameters.map(parameter => parameter.read), reads, name + ' effective read owners');
    assert.deepEqual(publication.contracts.find(item => item.functionId === fn.id).upper.parameters.map(parameter => parameter.read),
      reads, name + ' Published read owners');
  }
});
