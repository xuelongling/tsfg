// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importCapturedFrontendResponse, validateFrontendSnapshot, resolveSymbol } from "../../compiler/frontend.mjs";
import { buildHir, verifyHir, printHir, readHir, lowerHir } from "../../compiler/hir.mjs";

const fixtures = new URL("../fixtures/r03/m19-closure-boundaries/", import.meta.url);
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const responseHashes = {
  "shared-mutable": "f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181",
  "write-only": "c498cee1c2fe1a1c6cf9e3163250e7ddfe91de8389d506ac02880559446730ae",
  ancestor: "4c3dfa83995bc302f9e891ff9ea3b3a9352762ac95a58de825395a9d038c5091",
  "alias-rebind": "8e2e0715cd92fcb91d701beaba18624184d2102d73a878151afa33cc975d3529",
  "computed-callee": "7b770238bf27ada10bc494d9abfd52bf15939056bbc2b25b0b6b732ba26aa7f2",
  "fewer-parameters": "3357db86464eabf3c2f56e92326e4be085ac5e4bed70b6a1621da0d24a6416a5",
  "parameter-positions": "676799ab1f94783a1c71a94df3f1bc4d7fcb39cf59729148dff73a629fd62fac",
};
const named = (functions, name) => {
  const found = functions.filter(fn => fn.name === name);
  assert.equal(found.length, 1, "unique real declaration " + name);
  return found[0];
};
const integerProfile = ["minimal-integers-v3", "sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e"];
const floatProfile = ["minimal-floats-v4", "sha256:edb7bfe80718ba47175a87a65f2688f1b91420995e7c118dd2c3e4c85c193693"];
const declarationProfiles = {
  "shared-mutable": integerProfile, "write-only": integerProfile, ancestor: integerProfile,
  "alias-rebind": integerProfile, "computed-callee": integerProfile, "fewer-parameters": integerProfile,
  "parameter-positions": floatProfile,
};
/** @param {any} value */
function requiredPresence(value) {
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value, "presence")) {
    const descriptors = Array.isArray(value.presence) ? value.presence : [value.presence];
    if (Array.isArray(value.presence)) {
      assert.ok(Array.isArray(value.parameters), "signature presence must describe its parameters");
      assert.equal(descriptors.length, value.parameters.length, "each signature parameter has a presence descriptor");
    }
    for (const descriptor of descriptors) {
      assert.ok(descriptor && typeof descriptor === "object" && !Array.isArray(descriptor), "presence is a descriptor object");
      for (const key of ["undefined", "null", "optional", "default"]) {
        assert.equal(Object.hasOwn(descriptor, key), true, "presence explicitly retains " + key);
        assert.equal(descriptor[key], false, "only required nonnullable fixtures are adopted");
      }
    }
  }
  for (const child of Object.values(value)) requiredPresence(child);
}
async function loadCase(name) {
  const directory = new URL(name + "/", fixtures);
  const [request, response, original, provenance] = await Promise.all(
    ["request.json", "response.json", "original.json", "provenance.json"].map(file => readFile(new URL(file, directory))));
  const metadata = JSON.parse(provenance.toString("utf8"));
  assert.equal(metadata.execution.rawLogSha256,
    "sha256:83978c2e439eb19832368d4894a004c6de599b2319f43d6f4d95e36eac910fd8");
  assert.equal(digest(response), "sha256:" + responseHashes[name]);
  for (const [kind, bytes] of Object.entries({ request, response, original })) {
    assert.equal(digest(bytes), metadata.frames[kind].sha256);
    assert.equal(bytes.length, metadata.frames[kind].bytes);
  }
  const input = JSON.parse(request.toString("utf8"));
  const untouched = JSON.parse(original.toString("utf8"));
  assert.deepEqual(untouched.files, input.files);
  assert.equal(untouched.rootFile, input.rootFile);
  const profile = declarationProfiles[name];
  assert.ok(profile, "case has an explicit real declaration profile");
  assert.equal(input.declarations.version, profile[0]);
  const declarations = input.files.find(file => file.path === input.declarations.paths[0]);
  assert.equal(digest(declarations.content), profile[1]);
  const wire = JSON.parse(response.toString("utf8"));
  assert.equal(wire.status, "ok", "the official Go oracle accepted the unmodified source");
  requiredPresence(wire);
  return { request, response, origin: metadata.origin, wire };
}
async function importCase(name) {
  const bytes = await loadCase(name);
  const imported = await importCapturedFrontendResponse(bytes.request, bytes.response, bytes.origin);
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  validateFrontendSnapshot(imported.snapshot);
  return { ...bytes, snapshot: imported.snapshot };
}
async function ownedCase(name) {
  const imported = await importCase(name);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, "ok", JSON.stringify(built));
  const hir = verifyHir(built.hir), text = printHir(hir);
  const cold = readHir(Buffer.from(text));
  assert.deepEqual(cold, hir);
  assert.equal(printHir(cold), text);
  assert.equal(Object.hasOwn(hir, "snapshotId"), false);
  assert.equal(Object.hasOwn(hir, "capturedResponse"), false);
  assert.ok(Object.isFrozen(cold));
  return { ...imported, hir: cold };
}

