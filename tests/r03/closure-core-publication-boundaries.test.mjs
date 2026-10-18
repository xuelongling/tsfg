// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifyHir, analyzeClosureCalls } from "../../compiler/hir.mjs";
import { lowerClosureEnvironments, verifyClosureEnvironments } from "../../compiler/closure-environments.mjs";
import { emitClosureCore } from "../../compiler/closure-core-emitter.mjs";

const first = JSON.parse(await readFile(new URL("./closure-core-publication-first.json", import.meta.url), "utf8"));
const oracle = JSON.parse(await readFile(new URL("./closure-core-publication-oracle.json", import.meta.url), "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const sha = value => "sha256:" + createHash("sha256").update(value).digest("hex");
/** @param {any} value @returns {string} */
function jcs(value) {
  return Array.isArray(value) ? "[" + value.map(jcs).join(",") + "]" : value && typeof value === "object"
    ? "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + jcs(value[k])).join(",") + "}" : JSON.stringify(value);
}
/** @param {() => unknown} action @param {any} expected */
function rejected(action, expected) {
  assert.throws(action, /** @param {any} error */ error => {
    assert.ok(error instanceof TypeError);
    assert.deepEqual({ name: error.name, message: error.message,
      ...Object.fromEntries(Object.keys(error).map(k => [k, error[k]])) }, expected);
    return true;
  });
}
/** @param {any} c */
function controls(c) {
  const hir = verifyHir(clone(c.hir));
  assert.deepEqual(hir, c.hir);
  const program = lowerClosureEnvironments(hir);
  assert.deepEqual(program, c.program);
  assert.deepEqual(verifyClosureEnvironments(clone(program), hir), c.program);
  return { hir, program, context: clone(c.context) };
}
/** Independent finite whole-string append expectation, not a Core parser. */
function appendProof(core, proof) {
  const at = core.indexOf("} {\n"); assert.ok(at > 0);
  return core.slice(0, at) + ", tsfg_core.closure_publication = " + JSON.stringify(jcs(proof)) + core.slice(at);
}
for (const c of oracle.positive) test("23c whole Core: " + c.name, () => {
  const { hir, program, context } = controls(c);
  const before = jcs({ hir, program, context });
  assert.deepEqual(analyzeClosureCalls(hir, context), c.analysis);
  assert.equal(emitClosureCore(program, hir), c.defaultCore);
  assert.equal(emitClosureCore(program, hir, undefined), c.defaultCore);
  assert.equal(emitClosureCore(program, hir, context), c.selectedCore);
  assert.equal(c.selectedCore, appendProof(c.defaultCore, c.proof));
  assert.equal(jcs({ hir, program, context }), before);
});
for (const c of oracle.metadataOnly) test("23c complete real-frame sites: " + c.name, () => {
  const { hir, program, context } = controls(c);
  assert.deepEqual(analyzeClosureCalls(hir, context), c.analysis);
  const oldCore = emitClosureCore(program, hir);
  // Complete independently frozen metadata, plus whole unchanged default bytes.
  // No new Source/VM/Core execution or independent default-body golden is claimed here.
  assert.equal(emitClosureCore(program, hir, context), appendProof(oldCore, c.proof));
  assert.equal(oldCore.includes("tsfg_core.closure_publication"), false);
});
for (const c of oracle.earlyErrors) test("23c early fixed bound: " + c.name, () => {
  const { hir, program, context } = controls(c);
  assert.deepEqual(analyzeClosureCalls(hir, context), c.analysis);
  assert.equal(emitClosureCore(program, hir), first.defaultCore);
  rejected(() => emitClosureCore(program, hir, context), c.error);
});
for (const c of oracle.unsupported) test("23c conservative refusal: " + c.name, () => {
  const { hir, program, context } = controls(c);
  // The complete 23b contract must succeed, isolating this consumer refusal.
  assert.doesNotThrow(() => analyzeClosureCalls(hir, context));
  assert.equal(typeof emitClosureCore(program, hir), "string");
  rejected(() => emitClosureCore(program, hir, context), c.error);
});

test("23c selected validates the precise new descriptor and preserves the old descriptor", async () => {
  const descriptor = JSON.parse(await readFile(new URL("../../contracts/core-closure-publication-candidate.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(descriptor, oracle.descriptor);
  const oldDescriptor = JSON.parse(await readFile(new URL("../../contracts/core-closure-candidate.schema.json", import.meta.url), "utf8"));
  assert.equal(sha(jcs(oldDescriptor)), first.oldSchemaHash);
  for (const c of oracle.positive) {
    assert.equal(c.proof.schemaHash, sha(jcs(descriptor)));
    assert.equal(c.proof.analysisHash, sha(jcs(c.analysis) + "\n"));
    assert.equal(c.proof.programHash, sha(jcs(c.program) + "\n"));
    assert.equal(c.proof.hirHash, sha(jcs(c.hir) + "\n"));
  }
});

test("23c underdeclared 23b upper errors propagate without lowering relabel", () => {
  const { hir, program } = controls(first);
  rejected(() => analyzeClosureCalls(hir, clone(oracle.forwarding.context)), oracle.forwarding.error);
  rejected(() => emitClosureCore(program, hir, clone(oracle.forwarding.context)), oracle.forwarding.error);
});

test("23c no supplied report, callback, initial mode or null context becomes an authority", () => {
  for (const context of [null, { ...clone(first.context), suppliedReport: clone(first.analysis) },
    { ...clone(first.context), callback: () => first.analysis }]) {
    rejected(() => emitClosureCore(clone(first.program), clone(first.hir), context), oracle.errors.input);
  }
  const context = clone(first.context); context.publication.mode = "initial";
  rejected(() => emitClosureCore(clone(first.program), clone(first.hir), context), oracle.errors.input);
});

for (const kind of ["accessor", "proxy", "cycle", "hole", "custom-prototype"]) test("23c unsafe complete selected context: " + kind, () => {
  let traps = 0; const context = clone(first.context);
  if (kind === "accessor") Object.defineProperty(context, "extra", { enumerable: true, get() { traps++; throw Error("getter invoked"); } });
  if (kind === "proxy") context.extra = new Proxy({}, { ownKeys() { traps++; throw Error("proxy invoked"); }, getPrototypeOf() { traps++; throw Error("proxy invoked"); } });
  if (kind === "cycle") context.extra = context;
  if (kind === "hole") context.extra = new Array(2);
  if (kind === "custom-prototype") context.extra = Object.create({ inherited: true });
  rejected(() => emitClosureCore(clone(first.program), clone(first.hir), context), oracle.errors.input);
  assert.equal(traps, 0);
});

for (const kind of ["depth", "tokens", "string", "bytes", "aliased-bytes"]) test("23c context JSON budget before mode/shape: " + kind, () => {
  const context = clone(first.context); context.publication.mode = "initial";
  if (kind === "depth") { let value = null; for (let i = 0; i < 130; i++) value = { child: value }; context.extra = value; }
  if (kind === "tokens") context.extra = new Array(200001).fill(null);
  if (kind === "string") context.extra = "x".repeat(1048577);
  if (kind === "bytes") context.extra = Array.from({ length: 10 }, () => "x".repeat(900000));
  if (kind === "aliased-bytes") { const shared = { value: "x".repeat(900000) }; context.extra = new Array(10).fill(shared); }
  rejected(() => emitClosureCore(clone(first.program), clone(first.hir), context), oracle.errors.limit);
});

test("23c tampered complete program sites remain rejected by the existing cold environment validator", () => {
  const c = oracle.positive[0], { hir, program, context } = controls(c);
  const stale = clone(program); stale.hirHash = "sha256:" + "0".repeat(64);
  const extra = clone(program); extra.functions[0].body.push(clone(extra.functions[0].body[4]));
  const missing = clone(program); missing.functions[0].body.splice(4, 1);
  for (const value of [stale, extra, missing]) {
    /** @type {any} */ let expected;
    try { verifyClosureEnvironments(value, hir); } catch (error) { expected = error; }
    assert.ok(expected instanceof TypeError);
    assert.match((/** @type {TypeError & {code: string}} */ (expected)).code, /^r03-closure-environments-(identity|program)$/);
    assert.throws(() => emitClosureCore(value, hir, context), /** @param {any} error */ error => {
      assert.equal(error.code, (/** @type {TypeError & {code: string}} */ (expected)).code); assert.equal(error.message, expected.message);
      assert.equal(error.phase, "lowering"); return true;
    });
  }
});
