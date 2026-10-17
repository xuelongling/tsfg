// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';
import { lowerClosureEnvironments, verifyClosureEnvironments, printClosureEnvironments } from '../../compiler/closure-environments.mjs';
import { emitClosureCore } from '../../compiler/closure-core-emitter.mjs';

const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
// Independent frame pins keep these public-input tests separate from 19f's tests;
// importing another test would register unrelated tests and obscure this boundary.
const cases = {
  "branchAndLoop": {"family":"m19-closure-flow","frames":{"request":[2157,"sha256:905a09e46609b3bc388eb9ecd1ea12a0f14d6ed2adb2dfed27c33809bc8f92d9"],"response":[6009,"sha256:04cc5750818e82f993813fb77159794a7d7f3b29d3bf577047063d27c0b91f44"],"original":[1797,"sha256:7b93b8a695d375988420f09bc3652c81cb8620562669e8038d6fe81cecaee991"],"provenance":[14727,"sha256:f3a088e08e782a11cde9ac55ab58b882b5bed15250f03c8182bd2a9089ea573e"]},"source":"export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; if (seed) { selected = other; } else { selected = first; } const before = selected(); let again: bool = seed; while (again) { selected = other; again = false; } return selected() && before; }","origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:905a09e46609b3bc388eb9ecd1ea12a0f14d6ed2adb2dfed27c33809bc8f92d9","responseSha256":"sha256:04cc5750818e82f993813fb77159794a7d7f3b29d3bf577047063d27c0b91f44","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"}},
  "calleeBeforeArgumentRebind": {"family":"m19-closure-flow","frames":{"request":[2056,"sha256:a0bcf4a037044833eace9b3c3c957ada49a413b2c1dbe64ee796018eb04f67ec"],"response":[5075,"sha256:e0265942a058eaf3b7415aa0e5d8980ba1bbadb5d6edc079acf0230e537fa53a"],"original":[1696,"sha256:6a71bd2de757784fc5d026976d5eab8b70015102bf50135b0cad6efa4c10ee1d"],"provenance":[14753,"sha256:523706e8b6b20fe59f9eb70c1e59f7e163f945aa6f11de1074afb27e08fe13f1"]},"source":"export function entry(seed: bool): bool { function first(leftValue: bool): bool { return leftValue; } function other(rightValue: bool): bool { return !rightValue; } let selected: (argument: bool) => bool = first; return selected((selected = other)(seed)); }","origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:a0bcf4a037044833eace9b3c3c957ada49a413b2c1dbe64ee796018eb04f67ec","responseSha256":"sha256:e0265942a058eaf3b7415aa0e5d8980ba1bbadb5d6edc079acf0230e537fa53a","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"}},
  "externalAndFactoryActivations": {"family":"m19-closure-flow","frames":{"request":[2170,"sha256:b879f81696578db65e7bfbec9ca0539f7d777bfb80bb20d452263e9a097113d0"],"response":[7266,"sha256:6070acf1b5ea1c92993f7a186566f2d71ff0adc804967ae3969c6e882c61dc40"],"original":[1810,"sha256:a4a06e70dd181b836fc2ed708ba2d1d5370c8a869eb75c635308c428dd1273fc"],"provenance":[14759,"sha256:c47edea5f879298faf36d16fe710b3fa3272e1b3e9fc0e3267c00bac8ea5926d"]},"source":"export function entry(external: () => bool, seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } function make(fn: () => bool): () => bool { function invoke(): bool { return fn(); } return invoke; } const left = make(first); const right = make(other); return external() && left() && right(); }","origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:b879f81696578db65e7bfbec9ca0539f7d777bfb80bb20d452263e9a097113d0","responseSha256":"sha256:6070acf1b5ea1c92993f7a186566f2d71ff0adc804967ae3969c6e882c61dc40","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"}},
  "mutualHigherOrder": {"family":"m19-closure-flow","frames":{"request":[2176,"sha256:e6eca442b51fcf31e9f5011e70ca057e4f7a2fffdd47d7ef3ad76e434f64558c"],"response":[7686,"sha256:4323492f24dcdc147931bbaf9bd557e59182a7aef20f466e9083ff5dfbd6b36d"],"original":[1816,"sha256:4e126e706f36da7cf16bcc40d6df24bd4b5550d6f37519357d38080f7eefbf9c"],"provenance":[14735,"sha256:361a228dd99c4f0cd60f075571af683aaa2c89f307f4476fa5014ad6fe62161d"]},"source":"export function entry(seed: bool): bool { function leaf(): bool { return seed; } function left(fn: () => bool, again: bool): () => bool { if (again) { return right(fn, false); } return fn; } function right(next: () => bool, again: bool): () => bool { if (again) { return left(next, false); } return next; } const selected = left(leaf, seed); return selected(); }","origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:e6eca442b51fcf31e9f5011e70ca057e4f7a2fffdd47d7ef3ad76e434f64558c","responseSha256":"sha256:4323492f24dcdc147931bbaf9bd557e59182a7aef20f466e9083ff5dfbd6b36d","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"}},
  "sharedCallableWrites": {"family":"m19-closure-flow","frames":{"request":[2160,"sha256:ddc69f9f4559bd27eec1b93a80bc47c62e2ca058ef0a95a2c62560a3c6473b47"],"response":[6685,"sha256:1983a4e1d59f636c9dbc60391677106f9343f59f9beae23363bc7d174e623266"],"original":[1800,"sha256:4db7ecbc4435619caed85a709e290375012d891d3411e74010ba22d5f10b1acf"],"provenance":[14741,"sha256:002e3b58995ccfc3162c20c6a8272c25e8be81810710a1ecb9b9d036c4280cbc"]},"source":"export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; function read(): bool { return selected(); } function write(next: () => bool): bool { selected = next; return selected(); } const alias = selected; write(other); return read() && alias(); }","origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:ddc69f9f4559bd27eec1b93a80bc47c62e2ca058ef0a95a2c62560a3c6473b47","responseSha256":"sha256:1983a4e1d59f636c9dbc60391677106f9343f59f9beae23363bc7d174e623266","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"}},
  "transitiveExternalRootEnvironment": {"family":"m19-closure-flow","frames":{"request":[2066,"sha256:c60167a16423b628a9026c41fb5f63d5bedbb1124a43967b7b9dfb06fc77bb73"],"response":[4420,"sha256:4fd9db8ffb55ac075a866fab65f4ff7f9b29d8fe45abb38345e36bfb62044f1a"],"original":[1706,"sha256:b78fdca5b757d2c587fc0ab08d3caa3c841120b8d8aa4534970660751eb33f7b"],"provenance":[14960,"sha256:32776cdff6f98d27b4a9b482a363f69b3b58e6ce61ead9fd5bcd95be8c4bbcb7"]},"source":"export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; function middle(): bool { function helper(): bool { return selected(); } return helper(); } return middle(); }","origin":{"kind":"owned-go-response","producerBaseOid":"a8dc34ed0d7c96fe09070446b2e4e729dbad97b7","producerDirty":true,"requestSha256":"sha256:c60167a16423b628a9026c41fb5f63d5bedbb1124a43967b7b9dfb06fc77bb73","responseSha256":"sha256:4fd9db8ffb55ac075a866fab65f4ff7f9b29d8fe45abb38345e36bfb62044f1a","testedInputSetHash":"sha256:0ae8c1010eaeee5162fb180bbaac3669a2812b7c98a4e255e33e37f1b5d6b965"}},
  "shared-mutable": {"family":"m19-closure-boundaries","frames":{"request":[1997,"sha256:f4bfa8f354caf312c86b88092dd8c2bbfd7923dd7ad757e82423ac51c81a63ac"],"response":[4015,"sha256:f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181"],"original":[1637,"sha256:e752c628052fdb6e98f8ea812482afc13cf8f774b24d27fef6d63a2107a2a960"],"provenance":[1625,"sha256:bb432e8db6c0b8426fe6152f23ef06c8313be3ba064453150a29a5f197a779a3"]},"source":"export function entry(seed: bool): bool { let state: bool = seed; function write(value: bool): bool { state = value; return state; } function read(): bool { return state; } write(false); return read(); }","origin":{"kind":"owned-go-response","producerBaseOid":"8d106b6768521c21b9ef4e7a69df023977d71b09","producerDirty":true,"testedInputSetHash":"sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b","requestSha256":"sha256:f4bfa8f354caf312c86b88092dd8c2bbfd7923dd7ad757e82423ac51c81a63ac","responseSha256":"sha256:f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181"}},
};
const one = values => { assert.equal(values.length, 1); return values[0]; };
const named = (functions, name) => one(functions.filter(fn => fn.name === name));
const binding = (context, id) => one(context.program.bindings.filter(item => item.id === id));
const symbol = fn => 'f' + fn.id.slice(7);
const env = layout => '!tsfg_closure.env<"' + layout.id + '">';
const callable = id => '!tsfg_closure.value<"' + id + '">';
const anchor = range => 'tsfg_source.start = ' + range.start + ' : i64, tsfg_source.end = ' + range.end + ' : i64';
async function realCase(name) {
  const pin = cases[name], directory = new URL('../fixtures/r03/' + pin.family + '/' + name + '/', import.meta.url);
  /** @type {Record<string, Buffer>} */
  const frames = {};
  for (const kind of ['request', 'response', 'original', 'provenance']) {
    frames[kind] = await readFile(new URL(kind + '.json', directory));
    assert.equal(frames[kind].length, pin.frames[kind][0]);
    assert.equal(digest(frames[kind]), pin.frames[kind][1]);
  }
  const metadata = JSON.parse(frames.provenance.toString('utf8'));
  assert.deepEqual(metadata.origin, pin.origin);
  const request = JSON.parse(frames.request.toString('utf8')), original = JSON.parse(frames.original.toString('utf8'));
  assert.deepEqual(request.files, original.files); assert.equal(request.rootFile, original.rootFile);
  assert.equal(request.files.find(file => file.path === request.rootFile).content, pin.source);
  const imported = await importCapturedFrontendResponse(frames.request, frames.response, metadata.origin);
  assert.equal(imported.status, 'ok', JSON.stringify(imported)); validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot); assert.equal(built.status, 'ok', JSON.stringify(built));
  const before = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(before));
  assert.deepEqual(verifyHir(hir), built.hir);
  const program = lowerClosureEnvironments(hir); assert.deepEqual(verifyClosureEnvironments(program, hir), program);
  return { hir, program, before, programBefore: printClosureEnvironments(program, hir) };
}
function capturedLocals(context) {
  return context.program.environments.flatMap(layout => layout.slots.map(slot => binding(context, slot.binding)))
    .filter(item => item.role !== 'parameter');
}
function emitted(context) {
  assert.deepEqual(capturedLocals(context), [], 'this actual program is in the parameter-capture subset');
  const text = emitClosureCore(context.program, context.hir);
  const fullId = /^sha256:[0-9a-f]{64}$/;
  assert.equal([...text.matchAll(/^  func[.]func /gm)].length, context.program.functions.length);
  for (const fn of context.program.functions) {
    assert.match(fn.id, fullId); assert.ok(text.includes('@"' + symbol(fn) + '"('));
    assert.ok(text.includes('tsfg_core.function_id = "' + fn.id + '"'));
  }
  for (const layout of context.program.environments) {
    assert.match(layout.id, fullId); assert.ok(text.includes(env(layout)));
    for (const slot of layout.slots) { assert.match(slot.binding, fullId); assert.match(slot.type, fullId); }
  }
  assert.equal(emitClosureCore(context.program, context.hir), text);
  assert.equal(printHir(context.hir), context.before);
  assert.equal(printClosureEnvironments(context.program, context.hir), context.programBefore);
  return text;
}
// Finite text-golden observations only: no MLIR grammar, type checker, execution,
// target inference or root analysis. Compare actual SSA operand spellings/edges.
function body(text, fn) {
  const start = text.indexOf('  func.func @"' + symbol(fn) + '"(');
  assert.ok(start >= 0); const end = text.indexOf('\n  }', start); assert.ok(end > start);
  return text.slice(start, end).split('\n');
}
const operation = (lines, name, range) => one(lines.filter(line => line.includes('"' + name + '"(') && line.includes(anchor(range))));
const result = line => one([...line.matchAll(/^    (%v[0-9]+) = /g)])[1];
function operands(line, name) {
  const start = line.indexOf('"' + name + '"('); assert.ok(start >= 0);
  const text = line.slice(start + name.length + 3).split(')')[0];
  return text ? text.split(', ') : [];
}
function edge(line) {
  const match = line.match(/cf[.]br \^(bb[0-9]+)(?:\((.*?) : (.*?)\))?/);
  assert.ok(match); return { label: match[1], values: match[2]?.split(', ') ?? [], types: match[3]?.split(', ') ?? [] };
}
function argumentsOf(lines, label) {
  const line = one(lines.filter(item => item.startsWith('  ^' + label + '(')));
  return line.slice(line.indexOf('(') + 1, -2).split(', ').map(item => item.split(': ')[0]);
}
function ordered(lines, earlier, later) { assert.ok(lines.indexOf(earlier) < lines.indexOf(later)); }