// Every successful source/fact below comes from the archived public Go response.
// The fixtures preserve raw frame bytes after concatenating each Go Test's Output.
test("shared mutable captures retain the one original owner binding after cold read", async () => {
  const { snapshot, hir } = await ownedCase("shared-mutable");
  const entry = named(hir.functions, "entry"), writer = named(hir.functions, "write"), reader = named(hir.functions, "read");
  const state = entry.body[0].binding;
  assert.equal(state.owner, entry.id);
  assert.equal(state.writable, true);
  assert.deepEqual(writer.captures.map(c => [c.binding, c.read, c.write]), [[state.id, true, true]]);
  assert.deepEqual(reader.captures.map(c => [c.binding, c.read, c.write]), [[state.id, true, false]]);
  assert.equal(writer.body[0].target.binding, state.id);
  assert.equal(writer.body[1].value.binding, state.id);
  assert.equal(reader.body[0].value.binding, state.id);
  assert.equal(writer.body[0].value.binding, writer.parameters[0].id);
  const original = named(snapshot.functions, "entry").body[0].symbol;
  assert.equal(resolveSymbol(snapshot, original.lexicalOwner).id, named(snapshot.functions, "entry").symbol.id);
});

test("write-only captures keep explicit false read without a synthetic load", async () => {
  const { hir } = await ownedCase("write-only");
  const entry = named(hir.functions, "entry"), writer = named(hir.functions, "write");
  assert.deepEqual(writer.captures.map(c => [c.binding, c.read, c.write]), [[entry.body[0].binding.id, false, true]]);
  assert.equal(writer.body[0].target.binding, entry.body[0].binding.id);
  assert.equal(writer.body[1].value.binding, writer.parameters[0].id);
});

test("ancestor capture does not invent a direct capture on the middle function", async () => {
  const { hir } = await ownedCase("ancestor");
  const entry = named(hir.functions, "entry"), middle = named(hir.functions, "middle"), reader = named(hir.functions, "read");
  assert.equal(middle.lexicalParent, entry.id);
  assert.equal(reader.lexicalParent, middle.id);
  assert.deepEqual(middle.captures ?? [], []);
  assert.deepEqual(reader.captures.map(c => [c.binding, c.read, c.write]), [[entry.body[0].binding.id, true, false]]);
  assert.equal(reader.body[0].value.binding, entry.body[0].binding.id);
  assert.equal(entry.body[0].binding.writable, false);
});

