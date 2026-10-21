// SPDX-License-Identifier: MIT
// Independent public lowering boundaries. Whole expected Core stays the pre-product oracle.
// No Source compiler, CLI launcher, execution, emitter-generated golden or injected error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { lowerHir, verifyHir, readHir, printHir } from '../../compiler/hir.mjs';
import registry from '../../contracts/registry.json' with { type: 'json' };

/** @param {string | Uint8Array} value */
const sha = value => createHash('sha256').update(value).digest('hex');
/** Trusted immutable JSON data only. @param {any} value @returns {any} */
const clone = value => JSON.parse(JSON.stringify(value));
/** @param {string} file @param {number} length @param {string} digest */
async function pinned(file, length, digest) {
  const bytes = await readFile(new URL(file, import.meta.url));
  assert.equal(bytes.length, length); assert.equal(sha(bytes), digest); return bytes;
}
/** @returns {Promise<any[]>} */
async function cases() {
  const bytes = await pinned('./string-core-oracle.json', 43500,
    '30ba4f71ac0118d27aa00630c90c39b2b6954afa432fd7be981fc0b99677b4e0');
  const oracle = JSON.parse(bytes.toString('utf8'));
  const out = [];
  for (const c of oracle.cases) {
    const factsBytes = await pinned('./' + c.factsFile, c.factsBytes, c.factsSHA256);
    const hirBytes = await pinned('./' + c.hirFile, c.hirBytes, c.hirSHA256);
    assert.equal(Buffer.byteLength(c.core), c.coreBytes); assert.equal(sha(c.core), c.coreSHA256);
    out.push({ ...c, factsBytes, hirBytes, hir: JSON.parse(hirBytes.toString('utf8')) });
  }
  return out;
}
/** @param {any} c @param {Uint8Array} [factsBytes] @returns {any} */
const context = (c, factsBytes = Buffer.from(c.factsBytes)) => ({
  factsBytes, expectedPackageId: c.expectedPackageId, ...(c.factsVersion === 2 ? {factsVersion: 2} : {}),
});
/** @param {any} value @returns {any} */
function nullRecords(value) {
  if (Array.isArray(value)) return value.map(nullRecords);
  if (!value || typeof value !== 'object') return value;
  return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([k, v]) => [k, nullRecords(v)])));
}
/** Exact public own error DTO; nested cause/stack is not an alternate admission channel.
 * @param {() => unknown} action @returns {any} */
function failure(action) {
  /** @type {any} */ let result;
  try { action(); } catch (error) { result = error; }
  assert.ok(result instanceof TypeError);
  return {name: result.name, message: result.message,
    ...Object.fromEntries(Object.keys(result).map(key => [key, result[key]]))};
}
/** @param {string} category @param {any} [primary] */
const expectedError = (category, primary = undefined) => ({
  name: 'TypeError', message: 'r03-hir-' + category + ': invalid selected string HIR',
  code: 'r03-hir-' + category, ruleId: 'r01-input-boundary', phase: 'hir', ...(primary ? {primary} : {}),
});
/** @param {any} c @param {any} range */
const primary = (c, range) => ({sourceId: c.hir.source.path, ...range});

test('24g repeated cold object and offset byte views retain every whole Core byte without mutating callers', async t => {
  for (const c of await cases()) await t.test(c.name, () => {
    const backing = Buffer.concat([Buffer.from('prefix!'), c.factsBytes, Buffer.from('suffix!')]);
    const bytes = backing.subarray(7, 7 + c.factsBytes.length);
    const storage = new Uint8Array(c.factsBytes.length + 11); storage.set(c.factsBytes, 4);
    const variants = [Buffer.from(c.factsBytes), Uint8Array.from(c.factsBytes), bytes,
      storage.subarray(4, 4 + c.factsBytes.length)];
    for (const factBytes of variants) {
      const ctx = context(c, factBytes), h = clone(c.hir), before = clone(h);
      assert.equal(Object.isFrozen(h), false);
      const first = lowerHir(h, ctx), second = lowerHir(clone(h), Object.assign(Object.create(null), ctx));
      assert.equal(first, c.core); assert.equal(second, c.core);
      assert.equal(lowerHir(nullRecords(h), context(c)), c.core);
      assert.deepEqual(h, before); assert.deepEqual(Buffer.from(factBytes), c.factsBytes);
      assert.equal(printHir(h, ctx), c.hirBytes.toString('utf8'));
      assert.equal(lowerHir(readHir(c.hirBytes, ctx), ctx), c.core);
      factBytes.fill(0);
      assert.equal(first, c.core, 'returned primitive owns its complete value');
      assert.deepEqual(failure(() => lowerHir(h, ctx)), expectedError('context'));
      assert.equal(lowerHir(clone(c.hir), context(c)), c.core, 'a prior job cannot cache trust');
    }
    assert.equal(sha(c.hirBytes), c.hirSHA256); assert.equal(sha(c.factsBytes), c.factsSHA256);
  });
});

