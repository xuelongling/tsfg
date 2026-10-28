// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importCapturedFrontendResponse, validateFrontendSnapshot } from "../../compiler/frontend.mjs";
import { buildHir, verifyHir, printHir, readHir } from "../../compiler/hir.mjs";
import { lowerClosureEnvironments, verifyClosureEnvironments, printClosureEnvironments, readClosureEnvironments } from "../../compiler/closure-environments.mjs";

const fixture = new URL("../fixtures/r03/m19-function-values/", import.meta.url);
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
/** @param {any[]} functions @param {string} name @param {number} start @param {number} end */
function declaration(functions, name, start, end) {
  const found = functions.filter(fn => fn.name === name && fn.range.start === start && fn.range.end === end);
  assert.equal(found.length, 1, "one owned declaration at the original source range: " + name);
  return found[0];
}
/** @param {any} value */
function frozen(value) {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value), "all program containers are immutable");
  for (const [key, child] of Object.entries(value)) {
    assert.equal(/snapshot|rawSource|frontendSource/i.test(key), false);
    frozen(child);
  }
}
// Serialize only deliberately forged cold inputs, independently of the product
// printer that must refuse them. All keys/values here are ordinary JSON.
/** @param {any} value @returns {string} */
function coldJson(value) {
  if (Array.isArray(value)) return "[" + value.map(coldJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ":" + coldJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
}

// The unchanged official-oracle/public-command fixture was tested dirty at
// 8d106b; d954555 is its separate delivery identity, without an admitted EXE.
// Its source is the independent semantic witness: make(value) returns read,
// whose later value read must use that make activation's original binding slot.
test("real returned closure lowers to a fresh make environment, parameter slot initialization and read load", async () => {
  /** @type {[string, number, string][]} */
  const identities = [
    ["request.json", 2073, "sha256:1a8fdc95a48caaf4ceef02f291b7f18cffae12743e234072934b952f364efe33"],
    ["response.json", 5678, "sha256:f329aca7fdbcefea2eeca81317d00f04bb18447b03d243cf1a5593b631eb5b41"],
    ["original.json", 1713, "sha256:1748bb2bebfe1cac05a5a5b1ac2c6e28e457e56f3c57e9a0c426a75adf9b02a0"],
    ["provenance.json", 17306, "sha256:53875a3dd1b5171e7b50ac5650cc496d43332389f1cb9e7fef162a408b7facc9"],
  ];
  const frames = await Promise.all(identities.map(([name]) => readFile(new URL(name, fixture))));
  frames.forEach((bytes, index) => {
    assert.equal(bytes.length, identities[index][1]);
    assert.equal(digest(bytes), identities[index][2]);
  });
  const [request, response, original, provenance] = frames;
  const metadata = JSON.parse(provenance.toString("utf8"));
  assert.deepEqual(metadata.origin, {
    kind: "owned-go-response", producerBaseOid: "8d106b6768521c21b9ef4e7a69df023977d71b09", producerDirty: true,
    testedInputSetHash: "sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b",
    requestSha256: identities[0][2], responseSha256: identities[1][2],
  });
  assert.equal(metadata.deliveryOid, "d954555abfc9f0a9886fb28e81fdb18828a4a314");
  assert.notEqual(metadata.deliveryOid, metadata.origin.producerBaseOid);
  assert.equal(metadata.execution.rawLogSha256, "sha256:83978c2e439eb19832368d4894a004c6de599b2319f43d6f4d95e36eac910fd8");
  assert.equal(metadata.execution.summarySha256, "sha256:bd6c9602fe6f205afd6d51eda8605e046447608d8a1f9950c40e879ab2510772");
  assert.deepEqual(metadata.credit, { ownedGoResponse: true, sourceExecutable: false, admitted: false, executionAuthority: false });
  const input = JSON.parse(request.toString("utf8")), untouched = JSON.parse(original.toString("utf8"));
  assert.deepEqual(input.files, untouched.files);
  assert.equal(input.rootFile, untouched.rootFile);
  assert.equal(input.files.find(file => file.path === input.rootFile).content,
    "export function entry(seed: bool): bool { function make(value: bool): () => bool { function read(): bool { return value; } return read; } function invoke(fn: () => bool): bool { return fn(); } const selected = make(seed); const alias = selected; return invoke(alias); }");
  const raw = JSON.parse(response.toString("utf8"));
  assert.equal(raw.status, "ok");
  assert.deepEqual(raw.functions.map(fn => fn.name), ["entry", "make", "read", "invoke"]);
  const imported = await importCapturedFrontendResponse(request, response, metadata.origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  const before = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(before));
  assert.deepEqual(verifyHir(hir), built.hir);
  assert.equal(printHir(hir), before);
  const entry = declaration(hir.functions, "entry", 0, 269), make = declaration(hir.functions, "make", 41, 137);
  const read = declaration(hir.functions, "read", 82, 122), invoke = declaration(hir.functions, "invoke", 137, 192);
  assert.equal(make.lexicalParent, entry.id);
  assert.equal(read.lexicalParent, make.id);
  assert.equal(invoke.lexicalParent, entry.id);
  const value = make.parameters[0];
  assert.equal(value.name, "value");
  assert.equal(value.owner, make.id);
  assert.deepEqual(read.captures, [{ binding: value.id, read: true, write: false }]);
  assert.equal(read.body[0].value.kind, "reference");
  assert.equal(read.body[0].value.binding, value.id);
  assert.equal(make.body[1].value.kind, "functionReference");
  assert.equal(make.body[1].value.target, read.id);
  assert.equal(invoke.body[0].value.kind, "indirectCall");
  assert.equal(invoke.body[0].value.callee.binding, invoke.parameters[0].id);

  // The first new capability follows a fully valid, cold-verified genuine HIR.
  // An unimplemented capability must escape naturally and make this test RED.
  const program = lowerClosureEnvironments(hir);
  assert.deepEqual(Object.keys(program).sort(),
    ["format", "hirHash", "inputIdentity", "source", "sourceOrigin", "target", "types", "bindings", "environments", "functions"].sort());
  assert.deepEqual(program.format, { family: "tsfg.closure-environments-candidate", version: 1 });
  assert.equal(program.hirHash, digest(Buffer.from(before)));
  for (const key of ["inputIdentity", "source", "sourceOrigin", "target", "types"]) assert.deepEqual(program[key], hir[key]);
  assert.deepEqual(program.functions.map(fn => fn.id), hir.functions.map(fn => fn.id));
  assert.equal(program.environments.length, 1);
  const layout = program.environments[0];
  assert.deepEqual(Object.keys(layout).sort(), ["id", "owner", "parent", "slots"]);
  assert.match(layout.id, /^sha256:[0-9a-f]{64}$/);
  assert.equal(layout.owner, make.id);
  assert.equal(layout.parent, null);
  assert.deepEqual(layout.slots, [{ binding: value.id, type: value.type, writable: value.writable }]);
  const expectedBindings = [
    ...[entry, make, invoke].flatMap(fn => fn.parameters.map(parameter => ({ ...parameter, role: "parameter" }))),
    ...entry.body.filter(statement => statement.kind === "local").map(statement => ({ ...statement.binding, role: "local" })),
  ].sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
  assert.deepEqual(program.bindings, expectedBindings);
  const highMake = declaration(program.functions, "make", 41, 137), highRead = declaration(program.functions, "read", 82, 122);
  const highEntry = declaration(program.functions, "entry", 0, 269), highInvoke = declaration(program.functions, "invoke", 137, 192);
  for (const [source, lowered] of [[entry, highEntry], [make, highMake], [read, highRead], [invoke, highInvoke]]) {
    const { captures, body, parameters, ...identity } = source;
    const { body: explicitBody, ...explicitIdentity } = lowered;
    assert.deepEqual(explicitIdentity, { ...identity, parameters: parameters.map(parameter => parameter.id),
      lexicalEnvironment: source.id === read.id ? layout.id : null,
      activationEnvironment: source.id === make.id ? layout.id : null });
  }
  const activation = { kind: "activationEnvironment", layout: layout.id };
  const incoming = { kind: "incomingEnvironment", layout: layout.id };
  assert.deepEqual(highMake.body, [
    { kind: "allocateEnvironment", layout: layout.id, parent: null, anchor: { kind: "function-entry", range: make.definitionRange } },
    { kind: "initializeEnvironment", binding: value.id, environment: activation,
      value: { kind: "reference", type: value.type, range: value.range, binding: value.id },
      anchor: { kind: "parameter", range: value.range } },
    make.body[0],
    { ...make.body[1], value: { kind: "makeClosure", type: make.body[1].value.type, range: make.body[1].value.range,
      function: read.id, environment: activation } },
  ], "allocation executes at make entry and the returned closure receives this activation");
  assert.equal(highMake.body.filter(statement => statement.kind === "allocateEnvironment").length, 1);
  assert.deepEqual(highRead.body, [{ ...read.body[0], value: {
    kind: "environmentLoad", type: read.body[0].value.type, range: read.body[0].value.range,
    binding: value.id, environment: incoming,
  } }]);
  assert.deepEqual(highEntry.body, [entry.body[0], entry.body[1],
    { ...entry.body[2], binding: entry.body[2].binding.id, initializer: { ...entry.body[2].initializer, environment: null } },
    { ...entry.body[3], binding: entry.body[3].binding.id },
    { ...entry.body[4], value: { ...entry.body[4].value, environment: null } },
  ]);
  assert.deepEqual(highInvoke.body, [{ ...invoke.body[0], value: { ...invoke.body[0].value, kind: "closureCall" } }]);
  assert.equal(highEntry.body.some(statement => statement.kind === "allocateEnvironment"), false);
  frozen(program);
  assert.deepEqual(verifyClosureEnvironments(program, hir), program);
  const bytes = printClosureEnvironments(program, hir);
  assert.equal(typeof bytes, "string");
  assert.ok(bytes.endsWith("\n"));
  const cold = readClosureEnvironments(Buffer.from(bytes), hir);
  assert.deepEqual(cold, program);
  frozen(cold);
  assert.equal(printClosureEnvironments(cold, hir), bytes);

  // Genuine success remains unchanged. Both forged programs retain the correct
  // hirHash and valid canonical JSON, so rejection exercises cold semantics.
  for (const change of [
    changed => { changed.environments[0].slots[0].binding = "sha256:" + "f".repeat(64); },
    changed => { declaration(changed.functions, "make", 41, 137).body.shift(); },
  ]) {
    const changed = JSON.parse(bytes);
    change(changed);
    assert.equal(changed.hirHash, program.hirHash);
    const forged = Buffer.from(coldJson(changed) + "\n");
    assert.throws(() => verifyClosureEnvironments(changed, hir), /** @param {any} error */ error =>
      /^r03-closure-environments-/.test(error.code) && error.phase === "lowering");
    assert.throws(() => readClosureEnvironments(forged, hir), /** @param {any} error */ error =>
      /^r03-closure-environments-/.test(error.code) && error.phase === "lowering");
  }
  assert.equal(printHir(hir), before, "lowering and cold verification preserve every original HIR byte");
});