test("callable alias and rebinding preserve distinct slots and ordered RHS evaluations", async () => {
  const { hir } = await ownedCase("alias-rebind");
  const entry = named(hir.functions, "entry"), first = named(hir.functions, "first"), other = named(hir.functions, "other");
  const selected = entry.body[2], alias = entry.body[3], assignment = entry.body[4], snapshot = entry.body[5];
  assert.equal(new Set([selected.binding.id, alias.binding.id, snapshot.binding.id]).size, 3);
  assert.deepEqual([selected.binding.writable, alias.binding.writable, snapshot.binding.writable], [true, false, false]);
  assert.equal(selected.initializer.target, first.id);
  assert.equal(alias.initializer.kind, "reference");
  assert.equal(alias.initializer.binding, selected.binding.id);
  assert.equal(assignment.target.binding, selected.binding.id);
  assert.equal(assignment.value.target, other.id);
  assert.equal(snapshot.initializer.kind, "group");
  assert.equal(snapshot.initializer.operand.kind, "write");
  assert.equal(snapshot.initializer.operand.left.binding, selected.binding.id);
  assert.equal(snapshot.initializer.operand.right.target, first.id);
  const returned = entry.body[6].value;
  assert.equal(returned.left.kind, "indirectCall");
  assert.equal(returned.left.callee.binding, alias.binding.id);
  assert.equal(returned.right.callee.binding, snapshot.binding.id);
  assert.equal(Object.hasOwn(returned.left, "target"), false);
});

test("computed and parenthesized indirect callees retain factory evaluation and grouping", async () => {
  const { hir } = await ownedCase("computed-callee");
  const entry = named(hir.functions, "entry"), factory = named(hir.functions, "make");
  const computed = entry.body[1].initializer, grouped = entry.body[2].value.left;
  assert.equal(computed.kind, "indirectCall");
  assert.equal(computed.callee.kind, "call");
  assert.equal(computed.callee.target, factory.id);
  assert.equal(grouped.kind, "indirectCall");
  assert.equal(grouped.callee.kind, "group");
  assert.equal(grouped.callee.operand.kind, "call");
  assert.equal(grouped.callee.operand.target, factory.id);
  for (const call of [computed, grouped]) assert.equal(Object.hasOwn(call, "target"), false);
});

test("callable and scalar parameters keep their original positions and nested descriptors", async () => {
  const { snapshot, hir } = await ownedCase("parameter-positions");
  const apply = named(hir.functions, "apply"), entry = named(hir.functions, "entry");
  assert.deepEqual(apply.parameters.map(p => p.name), ["fn", "value"]);
  assert.equal(apply.body[0].value.callee.binding, apply.parameters[0].id);
  assert.equal(apply.body[0].value.arguments[0].binding, apply.parameters[1].id);
  const call = entry.body[4].value;
  assert.equal(call.arguments[0].binding, entry.body[3].binding.id);
  assert.equal(call.arguments[1].binding, entry.parameters[0].id);
  const facts = named(snapshot.functions, "entry").body[4].expression;
  assert.deepEqual(facts.signature.parameters, ["function", "bool"]);
  assert.deepEqual(facts.signature.parameterSignatures, [{ parameters: ["bool"], returnType: "bool" }, null]);
});

test("official fewer-parameter callable compatibility requires an explicit adapter capability", async () => {
  const bytes = await loadCase("fewer-parameters");
  const entry = named(bytes.wire.functions, "entry");
  assert.deepEqual(entry.body[2].symbol.signature.parameters, ["bool"]);
  assert.deepEqual(entry.body[2].initializer.signature.parameters, []);
  const imported = await importCapturedFrontendResponse(bytes.request, bytes.response, bytes.origin);
  const result = imported.status === "ok" ? buildHir(imported.snapshot) : imported;
  assert.equal(result.status, "error");
  assert.ok(result.diagnostics.some(d => d.code === "r03-d-capability"), JSON.stringify(result));
  assert.match(result.diagnostics.map(d => d.message).join(" "), /callable|signature|adapt|parameter/i);
  assert.equal(Object.hasOwn(result, "hir"), false);
});

