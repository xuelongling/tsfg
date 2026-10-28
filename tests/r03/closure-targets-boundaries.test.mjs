// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importCapturedFrontendResponse, validateFrontendSnapshot } from "../../compiler/frontend.mjs";
import { buildHir, verifyHir, printHir, readHir } from "../../compiler/hir.mjs";
import { analyzeClosureTargets, verifyClosureTargets, printClosureTargets, readClosureTargets } from "../../compiler/closure-targets.mjs";

const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const sortIds = ids => [...ids].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
const finite = ids => ({ top: false, functions: sortIds(ids) });
const copy = value => JSON.parse(JSON.stringify(value));
// Literal identities pin the qualified public command frames, including custody.
const pins = {
  "transitiveExternalRootEnvironment": { family: "m19-closure-flow", frames: {
    request: [2066,"sha256:c60167a16423b628a9026c41fb5f63d5bedbb1124a43967b7b9dfb06fc77bb73"],
    response: [4420,"sha256:4fd9db8ffb55ac075a866fab65f4ff7f9b29d8fe45abb38345e36bfb62044f1a"],
    original: [1706,"sha256:b78fdca5b757d2c587fc0ab08d3caa3c841120b8d8aa4534970660751eb33f7b"],
    provenance: [14960,"sha256:32776cdff6f98d27b4a9b482a363f69b3b58e6ce61ead9fd5bcd95be8c4bbcb7"],
  } },
  "branchAndLoop": { family: "m19-closure-flow", frames: {
    request: [2157,"sha256:905a09e46609b3bc388eb9ecd1ea12a0f14d6ed2adb2dfed27c33809bc8f92d9"],
    response: [6009,"sha256:04cc5750818e82f993813fb77159794a7d7f3b29d3bf577047063d27c0b91f44"],
    original: [1797,"sha256:7b93b8a695d375988420f09bc3652c81cb8620562669e8038d6fe81cecaee991"],
    provenance: [14727,"sha256:f3a088e08e782a11cde9ac55ab58b882b5bed15250f03c8182bd2a9089ea573e"],
  } },
  "calleeBeforeArgumentRebind": { family: "m19-closure-flow", frames: {
    request: [2056,"sha256:a0bcf4a037044833eace9b3c3c957ada49a413b2c1dbe64ee796018eb04f67ec"],
    response: [5075,"sha256:e0265942a058eaf3b7415aa0e5d8980ba1bbadb5d6edc079acf0230e537fa53a"],
    original: [1696,"sha256:6a71bd2de757784fc5d026976d5eab8b70015102bf50135b0cad6efa4c10ee1d"],
    provenance: [14753,"sha256:523706e8b6b20fe59f9eb70c1e59f7e163f945aa6f11de1074afb27e08fe13f1"],
  } },
  "externalAndFactoryActivations": { family: "m19-closure-flow", frames: {
    request: [2170,"sha256:b879f81696578db65e7bfbec9ca0539f7d777bfb80bb20d452263e9a097113d0"],
    response: [7266,"sha256:6070acf1b5ea1c92993f7a186566f2d71ff0adc804967ae3969c6e882c61dc40"],
    original: [1810,"sha256:a4a06e70dd181b836fc2ed708ba2d1d5370c8a869eb75c635308c428dd1273fc"],
    provenance: [14759,"sha256:c47edea5f879298faf36d16fe710b3fa3272e1b3e9fc0e3267c00bac8ea5926d"],
  } },
  "mutualHigherOrder": { family: "m19-closure-flow", frames: {
    request: [2176,"sha256:e6eca442b51fcf31e9f5011e70ca057e4f7a2fffdd47d7ef3ad76e434f64558c"],
    response: [7686,"sha256:4323492f24dcdc147931bbaf9bd557e59182a7aef20f466e9083ff5dfbd6b36d"],
    original: [1816,"sha256:4e126e706f36da7cf16bcc40d6df24bd4b5550d6f37519357d38080f7eefbf9c"],
    provenance: [14735,"sha256:361a228dd99c4f0cd60f075571af683aaa2c89f307f4476fa5014ad6fe62161d"],
  } },
  "sharedCallableWrites": { family: "m19-closure-flow", frames: {
    request: [2160,"sha256:ddc69f9f4559bd27eec1b93a80bc47c62e2ca058ef0a95a2c62560a3c6473b47"],
    response: [6685,"sha256:1983a4e1d59f636c9dbc60391677106f9343f59f9beae23363bc7d174e623266"],
    original: [1800,"sha256:4db7ecbc4435619caed85a709e290375012d891d3411e74010ba22d5f10b1acf"],
    provenance: [14741,"sha256:002e3b58995ccfc3162c20c6a8272c25e8be81810710a1ecb9b9d036c4280cbc"],
  } },
  "alias-rebind": { family: "m19-closure-boundaries", frames: {
    request: [2076,"sha256:e6880436946c8a1619e097206c7b431b9f464eb4e866a6c2484cbf55014c5a52"],
    response: [5335,"sha256:8e2e0715cd92fcb91d701beaba18624184d2102d73a878151afa33cc975d3529"],
    original: [1716,"sha256:e3128cecf36b4468e57a6f3470e994c71f66c774743f3714e51e39169979a619"],
    provenance: [1646,"sha256:2ba9d1ae1ab66d54d8bc8537c9abf2edd4b496e6fa9c7f5879839a9021d0f403"],
  } },
  "computed-callee": { family: "m19-closure-boundaries", frames: {
    request: [1988,"sha256:7fa5cc6254b81aa1ec30cd221eebd816a781399c2284b49d0bbb78ec5a65261d"],
    response: [3649,"sha256:7b770238bf27ada10bc494d9abfd52bf15939056bbc2b25b0b6b732ba26aa7f2"],
    original: [1628,"sha256:c13670ba6808480712b9bfc369bc5847084f6b9c2b1cc22b7adc314aadeb0d84"],
    provenance: [1643,"sha256:397e2229f52a99155c6c597294c5e718f4c06677588a32579142bd55014589de"],
  } },
};
const sourcePrograms = {
  "transitiveExternalRootEnvironment": "export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; function middle(): bool { function helper(): bool { return selected(); } return helper(); } return middle(); }",
  "branchAndLoop": "export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; if (seed) { selected = other; } else { selected = first; } const before = selected(); let again: bool = seed; while (again) { selected = other; again = false; } return selected() && before; }",
  "calleeBeforeArgumentRebind": "export function entry(seed: bool): bool { function first(leftValue: bool): bool { return leftValue; } function other(rightValue: bool): bool { return !rightValue; } let selected: (argument: bool) => bool = first; return selected((selected = other)(seed)); }",
  "externalAndFactoryActivations": "export function entry(external: () => bool, seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } function make(fn: () => bool): () => bool { function invoke(): bool { return fn(); } return invoke; } const left = make(first); const right = make(other); return external() && left() && right(); }",
  "mutualHigherOrder": "export function entry(seed: bool): bool { function leaf(): bool { return seed; } function left(fn: () => bool, again: bool): () => bool { if (again) { return right(fn, false); } return fn; } function right(next: () => bool, again: bool): () => bool { if (again) { return left(next, false); } return next; } const selected = left(leaf, seed); return selected(); }",
  "sharedCallableWrites": "export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; function read(): bool { return selected(); } function write(next: () => bool): bool { selected = next; return selected(); } const alias = selected; write(other); return read() && alias(); }",
  "alias-rebind": "export function entry(seed: bool): bool { function first(): bool { return seed; } function other(): bool { return false; } let selected: () => bool = first; const alias = selected; selected = other; const snapshot = (selected = first); return alias() && snapshot(); }",
  "computed-callee": "export function entry(seed: bool): bool { function make(): () => bool { function read(): bool { return seed; } return read; } const value = make()(); return (make())() && value; }",
};
const booleanCounts = { transitiveExternalRootEnvironment: 1, branchAndLoop: 2, calleeBeforeArgumentRebind: 0,
  externalAndFactoryActivations: 1, mutualHigherOrder: 2, sharedCallableWrites: 1,
  "alias-rebind": 1, "computed-callee": 0 };
