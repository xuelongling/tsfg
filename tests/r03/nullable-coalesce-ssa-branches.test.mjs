// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { emitCoreSsaFunction } from '../../compiler/core-ssa-emitter.mjs';
import { boolTypeId, i32TypeId } from '../../compiler/identity.mjs';

// Representation-only shared-SSA units. Synthetic policy nodes below are not
// public HIR, actual Source captures, provenance, Core consumer or execution.
const at = (start, end) => ({ start, end });
const outerRange = at(20, 90), innerRange = at(30, 70);
const reference = binding => ({ kind: 'reference', binding, type: i32TypeId, range: at(91, 92) });
const constant = value => ({ kind: 'constant', type: i32TypeId, decimal: String(value), token: String(value), range: at(40, 41) });
const write = (binding, value) => ({ kind: 'write', type: i32TypeId, operator: '=',
  left: { kind: 'reference', binding, type: i32TypeId, range: at(40, 41) }, right: constant(value), range: at(40, 42) });
function functionFor(value) {
  return { name: 'representation', range: at(0, 120), returnType: { id: i32TypeId },
    parameters: [{ id: 'c0', type: boolTypeId }, { id: 'c1', type: boolTypeId }, { id: 'x', type: i32TypeId }],
    body: [{ kind: 'local', binding: { id: 'result', type: i32TypeId }, initializer: value, range: at(10, 90) },
      { kind: 'return', value: reference('x'), range: at(91, 100) }] };
}
function emit(fn, hook) {
  return emitCoreSsaFunction(fn, { verified: { functions: [fn] }, functionSymbol: target => target.name, emitValueLeaf: hook });
}
function blocks(text) {
  const labels = [...text.matchAll(/^  \^(bb\d+)(?:\(([^)]*)\))?:$/gm)];
  return new Map(labels.map((label, index) => [label[1], { parameters: label[2] ?? '',
    body: text.slice(label.index + label[0].length, index + 1 < labels.length ? labels[index + 1].index : text.length) }]));
}
function edges(text, range) {
  const anchor = 'tsfg_source.start = ' + range.start + ' : i64, tsfg_source.end = ' + range.end + ' : i64';
  return text.split('\n').filter(line => line.includes('cf.br ') && line.includes(anchor)).map(line => {
    const match = line.match(/cf\.br \^(bb\d+)\((.*?) : (.*?)\)/); assert.ok(match);
    return { target: match[1], values: match[2].split(', '), types: match[3].split(', ') };
  });
}
const cfgError = error => error instanceof TypeError && /^r03-hir-cfg:/.test(error.message);

