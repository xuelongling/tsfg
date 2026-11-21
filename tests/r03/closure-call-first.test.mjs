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

test("Snapshot materialization rejects malformed UTF-8 and preserves a genuine replacement character", async () => {
  const frames = await capturedFrames();
  const prepared = await prepareFrontendInput(JSON.parse(frames["request.json"].toString("utf8")), true);
  assert.equal(prepared.status, "ready");
  const diagnostic = { code: "source-diagnostic", primary: { sourceId: prepared.rootFile }, message: "中�" };
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
