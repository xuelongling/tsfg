// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as api from "../../compiler/hir.mjs";
import { analyzeClosureTargets } from "../../compiler/closure-targets.mjs";
import { importCapturedFrontendResponse } from "../../compiler/frontend.mjs";

const first = JSON.parse(await readFile(new URL("./closure-call-first.json", import.meta.url), "utf8"));
const oracle = JSON.parse(await readFile(new URL("./closure-call-oracle.json", import.meta.url), "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const jcs = value => Array.isArray(value) ? "[" + value.map(jcs).join(",") + "]"
  : value && typeof value === "object" ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + jcs(value[key])).join(",") + "}" : JSON.stringify(value);
const sha = value => "sha256:" + createHash("sha256").update(value).digest("hex");
function rejected(action, expected) {
  assert.throws(action, error => {
    assert.ok(error instanceof TypeError);
    assert.deepEqual({ name: error.name, message: error.message,
      ...Object.fromEntries(Object.keys(error).map(key => [key, error[key]])) }, expected);
    return true;
  });
}
function ownedFrozen(value, inputs, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  assert.equal(inputs.has(value), false, "report borrows no HIR/context object");
  assert.equal(seen.has(value), false, "each report position is independently owned");
  assert.ok(Object.isFrozen(value)); seen.add(value);
  for (const child of Object.values(value)) ownedFrozen(child, inputs, seen);
}
function objectSet(value, result = new Set()) {
  if (value && typeof value === "object" && !result.has(value)) {
    result.add(value); for (const child of Object.values(value)) objectSet(child, result);
  }
  return result;
}
const cases = new Map([["first", first], ...oracle.cases.map(c => [c.name, c])]);
for (const c of oracle.cases) test("23b whole: " + c.name, async () => {
  if (c.provenance?.fixture) {
    const frames = {};
    for (const pin of c.provenance.framePins) {
      const bytes = await readFile(new URL("../" + c.provenance.fixture.slice("tests/".length) + "/" + pin.name, import.meta.url));
      assert.equal(bytes.length, pin.bytes); assert.equal(sha(bytes), pin.sha256); frames[pin.name] = bytes;
    }
    const metadata = JSON.parse(frames["provenance.json"]);
    const imported = await importCapturedFrontendResponse(frames["request.json"], frames["response.json"], metadata.origin);
    assert.equal(imported.status, "ok", JSON.stringify(imported));
    const built = api.buildHir(imported.snapshot); assert.equal(built.status, "ok", JSON.stringify(built));
    assert.deepEqual(built.hir, c.hir);
  }
  const hir = api.verifyHir(clone(c.hir)), context = clone(c.context);
  assert.deepEqual(hir, c.hir);
  assert.deepEqual(analyzeClosureTargets(hir, context.roots), c.legacy);
  const report = api.analyzeClosureCalls(hir, context);
  assert.deepEqual(report, c.expected);
  ownedFrozen(report, objectSet(context, objectSet(hir)));
  assert.deepEqual(hir, c.hir); assert.deepEqual(context, c.context);
});
for (const c of oracle.semanticErrors) test("23b upper: " + c.name, () => {
  const fixture = cases.get(c.hirCase); assert.ok(fixture);
  rejected(() => api.analyzeClosureCalls(clone(fixture.hir), clone(c.context)), c.error);
});
for (const c of oracle.validationErrors) test("23b fixed table: " + c.name, () => {
  rejected(() => api.analyzeClosureCalls(clone(first.hir), clone(c.context)), c.error);
});

test("23b cold full report, explicit context and independently owned canonical roundtrip", () => {
  const hir = clone(first.hir), context = clone(first.context), expected = first.expected;
  const analyzed = api.analyzeClosureCalls(hir, context);
  const verified = api.verifyClosureCalls(clone(expected), hir, context);
  assert.deepEqual(verified, expected); ownedFrozen(verified, objectSet(context, objectSet(hir)));
  const bytes = api.printClosureCalls(clone(expected), hir, context);
  assert.equal(bytes, jcs(expected) + "\n");
  const read = api.readClosureCalls(Buffer.from(bytes), hir, context);
  assert.deepEqual(read, expected); ownedFrozen(read, objectSet(context, objectSet(hir)));
  context.publication.contracts.length = 0; hir.source.content = "changed caller data";
  assert.deepEqual(analyzed, expected); assert.deepEqual(read, expected);
});

test("23b cold operations all require caller context", () => {
  for (const action of [() => api.analyzeClosureCalls(first.hir),
    () => api.verifyClosureCalls(first.expected, first.hir),
    () => api.printClosureCalls(first.expected, first.hir),
    () => api.readClosureCalls(Buffer.from(jcs(first.expected) + "\n"), first.hir)]) rejected(action, oracle.errors.input);
});

test("23b supported whole-source body narrowing retains fixed table and effect upper", () => {
  const wide = cases.get("synthetic-return-writing-body"), narrow = cases.get("synthetic-return-narrow-body");
  assert.deepEqual(wide.context, narrow.context);
  assert.notEqual(wide.expected.hirHash, narrow.expected.hirHash);
  assert.notEqual(wide.expected.inputIdentity, narrow.expected.inputIdentity);
  assert.deepEqual(wide.expected.effectiveTargets.calls.map(c => c.targets), narrow.expected.effectiveTargets.calls.map(c => c.targets));
  const before = api.analyzeClosureCalls(clone(wide.hir), clone(wide.context));
  const after = api.analyzeClosureCalls(clone(narrow.hir), clone(wide.context));
  assert.deepEqual(before, wide.expected); assert.deepEqual(after, narrow.expected);
  rejected(() => api.verifyClosureCalls(before, narrow.hir, wide.context), oracle.errors.identity);
});

test("23b cold verification recomputes every report facet", () => {
  const mutations = [r => { r.effectiveTargets.calls[0].targets.functions.pop(); },
    r => { r.derivedTargets.calls[0].targets.functions.pop(); }, r => { r.contracts.pop(); },
    r => { r.effects[0].effective.unknown = true; }, r => { r.dependencies[0].callees.pop(); },
    r => { r.effectiveTargets.complete = false; }, r => { r.publishedDigest = "sha256:" + "0".repeat(64); }];
  for (const mutate of mutations) {
    const report = clone(first.expected); mutate(report);
    rejected(() => api.verifyClosureCalls(report, first.hir, first.context), oracle.errors.report);
  }
});

test("23b reader requires strict I-JSON and exact JCS plus one LF", () => {
  const canonical = jcs(first.expected) + "\n";
  for (const text of [JSON.stringify(first.expected, null, 2) + "\n", canonical.trimEnd(), canonical + "\n", "\ufeff" + canonical])
    rejected(() => api.readClosureCalls(Buffer.from(text), first.hir, first.context), oracle.errors.canonical);
  for (const bytes of [Buffer.from("{"), Buffer.from('{"roots":[],"roots":[]}\n'),
    Buffer.from('{"x":"\\ud800"}\n'), Buffer.from([0xc3, 0x28])])
    rejected(() => api.readClosureCalls(bytes, first.hir, first.context), oracle.errors.input);
});

for (const graph of ["accessor", "proxy", "cycle", "hole", "custom-prototype"]) test("23b unsafe complete context: " + graph, () => {
  let traps = 0; const context = clone(first.context);
  if (graph === "accessor") Object.defineProperty(context, "extra", { enumerable: true, get() { traps++; throw Error("accessor invoked"); } });
  if (graph === "proxy") context.extra = new Proxy({}, { ownKeys() { traps++; throw Error("proxy invoked"); }, getPrototypeOf() { traps++; throw Error("proxy invoked"); } });
  if (graph === "cycle") context.extra = context;
  if (graph === "hole") context.extra = new Array(2);
  if (graph === "custom-prototype") context.extra = Object.create({ inherited: true });
  rejected(() => api.analyzeClosureCalls(first.hir, context), oracle.errors.input); assert.equal(traps, 0);
});

test("23b unsafe cold report graph is rejected without invoking an accessor", () => {
  let traps = 0; const report = clone(first.expected);
  Object.defineProperty(report, "extra", { enumerable: true, get() { traps++; throw Error("report accessor invoked"); } });
  rejected(() => api.verifyClosureCalls(report, first.hir, first.context), oracle.errors.input); assert.equal(traps, 0);
});

for (const kind of ["depth", "tokens", "string", "bytes", "aliased-bytes"]) test("23b context hard budget precedes mode dispatch: " + kind, () => {
  const context = clone(first.context); context.publication.mode = "initial";
  if (kind === "depth") { let value = null; for (let i = 0; i < 130; i++) value = { child: value }; context.extra = value; }
  if (kind === "tokens") context.extra = new Array(200001).fill(null);
  if (kind === "string") context.extra = "x".repeat(1048577);
  if (kind === "bytes") context.extra = Array.from({ length: 10 }, () => "x".repeat(900000));
  if (kind === "aliased-bytes") { const shared = { value: "x".repeat(900000) }; context.extra = new Array(10).fill(shared); }
  rejected(() => api.analyzeClosureCalls(first.hir, context), oracle.errors.limit);
});

test("23b cold report hard budget precedes recomputation", () => {
  const report = clone(first.expected); report.extra = "x".repeat(1048577);
  rejected(() => api.verifyClosureCalls(report, first.hir, first.context), oracle.errors.limit);
  rejected(() => api.readClosureCalls(Buffer.alloc(8388609, 32), first.hir, first.context), oracle.errors.limit);
});
