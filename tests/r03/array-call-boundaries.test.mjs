// SPDX-License-Identifier: MIT
import {migrateArrayCore10} from './array-test-fixtures.mjs';
// Re-signed hostile packets exercise cold custody, not an alternate Source implementation.
import assert from 'node:assert/strict';
import test from 'node:test';
import coreCallOracle from './array-core-call-oracle.json' with {type:'json'};
import { readArrayFactsCandidate, writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir, verifyHir, readHir, lowerHir, analyzeArrayCalls, verifyArrayCalls, readArrayCalls } from '../../compiler/hir.mjs';
import { fixture, packet, fresh, wire, factsContext, named, sourceCall, directCall, caught,
  factsError, hirError, analysisError, trustedPrimary, reframe, replaceSource, bogusHash } from './array-call-test-helpers.mjs';

test('23e cold call facts reject repaired provenance, signature-order and omitted-code attacks', async t => {
  const first = await fixture('first-touch-alias'), two = await fixture('two-slots-alias-and-independent-fresh');
  const local = await fixture('two-level-private-local-and-stable-publication');
  /** @type {Array<[string,any,(p:any)=>void,string]>} */
  const changes = [
    ['Array element annotation anchor', first, p => { named(p.payload, 'touch').parameters[0].elementAnnotationRange.start++; }, 'input'],
    ['callee raw UTF16 range', first, p => { sourceCall(named(p.payload, 'entry')).calleeRange.start++; }, 'input'],
    ['unknown callee source binding', first, p => { sourceCall(named(p.payload, 'entry')).callee = bogusHash; }, 'input'],
    ['callee FunctionId substituted as source BindingId', first, p => { sourceCall(named(p.payload, 'entry')).callee = named(first.hir, 'touch').id; }, 'input'],
    ['Array actual loses exact flow type', first, p => { sourceCall(named(p.payload, 'entry')).arguments[0].flowType = 'f64'; }, 'input'],
    ['missing actual argument', first, p => { sourceCall(named(p.payload, 'entry')).arguments.pop(); }, 'input'],
    ['same-owner aliases do not license raw argument substitution', two, p => {
      const args = sourceCall(named(p.payload, 'entry')).arguments;
      [args[0].binding, args[2].binding] = [args[2].binding, args[0].binding];
    }, 'input'],
    ['full parameter slot order remains original', two, p => {
      const params = named(p.payload, 'copy').parameters; [params[0], params[2]] = [params[2], params[0]];
    }, 'input'],
    ['represented call omitted', two, p => {
      const fn = named(p.payload, 'entry'); fn.body.splice(fn.body.findIndex(s => s.kind === 'call'), 1);
    }, 'input'],
    ['unused private allocation omitted', local, p => {
      const fn = named(p.payload, 'leaf'), binding = fn.bindings.find(b => b.name === 'unused');
      assert.ok(binding); fn.bindings = fn.bindings.filter(b => b.id !== binding.id);
      fn.body = fn.body.filter(s => s.binding !== binding.id);
    }, 'input'],
    ['hidden nonexport helper omitted', local, p => {
      p.payload.functions = p.payload.functions.filter(fn => fn.name !== 'leaf');
    }, 'input'],
    ['same-spelled fake length origin', local, p => { p.payload.arrayLength.id = bogusHash; }, 'input'],
    ['actual export subset forged', local, p => {
      const leaf = named(p.payload, 'leaf'); p.payload.exports.push({ name: 'leaf', functionId: leaf.id });
      p.payload.exports.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
    }, 'identity'],
  ];
  for (const [name, row, mutate, kind] of changes) await t.test(name, () => {
    assert.deepEqual(readArrayFactsCandidate(Buffer.from(row.packageText)), packet(row));
    const hostile = packet(row); mutate(hostile); reframe(hostile); const before = fresh(hostile);
    for (const action of [() => readArrayFactsCandidate(wire(hostile)), () => writeArrayFactsCandidate(hostile)])
      factsError(caught(action), kind);
    assert.deepEqual(hostile, before, 'cold rejection does not mutate supplied data');
  });
});