test('representation branchValue merges the real nested exits and isolates callback definitions', () => {
  const special = { kind: 'unitBranchPolicy', type: i32TypeId, range: outerRange };
  const fn = functionFor(special), before = JSON.stringify(fn), counts = { outerTrue: 0, outerFalse: 0, innerTrue: 0, innerFalse: 0 };
  let joinedValue, joinedX;
  const core = emit(fn, (value, api) => {
    if (value.kind !== 'unitBranchPolicy') return undefined;
    for (const hidden of ['blocks', 'current', 'definitions', 'declared']) assert.equal(Object.hasOwn(api, hidden), false);
    assert.equal(typeof api.branchValue, 'function'); assert.equal(api.lookup('x'), '%v2');
    joinedValue = api.branchValue(api.lookup('c0'), i32TypeId, outerRange, () => {
      counts.outerTrue++; assert.equal(api.lookup('x'), '%v2');
      return api.branchValue(api.lookup('c1'), i32TypeId, innerRange, () => {
        counts.innerTrue++; assert.equal(api.lookup('x'), '%v2');
        // Deliberate policy-local scratch definition tests definition isolation;
        // this is not presented as a checked Source/HIR local declaration.
        api.emit(write('unitScratch', 99));
        return api.emit(write('x', 11));
      }, () => {
        counts.innerFalse++; assert.equal(api.lookup('x'), '%v2'); assert.equal(api.lookup('unitScratch'), undefined);
        return api.emit(write('x', 22));
      });
    }, () => {
      counts.outerFalse++; assert.equal(api.lookup('x'), '%v2'); assert.equal(api.lookup('unitScratch'), undefined);
      return api.emit(write('x', 33));
    });
    joinedX = api.lookup('x'); assert.equal(api.lookup('unitScratch'), undefined);
    assert.notEqual(joinedX, '%v2'); assert.notEqual(joinedValue, joinedX);
    return joinedValue;
  });
  assert.deepEqual(counts, { outerTrue: 1, outerFalse: 1, innerTrue: 1, innerFalse: 1 });
  assert.equal(JSON.stringify(fn), before);
  assert.deepEqual(core.entryParameters, [{ name: '%v0', type: boolTypeId }, { name: '%v1', type: boolTypeId }, { name: '%v2', type: i32TypeId }]);
  assert.equal(core.resultType, 'i32'); assert.ok(core.reservedBodyBytes > 0);
  assert.doesNotMatch(core.blocksText, /undefined|tsfg_core\.undefined/);
  const graph = blocks(core.blocksText), outerEdges = edges(core.blocksText, outerRange), innerEdges = edges(core.blocksText, innerRange);
  assert.equal(outerEdges.length, 2); assert.equal(innerEdges.length, 2);
  for (const pair of [outerEdges, innerEdges]) {
    assert.equal(pair[0].target, pair[1].target);
    for (const edge of pair) assert.deepEqual(edge.types, ['i32', 'i32'], 'result and changed outer binding each have a typed phi');
  }
  const outerJoin = graph.get(outerEdges[0].target), innerJoin = graph.get(innerEdges[0].target);
  assert.ok(outerJoin); assert.ok(innerJoin);
  assert.equal(outerJoin.parameters, joinedValue + ': i32, ' + joinedX + ': i32');
  assert.ok(outerJoin.body.includes('"func.return"(' + joinedX + ')'), 'later outer read must use changed-binding phi');
  assert.ok(innerJoin.body.includes('cf.br ^' + outerEdges[0].target + '('), 'outer true arm branches from actual nested join exit');
  const outerConditional = core.blocksText.match(/cf\.cond_br %v0, \^(bb\d+), \^(bb\d+)/); assert.ok(outerConditional);
  const trueEntry = graph.get(outerConditional[1]), falseEntry = graph.get(outerConditional[2]); assert.ok(trueEntry); assert.ok(falseEntry);
  assert.ok(trueEntry.body.includes('cf.cond_br %v1,'));
  assert.ok(!trueEntry.body.includes('cf.br ^' + outerEdges[0].target + '('), 'terminated outer entry is not the true-arm exit');
  assert.ok(falseEntry.body.includes('cf.br ^' + outerEdges[0].target + '('));
  const innerParameters = innerJoin.parameters.split(', ').map(p => p.split(': ')[0]);
  const nestedOuter = edges(innerJoin.body, outerRange); assert.equal(nestedOuter.length, 1);
  assert.equal(nestedOuter[0].values[0], innerParameters[0]); assert.equal(nestedOuter[0].values[1], innerParameters[1]);
  assert.equal((core.blocksText.match(/cf\.cond_br /g) ?? []).length, 2);
});

test('representation branchValue invokes both value callbacks exactly once without exposing SSA state', () => {
  const fn = functionFor({ kind: 'unitSimpleBranch', type: i32TypeId, range: outerRange });
  const calls = [0, 0];
  const core = emit(fn, (value, api) => {
    if (value.kind !== 'unitSimpleBranch') return undefined;
    return api.branchValue(api.lookup('c0'), i32TypeId, outerRange,
      () => { calls[0]++; return api.emit(constant(1)); },
      () => { calls[1]++; return api.emit(constant(2)); });
  });
  assert.deepEqual(calls, [1, 1]);
  const joined = edges(core.blocksText, outerRange); assert.equal(joined.length, 2);
  assert.deepEqual(joined[0].types, ['i32']); assert.deepEqual(joined[1].types, ['i32']);
  assert.equal(blocks(core.blocksText).get(joined[0].target).parameters.split(', ').length, 1,
    'unchanged outer bindings do not get extra phi parameters');
});

for (const [label, missing, side] of [['undefined true', undefined, 0], ['null false', null, 1], ['empty true', '', 0]]) {
  test('representation branchValue rejects missing callback value: ' + label, () => {
    const fn = functionFor({ kind: 'unitMissingBranch', type: i32TypeId, range: outerRange }), calls = [0, 0];
    assert.throws(() => emit(fn, (value, api) => {
      if (value.kind !== 'unitMissingBranch') return undefined;
      return api.branchValue(api.lookup('c0'), i32TypeId, outerRange,
        () => { calls[0]++; return side === 0 ? missing : api.emit(constant(1)); },
        () => { calls[1]++; return side === 1 ? missing : api.emit(constant(2)); });
    }), cfgError);
    assert.deepEqual(calls, side === 0 ? [1, 0] : [1, 1]);
  });
}

test('representation branchValue rejects absence of a live insertion exit after function completion', () => {
  let saved;
  const fn = functionFor({ kind: 'unitSaveApi', type: i32TypeId, range: outerRange });
  emit(fn, (value, api) => {
    if (value.kind !== 'unitSaveApi') return undefined;
    saved = api; return api.emit(constant(1));
  });
  assert.ok(saved); let called = 0;
  assert.throws(() => saved.branchValue('%v0', i32TypeId, outerRange,
    () => { called++; return '%v2'; }, () => { called++; return '%v2'; }), cfgError);
  assert.equal(called, 0, 'no callbacks run without a live exit');
});