test('two factory activations carry a typed parent and capture the actual callable parameter', async () => {
  const c = await realCase('externalAndFactoryActivations'), core = emitted(c), functions = c.program.functions;
  const entry = named(functions, 'entry'), make = named(functions, 'make'), invoke = named(functions, 'invoke');
  const entryLayout = one(c.program.environments.filter(item => item.owner === entry.id));
  const makeLayout = one(c.program.environments.filter(item => item.owner === make.id));
  const fn = binding(c, make.parameters[0]), seed = binding(c, entry.parameters[1]);
  assert.equal(fn.role, 'parameter'); assert.equal(seed.role, 'parameter');
  assert.equal(makeLayout.parent, entryLayout.id); assert.equal(make.lexicalEnvironment, entryLayout.id);
  assert.equal(invoke.lexicalEnvironment, makeLayout.id); assert.notEqual(makeLayout.id, entryLayout.id);
  const e = body(core, entry), m = body(core, make), i = body(core, invoke);
  assert.ok(e[0].includes('(%v0: ' + callable(binding(c, entry.parameters[0]).type) + ', %v1: i1)'));
  assert.ok(m[0].includes('(%v0: ' + env(entryLayout) + ', %v1: ' + callable(fn.type) + ')'));
  assert.ok(i[0].includes('(%v0: ' + env(makeLayout) + ')'));
  const ea = operation(e, 'tsfg_closure.env.alloc', entry.definitionRange), ma = operation(m, 'tsfg_closure.env.alloc', make.definitionRange);
  assert.deepEqual(operands(ea, 'tsfg_closure.env.alloc'), []);
  assert.deepEqual(operands(ma, 'tsfg_closure.env.alloc'), ['%v0']);
  assert.ok(ma.endsWith(': (' + env(entryLayout) + ') -> ' + env(makeLayout)));
  const seedInit = operation(e, 'tsfg_closure.env.init', seed.range);
  assert.deepEqual(operands(seedInit, 'tsfg_closure.env.init'), [result(ea), '%v1']);
  assert.ok(seedInit.includes('binding = "' + seed.id + '"')); ordered(e, ea, seedInit);
  const init = operation(m, 'tsfg_closure.env.init', fn.range);
  assert.deepEqual(operands(init, 'tsfg_closure.env.init'), [result(ma), '%v1']);
  assert.ok(init.includes('binding = "' + fn.id + '", anchor_kind = "parameter"'));
  assert.ok(init.endsWith(': (' + env(makeLayout) + ', ' + callable(fn.type) + ') -> ()'));
  ordered(m, ma, init);
  const returned = make.body.at(-1).value, made = operation(m, 'tsfg_closure.make', returned.range);
  assert.deepEqual(operands(made, 'tsfg_closure.make'), [result(ma)]);
  assert.ok(made.includes('function_id = "' + invoke.id + '"')); ordered(m, init, made);
  assert.deepEqual(operands(operation(m, 'func.return', make.body.at(-1).range), 'func.return'), [result(made)]);
  const call = invoke.body.at(-1).value, load = operation(i, 'tsfg_closure.env.load', call.callee.range);
  assert.ok(load.includes('binding = "' + fn.id + '"')); assert.deepEqual(operands(load, 'tsfg_closure.env.load'), ['%v0']);
  assert.ok(load.endsWith(': (' + env(makeLayout) + ') -> ' + callable(fn.type)));
  const invoked = operation(i, 'tsfg_closure.call', call.range);
  assert.deepEqual(operands(invoked, 'tsfg_closure.call'), [result(load)]); ordered(i, load, invoked);
  const locals = entry.body.filter(item => item.kind === 'local'); assert.equal(locals.length, 2);
  const calls = locals.map(local => operation(e, 'func.call', local.initializer.range));
  for (let index = 0; index < 2; index++) {
    const argument = operation(e, 'tsfg_closure.make', locals[index].initializer.arguments[0].range);
    assert.deepEqual(operands(argument, 'tsfg_closure.make'), [result(ea)]);
    assert.deepEqual(operands(calls[index], 'func.call'), [result(ea), result(argument)]);
    assert.ok(calls[index].endsWith(': (' + env(entryLayout) + ', ' + callable(fn.type) + ') -> ' + callable(invoke.signature)));
    ordered(e, argument, calls[index]);
  }
  ordered(e, calls[0], calls[1]); assert.notEqual(result(calls[0]), result(calls[1]));
  const expression = entry.body.at(-1).value, external = operation(e, 'tsfg_closure.call', expression.left.left.range);
  assert.deepEqual(operands(external, 'tsfg_closure.call'), ['%v0']);
  assert.ok(e.some(line => line.includes('cf.cond_br ' + result(external) + ',') && line.includes(anchor(expression.left.range))));
  assert.deepEqual(operands(operation(e, 'tsfg_closure.call', expression.left.right.range), 'tsfg_closure.call'), [result(calls[0])]);
  assert.deepEqual(operands(operation(e, 'tsfg_closure.call', expression.right.range), 'tsfg_closure.call'), [result(calls[1])]);
  assert.equal(e.filter(line => line.includes('cf.cond_br ')).length, 2, 'both && operands retain short-circuit CFG');
});

