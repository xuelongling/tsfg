// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decodeGenericPackage, encodeGenericPackage, genericDefinitionKey, genericPackageId,
  genericPackageFormat as format, genericPackageLimits as limits } from "../compiler/generic-package.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const utf8 = text => new TextEncoder().encode(text);
const clone = value => structuredClone(value);
const type = (kind = "parameter", parameter = 0) => ({ kind, parameter });
const origin = (start = 0, end = 100) => ({ end, start });
const parameter = () => ({ arguments: [], definition: "", kind: "parameter",
  origin: origin(30, 40), parameter: 0, typeArguments: [] });

// Synthetic structural data, not official checking or M14 execution evidence.
function fixture() {
  const content = "type i32 = number;\n";
  const payload = { capabilities: [...format.capabilities], definitions: [],
    environment: { files: [{ content, digest: hash(content), path: "/env/scalars.d.ts" }],
      profile: format.declarationProfile }, scope: "test-module", semanticProfile: format.semanticProfile,
    source: { digest: "a".repeat(64), length: 100, path: "/src/generic.ts",
      positionUnit: "utf16", surrogateStarts: [] } };
  const leaf = { body: parameter(), exported: false, key: "", name: "identity", origin: origin(),
    parameters: [{ name: "value", origin: origin(10, 20), type: type() }],
    returnType: type(), typeParameters: ["T", "Phantom"] };
  leaf.key = genericDefinitionKey(leaf, payload);
  const caller = { body: { arguments: [parameter()], definition: leaf.key, kind: "call",
    origin: origin(25, 50), parameter: 0, typeArguments: [type(), type("boolean")] },
    exported: true, key: "", name: "forward", origin: origin(),
    parameters: [{ name: "input", origin: origin(10, 20), type: type() }],
    returnType: type(), typeParameters: ["U"] };
  caller.key = genericDefinitionKey(caller, payload);
  payload.definitions = [leaf, caller];
  return seal({ family: format.family, packageId: "", payload, schemaHash: format.schemaHash, version: format.version });
}
function seal(value) {
  value.payload.definitions.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  value.payload.environment.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  value.packageId = genericPackageId(value.payload);
  return value;
}
function rekey(value) {
  const keys = new Map();
  for (const definition of value.payload.definitions) {
    const previous = definition.key;
    definition.key = genericDefinitionKey(definition, value.payload); keys.set(previous, definition.key);
  }
  for (const definition of value.payload.definitions) {
    const pending = [definition.body];
    while (pending.length) {
      const expression = pending.pop();
      if (expression.kind === "call" && keys.has(expression.definition)) expression.definition = keys.get(expression.definition);
      pending.push(...expression.arguments);
    }
  }
  return seal(value);
}
const byName = (value, name) => value.payload.definitions.find(definition => definition.name === name);
const code = category => error => error instanceof TypeError && "code" in error && error.code === "generic-package-" + category;
const reject = (value, category) => assert.throws(() => encodeGenericPackage(value), code(category));

test("canonical roundtrip preserves calls, binder order and phantom type arguments", () => {
  const input = fixture(), bytes = encodeGenericPackage(input), decoded = decodeGenericPackage(bytes);
  assert.deepEqual(decoded, input);
  assert.deepEqual(encodeGenericPackage(decoded), bytes);
  assert.equal(byName(decoded, "forward").body.typeArguments.length, 2);
  assert.equal(byName(decoded, "identity").typeParameters[1], "Phantom");
  assert.equal(new TextDecoder().decode(bytes).endsWith("\n"), false);
});