/** @param {string} name @param {(wire: any) => void} change */
async function rejectWire(name, change) {
  const bytes = await loadCase(name), changed = structuredClone(bytes.wire);
  change(changed);
  const response = Buffer.from(JSON.stringify(changed));
  const result = await importCapturedFrontendResponse(bytes.request, response,
    { ...bytes.origin, responseSha256: digest(response) });
  assert.notEqual(result.status, "ok", "hash repair must not bless invalid facts");
  assert.equal(Object.hasOwn(result, "snapshot"), false);
}
/** @type {[string, string, (wire: any) => void][]} */
const wireMutations = [
  ["lexical owner", "shared-mutable", w => { w.symbols.find(s => s.name === "state").lexicalOwner = "s2"; named(w.functions, "entry").body[0].symbol.lexicalOwner = "s2"; }],
  ["lexical parent cycle", "ancestor", w => { named(w.functions, "middle").lexicalParent = "s3"; }],
  ["foreign binding reference", "shared-mutable", w => { named(w.functions, "read").body[0].expression.symbol = "s6"; }],
  ["missing capture", "shared-mutable", w => { named(w.functions, "read").captures = []; }],
  ["invented middle capture", "ancestor", w => { named(w.functions, "middle").captures = [{ symbol: "s5", read: true, write: false }]; }],
  ["write-only access flags", "write-only", w => { named(w.functions, "write").captures[0].read = true; }],
  ["callable descriptor", "alias-rebind", w => { named(w.functions, "entry").body[3].initializer.signature.returnType = "i32"; }],
  ["guessed indirect target", "computed-callee", w => { named(w.functions, "entry").body[1].initializer.target = "s3"; }],
  ["different callee", "computed-callee", w => { named(w.functions, "entry").body[1].initializer.callee.target = "s3"; }],
  ["parameter order", "parameter-positions", w => { named(w.functions, "apply").parameters.reverse(); }],
  ["argument order", "parameter-positions", w => { named(w.functions, "entry").body[4].expression.arguments.reverse(); }],
  ["callable parameter signature index", "parameter-positions", w => {
    named(w.functions, "entry").body[4].expression.signature.parameterSignatures.reverse();
  }],
];
for (const [label, name, mutate] of wireMutations)
  test("captured facts reject " + label + " after digest repair", async () => rejectWire(name, mutate));

test("snapshot references cannot cross captured input identities", async () => {
  const first = await importCase("shared-mutable"), second = await importCase("write-only");
  assert.notEqual(first.snapshot.snapshotId, second.snapshot.snapshotId);
  assert.throws(() => resolveSymbol(first.snapshot, named(second.snapshot.functions, "entry").symbol), /snapshot|reference|contract/i);
  const changed = structuredClone(first.snapshot);
  named(changed.functions, "read").body[0].expression.symbol = named(second.snapshot.functions, "entry").parameters[0].ref;
  assert.throws(() => validateFrontendSnapshot(changed));
  assert.equal(buildHir(changed).status, "error");
});

/** @param {Uint8Array} request @param {Uint8Array} response @param {any} origin */
async function rejectsCapturedBytes(request, response, origin) {
  const result = await importCapturedFrontendResponse(request, response,
    { ...origin, requestSha256: digest(request), responseSha256: digest(response) });
  assert.notEqual(result.status, "ok");
  assert.equal(Object.hasOwn(result, "snapshot"), false);
}
const malformedJSON = [
  ["lone surrogate", '{"status":"ok","bad":"\\ud800"}'],
  ["unsafe integer", '{"status":"ok","bad":9007199254740992}'],
  ["nonrecord", '[]'],
  ["prototype key", '{"__proto__":{},"status":"ok"}'],
  ["depth budget", '['.repeat(130) + '0' + ']'.repeat(130)],
  ["token budget", '[' + '0,'.repeat(200001) + '0]'],
  ["string budget", '{"bad":"' + 'a'.repeat(1024 * 1024 + 1) + '"}'],
];
for (const [label, text] of malformedJSON) {
  test("captured JSON rejects hash-repaired " + label + " in either frame", async () => {
    const bytes = await loadCase("shared-mutable"), changed = Buffer.from(text);
    await rejectsCapturedBytes(bytes.request, changed, bytes.origin);
    await rejectsCapturedBytes(changed, bytes.response, bytes.origin);
  });
}

