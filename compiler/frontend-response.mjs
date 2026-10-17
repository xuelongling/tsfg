// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { importExceptionCapturedResponse } from "./exception-frontend.mjs";
import { importNullableCapturedResponse, matchesNullableSnapshot } from "./nullable-frontend.mjs";
import { ownClosureSnapshot, matchesClosureSnapshot } from "./closure-frontend.mjs";
import { readJson as readClosureJson, origin as checkClosureOrigin, capturedDeclarationProfiles } from "./closure-common.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeClosure } from "./modules.mjs";
import contractRegistry from "../contracts/registry.json" with { type: "json" };
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };

const frontendContract = contractRegistry["tsfg.frontend-snapshot"];
export const frontendContractVersion = frontendContract.semver;

export const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

function canonical(value) {
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) throw new TypeError("canonical input contains a lone surrogate");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => {
      if (hasLoneSurrogate(key)) throw new TypeError("canonical input key contains a lone surrogate");
      return `${JSON.stringify(key)}:${canonical(value[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const snapshotIdentity = (inputIdentity, frontendSource) => digest(canonical({
  contractVersion: frontendContractVersion, schemaHash: frontendContract.schemaHash,
  inputIdentity, frontendSource,
}));

export function matchesSnapshotContract(snapshot) {
  if (snapshot?.format?.family === "tsfg.frontend-nullable-candidate") return matchesNullableSnapshot(snapshot);
  if (snapshot?.format?.family === "tsfg.frontend-closure-candidate") return matchesClosureSnapshot(snapshot);
  let matchesInput = false;
  try {
    const claim = snapshot?.identityInput;
    const files = new Map(claim.files.map(file => [file.path, file.content]));
    matchesInput = digest(canonical(claim)) === snapshot.inputIdentity
      && files.size === claim.files.length
      && claim.rootFile === snapshot.source?.path
      && files.get(claim.rootFile) === snapshot.source.content
      && claim.declarations.version === snapshot.capability
      && (!["minimal-integers-v3", "minimal-floats-v4"].includes(snapshot.capability) || canonical(claim.target) === canonical({ ...bytecodeSchema.target, pointerBits: "64" }))
      && Array.isArray(snapshot.inputs)
      && new Set(snapshot.inputs.map(file => file.path)).size === snapshot.inputs.length
      && snapshot.inputs.some(file => file.path === claim.rootFile)
      && claim.declarations.paths.every(name => snapshot.inputs.some(file => file.path === name))
      && snapshot.inputs.every(file => typeof files.get(file.path) === "string"
        && file.sha256 === digest(files.get(file.path))
        && file.kind === (file.path === claim.rootFile || claim.compilationClosure && !file.path.endsWith(".d.ts") ? "source"
          : claim.declarations.paths.includes(file.path) ? "declaration-root" : "declaration-dependency"));
  } catch { return false; }
  return matchesInput && snapshot?.contractVersion === frontendContractVersion
    && snapshot.schemaHash === frontendContract.schemaHash
    && /^sha256:[0-9a-f]{64}$/.test(snapshot.inputIdentity)
    && typeof snapshot.frontendSource?.forkOid === "string"
    && /^sha256:[0-9a-f]{64}$/.test(snapshot.frontendSource?.binarySha256)
    && snapshot.snapshotId === snapshotIdentity(snapshot.inputIdentity, snapshot.frontendSource);
}

function rejectInput(inputIdentity, file) {
  return deepFreeze({ status: "error", inputIdentity, diagnostics: [{
    code: "r02b-d-input", ruleId: "r01-input-boundary", ruleIds: ["r01-input-boundary"],
    category: "input", phase: "syntax", severity: "error", file, range: { start: 0, end: 0 },
    primary: { sourceId: file, start: 0, end: 0, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
  }] });
}


// M19 candidate captures retain the Go fixture declaration bytes and order.
// This exact pin does not replace the registered transport declaration check.

/** @param {any} input @param {boolean} [captured] @returns {Promise<any>} */
export async function prepareFrontendInput(input, captured = false) {
  let ownedInput;
  try { ownedInput = structuredClone(input); } catch { ownedInput = null; }
  if (ownedInput?.compilationClosure) {
    try {
      ownedInput.compilationClosure = normalizeClosure(ownedInput.compilationClosure);
      if (ownedInput.hostImports) ownedInput.hostImports.sort((a,b) => Buffer.from(`${a.sourcePath}\0${a.name}`).compare(Buffer.from(`${b.sourcePath}\0${b.name}`)));
    } catch { return rejectInput(digest("null"), ownedInput?.rootFile ?? ""); }
  }
  const identityInput = ownedInput && typeof ownedInput === "object" && !Array.isArray(ownedInput)
    ? { ...ownedInput, files: Array.isArray(ownedInput.files)
      ? ownedInput.files.map(file => ({ path: file?.path, content: file?.content }))
        .sort((a, b) => Buffer.from(String(a.path)).compare(Buffer.from(String(b.path))))
      : ownedInput.files }
    : ownedInput ?? null;
  let inputIdentity;
  try { inputIdentity = digest(canonical(identityInput)); }
  catch { return rejectInput(digest("null"), ownedInput?.rootFile ?? ""); }
  const config = ownedInput?.config;
  if (!config || Object.keys(config).sort().join(",") !== "allowJs,noEmit,strict"
      || config.allowJs !== false || config.noEmit !== true || config.strict !== true) {
    return rejectInput(inputIdentity, ownedInput?.rootFile ?? "");
  }
  const root = ownedInput?.sourceRoot;
  const rootFile = ownedInput?.rootFile;
  const files = ownedInput?.files;
  const seen = new Set();
  const integerInput = ["minimal-integers-v3", "minimal-floats-v4"].includes(ownedInput?.declarations?.version);
  const moduleInput = ownedInput?.compilationClosure !== undefined;
  const inputKeys = ["config","declarations","files","rootFile","sourceRoot",...(integerInput ? ["target"] : []),
    ...(moduleInput ? ["compilationClosure",...(ownedInput.hostImports !== undefined ? ["hostImports"] : [])] : [])].sort().join(",");
  if (Object.keys(ownedInput ?? {}).sort().join(",") !== inputKeys
      || (integerInput && canonical(ownedInput.target) !== canonical({ ...bytecodeSchema.target, pointerBits: "64" }))
      || Object.keys(ownedInput?.declarations ?? {}).sort().join(",") !== "paths,version"
      || typeof root !== "string" || !root.startsWith("/") || path.posix.normalize(root) !== root
      || typeof rootFile !== "string" || !rootFile.endsWith(".ts") || rootFile.endsWith(".d.ts")
      || !Array.isArray(files) || files.length === 0 || files.some(file => {
        if (typeof file?.path !== "string" || typeof file.content !== "string"
            || !["content,path", "content,path,sha256"].includes(Object.keys(file).sort().join(","))
            || !file.path.startsWith(`${root}/`) || path.posix.normalize(file.path) !== file.path
            || (file.path !== rootFile && !file.path.endsWith(".d.ts") && !(moduleInput && file.path.endsWith(".ts"))) || seen.has(file.path)
            || (file.sha256 !== undefined && file.sha256 !== digest(file.content))) return true;
        seen.add(file.path);
        return false;
      }) || !seen.has(rootFile)) {
    return rejectInput(inputIdentity, rootFile ?? "");
  }
  const declarationVersion = ownedInput?.declarations?.version;
  const declarationFile = declarationVersion === "minimal-bool-v1" ? "minimal-bool-v1.d.ts"
    : declarationVersion === "minimal-scalars-v2" ? "minimal-scalars-v2.d.ts"
    : declarationVersion === "minimal-integers-v3" ? "minimal-integers-v3.d.ts"
    : declarationVersion === "minimal-floats-v4" ? "minimal-floats-v4.d.ts" : null;
  if (!declarationFile) return rejectInput(inputIdentity, rootFile);
  const declarationBytes = await readFile(new URL(`./${declarationFile}`, import.meta.url), "utf8");
  const declarationPaths = ownedInput?.declarations?.paths;
  const corePath = `${root}/${declarationFile}`;
  const declared = files.find(file => file.path === corePath);
  if (!Array.isArray(declarationPaths) || declarationPaths[0] !== corePath
      || new Set(declarationPaths).size !== declarationPaths.length
      || declarationPaths.some(name => !seen.has(name) || !name.endsWith(".d.ts"))
      || (captured ? !Object.hasOwn(capturedDeclarationProfiles, declarationVersion)
        || typeof declared?.content !== "string" || digest(declared.content) !== capturedDeclarationProfiles[declarationVersion]
        : declared?.content !== declarationBytes)) {
    return rejectInput(inputIdentity, declared?.path ?? rootFile);
  }
  return { status: "ready", ownedInput, identityInput, inputIdentity, rootFile, files, seen,
    declarationVersion, declarationPaths, moduleInput };
}

/** Shared owned conversion for the locked transport and captured Go responses.
 * @param {any} prepared @param {string} response @param {any} frontendSource
 */
export function materializeFrontendResponse(prepared, response, frontendSource) {
  const { ownedInput, identityInput, inputIdentity, rootFile, files, seen,
    declarationVersion, declarationPaths, moduleInput } = prepared;
  let output;
  try {
    output = JSON.parse(response);
  } catch {
    return { status: "tool-error", inputIdentity, message: "invalid frontend response" };
  }
  if (frontendSource?.kind === "owned-go-response") return ownClosureSnapshot(prepared, output, frontendSource, response);
  if (output.status === "error") {
    if (!Array.isArray(output.diagnostics) || output.diagnostics.length === 0
        || output.diagnostics.some(diagnostic => typeof diagnostic.code !== "string"
          || typeof diagnostic.primary?.sourceId !== "string")) {
      return { status: "tool-error", inputIdentity, message: "incomplete frontend diagnostics" };
    }
    return deepFreeze({ status: "error", inputIdentity, diagnostics: output.diagnostics });
  }
  if (output.status !== "ok" || (output.diagnostics?.length ?? 0) !== 0) {
    return { status: "tool-error", inputIdentity, message: "invalid frontend response status" };
  }
  const consumed = output.inputs;
  if (!Array.isArray(consumed) || new Set(consumed).size !== consumed.length
      || canonical(consumed) !== canonical([...consumed].sort())
      || !consumed.includes(rootFile) || declarationPaths.some(name => !consumed.includes(name))
      || consumed.some(name => !seen.has(name))) {
    return { status: "tool-error", inputIdentity, message: "frontend input closure differs from recorded content" };
  }
  if (!Array.isArray(output.functions) || !Array.isArray(output.symbols) || !moduleInput && output.functions.length === 0) {
    return { status: "tool-error", inputIdentity, message: "incomplete frontend response" };
  }
  const snapshotId = snapshotIdentity(inputIdentity, frontendSource);
  const symbols = output.symbols.map(symbol => ({ ...symbol, ref: { snapshotId, id: symbol.id } }));
  const expression = value => ({
    ...value,
    ...(value.symbol ? { symbol: { snapshotId, id: value.symbol } } : {}),
    ...(value.target ? { target: { snapshotId, id: value.target } } : {}),
    ...(value.arguments ? { arguments: value.arguments.map(expression) } : {}),
    ...(value.left ? { left: expression(value.left) } : {}),
    ...(value.right ? { right: expression(value.right) } : {}),
    ...(value.operand ? { operand: expression(value.operand) } : {}),
  });
  const statement = value => ({
    ...value,
    ...(value.symbol ? { symbol: { ...value.symbol, ref: { snapshotId, id: value.symbol.id } } } : {}),
    ...Object.fromEntries(["expression", "initializer", "condition", "target", "value"]
      .filter(key => value[key]).map(key => [key, expression(value[key])])),
    ...Object.fromEntries(["body", "thenBody", "elseBody"]
      .filter(key => value[key]).map(key => [key, value[key].map(statement)])),
  });
  const functions = output.functions.map(fn => ({
    ...fn,
    symbol: { snapshotId, id: fn.symbol },
    parameters: fn.parameters.map(parameter => ({ ...parameter, ref: { snapshotId, id: parameter.id } })),
    body: fn.body.map(statement),
  }));
  const nodes = [];
  const types = [];
  let invalidScalar = false;
  const typeRef = name => {
    if (!["bool", "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "isize", "usize", "f32", "f64"].includes(name)) {
      invalidScalar = true;
      return undefined;
    }
    let type = types.find(item => item.scalar === name);
    if (!type) {
      type = { id: `t${types.length}`, kind: "scalar", scalar: name };
      types.push(type);
    }
    return { snapshotId, id: type.id };
  };
  let currentSourcePath;
  const recordNode = (value, kind) => {
    const node = { id: `n${nodes.length}`, kind, range: value.range, ...(moduleInput ? { sourcePath: currentSourcePath } : {}) };
    nodes.push(node);
    value.node = { snapshotId, id: node.id };
    if (value.type) value.typeRef = typeRef(value.type);
  };
  const recordExpression = value => {
    recordNode(value, value.kind);
    for (const argument of value.arguments ?? []) recordExpression(argument);
    for (const key of ["left", "right", "operand"]) if (value[key]) recordExpression(value[key]);
  };
  const recordStatement = value => {
    recordNode(value, value.kind);
    for (const key of ["expression", "initializer", "condition", "target", "value"])
      if (value[key]) recordExpression(value[key]);
    for (const key of ["body", "thenBody", "elseBody"])
      for (const nested of value[key] ?? []) recordStatement(nested);
  };
  for (const fn of functions) {
    currentSourcePath = fn.sourcePath;
    recordNode(fn, "function");
    fn.returnTypeRef = typeRef(fn.returnType);
    for (const parameter of fn.parameters) recordNode(parameter, "parameter");
    for (const item of fn.body) recordStatement(item);
  }
  const modules = moduleInput && Array.isArray(output.modules) ? output.modules.map(module => ({ ...module,
    initialization: module.initialization.map(statement) })) : undefined;
  if (moduleInput && !modules) return {status:"tool-error",inputIdentity,message:"frontend omitted owned modules"};
  for (const module of modules ?? []) {
    currentSourcePath = module.sourcePath;
    for (const initializer of module.initialization) recordStatement(initializer);
  }
  for (const symbol of symbols) symbol.typeRef = typeRef(symbol.type);
  if (invalidScalar) {
    return { status: "tool-error", inputIdentity, message: "frontend returned an unsupported scalar type" };
  }
  const sourceFile = files.find(file => file.path === rootFile);
  const source = { path: sourceFile.path, content: sourceFile.content };
  const inputs = consumed.map(name => {
    const file = files.find(item => item.path === name);
    return { path: name, sha256: digest(file.content), kind: name === rootFile || moduleInput && !name.endsWith(".d.ts") ? "source"
      : declarationPaths.includes(name) ? "declaration-root" : "declaration-dependency" };
  });
  const snapshot = deepFreeze({ contractVersion: frontendContractVersion, schemaHash: frontendContract.schemaHash,
    snapshotId, inputIdentity, identityInput, frontendSource, capability: declarationVersion, source, inputs, functions, symbols, nodes, types, diagnostics: [],
    ...(moduleInput ? {sources: consumed.map(name=>({path:name,content:files.find(file=>file.path===name).content})),
      modules, compilationClosure:ownedInput.compilationClosure, hostImports:output.hostImports ?? []} : {}) });
  return { status: "ok", snapshot };
}

// This candidate records bytes from the public Go command seam. Hashes identify
// those bytes; they grant no Source executable admission or checker authority.
/** @param {Uint8Array} requestBytes @param {Uint8Array} responseBytes @param {any} origin */
export async function importCapturedFrontendResponse(requestBytes, responseBytes, origin) {
  try {
    if (origin && Object.getOwnPropertyDescriptor(origin, "kind")?.value === "owned-go-exception-response")
      return importExceptionCapturedResponse(requestBytes, responseBytes, origin);
    if (origin && Object.getOwnPropertyDescriptor(origin, "kind")?.value === "owned-go-nullable-response")
      return importNullableCapturedResponse(requestBytes, responseBytes, origin);
    const sourceOrigin = structuredClone(checkClosureOrigin(origin));
    const request = readClosureJson(requestBytes), response = readClosureJson(responseBytes);
    if (sourceOrigin.requestSha256 !== digest(request.bytes) || sourceOrigin.responseSha256 !== digest(response.bytes))
      throw Object.assign(new TypeError("captured bytes differ from origin"), { code: "r03-closure-identity" });
    const prepared = await prepareFrontendInput(request.value, true);
    if (prepared.status !== "ready") return prepared;
    prepared.captureRequest = request.text;
    return materializeFrontendResponse(prepared, response.text, sourceOrigin);
  } catch (error) {
    return deepFreeze({ status: "error", diagnostics: [{ code: error.code?.startsWith("r03-") ? error.code : "r03-closure-schema",
      ruleId: error.ruleId ?? "r01-input-boundary", phase: "frontend", message: error.message ?? "invalid captured frontend response",
      ...(error.primary ? { primary: error.primary } : {}) }] });
  }
}