test('24g context validation precedes hostile HIR traversal and never invokes context behavior', async t => {
  for (const c of await cases()) await t.test(c.name, () => {
    let traps = 0;
    const h = new Proxy(clone(c.hir), {
      get() { traps++; throw Error('HIR get sentinel'); },
      ownKeys() { traps++; throw Error('HIR keys sentinel'); },
      getPrototypeOf() { traps++; throw Error('HIR prototype sentinel'); },
    });
    const bad = context(c); bad.expectedPackageId = 'sha256:' + '0'.repeat(64);
    assert.deepEqual(failure(() => lowerHir(h, bad)), expectedError('context'));
    assert.equal(traps, 0);
    const variants = [null, {}, {...context(c), extra: true}, {...context(c), factsVersion: 1},
      {...context(c), factsBytes: Buffer.from('null\n')}, {...context(c), expectedPackageId: c.hir.source.hash}];
    for (const key of ['factsBytes', 'expectedPackageId', ...(c.factsVersion === 2 ? ['factsVersion'] : [])]) {
      const accessor = context(c);
      Object.defineProperty(accessor, key, {enumerable: true, get() {traps++; throw Error('context sentinel');}});
      variants.push(accessor);
      const hidden = context(c); Object.defineProperty(hidden, key, {enumerable: false}); variants.push(hidden);
    }
    variants.push(new Proxy(context(c), {
      ownKeys() {traps++; throw Error('context keys sentinel');},
      getPrototypeOf() {traps++; throw Error('context prototype sentinel');},
    }));
    for (const ctx of variants) assert.deepEqual(failure(() => lowerHir(h, ctx)), expectedError('context'));
    assert.equal(traps, 0);
  });
});

test('24g valid context rejects unsafe HIR graphs before reading getters or proxy traps', async t => {
  for (const c of await cases()) await t.test(c.name, () => {
    let traps = 0;
    const getter = clone(c.hir);
    Object.defineProperty(getter, 'source', {enumerable: true, get() {traps++; throw Error('source sentinel');}});
    const nested = clone(c.hir); nested.functions[0] = new Proxy(nested.functions[0], {
      get() {traps++; throw Error('function sentinel');},
      ownKeys() {traps++; throw Error('function keys sentinel');},
    });
    for (const h of [getter, nested]) {
      assert.deepEqual(failure(() => lowerHir(h, context(c))), expectedError('invalid')); assert.equal(traps, 0);
    }
  });
});

