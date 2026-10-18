// SPDX-License-Identifier: MIT
// Public JSON limits below are separate from STRUCTURAL_ONLY facts/anchor checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { importNullableCapturedResponse, nullableSnapshotFacts, matchesNullableSnapshot } from '../../compiler/nullable-frontend.mjs';
import { verifyNullableFacts } from '../../compiler/nullable-facts.mjs';
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const fresh = value => JSON.parse(jcs(value));
const raw = readFileSync(new URL('./nullable-presence-capture-first.json', import.meta.url));
assert.equal(createHash('sha256').update(raw).digest('hex'), 'bd97533ad248e12d60595a61b43d02d9453fe23298835b61405caf64f1b10da3');
const { cases } = JSON.parse(raw.toString('utf8'));
const row = cases[2], MAX_BYTES = 8388608, MAX_STRING = 1048576;
const context = () => fresh(row.context), snapshot = () => fresh(row.expectedImportWrapper.snapshot);
const load = (request = Buffer.from(row.requestText), response = Buffer.from(row.responseText)) =>
  importNullableCapturedResponse(request, response, fresh(row.sourceOrigin), context());

/** @typedef {TypeError & {code:string, ruleId:string, phase:string,
 * primary?:{sourceId:string,start:number,end:number}, cause?:TypeError & {code:string}}} BoundaryError */
/** @param {unknown} error */
function typedError(error) {
  assert.ok(error instanceof TypeError);
  return /** @type {BoundaryError} */ (error);
}
function rejects(action, category, primary = undefined, genericCause = false) {
  assert.throws(action, caught => {
    const error = typedError(caught); assert.equal(error.code, 'r03-nullable-' + category);
    assert.equal(error.message, error.code + ': invalid private nullable presence capture');
    assert.equal(error.ruleId, 'r01-input-boundary'); assert.equal(error.phase, 'frontend');
    if (primary === undefined) assert.ok(!Object.hasOwn(error, 'primary'));
    else assert.deepStrictEqual(error.primary, primary);
    if (genericCause) {
      assert.ok(error.cause instanceof TypeError);
      assert.match(error.cause.code, /^generic-package(?:-io)?-/);
      assert.ok(error.cause.code.endsWith('-' + category));
    }
    return true;
  });
}

test('nullable presence capture public strict JSON and exact wire errors keep fixed error domain', () => {
  /** @type {[string, Buffer, string][]} */
  const vectors = [
    ['leading whitespace', Buffer.from(' ' + row.requestText), 'canonical'],
    ['trailing LF', Buffer.from(row.requestText + '\n'), 'canonical'],
    ['BOM', Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(row.requestText)]), 'canonical'],
    ['duplicate key', Buffer.from('{"a":0,"a":1}'), 'json'],
    ['malformed JSON', Buffer.from('{'), 'json'],
    ['invalid UTF8', Buffer.from([0xc0,0xaf]), 'json'],
    ['unpaired surrogate', Buffer.from('{"a":"\\ud800"}'), 'schema'],
    ['prototype key', Buffer.from('{"constructor":0}'), 'schema'],
    ['negative zero', Buffer.from('{"a":-0}'), 'schema'],
    ['unsafe number', Buffer.from('{"a":9007199254740992}'), 'schema'],
    ['fraction', Buffer.from('{"a":0.5}'), 'schema'],
  ];
  for (const [label, value, category] of vectors) {
    assert.ok(value.length < MAX_BYTES, label);
    rejects(() => load(value), category);
    rejects(() => load(undefined, value), category);
  }
  // Valid canonical shapes still cannot substitute for the selected request.
  for (const value of [null, [], {}, { family:'tsfg.nullable-facts-request-candidate', version:3 }])
    rejects(() => load(Buffer.from(jcs(value))), 'schema');
});

