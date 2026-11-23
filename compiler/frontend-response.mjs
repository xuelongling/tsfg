// SPDX-License-Identifier: MIT
import { importModuleCallableFacts, verifyModuleCallableSnapshot } from './module-callable-facts.mjs';
import { familyOf, requestFamily } from './module-callable-common.mjs';
export { importModuleCallableFacts } from './module-callable-facts.mjs';
import { createHash } from "node:crypto";
import { importExceptionCapturedResponse } from "./exception-frontend.mjs";
import { importNullableCapturedResponse, matchesNullableSnapshot } from "./nullable-frontend.mjs";
import { ownClosureSnapshot, matchesClosureSnapshot } from "./closure-frontend.mjs";
import { readJson as readClosureJson, origin as checkClosureOrigin, capturedDeclarationProfiles } from "./closure-common.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { admittedInputScope } from "./conversions.mjs";
import { normalizeClosure } from "./modules.mjs";
import contractRegistry from "../contracts/registry.json" with { type: "json" };
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };

const frontendContract = contractRegistry["tsfg.frontend-snapshot"];
export const frontendContractVersion = frontendContract.semver;

export const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** @param {string} left @param {string} right */
const compareUtf8 = (left, right) => Buffer.from(left).compare(Buffer.from(right));

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
  if (familyOf(snapshot) === 'tsfg.frontend-module-callable-candidate') {
    try { verifyModuleCallableSnapshot(snapshot); return true; } catch { return false; }
  }
  if (snapshot?.format?.family === "tsfg.frontend-nullable-candidate") return matchesNullableSnapshot(snapshot);
  if (snapshot?.format?.family === "tsfg.frontend-closure-candidate") return matchesClosureSnapshot(snapshot);
  let matchesInput = false;
  try {
    const claim = snapshot?.identityInput;
    const files = new Map(claim.files.map(file => [file.path, file.content]));
    matchesInput = admittedInputScope(claim, snapshot.inputIdentity)
      // Formal 0.10 owns only the retained function-only scope and response.
      && Object.keys(snapshot).sort().join(",") === ["capability", "contractVersion", "diagnostics", "frontendSource", "functions",
        "identityInput", "inputIdentity", "inputs", "nodes", "schemaHash", "snapshotId", "source", "symbols", "types"].join(",")
      && Object.keys(claim).sort().join(",") === ["config", "declarations", "files", "rootFile", "sourceRoot",
        ...(claim.target === undefined ? [] : ["target"])].sort().join(",")
      && files.size === claim.files.length
      && claim.rootFile === snapshot.source?.path
      && files.get(claim.rootFile) === snapshot.source.content
      && claim.declarations.version === snapshot.capability
      && (!["minimal-integers-v3", "minimal-floats-v4", "minimal-conversions-v5"].includes(snapshot.capability) || canonical(claim.target) === canonical({ ...bytecodeSchema.target, pointerBits: "64" }))
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
        .sort((a, b) => compareUtf8(String(a.path), String(b.path)))
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
  const integerInput = ["minimal-integers-v3", "minimal-floats-v4", "minimal-conversions-v5"].includes(ownedInput?.declarations?.version);
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
    : declarationVersion === "minimal-floats-v4" ? "minimal-floats-v4.d.ts"
    : declarationVersion === "minimal-conversions-v5" ? "minimal-conversions-v5.d.ts" : null;
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

const expressionChildren = ["left", "right", "operand"];
const statementExpressions = ["expression", "initializer", "condition", "target", "value"];
const statementBodies = ["body", "thenBody", "elseBody"];
const responseRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

function isResponseExpression(value) {
  return responseRecord(value)
    && (value.arguments == null || Array.isArray(value.arguments) && value.arguments.every(isResponseExpression))
    && expressionChildren.every(key => value[key] == null || isResponseExpression(value[key]));
}

function isResponseBody(value) {
  return Array.isArray(value) && value.every(statement => responseRecord(statement)
    && statementExpressions.every(key => statement[key] == null || isResponseExpression(statement[key]))
    && statementBodies.every(key => statement[key] == null || isResponseBody(statement[key])));
}

/** @param {unknown} diagnostics @param {{path: string, content: string}[]} files */
function matchesDiagnosticSources(diagnostics, files) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return false;
  // The locked Source VFS removes one leading UTF-8 BOM before parsing.
  const sources = new Map(files.map(({ path, content }) =>
    [path, content.startsWith("\uFEFF") ? content.slice(1) : content]));
  /** @type {Map<string, number[]>} */
  const lineStarts = new Map();
  return diagnostics.every(diagnostic => {
    if (!responseRecord(diagnostic) || typeof diagnostic.code !== "string" || !diagnostic.code.trim()
        || !responseRecord(diagnostic.primary) || !responseRecord(diagnostic.range)) return false;
    const { file, range, primary } = diagnostic;
    const { sourceId, start, end, startLine, startColumn, endLine, endColumn } = primary;
    const source = sources.get(sourceId);
    if (source === undefined || file !== sourceId || start !== range.start || end !== range.end
        || ![start, end, startLine, startColumn, endLine, endColumn].every(Number.isSafeInteger)
        || start < 0 || end < start || end > source.length) return false;
    let starts = lineStarts.get(sourceId);
    if (!starts) {
      starts = [0];
      for (const lineBreak of source.matchAll(/\r\n|[\r\n\u2028\u2029]/g))
        starts.push(lineBreak.index + lineBreak[0].length);
      lineStarts.set(sourceId, starts);
    }
    const matchesPosition = (offset, line, column) => column >= 0
      && offset === starts[line] + column && offset < (starts[line + 1] ?? source.length + 1);
    return matchesPosition(start, startLine, startColumn) && matchesPosition(end, endLine, endColumn);
  });
}

