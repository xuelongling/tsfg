// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as hirApi from "../../compiler/hir.mjs";
import { importCapturedFrontendResponse } from "../../compiler/frontend.mjs";
import { analyzeClosureTargets } from "../../compiler/closure-targets.mjs";

const oracle = JSON.parse(await readFile(new URL("./closure-call-first.json", import.meta.url), "utf8"));
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");

test("23b FIRST: real shared slot Published widening enters closure target propagation", async () => {
  const frames = {};
  for (const pin of oracle.provenance.framePins) {
    const bytes = await readFile(new URL("../fixtures/r03/m19-closure-flow/sharedCallableWrites/" + pin.name, import.meta.url));
    assert.equal(bytes.length, pin.bytes);
    assert.equal(digest(bytes), pin.sha256);
    frames[pin.name] = bytes;
  }
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