test('nullable presence capture public wire string depth and token limit boundaries precede shape', () => {

  const ctx = context(); ctx.sourceVersion = 3; ctx.extra = 'x'.repeat(MAX_STRING + 1);
  rejects(() => importNullableCapturedResponse(Buffer.from(row.requestText), Buffer.from(row.responseText),
    fresh(row.sourceOrigin), ctx), 'limit', undefined, true);
  const origin = fresh(row.sourceOrigin); origin.extra = 'x'.repeat(MAX_STRING + 1);
  rejects(() => importNullableCapturedResponse(Buffer.from(row.requestText), Buffer.from(row.responseText),
    origin, context()), 'limit', undefined, true);
  const exact = Buffer.from(row.requestText + ' '.repeat(MAX_BYTES - Buffer.byteLength(row.requestText)));
  assert.equal(exact.length, MAX_BYTES);
  rejects(() => load(exact), 'canonical');
  rejects(() => load(Buffer.alloc(MAX_BYTES + 1, 32)), 'limit', undefined, true);
  rejects(() => load(undefined, Buffer.alloc(MAX_BYTES + 1, 32)), 'limit', undefined, true);
  for (const extra of [0,1]) {
    const string = Buffer.from(jcs({ padding:'x'.repeat(MAX_STRING + extra) }));
    rejects(() => load(string), extra ? 'limit' : 'schema', undefined, extra === 1);
    const depth = 128 + extra, nested = Buffer.from('['.repeat(depth) + '0' + ']'.repeat(depth));
    rejects(() => load(nested), extra ? 'limit' : 'schema', undefined, extra === 1);
    // Scanner and graph walker both count opening+closing plus one/null item.
    const tokens = Buffer.from('[' + Array(199998 + extra).fill('null').join(',') + ']');
    rejects(() => load(tokens), extra ? 'limit' : 'schema', undefined, extra === 1);
  }
});

test('nullable presence capture public domain counts precede noncanonical bytes and selected identity', () => {
  /** @type {[string, number, (facts:any,n:number) => void][]} */
  const vectors = [
    ['functions', 512, (facts,n) => { facts.functions = Array.from({ length:n }, () => ({})); }],
    ['symbols', 4096, (facts,n) => { facts.symbols = Array.from({ length:n }, () => ({})); }],
    ['parameters', 64, (facts,n) => { facts.functions = [{ parameters:Array.from({ length:n }, () => ({})), body:[] }]; }],
    ['guards per function', 2, (facts,n) => { facts.functions = [{ parameters:[], body:Array.from({ length:n }, () => ({ kind:'if' })) }]; }],
    ['statements per function', 4096, (facts,n) => { facts.functions = [{ parameters:[], body:Array.from({ length:n }, () => ({ kind:'return' })) }]; }],
  ];
  for (const [label, maximum, fill] of vectors) for (const extra of [0,1]) {
    const packet = JSON.parse(row.responseText); fill(packet.payload.facts, maximum + extra);
    const wire = Buffer.from(' ' + jcs(packet));
    assert.ok(wire.length < MAX_BYTES, label);
    // At the count boundary canonical fails first; just beyond it the domain
    // limit must beat both whitespace and the intentionally unchanged raw SHA.
    rejects(() => load(undefined, wire), extra ? 'limit' : 'canonical');
  }
});

function snapshotWithBytes(size) {
  const value = snapshot(); value.extra = Array(7).fill('x'.repeat(MAX_STRING));
  const remaining = size - Buffer.byteLength(jcs(value)) - 3;
  assert.ok(remaining >= 0 && remaining <= MAX_STRING);
  value.extra.push('x'.repeat(remaining)); assert.equal(Buffer.byteLength(jcs(value)), size);
  return value;
}
test('nullable presence capture public whole snapshot byte and embedded capture string budgets', () => {
  // Extra keys intentionally fail schema at the exact byte cap. All component
  // strings/tokens/depth stay below their caps, so +1 isolates graph byte size.
  rejects(() => nullableSnapshotFacts(snapshotWithBytes(MAX_BYTES), context()), 'schema');
  const over = snapshotWithBytes(MAX_BYTES + 1);
  rejects(() => nullableSnapshotFacts(over, context()), 'limit', undefined, true);
  assert.equal(matchesNullableSnapshot(over, context()), false);
  for (const extra of [0,1]) {
    const value = snapshot(); value.capture.response = row.responseText
      + ' '.repeat(MAX_STRING + extra - Buffer.byteLength(row.responseText));
    assert.equal(Buffer.byteLength(value.capture.response), MAX_STRING + extra);
    rejects(() => nullableSnapshotFacts(value, context()), extra ? 'limit' : 'canonical', undefined, extra === 1);
  }
});

