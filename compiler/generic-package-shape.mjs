// SPDX-License-Identifier: MIT
import { canonical, sha256, own } from "./identity.mjs";
import { checkGenericJsonValueBudget, genericPackageJsonPolicy } from "./generic-json-budget.mjs";

export const genericPackageFormat = own({
  family: "tsfg-owned-generic-package", version: 1,
  schemaHash: "5f3e8a6e8e3b49dcbdf507db643c538a5810cc3a09f75ea7dc4db560086e9e4b",
  semanticProfile: "tsfg-owned-scalar-generics-host-v1", declarationProfile: "minimal-scalars-v2",
  capabilities: ["explicit-type-arguments", "scalar-generics", "single-module"],
});
export const genericPackageLimits = Object.freeze({ bytes: genericPackageJsonPolicy.bytes, declarationBytes: 1048576,
  declarations: 8, definitions: 256, depth: genericPackageJsonPolicy.depth, expressionDepth: 64,
  expressionsPerDefinition: 1024, expressionsTotal: 32768, jsonTokens: genericPackageJsonPolicy.jsonTokens,
  parameters: 64, pathBytes: 4096, scopeBytes: 256, sourceUTF16: 1048576,
  stringBytes: genericPackageJsonPolicy.stringBytes, typeParameters: 16 });

