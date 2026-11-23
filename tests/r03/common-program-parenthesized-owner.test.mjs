// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {analyzeCommonProgram,createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonEffects,commonEffectsCover} from '../../compiler/common-program-effects.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';

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
    const parameters = reads.map((read, index) => ({index, read, write: false, structural: false}));
    assert.deepEqual(row.derived.parameters, parameters, name + ' Derived parameter effects');
    assert.deepEqual(row.effective.parameters, parameters, name + ' Effective parameter effects');
    assert.deepEqual(publication.contracts.find(item => item.functionId === fn.id).upper.parameters,
      parameters, name + ' Published parameter effects');
  }
});

test('Common effects keep actual operations and only continuing owners at joins', async t => {
  const hir = projectCommonProgram(readCommonProgramFacts(fixture('package.json')));
  const selected = hir.functions.find(row => row.name === 'direct');
  const [initialize, assignRight, read] = selected.body;
  const left = initialize.initializer, right = assignRight.value.value;
  const assignLeft = {...assignRight, value:{...assignRight.value, value:left}};
  const stop = {...read, value:{kind:'numericLiteral', type:read.value.type, token:'0', decimal:'0', range:read.value.range}};
  const readLeft = {kind:'expression', value:{...read.value, receiver:left}, range:read.range};
  const readSelected = {...readLeft, value:read.value};
  const condition = {kind:'binary', operator:'===', type:scalarTypeIds.bool, left, right, range:assignRight.range};
  const lengthCondition = receiver => ({...condition, operator:'>', left:{...read.value, receiver}, right:stop.value});
  const branch = (then, otherwise=[]) => ({kind:'if', condition, then, else:otherwise, range:condition.range});
  const loop = body => ({kind:'while', condition, body, range:condition.range});
  const types = hir.types.some(type => type.id===condition.type) ? hir.types :
    [...hir.types, {id:condition.type, kind:'scalar', name:'bool'}];
  const published = createCommonProgramPublication(hir).contracts.find(row => row.functionId===selected.id).upper;
  const check = (body, reads) => {
    const fn = {...selected, body};
    const input = {...hir, types, functions:hir.functions.map(row => row===selected ? fn : row)};
    const spend = commonMeter(), effects = commonEffects(input, spend);
    const upper = effects.derived().get(fn.id);
    assert.deepEqual(upper.parameters.map(parameter => parameter.read), reads);
    const fixed = effects.derive(fn, new Map([[fn.id,published]])).upper;
    assert.deepEqual(fixed.parameters.map(parameter => parameter.read), reads);
    const ceiling = {...fixed, parameters:fixed.parameters.map((row,index) => ({...row, read:published.parameters[index].read}))};
    assert.equal(commonEffectsCover(ceiling, fixed, spend), !reads[0]);
  };
  await t.test('a terminal arm does not supply the later read', () =>
    check([initialize, assignRight, branch([assignLeft, stop]), read], [false, true]));
  await t.test('an operation before that return still contributes an effect', () =>
    check([initialize, assignRight, branch([assignLeft, readLeft, stop]), read], [true, true]));
  await t.test('both continuing arms can contribute a different owner', () =>
    check([initialize, assignRight, branch([assignLeft]), read], [true, true]));
  await t.test('both continuing arms overwrite the incoming owner', () =>
    check([initialize, branch([assignRight], [assignRight]), read], [false, true]));
  await t.test('a continuing block keeps its overwritten owner', () =>
    check([initialize, {kind:'block', body:[assignRight], range:assignRight.range}, read], [false, true]));
  await t.test('a terminating loop body does not change the initial exit', () =>
    check([initialize, assignRight, loop([assignLeft, stop]), read], [false, true]));
  await t.test('a continuing loop still contributes its possible written owner', () =>
    check([initialize, assignRight, loop([assignLeft]), read], [true, true]));
  await t.test('loop body reads owners carried by a previous iteration', () =>
    check([initialize, branch([assignRight], [assignRight]), loop([readSelected, assignLeft]), stop], [true, true]));
  await t.test('loop condition reads owners carried by a previous iteration', () =>
    check([initialize, branch([assignRight], [assignRight]), {...loop([assignLeft]), condition:lengthCondition(read.value.receiver)}, stop], [true, true]));
  await t.test('skipping a short-circuit right operand retains the incoming owner', () => {
    const short = {...condition, operator:'&&', left:condition, right:lengthCondition(assignRight.value)};
    check([initialize, branch([{...readSelected,value:short}], [assignRight]), read], [true, true]);
  });
  await t.test('catch can read the owner selected before a throw', () => {
    const thrown = {...stop, kind:'throw'};
    const terminated = {kind:'block', body:[assignLeft, thrown], range:condition.range};
    const attempt = {kind:'try', tryBlock:{body:[branch([terminated])]}, catchClause:{block:{body:[readSelected]}}, range:condition.range};
    check([initialize, assignRight, attempt, read], [true, true]);
  });
  await t.test('finally can read the owner selected before a return', () => {
    const terminated = {kind:'block', body:[assignLeft, stop], range:condition.range};
    const attempt = {kind:'try', tryBlock:{body:[branch([terminated])]}, finallyBlock:{body:[readSelected]}, range:condition.range};
    check([initialize, assignRight, attempt, read], [true, true]);
  });
  await t.test('a return inside try does not change the next loop iteration', () => {
    const attempt = {kind:'try', tryBlock:{body:[loop([readSelected, branch([assignLeft, stop])])]}, finallyBlock:{body:[]}, range:condition.range};
    check([initialize, assignRight, attempt, stop], [false, true]);
  });
  await t.test('a normal loop iteration inside try still carries its rebinding', () => {
    const attempt = {kind:'try', tryBlock:{body:[loop([readSelected, branch([assignLeft])])]}, finallyBlock:{body:[]}, range:condition.range};
    check([initialize, assignRight, attempt, stop], [true, true]);
  });
  await t.test('finally can rebind the continuing value without admitting returned owners', () => {
    const attempt = {kind:'try', tryBlock:{body:[branch([assignLeft, stop])]}, finallyBlock:{body:[assignRight]}, range:condition.range};
    check([initialize, assignRight, attempt, read], [false, true]);
  });
  await t.test('catch receives the owner at the throw and excludes returned owners', () => {
    const thrown = {...stop, kind:'throw'};
    const attempt = {kind:'try', tryBlock:{body:[branch([assignLeft, stop], [thrown])]},
      catchClause:{block:{body:[readSelected]}},range:condition.range};
    check([initialize, assignRight, attempt, stop], [false, true]);
  });
});
