// SPDX-License-Identifier: MIT
// A later block-scoped const shadows the global callee even before its declaration.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { fixture, packet, fresh, hash, canonical, wire, reframe, caught, factsError } from './array-call-test-helpers.mjs';

test('23e cold complete lexical scope rejects a call forged past a later const callee shadow', async () => {
  const row = await fixture('core-call-only-refusal'), original = packet(row);
  assert.deepEqual(readArrayFactsCandidate(Buffer.from(row.packageText)), original, 'independent legal whole control');
  const hostile = fresh(original), entry = hostile.payload.functions.find(fn => fn.name === 'entry');
  const globalLeaf = hostile.payload.functions.find(fn => fn.name === 'leaf');
  assert.ok(entry && globalLeaf); assert.deepEqual(entry.body.map(stmt => stmt.kind), ['variable','call','return']);
  const originalCall = fresh(entry.body[1]), originalArray = fresh(entry.bindings[0]);
  const position = entry.body[2].range.start, inserted = 'const leaf = a;\n  ', delta = inserted.length;
  const file = hostile.payload.files.find(item => item.path === hostile.payload.rootFile);
  assert.ok(file); assert.equal(file.content.slice(position,position + 6), 'return');
  assert.equal(file.content.slice(position - 2,position), '  ', 'original indentation remains before new const');
  /** @param {any} value */
  function shift(value) {
    if (!value || typeof value !== 'object') return;
    if (Object.keys(value).length === 2 && Number.isInteger(value.start) && Number.isInteger(value.end)) {
      if (value.start >= position) { value.start += delta; value.end += delta; }
      else if (value.end >= position) value.end += delta;
      return;
    }
    Object.values(value).forEach(shift);
  }
  shift(entry);
  const nameRange = {start:position + 6,end:position + 10};
  const initializerRange = {start:position + 13,end:position + 14};
  const binding = {id:hash('tsfg.array-facts.binding.v1\0' + canonical({sourcePath:entry.sourcePath,nameRange})),
    name:'leaf',kind:'const',declaredType:'array.f64',writable:false,
    declarationRange:{start:nameRange.start,end:initializerRange.end},nameRange,
    annotationRange:null,elementAnnotationRange:null};
  const statement = {kind:'variable',binding:binding.id,range:{start:position,end:position + 15},
    initializer:{kind:'reference',binding:originalArray.id,flowType:'array.f64',range:initializerRange}};
  entry.bindings.push(binding); entry.body.splice(2,0,statement);
  file.content = file.content.slice(0,position) + inserted + file.content.slice(position);
  file.byteLength = Buffer.byteLength(file.content); file.utf16Length = file.content.length;
  file.sha256 = hash(file.content).slice(7); reframe(hostile);
  assert.deepEqual(entry.body.map(stmt => stmt.kind), ['variable','call','variable','return']);
  assert.deepEqual(entry.body[1], originalCall, 'old call symbol, zero arguments and all anchors stay unchanged');
  assert.equal(entry.body[1].value.callee, globalLeaf.id, 'forged original edge still names the global function');
  assert.notEqual(binding.id, globalLeaf.id);
  assert.ok(entry.body[1].value.calleeRange.end < binding.nameRange.start, 'call precedes its block-scoped shadow');
  assert.equal(file.content.slice(binding.nameRange.start,binding.nameRange.end), 'leaf');
  assert.equal(file.content.slice(initializerRange.start,initializerRange.end), 'a');
  assert.equal(file.content.slice(statement.range.start,statement.range.end), 'const leaf = a;');
  assert.equal(file.content.slice(entry.body[3].range.start,entry.body[3].range.end), 'return a[0];');
  assert.deepEqual(entry.bindings[0], originalArray);
  assert.deepEqual(globalLeaf, original.payload.functions.find(fn => fn.name === 'leaf'));
  assert.deepEqual(hostile.payload.files.filter(item => item.path !== hostile.payload.rootFile),
    original.payload.files.filter(item => item.path !== original.payload.rootFile));
  assert.equal(file.byteLength, original.payload.files.find(item => item.path === hostile.payload.rootFile).byteLength + delta);
  assert.notEqual(hostile.requestId, original.requestId); assert.notEqual(hostile.packageId, original.packageId);
  const before = fresh(hostile);
  factsError(caught(() => readArrayFactsCandidate(wire(hostile))), 'input');
  assert.deepEqual(hostile,before, 'cold rejection must leave the re-signed hostile packet intact');
});
