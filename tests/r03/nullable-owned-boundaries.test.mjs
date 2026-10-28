// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

// Actual named-Go records only. A missing private API fails the positive control
// before any negative case runs. This suite grants no SourceEXE/native credit.
const fixture = new URL('./fixtures/nullable-owned/v3/', import.meta.url);
const schema = 'sha256:24a04b0b595cae59ccf52a939f4671cea0369c46bd705f56726d028ab1df5a71';
const coreSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? assert.fail('non-JSON mutation');
}
const wire = value => Buffer.from(jcs(value));
const order = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
// Independent descriptor preimages, never imported private producer helpers.
function refreshInput(q, p) {
  const files = q.input.files.map(f => ({ path: f.path, content: f.content })).sort(order);
  p.payload.inputIdentity = hash(jcs({ ...q.input, files }));
  p.payload.files = files.map(f => ({ path: f.path, digest: hash(f.content),
    byteLength: Buffer.byteLength(f.content), length: f.content.length, positionUnit: 'utf16' }));
}
function seal(q, p, o) {
  const request = wire(q);
  p.requestId = hash('tsfg.nullable-facts.request.v3\0' + request.toString('utf8'));
  p.packageId = hash('tsfg.nullable-facts.package.v3\0' + p.schemaHash + '\0' + jcs(p.payload));
  const response = wire(p);
  o.requestSha256 = hash(request); o.responseSha256 = hash(response);
  return { request, response, origin: o };
}
function view(p) {
  const facts = p.payload.facts, [echo, entry] = facts.functions;
  return { facts, echo, entry, local: entry.body[0], call: entry.body[0].initializer,
    exported: p.payload.exports[0] };
}
function note(t, error) {
  assert.ok(error instanceof Error, 'rejection must provide an Error');
  assert.ok(error.message.length > 0, 'rejection must explain the boundary');
  t.diagnostic(('code' in error ? String(error.code) + ': ' : '') + error.message.slice(0, 220));
}
async function imported(c) {
  const result = await importCapturedFrontendResponse(c.request, c.response, c.origin);
  if (result.status !== 'ok') {
    assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0);
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.snapshot;
}
async function complete(c) {
  const snapshot = await imported(c); validateFrontendSnapshot(snapshot);
  const built = buildHir(snapshot);
  if (built.status !== 'ok') throw new Error(JSON.stringify(built.diagnostics));
  const hir = verifyHir(built.hir), printed = printHir(hir), cold = readHir(Buffer.from(printed));
  assert.deepEqual(verifyHir(cold), hir);
  return { snapshot, hir, core: lowerHir(cold) };
}
async function rejects(t, action) {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  assert.ok(failure, 'mutated boundary unexpectedly completed successfully');
  note(t, failure);
}
// Locate captured bytes through public JSON values, without fixing a private
// capture field layout. Strings, byte arrays and parsed JSON all preserve them.
function replaceCaptured(value, before, after) {
  let count = 0;
  const original = JSON.parse(before.toString('utf8')), changed = JSON.parse(after.toString('utf8'));
  function visit(node) {
    if (typeof node === 'string') {
      /** @type {BufferEncoding[]} */
      const encodings = ['utf8', 'base64', 'hex'];
      for (const encoding of encodings) {
        if (node === before.toString(encoding)) { count++; return after.toString(encoding); }
      }
      return node;
    }
    if (!node || typeof node !== 'object') return node;
    if (jcs(node) === jcs(original)) { count++; return clone(changed); }
    if (Array.isArray(node) && node.length === before.length
        && node.every((byte, index) => byte === before[index])) { count++; return [...after]; }
    for (const key of Object.keys(node)) node[key] = visit(node[key]);
    return node;
  }
  const result = visit(value);
  assert.ok(count > 0, 'self-contained public copy must preserve captured request/response');
  return result;
}
function updateOrigin(value, key, digest) {
  let found = 0;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'owned-go-nullable-response') { node[key] = digest; found++; }
    for (const child of Object.values(node)) visit(child);
  }
  visit(value); assert.ok(found > 0, 'cold capture retains origin');
}

