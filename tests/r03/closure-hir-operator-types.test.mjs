// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importCapturedFrontendResponse, validateFrontendSnapshot } from "../../compiler/frontend.mjs";
import { buildHir, verifyHir, printHir, readHir } from "../../compiler/hir.mjs";

const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const cases = {
  "same-parent-blocks": ["m19-closure-identities", "4c3d7f5ae66f7a772dfbaa3cbad613328bfe4c85ff23b1c4019bc83a7bbeb433"],
  "alias-rebind": ["m19-closure-boundaries", "8e2e0715cd92fcb91d701beaba18624184d2102d73a878151afa33cc975d3529"],
  "computed-callee": ["m19-closure-boundaries", "7b770238bf27ada10bc494d9abfd52bf15939056bbc2b25b0b6b732ba26aa7f2"],
  "shared-mutable": ["m19-closure-boundaries", "f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181"],
};
// This serializes corruption payloads. Baselines independently prove that these
// fixture values serialize exactly like public printHir before any mutation.
/** @param {any} value */
function json(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
/** @param {any} input */
function inputDigest(input) {
  return digest(json({ ...input, files: input.files.map(file => ({ path: file.path, content: file.content }))
    .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path))) }));
}
async function baseline(name) {
  const [family, responseHash] = cases[name];
  const directory = new URL("../fixtures/r03/" + family + "/" + name + "/", import.meta.url);
  const [requestBytes, responseBytes, originalBytes, provenanceBytes] = await Promise.all(
    ["request.json", "response.json", "original.json", "provenance.json"].map(file => readFile(new URL(file, directory))));
  const metadata = JSON.parse(provenanceBytes.toString("utf8"));
  for (const [kind, bytes] of Object.entries({ request: requestBytes, response: responseBytes, original: originalBytes })) {
    assert.equal(digest(bytes), metadata.frames[kind].sha256);
    assert.equal(bytes.length, metadata.frames[kind].bytes);
  }
  assert.equal(digest(responseBytes), "sha256:" + responseHash);
  assert.equal(digest(requestBytes), metadata.origin.requestSha256);
  assert.equal(digest(responseBytes), metadata.origin.responseSha256);
  const input = JSON.parse(requestBytes.toString("utf8")), original = JSON.parse(originalBytes.toString("utf8"));
  assert.deepEqual(original.files, input.files);
  assert.equal(original.rootFile, input.rootFile);
  const wire = JSON.parse(responseBytes.toString("utf8"));
  assert.equal(wire.status, "ok", "only actual qualified successful frames are baselines");
  const imported = await importCapturedFrontendResponse(requestBytes, responseBytes, metadata.origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  const hir = verifyHir(built.hir), canonical = printHir(hir), cold = readHir(Buffer.from(canonical));
  assert.deepEqual(cold, hir);
  assert.equal(printHir(cold), canonical);
  assert.equal(json(cold) + "\n", canonical);
  assert.equal(inputDigest(input), cold.inputIdentity, "the independent input repair starts from the real identity");
  return { input, wire, hir: cold };
}
const at = (functions, start, end) => {
  const selected = functions.filter(fn => fn.range.start === start && fn.range.end === end);
  assert.equal(selected.length, 1);
  return selected[0];
};
/** @param {any} state @param {number} start @param {string} before @param {string} after */
function replaceSource(state, start, before, after) {
  assert.equal(before.length, after.length, "negative source edits retain every subsequent source range");
  const source = state.hir.source.content;
  assert.equal(source.slice(start, start + before.length), before);
  state.hir.source.content = source.slice(0, start) + after + source.slice(start + before.length);
}
/** @param {any} state @param {any} baseline */
function repair(state, baseline) {
  assert.equal(state.hir.source.content.length, baseline.hir.source.content.length);
  assert.notEqual(state.hir.source.content, baseline.hir.source.content);
  const source = state.input.files.find(file => file.path === state.hir.source.path);
  source.content = state.hir.source.content;
  if (Object.hasOwn(source, "sha256")) source.sha256 = digest(source.content);
  state.hir.source.hash = digest(source.content);
  state.hir.inputIdentity = inputDigest(state.input);
  const requestBytes = Buffer.from(JSON.stringify(state.input)), responseBytes = Buffer.from(JSON.stringify(state.wire));
  state.hir.sourceOrigin.requestSha256 = digest(requestBytes);
  state.hir.sourceOrigin.responseSha256 = digest(responseBytes);
  return { requestBytes, responseBytes };
}
/** @param {() => any} action */
function rejection(action) {
  try { action(); return null; }
  catch (error) { return error.code ?? String(error); }
}
/** @param {any} actual @param {((state: any) => void)[]} mutations @param {string[]} categories */
async function rejectMutations(actual, mutations, categories) {
  const outcomes = [];
  for (const mutate of mutations) {
    const state = structuredClone(actual);
    mutate(state);
    const { requestBytes, responseBytes } = repair(state, actual);
    // Observe both cold boundaries before any assertion, including on RED.
    const verify = rejection(() => verifyHir(state.hir));
    const read = rejection(() => readHir(Buffer.from(json(state.hir) + "\n")));
    const imported = await importCapturedFrontendResponse(requestBytes, responseBytes, state.hir.sourceOrigin);
    outcomes.push({ verify, read, captured: imported.status === "error" ? imported.diagnostics[0]?.code : null });
  }
  for (const [index, observed] of outcomes.entries()) for (const [boundary, code] of Object.entries(observed)) {
    assert.ok(code !== null, "mutation " + index + " must be rejected by " + boundary);
    assert.ok(categories.includes(code), "semantic rejection expected at " + boundary + ", received " + code);
  }
}

// Rejection-only corruptions: no mutated program is admitted as a successful
// Source fact. These actual fixtures contain bool/callable values, not floats.
test("closure operator types reject numeric unary operators on bool", async () => {
  const actual = await baseline("same-parent-blocks");
  await rejectMutations(actual, ["+", "-", "~"].map(operator => state => {
    const high = at(state.hir.functions, 116, 156).body[0].value;
    const raw = at(state.wire.functions, 116, 156).body[0].expression;
    assert.equal(high.kind, "unary");
    assert.equal(high.operator, "!");
    replaceSource(state, high.range.start, "!", operator);
    high.operator = raw.operator = operator;
  }), ["r03-closure-type"]);
});

test("closure operator types reject bool arithmetic ordering and bitwise operands", async () => {
  const actual = await baseline("alias-rebind");
  await rejectMutations(actual, ["+", "<", "&"].map(operator => state => {
    const high = at(state.hir.functions, 0, 267).body[6].value;
    const raw = at(state.wire.functions, 0, 267).body[6].expression;
    const start = state.hir.source.content.indexOf("&&");
    assert.ok(start >= high.left.range.end && start + 2 <= high.right.range.start);
    replaceSource(state, start, "&&", operator + " ");
    high.kind = raw.kind = "binary";
    high.operator = raw.operator = operator;
  }), ["r03-closure-type"]);
});

test("closure operator types reject unary arithmetic on a callable value", async () => {
  const actual = await baseline("computed-callee");
  await rejectMutations(actual, [state => {
    const highReturn = at(state.hir.functions, 41, 125).body[1];
    const rawReturn = at(state.wire.functions, 41, 125).body[1];
    const high = highReturn.value, raw = rawReturn.expression;
    assert.equal(high.kind, "functionReference");
    replaceSource(state, high.range.start, " ", "+");
    const highOperand = structuredClone(high), rawOperand = structuredClone(raw);
    highOperand.range.start++; rawOperand.range.start++;
    highReturn.value = { kind: "unary", type: high.type, range: high.range, operator: "+", operand: highOperand };
    rawReturn.expression = { kind: "unary", type: raw.type, signature: raw.signature, range: raw.range, operator: "+", operand: rawOperand };
  }], ["r03-closure-type"]);
});

test("closure operation kind rejects strict equality labeled as short circuit", async () => {
  const actual = await baseline("alias-rebind");
  await rejectMutations(actual, [state => {
    const high = at(state.hir.functions, 0, 267).body[6].value;
    const raw = at(state.wire.functions, 0, 267).body[6].expression;
    const start = state.hir.source.content.indexOf("&&") - 1;
    assert.ok(start >= high.left.range.end);
    replaceSource(state, start, " &&", "===");
    assert.equal(high.kind, "shortCircuit");
    high.operator = raw.operator = "===";
  }], ["r03-closure-type", "r03-closure-precedence"]);
});

test("closure precedence rejects unary wrapping of an ungrouped short circuit", async () => {
  const actual = await baseline("alias-rebind");
  await rejectMutations(actual, [state => {
    const highReturn = at(state.hir.functions, 0, 267).body[6];
    const rawReturn = at(state.wire.functions, 0, 267).body[6];
    const high = highReturn.value, raw = rawReturn.expression, start = high.range.start - 1;
    assert.equal(high.kind, "shortCircuit");
    assert.equal(high.left.callee.range.start, start);
    replaceSource(state, start, " ", "!");
    // The former callee trivia now belongs to the outer unary operator.
    high.left.callee.range.start++; raw.left.callee.range.start++;
    highReturn.value = { kind: "unary", type: high.type, operator: "!", range: { start, end: high.range.end }, operand: high };
    rawReturn.expression = { kind: "unary", type: raw.type, operator: "!", range: { start, end: raw.range.end }, operand: raw };
  }], ["r03-closure-precedence", "r03-closure-type"]);
});

test("closure assignments reject a bool unary expression as the writable target", async () => {
  const actual = await baseline("shared-mutable");
  await rejectMutations(actual, [state => {
    const highAssignment = at(state.hir.functions, 65, 132).body[0];
    const rawAssignment = at(state.wire.functions, 65, 132).body[0];
    const high = highAssignment.target, raw = rawAssignment.target;
    assert.equal(high.kind, "reference");
    replaceSource(state, high.range.start, " ", "!");
    const highOperand = structuredClone(high), rawOperand = structuredClone(raw);
    highOperand.range.start++; rawOperand.range.start++;
    highAssignment.target = { kind: "unary", type: high.type, range: high.range, operator: "!", operand: highOperand };
    rawAssignment.target = { kind: "unary", type: raw.type, range: raw.range, operator: "!", operand: rawOperand };
  }], ["r03-closure-permission"]);
});