/** @param {any} value @param {(value: any) => void} visit */
function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}
/** @param {any} value */
function frozen(value) {
  walk(value, item => {
    assert.ok(Object.isFrozen(item));
    for (const key of Object.keys(item)) assert.equal(/snapshot|rawSource|frontendSource/i.test(key), false);
  });
}
const fnNamed = (hir, name) => {
  const found = hir.functions.filter(fn => fn.name === name);
  assert.equal(found.length, 1, "the real fixture has one declaration named " + name);
  return found[0];
};
const summary = (report, fn) => {
  const found = report.functions.filter(item => item.id === fn.id);
  assert.equal(found.length, 1);
  return found[0];
};
const atPath = (fn, path) => path.reduce((node, key) => node[key], fn);
function callAt(report, fn, path) {
  const found = report.calls.filter(call => call.function === fn.id
    && JSON.stringify(call.expressionPath) === JSON.stringify(path));
  assert.equal(found.length, 1, "one report entry at the actual expression path");
  const expression = atPath(fn, path);
  assert.ok(["call", "indirectCall"].includes(expression.kind));
  assert.deepEqual(found[0].range, expression.range);
  assert.equal(found[0].kind, expression.kind);
  return found[0];
}
function targetsAt(report, fn, path, ids) {
  assert.deepEqual(callAt(report, fn, path).targets, finite(ids));
}
async function realCase(name) {
  const pin = pins[name], directory = new URL("../fixtures/r03/" + pin.family + "/" + name + "/", import.meta.url);
  /** @type {Record<string, Buffer>} */
  const frames = {};
  for (const kind of ["request", "response", "original", "provenance"]) {
    const bytes = await readFile(new URL(kind + ".json", directory));
    assert.equal(bytes.length, pin.frames[kind][0]);
    assert.equal(digest(bytes), pin.frames[kind][1]);
    frames[kind] = bytes;
  }
  const metadata = JSON.parse(frames.provenance.toString("utf8"));
  for (const kind of ["request", "response", "original"]) {
    assert.equal(metadata.frames[kind].bytes, frames[kind].length);
    assert.equal(metadata.frames[kind].sha256, digest(frames[kind]));
  }
  assert.equal(metadata.origin.kind, "owned-go-response");
  assert.equal(metadata.origin.producerDirty, true);
  assert.equal(metadata.origin.requestSha256, digest(frames.request));
  assert.equal(metadata.origin.responseSha256, digest(frames.response));
  assert.equal(Object.hasOwn(metadata.origin, "binarySha256"), false);
  const flow = pin.family === "m19-closure-flow";
  if (name === "transitiveExternalRootEnvironment") {
    assert.equal(metadata.origin.producerBaseOid, "a8dc34ed0d7c96fe09070446b2e4e729dbad97b7");
    assert.equal(metadata.origin.testedInputSetHash, "sha256:0ae8c1010eaeee5162fb180bbaac3669a2812b7c98a4e255e33e37f1b5d6b965");
    assert.equal(metadata.execution.pid, 30716);
    assert.equal(metadata.testedInputs.length, 90);
    assert.equal(metadata.execution.rawLog.sha256, "aa2ea9d97a940f92648fa641af7d0d08ab85e78a6ccfeeeba8e78addac02c9a9");
    assert.equal(metadata.deliveryOid, null);
  } else {
    assert.equal(metadata.origin.producerBaseOid, flow
      ? "6bab7de3ed66f5e4ca913b8387d21d7b46748a2f" : "8d106b6768521c21b9ef4e7a69df023977d71b09");
    assert.equal(metadata.origin.testedInputSetHash, flow
      ? "sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"
      : "sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b");
    if (flow) {
      assert.equal(metadata.execution.pid, 36700);
      assert.equal(metadata.testedInputs.length, 89);
      assert.equal(metadata.execution.rawLog.sha256, "9e5594fedccd7ae2b281cb01afa71ee57f8ecfd5a9b47a197f8bf24d56c31630");
      assert.equal(metadata.deliveryOid, null);
    }
  }
  const input = JSON.parse(frames.request.toString("utf8")), original = JSON.parse(frames.original.toString("utf8"));
  assert.deepEqual(input.files, original.files);
  assert.equal(input.rootFile, original.rootFile);
  const source = input.files.find(file => file.path === input.rootFile).content;
  assert.equal(source, sourcePrograms[name]);
  const raw = JSON.parse(frames.response.toString("utf8")), literals = [];
  assert.equal(raw.status, "ok");
  walk(raw.functions, item => {
    if (item.kind === "boolean") {
      literals.push(item.boolean);
      assert.equal(item.boolean, false);
      assert.equal(source.slice(item.range.start, item.range.end).trim(), "false");
    }
  });
  assert.equal(literals.length, booleanCounts[name]);
  const imported = await importCapturedFrontendResponse(frames.request, frames.response, metadata.origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  const before = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(before));
  assert.equal(printHir(verifyHir(hir)), before);
  assert.deepEqual(hir.functions.map(fn => [fn.name, fn.range]), raw.functions.map(fn => [fn.name, fn.range]));
  for (const rawFn of raw.functions) {
    const fn = fnNamed(hir, rawFn.name);
    const parent = raw.functions.find(item => item.symbol === rawFn.lexicalParent);
    assert.equal(fn.lexicalParent, parent ? fnNamed(hir, parent.name).id : null);
    assert.equal(typeof fn.lexicalScope, "string");
  }
  const entry = fnNamed(hir, "entry"), report = analyzeClosureTargets(hir, [entry.id]);
  assert.equal(report.precision, "context-insensitive-may");
  assert.deepEqual(report.roots, [entry.id]);
  assert.equal(report.hirHash, digest(Buffer.from(before)));
  return { hir, entry, report, before };
}
function roundTrip({ hir, report, before }) {
  assert.deepEqual(Object.keys(report).sort(),
    ["format", "hirHash", "roots", "precision", "complete", "functions", "capturedBindings", "calls"].sort());
  frozen(report);
  assert.deepEqual(verifyClosureTargets(report, hir, report.roots), report);
  const bytes = printClosureTargets(report, hir, report.roots);
  const cold = readClosureTargets(Buffer.from(bytes), hir, report.roots);
  assert.deepEqual(cold, report);
  frozen(cold);
  assert.equal(printClosureTargets(cold, hir, report.roots), bytes);
  assert.equal(printHir(hir), before, "analysis and cold verification preserve every original callee and HIR byte");
}
function rejectsReport(report, hir, change) {
  const changed = copy(report);
  change(changed);
  assert.throws(() => verifyClosureTargets(changed, hir), /** @param {any} error */ error => /^r03-closure-targets-/.test(error.code));
  assert.throws(() => printClosureTargets(changed, hir));
}