test("identity helpers match independently spelled canonical preimages", () => {
  const source = { digest: "a".repeat(64), length: 2, path: "/x.ts", positionUnit: "utf16", surrogateStarts: [] };
  const definition = { name: "id", origin: { end: 2, start: 0 } };
  const preimage = 'tsfg:generic-definition:v1\n{"name":"id","origin":{"end":2,"start":0},"scope":"s","source":{"digest":"'
    + "a".repeat(64) + '","length":2,"path":"/x.ts","positionUnit":"utf16","surrogateStarts":[]}}';
  assert.equal(genericDefinitionKey(definition, { scope: "s", source }), hash(preimage));
  assert.equal(genericPackageId({ z: 2, a: "😀" }), "sha256:" + hash('tsfg-owned-generic-package/v4\n{"a":"😀","z":2}'));
});

test("encode sorts owned DTO arrays without mutating input or retaining bytes", () => {
  const input = fixture(); input.payload.definitions.reverse();
  const other = clone(input.payload.environment.files[0]); other.path = "/env/a.d.ts";
  input.payload.environment.files.push(other); seal(input);
  const baseline = encodeGenericPackage(input);
  input.payload.definitions.reverse(); input.payload.environment.files.reverse();
  const before = clone(input), bytes = encodeGenericPackage(input);
  assert.deepEqual(bytes, baseline); assert.deepEqual(input, before);
  const decoded = decodeGenericPackage(bytes); bytes.fill(0);
  input.payload.source.surrogateStarts.push(2); input.payload.definitions[0].typeParameters[0] = "changed";
  assert.deepEqual(encodeGenericPackage(decoded), baseline);
  assert.ok(Object.isFrozen(decoded.payload.definitions[0].body.arguments));
  assert.ok(Object.isFrozen(decoded.payload.source.surrogateStarts));
  assert.throws(() => { decoded.payload.environment.files[0].content = "changed"; }, TypeError);
});

test("known family/version/schema/profile/capabilities reject mixed claims", () => {
  for (const change of [value => { value.family += "-foreign"; }, value => { value.version = 1; },
    value => { value.schemaHash = "0".repeat(64); }, value => { value.payload.semanticProfile += "-foreign"; },
    value => { value.payload.environment.profile = "foreign"; }, value => { value.payload.capabilities.reverse(); }]) {
    const value = fixture(); change(value); reject(value, "schema");
  }
});

test("unknown fields, session handles and prototype-bearing input records reject", () => {
  for (const select of [value => value, value => value.payload, value => value.payload.source,
    value => value.payload.environment, value => value.payload.environment.files[0],
    value => value.payload.definitions[0], value => value.payload.definitions[0].body,
    value => value.payload.definitions[0].parameters[0], value => value.payload.definitions[0].returnType,
    value => value.payload.definitions[0].origin]) {
    const value = fixture(); select(value).sessionId = "foreign-session"; reject(value, "schema");
  }
  const value = fixture(); Object.setPrototypeOf(value.payload.source, { foreign: true }); reject(value, "schema");
  const accessor = fixture(); Object.defineProperty(accessor.payload, "scope", { enumerable: true, get() { throw new Error("getter executed"); } });
  reject(accessor, "schema");
});

test("content, declaration, definition and package identity changes reject", () => {
  for (const change of [value => { value.packageId = "sha256:" + "0".repeat(64); },
    value => { value.payload.environment.files[0].content += " "; },
    value => { value.payload.definitions[0].key = "0".repeat(64); },
    value => { value.payload.source.digest = "b".repeat(64); },
    value => { value.payload.definitions[0].exported = !value.payload.definitions[0].exported; }]) {
    const value = fixture(); change(value); reject(value, "identity");
  }
});

test("missing definitions, foreign targets, binder indices and call arities reject", () => {
  for (const change of [value => { value.payload.definitions = [byName(value, "forward")]; },
    value => { byName(value, "forward").body.definition = "0".repeat(64); },
    value => { byName(value, "forward").body.typeArguments.pop(); },
    value => { byName(value, "forward").body.arguments = []; },
    value => { byName(value, "forward").body.typeArguments[0].parameter = 1; },
    value => { byName(value, "identity").body.parameter = 1; },
    value => { byName(value, "identity").returnType = type("boolean", 1); },
    value => { byName(value, "forward").parameters[0].name = "identity"; }]) {
    const value = fixture(); change(value); seal(value); reject(value, "reference");
  }
});