/** Shared owned conversion for the locked transport and captured Go responses.
 * @param {any} prepared @param {string | Uint8Array} response @param {any} frontendSource
 */
export function materializeFrontendResponse(prepared, response, frontendSource) {
  const { ownedInput, identityInput, inputIdentity, rootFile, files, seen,
    declarationVersion, declarationPaths, moduleInput } = prepared;
  const invalid = { status: "tool-error", inputIdentity, message: "invalid frontend response" };
  const incomplete = { status: "tool-error", inputIdentity, message: "incomplete frontend response" };
  let output, responseText;
  try {
    responseText = typeof response === "string" ? response : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(response);
    output = JSON.parse(responseText);
  } catch {
    return invalid;
  }
  if (output === null || typeof output !== "object" || Array.isArray(output)) return invalid;
  if (frontendSource?.kind === "owned-go-response") return ownClosureSnapshot(prepared, output, frontendSource, responseText);
  if (output.status === "error") {
    if (!matchesDiagnosticSources(output.diagnostics, files)) {
      return { status: "tool-error", inputIdentity, message: "incomplete frontend diagnostics" };
    }
    return deepFreeze({ status: "error", inputIdentity, diagnostics: output.diagnostics });
  }
  if (output.status !== "ok" || (output.diagnostics?.length ?? 0) !== 0) {
    return { status: "tool-error", inputIdentity, message: "invalid frontend response status" };
  }
  const consumed = output.inputs;
  const consumedPaths = new Set(Array.isArray(consumed) ? consumed : []);
  const requestedModules = moduleInput ? files.filter(file => !file.path.endsWith(".d.ts")).map(file => file.path) : [];
  const invalidInputClosure = { status: "tool-error", inputIdentity, message: "frontend input closure differs from recorded content" };
  // The Go frontend orders consumed paths by their UTF-8 bytes.
  if (!Array.isArray(consumed) || consumedPaths.size !== consumed.length
      || consumed.some(name => !seen.has(name))
      || canonical(consumed) !== canonical([...consumed].sort(compareUtf8))
      || !consumedPaths.has(rootFile) || declarationPaths.some(name => !consumedPaths.has(name))
      || requestedModules.some(name => !consumedPaths.has(name))) {
    return invalidInputClosure;
  }
  if (!Array.isArray(output.functions) || !Array.isArray(output.symbols) || !output.symbols.every(responseRecord)
      || !moduleInput && output.functions.length === 0
      || output.functions.some(fn => !responseRecord(fn) || !Array.isArray(fn.parameters) || !Array.isArray(fn.parameterInitializers)
        || fn.parameterInitializers.length !== fn.parameters.length
        || fn.parameters.some(parameter => !responseRecord(parameter) || !responseRecord(parameter.presence))
        || !fn.parameterInitializers.every(value => value === null || isResponseExpression(value))
        || !isResponseBody(fn.body))) {
    return incomplete;
  }
  if (moduleInput) {
    if (!Array.isArray(output.modules))
      return { status: "tool-error", inputIdentity, message: "frontend omitted owned modules" };
    if (!output.modules.every(module => responseRecord(module) && isResponseBody(module.initialization)))
      return incomplete;
    const returnedModules = new Set(output.modules.map(module => module.sourcePath));
    if (output.modules.length !== requestedModules.length || requestedModules.some(name => !returnedModules.has(name)))
      return invalidInputClosure;
  }
  const snapshotId = snapshotIdentity(inputIdentity, frontendSource);
  const symbols = output.symbols.map(symbol => ({ ...symbol, ref: { snapshotId, id: symbol.id } }));
  const expression = value => ({
    ...value,
    ...(value.conversion ? { conversion: { ...value.conversion, inputIdentity } } : {}),
    ...(value.symbol ? { symbol: { snapshotId, id: value.symbol } } : {}),
    ...(value.target ? { target: { snapshotId, id: value.target } } : {}),
    ...(value.arguments ? { arguments: value.arguments.map(expression) } : {}),
    ...Object.fromEntries(expressionChildren.filter(key => value[key]).map(key => [key, expression(value[key])])),
  });
  const statement = value => ({
    ...value,
    ...(value.symbol ? { symbol: { ...value.symbol, ref: { snapshotId, id: value.symbol.id } } } : {}),
    ...Object.fromEntries(statementExpressions
      .filter(key => value[key]).map(key => [key, expression(value[key])])),
    ...Object.fromEntries(statementBodies
      .filter(key => value[key]).map(key => [key, value[key].map(statement)])),
  });
  const functions = output.functions.map(fn => ({
    ...fn,
    symbol: { snapshotId, id: fn.symbol },
    parameters: fn.parameters.map(parameter => ({ ...parameter, ref: { snapshotId, id: parameter.id } })),
    parameterInitializers: fn.parameterInitializers.map(value => value ? expression(value) : null),
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
    for (const key of expressionChildren) if (value[key]) recordExpression(value[key]);
  };
  const recordStatement = value => {
    recordNode(value, value.kind);
    for (const key of statementExpressions)
      if (value[key]) recordExpression(value[key]);
    for (const key of statementBodies)
      for (const nested of value[key] ?? []) recordStatement(nested);
  };
  for (const fn of functions) {
    currentSourcePath = fn.sourcePath;
    recordNode(fn, "function");
    fn.returnTypeRef = typeRef(fn.returnType);
    for (const parameter of fn.parameters) recordNode(parameter, "parameter");
    for (const value of fn.parameterInitializers) if (value) recordExpression(value);
    for (const item of fn.body) recordStatement(item);
  }
  const modules = moduleInput ? output.modules.map(module => ({ ...module,
    initialization: module.initialization.map(statement) })) : undefined;
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
  if (requestFamily(requestBytes) === 'tsfg.module-callable-facts-request-candidate')
    return importModuleCallableFacts(requestBytes, responseBytes, origin);
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