test("noncaptured aliases retain copied targets across strong rebinding and assignment expressions", async () => {
  const context = await realCase("alias-rebind"), { hir, entry, report } = context;
  const first = fnNamed(hir, "first"), other = fnNamed(hir, "other");
  assert.equal(entry.body[3].initializer.binding, entry.body[2].binding.id);
  assert.equal(entry.body[4].value.target, other.id);
  assert.equal(entry.body[5].initializer.operand.right.target, first.id);
  assert.equal(entry.body[5].initializer.operand.left.binding, entry.body[2].binding.id);
  assert.equal(report.complete, true);
  targetsAt(report, entry, ["body", 6, "value", "left"], [first.id]);
  targetsAt(report, entry, ["body", 6, "value", "right"], [first.id]);
  assert.equal(report.calls.length, 2);
  assert.equal(report.functions.some(fn => fn.id === other.id), false, "declaration/signature does not manufacture reachability");
  assert.deepEqual(report.capturedBindings, []);
  roundTrip(context);
});

test("computed and parenthesized callee trees retain returned read targets and inner make calls", async () => {
  const context = await realCase("computed-callee"), { hir, entry, report } = context;
  const make = fnNamed(hir, "make"), read = fnNamed(hir, "read");
  assert.equal(read.lexicalParent, make.id);
  assert.equal(entry.body[1].initializer.callee.kind, "call");
  assert.equal(entry.body[2].value.left.callee.kind, "group");
  assert.equal(report.complete, true);
  assert.deepEqual(summary(report, make).returns, finite([read.id]));
  targetsAt(report, entry, ["body", 1, "initializer"], [read.id]);
  targetsAt(report, entry, ["body", 1, "initializer", "callee"], [make.id]);
  targetsAt(report, entry, ["body", 2, "value", "left"], [read.id]);
  targetsAt(report, entry, ["body", 2, "value", "left", "callee", "operand"], [make.id]);
  assert.equal(report.calls.length, 4);
  roundTrip(context);
});

