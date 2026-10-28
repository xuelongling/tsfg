// SPDX-License-Identifier: MIT
// Invalid candidates start from independent expected data, never a production-produced HIR.
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { fixture, context, copy, wire, hirReject, primary, stringType } from './string-concat-hir-independent-fixtures.mjs';

/** Cold negatives use independent JCS, never the production printer that would reject earlier.
 * @param {any} f @param {any} bad @param {any} expected */
function rejectsEverywhere(f, bad, expected) {
  hirReject(() => verifyHir(bad, context(f.factsBytes)), 'invalid', expected);
  hirReject(() => printHir(bad, context(f.factsBytes)), 'invalid', expected);
  hirReject(() => readHir(wire(bad), context(f.factsBytes)), 'invalid', expected);
  hirReject(() => lowerHir(bad, context(f.factsBytes)), 'invalid', expected);
}
/** @type {Array<[string, string, (fn: any) => void]>} */
const anchoredChanges = [
  ['function ID', 'declaration', fn => { fn.id = 'sha256:' + '0'.repeat(64); }],
  ['function name', 'declaration', fn => { fn.name += 'wrong'; }],
  ['function signature', 'declaration', fn => { fn.signatureHash = 'sha256:' + '0'.repeat(64); }],
  ['function return type', 'declaration', fn => { fn.returnType.id = 'sha256:' + '0'.repeat(64); }],
  ['function range', 'declaration', fn => { fn.range = {start: 0, end: 1}; }],
  ['function unknown field', 'declaration', fn => { fn.sourcePath = '/untrusted.ts'; }],
  ['function parameters', 'declaration', fn => { fn.parameters = [{}]; }],
  ['function body count', 'declaration', fn => { fn.body.push(copy(fn.body[0])); }],
  ['return kind', 'statement', fn => { fn.body[0].kind = 'throw'; }],
  ['return range', 'statement', fn => { fn.body[0].range = {start: 0, end: 1}; }],
  ['return unknown field', 'statement', fn => { fn.body[0].extra = true; }],
  ['return missing value', 'statement', fn => { delete fn.body[0].value; }],
  ['concat kind', 'concat', fn => { fn.body[0].value.kind = 'stringConstant'; }],
  ['concat type', 'concat', fn => { fn.body[0].value.type = 'sha256:' + '0'.repeat(64); }],
  ['concat range', 'concat', fn => { fn.body[0].value.range = {start: 0, end: 1}; }],
  ['concat unknown result', 'concat', fn => { fn.body[0].value.codeUnits = []; }],
  ['plus range', 'operator', fn => { fn.body[0].value.operatorRange = {start: 0, end: 1}; }],
  ['plus shape', 'operator', fn => { fn.body[0].value.operatorRange = {start: 0}; }],
  ['left record', 'left', fn => { fn.body[0].value.left = null; }],
  ['left kind', 'left', fn => { fn.body[0].value.left.kind = 'stringConcat'; }],
  ['left type', 'left', fn => { fn.body[0].value.left.type = 'sha256:' + '0'.repeat(64); }],
  ['left range', 'left', fn => { fn.body[0].value.left.range = {start: 0, end: 1}; }],
  ['left units', 'left', fn => { fn.body[0].value.left.codeUnits = [65535]; }],
  ['left extra', 'left', fn => { fn.body[0].value.left.extra = true; }],
  ['right record', 'right', fn => { fn.body[0].value.right = null; }],
  ['right kind', 'right', fn => { fn.body[0].value.right.kind = 'stringConcat'; }],
  ['right type', 'right', fn => { fn.body[0].value.right.type = 'sha256:' + '0'.repeat(64); }],
  ['right range', 'right', fn => { fn.body[0].value.right.range = {start: 0, end: 1}; }],
  ['right units', 'right', fn => { fn.body[0].value.right.codeUnits = [65535]; }],
  ['right extra', 'right', fn => { fn.body[0].value.right.extra = true; }],
];
test('24f every later owner has exact trusted function return concat plus and operand anchors', async t => {
  for (const owner of [1, 2, 3, 4, 5]) for (const [name, rangeName, change] of anchoredChanges) {
    await t.test('owner ' + owner + ' ' + name, async () => {
      const f = await fixture(), bad = copy(f.hir), row = f.manual.rows[owner];
      change(bad.functions[owner]);
      const range = row[rangeName];
      rejectsEverywhere(f, bad, {sourceId: '/oracle24e/corpus.ts', start: range[0], end: range[1]});
    });
  }
});

test('24f operand identity order and owner placement cannot be folded or normalized', async t => {
  /** @type {Array<[string, number, string, (h: any) => void]>} */
  const cases = [
    ['split operands reversed', 2, 'left', h => { const v = h.functions[2].body[0].value; [v.left, v.right] = [v.right, v.left]; }],
    ['surrogate pair folded to left', 2, 'left', h => { const v = h.functions[2].body[0].value; v.left.codeUnits = [55357, 56960]; v.right.codeUnits = []; }],
    ['paired duplicate moved', 4, 'left', h => { const v = h.functions[4].body[0].value; v.left.codeUnits = []; v.right.codeUnits = [55358, 56813, 55358, 56813]; }],
    ['decomposed normalized', 5, 'left', h => { h.functions[5].body[0].value.left.codeUnits = [233]; }],
    ['precomposed decomposed', 5, 'right', h => { h.functions[5].body[0].value.right.codeUnits = [101, 769]; }],
    ['right from another owner', 3, 'right', h => { h.functions[3].body[0].value.right = copy(h.functions[2].body[0].value.right); }],
    ['nested concat in leaf', 3, 'left', h => { h.functions[3].body[0].value.left = copy(h.functions[2].body[0].value); }],
  ];
  for (const [name, owner, side, change] of cases) await t.test(name, async () => {
    const f = await fixture(), bad = copy(f.hir); change(bad);
    rejectsEverywhere(f, bad, primary(f.hir.functions[owner].body[0].value[side].range));
  });
});

test('24f HIR complete root source target count and exact 0.11 metadata remain bound', async t => {
  /** @type {Array<[string, (h: any) => void]>} */
  const changes = [
    ['old version', h => { h.contractVersion = '0.10.0'; }],
    ['old schema', h => { h.schemaHash = 'sha256:7d242a9f29da88f1b0cd08bab906912b6bb45e51c4b859755676bac2c2e1fcac'; }],
    ['mixed metadata', h => { h.contractVersion = '0.10.0'; h.schemaHash = 'sha256:' + '0'.repeat(64); }],
    ['unknown root', h => { h.format = {}; }],
    ['source path', h => { h.source.path = '/unknown.ts'; }],
    ['source bytes', h => { h.source.content += ' '; }],
    ['source hash', h => { h.source.hash = 'sha256:' + '0'.repeat(64); }],
    ['target triple', h => { h.target.triple = 'unknown'; }],
    ['missing owner', h => { h.functions.pop(); }],
    ['extra owner', h => { h.functions.push(copy(h.functions[5])); }],
  ];
  for (const [name, change] of changes) await t.test(name, async () => {
    const f = await fixture(), bad = copy(f.hir); change(bad);
    rejectsEverywhere(f, bad, undefined);
  });
  const f = await fixture(), bad = copy(f.hir);
  [bad.functions[2], bad.functions[3]] = [bad.functions[3], bad.functions[2]];
  rejectsEverywhere(f, bad, primary(f.hir.functions[2].range));
  assert.equal(f.hir.functions[5].body[0].value.type, stringType);
});
