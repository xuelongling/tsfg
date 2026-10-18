// SPDX-License-Identifier: MIT
// Cold structure/identity/ownership only; Source meaning and declaration completeness remain 24a duties.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readStringFactsCandidate, writeStringFactsCandidate } from '../../compiler/string-facts.mjs';
import {
  copy, frozen, manualLiterals, manualPackage, seal, setSource, sha256, wire,
} from './string-facts-cold-independent-oracles.mjs';

/** @param {() => unknown} action @param {string} code */
function rejects(action, code) {
  assert.throws(action, {code: 'r03-string-facts-' + code});
}
/** @param {any} value @param {string} code */
function rejectsBoth(value, code) {
  rejects(() => readStringFactsCandidate(wire(value)), code);
  rejects(() => writeStringFactsCandidate(value), code);
}
/** @param {any} value */
function roundtrip(value) {
  const bytes = wire(value);
  const owned = readStringFactsCandidate(bytes);
  assert.deepEqual(owned, value);
  assert.deepEqual(writeStringFactsCandidate(owned), bytes);
  return owned;
}

// Every logical mutation repairs both full-input and package identities independently.
// No case asks this cold reader to parse Source or recompute its literal meaning.
/** @type {Array<[string, string, (p: any) => void]>} */
const changes = [
  ['unknown envelope field', 'schema', p => { p.extra = true; }],
  ['unknown payload field', 'schema', p => { p.payload.extra = true; }],
  ['unknown file field', 'schema', p => { p.payload.files[0].extra = true; }],
  ['non-string file content', 'schema', p => { p.payload.files[0].content = 7; }],
  ['non-string sourceRoot', 'schema', p => { p.payload.sourceRoot = 7; }],
  ['unknown function field', 'schema', p => { p.payload.functions[0].extra = true; }],
  ['unknown return field', 'schema', p => { p.payload.functions[0].body[0].extra = true; }],
  ['unknown literal field', 'schema', p => { p.payload.functions[0].body[0].value.extra = true; }],
  ['unknown range field', 'schema', p => { p.payload.functions[0].declarationRange.extra = true; }],
  ['wrong family', 'schema', p => { p.family = 'tsfg.other-package'; }],
  ['wrong version', 'schema', p => { p.version = 2; }],
  ['null required functions', 'schema', p => { p.payload.functions = null; }],
  ['missing required functions', 'schema', p => { delete p.payload.functions; }],
  ['function name is not a string', 'schema', p => { p.payload.functions[0].name = 12; }],
  ['empty function name', 'schema', p => { p.payload.functions[0].name = ''; }],
  ['nonempty parameters', 'schema', p => { p.payload.functions[0].parameters = [{}]; }],
  ['null required parameters', 'schema', p => { p.payload.functions[0].parameters = null; }],
  ['wrong return type', 'schema', p => { p.payload.functions[0].returnType = 'i32'; }],
  ['empty body', 'schema', p => { p.payload.functions[0].body = []; }],
  ['two return statements', 'schema', p => { p.payload.functions[0].body.push(copy(p.payload.functions[0].body[0])); }],
  ['missing body', 'schema', p => { delete p.payload.functions[0].body; }],
  ['wrong statement kind', 'schema', p => { p.payload.functions[0].body[0].kind = 'throw'; }],
  ['missing literal value', 'schema', p => { delete p.payload.functions[0].body[0].value; }],
  ['wrong literal kind', 'schema', p => { p.payload.functions[0].body[0].value.kind = 'integer'; }],
  ['wrong literal type', 'schema', p => { p.payload.functions[0].body[0].value.type = 'i32'; }],
  ['null codeUnits', 'schema', p => { p.payload.functions[0].body[0].value.codeUnits = null; }],
  ['missing codeUnits', 'schema', p => { delete p.payload.functions[0].body[0].value.codeUnits; }],
  ['codeUnits is not an array', 'schema', p => { p.payload.functions[0].body[0].value.codeUnits = {}; }],
  ['negative code unit', 'schema', p => { p.payload.functions[1].body[0].value.codeUnits[0] = -1; }],
  ['fractional code unit', 'schema', p => { p.payload.functions[1].body[0].value.codeUnits[0] = 1.5; }],
  ['missing range end', 'schema', p => { delete p.payload.functions[0].declarationRange.end; }],
  ['negative range start', 'schema', p => { p.payload.functions[0].declarationRange.start = -1; }],
  ['empty declaration interval', 'range', p => { p.payload.functions[0].declarationRange.end = p.payload.functions[0].declarationRange.start; }],
  ['range beyond Source UTF16 length', 'range', p => { p.payload.functions[0].declarationRange.end = p.payload.files[0].utf16Length + 1; }],
  ['return outside declaration', 'range', p => { p.payload.functions[0].body[0].range.start = p.payload.functions[0].declarationRange.start - 1; }],
  ['literal outside return', 'range', p => { p.payload.functions[0].body[0].value.range.end = p.payload.functions[0].body[0].range.end + 1; }],
  ['split Source surrogate pair', 'range', p => { p.payload.functions[2].body[0].value.range.start += 2; }],
  ['overlapping declarations', 'range', p => { p.payload.functions[1].declarationRange.start = p.payload.functions[0].declarationRange.start; }],
  ['out of declaration order', 'range', p => { [p.payload.functions[0], p.payload.functions[1]] = [p.payload.functions[1], p.payload.functions[0]]; }],
  ['non-root function sourcePath', 'owner', p => { p.payload.functions[0].sourcePath = '/src/minimal-scalars-v2.d.ts'; }],
  ['duplicate function owner names', 'owner', p => { p.payload.functions[1].name = p.payload.functions[0].name; }],
  ['missing closed input member', 'input', p => { p.payload.files.pop(); }],
  ['duplicate file paths', 'input', p => { p.payload.files[1].path = p.payload.files[0].path; }],
  ['wrong UTF8 file order', 'input', p => { p.payload.files.reverse(); }],
  ['noncanonical sourceRoot', 'input', p => { p.payload.sourceRoot = '/src/'; }],
  ['missing root file linkage', 'input', p => { p.payload.rootFile = '/src/absent.ts'; }],
  ['traversal source path', 'input', p => {
    p.payload.rootFile = p.payload.files[0].path = '/src/../main.ts';
    for (const fn of p.payload.functions) fn.sourcePath = p.payload.rootFile;
  }],
  ['backslash source path', 'input', p => {
    p.payload.rootFile = p.payload.files[0].path = '/src' + String.fromCharCode(92) + 'main.ts';
    for (const fn of p.payload.functions) fn.sourcePath = p.payload.rootFile;
  }],
  ['non-ts module', 'input', p => {
    p.payload.rootFile = p.payload.files[0].path = '/src/main.js';
    for (const fn of p.payload.functions) fn.sourcePath = p.payload.rootFile;
  }],
  ['wrong DTS path/profile closure', 'input', p => {
    p.payload.files[1].path = '/src/other.d.ts'; p.payload.declarations.paths = ['/src/other.d.ts'];
  }],
  ['wrong DTS bytes after complete hash repair', 'input', p => {
    const d = p.payload.files[1]; d.content += '\n'; d.sha256 = sha256(d.content);
    d.byteLength = Buffer.byteLength(d.content); d.utf16Length = d.content.length;
  }],
  ['wrong declarations version', 'input', p => { p.payload.declarations.version = 'minimal-scalars-v3'; }],
  ['strict disabled', 'input', p => { p.payload.config.strict = false; }],
  ['noEmit disabled', 'input', p => { p.payload.config.noEmit = false; }],
  ['allowJs enabled', 'input', p => { p.payload.config.allowJs = true; }],
  ['wrong file SHA with repaired request and package', 'identity', p => { p.payload.files[0].sha256 = '0'.repeat(64); }],
  ['wrong byteLength', 'source', p => { p.payload.files[0].byteLength++; }],
  ['wrong UTF16 length', 'source', p => { p.payload.files[0].utf16Length++; }],
  ['wrong known schema with consistent new packageId', 'identity', p => { p.schemaHash = 'sha256:' + '0'.repeat(64); }],
];
for (const [name, code, change] of changes) {
  test('string facts cold boundaries: ' + name, async () => {
    const {value} = await frozen(), altered = copy(value);
    change(altered);
    seal(altered);
    rejectsBoth(altered, code);
  });
}