test("shared callable capture uses its original binding and propagates weak writes through calls", async () => {
  const context = await realCase("sharedCallableWrites"), { hir, entry, report } = context;
  const first = fnNamed(hir, "first"), other = fnNamed(hir, "other"), read = fnNamed(hir, "read"), write = fnNamed(hir, "write");
  const binding = entry.body[2].binding.id, both = finite([first.id, other.id]);
  assert.equal(read.captures[0].binding, binding);
  assert.equal(write.captures[0].binding, binding);
  assert.equal(write.body[0].target.binding, binding);
  assert.equal(write.body[0].value.binding, write.parameters[0].id);
  assert.equal(report.complete, true);
  assert.deepEqual(report.capturedBindings, [{ binding, targets: both }]);
  assert.deepEqual(summary(report, write).parameters, [{ binding: write.parameters[0].id, targets: finite([other.id]) }]);
  for (const fn of [write, entry]) {
    const effect = summary(report, fn).writes.find(item => item.binding === binding);
    assert.ok(effect, "callee captured-write summary reaches its caller");
    assert.equal(effect.targets.top, false);
    assert.ok(effect.targets.functions.includes(other.id));
  }
  targetsAt(report, read, ["body", 0, "value"], [first.id, other.id]);
  targetsAt(report, write, ["body", 1, "value"], [first.id, other.id]);
  targetsAt(report, entry, ["body", 6, "value"], [write.id]);
  targetsAt(report, entry, ["body", 7, "value", "left"], [read.id]);
  const aliasTargets = callAt(report, entry, ["body", 7, "value", "right"]).targets;
  assert.equal(aliasTargets.top, false);
  assert.ok(aliasTargets.functions.includes(first.id));
  assert.ok(aliasTargets.functions.every(id => [first.id, other.id].includes(id)));
  assert.equal(report.calls.length, 5);
  rejectsReport(report, hir, changed => { summary(changed, write).writes = []; });
  rejectsReport(report, hir, changed => { changed.capturedBindings = []; });
  roundTrip(context);
});