test('23f complete cyclic facts retain exact header and source reconstruction before owner-domain checks', async () => {
  const row = await fixture('two-level-private-local-and-stable-publication'), hostile = packet(row);
  const bridge = named(hostile.payload, 'bridge'), call = sourceCall(bridge);
  call.callee = bridge.id;
  replaceSource(hostile, call.calleeRange.start, call.calleeRange.end, bridge.name);
  assert.equal(named(hostile.payload, 'bridge').body.at(-1).value.callee, named(hostile.payload, 'bridge').id);
  assert.equal(hostile.payload.files.find(f => f.path === hostile.payload.rootFile).content
    .slice(call.calleeRange.start, call.calleeRange.end), 'bridge');
  const before = fresh(hostile), bytes = wire(hostile);
  const actual = readArrayFactsCandidate(bytes);assert.deepEqual(actual, before);
  assert.deepEqual(writeArrayFactsCandidate(actual), bytes);assert.deepEqual(hostile, before);
});

test('23e cold HIR checks every call edge, alias use and checked node before analysis or Core publication', async t => {
  const row = await fixture('two-slots-alias-and-independent-fresh');
  /** @type {Array<[string,(h:any)=>void]>} */
  const changes = [
    ['Array parameter nominal type', h => { named(h, 'copy').parameters[0].type = h.types[0].id; }],
    ['Array element annotation range', h => { named(h, 'copy').parameters[0].elementAnnotationRange.end--; }],
    ['stable call target', h => { directCall(named(h, 'entry')).target = bogusHash; }],
    ['original source callee binding', h => { directCall(named(h, 'entry')).sourceCallee = bogusHash; }],
    ['call signature', h => { directCall(named(h, 'entry')).signatureHash = bogusHash; }],
    ['same-owner raw argument binding', h => {
      const args = directCall(named(h, 'entry')).arguments;
      [args[0].binding, args[2].binding] = [args[2].binding, args[0].binding];
    }],
    ['argument slot order', h => { directCall(named(h, 'entry')).arguments.reverse(); }],
    ['call range cannot inject diagnostic primary', h => { directCall(named(h, 'entry')).range = { start: 60000, end: 60001 }; }],
    ['call omitted from complete body', h => {
      const fn = named(h, 'entry'); fn.body.splice(fn.body.findIndex(s => s.kind === 'expression'), 1);
    }],
    ['checked read removed', h => { named(h, 'copy').body.at(-1).value.kind = 'arrayRead'; }],
    ['checked store removed', h => { named(h, 'copy').body[0].kind = 'arrayStore'; }],
    ['helper omitted', h => { h.functions = h.functions.filter(fn => fn.name !== 'copy'); }],
  ];
  for (const [name, mutate] of changes) await t.test(name, () => {
    const hostile = fresh(row.hir); mutate(hostile); const before = fresh(hostile), ctx = factsContext(row);
    for (const action of [() => verifyHir(hostile, ctx), () => readHir(wire(hostile), ctx),
      () => analyzeArrayCalls(hostile, ctx, fresh(row.context)), () => lowerHir(hostile, ctx)]) {
      const error = caught(action); hirError(error, 'invalid'); trustedPrimary(row, error.primary);
      assert.notEqual(error.primary.start, 60000, 'error anchor is reconstructed, not attacker supplied');
    }
    assert.deepEqual(hostile, before);
  });
});

test('23e invalid selected facts/context is rejected before any HIR property is observed', async () => {
  const row = await fixture('first-touch-alias');
  let traps = 0;
  const hostileHir = new Proxy({}, {
    get() { traps++; throw Error('untrusted HIR secret'); },
    ownKeys() { traps++; throw Error('untrusted HIR secret'); },
    getPrototypeOf() { traps++; throw Error('untrusted HIR secret'); },
  });
  const badPacket = packet(row); sourceCall(named(badPacket.payload, 'entry')).callee = bogusHash; reframe(badPacket);
  const cases = [factsContext(row, badPacket), { ...factsContext(row), expectedPackageId: bogusHash }];
  const getter = factsContext(row);
  Object.defineProperty(getter, 'factsBytes', { enumerable: true, get() { traps++; throw Error('secret getter'); } });
  cases.push(getter);
  for (const ctx of cases) {
    const error = caught(() => verifyHir(hostileHir, ctx)); hirError(error, 'context');
    assert.equal(error.primary, undefined); assert.equal(traps, 0);
    const built = buildHir(hostileHir, ctx); assert.equal(built.status, 'error');
    assert.equal(built.diagnostics[0].code, 'r03-array-hir-context'); assert.equal(traps, 0);
  }
});