for (const field of ['requestId', 'packageId']) {
  test('string facts cold boundaries: wrong ' + field, async () => {
    const {value} = await frozen(); value[field] = 'sha256:' + '0'.repeat(64);
    rejectsBoth(value, 'identity');
  });
}

/** @type {Array<[string, string, (bytes: Buffer) => Uint8Array]>} */
const rawCases = [
  ['invalid UTF8', 'utf8', () => Buffer.from([0xff])],
  ['raw surrogate UTF8', 'utf8', () => Buffer.from([0xed, 0xa0, 0x80])],
  ['BOM', 'canonical', b => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b])],
  ['missing LF', 'canonical', b => b.subarray(0, -1)],
  ['second LF', 'canonical', b => Buffer.concat([b, Buffer.from('\n')])],
  ['CRLF framing', 'canonical', b => Buffer.concat([b.subarray(0, -1), Buffer.from('\r\n')])],
  ['leading JSON whitespace', 'canonical', b => Buffer.concat([Buffer.from(' '), b])],
  ['unsorted JSON keys', 'canonical', b => {
    const p = JSON.parse(b.toString());
    return Buffer.from(JSON.stringify({version: p.version, family: p.family, payload: p.payload, schemaHash: p.schemaHash, requestId: p.requestId, packageId: p.packageId}) + '\n');
  }],
  ['duplicate JSON key', 'json', b => Buffer.from(b.toString().replace('"version":1', '"version":1,"version":1'))],
  ['escape-equivalent duplicate key', 'json', b => Buffer.from(b.toString().replace('"version":1', '"version":1,"vers' + String.fromCharCode(92) + 'u0069on":1'))],
  ['trailing JSON value', 'json', b => Buffer.concat([b, Buffer.from('{}\n')])],
  ['null root', 'schema', () => Buffer.from('null\n')],
  ['unpaired JSON surrogate', 'schema', b => Buffer.from(b.toString().replace('"name":"s00"', '"name":"' + String.fromCharCode(92) + 'ud800"'))],
];
for (const [name, code, change] of rawCases) {
  test('string facts cold bytes: ' + name, async () => {
    const {bytes} = await frozen(), altered = change(bytes);
    assert.notDeepEqual(altered, bytes, 'raw mutation must actually change the frame');
    rejects(() => readStringFactsCandidate(altered), code);
  });
}