test('outer closure call uses its saved first pair after an argument rebind calls other', async () => {
  const c = await realCase('calleeBeforeArgumentRebind'), core = emitted(c), entry = named(c.program.functions, 'entry');
  assert.deepEqual(c.program.environments, []);
  const e = body(core, entry), first = named(c.program.functions, 'first'), other = named(c.program.functions, 'other');
  const outer = entry.body.at(-1).value, inner = outer.arguments[0];
  const saved = operation(e, 'tsfg_closure.make', entry.body.find(item => item.kind === 'local').initializer.range);
  const rebound = operation(e, 'tsfg_closure.make', inner.callee.operand.right.range);
  assert.ok(saved.includes('function_id = "' + first.id + '"'));
  assert.ok(rebound.includes('function_id = "' + other.id + '"'));
  assert.deepEqual(operands(saved, 'tsfg_closure.make'), []); assert.deepEqual(operands(rebound, 'tsfg_closure.make'), []);
  const innerCall = operation(e, 'tsfg_closure.call', inner.range), outerCall = operation(e, 'tsfg_closure.call', outer.range);
  assert.deepEqual(operands(innerCall, 'tsfg_closure.call'), [result(rebound), '%v0']);
  assert.deepEqual(operands(outerCall, 'tsfg_closure.call'), [result(saved), result(innerCall)]);
  assert.notEqual(result(saved), result(rebound));
  ordered(e, saved, rebound); ordered(e, rebound, innerCall); ordered(e, innerCall, outerCall);
  assert.ok(outerCall.endsWith(': (' + callable(outer.signature) + ', i1) -> i1'));
  assert.ok(outerCall.includes('signature_hash = "' + outer.signatureHash + '"'));
  assert.deepEqual(operands(operation(e, 'func.return', entry.body.at(-1).range), 'func.return'), [result(outerCall)]);
  assert.equal(e.filter(line => line.includes('"tsfg_closure.make"(')).length, 2, 'neither closure pair is recomputed');
});

