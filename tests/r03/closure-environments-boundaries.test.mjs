// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importCapturedFrontendResponse, validateFrontendSnapshot } from "../../compiler/frontend.mjs";
import { buildHir, verifyHir, printHir, readHir } from "../../compiler/hir.mjs";
import { lowerClosureEnvironments, verifyClosureEnvironments, printClosureEnvironments, readClosureEnvironments } from "../../compiler/closure-environments.mjs";

const digest = value => "sha256:" + createHash("sha256").update(value).digest("hex");
const copy = value => JSON.parse(JSON.stringify(value));
const custody = {
  "6bab7de3": {"base":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","input":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28","pid":36700,"log":"9e5594fedccd7ae2b281cb01afa71ee57f8ecfd5a9b47a197f8bf24d56c31630","delivery":null},
  "8d106b67": {"base":"8d106b6768521c21b9ef4e7a69df023977d71b09","input":"sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b","pid":956,"log":"sha256:83978c2e439eb19832368d4894a004c6de599b2319f43d6f4d95e36eac910fd8","delivery":"d954555abfc9f0a9886fb28e81fdb18828a4a314"},
  "a8dc34ed": {"base":"a8dc34ed0d7c96fe09070446b2e4e729dbad97b7","input":"sha256:0ae8c1010eaeee5162fb180bbaac3669a2812b7c98a4e255e33e37f1b5d6b965","pid":30716,"log":"aa2ea9d97a940f92648fa641af7d0d08ab85e78a6ccfeeeba8e78addac02c9a9","delivery":null},
  "d954555a": {"base":"d954555abfc9f0a9886fb28e81fdb18828a4a314","input":"sha256:aae37af20ba12183962301aebfd78612965cd34d8ebefc2a2ede5df31a2caf21","pid":4272,"log":"sha256:0d7cf423682c38b8f1938eb46faea3b49981cd9129cba15a1cab6b5384fce5af","delivery":null},
};
const cases = {
  "sharedCallableWrites": { family: "m19-closure-flow", custody: "6bab7de3",
    request: [2160,"sha256:ddc69f9f4559bd27eec1b93a80bc47c62e2ca058ef0a95a2c62560a3c6473b47"],
    response: [6685,"sha256:1983a4e1d59f636c9dbc60391677106f9343f59f9beae23363bc7d174e623266"],
    original: [1800,"sha256:4db7ecbc4435619caed85a709e290375012d891d3411e74010ba22d5f10b1acf"],
    provenance: [14741,"sha256:002e3b58995ccfc3162c20c6a8272c25e8be81810710a1ecb9b9d036c4280cbc"],
    source: "export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; function read(): bool { return selected(); } function write(next: () => bool): bool { selected = next; return selected(); } const alias = selected; write(other); return read() && alias(); }",
  },
  "shared-mutable": { family: "m19-closure-boundaries", custody: "8d106b67",
    request: [1997,"sha256:f4bfa8f354caf312c86b88092dd8c2bbfd7923dd7ad757e82423ac51c81a63ac"],
    response: [4015,"sha256:f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181"],
    original: [1637,"sha256:e752c628052fdb6e98f8ea812482afc13cf8f774b24d27fef6d63a2107a2a960"],
    provenance: [1625,"sha256:bb432e8db6c0b8426fe6152f23ef06c8313be3ba064453150a29a5f197a779a3"],
    source: "export function entry(seed: bool): bool { let state: bool = seed; function write(value: bool): bool { state = value; return state; } function read(): bool { return state; } write(false); return read(); }",
  },
  "write-only": { family: "m19-closure-boundaries", custody: "8d106b67",
    request: [1948,"sha256:b04536d47445fdbfc739a908a291f111a06efcbe86fe48a3b7fe5728e2e479d5"],
    response: [3155,"sha256:c498cee1c2fe1a1c6cf9e3163250e7ddfe91de8389d506ac02880559446730ae"],
    original: [1588,"sha256:4b52ac6a53fe8b345770fb01eef4a1602289f8df9b9adf917ecfe5815fe1259d"],
    provenance: [1646,"sha256:9352c6ac1ee5f47d9196223370350f99c7820d985343b2bc23928045c3e12f5a"],
    source: "export function entry(seed: bool): bool { let state: bool = seed; function write(value: bool): bool { state = value; return value; } return write(seed); }",
  },
  "ancestor": { family: "m19-closure-boundaries", custody: "8d106b67",
    request: [1963,"sha256:5fdedb8c443be9ffe047fca5ce18a750d0b82d0f8d9bc90af4a914c35614860e"],
    response: [2787,"sha256:4c3dfa83995bc302f9e891ff9ea3b3a9352762ac95a58de825395a9d038c5091"],
    original: [1603,"sha256:a156843d49c079b3ddeec6200a9caeee9fd952643645b812c5a72c0f9ebc5075"],
    provenance: [1650,"sha256:3654f3e0c132ca96f5fc4c7df1d11550620840467f897ba4e76bff0934f9db53"],
    source: "export function entry(seed: bool): bool { const state: bool = seed; function middle(): bool { function read(): bool { return state; } return read(); } return middle(); }",
  },
  "transitiveExternalRootEnvironment": { family: "m19-closure-flow", custody: "a8dc34ed",
    request: [2066,"sha256:c60167a16423b628a9026c41fb5f63d5bedbb1124a43967b7b9dfb06fc77bb73"],
    response: [4420,"sha256:4fd9db8ffb55ac075a866fab65f4ff7f9b29d8fe45abb38345e36bfb62044f1a"],
    original: [1706,"sha256:b78fdca5b757d2c587fc0ab08d3caa3c841120b8d8aa4534970660751eb33f7b"],
    provenance: [14960,"sha256:32776cdff6f98d27b4a9b482a363f69b3b58e6ce61ead9fd5bcd95be8c4bbcb7"],
    source: "export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; function middle(): bool { function helper(): bool { return selected(); } return helper(); } return middle(); }",
  },
  "externalAndFactoryActivations": { family: "m19-closure-flow", custody: "6bab7de3",
    request: [2170,"sha256:b879f81696578db65e7bfbec9ca0539f7d777bfb80bb20d452263e9a097113d0"],
    response: [7266,"sha256:6070acf1b5ea1c92993f7a186566f2d71ff0adc804967ae3969c6e882c61dc40"],
    original: [1810,"sha256:a4a06e70dd181b836fc2ed708ba2d1d5370c8a869eb75c635308c428dd1273fc"],
    provenance: [14759,"sha256:c47edea5f879298faf36d16fe710b3fa3272e1b3e9fc0e3267c00bac8ea5926d"],
    source: "export function entry(external: () => bool, seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } function make(fn: () => bool): () => bool { function invoke(): bool { return fn(); } return invoke; } const left = make(first); const right = make(other); return external() && left() && right(); }",
  },
  "calleeBeforeArgumentRebind": { family: "m19-closure-flow", custody: "6bab7de3",
    request: [2056,"sha256:a0bcf4a037044833eace9b3c3c957ada49a413b2c1dbe64ee796018eb04f67ec"],
    response: [5075,"sha256:e0265942a058eaf3b7415aa0e5d8980ba1bbadb5d6edc079acf0230e537fa53a"],
    original: [1696,"sha256:6a71bd2de757784fc5d026976d5eab8b70015102bf50135b0cad6efa4c10ee1d"],
    provenance: [14753,"sha256:523706e8b6b20fe59f9eb70c1e59f7e163f945aa6f11de1074afb27e08fe13f1"],
    source: "export function entry(seed: bool): bool { function first(leftValue: bool): bool { return leftValue; } function other(rightValue: bool): bool { return !rightValue; } let selected: (argument: bool) => bool = first; return selected((selected = other)(seed)); }",
  },
  "different-parents": { family: "m19-closure-identities", custody: "d954555a",
    request: [2149,"sha256:40b53b00df7d36923557e1e1a5ef2876932078b409da7e597f178b93d54933d3"],
    response: [7063,"sha256:d89beeecc3d4c5b28e100f82ad56f9ec81683e5049ab90d2713e21200d3494a4"],
    original: [1789,"sha256:a4aa4cf887bf44afaf3db213cc8a12d5efffe35a33037dd0f8ace27ee90a4326"],
    provenance: [18003,"sha256:13bb963e6889182d34502c5470dea110060da000bfd0aa170b394789d54eb0e0"],
    source: "export function entry(seed: bool): bool { function left(input: bool): () => bool { function read(): bool { return input; } return read; } function right(input: bool): () => bool { function read(): bool { return !input; } return read; } const leftAlias = left(seed); const rightAlias = right(seed); return leftAlias() && rightAlias(); }",
  },
  "same-parent-blocks": { family: "m19-closure-identities", custody: "d954555a",
    request: [1969,"sha256:303a5e6253de45d935f91bf76fb568452c93ef0d31a7232ff0f3616e807d171a"],
    response: [2941,"sha256:4c3d7f5ae66f7a772dfbaa3cbad613328bfe4c85ff23b1c4019bc83a7bbeb433"],
    original: [1609,"sha256:cd5a4ef196185fd17b3c910ff52b6d9e20d0dc81e9c6d0c89a903642fc04d813"],
    provenance: [18005,"sha256:060f136d915941d25ca19ea8806a526c0e8934db1dd18fb50e0ad9b9069a0bef"],
    source: "export function entry(seed: bool): bool { if (seed) { function read(): bool { return seed; } return read(); } else { function read(): bool { return !seed; } return read(); } }",
  },
};
const one = values => { assert.equal(values.length, 1); return values[0]; };
const named = (functions, name, start = undefined) => one(functions.filter(fn => fn.name === name && (start === undefined || fn.range.start === start)));
const explicit = (context, fn) => one(context.program.functions.filter(item => item.id === fn.id));
const layoutFor = (context, fn) => one(context.program.environments.filter(item => item.owner === fn.id));
const activation = layout => ({ kind: "activationEnvironment", layout: layout.id });
const incoming = layout => ({ kind: "incomingEnvironment", layout: layout.id });
const sourceStatement = (fn, original) => one(fn.body.filter(item =>
  JSON.stringify(item.range ?? item.anchor?.range) === JSON.stringify(original.range)));