test('string facts cold bytes require Uint8Array inputs and honor subarray offsets', async () => {
  const {bytes, value} = await frozen();
  for (const invalid of [null, 'bytes', [], new ArrayBuffer(8), new DataView(new ArrayBuffer(8))]) {
    rejects(() => readStringFactsCandidate(/** @type {any} */ (invalid)), 'input');
  }
  const storage = new Uint8Array(bytes.length + 4); storage.set(bytes, 2);
  const view = storage.subarray(2, 2 + bytes.length), owned = readStringFactsCandidate(view);
  view.fill(0);
  assert.deepEqual(owned, value);
  assert.deepEqual(writeStringFactsCandidate(owned), bytes);
});

test('string facts cold manual oracle accepts 64 complete empty-string owners', async () => {
  const {value} = await frozen();
  const manual = manualPackage(value, Array(64).fill(0));
  assert.equal(manual.payload.functions.length, 64);
  roundtrip(manual);
});

test('string facts cold manual oracle preserves surrogate endpoints and maximum code unit', async () => {
  const {value} = await frozen(), slash = String.fromCharCode(92);
  const entries = [
    {literal: '"' + slash + 'uDBFF"', codeUnits: [56319]},
    {literal: '"' + slash + 'uDFFF"', codeUnits: [57343]},
    {literal: '"' + slash + 'uFFFD"', codeUnits: [65533]},
    {literal: '"' + slash + 'uFFFF"', codeUnits: [65535]},
    {literal: '"' + slash + 'uDFFF' + slash + 'uDBFF"', codeUnits: [57343, 56319]},
  ];
  const manual = manualLiterals(value, entries);
  const owned = /** @type {any} */ (roundtrip(manual));
  assert.deepEqual(owned.payload.functions.map((/** @type {any} */ f) => f.body[0].value.codeUnits),
    [[56319], [57343], [65533], [65535], [57343, 56319]]);
});

test('string facts cold manual oracle accepts exactly 16384 code units', async () => {
  const {value} = await frozen(); roundtrip(manualPackage(value, [16384]));
});

test('string facts cold limit rejects 16385 code units with self-consistent manual Source', async () => {
  const {value} = await frozen(); rejectsBoth(manualPackage(value, [16385]), 'limit');
});

test('string facts cold limit rejects 65 complete function owners', async () => {
  const {value} = await frozen(); rejectsBoth(manualPackage(value, Array(65).fill(0)), 'limit');
});

test('string facts cold metadata aggregate limit rejects 65537 units independently of Source meaning', async () => {
  const {value} = await frozen(), altered = copy(value);
  for (const [index, fn] of altered.payload.functions.entries()) {
    fn.body[0].value.codeUnits = index < 4 ? Array(16384).fill(0) : index === 4 ? [0] : [];
  }
  assert.deepEqual(altered.payload.files, value.payload.files);
  assert.equal(altered.payload.functions.reduce((/** @type {number} */ n, /** @type {any} */ f) => n + f.body[0].value.codeUnits.length, 0), 65537);
  rejectsBoth(seal(altered), 'limit');
});