test('actual branch and loop carry whole closure SSA values through joins and backedges', async () => {
  const c = await realCase('branchAndLoop'), core = emitted(c), entry = named(c.program.functions, 'entry'), e = body(core, entry);
  const branch = one(entry.body.filter(item => item.kind === 'if')), loop = one(entry.body.filter(item => item.kind === 'while'));
  const chosen = branch.thenBody[0].body[0].value, fallback = branch.elseBody[0].body[0].value;
  const yes = operation(e, 'tsfg_closure.make', chosen.range), no = operation(e, 'tsfg_closure.make', fallback.range);
  const joins = e.filter(line => line.includes('cf.br ') && line.includes(anchor(branch.range)));
  assert.equal(joins.length, 2); const left = edge(joins[0]), right = edge(joins[1]);
  assert.equal(left.label, right.label); const selectedIndex = left.types.indexOf(callable(chosen.type)); assert.ok(selectedIndex >= 0);
  assert.equal(left.values[selectedIndex], result(yes)); assert.equal(right.values[selectedIndex], result(no));
  const selectedPhi = argumentsOf(e, left.label)[selectedIndex];
  const beforeLocal = one(entry.body.filter(item => item.kind === 'local' && binding(c, item.binding).name === 'before'));
  const before = operation(e, 'tsfg_closure.call', beforeLocal.initializer.range);
  assert.deepEqual(operands(before, 'tsfg_closure.call'), [selectedPhi]);
  const jumps = e.filter(line => line.includes('cf.br ') && line.includes(anchor(loop.condition.range)));
  assert.equal(jumps.length, 2); const entering = edge(jumps[0]), back = edge(jumps[1]);
  assert.equal(entering.label, back.label); const loopSelectedIndex = entering.types.indexOf(callable(chosen.type));
  assert.equal(entering.values[loopSelectedIndex], selectedPhi);
  const changed = operation(e, 'tsfg_closure.make', loop.body[0].body[0].value.range);
  assert.equal(back.values[loopSelectedIndex], result(changed));
  const header = argumentsOf(e, entering.label), beforeIndex = entering.values.indexOf(result(before)); assert.ok(beforeIndex >= 0);
  const expression = entry.body.at(-1).value, final = operation(e, 'tsfg_closure.call', expression.left.range);
  assert.deepEqual(operands(final, 'tsfg_closure.call'), [header[loopSelectedIndex]]);
  assert.equal(e.filter(line => line.includes('cf.cond_br ')).length, 3, 'if, while and && retain independent branches');
  const shortBranch = one(e.filter(line => line.includes('cf.cond_br ' + result(final) + ',') && line.includes(anchor(expression.range))));
  assert.ok(shortBranch);
  const shortEdges = e.filter(line => line.includes('cf.br ') && line.includes(anchor(expression.range))).map(edge);
  assert.equal(shortEdges.length, 2); assert.equal(shortEdges[0].label, shortEdges[1].label);
  assert.deepEqual(shortEdges.map(item => item.values[0]).sort(), [result(final), header[beforeIndex]].sort());
  const returned = operation(e, 'func.return', entry.body.at(-1).range);
  assert.deepEqual(operands(returned, 'func.return'), [argumentsOf(e, shortEdges[0].label)[0]]);
  const fuel = one(e.filter(line => line.includes('"tsfg_core.fuel"() {event = 2 : i32')));
  assert.ok(fuel.includes(anchor(loop.condition.range)));
});

