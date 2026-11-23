// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as hirApi from "../../compiler/hir.mjs";
import { importCapturedFrontendResponse } from "../../compiler/frontend.mjs";
import { materializeFrontendResponse, prepareFrontendInput } from "../../compiler/frontend-response.mjs";
import { analyzeClosureTargets } from "../../compiler/closure-targets.mjs";

const oracle = JSON.parse(await readFile(new URL("./closure-call-first.json", import.meta.url), "utf8"));
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");

async function capturedFrames() {
  const frames = {};
  for (const pin of oracle.provenance.framePins) {
    const bytes = await readFile(new URL("../fixtures/r03/m19-closure-flow/sharedCallableWrites/" + pin.name, import.meta.url));
    assert.equal(bytes.length, pin.bytes);
    assert.equal(digest(bytes), pin.sha256);
    frames[pin.name] = bytes;
  }
  return frames;
}

test("23b FIRST: real shared slot Published widening enters closure target propagation", async () => {
  const frames = await capturedFrames();
  const request = JSON.parse(frames["request.json"]);
  const original = JSON.parse(frames["original.json"]);
  assert.deepEqual(request.files, original.files);
  const provenance = JSON.parse(frames["provenance.json"]);
  assert.deepEqual(provenance.origin, oracle.hir.sourceOrigin);
  assert.equal(request.files.find(file => file.path === request.rootFile).content, oracle.hir.source.content);
  const imported = await importCapturedFrontendResponse(frames["request.json"], frames["response.json"], provenance.origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  const built = hirApi.buildHir(imported.snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  assert.deepEqual(built.hir, oracle.hir, "independent complete projection of the actual retained Go response");
  const hir = hirApi.verifyHir(JSON.parse(JSON.stringify(oracle.hir)));
  assert.deepEqual(hir, oracle.hir);
  assert.deepEqual(analyzeClosureTargets(hir, oracle.context.roots), oracle.legacy,
    "the complete existing target analysis passes before checking the new API");
  // BASE is missing this interface. Its FIRST failure earns API-gap credit only.
  assert.equal(typeof hirApi.analyzeClosureCalls, "function", "fixed Published closure-call API is required");
  assert.deepEqual(hirApi.analyzeClosureCalls(hir, oracle.context), oracle.expected);
});

test("Snapshot materialization treats the genuine response bytes as the retained response", async () => {
  const frames = await capturedFrames();
  const { origin } = JSON.parse(frames["provenance.json"].toString("utf8"));
  const prepared = await prepareFrontendInput(JSON.parse(frames["request.json"].toString("utf8")), true);
  assert.equal(prepared.status, "ready");
  prepared.captureRequest = frames["request.json"].toString("utf8");
  const accepted = await importCapturedFrontendResponse(frames["request.json"], frames["response.json"], origin);
  assert.equal(accepted.status, "ok");
  assert.deepEqual(materializeFrontendResponse(prepared, frames["response.json"], origin), accepted);
});

test("Snapshot materialization reports malformed response envelopes with the original input identity", async () => {
  const frames = await capturedFrames();
  const prepared = await prepareFrontendInput(JSON.parse(frames["request.json"].toString("utf8")), true);
  assert.equal(prepared.status, "ready");
  const expected = { status: "tool-error", inputIdentity: prepared.inputIdentity, message: "invalid frontend response" };
  for (const text of ["null", "[]", "false", "42", "\"text\""])
    assert.deepEqual(materializeFrontendResponse(prepared, Buffer.from(text), undefined), expected);
  const malformedDiagnostics = Buffer.from(JSON.stringify({ status: "error", diagnostics: [null] }));
  assert.deepEqual(materializeFrontendResponse(prepared, malformedDiagnostics, undefined),
    { status: "tool-error", inputIdentity: prepared.inputIdentity, message: "incomplete frontend diagnostics" });
});

test("Snapshot materialization rejects malformed successful response rows", async t => {
  const fixture = new URL("../fixtures/r03/m19-local-core-cases/afterIfInitializerCall/", import.meta.url);
  const [request, raw, receipt] = await Promise.all(["request.json", "response.json", "provenance.json"]
    .map(name => readFile(new URL(name, fixture))));
  const { origin } = JSON.parse(receipt.toString("utf8"));
  assert.equal(digest(request), origin.requestSha256);
  assert.equal(digest(raw), origin.responseSha256);
  const prepared = await prepareFrontendInput(JSON.parse(request.toString("utf8")), true);
  assert.equal(prepared.status, "ready");
  const transportOrigin = { kind: "retained-transport-fixture" };
  const retained = JSON.parse(raw.toString("utf8"));
  const fn = retained.functions[1], statement = fn.body[0];
  assert.equal(fn.name, "identity");
  // Project the retained ordinary scalar rows through the locked adapter shape.
  const response = { ...retained, functions: [fn], symbols: retained.symbols.filter(symbol =>
    symbol.id === fn.symbol || symbol.id === fn.parameters[0].id) };
  const accepted = materializeFrontendResponse(prepared, Buffer.from(JSON.stringify(response)), transportOrigin);
  assert.equal(accepted.status, "ok", JSON.stringify(accepted));
  assert.equal(accepted.snapshot.inputIdentity, prepared.inputIdentity);

  await t.test("successful response requires an empty diagnostics array when present", () => {
    const check = diagnostics => materializeFrontendResponse(prepared,
      Buffer.from(JSON.stringify({ ...response, diagnostics })), transportOrigin);
    for (const diagnostics of [undefined, null, []]) assert.deepEqual(check(diagnostics), accepted);
    for (const diagnostics of [{ length: 0 }, false, 0, "", [null]]) {
      assert.deepEqual(check(diagnostics), { status: "tool-error", inputIdentity: prepared.inputIdentity,
        message: "invalid frontend response status" });
    }
  });

  for (const { name, edits } of [
    { name: "null function", edits: { functions: [null] } },
    { name: "null symbol", edits: { symbols: [null] } },
    { name: "invalid function body", edits: { functions: [{ ...fn, body: {} }] } },
    { name: "null statement", edits: { functions: [{ ...fn, body: [null] }] } },
    { name: "invalid nested arguments", edits: { functions: [{ ...fn, body: [{ ...statement,
      expression: { ...statement.expression, arguments: {} } }] }] } },
    { name: "invalid nested statements", edits: { functions: [{ ...fn, body: [{ ...statement, body: [null] }] }] } },
    { name: "invalid initializer", edits: { functions: [{ ...fn, parameterInitializers: [false] }] } },
  ]) await t.test(name, () => {
    const malformed = Buffer.from(JSON.stringify({ ...response, ...edits }));
    assert.deepEqual(materializeFrontendResponse(prepared, malformed, transportOrigin),
      { status: "tool-error", inputIdentity: prepared.inputIdentity, message: "incomplete frontend response" });
  });
});

test("Snapshot diagnostics belong to the current input and carry matching UTF-16 locations", async t => {
  const frames = await capturedFrames();
  const request = JSON.parse(frames["request.json"].toString("utf8"));
  const prefix = "// 😀\r\n// 😺\u2028";
  const line = "export function bad(): i32 { return missing; }";
  const source = prefix + line;
  request.files.find(file => file.path === request.rootFile).content = source;
  const prepared = await prepareFrontendInput(request, true);
  assert.equal(prepared.status, "ready");
  const startColumn = line.indexOf("missing"), endColumn = startColumn + "missing".length;
  const range = { start: prefix.length + startColumn, end: prefix.length + endColumn };
  const diagnostic = {
    code: "r01-d-unresolved-name", file: request.rootFile, range,
    primary: { sourceId: request.rootFile, ...range, startLine: 2, startColumn, endLine: 2, endColumn },
  };
  const zero = { start: 0, end: 0 };
  const global = { code: "r02b-d-input", file: request.rootFile, range: zero,
    primary: { sourceId: request.rootFile, ...zero, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 } };
  const declaration = request.declarations.paths[0];
  const declarationDiagnostic = { ...global, file: declaration, primary: { ...global.primary, sourceId: declaration } };
  const eofRange = { start: source.length, end: source.length };
  const eof = { ...diagnostic, range: eofRange,
    primary: { ...diagnostic.primary, ...eofRange, startColumn: line.length, endColumn: line.length } };
  const check = (...diagnostics) => materializeFrontendResponse(prepared, JSON.stringify({ status: "error", diagnostics }), undefined);
  const valid = [diagnostic, declarationDiagnostic, global, eof];
  assert.deepEqual(check(...valid), { status: "error", inputIdentity: prepared.inputIdentity, diagnostics: valid });
  await t.test("the locked producer strips a leading BOM before computing positions", async () => {
    request.files.find(file => file.path === request.rootFile).content = "\uFEFF" + source;
    const withBom = await prepareFrontendInput(request, true);
    assert.equal(withBom.status, "ready");
    const response = JSON.stringify({ status: "error", diagnostics: valid });
    assert.deepEqual(materializeFrontendResponse(withBom, response, undefined),
      { status: "error", inputIdentity: withBom.inputIdentity, diagnostics: valid });
  });
  const foreign = "/elsewhere/other.ts";
  const reversed = { start: range.end, end: range.start };
  const overrun = { ...range, end: source.length + 1 };
  for (const { name, change } of [
    { name: "foreign source", change: { file: foreign, primary: { ...diagnostic.primary, sourceId: foreign } } },
    { name: "file disagrees with primary", change: { file: declaration } },
    { name: "reversed offsets", change: { range: reversed, primary: { ...diagnostic.primary, ...reversed } } },
    { name: "end past the source", change: { range: overrun, primary: { ...diagnostic.primary, ...overrun } } },
    { name: "range disagrees with primary", change: { range: zero } },
    { name: "missing end coordinate", change: { primary: { ...diagnostic.primary, endColumn: undefined } } },
    { name: "wrong line and column for offset", change: {
      primary: { ...diagnostic.primary, startLine: 1, startColumn: range.start - "// 😀\r\n".length },
    } },
    { name: "blank code", change: { code: " " } },
  ]) await t.test(name, () => {
    assert.deepEqual(check(diagnostic, { ...diagnostic, ...change }),
      { status: "tool-error", inputIdentity: prepared.inputIdentity, message: "incomplete frontend diagnostics" });
  });
});

test("Snapshot materialization rejects malformed UTF-8 and preserves a genuine replacement character", async () => {
  const frames = await capturedFrames();
  const prepared = await prepareFrontendInput(JSON.parse(frames["request.json"].toString("utf8")), true);
  assert.equal(prepared.status, "ready");
  const range = { start: 0, end: 0 };
  const diagnostic = { code: "source-diagnostic", file: prepared.rootFile, range, message: "中�",
    primary: { sourceId: prepared.rootFile, ...range, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 } };
  const valid = Buffer.from(JSON.stringify({ status: "error", diagnostics: [diagnostic] }));
  const replacement = Buffer.from("�");
  const offset = valid.indexOf(replacement);
  assert.ok(offset >= 0);
  const damaged = Buffer.concat([valid.subarray(0, offset), Buffer.from([0xff]), valid.subarray(offset + replacement.length)]);

  assert.deepEqual(materializeFrontendResponse(prepared, valid, undefined),
    { status: "error", inputIdentity: prepared.inputIdentity, diagnostics: [diagnostic] });
  assert.deepEqual(materializeFrontendResponse(prepared, damaged, undefined),
    { status: "tool-error", inputIdentity: prepared.inputIdentity, message: "invalid frontend response" });
});