test("parameter expressions cannot carry a target, arguments or type arguments", () => {
  for (const change of [expression => { expression.definition = "0".repeat(64); },
    expression => { expression.arguments = [parameter()]; },
    expression => { expression.typeArguments = [type()]; }]) {
    const value = fixture(); change(byName(value, "identity").body); seal(value); reject(value, "reference");
  }
});

test("missing required fields reject even when their normal values are empty or false", () => {
  for (const { select, field } of [
    { select: value => value, field: "version" }, { select: value => value.payload.source, field: "surrogateStarts" },
    { select: value => byName(value, "identity"), field: "exported" },
    { select: value => byName(value, "identity").body, field: "definition" },
    { select: value => byName(value, "identity").body, field: "arguments" },
    { select: value => byName(value, "identity").body, field: "typeArguments" },
    { select: value => byName(value, "identity").returnType, field: "parameter" },
  ]) {
    const value = fixture(); delete select(value)[field]; reject(value, "schema");
  }
});

test("mutual references remain closed and expression origins use their definition boundary", () => {
  const value = fixture(), leaf = byName(value, "identity"), caller = byName(value, "forward");
  leaf.body = { arguments: [parameter()], definition: caller.key, kind: "call",
    origin: origin(70, 80), parameter: 0, typeArguments: [type()] };
  // The nested parameter's origin is outside the call, inside its definition.
  seal(value); assert.deepEqual(decodeGenericPackage(encodeGenericPackage(value)), value);
});

test("declaration ordering follows UTF16 code units rather than UTF8 byte order", () => {
  const value = fixture(), original = value.payload.environment.files[0];
  value.payload.environment.files = ["/\ue000.d.ts", "/😀.d.ts"].map(path => ({ ...original, path })); seal(value);
  const result = decodeGenericPackage(encodeGenericPackage(value));
  assert.deepEqual(result.payload.environment.files.map(file => file.path), ["/😀.d.ts", "/\ue000.d.ts"]);
});

test("namespace uniqueness is structural and separate value/type namespaces remain legal", () => {
  for (const change of [value => { byName(value, "forward").name = "identity"; },
    value => { byName(value, "identity").typeParameters = ["T", "T"]; },
    value => { const definition = byName(value, "identity"); definition.parameters.push(clone(definition.parameters[0])); }]) {
    const value = fixture(); change(value); rekey(value); reject(value, "schema");
  }
  const value = fixture(), leaf = byName(value, "identity"); leaf.parameters[0].name = "identity"; leaf.typeParameters[0] = "identity";
  assert.deepEqual(decodeGenericPackage(encodeGenericPackage(rekey(value))), value);
});

test("Unicode values retain exact text and property-like names remain ordinary values", () => {
  const value = fixture(); value.payload.scope = "__proto__";
  byName(value, "identity").name = "constructor";
  byName(value, "forward").parameters[0].name = "prototype";
  byName(value, "forward").typeParameters[0] = "😀e\u0301\u2028\u2029<&/";
  rekey(value); const bytes = encodeGenericPackage(value), text = new TextDecoder().decode(bytes);
  assert.ok(text.includes("😀e\u0301\u2028\u2029<&/")); assert.ok(!text.includes("\\u2028"));
  assert.deepEqual(decodeGenericPackage(bytes), value);
  for (const text of ["bad\0name", "\ud800", "\udfff"]) {
    const changed = fixture(); changed.payload.scope = text; reject(changed, "schema");
  }
});