test('mutual higher-order direct calls preserve hidden env and callable arguments on both live return paths', async () => {
  const c = await realCase('mutualHigherOrder'), core = emitted(c), functions = c.program.functions;
  const entry = named(functions, 'entry'), leaf = named(functions, 'leaf'), layout = one(c.program.environments);
  assert.equal(layout.owner, entry.id);
  for (const [name, targetName] of [['left', 'right'], ['right', 'left']]) {
    const fn = named(functions, name), target = named(functions, targetName), lines = body(core, fn);
    const parameter = binding(c, fn.parameters[0]), branch = fn.body[0], call = branch.thenBody[0].body[0].value;
    assert.ok(lines[0].includes('(%v0: ' + env(layout) + ', %v1: ' + callable(parameter.type) + ', %v2: i1)'));
    const invoked = operation(lines, 'func.call', call.range), args = operands(invoked, 'func.call');
    assert.deepEqual(args.slice(0, 2), ['%v0', '%v1']); assert.equal(args.length, 3);
    const constant = operation(lines, 'tsfg_core.constant', call.arguments[1].range);
    assert.equal(args[2], result(constant)); assert.ok(constant.includes('value = 0 : i1'));
    assert.ok(invoked.includes('tsfg_core.function_id = "' + target.id + '"'));
    assert.ok(invoked.endsWith(': (' + env(layout) + ', ' + callable(parameter.type) + ', i1) -> ' + callable(leaf.signature)));
    const returnedCall = operation(lines, 'func.return', branch.thenBody[0].body[0].range);
    assert.deepEqual(operands(returnedCall, 'func.return'), [result(invoked)]);
    const merge = edge(one(lines.filter(line => line.includes('cf.br ') && line.includes(anchor(branch.range)))));
    const index = merge.values.indexOf('%v1'); assert.ok(index >= 0);
    assert.deepEqual(operands(operation(lines, 'func.return', fn.body.at(-1).range), 'func.return'), [argumentsOf(lines, merge.label)[index]]);
  }
});

for (const [name, localName] of [['sharedCallableWrites', 'selected'], ['transitiveExternalRootEnvironment', 'selected'], ['shared-mutable', 'state']])
test(name + ' cold-valid captured local gets an explicit whole-program capability refusal', async () => {
  const c = await realCase(name), local = one(capturedLocals(c)); assert.equal(local.name, localName);
  assert.equal(local.role, 'local'); assert.deepEqual(verifyClosureEnvironments(c.program, c.hir), c.program);
  assert.throws(() => emitClosureCore(c.program, c.hir), /** @param {any} error */ error => {
    assert.equal(error.code, 'r03-d-capability'); assert.equal(error.ruleId, 'r01-ts-baseline'); assert.equal(error.phase, 'lowering');
    assert.ok(error.message.includes('closure Core emission for captured local bindings is not implemented'));
    assert.deepEqual(error.primary, { source: c.program.source.path, start: local.range.start, end: local.range.end, owner: local.owner, binding: local.id });
    return true;
  });
  // A valid hirHash alone never bypasses 19f's cold verification, even for an
  // otherwise unsupported local-capture program. No partial IR can be returned.
  const changed = JSON.parse(c.programBefore); changed.functions[0].body.shift();
  assert.equal(changed.hirHash, c.program.hirHash);
  assert.throws(() => emitClosureCore(changed, c.hir), /** @param {any} error */ error =>
    /^r03-closure-environments-/.test(error.code) && error.phase === 'lowering');
  assert.equal(printHir(c.hir), c.before); assert.equal(printClosureEnvironments(c.program, c.hir), c.programBefore);
});

