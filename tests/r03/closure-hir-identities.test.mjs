// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importCapturedFrontendResponse, validateFrontendSnapshot } from "../../compiler/frontend.mjs";
import { buildHir, verifyHir, printHir, readHir } from "../../compiler/hir.mjs";

const fixtures = new URL("../fixtures/r03/m19-closure-identities/", import.meta.url);
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const frameHashes = {
  "different-parents": ["40b53b00df7d36923557e1e1a5ef2876932078b409da7e597f178b93d54933d3",
    "d89beeecc3d4c5b28e100f82ad56f9ec81683e5049ab90d2713e21200d3494a4"],
  "same-parent-blocks": ["303a5e6253de45d935f91bf76fb568452c93ef0d31a7232ff0f3616e807d171a",
    "4c3d7f5ae66f7a772dfbaa3cbad613328bfe4c85ff23b1c4019bc83a7bbeb433"],
};
// This fixture family has a separate Source execution and input identity; keep
// its custody checks independent of the earlier boundary fixture helper.
/** @param {any} value */
function requiredPresence(value) {
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value, "presence")) {
    const descriptors = Array.isArray(value.presence) ? value.presence : [value.presence];
    if (Array.isArray(value.presence)) {
      assert.ok(Array.isArray(value.parameters));
      assert.equal(descriptors.length, value.parameters.length);
    }
    for (const descriptor of descriptors) {
      assert.ok(descriptor && typeof descriptor === "object" && !Array.isArray(descriptor));
      for (const key of ["undefined", "null", "optional", "default"]) {
        assert.equal(Object.hasOwn(descriptor, key), true);
        assert.equal(descriptor[key], false);
      }
    }
  }
  for (const child of Object.values(value)) requiredPresence(child);
}
async function identityCase(name) {
  const directory = new URL(name + "/", fixtures);
  const [request, response, original, provenance] = await Promise.all(
    ["request.json", "response.json", "original.json", "provenance.json"].map(file => readFile(new URL(file, directory))));
  const metadata = JSON.parse(provenance.toString("utf8"));
  assert.equal(digest(request), "sha256:" + frameHashes[name][0]);
  assert.equal(digest(response), "sha256:" + frameHashes[name][1]);
  for (const [kind, bytes] of Object.entries({ request, response, original })) {
    assert.equal(digest(bytes), metadata.frames[kind].sha256);
    assert.equal(bytes.length, metadata.frames[kind].bytes);
  }
  assert.equal(metadata.execution.rawLogSha256,
    "sha256:0d7cf423682c38b8f1938eb46faea3b49981cd9129cba15a1cab6b5384fce5af");
  assert.equal(metadata.execution.qualificationSha256,
    "sha256:929dbf97c186d3794b6f831c6d0583a951338b11baef60a9e3db65aec5c99393");
  assert.equal(metadata.origin.kind, "owned-go-response");
  assert.equal(metadata.origin.producerBaseOid, "d954555abfc9f0a9886fb28e81fdb18828a4a314");
  assert.equal(metadata.origin.producerDirty, true);
  assert.equal(metadata.origin.testedInputSetHash,
    "sha256:aae37af20ba12183962301aebfd78612965cd34d8ebefc2a2ede5df31a2caf21");
  assert.equal(metadata.deliveryOid, null);
  assert.equal(Object.hasOwn(metadata.origin, "binarySha256"), false);
  const input = JSON.parse(request.toString("utf8")), untouched = JSON.parse(original.toString("utf8"));
  assert.deepEqual(untouched.files, input.files);
  assert.equal(untouched.rootFile, input.rootFile);
  assert.equal(input.declarations.version, "minimal-integers-v3");
  assert.equal(digest(input.files.find(file => file.path === input.declarations.paths[0]).content),
    "sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e");
  const raw = JSON.parse(response.toString("utf8"));
  assert.equal(raw.status, "ok");
  requiredPresence(raw);
  const imported = await importCapturedFrontendResponse(request, response, metadata.origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  const hir = verifyHir(built.hir), canonical = printHir(hir), cold = readHir(Buffer.from(canonical));
  assert.deepEqual(cold, hir);
  assert.equal(printHir(cold), canonical);
  assert.deepEqual(cold.sourceOrigin, metadata.origin);
  assert.deepEqual(cold.format, { family: "tsfg.closure-hir-candidate", version: 1 });
  assert.ok(Object.isFrozen(cold));
  assert.equal(Object.hasOwn(cold, "snapshotId"), false);
  assert.deepEqual(cold.functions.map(fn => [fn.name, fn.range]), raw.functions.map(fn => [fn.name, fn.range]));
  return { snapshot: imported.snapshot, hir: cold, request, response, origin: metadata.origin };
}
const atRange = (functions, start, end) => {
  const found = functions.filter(fn => fn.range.start === start && fn.range.end === end);
  assert.equal(found.length, 1, "one declaration at its original source range");
  return found[0];
};

test("same-name closures under different lexical parents retain independent identities and captures", async () => {
  const { snapshot, hir } = await identityCase("different-parents");
  assert.deepEqual(snapshot.functions.map(fn => fn.name), ["entry", "left", "read", "right", "read"]);
  assert.equal(hir.functions.filter(fn => fn.name === "read").length, 2);
  const entry = atRange(hir.functions, 0, 335), left = atRange(hir.functions, 41, 137), right = atRange(hir.functions, 137, 235);
  const leftRead = atRange(hir.functions, 82, 122), rightRead = atRange(hir.functions, 179, 220);
  assert.deepEqual([leftRead.name, rightRead.name], ["read", "read"]);
  assert.notEqual(leftRead.id, rightRead.id);
  assert.equal(leftRead.signatureHash, rightRead.signatureHash);
  assert.equal(leftRead.lexicalParent, left.id);
  assert.equal(rightRead.lexicalParent, right.id);
  assert.notEqual(leftRead.lexicalParent, rightRead.lexicalParent);
  assert.notEqual(left.parameters[0].id, right.parameters[0].id);
  assert.deepEqual(leftRead.captures, [{ binding: left.parameters[0].id, read: true, write: false }]);
  assert.deepEqual(rightRead.captures, [{ binding: right.parameters[0].id, read: true, write: false }]);
  assert.equal(leftRead.body[0].value.binding, left.parameters[0].id);
  assert.equal(rightRead.body[0].value.kind, "unary");
  assert.equal(rightRead.body[0].value.operator, "!");
  assert.equal(rightRead.body[0].value.operand.binding, right.parameters[0].id);
  assert.equal(left.body[0].target, leftRead.id);
  assert.equal(right.body[0].target, rightRead.id);
  assert.equal(left.body[1].value.target, leftRead.id);
  assert.equal(right.body[1].value.target, rightRead.id);
  assert.equal(entry.body[2].initializer.target, left.id);
  assert.equal(entry.body[3].initializer.target, right.id);
  const combined = entry.body[4].value;
  assert.equal(combined.left.kind, "indirectCall");
  assert.equal(combined.right.kind, "indirectCall");
  assert.equal(combined.left.callee.binding, entry.body[2].binding.id);
  assert.equal(combined.right.callee.binding, entry.body[3].binding.id);
  for (const call of [combined.left, combined.right]) assert.equal(Object.hasOwn(call, "target"), false);
});

test("same-name closures in sibling blocks retain one parent and distinct lexical scope identities", async () => {
  const { snapshot, hir } = await identityCase("same-parent-blocks");
  assert.deepEqual(snapshot.functions.map(fn => fn.name), ["entry", "read", "read"]);
  assert.equal(hir.functions.filter(fn => fn.name === "read").length, 2);
  const entry = atRange(hir.functions, 0, 175), thenRead = atRange(hir.functions, 53, 92), elseRead = atRange(hir.functions, 116, 156);
  assert.deepEqual([thenRead.name, elseRead.name], ["read", "read"]);
  assert.notEqual(thenRead.id, elseRead.id);
  assert.equal(thenRead.signatureHash, elseRead.signatureHash);
  assert.equal(thenRead.lexicalParent, entry.id);
  assert.equal(elseRead.lexicalParent, entry.id);
  assert.notEqual(thenRead.lexicalScope, elseRead.lexicalScope);
  for (const reader of [thenRead, elseRead])
    assert.deepEqual(reader.captures, [{ binding: entry.parameters[0].id, read: true, write: false }]);
  assert.equal(thenRead.body[0].value.binding, entry.parameters[0].id);
  assert.equal(elseRead.body[0].value.kind, "unary");
  assert.equal(elseRead.body[0].value.operator, "!");
  assert.equal(elseRead.body[0].value.operand.binding, entry.parameters[0].id);
  const branch = entry.body[0], thenBlock = branch.thenBody[0], elseBlock = branch.elseBody[0];
  assert.equal(thenBlock.body[0].target, thenRead.id);
  assert.equal(elseBlock.body[0].target, elseRead.id);
  assert.equal(thenBlock.body[1].value.kind, "call");
  assert.equal(elseBlock.body[1].value.kind, "call");
  assert.equal(thenBlock.body[1].value.target, thenRead.id);
  assert.equal(elseBlock.body[1].value.target, elseRead.id);
});


test("captured same-parent closures reject a direct callee from the sibling block after digest repair", async () => {
  const { request, response, origin } = await identityCase("same-parent-blocks");
  const changed = JSON.parse(response.toString("utf8"));
  const entry = atRange(changed.functions, 0, 175);
  const thenRead = atRange(changed.functions, 53, 92), elseRead = atRange(changed.functions, 116, 156);
  assert.deepEqual([thenRead.name, elseRead.name], ["read", "read"]);
  assert.equal(thenRead.lexicalParent, elseRead.lexicalParent);
  const thenCall = entry.body[0].thenBody[0].body[1].expression;
  assert.equal(thenCall.target, thenRead.symbol, "the real baseline resolves within its own block");
  thenCall.target = elseRead.symbol;
  const responseBytes = Buffer.from(JSON.stringify(changed));
  const imported = await importCapturedFrontendResponse(request, responseBytes,
    { ...origin, responseSha256: digest(responseBytes) });
  assert.notEqual(imported.status, "ok", "same name, parent and signature cannot grant sibling-block visibility");
  assert.equal(Object.hasOwn(imported, "snapshot"), false);
});

test("cold HIR rejects a direct callee from a sibling block with the same name and parent", async () => {
  const { hir } = await identityCase("same-parent-blocks");
  // The cold baseline was parsed from canonical bytes: cloning and replacing
  // one string keeps property order, so read rejection cannot be formatting alone.
  assert.equal(JSON.stringify(hir) + "\n", printHir(hir));
  const changed = structuredClone(hir), entry = atRange(changed.functions, 0, 175);
  const thenRead = atRange(changed.functions, 53, 92), elseRead = atRange(changed.functions, 116, 156);
  assert.equal(thenRead.lexicalParent, elseRead.lexicalParent);
  assert.notEqual(thenRead.lexicalScope, elseRead.lexicalScope);
  assert.equal(thenRead.signatureHash, elseRead.signatureHash);
  const thenCall = entry.body[0].thenBody[0].body[1].value;
  assert.equal(thenCall.target, thenRead.id);
  thenCall.target = elseRead.id;
  assert.throws(() => verifyHir(changed));
  assert.throws(() => readHir(Buffer.from(JSON.stringify(changed) + "\n")));
});
