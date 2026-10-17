// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

// Independent finite JCS/domain oracle. The three complete Core files were fixed
// from Core8f9 preimages and hand-written SSA before observing the new emitter.
// Re-sealed variants are NEGATIVE fixtures only, never fresh official Source.
const schema = 'sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71';
const coreSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
const oldSchema = 'sha256:badc9425050a8f538fcb7b9397e5ef31fbde96391989dfeebb8cab6a122783bd';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? assert.fail('non-JSON fixture');
}
const wire = value => Buffer.from(jcs(value));
const candidate = (domain, value) => hash(domain + '\0' + coreSchema + '\0' + jcs(value));
const scalar = candidate('tsfg.core-nullable-candidate.type.v1', { kind: 'scalar', name: 'i32' });
const nullable = mask => candidate('tsfg.core-nullable-candidate.type.v1', { kind: 'nullable-i32', undefined: !!(mask & 1), null: !!(mask & 2) });
const flow = mask => ({ undefined: !!(mask & 1), null: !!(mask & 2) });
function setMask(shape, mask) { assert.ok(shape); Object.assign(shape, flow(mask)); }
function firstParameter(p, change) {
  const parameter = p.payload.facts.functions[0].parameters[0];
  for (const value of [parameter, p.payload.facts.symbols.find(s => s.id === parameter.id)]) change(value);
}
function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value); for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(item => walk(item, visit)); else walk(child, visit);
}
function inputIdentity(q, p) {
  const files = q.input.files.map(({ path, content }) => ({ path, content }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  p.payload.inputIdentity = hash(jcs({ ...q.input, files }));
  p.payload.files = files.map(f => ({ path: f.path, digest: hash(f.content), byteLength: Buffer.byteLength(f.content), length: f.content.length, positionUnit: 'utf16' }));
}
function seal(q, p, o) {
  inputIdentity(q, p);
  const request = wire(q);
  p.requestId = hash('tsfg.nullable-facts.request.v' + q.version + '\0' + request.toString());
  p.packageId = hash('tsfg.nullable-facts.package.v' + p.version + '\0' + p.schemaHash + '\0' + jcs(p.payload));
  const response = wire(p); o.requestSha256 = hash(request); o.responseSha256 = hash(response);
  return { request, response, origin: o };
}
function raise(result) {
  assert.equal(result.status, 'error'); assert.ok(result.diagnostics?.length);
  const d = result.diagnostics[0]; assert.match(d.code, /^r03-(?:nullable-|d-snapshot)/);
  throw Object.assign(new Error(d.message || d.code), { code: d.code });
}
async function complete(c) {
  const imported = await importCapturedFrontendResponse(c.request, c.response, c.origin);
  if (imported.status !== 'ok') raise(imported);
  const snapshot = imported.snapshot; validateFrontendSnapshot(copy(snapshot));
  const built = buildHir(copy(snapshot)); if (built.status !== 'ok') raise(built);
  const hir = verifyHir(built.hir), printed = printHir(hir), cold = readHir(Buffer.from(printed));
  assert.deepEqual(verifyHir(cold), hir); assert.equal(printHir(cold), printed);
  const core = lowerHir(cold); assert.equal(lowerHir(readHir(Buffer.from(printed))), core);
  return { snapshot, hir: cold, printed, core };
}
async function rejected(t, action, expected, detail = undefined) {
  let failure; try { await action(); } catch (error) { failure = error; }
  assert.ok(failure instanceof Error, 'counterfactual unexpectedly completed');
  const code = 'code' in failure ? String(failure.code) : failure.message.split(':')[0];
  assert.match(code, expected, 'an unrelated exception/earlier gate is not the claimed rejection');
  if (detail !== undefined) assert.match(failure.message, detail);
  t.diagnostic('actual rejection: ' + code + ' / ' + failure.message);
}
// Replace only explicitly selected annotation/token intervals. Every original
// range, including declaration-scoped call signatures and exports, shifts too.
function editSource(q, p, edits) {
  const file = q.input.files.find(f => f.path === q.input.rootFile), source = file.content;
  const sorted = edits.toSorted((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]; assert.ok(e.end >= e.start && (!i || e.start >= sorted[i - 1].end));
    assert.equal(source.slice(e.start, e.end), e.before); assert.notEqual(e.before, e.text);
  }
  const shift = position => {
    let delta = 0;
    for (const e of sorted) {
      if (position <= e.start) return position + delta;
      assert.ok(position >= e.end, 'no witness anchor may be guessed inside an edited annotation');
      delta += e.text.length - (e.end - e.start);
    }
    return position + delta;
  };
  walk(p.payload, value => {
    if (Object.keys(value).length === 2 && Number.isInteger(value.start) && Number.isInteger(value.end)) {
      value.start = shift(value.start); value.end = shift(value.end);
    }
  });
  file.content = sorted.toReversed().reduce((text, e) => text.slice(0, e.start) + e.text + text.slice(e.end), source);
  if (Object.hasOwn(file, 'sha256')) file.sha256 = hash(file.content);
}
function refreshCalls(p) {
  const facts = p.payload.facts, defs = new Map(facts.symbols.map(s => [s.id, s])), fns = new Map(facts.functions.map(f => [f.symbol, f]));
  walk(facts.functions, value => {
    if (value.kind === 'reference') {
      const shape = defs.get(value.symbol).presence;
      if (shape?.null || shape?.undefined) value.presenceFlow = { null: shape.null, undefined: shape.undefined };
      else delete value.presenceFlow;
    }
    if (value.kind === 'call') {
      const target = fns.get(value.target);
      value.signature = { parameters: target.parameters.map(p => p.type), returnType: target.returnType,
        ...(target.parameters.length ? { presence: target.parameters.map(p => copy(p.presence)) } : {}),
        ...(target.returnPresence ? { returnPresence: copy(target.returnPresence) } : {}) };
      if (target.returnPresence) value.presenceFlow = { null: target.returnPresence.null, undefined: target.returnPresence.undefined };
      else delete value.presenceFlow;
    }
  });
}
const annotation = mask => 'i32 | ' + (mask === 1 ? 'undefined' : mask === 2 ? 'null' : 'null | undefined');
function crossing(q, p, from, to, mode) {
  const f = p.payload.facts.functions, echo = f[0], fn = f[1];
  const selected = [];
  if (mode === 'call') selected.push([echo.parameters[0].presence.annotation, to]);
  if (mode !== 'init') selected.push([echo.returnPresence.annotation, to], [fn.body[1].symbol.presence.annotation, to]);
  if (mode === 'init') selected.push([fn.body[0].symbol.presence.annotation, to]);
  editSource(q, p, selected.map(([range, mask]) => ({ ...range, before: annotation(from), text: annotation(mask) })));
  const defs = new Map(p.payload.facts.symbols.map(s => [s.id, s]));
  if (mode === 'call') { setMask(echo.parameters[0].presence, to); setMask(defs.get(echo.parameters[0].id).presence, to); }
  if (mode !== 'init') {
    setMask(echo.returnPresence, to); defs.get(echo.symbol).returnPresence = copy(echo.returnPresence);
    setMask(fn.body[1].symbol.presence, to); setMask(defs.get(fn.body[1].symbol.id).presence, to);
  } else { setMask(fn.body[0].symbol.presence, to); setMask(defs.get(fn.body[0].symbol.id).presence, to); }
  refreshCalls(p);
}
function repairSnapshot(snapshot, q, p, c) {
  snapshot.capture = { request: c.request.toString(), response: c.response.toString() };
  snapshot.sourceOrigin = copy(c.origin); snapshot.inputIdentity = p.payload.inputIdentity;
  snapshot.snapshotId = hash('tsfg.frontend-nullable-candidate.snapshot.v3\0' + schema + '\0'
    + jcs({ inputIdentity: snapshot.inputIdentity, sourceOrigin: snapshot.sourceOrigin }));
  snapshot.identityInput = copy(q.input);
  snapshot.identityInput.files = q.input.files.map(({ path, content }) => ({ path, content })).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  snapshot.inputs = copy(p.payload.files); snapshot.functions = copy(p.payload.facts.functions);
  snapshot.symbols = copy(p.payload.facts.symbols); snapshot.exports = copy(p.payload.exports); snapshot.target = copy(q.input.target);
  const file = q.input.files.find(f => f.path === q.input.rootFile);
  snapshot.source = { path: file.path, content: file.content, hash: hash(file.content) };
}

const pins = {
  1: ['3389cb9aa9eff391a877bca43db75885df5e955f6e766e914f4d15043a1dde67', '2fab4c066729bddd94aaba03290a5e9cb26647d9592fe94a66f65b0a5f7468be'],
  2: ['3c262221549f956c044167b27999b786fd3be7fb7c83fed92b5249302397a99b', 'a3cb3ebb658313a22fe0a98936f8c1f08a56ee578d87b7f1b42c77fbc053857a'],
  3: ['762d8287cabbbbb459cbe406b641a8d427b01026a47ac4df7e7a94c4a528f24a', 'a6a6b024a665b7bd953e69423cc1a41c3b9b6b3d49df44ef6541292ae86f9704'],
};
test('actual v3 masks preserve complete nullable returns calls const bindings and Core bytes', { concurrency: true }, async t => {
  const records = new Map();
  await Promise.all([2, 1, 3].map(mask => t.test('actual mask' + mask + ' control', async sub => {
    const dir = new URL('./fixtures/nullable-owned-absence-masks/mask' + mask + '/return-call-const/v3/', import.meta.url);
    const bytes = await Promise.all(['request.json', 'response.json', 'origin.json', 'expected.core.mlir'].map(name => readFile(new URL(name, dir))));
    const before = bytes.map(hash), [request, response, origin, golden] = bytes;
    const q = JSON.parse(request.toString()), p = JSON.parse(response.toString()), o = JSON.parse(origin.toString());
    assert.equal(hash(response), 'sha256:' + pins[mask][0]); assert.equal(hash(golden), 'sha256:' + pins[mask][1]);
    assert.equal(q.version, 3); assert.equal(p.version, 3); assert.equal(q.schemaHash, schema); assert.equal(p.schemaHash, schema);
    assert.equal(q.family, 'tsfg.nullable-facts-request-candidate'); assert.equal(p.family, 'tsfg.nullable-facts-package-candidate');
    const sealed = seal(copy(q), copy(p), copy(o));
    assert.deepEqual(sealed.request, request); assert.deepEqual(sealed.response, response); assert.deepEqual(sealed.origin, o);
    assert.equal(o.kind, 'owned-go-nullable-response'); assert.equal(o.producerBaseOid, 'b6e156608803b08c4f62f258487484b1656e8213'); assert.equal(o.producerDirty, true);
    assert.equal(o.testedInputSetHash, 'sha256:6535cdfbee610b7e32fce13ef139b813fe45cec161b17ed7563386828b224b4d');
    const control = await complete({ request, response, origin: o });
    assert.deepEqual(Buffer.from(control.core), golden); assert.equal(golden.length, 4697);
    assert.equal(control.snapshot.format.version, 3); assert.equal(control.hir.format.version, 3);
    assert.equal(control.snapshot.format.schemaHash, schema); assert.equal(control.hir.format.schemaHash, schema);
    assert.deepEqual(control.snapshot.functions, p.payload.facts.functions); assert.deepEqual(control.snapshot.symbols, p.payload.facts.symbols);
    assert.deepEqual(control.snapshot.exports, p.payload.exports);
    const [echo, fn, entry] = control.hir.functions, nt = nullable(mask);
    assert.equal(echo.returnType.id, nt); assert.equal(echo.parameters[0].type, nt); assert.equal(echo.body[0].value.type, nt);
    assert.equal(fn.parameters[0].type, nt); assert.equal(fn.parameters[1].type, scalar); assert.equal(fn.returnType.id, scalar);
    assert.equal(fn.body.length, 3);
    for (const local of fn.body.slice(0, 2)) { assert.equal(local.kind, 'local'); assert.equal(local.binding.type, nt); assert.equal(local.binding.mutable, false); assert.equal(local.initializer.type, nt); }
    assert.equal(fn.body[0].initializer.kind, 'reference'); assert.equal(fn.body[0].initializer.binding, fn.parameters[0].id);
    assert.equal(fn.body[1].initializer.kind, 'call'); assert.equal(fn.body[1].initializer.target, echo.id);
    assert.equal(fn.body[1].initializer.arguments[0].binding, fn.body[0].binding.id);
    const root = fn.body[2].value;
    assert.equal(root.kind, 'nullableCoalesce'); assert.equal(root.type, scalar); assert.equal(root.left.type, nt);
    assert.equal(root.left.target, echo.id); assert.equal(root.left.arguments[0].binding, fn.body[1].binding.id);
    assert.equal(root.right.binding, fn.parameters[1].id); assert.equal(root.right.type, scalar);
    const wrapped = entry.body[0].value.arguments[0];
    assert.equal(wrapped.kind, 'nullableWrap'); assert.equal(wrapped.type, nt); assert.equal(wrapped.operand.type, scalar);
    assert.equal(entry.role, 'entry'); assert.equal(echo.role, 'internal'); assert.equal(fn.role, 'internal');
    assert.equal(entry.parameters[0].type, scalar); assert.equal(entry.returnType.id, scalar);
    assert.deepEqual(bytes.map(hash), before); records.set(mask, { q, p, o, control });
    sub.diagnostic('actual named-Go capture; independent full Core bytes, cold rebuild and exact selected mask passed');
  })));
  assert.equal(records.size, 3, 'all actual positives must pass before negative credit');
  const packetCodes = /^r03-nullable-(?:schema|capability|signature|flow|type)$/;
  for (const mask of [1, 2, 3]) {
    const record = records.get(mask);
    /** @type {[string, ((q:any,p:any,o:any)=>void)][]} */
    const mutations = [
      ['signature parameter mask (declaration consistency)', (q, p) => setMask(p.payload.facts.functions[1].body[1].initializer.signature.presence[0], mask === 3 ? 1 : 3)],
      ['signature return mask (declaration consistency)', (q, p) => setMask(p.payload.facts.functions[1].body[1].initializer.signature.returnPresence, mask === 3 ? 1 : 3)],
      ['flow mask (declared flow consistency)', (q, p) => setMask(p.payload.facts.functions[1].body[2].expression.left.presenceFlow, mask === 3 ? 1 : 3)],
      ['numeric mask zero (boolean/schema gate)', (q, p) => { firstParameter(p, value => { value.presence.undefined = 0; }); }],
      ['numeric mask four (boolean/schema gate)', (q, p) => { firstParameter(p, value => { value.presence.null = 4; }); }],
      ['mask0 booleans (annotation consistency)', (q, p) => firstParameter(p, value => setMask(value.presence, 0))],
      ['missing presence (required schema gate)', (q, p) => { firstParameter(p, value => { delete value.presence; }); }],
      ['nullable result flow (scalar result flow gate)', (q, p) => setMask(p.payload.facts.functions[1].body[2].expression.presenceFlow, mask)],
      ['v2 request mixed with v3 package', q => { q.version = 2; }],
      ['v2 package mixed with v3 request', (q, p) => { p.version = 2; }],
      ['old schema mixed into v3', (q, p) => { p.schemaHash = oldSchema; }],
    ];
    for (const [name, mutate] of mutations) await t.test('mask' + mask + ' ' + name, async sub => {
      const q = copy(record.q), p = copy(record.p), o = copy(record.o), before = jcs([q, p, o]); mutate(q, p, o);
      assert.notEqual(jcs([q, p, o]), before); await rejected(sub, () => complete(seal(q, p, o)), packetCodes);
    });
    for (const to of [1, 2, 3].filter(other => other !== mask)) for (const mode of ['call', 'return', 'init']) {
      await t.test('exact nonzero mask' + mask + ' to mask' + to + ' ' + mode + ' reaches typed fit', async sub => {
        const q = copy(record.q), p = copy(record.p), o = copy(record.o); crossing(q, p, mask, to, mode);
        assert.notEqual(q.input.files[0].content, record.q.input.files[0].content);
        const changed = seal(q, p, o); assert.notEqual(changed.origin.requestSha256, record.o.requestSha256);
        await rejected(sub, () => complete(changed), /^r03-nullable-signature$/);
      });
    }
    await t.test('mask' + mask + ' nullable RHS reaches scalar RHS type gate', async sub => {
      const q = copy(record.q), p = copy(record.p), o = copy(record.o), raw = p.payload.facts.functions[1].body[2].expression;
      editSource(q, p, [{ ...raw.right.range, before: 'replacement', text: 'original' }]);
      raw.right.symbol = p.payload.facts.functions[1].body[0].symbol.id; raw.right.presenceFlow = flow(mask);
      await rejected(sub, () => complete(seal(q, p, o)), /^r03-nullable-type$/);
    });
    /** @type {[string, ((h:any)=>void)][]} */
    const cold = [
      ['foreign wrap mask', h => { h.functions[2].body[0].value.arguments[0].type = nullable(mask === 3 ? 1 : 3); }],
      ['wrap removed', h => { const call = h.functions[2].body[0].value; call.arguments[0] = call.arguments[0].operand; }],
      ['nullable return narrowed to scalar', h => { h.functions[0].returnType = { kind: 'scalar', name: 'i32', id: scalar }; }],
      ['const type changed across masks', h => { h.functions[1].body[0].binding.type = nullable(mask === 3 ? 1 : 3); }],
      ['call result type changed across masks', h => { h.functions[1].body[1].initializer.type = nullable(mask === 3 ? 1 : 3); }],
      ['inputIdentity rehashed without source', h => { h.inputIdentity = hash('counterfactual'); }],
    ];
    for (const [name, mutate] of cold) await t.test('mask' + mask + ' cold ' + name, async sub => {
      const hir = copy(record.control.hir), before = jcs(hir); mutate(hir); assert.notEqual(jcs(hir), before);
      await rejected(sub, () => verifyHir(hir), /^r03-nullable-hir$/);
      await rejected(sub, () => readHir(Buffer.from(jcs(hir) + '\n')), /^r03-nullable-hir$/);
      await rejected(sub, () => lowerHir(hir), /^r03-nullable-hir$/);
    });
    await t.test('mask' + mask + ' cold v2 format cannot revive', async sub => {
      const hir = copy(record.control.hir); assert.equal(hir.format.version, 3); hir.format.version = 2;
      await rejected(sub, () => verifyHir(hir), /^r03-nullable-schema$/);
    });
    await t.test('mask' + mask + ' cold fully resealed capture cannot revive cross-mask return', async sub => {
      const q = copy(record.q), p = copy(record.p), o = copy(record.o); crossing(q, p, mask, mask === 3 ? 1 : 3, 'return');
      const c = seal(q, p, o), snapshot = copy(record.control.snapshot); repairSnapshot(snapshot, q, p, c);
      await rejected(sub, () => validateFrontendSnapshot(snapshot), /^r03-nullable-signature$/);
      const hir = copy(record.control.hir); hir.snapshot = snapshot; hir.inputIdentity = snapshot.inputIdentity; hir.source = copy(snapshot.source);
      await rejected(sub, () => verifyHir(hir), /^r03-nullable-signature$/);
    });
  }
  await t.test('undefined export reaches scalar ABI gate after complete source repair', async sub => {
    const record = records.get(1), q = copy(record.q), p = copy(record.p), o = copy(record.o);
    const source = q.input.files[0].content, exportStart = source.indexOf('export function entry'); assert.ok(exportStart > 0);
    editSource(q, p, [{ start: 0, end: 0, before: '', text: 'export ' }, { start: exportStart, end: exportStart + 7, before: 'export ', text: '' }]);
    const echo = p.payload.facts.functions[0], def = p.payload.facts.symbols.find(s => s.id === echo.symbol);
    assert.equal(echo.range.start, 0); assert.equal(echo.returnPresence.undefined, true);
    p.payload.exports = [{ name: 'echo', target: echo.symbol, sourcePath: q.input.rootFile, range: copy(echo.range), definition: copy(def.range) }];
    assert.ok(q.input.files[0].content.startsWith('export function echo'));
    refreshCalls(p); await rejected(sub, () => complete(seal(q, p, o)), /^r03-nullable-capability$/, /public entry must use required scalar i32 ABI/);
  });
});