test("UTF16 surrogate boundary facts and definition containment reject shifted origins", () => {
  const value = fixture(); value.payload.source.surrogateStarts = [5, 98]; rekey(value);
  assert.deepEqual(decodeGenericPackage(encodeGenericPackage(value)), value);
  for (const change of [input => { input.payload.source.surrogateStarts = [5, 6]; },
    input => { input.payload.source.surrogateStarts = [98, 5]; },
    input => { byName(input, "identity").parameters[0].origin.start = 6; },
    input => { byName(input, "identity").body.origin.end = 99; },
    input => { byName(input, "identity").origin.end = 35; },
    input => { input.payload.source.surrogateStarts = [99]; }]) {
    const changed = clone(value); change(changed); assert.throws(() => encodeGenericPackage(changed), TypeError);
  }
});

test("paths, required arrays and nonnegative safe integer metadata reject invalid data", () => {
  for (const change of [value => { value.payload.source.path = "/src/../bad.ts"; },
    value => { value.payload.source.path = "/src//bad.ts"; }, value => { value.payload.source.path = "/src/bad.d.ts"; },
    value => { value.payload.environment.files[0].path = "/env/bad.ts"; },
    value => { value.payload.definitions[0].parameters = null; }, value => { value.payload.source.length = 0; },
    value => { value.payload.source.length = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.payload.definitions[0].body.parameter = -0; },
    value => { value.payload.definitions[0].body.parameter = 0.5; },
    value => { delete value.payload.definitions[0].typeParameters[0]; }]) {
    const value = fixture(); change(value); assert.throws(() => encodeGenericPackage(value), TypeError);
  }
});

test("strict UTF8, duplicate keys and noncanonical byte spellings reject", () => {
  const baseline = encodeGenericPackage(fixture()), text = new TextDecoder().decode(baseline);
  assert.throws(() => decodeGenericPackage("text"), code("input"));
  for (const bytes of [new Uint8Array([0xc0, 0xaf]), new Uint8Array([0xed, 0xa0, 0x80])])
    assert.throws(() => decodeGenericPackage(bytes), code("utf8"));
  for (const altered of [" " + text, text + "\n", text.replace('"version":4', '"version":4.0'),
    text.replace('"version":4', '"version":4e0'), text.replace('"family"', '"\\u0066amily"'),
    text.replace('"family":', '"family":"duplicate","family":'),
    text.replace('"family":', '"\\u0066amily":"duplicate","family":'),
    text.replace('"version":4', '"version":4,"sessionId":"foreign"'),
    text.replace('"version":4', '"version":4,"__proto__":{}'), text + "{}",
    text.replace('"scope":"test-module"', '"scope":"\\ud800"')])
    assert.throws(() => decodeGenericPackage(utf8(altered)), TypeError);
  assert.throws(() => decodeGenericPackage(Uint8Array.from([0xef, 0xbb, 0xbf, ...baseline])), code("canonical"));
});

test("decode rejects unsorted definition and environment arrays even with updated identity", () => {
  const value = fixture(); value.payload.definitions.reverse(); value.packageId = genericPackageId(value.payload);
  assert.throws(() => decodeGenericPackage(utf8(JSON.stringify(value))), TypeError);
  const other = fixture(); other.payload.environment.files.push({ content: "x", digest: hash("x"), path: "/a.d.ts" });
  other.packageId = genericPackageId(other.payload);
  assert.throws(() => decodeGenericPackage(utf8(JSON.stringify(other))), TypeError);
});

test("raw bytes, decoded strings, JSON nesting and token budgets reject before graph conversion", () => {
  assert.throws(() => decodeGenericPackage(new Uint8Array(limits.bytes + 1)), code("limit"));
  assert.throws(() => decodeGenericPackage(utf8('"' + "x".repeat(limits.stringBytes + 1) + '"')), code("limit"));
  assert.throws(() => decodeGenericPackage(utf8("[".repeat(limits.depth + 1) + "]".repeat(limits.depth + 1))), code("limit"));
  assert.throws(() => decodeGenericPackage(utf8("[" + "0,".repeat(limits.jsonTokens) + "0]")), code("limit"));
});