test('24g complete old HIR errors pass through lowering with the original trusted owner', async t => {
  for (const c of await cases()) {
    const at = c.hir.functions.length - 1, s = c.semantic[at];
    /** @type {Array<[string, (h:any) => void, string, any?]>} */
    const changes = [
      ['unknown module field', h => {h.extra = 1;}, 'invalid'],
      ['selected identity', h => {h.inputIdentity = 'sha256:' + '0'.repeat(64);}, 'context'],
      ['source content', h => {h.source.content += ' ';}, 'invalid'],
      ['function identity', h => {h.functions[at].id = 'sha256:' + '0'.repeat(64);}, 'invalid', primary(c, s.functionRange)],
      ['function type', h => {h.functions[at].returnType.name = 'i32';}, 'invalid', primary(c, s.functionRange)],
      ['return range', h => {h.functions[at].body[0].range.start++;}, 'invalid', primary(c, s.returnRange)],
      ['expression type', h => {h.functions[at].body[0].value.type = 'sha256:' + '0'.repeat(64);}, 'invalid', primary(c, s.expressionRange)],
    ];
    if (c.factsVersion === 2) {
      changes.push(['left units', h => {h.functions[at].body[0].value.left.codeUnits.push(65);}, 'invalid', primary(c, s.leaves[0].range)]);
      changes.push(['right units', h => {h.functions[at].body[0].value.right.codeUnits.push(66);}, 'invalid', primary(c, s.leaves[1].range)]);
      changes.push(['operator range', h => {h.functions[at].body[0].value.operatorRange.start--;}, 'invalid', primary(c, s.operatorRange)]);
      changes.push(['ordered leaves', h => {const v = h.functions[at].body[0].value; [v.left,v.right] = [v.right,v.left];},
        'invalid', primary(c, s.leaves[0].range)]);
    } else changes.push(['units', h => {h.functions[at].body[0].value.codeUnits.push(65);}, 'invalid', primary(c, s.expressionRange)]);
    for (const [name, mutate, category, anchor] of changes) await t.test(c.name + '/' + name, () => {
      const h = clone(c.hir); mutate(h);
      const expected = expectedError(category, anchor), before = clone(h);
      assert.deepEqual(failure(() => verifyHir(h, context(c))), expected);
      assert.deepEqual(failure(() => lowerHir(h, context(c))), expected);
      assert.deepEqual(h, before);
    });
  }
});

test('24g upstream input budgets preserve the old exact limit DTO before Core emission', async t => {
  for (const c of await cases()) {
    /** @type {Array<[string, (h:any) => void]>} */
    const changes = [
      ['functions65', h => {h.functions = Array.from({length: 65}, () => clone(h.functions[0]));}],
      ['source65537', h => {h.source.content += ' '.repeat(65537 - Buffer.byteLength(h.source.content));}],
      ['leaf16385', h => {
        const v = h.functions[0].body[0].value;
        (c.factsVersion === 2 ? v.left : v).codeUnits = Array(16385).fill(65);
      }],
    ];
    if (c.name !== 'asi') changes.push(['aggregate65537', h => {
      const leaves = h.functions.flatMap(fn => c.factsVersion === 2
        ? [fn.body[0].value.left, fn.body[0].value.right] : [fn.body[0].value]);
      leaves.forEach((leaf, i) => {leaf.codeUnits = Array(i < 4 ? 16384 : i === 4 ? 1 : 0).fill(65);});
    }]);
    for (const [name, mutate] of changes) await t.test(c.name + '/' + name, () => {
      const h = clone(c.hir); mutate(h);
      assert.deepEqual(failure(() => lowerHir(h, context(c))), expectedError('limit'));
    });
    await t.test(c.name + '/context2097153', () => {
      const bytes = Buffer.alloc(2097153, 32); c.factsBytes.copy(bytes);
      assert.deepEqual(failure(() => lowerHir(clone(c.hir), context(c, bytes))), expectedError('limit'));
    });
  }
});

// Output8MiB is static-only here: the selected package/source/unit/function caps
// bound every reachable output below it. Do not weaken upstream limits or stub
// verifyHir to manufacture a public overflow. C++ input8MiB is tested separately.

test('24g absent context keeps the complete scalar Core path across formal identity migration', async () => {
  const bytes = await pinned('./string-core-default-scalar.json', 2809, '548008d67c97cffcf7b870ce69d8d43d1e609de8c641550480e6e00044d76eb2');
  const f = JSON.parse(bytes.toString('utf8'));
  assert.equal(f.provenance.sourceCompilerRun, false); assert.equal(f.provenance.emitterCalled, false);
  assert.deepEqual(verifyHir(clone(f.hir)), f.hir);
  // Preserve the frozen original. Only the current formal version/schema change;
  // every identity, function, SSA body and anchor stays byte-for-byte identical.
  const current = f.core.replace('tsfg_core.version = "0.9.0"', `tsfg_core.version = "${registry['tsfg.bytecode'].semver}"`)
    .replace('sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6', registry['tsfg.bytecode'].schemaHash);
  assert.equal(lowerHir(clone(f.hir)), current);
  assert.equal(lowerHir(clone(f.hir), undefined), current);
  assert.deepEqual(failure(() => lowerHir(clone(f.hir), {})), expectedError('context'));
});