test("if joins and while zero/back edges preserve both reachable targets", async () => {
  const context = await realCase("branchAndLoop"), { hir, entry, report } = context;
  const first = fnNamed(hir, "first"), other = fnNamed(hir, "other"), selected = entry.body[2].binding.id;
  assert.equal(entry.body[3].thenBody[0].body[0].target.binding, selected);
  assert.equal(entry.body[3].elseBody[0].body[0].target.binding, selected);
  assert.equal(entry.body[6].body[0].body[0].target.binding, selected);
  assert.equal(report.complete, true);
  targetsAt(report, entry, ["body", 4, "initializer"], [first.id, other.id]);
  targetsAt(report, entry, ["body", 7, "value", "left"], [first.id, other.id]);
  assert.equal(report.calls.length, 2);
  assert.deepEqual(report.capturedBindings, []);
  roundTrip(context);
});

test("callee is saved before a nested argument rebinds the same noncaptured slot", async () => {
  const context = await realCase("calleeBeforeArgumentRebind"), { hir, entry, report } = context;
  const first = fnNamed(hir, "first"), other = fnNamed(hir, "other"), outer = entry.body[3].value;
  assert.equal(outer.callee.binding, entry.body[2].binding.id);
  assert.equal(outer.arguments[0].callee.kind, "group");
  assert.equal(outer.arguments[0].callee.operand.kind, "write");
  assert.equal(outer.arguments[0].callee.operand.left.binding, outer.callee.binding);
  assert.equal(outer.arguments[0].callee.operand.right.target, other.id);
  assert.equal(report.complete, true);
  targetsAt(report, entry, ["body", 3, "value"], [first.id]);
  targetsAt(report, entry, ["body", 3, "value", "arguments", 0], [other.id]);
  assert.equal(report.calls.length, 2);
  roundTrip(context);
});