test("scope, source, declaration, definition and expression budgets reject", () => {
  for (const change of [value => { value.payload.scope = "é".repeat(limits.scopeBytes); },
    value => { value.payload.source.length = limits.sourceUTF16 + 1; },
    value => { value.payload.environment.files[0].content = "x".repeat(limits.declarationBytes + 1); },
    value => { value.payload.definitions = Array(limits.definitions + 1).fill(value.payload.definitions[0]); },
    value => { value.payload.definitions[0].parameters = Array(limits.parameters + 1).fill(value.payload.definitions[0].parameters[0]); },
    value => { const definition = byName(value, "forward"); let expression = parameter();
      for (let index = 0; index <= limits.expressionDepth; index++) expression = { ...clone(definition.body), arguments: [expression] };
      definition.body = expression; }]) {
    const value = fixture(); change(value); reject(value, "limit");
  }
});

test("expression depth includes root zero and per-definition node budget is independent of depth", () => {
  const value = fixture(), definition = byName(value, "forward"); let expression = parameter();
  for (let index = 0; index < limits.expressionDepth; index++) expression = { ...clone(definition.body), arguments: [expression] };
  definition.body = expression; seal(value);
  assert.deepEqual(decodeGenericPackage(encodeGenericPackage(value)), value);
  let binary = parameter();
  for (let index = 0; index < 10; index++) binary = { ...clone(definition.body), arguments: [binary, clone(binary)] };
  definition.body = binary;
  reject(value, "limit");
});

test("producer rejects aggregate bytes before package identity despite individually legal fields", () => {
  const value = fixture(), leaf = byName(value, "identity"), name = "x".repeat(limits.stringBytes);
  value.payload.definitions = Array.from({ length: 9 }, (_, index) => {
    const definition = clone(leaf); definition.name = "identity" + index;
    definition.parameters[0].name = name;
    definition.key = genericDefinitionKey(definition, value.payload);
    return definition;
  });
  // A wrong package identity must not trigger complete canonical/hash allocation.
  reject(value, "limit");
  assert.throws(() => genericPackageId(value.payload), code("limit"));
});

test("producer byte budget counts JCS escaping rather than only decoded UTF8 strings", () => {
  const value = fixture(), leaf = byName(value, "identity"), name = "\x01".repeat(200000);
  assert.ok(Buffer.byteLength(name) * 7 < limits.bytes);
  value.payload.definitions = Array.from({ length: 7 }, (_, index) => {
    const definition = clone(leaf); definition.name = "identity" + index;
    definition.parameters[0].name = name;
    definition.key = genericDefinitionKey(definition, value.payload);
    return definition;
  });
  reject(value, "limit");
  assert.throws(() => genericPackageId(value.payload), code("limit"));
});

test("public identity helpers bound their preimages and reject accessors without invoking them", () => {
  const name = "x".repeat(limits.stringBytes), origin = { end: 1, start: 0 };
  const source = { pieces: Array(9).fill(name) };
  assert.throws(() => genericDefinitionKey({ name: "id", origin }, { scope: "s", source }), code("limit"));
  const accessor = Object.defineProperty({}, "name", { enumerable: true, get() { throw new Error("getter executed"); } });
  assert.throws(() => genericDefinitionKey(accessor, { scope: "s", source: {} }), code("schema"));
  assert.throws(() => genericPackageId(accessor), code("schema"));
  let nested = {};
  for (let index = 0; index < limits.depth; index++) nested = { nested };
  assert.throws(() => genericPackageId(nested), code("limit"));
});

