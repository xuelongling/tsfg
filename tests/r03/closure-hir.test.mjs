// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importCapturedFrontendResponse, validateFrontendSnapshot, resolveSymbol } from "../../compiler/frontend.mjs";
import { buildHir, verifyHir, printHir, readHir } from "../../compiler/hir.mjs";

const fixture = new URL("../fixtures/r03/m19-function-values/", import.meta.url);
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const functionNamed = (functions, name) => {
  const matching = functions.filter(fn => fn.name === name);
  assert.equal(matching.length, 1, "the real first fixture has one declaration named " + name);
  return matching[0];
};

// These are the original public Go command frames, independently checked against
// official diagnostics, Symbols and resolved signatures in Source test 956.
// The delivered OID differs from the tested dirty base; neither admits an EXE.
test("real owned returned closure and callable parameter survive Frontend HIR cold round-trip", async () => {
  const [request, response, original, provenanceBytes] = await Promise.all(
    ["request.json", "response.json", "original.json", "provenance.json"].map(name => readFile(new URL(name, fixture))));
  assert.equal(digest(request), "sha256:1a8fdc95a48caaf4ceef02f291b7f18cffae12743e234072934b952f364efe33");
  assert.equal(digest(response), "sha256:f329aca7fdbcefea2eeca81317d00f04bb18447b03d243cf1a5593b631eb5b41");
  assert.equal(digest(original), "sha256:1748bb2bebfe1cac05a5a5b1ac2c6e28e457e56f3c57e9a0c426a75adf9b02a0");
  const { origin } = JSON.parse(provenanceBytes.toString("utf8"));
  assert.equal(origin.kind, "owned-go-response");
  assert.equal(origin.producerBaseOid, "8d106b6768521c21b9ef4e7a69df023977d71b09");
  assert.equal(origin.producerDirty, true);
  assert.match(origin.testedInputSetHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(origin, "binarySha256"), false);

  const imported = await importCapturedFrontendResponse(request, response, origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  const snapshot = imported.snapshot;
  validateFrontendSnapshot(snapshot);
  assert.equal(snapshot.format.family, "tsfg.frontend-closure-candidate");
  assert.deepEqual(snapshot.sourceOrigin, origin);
  assert.equal(Object.hasOwn(snapshot, "frontendSource"), false);
  assert.deepEqual(snapshot.functions.map(fn => fn.name), ["entry", "make", "read", "invoke"]);
  const entry = functionNamed(snapshot.functions, "entry"), make = functionNamed(snapshot.functions, "make");
  const read = functionNamed(snapshot.functions, "read"), invoke = functionNamed(snapshot.functions, "invoke");
  assert.equal(resolveSymbol(snapshot, make.lexicalParent).id, entry.symbol.id);
  assert.equal(resolveSymbol(snapshot, read.lexicalParent).id, make.symbol.id);
  assert.equal(resolveSymbol(snapshot, invoke.lexicalParent).id, entry.symbol.id);
  assert.equal(make.returnType, "function");
  assert.deepEqual(make.returnSignature, { parameters: [], returnType: "bool" });
  assert.equal(read.captures.length, 1);
  assert.equal(resolveSymbol(snapshot, read.captures[0].symbol).id, make.parameters[0].id);
  assert.deepEqual([read.captures[0].read, read.captures[0].write], [true, false]);
  for (const fn of [entry, make, invoke]) assert.equal((fn.captures ?? []).length, 0);
  const selectedStatement = entry.body[2], aliasStatement = entry.body[3];
  const selected = resolveSymbol(snapshot, selectedStatement.symbol.ref), alias = resolveSymbol(snapshot, aliasStatement.symbol.ref);
  const fn = resolveSymbol(snapshot, invoke.parameters[0].ref);
  assert.equal(new Set([selected.id, alias.id, fn.id, read.symbol.id]).size, 4);
  assert.equal(resolveSymbol(snapshot, selected.lexicalOwner).id, entry.symbol.id);
  assert.equal(resolveSymbol(snapshot, alias.lexicalOwner).id, entry.symbol.id);
  assert.equal(resolveSymbol(snapshot, fn.lexicalOwner).id, invoke.symbol.id);
  assert.equal(selectedStatement.initializer.kind, "call");
  assert.equal(selectedStatement.initializer.target.id, make.symbol.id);
  assert.equal(aliasStatement.initializer.kind, "reference");
  assert.equal(aliasStatement.initializer.symbol.id, selected.id);
  const indirect = invoke.body[0].expression;
  assert.equal(indirect.kind, "indirectCall");
  assert.equal(Object.hasOwn(indirect, "target"), false);
  assert.equal(indirect.callee.kind, "reference");
  assert.equal(indirect.callee.symbol.id, fn.id);
  assert.deepEqual(indirect.arguments, []);
  assert.deepEqual(indirect.signature, { parameters: [], returnType: "bool" });
  const returned = make.body[1].expression;
  assert.equal(returned.kind, "functionReference");
  assert.equal(returned.target.id, read.symbol.id);

  const built = buildHir(snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  const hir = verifyHir(built.hir);
  assert.equal(hir.functions.length, 4);
  assert.equal(new Set(hir.functions.map(fn => fn.id)).size, 4);
  const highEntry = functionNamed(hir.functions, "entry"), highMake = functionNamed(hir.functions, "make");
  const highRead = functionNamed(hir.functions, "read"), highInvoke = functionNamed(hir.functions, "invoke");
  assert.equal(highMake.lexicalParent, highEntry.id);
  assert.equal(highRead.lexicalParent, highMake.id);
  assert.equal(highInvoke.lexicalParent, highEntry.id);
  assert.equal(highRead.captures.length, 1);
  assert.equal(highRead.captures[0].binding, highMake.parameters[0].id);
  assert.deepEqual([highRead.captures[0].read, highRead.captures[0].write], [true, false]);
  assert.equal(highRead.body[0].value.binding, highMake.parameters[0].id);
  const highSelected = highEntry.body[2], highAlias = highEntry.body[3];
  assert.equal(new Set([highSelected.binding.id, highAlias.binding.id, highInvoke.parameters[0].id]).size, 3);
  assert.equal(highSelected.binding.owner, highEntry.id);
  assert.equal(highAlias.binding.owner, highEntry.id);
  assert.equal(highSelected.initializer.target, highMake.id);
  assert.equal(highAlias.initializer.binding, highSelected.binding.id);
  assert.equal(highMake.body[1].value.kind, "functionReference");
  assert.equal(highMake.body[1].value.target, highRead.id);
  const highIndirect = highInvoke.body[0].value;
  assert.equal(highIndirect.kind, "indirectCall");
  assert.equal(Object.hasOwn(highIndirect, "target"), false);
  assert.equal(highIndirect.callee.binding, highInvoke.parameters[0].id);
  assert.deepEqual(highIndirect.arguments, []);
  assert.equal(Object.hasOwn(hir, "snapshotId"), false);
  assert.ok(Object.isFrozen(hir));
  const bytes = Buffer.from(printHir(hir), "utf8");
  const cold = readHir(bytes);
  assert.deepEqual(verifyHir(cold), hir);
  assert.deepEqual(Buffer.from(printHir(cold), "utf8"), bytes);
});
