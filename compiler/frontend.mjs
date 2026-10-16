// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runLockedFrontend } from "./frontend-execution.mjs";
import { normalizeClosure } from "./modules.mjs";
import { validateModuleFacts, skipCallTrivia, hasCallArgumentList, identifierName, staticBindingName } from "./module-facts.mjs";
import contractRegistry from "../contracts/registry.json" with { type: "json" };
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };

const frontendContract = contractRegistry["tsfg.frontend-snapshot"];
export const frontendContractVersion = frontendContract.semver;

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

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

function deepFreeze(value) {
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

function matchesSnapshotContract(snapshot) {
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

/** @param {any} input @param {{ executable?: string }} [options] */
export async function analyzeFrontend(input, { executable } = {}) {
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
      || declared?.content !== declarationBytes) {
    return rejectInput(inputIdentity, declared?.path ?? rootFile);
  }
  const execution = await runLockedFrontend(JSON.stringify(ownedInput), { executable });
  if (execution.status !== "ok") return { status: "tool-error", inputIdentity, message: execution.message };
  const frontendSource = execution.frontendSource;
  let output;
  try {
    output = JSON.parse(execution.stdout);
  } catch {
    return { status: "tool-error", inputIdentity, message: "invalid frontend response" };
  }
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
  const snapshot = deepFreeze({ contractVersion: frontendContractVersion,
    schemaHash: frontendContract.schemaHash, snapshotId, inputIdentity, identityInput,
    frontendSource, capability: declarationVersion, source, inputs, functions, symbols, nodes, types, diagnostics: [],
    ...(moduleInput ? {sources: consumed.map(name=>({path:name,content:files.find(file=>file.path===name).content})),
      modules, compilationClosure:ownedInput.compilationClosure, hostImports:output.hostImports ?? []} : {}) });
  return { status: "ok", snapshot };
}

function resolveLocal(snapshot, ref, collection) {
  if (!matchesSnapshotContract(snapshot) || !ref
      || Object.keys(ref).sort().join(",") !== "id,snapshotId"
      || typeof ref.id !== "string" || ref.snapshotId !== snapshot.snapshotId) {
    throw new TypeError("reference belongs to a different snapshot or contract");
  }
  const value = snapshot[collection]?.find(item => item.id === ref.id);
  if (!value) throw new RangeError("unknown snapshot reference");
  return value;
}

export function resolveSymbol(snapshot, ref) {
  const symbol = resolveLocal(snapshot, ref, "symbols");
  if (symbol.ref?.snapshotId !== snapshot.snapshotId || symbol.ref?.id !== symbol.id) {
    throw new TypeError("symbol definition has a foreign reference");
  }
  return symbol;
}

export const resolveNode = (snapshot, ref) => resolveLocal(snapshot, ref, "nodes");
export const resolveType = (snapshot, ref) => resolveLocal(snapshot, ref, "types");

export function validateFrontendSnapshot(snapshot) {
  if (!matchesSnapshotContract(snapshot)
      || !Array.isArray(snapshot.functions) || !Array.isArray(snapshot.symbols)
      || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.types)
      || typeof snapshot.source?.content !== "string"
      || snapshot.inputs?.find(file => file.path === snapshot.source.path)?.sha256 !== digest(snapshot.source.content)) {
    throw new TypeError("unsupported frontend snapshot contract");
  }
  const moduleFacts = snapshot.modules ? validateModuleFacts(snapshot) : undefined;
  let source = snapshot.source;
  let calls = 0;
  const usedNodes = new Set();
  const sameRange = (left, right) => left?.start === right?.start && left?.end === right?.end;
  const sourceSpan = range => {
    if (!Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end)
        || range.start < 0 || range.end <= range.start
        || range.end > source.content.length) {
      throw new TypeError("invalid source range");
    }
    return source.content.slice(range.start, range.end).trim();
  };
  const checkNode = (value, kind) => {
    const node = resolveNode(snapshot, value.node);
    if (node.kind !== kind || !sameRange(node.range, value.range)
        || moduleFacts && node.sourcePath !== source.path
        || usedNodes.has(node.id)) {
      throw new TypeError("node differs from its reference");
    }
    sourceSpan(value.range);
    usedNodes.add(node.id);
  };
  const checkType = (name, ref) => {
    const type = resolveType(snapshot, ref);
    if (type.kind !== "scalar" || type.scalar !== name) throw new TypeError("type differs from its reference");
  };
  if (new Set(snapshot.symbols.map(symbol => symbol.id)).size !== snapshot.symbols.length
      || new Set(snapshot.nodes.map(node => node.id)).size !== snapshot.nodes.length
      || new Set(snapshot.types.map(type => type.id)).size !== snapshot.types.length
      || new Set(snapshot.types.map(type => type.scalar)).size !== snapshot.types.length) {
    throw new TypeError("duplicate snapshot definition");
  }
  for (const symbol of snapshot.symbols) {
    if (moduleFacts) { source=moduleFacts.sources.get(symbol.sourcePath); if(!source) throw new TypeError("symbol has foreign source"); }
    resolveSymbol(snapshot, symbol.ref);
    checkType(symbol.type, symbol.typeRef);
    const syntheticDefault = moduleFacts && (symbol.bindingKind === "default-export-expression" && symbol.kind === "global"
      && moduleFacts.modules.get(symbol.sourcePath)?.exports.some(binding=>binding.name==="default" && binding.target===symbol.id)
      || symbol.name === "default" && symbol.kind === "function"
      && /^export\s+default\s+function\s*\(/.test(sourceSpan(symbol.range)));
    if (!syntheticDefault && identifierName(sourceSpan(symbol.range)) !== symbol.name) {
      throw new TypeError("symbol differs from its source declaration");
    }
  }
  const visitExpression = (expression, scope) => {
    if (!expression || typeof expression !== "object") throw new TypeError("invalid expression");
    checkNode(expression, expression.kind);
    checkType(expression.type, expression.typeRef);
    if (expression.kind === "reference") {
      const symbol = resolveSymbol(snapshot, expression.symbol);
      const name=moduleFacts ? expression.name : symbol.name;
      if (scope.get(name) !== symbol.id || (moduleFacts ? staticBindingName(name) !== staticBindingName(sourceSpan(expression.range))
          : name !== identifierName(sourceSpan(expression.range)))
          || symbol.type !== expression.type) {
        throw new TypeError("reference differs from its symbol");
      }
    } else if (expression.symbol) {
      throw new TypeError("non-reference expression has a symbol");
    }
    if (expression.kind === "call" && !expression.target) {
      throw new TypeError("call has no target");
    }
    if (expression.target) {
      const target = resolveSymbol(snapshot, expression.target);
      const fn = snapshot.functions.find(item => item.symbol.id === target.id)
        ?? snapshot.hostImports?.find(item=>item.symbol===target.id);
      const parameters = fn?.parameterTypes ?? fn?.parameters?.map(parameter => parameter.type);
      const arguments_ = expression.arguments;
      const sourceCall = sourceSpan(expression.range);
      const start = skipCallTrivia(sourceCall);
      const spelling = moduleFacts ? sourceCall.slice(start,sourceCall.indexOf("(",start)).trim()
        : (start < 0 ? "" : sourceCall.slice(start)).match(/^(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[^\\\s(/])+/u)?.[0];
      if (expression.kind !== "call" || !fn || !Array.isArray(parameters)
          || !Array.isArray(arguments_) || !Array.isArray(expression.signature?.parameters)
          || !spelling || (moduleFacts ? staticBindingName(spelling) !== staticBindingName(expression.name)
              : identifierName(spelling) !== target.name)
          || moduleFacts && scope.get(expression.name) !== target.id
          || !hasCallArgumentList(sourceCall.slice(start + spelling.length))
          || expression.signature.returnType !== fn.returnType
          || expression.type !== fn.returnType
          || expression.signature.parameters.length !== parameters.length
          || arguments_.length !== parameters.length
          || parameters.some((type, index) => expression.signature.parameters[index] !== type
            || arguments_[index]?.type !== type)) {
        throw new TypeError("call signature differs from its target or arguments");
      }
      calls++;
    }
    if (expression.arguments) {
      if (!Array.isArray(expression.arguments)) throw new TypeError("invalid call arguments");
      for (const argument of expression.arguments) visitExpression(argument, scope);
    }
    for (const key of ["left", "right", "operand"])
      if (expression[key]) visitExpression(expression[key], scope);
  };
  const visitStatements = (statements, parent) => {
    const scope = new Map(parent);
    for (const statement of statements) {
      visitStatement(statement, scope);
      if (statement.symbol) scope.set(statement.symbol.name, statement.symbol.id);
    }
  };
  const visitStatement = (statement, scope) => {
    checkNode(statement, statement.kind);
    if (statement.symbol) {
      const symbol = resolveSymbol(snapshot, statement.symbol.ref);
      if (symbol.id !== statement.symbol.id || symbol.name !== statement.symbol.name
          || symbol.kind !== statement.symbol.kind || symbol.type !== statement.symbol.type
          || !sameRange(symbol.range, statement.symbol.range)
          || symbol.range?.start < statement.range?.start
          || symbol.range?.end > statement.range?.end) {
        throw new TypeError("statement differs from its symbol");
      }
    }
    for (const key of ["expression", "initializer", "condition", "target", "value"])
      if (statement[key]) visitExpression(statement[key], scope);
    for (const key of ["body", "thenBody", "elseBody"]) {
      if (statement[key] && !Array.isArray(statement[key])) throw new TypeError("invalid statement body");
      if (statement[key]) visitStatements(statement[key], scope);
    }
  };
  for (const fn of snapshot.functions) {
    if (moduleFacts) { source=moduleFacts.sources.get(fn.sourcePath); if(!source || !moduleFacts.modules.has(fn.sourcePath)) throw new TypeError("function has foreign module source"); }
    checkNode(fn, "function");
    checkType(fn.returnType, fn.returnTypeRef);
    const definition = resolveSymbol(snapshot, fn.symbol);
    if (definition.kind !== "function" || definition.name !== fn.name
        || moduleFacts && definition.sourcePath !== fn.sourcePath
        || definition.type !== fn.returnType
        || !(moduleFacts && fn.name === "default" && /^export\s+default\s+function\s*\(/.test(sourceSpan(definition.range)))
          && identifierName(sourceSpan(definition.range)) !== fn.name
        || definition.range?.start < fn.range?.start
        || definition.range?.end > fn.range?.end) {
      throw new TypeError("function differs from its symbol");
    }
    if (!Array.isArray(fn.parameters) || !Array.isArray(fn.body)) {
      throw new TypeError("invalid function structure");
    }
    const parameterScope = new Map(moduleFacts?.views.get(fn.sourcePath) ?? []);
    for (const parameter of fn.parameters) parameterScope.set(parameter.name,parameter.id);
    for (const parameter of fn.parameters) {
      checkNode(parameter, "parameter");
      checkType(parameter.type, parameter.typeRef);
      const symbol = resolveSymbol(snapshot, parameter.ref);
      if (symbol.id !== parameter.id || symbol.kind !== "parameter"
          || symbol.name !== parameter.name || symbol.type !== parameter.type
          || !sameRange(symbol.range, parameter.range)) {
        throw new TypeError("parameter differs from its symbol");
      }
    }
    visitStatements(fn.body, parameterScope);
  }
  for (const module of snapshot.modules ?? []) {
    source=moduleFacts.sources.get(module.sourcePath);
    visitStatements(module.initialization,moduleFacts.views.get(module.sourcePath));
  }
  if (usedNodes.size !== snapshot.nodes.length) throw new TypeError("unused snapshot node");
  return deepFreeze({ snapshotId: snapshot.snapshotId, functions: snapshot.functions.length, calls });
}