test('cold-valid parameter program mutations are rejected before any SSA text is returned', async () => {
  const c = await realCase('externalAndFactoryActivations');
  for (const edit of [
    changed => { changed.environments[0].slots[0].binding = 'sha256:' + 'f'.repeat(64); },
    changed => { named(changed.functions, 'make').body.shift(); },
    changed => { named(changed.functions, 'make').body.at(-1).value.environment = null; },
  ]) {
    const changed = JSON.parse(c.programBefore); edit(changed); assert.equal(changed.hirHash, c.program.hirHash);
    assert.throws(() => emitClosureCore(changed, c.hir), /** @param {any} error */ error =>
      /^r03-closure-environments-/.test(error.code) && error.phase === 'lowering');
  }
});

// Three additional public Go captures: tested dirty BASE3a, delivered e73eafaf.
Object.assign(cases, {
  "nestedParentParameterRead": {"family":"m19-closure-flow","frames":{"request":[2057,"sha256:cb7c1b91b4b766809bdc2742bfe9561415595a340523f998c3b0dc3ef32443a6"],"response":[4831,"sha256:f36dec7337b190294eaccc70fda6b9306b7ff2a621e2993d9e17cec65f5bad95"],"original":[1697,"sha256:f6afbea6c3a5e7bcef18e9b3b36366ae9343de85d41802cf00ec19e6056f7eb1"],"provenance":[15129,"sha256:ce2f94fb3ee245a0105e1df1d593c1f41f1c815c1ddb763dd48eedb62e683b23"]},"source":"export function entry(seed: bool): bool { function first(): bool { return false; } function make(fn: () => bool): () => bool { function invoke(): bool { return fn() && seed; } return invoke; } const selected = make(first); return selected(); }","origin":{"kind":"owned-go-response","producerBaseOid":"3a9461a09934e5a932a5a51ad81bd53c9c2b00e7","producerDirty":true,"requestSha256":"sha256:cb7c1b91b4b766809bdc2742bfe9561415595a340523f998c3b0dc3ef32443a6","responseSha256":"sha256:f36dec7337b190294eaccc70fda6b9306b7ff2a621e2993d9e17cec65f5bad95","testedInputSetHash":"sha256:e7fedc04d92ea8e2858f035fd001cded462b691bab8bed111ca4a0b0bd943768"}},
  "capturedCallableParameterWrites": {"family":"m19-closure-flow","frames":{"request":[2089,"sha256:817f23a81d3a9cc2afe47dda9426ec294a132541eae0e9b9ef3f49f06f9642f3"],"response":[5052,"sha256:61bb689fbffd4919b0b5da9b9f89e598bed9ed1394e2c82a19f4e585c9c856ad"],"original":[1729,"sha256:a9b8591c21d49ddd0bb355500bb136d06ccc3773a3917d78adfdd78165992ba1"],"provenance":[15141,"sha256:4f5bd686790637f7f83cdcaf9ab237036d15c47c7c040957cbd180f95c6d84ce"]},"source":"export function entry(selected: () => bool, replacement: () => bool): bool { function choose(fn: () => bool): () => bool { return fn; } function update(next: () => bool): bool { selected = choose(next); return (selected = choose(next))(); } return update(replacement); }","origin":{"kind":"owned-go-response","producerBaseOid":"3a9461a09934e5a932a5a51ad81bd53c9c2b00e7","producerDirty":true,"requestSha256":"sha256:817f23a81d3a9cc2afe47dda9426ec294a132541eae0e9b9ef3f49f06f9642f3","responseSha256":"sha256:61bb689fbffd4919b0b5da9b9f89e598bed9ed1394e2c82a19f4e585c9c856ad","testedInputSetHash":"sha256:e7fedc04d92ea8e2858f035fd001cded462b691bab8bed111ca4a0b0bd943768"}},
  "shortCircuitClosureRebind": {"family":"m19-closure-flow","frames":{"request":[2051,"sha256:5d41821e189f7365e6195ba9345d44900b21214ad25d32fbc32248be7ad738aa"],"response":[4444,"sha256:a32a1d35b1afc167fd0a1aaaf1b3dded36d7b1cfc7723bf9d190dd9d4ff9cc39"],"original":[1691,"sha256:acdc2a1c85b8df41c2331667f6d38e58f472d2ade67c2c620281427906f9114d"],"provenance":[15129,"sha256:5b41590bbf6b2631f42a7d23debe6bd47a5594b3f6f7b617131b4a6adf5088e8"]},"source":"export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; const before = seed && (selected = other)(); return selected() && before; }","origin":{"kind":"owned-go-response","producerBaseOid":"3a9461a09934e5a932a5a51ad81bd53c9c2b00e7","producerDirty":true,"requestSha256":"sha256:5d41821e189f7365e6195ba9345d44900b21214ad25d32fbc32248be7ad738aa","responseSha256":"sha256:a32a1d35b1afc167fd0a1aaaf1b3dded36d7b1cfc7723bf9d190dd9d4ff9cc39","testedInputSetHash":"sha256:e7fedc04d92ea8e2858f035fd001cded462b691bab8bed111ca4a0b0bd943768"}},
});