test('actual owned nullable strict packet and cold boundaries', { concurrency: true }, async t => {
  const bytes = await Promise.all(['request.json', 'response.json', 'origin.json', 'expected.core.mlir']
    .map(name => readFile(new URL(name, fixture))));
  const [request, response, originBytes, expectedCore] = bytes, pins = bytes.map(hash);
  const q0 = JSON.parse(request.toString('utf8')), p0 = JSON.parse(response.toString('utf8'));
  const o0 = JSON.parse(originBytes.toString('utf8'));
  assert.equal(q0.schemaHash, schema); assert.equal(p0.schemaHash, schema);
  assert.deepEqual(wire(q0), request); assert.deepEqual(wire(p0), response);
  const recomputed = seal(clone(q0), clone(p0), clone(o0));
  assert.deepEqual(recomputed.request, request); assert.deepEqual(recomputed.response, response);
  assert.deepEqual(recomputed.origin, o0);
  const control = await complete({ request, response, origin: clone(o0) });
  assert.deepEqual(Buffer.from(control.core), expectedCore, 'positive control uses independent full Core oracle');
  assert.equal(control.snapshot.format.family, 'tsfg.frontend-nullable-candidate');
  assert.equal(control.hir.format.family, 'tsfg.nullable-hir-candidate');
  t.diagnostic('positive import/build/verify/print/read/lower and full Core bytes passed');

  /** @type {[string, ((q:any,p:any,o:any)=>void)][]} */
  const protocol = [
    ['request family', q => { q.family = 'tsfg.frontend-package'; }],
    ['request version', q => { q.version = 2; }],
    ['request schema', q => { q.schemaHash = coreSchema; }],
    ['package family', (q, p) => { p.family = 'tsfg.generic-package'; }],
    ['package version', (q, p) => { p.version = 2; }],
    ['package schema', (q, p) => { p.schemaHash = coreSchema; }],
    ['origin family', (q, p, o) => { o.kind = 'owned-go-closure-response'; }],
    ['origin producer mode', (q, p, o) => { o.producerDirty = false; }],
    ['origin malformed base', (q, p, o) => { o.producerBaseOid = 'not-an-oid'; }],
    ['origin malformed test set', (q, p, o) => { o.testedInputSetHash = 'sha256:bad'; }],
    ['origin unknown version', (q, p, o) => { o.version = 1; }],
    ['unknown request field', q => { q.extra = true; }],
    ['unknown input field', q => { q.input.hostImports = []; }],
    ['unknown package field', (q, p) => { p.extra = true; }],
    ['unknown payload field', (q, p) => { p.payload.core = { schemaHash: coreSchema }; }],
    ['unknown origin field', (q, p, o) => { o.extra = true; }],
  ];
  /** @type {[string, ((q:any,p:any,o:any)=>void)][]} */
  const custody = [
    ['input identity', (q, p) => { p.payload.inputIdentity = hash('forged'); }],
    ['source with coherent hashes', (q, p) => {
      q.input.files[0].content = q.input.files[0].content.replace('export function entry', 'export function other'); refreshInput(q, p);
    }],
    ['DTS with coherent hashes', (q, p) => {
      q.input.files[1].content = q.input.files[1].content.replace('type i32 = number', 'type i32 = string'); refreshInput(q, p);
    }],
    ['target with coherent identity', (q, p) => { q.input.target.pointerBits = '32'; refreshInput(q, p); }],
    ['wrong DTS profile', (q, p) => { q.input.declarations.version = 'minimal-integers-v2'; refreshInput(q, p); }],
    ['missing declared file', (q, p) => { q.input.files.pop(); refreshInput(q, p); }],
    ['extra unconsumed file', (q, p) => { q.input.files.push({ path: '/src/extra.d.ts', content: '' }); refreshInput(q, p); }],
    ['incomplete consumed facts', (q, p) => { p.payload.facts.inputs.pop(); }],
    ['foreign consumed facts', (q, p) => { p.payload.facts.inputs.push('/src/foreign.d.ts'); }],
    ['missing file row', (q, p) => { p.payload.files.pop(); }],
    ['duplicate file row', (q, p) => { p.payload.files.push(clone(p.payload.files[0])); }],
    ['unsorted file rows', (q, p) => { p.payload.files.reverse(); }],
    ['file digest', (q, p) => { p.payload.files[0].digest = hash('forged'); }],
    ['UTF8 byte length', (q, p) => { p.payload.files[0].byteLength--; }],
    ['UTF16 length', (q, p) => { p.payload.files[0].length += 2; }],
    ['position unit', (q, p) => { p.payload.files[0].positionUnit = 'utf8'; }],
    ['unknown file field', (q, p) => { p.payload.files[0].extra = true; }],
  ];
  /** @type {[string, ((q:any,p:any,o:any)=>void)][]} */
  const exports = [
    ['extra export', (q, p) => { p.payload.exports.push(clone(view(p).exported)); }],
    ['missing export', (q, p) => { p.payload.exports = []; }],
    ['foreign target', (q, p) => { view(p).exported.target = 's999'; }],
    ['local as entry', (q, p) => { view(p).exported.target = view(p).local.symbol.id; }],
    ['foreign source', (q, p) => { view(p).exported.sourcePath = '/src/foreign.ts'; }],
    ['wrong export range', (q, p) => { view(p).exported.range.start++; }],
    ['wrong definition', (q, p) => { view(p).exported.definition.end--; }],
    ['internal echo as entry', (q, p) => {
      const v = view(p), symbol = v.facts.symbols.find(s => s.id === v.echo.symbol);
      p.payload.exports = [{ name: 'echo', target: v.echo.symbol, sourcePath: '/src/main.ts',
        range: clone(v.echo.range), definition: clone(symbol.range) }];
    }],
    ['nullable public parameter', (q, p) => { view(p).entry.parameters[0].presence.null = true; }],
    ['nullable public result', (q, p) => { view(p).entry.returnPresence = clone(view(p).echo.returnPresence); }],
    ['unknown export field', (q, p) => { view(p).exported.role = 'entry'; }],
  ];
  /** @type {[string, ((q:any,p:any,o:any)=>void)][]} */
  const facts = [
    ['false nullable presence', (q, p) => { view(p).echo.parameters[0].presence.null = false; }],
    ['false return presence', (q, p) => { view(p).echo.returnPresence.null = false; }],
    ['undefined parameter', (q, p) => { view(p).echo.parameters[0].presence.undefined = true; }],
    ['optional parameter', (q, p) => { view(p).echo.parameters[0].presence.optional = true; }],
    ['default parameter', (q, p) => { view(p).echo.parameters[0].presence.default = true; }],
    ['wrong call target', (q, p) => { view(p).call.target = view(p).entry.symbol; }],
    ['unknown call target', (q, p) => { view(p).call.target = 's999'; }],
    ['wrong signature type', (q, p) => { view(p).call.signature.parameters[0] = 'f64'; }],
    ['wrong signature presence', (q, p) => { view(p).call.signature.presence[0].null = false; }],
    ['wrong call flow', (q, p) => { view(p).call.presenceFlow.null = false; }],
    ['undefined call flow', (q, p) => { view(p).call.presenceFlow.undefined = true; }],
    ['cross-function argument', (q, p) => { view(p).call.arguments[0].symbol = view(p).echo.parameters[0].id; }],
    ['cross-function return', (q, p) => { view(p).entry.body[1].expression.symbol = view(p).echo.parameters[0].id; }],
    ['missing initializer', (q, p) => { delete view(p).local.initializer; }],
    ['null initializer', (q, p) => { view(p).local.initializer = null; }],
    ['writable const', (q, p) => {
      const v = view(p); v.local.symbol.writable = true;
      v.facts.symbols.find(s => s.id === v.local.symbol.id).writable = true;
    }],
    ['self read before declaration', (q, p) => { view(p).call.arguments[0].symbol = view(p).local.symbol.id; }],
    ['statements before declaration', (q, p) => { view(p).entry.body.reverse(); }],
    ['duplicate owned symbol', (q, p) => { view(p).facts.symbols.push(clone(view(p).facts.symbols[0])); }],
    ['UTF16 out of bounds', (q, p) => { view(p).call.range.end = 166; }],
    ['UTF16 surrogate split', (q, p) => { view(p).echo.range.start = 4; }],
    ['unknown facts field', (q, p) => { view(p).facts.extra = true; }],
    ['unknown expression field', (q, p) => { view(p).call.extra = true; }],
    ['unknown signature field', (q, p) => { view(p).call.signature.extra = true; }],
    ['unsupported statement', (q, p) => { view(p).local.kind = 'if'; }],
  ];
  /** @type {[string, [string, ((q:any,p:any,o:any)=>void)][]][]} */
  const groups = [['protocol', protocol], ['custody', custody], ['exports', exports], ['facts', facts]];
  await Promise.all(groups.map(([name, cases]) => t.test(String(name), { concurrency: true }, async domain => {
      assert.ok(Array.isArray(cases));
      await Promise.all(cases.map(([label, mutate]) => domain.test(String(label), async sub => {
        const q = clone(q0), p = clone(p0), o = clone(o0), before = jcs([q, p, o]);
        mutate(q, p, o); assert.notEqual(jcs([q, p, o]), before, 'mutation must change an input');
        const changed = seal(q, p, o), saved = jcs(changed.origin);
        await rejects(sub, () => complete(changed));
        assert.equal(jcs(changed.origin), saved, 'public boundary must not rewrite origin');
      })));
    })));

  await t.test('raw bytes and stale capture digests', { concurrency: true }, async raw => {
    const qtext = request.toString('utf8'), ptext = response.toString('utf8');
    const badRequest = Buffer.from(qtext.replace('"version":3', '"version":2'));
    const badResponse = Buffer.from(ptext.replace('"status":"ok"', '"status":"error"'));
    const duplicateQ = Buffer.from(qtext.replace('{', '{"family":"' + q0.family + '",'));
    const duplicateP = Buffer.from(ptext.replace('{', '{"family":"' + p0.family + '",'));
    const invalidQ = Buffer.concat([Buffer.from([0xff]), request]);
    const invalidP = Buffer.concat([Buffer.from([0xff]), response]);
    /** @type {[string, Buffer, Buffer, boolean][]} */
    const cases = [
      ['stale request digest', badRequest, response, false], ['stale response digest', request, badResponse, false],
      ['duplicate request key', duplicateQ, response, true], ['duplicate response key', request, duplicateP, true],
      ['invalid request UTF8', invalidQ, response, true], ['invalid response UTF8', request, invalidP, true],
    ];
    await Promise.all(cases.map(([name, qb, pb, reseal]) => raw.test(String(name), async sub => {
      assert.ok(Buffer.isBuffer(qb) && Buffer.isBuffer(pb));
      assert.ok(!qb.equals(request) || !pb.equals(response), 'raw mutation must not be a no-op');
      const o = clone(o0); let packetBytes = pb;
      if (reseal) {
        if (!qb.equals(request)) {
          const packet = clone(p0);
          packet.requestId = hash(Buffer.concat([Buffer.from('tsfg.nullable-facts.request.v3\0'), qb]));
          packetBytes = wire(packet);
        }
        o.requestSha256 = hash(qb); o.responseSha256 = hash(packetBytes);
      }
      await rejects(sub, () => imported({ request: qb, response: packetBytes, origin: o }));
    })));
  });

  await t.test('cold copies rebuild every field', { concurrency: true }, async cold => {
    /** @type {[string, ((value:any)=>void)][]} */
    const changes = [
      ['unknown field', value => { value.extra = true; }],
      ['mixed family', value => { value.format.family = 'tsfg.frontend-closure-candidate'; }],
      ['mixed version', value => { value.format.version = 2; }],
      ['mixed schema', value => { assert.equal(value.format.schemaHash, schema); value.format.schemaHash = coreSchema; }],
      ['input identity', value => { value.inputIdentity = hash('forged cold identity'); }],
      ['rehashed captured facts', value => {
        const packet = clone(p0); packet.payload.facts.extra = true;
        const changed = seal(clone(q0), packet, clone(o0));
        replaceCaptured(value, response, changed.response);
        updateOrigin(value, 'responseSha256', hash(changed.response));
      }],
      ['captured request bytes', value => {
        const q = clone(q0); q.input.files[0].content = q.input.files[0].content.replace('entry', 'other');
        const after = wire(q); replaceCaptured(value, request, after);
        updateOrigin(value, 'requestSha256', hash(after));
      }],
    ];
    await Promise.all(changes.flatMap(([name, mutate]) => ['snapshot', 'hir'].map(kind =>
      cold.test(kind + ' ' + name, async sub => {
        const value = clone(control[kind]), before = jcs(value); mutate(value);
        assert.notEqual(jcs(value), before, 'cold mutation must not be a no-op');
        if (kind === 'snapshot') {
          await rejects(sub, () => validateFrontendSnapshot(value));
          assert.notEqual(buildHir(value).status, 'ok', 'build must also reject a corrupt cold snapshot');
        } else {
          await rejects(sub, () => verifyHir(value));
          await rejects(sub, () => readHir(Buffer.from(jcs(value) + '\n')));
          await rejects(sub, () => lowerHir(value));
        }
      }))));
  });

  await t.test('fixed Core UTF8 name and path limits', { concurrency: true }, async limits => {
    // Counterfactual static reconstruction of the actual capture, never fresh
    // Source output. Only rename/relocate text; preserve the same typed program.
    // Rebuild all spans and identity preimages so rejection cannot be credited
    // to stale custody or a source/facts mismatch. Public cold APIs rebuild IDs.
    function capture(kind, spelling) {
      const q = clone(q0), p = clone(p0), o = clone(o0), oldPath = q.input.rootFile;
      const file = q.input.files.find(f => f.path === oldPath);
      if (kind === 'name') {
        const v = view(p), end = v.exported.definition.end, start = end - v.entry.name.length;
        assert.equal(file.content.slice(start, end), v.entry.name);
        assert.equal(file.content.slice(v.exported.definition.start, start).trim(), '', 'preserve official leading trivia');
        const delta = spelling.length - (end - start);
        function shift(value) {
          if (!value || typeof value !== 'object') return;
          if (Number.isInteger(value.start) && Number.isInteger(value.end)) {
            if (value.start >= end) value.start += delta;
            if (value.end >= end) value.end += delta;
          }
          for (const child of Object.values(value)) shift(child);
        }
        file.content = file.content.slice(0, start) + spelling + file.content.slice(end);
        shift(p.payload);
        const definition = v.facts.symbols.find(s => s.id === v.entry.symbol);
        v.entry.name = spelling; definition.name = spelling; v.exported.name = spelling;
      } else {
        assert.equal(kind, 'path'); q.input.rootFile = spelling; file.path = spelling;
        p.payload.exports.forEach(entry => { entry.sourcePath = spelling; });
      }
      refreshInput(q, p); p.payload.facts.inputs = p.payload.files.map(f => f.path);
      assert.notEqual(jcs([q, p]), jcs([q0, p0]), 'limit witness must change capture');
      const sealed = seal(q, p, o);
      assert.equal(o.requestSha256, hash(sealed.request)); assert.equal(o.responseSha256, hash(sealed.response));
      return { sealed, name: view(p).entry.name, path: q.input.rootFile, source: file.content };
    }
    /** @type {[string, string, string, number, boolean][]} */
    const cases = [
      ['ASCII name exact', 'name', 'a'.repeat(256), 256, true],
      ['ASCII name plus one', 'name', 'a'.repeat(257), 257, false],
      ['multibyte name exact', 'name', 'é'.repeat(128), 256, true],
      ['multibyte name plus one', 'name', 'é'.repeat(128) + 'a', 257, false],
      ['ASCII path exact', 'path', '/src/' + 'a'.repeat(4088) + '.ts', 4096, true],
      ['ASCII path plus one', 'path', '/src/' + 'a'.repeat(4089) + '.ts', 4097, false],
      ['multibyte path exact', 'path', '/src/' + 'é'.repeat(2044) + '.ts', 4096, true],
      ['multibyte path plus one', 'path', '/src/' + 'é'.repeat(2044) + 'a.ts', 4097, false],
    ];
    await Promise.all(cases.map(([label, kind, spelling, size, accepted]) => limits.test(label, async sub => {
      assert.equal(Buffer.byteLength(spelling), size);
      if (label.startsWith('multibyte')) assert.ok(spelling.length < size, 'measure UTF8 bytes, not UTF16 units');
      const witness = capture(kind, spelling);
      if (!accepted) {
        let failure;
        try { await complete(witness.sealed); } catch (error) { failure = error; }
        assert.ok(failure instanceof Error, 'over-limit static capture unexpectedly published Core');
        let code = 'code' in failure ? failure.code : undefined;
        if (!code) {
          // Public import/build may return diagnostics instead of throwing.
          try { code = JSON.parse(failure.message)[0]?.code; } catch { /* not a diagnostic */ }
        }
        assert.equal(code, 'r03-nullable-limit',
          'only a limit rejection earns credit; stale hash, grammar and range errors fail this case');
        note(sub, failure); return;
      }
      const result = await complete(witness.sealed);
      assert.equal(result.snapshot.source.path, witness.path);
      assert.equal(result.snapshot.source.content, witness.source);
      assert.equal(result.snapshot.source.hash, hash(witness.source));
      assert.equal(result.hir.functions.find(fn => fn.role === 'entry').name, witness.name);
      assert.ok(result.core.includes('func.func @' + JSON.stringify(witness.name) + '('));
      assert.ok(result.core.includes('tsfg_core.source_path = ' + JSON.stringify(witness.path)));
      assert.ok(result.core.includes('schema = "' + coreSchema + '"'));
      assert.ok(result.core.includes('tsfg_core.version = "0.9.0"'));
      sub.diagnostic('transformed-capture static cold reconstruction accepted ' + kind + ' UTF8 bytes=' + size);
    })));
  });

  assert.deepEqual(bytes.map(hash), pins, 'capture and oracle bytes stay unchanged');
});