/** @param {any} value @param {(value: any) => void} visit */
function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}
// This file tests cold boundary rejection independently of the tracer test.
// Repeat only this small serializer; importing a test would register it twice.
/** @param {any} value @returns {string} */
function coldJson(value) {
  if (Array.isArray(value)) return "[" + value.map(coldJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ":" + coldJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
async function realCase(name) {
  const pin = cases[name], origin = custody[pin.custody];
  const directory = new URL("../fixtures/r03/" + pin.family + "/" + name + "/", import.meta.url);
  /** @type {Record<string, Buffer>} */
  const frames = {};
  for (const kind of ["request", "response", "original", "provenance"]) {
    frames[kind] = await readFile(new URL(kind + ".json", directory));
    assert.equal(frames[kind].length, pin[kind][0]);
    assert.equal(digest(frames[kind]), pin[kind][1]);
  }
  const metadata = JSON.parse(frames.provenance.toString("utf8"));
  assert.deepEqual(metadata.origin, { kind: "owned-go-response", producerBaseOid: origin.base,
    producerDirty: true, testedInputSetHash: origin.input,
    requestSha256: digest(frames.request), responseSha256: digest(frames.response) });
  assert.equal(metadata.execution.pid, origin.pid);
  assert.equal(metadata.execution.rawLogSha256 ?? metadata.execution.rawLog?.sha256, origin.log);
  assert.equal(metadata.deliveryOid, origin.delivery);
  for (const kind of ["request", "response", "original"]) {
    assert.equal(metadata.frames[kind].bytes, frames[kind].length);
    assert.equal(metadata.frames[kind].sha256, digest(frames[kind]));
  }
  const request = JSON.parse(frames.request.toString("utf8")), original = JSON.parse(frames.original.toString("utf8"));
  assert.deepEqual(request.files, original.files);
  assert.equal(request.rootFile, original.rootFile);
  assert.equal(request.files.find(file => file.path === request.rootFile).content, pin.source);
  const imported = await importCapturedFrontendResponse(frames.request, frames.response, metadata.origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  const before = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(before));
  assert.equal(printHir(verifyHir(hir)), before);
  const program = lowerClosureEnvironments(hir);
  assert.deepEqual(program.functions.map(fn => fn.id), hir.functions.map(fn => fn.id));
  for (const key of ["inputIdentity", "source", "sourceOrigin", "target", "types"]) assert.deepEqual(program[key], hir[key]);
  return { hir, program, before, entry: named(hir.functions, "entry") };
}
function roundTrip({ hir, program, before }) {
  assert.equal(program.hirHash, digest(Buffer.from(before)));
  walk(program, item => assert.ok(Object.isFrozen(item)));
  assert.deepEqual(verifyClosureEnvironments(program, hir), program);
  const bytes = printClosureEnvironments(program, hir), cold = readClosureEnvironments(Buffer.from(bytes), hir);
  assert.deepEqual(cold, program);
  walk(cold, item => assert.ok(Object.isFrozen(item)));
  assert.equal(printClosureEnvironments(cold, hir), bytes);
  assert.equal(printHir(hir), before);
}
function allocated(fn, original, layout, parent) {
  assert.deepEqual(fn.body[0], { kind: "allocateEnvironment", layout: layout.id, parent,
    anchor: { kind: "function-entry", range: original.definitionRange } });
  assert.equal(fn.body.filter(item => item.kind === "allocateEnvironment").length, 1);
}
function loaded(actual, binding, environment, original) {
  assert.deepEqual(actual, { kind: "environmentLoad", type: binding.type, range: original.range, binding: binding.id, environment });
}
function parameterInitialized(fn, parameter, environment) {
  const init = one(fn.body.filter(item => item.kind === "initializeEnvironment" && item.binding === parameter.id));
  assert.deepEqual(init, { kind: "initializeEnvironment", binding: parameter.id, environment,
    value: { kind: "reference", type: parameter.type, range: parameter.range, binding: parameter.id },
    anchor: { kind: "parameter", range: parameter.range } });
}
function rejectMutation(context, edit) {
  const changed = copy(context.program);
  edit(changed);
  assert.equal(changed.hirHash, context.program.hirHash);
  const forged = Buffer.from(coldJson(changed) + "\n");
  assert.throws(() => verifyClosureEnvironments(changed, context.hir), /** @param {any} error */ error =>
    /^r03-closure-environments-/.test(error.code) && error.phase === "lowering");
  assert.throws(() => readClosureEnvironments(forged, context.hir), /** @param {any} error */ error =>
    /^r03-closure-environments-/.test(error.code) && error.phase === "lowering");
}

test("captured callable writes share the original slot while a local alias keeps its copied closure value", async () => {
  const c = await realCase("sharedCallableWrites"), { entry } = c, high = explicit(c, entry), layout = layoutFor(c, entry);
  const selected = entry.body[2].binding, alias = entry.body[5].binding, seed = entry.parameters[0];
  const expectedSlots = [selected, seed].map(b => ({ binding: b.id, type: b.type, writable: b.writable }))
    .sort((a, b) => Buffer.from(a.binding).compare(Buffer.from(b.binding)));
  assert.deepEqual(layout.slots, expectedSlots);
  allocated(high, entry, layout, null);
  parameterInitialized(high, seed, activation(layout));
  const selectedInit = sourceStatement(high, entry.body[2]);
  assert.equal(selectedInit.kind, "initializeEnvironment");
  assert.equal(selectedInit.binding, selected.id);
  assert.deepEqual(selectedInit.environment, activation(layout));
  assert.equal(selectedInit.value.kind, "makeClosure");
  assert.equal(selectedInit.value.function, named(c.hir.functions, "first").id);
  assert.deepEqual(selectedInit.value.environment, activation(layout));
  const aliasInit = sourceStatement(high, entry.body[5]);
  assert.equal(aliasInit.kind, "local");
  assert.equal(aliasInit.binding, alias.id);
  loaded(aliasInit.initializer, selected, activation(layout), entry.body[5].initializer);
  for (const name of ["read", "write"]) {
    const fn = named(c.hir.functions, name), out = explicit(c, fn);
    assert.equal(fn.captures[0].binding, selected.id);
    assert.equal(out.activationEnvironment, null);
    assert.equal(out.lexicalEnvironment, layout.id);
    const returned = out.body.at(-1).value;
    assert.equal(returned.kind, "closureCall");
    loaded(returned.callee, selected, incoming(layout), fn.body.at(-1).value.callee);
  }
  const write = named(c.hir.functions, "write"), store = explicit(c, write).body[0];
  assert.equal(store.kind, "environmentStore");
  assert.deepEqual(store.target, { binding: selected.id, type: selected.type, range: write.body[0].target.range, environment: incoming(layout) });
  assert.deepEqual(store.value, write.body[0].value);
  const first = named(c.hir.functions, "first");
  loaded(explicit(c, first).body[0].value, seed, incoming(layout), first.body[0].value);
  const returned = sourceStatement(high, entry.body[7]).value;
  assert.deepEqual(returned.left.environment, activation(layout));
  assert.equal(returned.right.kind, "closureCall");
  assert.deepEqual(returned.right.callee, entry.body[7].value.right.callee);
  roundTrip(c);
});

for (const name of ["shared-mutable", "write-only"]) test(name + " uses one mutable scalar slot for reads and writes", async () => {
  const c = await realCase(name), { entry } = c, layout = layoutFor(c, entry), state = entry.body[0].binding;
  const high = explicit(c, entry), write = named(c.hir.functions, "write"), outWrite = explicit(c, write);
  assert.deepEqual(layout.slots, [{ binding: state.id, type: state.type, writable: true }]);
  allocated(high, entry, layout, null);
  const init = sourceStatement(high, entry.body[0]);
  assert.equal(init.kind, "initializeEnvironment");
  assert.equal(init.binding, state.id);
  assert.deepEqual(init.value, entry.body[0].initializer);
  assert.deepEqual(init.environment, activation(layout));
  assert.equal(outWrite.body[0].kind, "environmentStore");
  assert.deepEqual(outWrite.body[0].target, { binding: state.id, type: state.type, range: write.body[0].target.range, environment: incoming(layout) });
  assert.deepEqual(outWrite.body[0].value, write.body[0].value);
  if (name === "shared-mutable") {
    loaded(outWrite.body[1].value, state, incoming(layout), write.body[1].value);
    const read = named(c.hir.functions, "read");
    loaded(explicit(c, read).body[0].value, state, incoming(layout), read.body[0].value);
  } else {
    assert.deepEqual(write.captures, [{ binding: state.id, read: false, write: true }]);
    assert.deepEqual(outWrite.body[1], write.body[1]);
  }
  const call = sourceStatement(high, entry.body.at(-1)).value;
  assert.deepEqual(call.environment, activation(layout));
  roundTrip(c);
});

for (const name of ["ancestor", "transitiveExternalRootEnvironment"]) test(name + " forwards the ancestor environment through a middle without its own layout", async () => {
  const c = await realCase(name), { entry } = c, middle = named(c.hir.functions, "middle"), layout = layoutFor(c, entry);
  const leaf = named(c.hir.functions, name === "ancestor" ? "read" : "helper"), highMiddle = explicit(c, middle);
  assert.deepEqual(middle.captures, []);
  assert.equal(highMiddle.activationEnvironment, null);
  assert.equal(highMiddle.lexicalEnvironment, layout.id);
  assert.equal(highMiddle.body.some(item => item.kind === "allocateEnvironment"), false);
  const call = highMiddle.body[1].value;
  assert.equal(call.target, leaf.id);
  assert.deepEqual(call.environment, incoming(layout));
  const access = explicit(c, leaf).body[0].value, binding = one(c.program.bindings.filter(b => b.id === leaf.captures[0].binding));
  if (name === "ancestor") loaded(access, binding, incoming(layout), leaf.body[0].value);
  else {
    assert.equal(access.kind, "closureCall");
    loaded(access.callee, binding, incoming(layout), leaf.body[0].value.callee);
  }
  const entryCall = sourceStatement(explicit(c, entry), entry.body.at(-1)).value;
  assert.deepEqual(entryCall.environment, activation(layout));
  roundTrip(c);
});

test("two factory calls keep allocation at make entry with a parent environment and dynamic external callee", async () => {
  const c = await realCase("externalAndFactoryActivations"), { entry } = c, make = named(c.hir.functions, "make"), invoke = named(c.hir.functions, "invoke");
  const entryLayout = layoutFor(c, entry), makeLayout = layoutFor(c, make), out = explicit(c, make), highEntry = explicit(c, entry);
  assert.notEqual(entryLayout.id, makeLayout.id);
  assert.equal(makeLayout.parent, entryLayout.id);
  assert.equal(out.lexicalEnvironment, entryLayout.id);
  allocated(out, make, makeLayout, incoming(entryLayout));
  parameterInitialized(out, make.parameters[0], activation(makeLayout));
  assert.deepEqual(makeLayout.slots, [{ binding: make.parameters[0].id, type: make.parameters[0].type, writable: true }]);
  const returned = out.body.at(-1).value;
  assert.equal(returned.kind, "makeClosure");
  assert.equal(returned.function, invoke.id);
  assert.deepEqual(returned.environment, activation(makeLayout));
  loaded(explicit(c, invoke).body[0].value.callee, make.parameters[0], incoming(makeLayout), invoke.body[0].value.callee);
  for (const index of [3, 4]) {
    const call = sourceStatement(highEntry, entry.body[index]).initializer;
    assert.equal(call.target, make.id);
    assert.deepEqual(call.environment, activation(entryLayout));
    assert.equal(call.arguments[0].kind, "makeClosure");
    assert.deepEqual(call.arguments[0].environment, activation(entryLayout));
  }
  const result = sourceStatement(highEntry, entry.body[5]).value;
  assert.equal(result.left.left.kind, "closureCall");
  assert.deepEqual(result.left.left.callee, entry.body[5].value.left.left.callee);
  assert.equal(Object.hasOwn(result.left.left, "target"), false);
  assert.equal(result.left.right.kind, "closureCall");
  assert.equal(result.right.kind, "closureCall");
  assert.equal(c.program.environments.length, 2, "layouts describe code; allocation stays inside each activation's function body");
  roundTrip(c);
});

test("closureCall preserves the saved outer callee separately from its rebinding argument", async () => {
  const c = await realCase("calleeBeforeArgumentRebind"), { entry } = c;
  assert.deepEqual(c.program.environments, [], "selected is genuinely noncaptured in this source");
  const value = explicit(c, entry).body[3].value, original = entry.body[3].value;
  assert.equal(value.kind, "closureCall");
  assert.deepEqual(value.callee, original.callee);
  assert.equal(value.arguments.length, 1);
  const argument = value.arguments[0];
  assert.equal(argument.kind, "closureCall");
  assert.equal(argument.callee.kind, "group");
  assert.equal(argument.callee.operand.kind, "write");
  assert.deepEqual(argument.callee.operand.left, original.arguments[0].callee.operand.left);
  assert.equal(argument.callee.operand.operator, "=");
  assert.deepEqual(argument.callee.range, original.arguments[0].callee.range);
  assert.equal(argument.callee.operand.right.kind, "makeClosure");
  assert.equal(argument.callee.operand.right.function, named(c.hir.functions, "other").id);
  assert.equal(argument.callee.operand.right.environment, null);
  assert.deepEqual(argument.arguments, original.arguments[0].arguments);
  roundTrip(c);
});

test("same-name reads under different factories use distinct original slots and activation environments", async () => {
  const c = await realCase("different-parents"), reads = c.hir.functions.filter(fn => fn.name === "read");
  assert.equal(reads.length, 2);
  assert.notEqual(reads[0].id, reads[1].id);
  assert.equal(reads[0].signatureHash, reads[1].signatureHash);
  /** @type {[string, number][]} */
  const factories = [["left", 82], ["right", 179]];
  for (const [name, start] of factories) {
    const factory = named(c.hir.functions, name), read = named(c.hir.functions, "read", start), layout = layoutFor(c, factory);
    const high = explicit(c, factory), returned = high.body.at(-1).value;
    assert.equal(read.lexicalParent, factory.id);
    assert.equal(layout.parent, null);
    assert.deepEqual(layout.slots, [{ binding: factory.parameters[0].id, type: factory.parameters[0].type, writable: factory.parameters[0].writable }]);
    allocated(high, factory, layout, null);
    parameterInitialized(high, factory.parameters[0], activation(layout));
    assert.equal(returned.function, read.id);
    assert.deepEqual(returned.environment, activation(layout));
    const original = name === "left" ? read.body[0].value : read.body[0].value.operand;
    const value = name === "left" ? explicit(c, read).body[0].value : explicit(c, read).body[0].value.operand;
    loaded(value, factory.parameters[0], incoming(layout), original);
  }
  assert.equal(c.program.environments.length, 2);
  roundTrip(c);
});

test("same-parent sibling-scope read identities share the outer parameter environment without scope conflation", async () => {
  const c = await realCase("same-parent-blocks"), { entry } = c, layout = layoutFor(c, entry), high = explicit(c, entry);
  const thenRead = named(c.hir.functions, "read", 53), elseRead = named(c.hir.functions, "read", 116);
  assert.notEqual(thenRead.id, elseRead.id);
  assert.notEqual(thenRead.lexicalScope, elseRead.lexicalScope);
  assert.equal(thenRead.signatureHash, elseRead.signatureHash);
  assert.equal(thenRead.lexicalParent, entry.id);
  assert.equal(elseRead.lexicalParent, entry.id);
  parameterInitialized(high, entry.parameters[0], activation(layout));
  const branch = sourceStatement(high, entry.body[0]);
  for (const [arm, read] of [["thenBody", thenRead], ["elseBody", elseRead]]) {
    const call = branch[arm][0].body[1].value;
    assert.equal(call.target, read.id);
    assert.deepEqual(call.environment, activation(layout));
    assert.equal(explicit(c, read).lexicalEnvironment, layout.id);
  }
  loaded(explicit(c, thenRead).body[0].value, entry.parameters[0], incoming(layout), thenRead.body[0].value);
  loaded(explicit(c, elseRead).body[0].value.operand, entry.parameters[0], incoming(layout), elseRead.body[0].value.operand);
  assert.equal(c.program.environments.length, 1);
  roundTrip(c);
});

test("cold verification rejects changed environment parent, slot type, allocation position and required references", async () => {
  const c = await realCase("externalAndFactoryActivations"), make = named(c.hir.functions, "make"), entryLayout = layoutFor(c, c.entry);
  rejectMutation(c, p => { p.environments.find(e => e.owner === make.id).parent = null; });
  rejectMutation(c, p => { p.environments.find(e => e.owner === make.id).slots[0].type = c.entry.parameters[1].type; });
  rejectMutation(c, p => { p.environments.find(e => e.owner === make.id).slots = []; });
  rejectMutation(c, p => { const body = p.functions.find(f => f.id === make.id).body; body.push(body.shift()); });
  rejectMutation(c, p => { p.functions.find(f => f.id === make.id).body.at(-1).value.environment = null; });
  rejectMutation(c, p => { p.functions.find(f => f.id === make.id).body[0].parent = activation(entryLayout); });
  const callee = await realCase("calleeBeforeArgumentRebind");
  rejectMutation(callee, p => { delete p.functions.find(f => f.id === callee.entry.id).body[3].value.callee; });
  rejectMutation(callee, p => {
    const call = p.functions.find(f => f.id === callee.entry.id).body[3].value;
    [call.callee, call.arguments[0].callee] = [call.arguments[0].callee, call.callee];
  });
  assert.throws(() => verifyClosureEnvironments(c.program, callee.hir));
  assert.throws(() => readClosureEnvironments(Buffer.from(printClosureEnvironments(c.program, c.hir)), callee.hir));
});

test("cold reader rejects noncanonical, duplicate-key, non-I-JSON and over-budget inputs", async () => {
  const c = await realCase("shared-mutable"), bytes = printClosureEnvironments(c.program, c.hir);
  for (const invalid of [Buffer.from(" " + bytes), Buffer.from(bytes.slice(0, -1)),
    Buffer.from('{"environments":[],' + bytes.slice(1)), Buffer.from('{"source":"\ud800"}'), Buffer.from([0xc3, 0x28])]) {
    assert.throws(() => readClosureEnvironments(invalid, c.hir));
  }
  assert.throws(() => readClosureEnvironments(Buffer.alloc(8388609, 32), c.hir), /** @param {any} error */ error =>
    error.code === "r03-closure-environments-limit");
});

// These are valid original Source block/while activations, not malformed HIR.
const scopeFramePins = {
  "capturedBlockLocal": {
    request: [2029,"sha256:eb9308ad55f3bc6172e7e8884a862901e8a16f6016a66d7b2ddf05a617e812bc"],
    response: [3857,"sha256:6500153c45e3b98b015e0e78a1acb7002b3ecb31e6688e5ea8ec8638b1064479"],
    original: [1669,"sha256:32d0d1e5d71fea8026c599f544118d91e20b91f73e6fa060d1ea5b861eb779d6"],
    provenance: [15065,"sha256:e3eba9eb22414d859c2fe3d85229de7b26bcb1d9ad348708d09334e711ee512e"],
    source: "export function entry(seed: bool): bool { function fallback(): bool { return false; } let selected: () => bool = fallback; { const value: bool = seed; function read(): bool { return value; } selected = read; } return selected(); }",
  },
  "capturedLoopLocal": {
    request: [2083,"sha256:2e148a39faf41d1bb6cc4092989e48357cc6298422f727236df4da2f38b6fc96"],
    response: [4645,"sha256:8385e9cd23e7d0dd47ab29ab5243304667c6f323f5e4a9781371e89f2d0214e3"],
    original: [1723,"sha256:f4534adcc14a7bff6557024468a1d03dd9bb5ca242f8b010eea34927887e3d2c"],
    provenance: [15063,"sha256:3afc8bc612d182fe77d464c6a5c450f1dfab1a067e7bd18632531ef7c8f7ddb0"],
    source: "export function entry(seed: bool): bool { function fallback(): bool { return false; } let selected: () => bool = fallback; let again: bool = seed; while (again) { const value: bool = again; function read(): bool { return value; } selected = read; again = false; } return selected(); }",
  },
};
for (const name of ["capturedBlockLocal", "capturedLoopLocal"]) test(name + " rejects unsupported captured scope activation after valid public HIR", async () => {
  const pin = scopeFramePins[name], directory = new URL("../fixtures/r03/m19-closure-flow/" + name + "/", import.meta.url);
  /** @type {Record<string, Buffer>} */
  const frames = {};
  for (const kind of ["request", "response", "original", "provenance"]) {
    frames[kind] = await readFile(new URL(kind + ".json", directory));
    assert.equal(frames[kind].length, pin[kind][0]);
    assert.equal(digest(frames[kind]), pin[kind][1]);
  }
  const metadata = JSON.parse(frames.provenance.toString("utf8"));
  assert.deepEqual(metadata.origin, { kind: "owned-go-response",
    producerBaseOid: "4ceaa5079f29f3be54f55f31488f23078f242daf", producerDirty: true,
    testedInputSetHash: "sha256:ede3f8326ecc9abd5ba97530484d802da63eab34674654ce04d978458c4460c3",
    requestSha256: digest(frames.request), responseSha256: digest(frames.response) });
  assert.equal(metadata.deliveryOid, "3a9461a09934e5a932a5a51ad81bd53c9c2b00e7");
  assert.notEqual(metadata.deliveryOid, metadata.origin.producerBaseOid);
  assert.equal(metadata.execution.pid, 35208);
  assert.equal(metadata.testedInputs.length, 90);
  assert.equal(metadata.execution.rawLog.sha256, "454e4bd854affc530391e15036f6421e24c9cad1372cc1d99642c635b88e66a3");
  for (const kind of ["request", "response", "original"]) {
    assert.equal(metadata.frames[kind].bytes, frames[kind].length);
    assert.equal(metadata.frames[kind].sha256, digest(frames[kind]));
  }
  const request = JSON.parse(frames.request.toString("utf8")), original = JSON.parse(frames.original.toString("utf8"));
  assert.deepEqual(request.files, original.files);
  assert.equal(request.rootFile, original.rootFile);
  assert.equal(request.files.find(file => file.path === request.rootFile).content, pin.source);
  const imported = await importCapturedFrontendResponse(frames.request, frames.response, metadata.origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  const before = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(before));
  assert.deepEqual(verifyHir(hir), built.hir);
  assert.equal(printHir(hir), before);
  const entry = named(hir.functions, "entry"), read = named(hir.functions, "read");
  if (name === "capturedLoopLocal") assert.equal(entry.body[3].kind, "while");
  const block = name === "capturedBlockLocal" ? entry.body[2] : entry.body[3].body[0];
  assert.equal(block.kind, "block");
  assert.equal(block.body[0].kind, "local");
  const value = block.body[0].binding;
  assert.equal(value.name, "value");
  assert.equal(value.owner, entry.id);
  assert.notEqual(value.id, entry.parameters[0].id, "the captured slot is block value, not seed");
  assert.equal(entry.body.some(item => item.kind === "local" && item.binding.id === value.id), false);
  assert.equal(read.lexicalParent, entry.id);
  assert.deepEqual(read.captures, [{ binding: value.id, read: true, write: false }]);
  assert.equal(read.body[0].value.binding, value.id);
  assert.throws(() => lowerClosureEnvironments(hir), /** @param {any} error */ error => {
    assert.equal(error.code, "r03-d-capability");
    assert.equal(error.ruleId, "r01-ts-baseline");
    assert.equal(error.phase, "lowering");
    assert.deepEqual(error.primary, { source: hir.source.path, start: value.range.start, end: value.range.end, owner: entry.id, binding: value.id });
    return true;
  });
  assert.equal(printHir(hir), before, "finite capability rejection preserves the valid owned input");
});