export function packageFailure(category) {
  throw Object.assign(new TypeError(`generic-package-${category}: invalid owned generic package`),
    { code: `generic-package-${category}` });
}
const check = (condition, category = "schema") => { if (!condition) packageFailure(category); };
const bytes = text => Buffer.byteLength(text, "utf8");
const digest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const hex = text => sha256(text).slice(7);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** @param {number} [maximum] */
export function packageString(value, maximum = genericPackageLimits.stringBytes, nonempty = false) {
  check(typeof value === "string" && value.isWellFormed() && !value.includes("\0"));
  check(bytes(value) <= maximum, "limit");
  check(!nonempty || value.length > 0);
  return value;
}
function record(value, keys) {
  check(value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  check(actual.length === keys.length && actual.every(key => typeof key === "string" && keys.includes(key)
    && Object.hasOwn(descriptors[key], "value") && descriptors[key].enumerable));
}
function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
  check(Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0));
  check(value <= maximum, "limit");
  return value;
}
function array(value, maximum, minimum = 0) {
  check(Array.isArray(value));
  check(value.length >= minimum && value.length <= maximum, "limit");
  // Sparse arrays and extra/accessor properties are not protocol arrays.
  const keys = Reflect.ownKeys(value);
  check(keys.length === value.length + 1 && keys.every(key => key === "length"
    || typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key)
      && Number(key) < value.length && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")));
  return value;
}
function path(value, declaration) {
  packageString(value, genericPackageLimits.pathBytes, true);
  check(value.startsWith("/") && !value.includes("\\") && value.slice(1).split("/")
    .every(part => part !== "" && part !== "." && part !== "..")
    && (declaration ? value.endsWith(".d.ts") : value.endsWith(".ts") && !value.endsWith(".d.ts")));
  return value;
}
// A VFS file cannot also be an ancestor directory of another owned file.
export function genericInputPathsDisjoint(paths) {
  return paths.every((name, index) => paths.slice(index + 1).every(other => name !== other
    && !name.startsWith(other + '/') && !other.startsWith(name + '/')));
}
function strictOrder(values, key) {
  for (let i = 1; i < values.length; i++) check(order(key(values[i - 1]), key(values[i])) < 0);
}

function dataProperty(value, key) {
  check(value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  check(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
  return descriptor.value;
}
export function genericDefinitionKey(definition, payload) {
  const preimage = { name: dataProperty(definition, "name"), origin: dataProperty(definition, "origin"),
    scope: dataProperty(payload, "scope"), source: dataProperty(payload, "source") };
  checkGenericJsonValueBudget(preimage);
  return hex("tsfg:generic-definition:v1\n" + canonical(preimage));
}
/** Hash the protocol Payload: definitions/files must already have canonical order. */
export function genericPackageId(payload) {
  checkGenericJsonValueBudget(payload);
  return sha256("tsfg-owned-generic-package/v1\n" + canonical(payload));
}

/** Structural admission only. Official Source checking remains the semantic authority. */
export function normalizeGenericPackage(input, ordered = false) {
  checkGenericJsonValueBudget(input);
  record(input, ["family", "packageId", "payload", "schemaHash", "version"]);
  const format = genericPackageFormat, limit = genericPackageLimits;
  check(input.family === format.family && input.version === format.version && input.schemaHash === format.schemaHash);
  check(typeof input.packageId === "string" && /^sha256:[0-9a-f]{64}$/.test(input.packageId));
  const value = input.payload;
  record(value, ["capabilities", "definitions", "environment", "scope", "semanticProfile", "source"]);
  check(value.semanticProfile === format.semanticProfile);
  array(value.capabilities, format.capabilities.length, format.capabilities.length);
  check(value.capabilities.every((item, index) => item === format.capabilities[index]));
  const scope = packageString(value.scope, limit.scopeBytes, true), rawSource = value.source;
  record(rawSource, ["digest", "length", "path", "positionUnit", "surrogateStarts"]);
  check(digest(rawSource.digest) && rawSource.positionUnit === "utf16");
  const length = integer(rawSource.length, limit.sourceUTF16); check(length > 0);
  const sourcePath = path(rawSource.path, false);
  const starts = array(rawSource.surrogateStarts, Math.floor(length / 2)).map(item => integer(item, length - 2));
  for (let i = 1; i < starts.length; i++) check(starts[i] >= starts[i - 1] + 2);
  const splitPoints = new Set(starts.map(start => start + 1));
  const source = { digest: rawSource.digest, length, path: sourcePath, positionUnit: "utf16", surrogateStarts: starts };
  function origin(raw, parent = { start: 0, end: length }) {
    record(raw, ["end", "start"]);
    const start = integer(raw.start, length), end = integer(raw.end, length);
    check(start < end && start >= parent.start && end <= parent.end && !splitPoints.has(start) && !splitPoints.has(end));
    return { end, start };
  }
  record(value.environment, ["files", "profile"]);
  check(value.environment.profile === format.declarationProfile);
  const files = array(value.environment.files, limit.declarations, 1).map(file => {
    record(file, ["content", "digest", "path"]);
    const content = packageString(file.content, limit.declarationBytes, true), filePath = path(file.path, true);
    check(digest(file.digest)); check(hex(content) === file.digest, "identity");
    return { content, digest: file.digest, path: filePath };
  });
  if (ordered) strictOrder(files, file => file.path);
  files.sort((a, b) => order(a.path, b.path)); strictOrder(files, file => file.path);
  check(genericInputPathsDisjoint([sourcePath, ...files.map(file => file.path)]), "input");
  let totalExpressions = 0;
  const definitions = array(value.definitions, limit.definitions, 1).map(definition => {
    record(definition, ["body", "exported", "key", "name", "origin", "parameters", "returnType", "typeParameters"]);
    check(typeof definition.exported === "boolean" && digest(definition.key));
    const name = packageString(definition.name, limit.stringBytes, true), anchor = origin(definition.origin);
    const typeParameters = array(definition.typeParameters, limit.typeParameters, 1)
      .map(item => packageString(item, limit.stringBytes, true));
    check(new Set(typeParameters).size === typeParameters.length);
    function type(raw) {
      record(raw, ["kind", "parameter"]);
      check(["boolean", "number", "parameter"].includes(raw.kind));
      const parameter = integer(raw.parameter);
      check(raw.kind === "parameter" ? parameter < typeParameters.length : parameter === 0, "reference");
      return { kind: raw.kind, parameter };
    }
    const parameters = array(definition.parameters, limit.parameters).map(parameter => {
      record(parameter, ["name", "origin", "type"]);
      return { name: packageString(parameter.name, limit.stringBytes, true), origin: origin(parameter.origin, anchor), type: type(parameter.type) };
    });
    check(new Set(parameters.map(parameter => parameter.name)).size === parameters.length);
    let expressions = 0;
    function expression(raw, depth) {
      check(depth <= limit.expressionDepth && ++expressions <= limit.expressionsPerDefinition
        && ++totalExpressions <= limit.expressionsTotal, "limit");
      record(raw, ["arguments", "definition", "kind", "origin", "parameter", "typeArguments"]);
      check(["parameter", "call"].includes(raw.kind));
      const expressionOrigin = origin(raw.origin, anchor), parameter = integer(raw.parameter);
      const target = packageString(raw.definition);
      const args = array(raw.arguments, limit.parameters), typeArgs = array(raw.typeArguments, limit.typeParameters);
      if (raw.kind === "parameter") check(parameter < parameters.length && target === ""
        && args.length === 0 && typeArgs.length === 0, "reference");
      else check(parameter === 0 && digest(target), "reference");
      return { arguments: args.map(arg => expression(arg, depth + 1)), definition: target,
        kind: raw.kind, origin: expressionOrigin, parameter, typeArguments: typeArgs.map(type) };
    }
    return { body: expression(definition.body, 0), exported: definition.exported, key: definition.key,
      name, origin: anchor, parameters, returnType: type(definition.returnType), typeParameters };
  });
  if (ordered) strictOrder(definitions, definition => definition.key);
  definitions.sort((a, b) => order(a.key, b.key)); strictOrder(definitions, definition => definition.key);
  check(new Set(definitions.map(definition => definition.name)).size === definitions.length);
  const payload = { capabilities: [...format.capabilities], definitions,
    environment: { files, profile: format.declarationProfile }, scope, semanticProfile: format.semanticProfile, source };
  const byKey = new Map(definitions.map(definition => [definition.key, definition]));
  for (const definition of definitions) {
    check(definition.key === genericDefinitionKey(definition, payload), "identity");
    const pending = [definition.body], names = new Set(definition.parameters.map(parameter => parameter.name));
    while (pending.length) {
      const expression = pending.pop();
      if (expression.kind === "call") {
        const callee = byKey.get(expression.definition);
        check(callee && expression.arguments.length === callee.parameters.length
          && expression.typeArguments.length === callee.typeParameters.length && !names.has(callee.name), "reference");
      }
      pending.push(...expression.arguments);
    }
  }
  check(input.packageId === genericPackageId(payload), "identity");
  return own({ family: format.family, packageId: input.packageId, payload, schemaHash: format.schemaHash, version: format.version });
}