test('23e complete selected HIR preflight rejects unsafe call properties without invocation', async () => {
  const row = await fixture('first-touch-alias');
  let traps = 0;
  const trap = () => { traps++; throw Error('secret HIR getter'); };
  const root = new Proxy(fresh(row.hir), { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
  const nested = fresh(row.hir);
  Object.defineProperty(directCall(named(nested, 'entry')), 'arguments', { enumerable: true, get: trap });
  for (const hostile of [root, nested]) {
    const error = caught(() => verifyHir(hostile, factsContext(row)));
    hirError(error, 'invalid'); assert.equal(traps, 0);
    assert.ok(!error.message.includes('secret HIR getter'));
  }
});

test('23e publication and report preflight never invoke getter or Proxy behavior', async () => {
  const row = await fixture('first-touch-alias'), ctx = factsContext(row);
  let traps = 0;
  const trap = () => { traps++; throw Error('private sentinel must not be observed'); };
  const proxy = value => new Proxy(value, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
  const getter = fresh(row.context);
  Object.defineProperty(getter, 'contracts', { enumerable: true, get: trap });
  const nested = fresh(row.context); nested.contracts[0].upper = proxy(nested.contracts[0].upper);
  for (const publication of [getter, proxy(fresh(row.context)), nested]) {
    const error = caught(() => analyzeArrayCalls(fresh(row.hir), ctx, publication));
    analysisError(error); assert.equal(error.primary, undefined); assert.equal(traps, 0);
    assert.ok(!error.message.includes('private sentinel'));
  }
  const report = fresh(row.analysis);
  Object.defineProperty(report, 'functions', { enumerable: true, get: trap });
  for (const hostile of [report, proxy(fresh(row.analysis))]) {
    analysisError(caught(() => verifyArrayCalls(hostile, fresh(row.hir), ctx, fresh(row.context))));
    assert.equal(traps, 0);
  }
});

test('23e selected analysis JSON rejects duplicate keys, prototype keys and invalid UTF8 before reconstruction', async () => {
  const row = await fixture('first-touch-alias'), valid = wire(row.analysis).toString();
  const malformed = [
    Buffer.from('{"format":null,' + valid.slice(1)),
    Buffer.from('{"__proto__":{}}\n'),
    Buffer.from([0xc0, 0xaf, 0x0a]),
  ];
  for (const bytes of malformed)
    analysisError(caught(() => readArrayCalls(bytes, fresh(row.hir), factsContext(row), fresh(row.context))));
});

test('23e canonical analysis framing rejects missing/extra LF and leading whitespace', async () => {
  const row = await fixture('first-touch-alias'), bytes = wire(row.analysis);
  for (const hostile of [bytes.subarray(0, bytes.length - 1), Buffer.concat([bytes, Buffer.from('\n')]),
    Buffer.concat([Buffer.from(' '), bytes])])
    analysisError(caught(() => readArrayCalls(hostile, fresh(row.hir), factsContext(row), fresh(row.context))), 'canonical');
});

test('37d complete ordinary call survives while unsupported return shape refuses exactly', async t => {
  for (const name of ['core-call-only-refusal', 'core-new-return-only-refusal']) await t.test(name, async () => {
    const row = await fixture(name), hir = fresh(row.hir), ctx = factsContext(row), before = fresh(hir);
    assert.deepEqual(verifyHir(hir, ctx), row.hir);
    assert.ok(hir.functions.every(fn => fn.parameters.length === 0), 'Array parameter refusal must not mask this isolated case');
    assert.equal(hir.exports.length, hir.functions.length, 'export subset must not mask this isolated case');
    const fn = named(hir, 'entry');
    const range = name === 'core-call-only-refusal' ? directCall(fn).range : fn.body.at(-1).range;
    if (name === 'core-call-only-refusal') assert.deepEqual(directCall(fn).arguments, []);
    if (name === 'core-call-only-refusal') {
      assert.deepEqual(hir,coreCallOracle.hir);assert.equal(lowerHir(hir,ctx),migrateArrayCore10(coreCallOracle.core));
      assert.deepEqual(hir,before);return;
    }
    let core; const error = caught(() => { core = lowerHir(hir, ctx); });
    assert.equal(error.name, 'TypeError'); assert.equal(error.code, 'r03-d-core-array-capability');
    assert.equal(error.ruleId, 'r01-ts-baseline'); assert.equal(error.phase, 'lowering');
    assert.equal(error.upstreamCode, undefined);
    assert.equal(error.message, 'Array Core lowering requires nominal Array/scalar calls and a final checked read or f64 direct call');
    assert.deepEqual(error.primary, { sourceId: fn.sourcePath, ...range });
    assert.equal(core, undefined); assert.deepEqual(hir, before);
  });
});