test('string facts cold manual oracle accepts Source padded to exactly 65536 UTF8 bytes', async () => {
  const {value} = await frozen(), source = value.payload.files[0].content;
  setSource(value, source + ' '.repeat(65536 - Buffer.byteLength(source)));
  roundtrip(seal(value));
});

test('string facts cold limit rejects Source at 65537 UTF8 bytes after all identity repairs', async () => {
  const {value} = await frozen(), source = value.payload.files[0].content;
  setSource(value, source + ' '.repeat(65537 - Buffer.byteLength(source)));
  rejectsBoth(seal(value), 'limit');
});

test('string facts cold limit rejects input over 2 MiB before JSON/canonical checks', async () => {
  const {bytes} = await frozen(), large = Buffer.alloc(2097153, 32); bytes.copy(large);
  rejects(() => readStringFactsCandidate(large), 'limit');
});

for (const budget of ['depth', 'tokens', 'stringBytes']) {
  test('string facts cold JSON preflight limit: ' + budget, async () => {
    const {value} = await frozen();
    if (budget === 'depth') {
      let nested = {}; for (let i = 0; i < 70; i++) nested = {next: nested}; value.payload.extra = nested;
    } else if (budget === 'tokens') value.payload.extra = Array(200001).fill(0);
    else value.payload.extra = 'A'.repeat(1048577);
    seal(value);
    assert.ok(wire(value).length < 2097152, 'isolate JSON policy from wire byte cap');
    rejectsBoth(value, 'limit');
  });
}

test('string facts cold writer applies the output byte budget before producing bytes', async () => {
  const {value} = await frozen(); value.payload.extra = Array(100000).fill('A'.repeat(24)); seal(value);
  assert.ok(wire(value).length > 2097152);
  rejects(() => writeStringFactsCandidate(value), 'limit');
});

test('string facts cold writer owns bytes without freezing or mutating caller data', async () => {
  const {bytes, value} = await frozen(), caller = copy(value);
  const first = writeStringFactsCandidate(caller), second = writeStringFactsCandidate(caller);
  assert.deepEqual(caller, value);
  assert.equal(Object.isFrozen(caller), false);
  assert.equal(Object.isFrozen(caller.payload.functions[0].body), false);
  caller.payload.functions[1].body[0].value.codeUnits[0] = 65;
  assert.deepEqual(first, bytes);
  first.fill(0);
  assert.deepEqual(second, bytes, 'each result Buffer is independently owned');
});

test('string facts cold writer refuses accessors without evaluating them', async () => {
  const {value} = await frozen(); let called = false;
  Object.defineProperty(value.payload.functions[0], 'name', {
    enumerable: true, get() { called = true; throw Error('getter must never run'); },
  });
  rejects(() => writeStringFactsCandidate(value), 'schema');
  assert.equal(called, false);
});

/** @type {Array<[string, (p: any) => any]>} */
const unsafe = [
  ['cycle', p => { p.payload.extra = p; return p; }],
  ['custom prototype', p => Object.assign(Object.create({inherited: true}), p)],
  ['Date object', () => new Date(0)],
  ['symbol object key', p => { p[Symbol('hidden')] = true; return p; }],
  ['non-index array property', p => { p.payload.functions[0].body.note = true; return p; }],
  ['symbol array property', p => { p.payload.functions[0].body[Symbol('hidden')] = true; return p; }],
  ['sparse codeUnits', p => { p.payload.functions[0].body[0].value.codeUnits = Array(1); return p; }],
];
for (const [name, change] of unsafe) {
  test('string facts cold writer refuses unsafe ' + name, async () => {
    const {value} = await frozen(); rejects(() => writeStringFactsCandidate(change(value)), 'schema');
  });
}


test('string facts cold writer refuses array accessors without evaluating them', async () => {
  const {value} = await frozen(); let called = false;
  Object.defineProperty(value.payload.functions[1].body[0].value.codeUnits, '0', {
    enumerable: true, get() { called = true; throw Error('array getter must never run'); },
  });
  rejects(() => writeStringFactsCandidate(value), 'schema');
  assert.equal(called, false);
});

test('string facts cold reader and writer reject a null payload before identity work', async () => {
  const {value} = await frozen(); value.payload = null; rejectsBoth(value, 'schema');
});