test("mutually recursive higher order parameters and returns reach the leaf without TOP", async () => {
  const context = await realCase("mutualHigherOrder"), { hir, entry, report } = context;
  const leaf = fnNamed(hir, "leaf"), left = fnNamed(hir, "left"), right = fnNamed(hir, "right");
  assert.equal(report.complete, true);
  for (const fn of [left, right]) {
    assert.deepEqual(summary(report, fn).parameters, [{ binding: fn.parameters[0].id, targets: finite([leaf.id]) }]);
    assert.deepEqual(summary(report, fn).returns, finite([leaf.id]));
    assert.equal(summary(report, fn).unknownEffects, false);
  }
  targetsAt(report, entry, ["body", 3, "initializer"], [left.id]);
  targetsAt(report, entry, ["body", 4, "value"], [leaf.id]);
  targetsAt(report, left, ["body", 0, "thenBody", 0, "body", 0, "value"], [right.id]);
  targetsAt(report, right, ["body", 0, "thenBody", 0, "body", 0, "value"], [left.id]);
  assert.equal(report.calls.length, 4);
  roundTrip(context);
});

test("external root callable remains TOP while factory activations share code and a captured callable slot", async () => {
  const context = await realCase("externalAndFactoryActivations"), { hir, entry, report } = context;
  const first = fnNamed(hir, "first"), other = fnNamed(hir, "other"), make = fnNamed(hir, "make"), invoke = fnNamed(hir, "invoke");
  const external = entry.parameters[0].id, captured = make.parameters[0].id;
  assert.equal(invoke.lexicalParent, make.id);
  assert.equal(invoke.captures[0].binding, captured);
  assert.equal(invoke.body[0].value.callee.binding, captured);
  assert.equal(report.complete, false);
  assert.deepEqual(summary(report, entry).parameters, [{ binding: external, targets: { top: true, functions: [] } }]);
  assert.equal(summary(report, entry).unknownEffects, true);
  const unknown = callAt(report, entry, ["body", 5, "value", "left", "left"]);
  assert.deepEqual(unknown.targets, { top: true, functions: [] }, "TOP is not an invented table of same-signature code");
  assert.deepEqual(summary(report, make).returns, finite([invoke.id]));
  for (const path of [["body", 3, "initializer"], ["body", 4, "initializer"]]) targetsAt(report, entry, path, [make.id]);
  for (const path of [["body", 5, "value", "left", "right"], ["body", 5, "value", "right"]]) targetsAt(report, entry, path, [invoke.id]);
  const slot = report.capturedBindings.find(item => item.binding === captured);
  assert.ok(slot);
  for (const id of [first.id, other.id]) assert.ok(slot.targets.functions.includes(id));
  const inner = callAt(report, invoke, ["body", 0, "value"]);
  for (const id of [first.id, other.id]) assert.ok(inner.targets.functions.includes(id));
  assert.equal(report.calls.length, 6);
  rejectsReport(report, hir, changed => { summary(changed, entry).parameters[0].targets = finite([first.id]); });
  rejectsReport(report, hir, changed => { callAt(changed, entry, unknown.expressionPath).targets = finite([first.id]); });
  rejectsReport(report, hir, changed => { summary(changed, entry).unknownEffects = false; });
  roundTrip(context);
});