test('nullable presence capture STRUCTURAL_ONLY guard ranges use independent original owner anchors', () => {
  // This direct existing facts export has no actual-capture/origin authority.
  // None of these damaged packages is adopted as a selected successful capture.
  for (const selected of cases) {
    const expected = selected.expectedImportWrapper.snapshot;
    const source = { path:expected.source.path, content:expected.source.content };
    verifyNullableFacts(fresh(source), fresh(selected.expectedLegacy), fresh(expected.exports), 4);
    const guard = selected.expectedLegacy.functions[0].body[0];
    const tail = selected.expectedLegacy.functions[0].body.at(-1);
    const vectors = [
      ['if', guard.range, facts => facts.functions[0].body[0]],
      ['condition', guard.condition.range, facts => facts.functions[0].body[0].condition],
      ['left', guard.condition.left.range, facts => facts.functions[0].body[0].condition.left],
      ['right', guard.condition.right.range, facts => facts.functions[0].body[0].condition.right],
      ['then block', guard.thenBody[0].range, facts => facts.functions[0].body[0].thenBody[0]],
      ['then return', guard.thenBody[0].body[0].range, facts => facts.functions[0].body[0].thenBody[0].body[0]],
      ['then value', guard.thenBody[0].body[0].expression.range, facts => facts.functions[0].body[0].thenBody[0].body[0].expression],
      ['final return', tail.range, facts => facts.functions[0].body.at(-1)],
      ['final value', tail.expression.range, facts => facts.functions[0].body.at(-1).expression],
    ];
    for (const [label, original, locate] of vectors) {
      const facts = fresh(selected.expectedLegacy); locate(facts).range = { start:0, end:1 };
      assert.notDeepStrictEqual(original, { start:0, end:1 }, label);
      rejects(() => verifyNullableFacts(fresh(source), facts, fresh(expected.exports), 4), 'range',
        { sourceId:source.path, start:original.start, end:original.end });
    }
  }
});


// Exact semantic suffixes are preserved from the shared domain predicates;
// S5 specifies the finite suffix set, fixed wrapper, and precise stage anchor.
function rejectsDomain(action, primary) {
  assert.throws(action, caught => {
    const error = typedError(caught);
    assert.match(error.code, /^r03-nullable-(schema|source|capability|range|binding|type|signature|symbol|permission|scope|return|flow)$/);
    assert.equal(error.message, error.code + ': invalid private nullable presence capture');
    assert.equal(error.ruleId, 'r01-input-boundary'); assert.equal(error.phase, 'frontend');
    assert.deepStrictEqual(error.primary, primary); return true;
  });
}
test('nullable presence capture STRUCTURAL_ONLY finite guard semantics reject at the original stage', () => {
  const expected = row.expectedImportWrapper.snapshot, source = { path:expected.source.path, content:expected.source.content };
  const original = row.expectedLegacy.functions[0], guard = original.body[0], tail = original.body.at(-1);
  const vectors = [
    ['guard kind', guard.range, facts => { facts.functions[0].body[0].kind = 'return'; }],
    ['condition kind', guard.condition.range, facts => { facts.functions[0].body[0].condition.kind = 'reference'; }],
    ['condition operator', guard.condition.range, facts => { facts.functions[0].body[0].condition.operator = '!=='; }],
    ['left kind', guard.condition.left.range, facts => { facts.functions[0].body[0].condition.left.kind = 'absence'; }],
    ['left binding', guard.condition.left.range, facts => { facts.functions[0].body[0].condition.left.symbol = 's4'; }],
    ['left use flow', guard.condition.left.range, facts => { facts.functions[0].body[0].condition.left.presenceFlow.null = false; }],
    ['right absence', guard.condition.right.range, facts => { facts.functions[0].body[0].condition.right.absence = 'undefined'; }],
    ['then wrapper', guard.thenBody[0].range, facts => { facts.functions[0].body[0].thenBody[0].kind = 'return'; }],
    ['then return', guard.thenBody[0].body[0].range, facts => { facts.functions[0].body[0].thenBody[0].body[0].kind = 'variable'; }],
    ['then binding', guard.thenBody[0].body[0].expression.range, facts => { facts.functions[0].body[0].thenBody[0].body[0].expression.symbol = 's3'; }],
    ['final return', tail.range, facts => { facts.functions[0].body.at(-1).kind = 'variable'; }],
    ['final binding', tail.expression.range, facts => { facts.functions[0].body.at(-1).expression.symbol = 's4'; }],
    ['final flow', tail.expression.range, facts => { facts.functions[0].body.at(-1).expression.presenceFlow.undefined = true; }],
  ];
  for (const [label, anchor, change] of vectors) {
    const facts = fresh(row.expectedLegacy); change(facts);
    assert.notEqual(jcs(facts), jcs(row.expectedLegacy), label);
    rejectsDomain(() => verifyNullableFacts(fresh(source), facts, fresh(expected.exports), 4),
      { sourceId:source.path, start:anchor.start, end:anchor.end });
  }
  const facts = fresh(row.expectedLegacy); facts.functions[1].body[0].expression.target = 's2';
  rejectsDomain(() => verifyNullableFacts(fresh(source), facts, fresh(expected.exports), 4),
    { sourceId:source.path, start:facts.functions[1].range.start, end:facts.functions[1].range.end });
});