test("real Source official export candidate-4 fixture interoperates with Product codec", async () => {
  const { readFileSync } = await import("node:fs");
  // Exact Go TestOwnedGenericPackageRoundTripFreshInstances output, extracted
  // from the mapped-signature producer's complete Go JSON stream. This proves codec interop;
  // formal RPC, Product compilePackage, Core and VM admission remain separate.
  const fixtureBytes = readFileSync(new URL("../tests/r03/fixtures/generic-package-source-v4.json", import.meta.url));
  assert.equal(fixtureBytes.length, 2741);
  assert.equal(hash(fixtureBytes), "435032b9aa3305df439dd11e9e639122f9a97c7f303aa75dd454992d1ae2a249");
  const input = Uint8Array.from(fixtureBytes), decoded = decodeGenericPackage(input);
  assert.equal(decoded.packageId, "sha256:24a4a38191f0a7239a7af7105ae7a2e27991157cda279a8b865ce7f10015e8ad");
  assert.equal(decoded.version, 4);
  assert.equal(decoded.schemaHash, "ec05631c15f280f54279ba9353fd8fc3ff779349a1f56f7cdb00eba22c767e20");
  assert.equal(decoded.payload.scope, "package:wire-candidate");
  assert.equal(decoded.payload.source.path, "/original/main.ts");
  assert.equal(decoded.payload.source.length, 216);
  assert.equal(decoded.payload.source.positionUnit, "utf16");
  assert.deepEqual(decoded.payload.source.surrogateStarts, [8]);
  assert.deepEqual(decoded.payload.definitions.map(definition => definition.name), ["identity", "unused", "route"]);
  const identity = byName(decoded, "identity"), unused = byName(decoded, "unused"), route = byName(decoded, "route");
  assert.equal(identity.key, "20fc52097d67a4e19ca8b871b35921927f8e719d7f2effc90d145766dcdd019b");
  assert.deepEqual(identity.typeParameters, ["T"]);
  assert.deepEqual(identity.parameters.map(parameter => parameter.type), [type()]);
  assert.deepEqual(identity.returnType, type());
  assert.equal(identity.body.kind, "parameter"); assert.equal(identity.body.parameter, 0);
  assert.deepEqual(route.typeParameters, ["U"]);
  assert.equal(route.body.kind, "call"); assert.equal(route.body.definition, identity.key);
  assert.deepEqual(route.body.typeArguments, [type()]);
  assert.equal(route.body.arguments.length, 1);
  assert.equal(route.body.arguments[0].kind, "parameter"); assert.equal(route.body.arguments[0].parameter, 0);
  assert.deepEqual(route.body.arguments[0].origin, { end: 144, start: 139 });
  assert.deepEqual(unused.typeParameters, ["V"]);
  assert.deepEqual(unused.parameters.map(parameter => parameter.type), [type("boolean")]);
  assert.deepEqual(unused.returnType, type("boolean"));
  assert.equal(unused.body.kind, "parameter"); assert.equal(unused.body.parameter, 0);
  assert.equal(decoded.payload.environment.files[0].path, "/original/minimal-scalars-v2.d.ts");
  assert.equal(decoded.payload.environment.files[0].digest, "d629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141");
  input.fill(0);
  const encoded = encodeGenericPackage(decoded);
  assert.deepEqual(Buffer.from(encoded), fixtureBytes);
  encoded.fill(0);
  const mutable = clone(decoded); mutable.payload.source.surrogateStarts[0] = 0;
  mutable.payload.environment.files[0].content = "changed"; byName(mutable, "route").body.typeArguments[0].parameter = 99;
  assert.ok(Object.isFrozen(decoded.payload.source.surrogateStarts));
  assert.ok(Object.isFrozen(route.body.arguments));
  assert.deepEqual(Buffer.from(encodeGenericPackage(decoded)), fixtureBytes);
  for (const { change, category } of [
    { change: value => { value.version = 1; }, category: "schema" },
    { change: value => { value.packageId = "sha256:" + "0".repeat(64); }, category: "identity" },
    { change: value => { value.payload.environment.files[0].digest = "0".repeat(64); }, category: "identity" },
    { change: value => { byName(value, "route").body.definition = "0".repeat(64); }, category: "reference" },
  ]) {
    const derivedFixture = clone(decoded); change(derivedFixture);
    assert.throws(() => decodeGenericPackage(utf8(JSON.stringify(derivedFixture))), code(category));
  }
});
