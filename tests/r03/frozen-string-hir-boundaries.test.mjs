// SPDX-License-Identifier: MIT
// Public cold-HIR boundaries, relative to the separately frozen complete facts job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyHir, printHir, readHir } from '../../compiler/hir.mjs';
import { example, context, copy, wire, hash, functionId, rejectsCode } from './string-hir-independent-fixtures.mjs';

test('24d every selected owner value is compared, including empty and repeated values', async t => {
  const data = example(), ctx = context(data.factsBytes);
  assert.deepEqual(verifyHir(data.hir, ctx), data.hir);
  for (let i = 0; i < 14; i++) {
    await t.test('owner s' + String(i).padStart(2, '0'), () => {
      const bad = copy(data.hir), units = bad.functions[i].body[0].value.codeUnits;
      if (units.length) units[0] ^= 1; else units.push(1);
      rejectsCode(() => verifyHir(bad, ctx), 'r03-hir-invalid');
      rejectsCode(() => readHir(wire(bad), ctx), 'r03-hir-invalid');
    });
  }
});

test('24d complete projection rejects omissions, joins, false types and owner or range edits', async t => {
  const data = example(), ctx = context(data.factsBytes);
  assert.deepEqual(verifyHir(data.hir, ctx), data.hir);
  /** @type {Array<[string, (hir: any) => void]>} */
  const cases = [
    ['missing owner', h => { h.functions.splice(6, 1); }],
    ['extra owner', h => { h.functions.push(copy(h.functions[0])); }],
    ['declaration order', h => { h.functions.reverse(); }],
    ['renamed owner with recomputed FunctionId', h => {
      h.functions[5].name = 'other';
      h.functions[5].id = functionId(h.source.path, 'other');
    }],
    ['foreign source owner with recomputed FunctionIds', h => {
      h.source.path = '/src/other.ts';
      for (const fn of h.functions) fn.id = functionId(h.source.path, fn.name);
    }],
    ['changed physical Source with recomputed SHA', h => {
      h.source.content += '\n'; h.source.hash = hash(h.source.content);
    }],
    ['declaration range', h => { h.functions[5].range.start++; }],
    ['return range', h => { h.functions[5].body[0].range.end++; }],
    ['literal range', h => { h.functions[5].body[0].value.range.start++; }],
    ['function ID', h => { h.functions[5].id = 'sha256:' + '0'.repeat(64); }],
    ['signature ID', h => { h.functions[5].signatureHash = 'sha256:' + '0'.repeat(64); }],
    ['root extra field', h => { h.extra = true; }],
    ['function extra field', h => { h.functions[5].extra = true; }],
    ['value extra field', h => { h.functions[5].body[0].value.extra = true; }],
    ['old HIR version', h => { h.contractVersion = '0.9.0'; }],
    ['wrong HIR schema', h => { h.schemaHash = 'sha256:' + '0'.repeat(64); }],
    ['scalar return classification', h => { h.functions[5].returnType.kind = 'scalar'; }],
    ['nominal type name', h => { h.functions[5].returnType.name = 'object'; }],
    ['nominal type ID', h => { h.functions[5].returnType.id = 'sha256:' + '0'.repeat(64); }],
    ['value type ID', h => { h.functions[5].body[0].value.type = 'sha256:' + '0'.repeat(64); }],
    ['value kind', h => { h.functions[5].body[0].value.kind = 'literal'; }],
    ['return kind', h => { h.functions[5].body[0].kind = 'expression'; }],
    ['extra statement', h => { h.functions[5].body.push(copy(h.functions[5].body[0])); }],
    ['nonzero parameters', h => { h.functions[5].parameters.push({ name: 'x' }); }],
    ['missing codeUnits', h => { delete h.functions[5].body[0].value.codeUnits; }],
    ['null codeUnits', h => { h.functions[5].body[0].value.codeUnits = null; }],
    ['negative code unit', h => { h.functions[5].body[0].value.codeUnits = [-1]; }],
    ['fractional code unit', h => { h.functions[5].body[0].value.codeUnits = [0.5]; }],
    ['65536 code unit', h => { h.functions[5].body[0].value.codeUnits = [65536]; }],
    ['string code unit', h => { h.functions[5].body[0].value.codeUnits = ['55296']; }],
    ['null code unit', h => { h.functions[5].body[0].value.codeUnits = [null]; }],
    ['target edit', h => { h.target.target = 'other'; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const bad = copy(data.hir); mutate(bad);
    rejectsCode(() => verifyHir(bad, ctx), 'r03-hir-invalid');
    rejectsCode(() => printHir(bad, ctx), 'r03-hir-invalid');
    rejectsCode(() => readHir(wire(bad), ctx), 'r03-hir-invalid');
  });
});

test('24d unsafe object graphs reject before accessors or Proxy traps and are never serialized', () => {
  const data = example(), ctx = context(data.factsBytes);
  assert.deepEqual(verifyHir(data.hir, ctx), data.hir);
  let touched = 0;
  const getter = copy(data.hir);
  Object.defineProperty(getter.functions[5].body[0].value, 'codeUnits',
    { enumerable: true, get() { touched++; return [55296]; } });
  const cycle = copy(data.hir); cycle.extra = cycle;
  const arrayExtra = copy(data.hir); arrayExtra.functions[5].body[0].value.codeUnits.extra = true;
  const sparse = copy(data.hir); sparse.functions[5].body[0].value.codeUnits = new Array(1);
  const arrayGetter = copy(data.hir);
  Object.defineProperty(arrayGetter.functions[5].body[0].value.codeUnits, '0',
    { enumerable: true, get() { touched++; return 55296; } });
  const custom = copy(data.hir); Object.setPrototypeOf(custom.source, { inherited: true });
  const hidden = copy(data.hir); Object.defineProperty(hidden.source, 'hidden', { value: true });
  const symbol = copy(data.hir); symbol.source[Symbol('extra')] = true;
  const proxy = new Proxy(copy(data.hir), {
    get() { touched++; throw new Error('unexpected Proxy get'); },
    ownKeys() { touched++; throw new Error('unexpected Proxy enumeration'); },
    getPrototypeOf() { touched++; throw new Error('unexpected Proxy prototype'); },
  });
  for (const value of [getter, cycle, arrayExtra, sparse, arrayGetter, custom, hidden, symbol, proxy]) {
    rejectsCode(() => verifyHir(value, ctx), 'r03-hir-invalid');
    rejectsCode(() => printHir(value, ctx), 'r03-hir-invalid');
  }
  assert.equal(touched, 0);
});

test('24d cold HIR rejects malformed UTF8 JSON duplicates unknowns and trailing values', async t => {
  const data = example(), ctx = context(data.factsBytes), text = data.hirBytes.toString('utf8');
  assert.deepEqual(readHir(data.hirBytes, ctx), data.hir);
  const utf8 = Buffer.from(data.hirBytes), emoji = utf8.indexOf(Buffer.from('😀'));
  assert.ok(emoji >= 0); utf8[emoji] = 255;
  const sourceKey = '"source":{"content":';
  assert.ok(text.includes(sourceKey));
  const malformedSurrogate = text.replace(JSON.stringify(data.hir.source.content), '"\\ud800"');
  assert.notEqual(malformedSurrogate, text);
  const duplicateRoot = text.replace('"contractVersion":', '"contractVersion":"0.10.0","contractVersion":');
  const duplicateNested = text.replace('"path":"/src/main.ts"', '"path":"/src/main.ts","path":"/src/main.ts"');
  assert.notEqual(duplicateRoot, text); assert.notEqual(duplicateNested, text);
  /** @type {Array<[string, any]>} */
  const cases = [
    ['invalid UTF8', utf8], ['JSON syntax', Buffer.from('{"broken":\n')],
    ['null', Buffer.from('null\n')], ['duplicate root', Buffer.from(duplicateRoot)],
    ['duplicate nested', Buffer.from(duplicateNested)], ['trailing value', Buffer.from(text + '{}\n')],
    ['unpaired JSON surrogate', Buffer.from(malformedSurrogate)],
    ['unknown field', wire({ ...data.hir, unknown: true })],
    ['nonbytes', text],
  ];
  for (const [name, bytes] of cases) await t.test(name, () =>
    rejectsCode(() => readHir(bytes, ctx), 'r03-hir-invalid'));
});

test('24d strict canonical HIR wire requires JCS and exactly one LF', async t => {
  const data = example(), ctx = context(data.factsBytes), text = data.hirBytes.toString('utf8');
  assert.deepEqual(readHir(data.hirBytes, ctx), data.hir);
  /** @type {Record<string, any>} */ const reordered = {};
  for (const key of Object.keys(data.hir).reverse()) reordered[key] = data.hir[key];
  const variants = [text.slice(0, -1), text + '\n', text.slice(0, -1) + '\r\n',
    JSON.stringify(data.hir, null, 2) + '\n', JSON.stringify(reordered) + '\n', ' ' + text];
  for (let i = 0; i < variants.length; i++) await t.test('noncanonical wire ' + i, () =>
    rejectsCode(() => readHir(Buffer.from(variants[i]), ctx), 'r03-hir-canonical'));
});

test('24d String HIR object budgets precede projection and output allocation', async t => {
  const data = example(), ctx = context(data.factsBytes);
  assert.deepEqual(verifyHir(data.hir, ctx), data.hir);
  /** @type {Array<[string, (hir: any) => void]>} */
  const cases = [
    ['65 functions', h => { h.functions = Array.from({ length: 65 }, () => copy(h.functions[0])); }],
    ['16385 units in one value', h => { h.functions[0].body[0].value.codeUnits = Array(16385).fill(0); }],
    ['65537 aggregate units', h => {
      for (const fn of h.functions) fn.body[0].value.codeUnits = [];
      for (let i = 0; i < 4; i++) h.functions[i].body[0].value.codeUnits = Array(16384).fill(0);
      h.functions[4].body[0].value.codeUnits = [0];
    }],
    ['65537 Source bytes', h => {
      h.source.content += ' '.repeat(65537 - Buffer.byteLength(h.source.content));
      h.source.hash = hash(h.source.content);
    }],
    ['JSON string budget', h => { h.extra = 'x'.repeat(1048577); }],
    ['JSON token budget', h => { h.extra = Array(200001).fill(0); }],
    ['JSON depth budget', h => {
      /** @type {any} */ let nested = null;
      for (let i = 0; i < 65; i++) nested = [nested];
      h.extra = nested;
    }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const bad = copy(data.hir); mutate(bad);
    rejectsCode(() => verifyHir(bad, ctx), 'r03-hir-limit');
    rejectsCode(() => printHir(bad, ctx), 'r03-hir-limit');
  });
});

test('24d raw String HIR byte and structural budgets are bounded before parsing or hashing', async t => {
  const data = example(), ctx = context(data.factsBytes);
  assert.deepEqual(readHir(data.hirBytes, ctx), data.hir);
  /** @type {Array<[string, Uint8Array]>} */
  const cases = [
    ['input bytes', Buffer.concat([data.hirBytes, Buffer.alloc(2097153 - data.hirBytes.length, 32)])],
    ['depth', Buffer.from('['.repeat(65) + 'null' + ']'.repeat(65) + '\n')],
    ['tokens', Buffer.from('[' + Array(200001).fill('0').join(',') + ']\n')],
    ['string bytes', Buffer.from('"' + 'x'.repeat(1048577) + '"\n')],
  ];
  for (const [name, bytes] of cases) await t.test(name, () =>
    rejectsCode(() => readHir(bytes, ctx), 'r03-hir-limit'));
});