async function newRealCase(name) {
  const directory = new URL('../fixtures/r03/m19-closure-flow/' + name + '/', import.meta.url);
  const provenance = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8'));
  assert.equal(provenance.deliveryOid, 'e73eafaf80eeffc5040f4eef7cd2a58951cfbce1');
  assert.equal(provenance.origin.producerBaseOid, '3a9461a09934e5a932a5a51ad81bd53c9c2b00e7');
  assert.notEqual(provenance.deliveryOid, provenance.origin.producerBaseOid);
  assert.equal(provenance.origin.producerDirty, true);
  assert.equal(provenance.execution.baseOid, provenance.origin.producerBaseOid);
  assert.equal(provenance.execution.dirty, true); assert.equal(provenance.execution.pid, 28248);
  assert.equal(provenance.execution.test, 'TestFrontendCommandClosureFlowFacts/' + name + '/ownedProjection');
  assert.equal(provenance.execution.rawLog.bytes, 54988);
  assert.equal(provenance.execution.rawLog.sha256, '508854754f16df140271958d777ee50b988998325c145a4723f59ff8c7b7afc0');
  assert.equal(provenance.testedInputs.length, 90);
  assert.equal(new Set(provenance.testedInputs.map(item => item.path)).size, 90);
  const inputHash = 'sha256:e7fedc04d92ea8e2858f035fd001cded462b691bab8bed111ca4a0b0bd943768';
  assert.equal(digest(JSON.stringify(provenance.testedInputs)), inputHash);
  assert.equal(provenance.origin.testedInputSetHash, inputHash); assert.equal(provenance.execution.testedInputSetHash, inputHash);
  const table = one(provenance.testedInputs.filter(item => item.path === 'tsc/cmd/tsfg-frontend/frontend_closure_flow_test.go'));
  assert.equal(table.bytes, 16784); assert.equal(table.sha256, 'dfd10f33f87562119902181733c5f5656b88f8cd3b896fbb1a59a614399e5b63');
  return realCase(name);
}

test('nested parent parameter read emits a typed parent SSA before the ancestor seed load', async () => {
  const c = await newRealCase('nestedParentParameterRead'), core = emitted(c), functions = c.program.functions;
  const entry = named(functions, 'entry'), make = named(functions, 'make'), invoke = named(functions, 'invoke');
  const outer = one(c.program.environments.filter(item => item.owner === entry.id));
  const inner = one(c.program.environments.filter(item => item.owner === make.id));
  assert.equal(inner.parent, outer.id); assert.equal(invoke.lexicalEnvironment, inner.id);
  const seed = binding(c, entry.parameters[0]), fn = binding(c, make.parameters[0]);
  assert.deepEqual(outer.slots, [{ binding: seed.id, type: seed.type, writable: true }]);
  assert.deepEqual(inner.slots, [{ binding: fn.id, type: fn.type, writable: true }]);
  const lines = body(core, invoke), expression = invoke.body.at(-1).value;
  assert.ok(lines[0].includes('(%v0: ' + env(inner) + ')'));
  const fnLoad = operation(lines, 'tsfg_closure.env.load', expression.left.callee.range);
  assert.deepEqual(operands(fnLoad, 'tsfg_closure.env.load'), ['%v0']); assert.ok(fnLoad.includes('binding = "' + fn.id + '"'));
  const called = operation(lines, 'tsfg_closure.call', expression.left.range);
  assert.deepEqual(operands(called, 'tsfg_closure.call'), [result(fnLoad)]);
  const parent = operation(lines, 'tsfg_closure.env.parent', expression.right.range);
  assert.deepEqual(operands(parent, 'tsfg_closure.env.parent'), ['%v0']);
  assert.ok(parent.endsWith(': (' + env(inner) + ') -> ' + env(outer)));
  const seedLoad = operation(lines, 'tsfg_closure.env.load', expression.right.range);
  assert.ok(seedLoad.includes('binding = "' + seed.id + '"'));
  assert.deepEqual(operands(seedLoad, 'tsfg_closure.env.load'), [result(parent)]);
  assert.ok(seedLoad.endsWith(': (' + env(outer) + ') -> i1'));
  ordered(lines, fnLoad, called); ordered(lines, called, parent); ordered(lines, parent, seedLoad);
  assert.equal(lines.filter(line => line.includes('"tsfg_closure.env.parent"(')).length, 1);
  assert.ok(lines.some(line => line.includes('cf.cond_br ' + result(called) + ',') && line.includes(anchor(expression.range))));
});