test("cold reports reject omitted or forged targets, call sites, source identity and caller root replay", async () => {
  const context = await realCase("alias-rebind"), { hir, entry, report } = context;
  const first = fnNamed(hir, "first"), foreign = "sha256:" + "0".repeat(64);
  rejectsReport(report, hir, changed => { changed.calls[0].targets.functions = []; });
  rejectsReport(report, hir, changed => { changed.calls[0].targets.functions = [foreign]; });
  rejectsReport(report, hir, changed => { changed.calls[0].targets.functions = [entry.id]; });
  rejectsReport(report, hir, changed => { changed.calls.pop(); });
  rejectsReport(report, hir, changed => { changed.hirHash = foreign; });
  const different = await realCase("computed-callee");
  assert.throws(() => verifyClosureTargets(report, different.hir));
  const alteredSource = copy(hir);
  alteredSource.source.content += " ";
  alteredSource.source.hash = digest(Buffer.from(alteredSource.source.content));
  assert.throws(() => verifyClosureTargets(report, alteredSource));
  for (const roots of [[], [entry.id, entry.id], [foreign], [entry.parameters[0].id], null]) {
    assert.throws(() => analyzeClosureTargets(hir, roots));
  }
  const differentRoots = analyzeClosureTargets(hir, [first.id]);
  assert.deepEqual(verifyClosureTargets(differentRoots, hir), differentRoots, "two arguments validate the recorded assumption only");
  for (const action of [
    () => verifyClosureTargets(differentRoots, hir, [entry.id]),
    () => printClosureTargets(differentRoots, hir, [entry.id]),
    () => readClosureTargets(Buffer.from(printClosureTargets(differentRoots, hir)), hir, [entry.id]),
  ]) assert.throws(action, /** @param {any} error */ error => error.code === "r03-closure-targets-roots");
  const both = analyzeClosureTargets(hir, [first.id, entry.id]);
  assert.deepEqual(both.roots, sortIds([first.id, entry.id]));
  assert.deepEqual(verifyClosureTargets(both, hir, [entry.id, first.id]), both);
  roundTrip(context);
});

test("reader rejects noncanonical, duplicate-key, non-I-JSON and over-budget byte streams", async () => {
  const { hir, report } = await realCase("alias-rebind"), bytes = printClosureTargets(report, hir);
  for (const invalid of [
    Buffer.from(" " + bytes),
    Buffer.from(bytes.slice(0, -1)),
    Buffer.from('{"roots":[],' + bytes.slice(1)),
    Buffer.from('{"roots":["\ud800"]}'),
    Buffer.from([0xc3, 0x28]),
  ]) assert.throws(() => readClosureTargets(invalid, hir));
  assert.throws(() => readClosureTargets(Buffer.alloc(8388609, 32), hir), /** @param {any} error */ error => error.code === "r03-closure-targets-limit");
});

// Guard the real Source range overlap and omitted-else repairs at the public seam.
test("token-free call prefixes and omitted source else remain strict ownership and shape boundaries", async () => {
  const shared = await realCase("sharedCallableWrites"), branch = await realCase("branchAndLoop");
  assert.equal(shared.entry.body[7].value.left.range.start, 325);
  assert.equal(shared.entry.body[7].value.range.start, 326);
  assert.equal(sourcePrograms.sharedCallableWrites.slice(324, 325), "n", "crossing the allowed blank prefix enters return's token");
  assert.ok(Array.isArray(branch.entry.body[3].elseBody));
  assert.ok(sourcePrograms.branchAndLoop.includes("else { selected = first; }"));
  /** @param {string} name @param {(raw: any) => void} edit */
  async function rejectEditedResponse(name, edit) {
    const directory = new URL("../fixtures/r03/m19-closure-flow/" + name + "/", import.meta.url);
    const [request, response, provenance] = await Promise.all(
      ["request", "response", "provenance"].map(kind => readFile(new URL(kind + ".json", directory))));
    const raw = JSON.parse(response.toString("utf8"));
    edit(raw);
    const changedBytes = Buffer.from(JSON.stringify(raw));
    const origin = { ...JSON.parse(provenance.toString("utf8")).origin, responseSha256: digest(changedBytes) };
    const imported = await importCapturedFrontendResponse(request, changedBytes, origin);
    assert.notEqual(imported.status, "ok", "repaired frame digest cannot authorize invalid range or else shape");
    assert.equal(Object.hasOwn(imported, "snapshot"), false);
  }
  await rejectEditedResponse("sharedCallableWrites", raw => {
    const entry = raw.functions.find(fn => fn.name === "entry");
    entry.body[7].expression.left.range.start = 324;
  });
  await rejectEditedResponse("branchAndLoop", raw => {
    const entry = raw.functions.find(fn => fn.name === "entry");
    assert.ok(Array.isArray(entry.body[3].elseBody));
    delete entry.body[3].elseBody;
  });
  await rejectEditedResponse("branchAndLoop", raw => {
    const entry = raw.functions.find(fn => fn.name === "entry");
    entry.body[3].elseBody = null;
  });
  const mutual = await realCase("mutualHigherOrder"), left = fnNamed(mutual.hir, "left");
  assert.deepEqual(left.body[0].elseBody, [], "genuine absent source else has a normalized owned HIR field");
  const changedHir = copy(mutual.hir);
  delete fnNamed(changedHir, "left").body[0].elseBody;
  assert.throws(() => verifyHir(changedHir));
  const canonicalMissingField = printHir(mutual.hir).replace('"elseBody":[],', "");
  assert.notEqual(canonicalMissingField, printHir(mutual.hir));
  assert.throws(() => readHir(Buffer.from(canonicalMissingField)));
  for (const context of [shared, branch, mutual]) roundTrip(context);
});