test('nullable presence capture STRUCTURAL_ONLY single guard DTO kind keeps the original if anchor', async t => {
  for (const selected of cases.slice(0,2)) await t.test(selected.name, () => {
    const expected = selected.expectedImportWrapper.snapshot;
    const source = { path:expected.source.path, content:expected.source.content };
    // Original complete mask1/mask2 graph must pass before the sole mutation.
    verifyNullableFacts(fresh(source), fresh(selected.expectedLegacy), fresh(expected.exports), 4);
    const original = selected.expectedLegacy.functions[0].body[0].range;
    const facts = fresh(selected.expectedLegacy); facts.functions[0].body[0].kind = 'return';
    rejectsDomain(() => verifyNullableFacts(fresh(source), facts, fresh(expected.exports), 4),
      { sourceId:source.path, start:original.start, end:original.end });
  });
});



test('nullable presence capture STRUCTURAL_ONLY invalid DTO function extent rejects before source owner', () => {
  const selected = cases[1], expected = selected.expectedImportWrapper.snapshot;
  assert.equal(selected.name, 'mask2-null');
  const source = { path:expected.source.path, content:expected.source.content };
  verifyNullableFacts(fresh(source), fresh(selected.expectedLegacy), fresh(expected.exports), 4);
  const original = selected.expectedLegacy.functions[0].range;
  assert.deepStrictEqual(original, { start:0,end:128 });
  assert.deepStrictEqual(selected.expectedLegacy.functions[1].range, { start:128,end:200 });
  assert.deepStrictEqual(selected.expectedLegacy.functions[0].body[0].range, { start:70,end:110 });
  assert.equal(source.content.length, 200);
  assert.equal(createHash('sha256').update(source.content).digest('hex'),
    'd8bc473ce83543357f4e70b17d0168e2e7f7bdeb7c975f3e20008d7f57cbd9d9');
  const facts = fresh(selected.expectedLegacy), fn = facts.functions[0]; facts.functions = [fn];
  const keep = new Set([fn.symbol, ...fn.parameters.map(parameter => parameter.id)]);
  facts.symbols = facts.symbols.filter(symbol => keep.has(symbol.id));
  const ids = new Map(facts.symbols.map((symbol,index) => [symbol.id, 's' + (index + 1)]));
  const renumber = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['id','symbol','target'].includes(key) && typeof child === 'string' && ids.has(child)) value[key] = ids.get(child);
      else renumber(child);
    }
  };
  renumber(facts);
  assert.deepStrictEqual(facts.symbols.map(symbol => symbol.id), ['s1','s2','s3']);
  assert.deepStrictEqual(fn.parameters.map(parameter => parameter.id), ['s2','s3']);
  assert.equal(fn.range.start, original.start); assert.ok(source.content.length > original.end);
  fn.range.end = source.content.length;
  // Negative STRUCTURAL-only frame, not an adopted capture. S5 header errors
  // precede verified ownership: the original span above is a witness, not primary.
  assert.throws(() => verifyNullableFacts(fresh(source), facts, [], 4), caught => {
    const error = typedError(caught);
    assert.ok(error.code === 'r03-nullable-source' || error.code === 'r03-nullable-range');
    assert.equal(error.message, error.code + ': invalid private nullable presence capture');
    assert.equal(error.ruleId, 'r01-input-boundary'); assert.equal(error.phase, 'frontend');
    assert.ok(!Object.hasOwn(error, 'primary')); return true;
  });
});

// Reachability limits: guards>1024 entails either >512 functions or >2 guards
// per function, and files>200000 already exceeds the generic token/array cap.
// Generic graph depth/tokens precede the larger expression-depth/step domains.
// This suite gives no independently isolated credit for those thresholds or
// for import-wrapper-only 8MiB (whole snapshot/string budgets may fail first).
// No direct canonical/budget helper is imported or claimed as a public result.