test('captured callable parameter stores each once-evaluated choose RHS and calls the write-expression pair', async () => {
  const c = await newRealCase('capturedCallableParameterWrites'), core = emitted(c), functions = c.program.functions;
  const entry = named(functions, 'entry'), update = named(functions, 'update'), choose = named(functions, 'choose');
  const layout = one(c.program.environments), selected = binding(c, entry.parameters[0]), lines = body(core, update);
  assert.equal(layout.owner, entry.id); assert.equal(selected.role, 'parameter'); assert.equal(selected.writable, true);
  assert.deepEqual(layout.slots, [{ binding: selected.id, type: selected.type, writable: true }]);
  assert.ok(lines[0].includes('(%v0: ' + env(layout) + ', %v1: ' + callable(selected.type) + ')'));
  const statement = update.body[0], returned = update.body.at(-1), write = returned.value.callee.operand;
  assert.equal(statement.kind, 'environmentStore'); assert.equal(write.kind, 'environmentWrite');
  const first = operation(lines, 'func.call', statement.value.range), second = operation(lines, 'func.call', write.value.range);
  const store1 = operation(lines, 'tsfg_closure.env.store', statement.range), store2 = operation(lines, 'tsfg_closure.env.store', write.range);
  for (const call of [first, second]) {
    assert.deepEqual(operands(call, 'func.call'), ['%v0', '%v1']);
    assert.ok(call.includes('tsfg_core.function_id = "' + choose.id + '"'));
    assert.ok(call.endsWith(': (' + env(layout) + ', ' + callable(selected.type) + ') -> ' + callable(selected.type)));
  }
  for (const [store, value] of [[store1, first], [store2, second]]) {
    assert.deepEqual(operands(store, 'tsfg_closure.env.store'), ['%v0', result(value)]);
    assert.ok(store.includes('binding = "' + selected.id + '"')); assert.ok(store.endsWith(') -> ()')); assert.ok(!store.includes(' = "tsfg_closure.env.store"'));
  }
  const invoked = operation(lines, 'tsfg_closure.call', returned.value.range);
  assert.deepEqual(operands(invoked, 'tsfg_closure.call'), [result(second)]); assert.notEqual(result(first), result(second));
  ordered(lines, first, store1); ordered(lines, store1, second); ordered(lines, second, store2); ordered(lines, store2, invoked);
  assert.equal(lines.filter(line => line.includes('"func.call"(')).length, 2);
  assert.equal(lines.filter(line => line.includes('"tsfg_closure.env.store"(')).length, 2);
  assert.equal(lines.filter(line => line.includes('"tsfg_closure.env.load"(')).length, 0, 'write value reaches call without reloading the slot');
  assert.deepEqual(operands(operation(lines, 'func.return', returned.range), 'func.return'), [result(invoked)]);
});

test('short-circuit RHS rebind merges the whole closure pair and later selected call reads that phi', async () => {
  const c = await newRealCase('shortCircuitClosureRebind'), core = emitted(c), entry = named(c.program.functions, 'entry'), lines = body(core, entry);
  const selected = one(entry.body.filter(item => item.kind === 'local' && binding(c, item.binding).name === 'selected'));
  const before = one(entry.body.filter(item => item.kind === 'local' && binding(c, item.binding).name === 'before')).initializer;
  const initial = operation(lines, 'tsfg_closure.make', selected.initializer.range);
  const rhs = operation(lines, 'tsfg_closure.make', before.right.callee.operand.right.range);
  assert.ok(initial.includes('function_id = "' + named(c.program.functions, 'first').id + '"'));
  assert.ok(rhs.includes('function_id = "' + named(c.program.functions, 'other').id + '"'));
  const seed = operation(lines, 'tsfg_closure.env.load', before.left.range), rhsCall = operation(lines, 'tsfg_closure.call', before.right.range);
  assert.deepEqual(operands(rhsCall, 'tsfg_closure.call'), [result(rhs)]); ordered(lines, rhs, rhsCall);
  const edges = lines.filter(line => line.includes('cf.br ') && line.includes(anchor(before.range))).map(edge);
  assert.equal(edges.length, 2); assert.equal(edges[0].label, edges[1].label);
  const closureIndex = edges[0].types.indexOf(callable(selected.initializer.type)); assert.ok(closureIndex >= 0);
  const shortcut = one(edges.filter(item => item.values[closureIndex] === result(initial)));
  const changed = one(edges.filter(item => item.values[closureIndex] === result(rhs)));
  const boolIndex = changed.values.indexOf(result(rhsCall)); assert.ok(boolIndex >= 0);
  assert.equal(shortcut.values[boolIndex], result(seed));
  const phi = argumentsOf(lines, changed.label), returned = entry.body.at(-1), final = returned.value;
  const called = operation(lines, 'tsfg_closure.call', final.left.range);
  assert.deepEqual(operands(called, 'tsfg_closure.call'), [phi[closureIndex]]);
  assert.notEqual(phi[closureIndex], result(initial)); assert.notEqual(phi[closureIndex], result(rhs));
  const finalEdges = lines.filter(line => line.includes('cf.br ') && line.includes(anchor(final.range))).map(edge);
  assert.equal(finalEdges.length, 2); assert.equal(finalEdges[0].label, finalEdges[1].label);
  const fromCall = one(finalEdges.filter(item => item.values.includes(result(called))));
  const resultIndex = fromCall.values.indexOf(result(called));
  const fromBefore = one(finalEdges.filter(item => item !== fromCall)); assert.equal(fromBefore.values[resultIndex], phi[boolIndex]);
  assert.deepEqual(operands(operation(lines, 'func.return', returned.range), 'func.return'), [argumentsOf(lines, fromCall.label)[resultIndex]]);
  assert.equal(lines.filter(line => line.includes('cf.cond_br ')).length, 2);
});