test("captured frames reject duplicate valid members and oversized valid JSON after digest repair", async () => {
  const bytes = await loadCase("shared-mutable");
  const requestText = bytes.request.toString("utf8"), responseText = bytes.response.toString("utf8");
  const duplicateRequest = Buffer.from('{"config":{"strict":true,"noEmit":true,"allowJs":false},' + requestText.slice(1));
  const duplicateResponse = Buffer.from('{"status":"ok",' + responseText.slice(1));
  await rejectsCapturedBytes(duplicateRequest, bytes.response, bytes.origin);
  await rejectsCapturedBytes(bytes.request, duplicateResponse, bytes.origin);
  const padding = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20);
  await rejectsCapturedBytes(Buffer.concat([padding, bytes.request]), bytes.response, bytes.origin);
  await rejectsCapturedBytes(bytes.request, Buffer.concat([padding, bytes.response]), bytes.origin);
});

test("captured origins reject digest mismatch and invented binary admission", async () => {
  const bytes = await loadCase("shared-mutable");
  for (const origin of [{ ...bytes.origin, responseSha256: "sha256:" + "0".repeat(64) },
    { ...bytes.origin, requestSha256: "sha256:" + "0".repeat(64) },
    { ...bytes.origin, binarySha256: "sha256:" + "0".repeat(64) },
    { ...bytes.origin, producerDirty: false }]) {
    const result = await importCapturedFrontendResponse(bytes.request, bytes.response, origin);
    assert.equal(result.status, "error");
    assert.equal(Object.hasOwn(result, "snapshot"), false);
  }
});

test("captured response rejects repaired digest with invalid UTF-8 or BOM", async () => {
  const bytes = await loadCase("shared-mutable");
  for (const response of [Buffer.from([0xc3, 0x28]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes.response])])
    await rejectsCapturedBytes(bytes.request, response, bytes.origin);
});

test("owned HIR rejects forged owners, capture flags, references, signatures and callee targets", async () => {
  const { hir } = await ownedCase("shared-mutable");
  const mutations = [
    h => { named(h.functions, "entry").body[0].binding.owner = named(h.functions, "read").id; },
    h => { named(h.functions, "read").captures[0].write = true; },
    h => { named(h.functions, "read").body[0].value.binding = named(h.functions, "write").parameters[0].id; },
    h => { named(h.functions, "write").signatureHash = "sha256:" + "0".repeat(64); },
    h => { named(h.functions, "entry").body[3].value.target = named(h.functions, "read").id; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(hir);
    mutate(changed);
    assert.throws(() => verifyHir(changed));
  }
  const indirect = (await ownedCase("computed-callee")).hir;
  const changed = structuredClone(indirect);
  named(changed.functions, "entry").body[1].initializer.target = named(changed.functions, "read").id;
  assert.throws(() => verifyHir(changed));
});

test("cold HIR rejects changed identity, snapshot leakage and noncanonical bytes", async () => {
  const { hir } = await ownedCase("shared-mutable"), text = printHir(hir);
  const entry = named(hir.functions, "entry");
  const forged = "sha256:" + "0".repeat(64);
  assert.throws(() => readHir(Buffer.from(text.replaceAll(entry.id, forged))));
  assert.throws(() => readHir(Buffer.from(text.replace(hir.source.hash, forged))));
  const leaked = text.replace('{', '{"snapshotId":"forged",');
  assert.throws(() => readHir(Buffer.from(leaked)));
  for (const bytes of [Buffer.from(text.trimEnd()), Buffer.from(text + "\n"),
    Buffer.from(JSON.stringify(hir, null, 2) + "\n"), Buffer.from('{"inputIdentity":' + JSON.stringify(hir.inputIdentity) + ',' + text.slice(1)),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])])
    assert.throws(() => readHir(bytes));
});

test("closure HIR lowering stops at a specific capability boundary before Core exists", async () => {
  const { hir } = await ownedCase("shared-mutable");
  assert.throws(() => lowerHir(hir), /** @param {any} error */ error => {
    assert.equal(error.code, "r03-d-capability");
    assert.equal(error.ruleId, "r01-ts-baseline");
    assert.equal(error.phase, "lowering");
    assert.match(error.message, /closure|captur|environment/i);
    return true;
  });
});
