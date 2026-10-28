// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importCapturedFrontendResponse, validateFrontendSnapshot } from "../../compiler/frontend.mjs";
import { buildHir, verifyHir, printHir, readHir } from "../../compiler/hir.mjs";
import { analyzeClosureTargets, verifyClosureTargets, printClosureTargets, readClosureTargets } from "../../compiler/closure-targets.mjs";

const fixture = new URL("../fixtures/r03/m19-function-values/", import.meta.url);
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const byBytes = (left, right) => Buffer.from(left).compare(Buffer.from(right));
const finite = functions => ({ top: false, functions });
/** @param {any[]} functions @param {string} name @param {number} start @param {number} end */
function declaredFunction(functions, name, start, end) {
  const found = functions.filter(fn => fn.name === name && fn.range.start === start && fn.range.end === end);
  assert.equal(found.length, 1, "one owned declaration at the independently known source range: " + name);
  return found[0];
}
/** @param {any} value */
function assertOwnedFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value), "every report container is frozen");
  for (const [key, child] of Object.entries(value)) {
    assert.equal(/snapshot|rawSource|frontendSource/i.test(key), false, "no Frontend session or raw source field");
    assertOwnedFrozen(child);
  }
}

// The unchanged public Go frames came from Source test 956 against dirty 8d106b;
// d954555 is the separate delivery identity. No Source executable is admitted.
// The source program itself is the oracle: make returns read, selected is copied
// into alias, and invoke receives that alias before its indirect fn() call.
test("real returned closure flows through a local alias and callable parameter into an owned indirect target", async () => {
  /** @type {[string, number, string][]} */
  const frameIdentity = [
    ["request.json", 2073, "sha256:1a8fdc95a48caaf4ceef02f291b7f18cffae12743e234072934b952f364efe33"],
    ["response.json", 5678, "sha256:f329aca7fdbcefea2eeca81317d00f04bb18447b03d243cf1a5593b631eb5b41"],
    ["original.json", 1713, "sha256:1748bb2bebfe1cac05a5a5b1ac2c6e28e457e56f3c57e9a0c426a75adf9b02a0"],
    ["provenance.json", 17306, "sha256:53875a3dd1b5171e7b50ac5650cc496d43332389f1cb9e7fef162a408b7facc9"],
  ];
  const frames = await Promise.all(frameIdentity.map(([name]) => readFile(new URL(name, fixture))));
  frames.forEach((bytes, index) => {
    assert.equal(bytes.length, frameIdentity[index][1]);
    assert.equal(digest(bytes), frameIdentity[index][2]);
  });
  const [request, response, original, provenanceBytes] = frames;
  const metadata = JSON.parse(provenanceBytes.toString("utf8"));
  assert.deepEqual(metadata.origin, {
    kind: "owned-go-response",
    producerBaseOid: "8d106b6768521c21b9ef4e7a69df023977d71b09",
    producerDirty: true,
    testedInputSetHash: "sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b",
    requestSha256: frameIdentity[0][2], responseSha256: frameIdentity[1][2],
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
  const verified = verifyHir(built.hir), hirBytes = printHir(verified);
  const hir = readHir(Buffer.from(hirBytes, "utf8"));
  assert.deepEqual(verifyHir(hir), verified);
  assert.equal(printHir(hir), hirBytes);
  const entry = declaredFunction(hir.functions, "entry", 0, 269);
  const make = declaredFunction(hir.functions, "make", 41, 137);
  const read = declaredFunction(hir.functions, "read", 82, 122);
  const invoke = declaredFunction(hir.functions, "invoke", 137, 192);
  assert.equal(entry.lexicalParent, null);
  assert.equal(make.lexicalParent, entry.id);
  assert.equal(read.lexicalParent, make.id);
  assert.equal(invoke.lexicalParent, entry.id);
  assert.equal(new Set([entry.id, make.id, read.id, invoke.id]).size, 4);
  for (const fn of [entry, make, read, invoke]) assert.equal(typeof fn.lexicalScope, "string");
  const selected = entry.body[2], alias = entry.body[3], invokeCall = entry.body[4].value;
  assert.equal(selected.initializer.kind, "call");
  assert.equal(selected.initializer.target, make.id);
  assert.equal(alias.initializer.kind, "reference");
  assert.equal(alias.initializer.binding, selected.binding.id);
  assert.equal(invokeCall.kind, "call");
  assert.equal(invokeCall.target, invoke.id);
  assert.equal(invokeCall.arguments[0].binding, alias.binding.id);
  assert.equal(make.body[1].value.kind, "functionReference");
  assert.equal(make.body[1].value.target, read.id);
  assert.deepEqual(read.captures, [{ binding: make.parameters[0].id, read: true, write: false }]);
  const indirect = invoke.body[0].value;
  assert.equal(indirect.kind, "indirectCall");
  assert.equal(indirect.callee.kind, "reference");
  assert.equal(indirect.callee.binding, invoke.parameters[0].id);
  assert.equal(invoke.parameters[0].name, "fn");
  assert.equal(Object.hasOwn(indirect, "target"), false);
  assert.deepEqual(indirect.arguments, []);
  const originalCallee = JSON.stringify(indirect.callee);

  // This is the first new capability under test, after the genuine existing HIR
  // pipeline and all source/ownership facts above have already been checked.
  const report = analyzeClosureTargets(hir, [entry.id]);
  assert.deepEqual(Object.keys(report).sort(),
    ["format", "hirHash", "roots", "precision", "complete", "functions", "capturedBindings", "calls"].sort());
  assert.deepEqual(report.format, { family: "tsfg.closure-targets-candidate", version: 1 });
  assert.equal(report.hirHash, digest(Buffer.from(hirBytes, "utf8")));
  assert.deepEqual(report.roots, [entry.id]);
  assert.equal(report.precision, "context-insensitive-may");
  assert.equal(report.complete, true);
  assert.deepEqual(report.functions, [
    { id: entry.id, parameters: [], returns: null, writes: [], unknownEffects: false },
    { id: make.id, parameters: [], returns: finite([read.id]), writes: [], unknownEffects: false },
    { id: read.id, parameters: [], returns: null, writes: [], unknownEffects: false },
    { id: invoke.id, parameters: [{ binding: invoke.parameters[0].id, targets: finite([read.id]) }], returns: null, writes: [], unknownEffects: false },
  ].sort((left, right) => byBytes(left.id, right.id)));
  assert.deepEqual(report.capturedBindings, [], "the real capture is scalar, not a shared callable slot");
  assert.equal(report.calls.length, 3);
  for (const expected of [
    { function: entry.id, expressionPath: ["body", 2, "initializer"], range: { start: 209, end: 220 }, kind: "call", targets: finite([make.id]) },
    { function: entry.id, expressionPath: ["body", 4, "value"], range: { start: 252, end: 266 }, kind: "call", targets: finite([invoke.id]) },
    { function: invoke.id, expressionPath: ["body", 0, "value"], range: { start: 184, end: 189 }, kind: "indirectCall", targets: finite([read.id]) },
  ]) {
    const actual = report.calls.filter(call => call.function === expected.function
      && JSON.stringify(call.expressionPath) === JSON.stringify(expected.expressionPath));
    assert.equal(actual.length, 1, "one report entry per actual source call site");
    assert.deepEqual(actual[0], expected);
  }
  assertOwnedFrozen(report);
  assert.deepEqual(verifyClosureTargets(report, hir), report);
  const reportBytes = printClosureTargets(report, hir);
  assert.equal(typeof reportBytes, "string");
  const cold = readClosureTargets(Buffer.from(reportBytes, "utf8"), hir);
  assert.deepEqual(cold, report);
  assertOwnedFrozen(cold);
  assert.deepEqual(verifyClosureTargets(cold, hir), report);
  assert.equal(printClosureTargets(cold, hir), reportBytes);
  assert.equal(JSON.stringify(indirect.callee), originalCallee);
  assert.equal(indirect.kind, "indirectCall");
  assert.equal(Object.hasOwn(indirect, "target"), false);
  assert.equal(printHir(hir), hirBytes, "analysis and cold report verification preserve every owned HIR byte");
});

// The two real identity programs have their own original Source test 4272.
// Keep this loader local to that family; the tracer fixture above is untouched.
const identityFramePins = {
  "different-parents": {
    request: [2149,"sha256:40b53b00df7d36923557e1e1a5ef2876932078b409da7e597f178b93d54933d3"],
    response: [7063,"sha256:d89beeecc3d4c5b28e100f82ad56f9ec81683e5049ab90d2713e21200d3494a4"],
    original: [1789,"sha256:a4aa4cf887bf44afaf3db213cc8a12d5efffe35a33037dd0f8ace27ee90a4326"],
    provenance: [18003,"sha256:13bb963e6889182d34502c5470dea110060da000bfd0aa170b394789d54eb0e0"],
  },
  "same-parent-blocks": {
    request: [1969,"sha256:303a5e6253de45d935f91bf76fb568452c93ef0d31a7232ff0f3616e807d171a"],
    response: [2941,"sha256:4c3d7f5ae66f7a772dfbaa3cbad613328bfe4c85ff23b1c4019bc83a7bbeb433"],
    original: [1609,"sha256:cd5a4ef196185fd17b3c910ff52b6d9e20d0dc81e9c6d0c89a903642fc04d813"],
    provenance: [18005,"sha256:060f136d915941d25ca19ea8806a526c0e8934db1dd18fb50e0ad9b9069a0bef"],
  },
};
const identityPrograms = {
  "different-parents": "export function entry(seed: bool): bool { function left(input: bool): () => bool { function read(): bool { return input; } return read; } function right(input: bool): () => bool { function read(): bool { return !input; } return read; } const leftAlias = left(seed); const rightAlias = right(seed); return leftAlias() && rightAlias(); }",
  "same-parent-blocks": "export function entry(seed: bool): bool { if (seed) { function read(): bool { return seed; } return read(); } else { function read(): bool { return !seed; } return read(); } }",
};
async function identityTargetCase(name) {
  const directory = new URL("../fixtures/r03/m19-closure-identities/" + name + "/", import.meta.url);
  /** @type {Record<string, Buffer>} */
  const frames = {};
  for (const kind of ["request", "response", "original", "provenance"]) {
    const bytes = await readFile(new URL(kind + ".json", directory));
    assert.equal(bytes.length, identityFramePins[name][kind][0]);
    assert.equal(digest(bytes), identityFramePins[name][kind][1]);
    frames[kind] = bytes;
  }
  const metadata = JSON.parse(frames.provenance.toString("utf8"));
  assert.equal(metadata.origin.kind, "owned-go-response");
  assert.equal(metadata.origin.producerBaseOid, "d954555abfc9f0a9886fb28e81fdb18828a4a314");
  assert.equal(metadata.origin.producerDirty, true);
  assert.equal(metadata.origin.testedInputSetHash, "sha256:aae37af20ba12183962301aebfd78612965cd34d8ebefc2a2ede5df31a2caf21");
  assert.equal(metadata.origin.requestSha256, digest(frames.request));
  assert.equal(metadata.origin.responseSha256, digest(frames.response));
  assert.equal(metadata.deliveryOid, null);
  assert.equal(metadata.execution.pid, 4272);
  assert.equal(metadata.execution.rawLogSha256, "sha256:0d7cf423682c38b8f1938eb46faea3b49981cd9129cba15a1cab6b5384fce5af");
  assert.equal(metadata.execution.qualificationSha256, "sha256:929dbf97c186d3794b6f831c6d0583a951338b11baef60a9e3db65aec5c99393");
  assert.deepEqual(metadata.credit, { ownedGoResponse: true, sourceExecutable: false, admitted: false, executionAuthority: false });
  for (const kind of ["request", "response", "original"]) {
    assert.equal(metadata.frames[kind].bytes, frames[kind].length);
    assert.equal(metadata.frames[kind].sha256, digest(frames[kind]));
  }
  const request = JSON.parse(frames.request.toString("utf8")), original = JSON.parse(frames.original.toString("utf8"));
  assert.deepEqual(request.files, original.files);
  assert.equal(request.rootFile, original.rootFile);
  assert.equal(request.files.find(file => file.path === request.rootFile).content, identityPrograms[name]);
  const imported = await importCapturedFrontendResponse(frames.request, frames.response, metadata.origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  const before = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(before));
  assert.equal(printHir(verifyHir(hir)), before);
  assert.deepEqual(hir.sourceOrigin, metadata.origin);
  return { hir, before };
}
function identityCallTargets(report, fn, path, kind, target) {
  const expression = path.reduce((node, key) => node[key], fn);
  assert.equal(expression.kind, kind);
  if (kind === "indirectCall") assert.equal(Object.hasOwn(expression, "target"), false);
  const calls = report.calls.filter(call => call.function === fn.id
    && JSON.stringify(call.expressionPath) === JSON.stringify(path));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { function: fn.id, expressionPath: path, range: expression.range, kind, targets: finite([target.id]) });
}
function identityReportRoundTrip(hir, before, report, entry) {
  assert.equal(report.complete, true);
  assert.equal(report.precision, "context-insensitive-may");
  assert.equal(report.hirHash, digest(Buffer.from(before)));
  assert.deepEqual(report.roots, [entry.id]);
  assertOwnedFrozen(report);
  assert.deepEqual(verifyClosureTargets(report, hir, [entry.id]), report);
  const bytes = printClosureTargets(report, hir, [entry.id]);
  const cold = readClosureTargets(Buffer.from(bytes), hir, [entry.id]);
  assert.deepEqual(cold, report);
  assertOwnedFrozen(cold);
  assert.equal(printClosureTargets(cold, hir, [entry.id]), bytes);
  assert.equal(printHir(hir), before, "analysis and cold report checking preserve the original scope identities and callees");
}

test("same-name closures under different parents propagate to their own factory return and indirect call sites", async () => {
  const { hir, before } = await identityTargetCase("different-parents");
  const entry = declaredFunction(hir.functions, "entry", 0, 335);
  const left = declaredFunction(hir.functions, "left", 41, 137), right = declaredFunction(hir.functions, "right", 137, 235);
  const leftRead = declaredFunction(hir.functions, "read", 82, 122), rightRead = declaredFunction(hir.functions, "read", 179, 220);
  assert.notEqual(leftRead.id, rightRead.id);
  assert.equal(leftRead.signatureHash, rightRead.signatureHash);
  assert.equal(leftRead.lexicalParent, left.id);
  assert.equal(rightRead.lexicalParent, right.id);
  assert.notEqual(left.id, right.id);
  const report = analyzeClosureTargets(hir, [entry.id]);
  for (const [factory, returned] of [[left, leftRead], [right, rightRead]]) {
    const summaries = report.functions.filter(fn => fn.id === factory.id);
    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0].returns, finite([returned.id]));
  }
  identityCallTargets(report, entry, ["body", 2, "initializer"], "call", left);
  identityCallTargets(report, entry, ["body", 3, "initializer"], "call", right);
  identityCallTargets(report, entry, ["body", 4, "value", "left"], "indirectCall", leftRead);
  identityCallTargets(report, entry, ["body", 4, "value", "right"], "indirectCall", rightRead);
  assert.equal(report.calls.length, 4);
  identityReportRoundTrip(hir, before, report, entry);
});

test("same-name closures in sibling scopes retain distinct direct targets under one lexical parent", async () => {
  const { hir, before } = await identityTargetCase("same-parent-blocks");
  const entry = declaredFunction(hir.functions, "entry", 0, 175);
  const thenRead = declaredFunction(hir.functions, "read", 53, 92), elseRead = declaredFunction(hir.functions, "read", 116, 156);
  assert.notEqual(thenRead.id, elseRead.id);
  assert.equal(thenRead.signatureHash, elseRead.signatureHash);
  assert.equal(thenRead.lexicalParent, entry.id);
  assert.equal(elseRead.lexicalParent, entry.id);
  assert.notEqual(thenRead.lexicalScope, elseRead.lexicalScope);
  const report = analyzeClosureTargets(hir, [entry.id]);
  identityCallTargets(report, entry, ["body", 0, "thenBody", 0, "body", 1, "value"], "call", thenRead);
  identityCallTargets(report, entry, ["body", 0, "elseBody", 0, "body", 1, "value"], "call", elseRead);
  assert.equal(report.calls.length, 2);
  identityReportRoundTrip(hir, before, report, entry);
});