test("explicit null caller roots are invalid while only undefined uses recorded roots", async () => {
  const { hir, report } = await realCase("alias-rebind");
  const bytes = printClosureTargets(report, hir);
  assert.deepEqual(verifyClosureTargets(report, hir, undefined), report);
  assert.equal(printClosureTargets(report, hir, undefined), bytes);
  assert.deepEqual(readClosureTargets(Buffer.from(bytes), hir, undefined), report);
  for (const action of [
    () => verifyClosureTargets(report, hir, null),
    () => printClosureTargets(report, hir, null),
    () => readClosureTargets(Buffer.from(bytes), hir, null),
  ]) assert.throws(action, /** @param {any} error */ error => error.code === "r03-closure-targets-roots");
});

test("an independent middle root propagates its unknown outer callable environment through a direct helper", async () => {
  const context = await realCase("transitiveExternalRootEnvironment"), { hir, entry, report } = context;
  const first = fnNamed(hir, "first"), middle = fnNamed(hir, "middle"), helper = fnNamed(hir, "helper");
  const selected = entry.body[2].binding.id;
  assert.equal(middle.lexicalParent, entry.id);
  assert.equal(helper.lexicalParent, middle.id);
  assert.deepEqual(middle.captures, [], "the external environment dependency is transitive");
  assert.deepEqual(helper.captures, [{ binding: selected, read: true, write: false }]);
  assert.equal(helper.body[0].value.callee.binding, selected);
  assert.equal(report.complete, true);
  assert.deepEqual(report.capturedBindings, [{ binding: selected, targets: finite([first.id]) }]);
  targetsAt(report, entry, ["body", 4, "value"], [middle.id]);
  targetsAt(report, middle, ["body", 1, "value"], [helper.id]);
  targetsAt(report, helper, ["body", 0, "value"], [first.id]);
  roundTrip(context);

  const roots = [entry.id, middle.id], external = analyzeClosureTargets(hir, roots);
  assert.deepEqual(external.roots, sortIds(roots));
  assert.equal(external.complete, false, "owner initialization cannot close a separate external middle activation");
  const slot = external.capturedBindings.find(item => item.binding === selected);
  assert.ok(slot);
  assert.equal(slot.targets.top, true);
  assert.equal(callAt(external, helper, ["body", 0, "value"]).targets.top, true);
  targetsAt(external, middle, ["body", 1, "value"], [helper.id]);
  const forged = copy(external);
  forged.capturedBindings.find(item => item.binding === selected).targets = finite([first.id]);
  callAt(forged, helper, ["body", 0, "value"]).targets = finite([first.id]);
  forged.complete = true;
  assert.throws(() => verifyClosureTargets(forged, hir, roots));
  assert.throws(() => printClosureTargets(forged, hir, roots));
  roundTrip({ ...context, report: external });
});
