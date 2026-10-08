// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sourceLock from "../eng/frontend-source.lock.json" with { type: "json" };
import contractRegistry from "../contracts/registry.json" with { type: "json" };
import { conversionDeclaration, conversionEntries, verifyConversionOrigin, conversionCallSpelling, admittedConversionScope, admittedInputScope, completeFunctionSource } from "./conversions.mjs";
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };
import { validParameterPresence } from "./presence.mjs";

const frontendContract = contractRegistry["tsfg.frontend-snapshot"];
export const frontendContractVersion = frontendContract.semver;

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function skipCallTrivia(source) {
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index++;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return -1;
      index = end + 2;
    } else if (source.startsWith("//", index)) {
      index += 2;
      while (index < source.length && !/[\r\n\u2028\u2029]/.test(source[index])) index++;
    } else {
      return index;
    }
  }
  return index;
}

function hasCallArgumentList(source) {
  const index = skipCallTrivia(source);
  return index >= 0 && source[index] === "(";
}

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

// Compare an already officially checked identifier's source spelling with
// its decoded owned name. This reads original spans, never upstream AST data.
export function identifierName(spelling) {
  const trivia = "(?:\\s|/\\*(?:(?!\\*/)[\\s\\S])*\\*/|//[^\\r\\n\\u2028\\u2029]*)";
  spelling = spelling.replace(new RegExp(`^${trivia}*`), "")
    .replace(new RegExp(`${trivia}*$`), "");
  const name = spelling.replace(/\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g,
    (_, point, unit) => String.fromCodePoint(Number.parseInt(point ?? unit, 16)));
  if (!/^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(name))
    throw new TypeError("invalid source identifier spelling");
  return name;
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
    matchesInput = admittedInputScope(claim, snapshot.inputIdentity)
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
        && file.kind === (file.path === claim.rootFile ? "source"
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
  const integerInput = ["minimal-integers-v3", "minimal-floats-v4", "minimal-conversions-v5"].includes(ownedInput?.declarations?.version);
  if (Object.keys(ownedInput ?? {}).sort().join(",") !== (integerInput ? "config,declarations,files,rootFile,sourceRoot,target" : "config,declarations,files,rootFile,sourceRoot")
      || (integerInput && canonical(ownedInput.target) !== canonical({ ...bytecodeSchema.target, pointerBits: "64" }))
      || Object.keys(ownedInput?.declarations ?? {}).sort().join(",") !== "paths,version"
      || typeof root !== "string" || !root.startsWith("/") || path.posix.normalize(root) !== root
      || typeof rootFile !== "string" || !rootFile.endsWith(".ts") || rootFile.endsWith(".d.ts")
      || !Array.isArray(files) || files.length === 0 || files.some(file => {
        if (typeof file?.path !== "string" || typeof file.content !== "string"
            || !["content,path", "content,path,sha256"].includes(Object.keys(file).sort().join(","))
            || !file.path.startsWith(`${root}/`) || path.posix.normalize(file.path) !== file.path
            || (file.path !== rootFile && !file.path.endsWith(".d.ts")) || seen.has(file.path)
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
      || declared?.content !== declarationBytes) {
    return rejectInput(inputIdentity, declared?.path ?? rootFile);
  }
  if (typeof executable !== "string" || !executable) {
    return { status: "tool-error", inputIdentity, message: "frontend executable is required" };
  }
  let binary;
  try {
    binary = await readFile(executable);
  } catch {
    return { status: "tool-error", inputIdentity, message: "frontend executable is unavailable" };
  }
  const binarySha256 = digest(binary);
  if (binarySha256 !== sourceLock.executableSha256) {
    return { status: "tool-error", inputIdentity, message: "frontend executable differs from locked source build" };
  }
  if (sourceLock.contractVersion !== frontendContractVersion) {
    return { status: "tool-error", inputIdentity, message: "frontend source and snapshot contracts differ" };
  }
  const frontendSource = { forkOid: sourceLock.forkOid, binarySha256 };
  const child = spawnSync(executable, [], {
    input: JSON.stringify(ownedInput), encoding: "utf8", windowsHide: true,
    timeout: 300000, maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error || child.status !== 0) {
    return { status: "tool-error", inputIdentity, message: child.error?.message ?? child.stderr };
  }
  let output;
  try {
    output = JSON.parse(child.stdout);
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
  if (!Array.isArray(output.functions) || !Array.isArray(output.symbols) || output.functions.length === 0) {
    return { status: "tool-error", inputIdentity, message: "incomplete frontend response" };
  }
  const snapshotId = snapshotIdentity(inputIdentity, frontendSource);
  const symbols = output.symbols.map(symbol => ({ ...symbol, ref: { snapshotId, id: symbol.id } }));
  const expression = value => ({
    ...value,
    ...(value.conversion ? { conversion: { ...value.conversion, inputIdentity } } : {}),
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
    parameterInitializers: (fn.parameterInitializers ?? fn.parameters.map(() => null)).map(value => value ? expression(value) : null),
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
  const recordNode = (value, kind) => {
    const node = { id: `n${nodes.length}`, kind, range: value.range };
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
    recordNode(fn, "function");
    fn.returnTypeRef = typeRef(fn.returnType);
    for (const parameter of fn.parameters) recordNode(parameter, "parameter");
    for (const initializer of fn.parameterInitializers) if (initializer) recordExpression(initializer);
    for (const item of fn.body) recordStatement(item);
  }
  for (const symbol of symbols) symbol.typeRef = typeRef(symbol.type);
  if (invalidScalar) {
    return { status: "tool-error", inputIdentity, message: "frontend returned an unsupported scalar type" };
  }
  const sourceFile = files.find(file => file.path === rootFile);
  const source = { path: sourceFile.path, content: sourceFile.content };
  const inputs = consumed.map(name => {
    const file = files.find(item => item.path === name);
    return { path: name, sha256: digest(file.content), kind: name === rootFile ? "source"
      : declarationPaths.includes(name) ? "declaration-root" : "declaration-dependency" };
  });
  const snapshot = deepFreeze({ contractVersion: frontendContractVersion,
    schemaHash: frontendContract.schemaHash, snapshotId, inputIdentity, identityInput,
    frontendSource, capability: declarationVersion, source, inputs, functions, symbols, nodes, types, diagnostics: [] });
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
  let calls = 0;
  const completeSource = completeFunctionSource(snapshot.source.content, snapshot.functions, identifierName);
  const usedNodes = new Set();
  const sameRange = (left, right) => left?.start === right?.start && left?.end === right?.end;
  const sourceSpan = range => {
    if (!Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end)
        || range.start < 0 || range.end <= range.start
        || range.end > snapshot.source.content.length) {
      throw new TypeError("invalid source range");
    }
    return snapshot.source.content.slice(range.start, range.end).trim();
  };
  const checkNode = (value, kind) => {
    const node = resolveNode(snapshot, value.node);
    if (node.kind !== kind || !sameRange(node.range, value.range)
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
    resolveSymbol(snapshot, symbol.ref);
    checkType(symbol.type, symbol.typeRef);
    if (identifierName(sourceSpan(symbol.range)) !== symbol.name) {
      throw new TypeError("symbol differs from its source declaration");
    }
  }
  const visitExpression = (expression, scope) => {
    if (!expression || typeof expression !== "object") throw new TypeError("invalid expression");
    checkNode(expression, expression.kind);
    checkType(expression.type, expression.typeRef);
    if (expression.kind === "reference") {
      const symbol = resolveSymbol(snapshot, expression.symbol);
      if (scope.get(symbol.name) !== symbol.id || symbol.name !== identifierName(sourceSpan(expression.range))
          || symbol.type !== expression.type) {
        throw new TypeError("reference differs from its symbol");
      }
    } else if (expression.symbol) {
      throw new TypeError("non-reference expression has a symbol");
    }
    if (expression.kind === "absence") {
      if (Object.keys(expression).sort().join(",") !== "absence,kind,node,range,type,typeRef"
          || !["undefined","null"].includes(expression.absence)
          || sourceSpan(expression.range).trim() !== expression.absence
          || expression.absence === "undefined" && scope.has("undefined"))
        throw new TypeError("absence differs from its checked builtin source");
    }
    if (expression.kind === "update") {
      const symbol = resolveSymbol(snapshot, expression.operand?.symbol);
      if (Object.keys(expression).sort().join(",") !== "kind,node,operand,operator,prefix,range,type,typeRef"
          || expression.operand?.kind !== "reference" || !symbol.writable
          || !["local", "parameter"].includes(symbol.kind)
          || !["++", "--"].includes(expression.operator) || typeof expression.prefix !== "boolean"
          || expression.type !== symbol.type)
        throw new TypeError("update differs from its checked local binding or types");
    }
    if (expression.kind === "write") {
      const left = expression.left;
      const symbol = resolveSymbol(snapshot, left?.symbol);
      if (Object.keys(expression).sort().join(",") !== "kind,left,node,operator,range,right,type,typeRef"
          || left?.kind !== "reference" || !symbol.writable
          || !["local", "parameter"].includes(symbol.kind)
          || !["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||="].includes(expression.operator)
          || expression.type !== symbol.type || expression.right?.type !== (["<<=", ">>=", ">>>="].includes(expression.operator) ? "i32" : symbol.type))
        throw new TypeError("write differs from its checked local binding or types");
    }
    if (expression.kind === "conversion") {
      const origin = expression.conversion, entry = conversionEntries.get(origin?.entryId);
      const declaration = snapshot.inputs.find(file => file.path === origin?.declarationPath);
      if (!completeSource || !verifyConversionOrigin(origin, snapshot.inputIdentity) || snapshot.capability !== conversionDeclaration.version
          || !admittedConversionScope(snapshot.identityInput, snapshot.inputIdentity)
          || origin.declarationPath !== snapshot.identityInput.declarations.paths[0]
          || snapshot.functions.some(fn => fn.name === entry.name)
          || declaration?.kind !== "declaration-root" || declaration.sha256 !== conversionDeclaration.sha256
          || expression.type !== entry.to || expression.operand?.type !== entry.from
          || Object.keys(expression).sort().join(",") !== "conversion,kind,node,operand,range,type,typeRef"
          || scope.has(entry.name)
          || !conversionCallSpelling(snapshot.source.content, expression.range, expression.operand.range, entry)) {
        throw new TypeError("conversion differs from admitted declaration origin or nominal types");
      }
    } else if (expression.conversion) {throw new TypeError("non-conversion expression has conversion origin");}
    if (expression.kind === "call" && !expression.target) {
      throw new TypeError("call has no target");
    }
    if (expression.target) {
      const target = resolveSymbol(snapshot, expression.target);
      const fn = snapshot.functions.find(item => item.symbol.id === target.id);
      const parameters = fn?.parameters?.map(parameter => parameter.type);
      const arguments_ = expression.arguments;
      const sourceCall = sourceSpan(expression.range);
      const start = skipCallTrivia(sourceCall);
      const spelling = (start < 0 ? "" : sourceCall.slice(start)).match(/^(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[^\\\s(/])+/u)?.[0];
      if (expression.kind !== "call" || !fn || !Array.isArray(parameters)
          || !Array.isArray(arguments_) || !Array.isArray(expression.signature?.parameters)
          || !spelling || identifierName(spelling) !== target.name
          || !hasCallArgumentList(sourceCall.slice(start + spelling.length))
          || expression.signature.returnType !== fn.returnType
          || expression.type !== fn.returnType
          || expression.signature.parameters.length !== parameters.length
          || arguments_.length > parameters.length
          || canonical(expression.signature.presence ?? []) !== canonical(fn.parameters.map(parameter => parameter.presence))
          || parameters.slice(arguments_.length).some((_,index) => !fn.parameters[arguments_.length+index].presence?.optional)
          || parameters.some((type, index) => expression.signature.parameters[index] !== type
            || index < arguments_.length && (arguments_[index]?.type !== type
              || arguments_[index]?.kind === "absence" && !fn.parameters[index].presence?.[arguments_[index].absence]))) {
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
    checkNode(fn, "function");
    checkType(fn.returnType, fn.returnTypeRef);
    const definition = resolveSymbol(snapshot, fn.symbol);
    if (definition.kind !== "function" || definition.name !== fn.name
        || definition.type !== fn.returnType
        || identifierName(sourceSpan(definition.range)) !== fn.name
        || definition.range?.start < fn.range?.start
        || definition.range?.end > fn.range?.end) {
      throw new TypeError("function differs from its symbol");
    }
    if (!Array.isArray(fn.parameters) || !Array.isArray(fn.body) || !Array.isArray(fn.parameterInitializers)
        || fn.parameterInitializers.length !== fn.parameters.length) {
      throw new TypeError("invalid function structure");
    }
    const parameterScope = new Map(fn.parameters.map(parameter => [parameter.name, parameter.id]));
    for (const [index, parameter] of fn.parameters.entries()) {
      checkNode(parameter, "parameter");
      checkType(parameter.type, parameter.typeRef);
      const symbol = resolveSymbol(snapshot, parameter.ref);
      if (symbol.id !== parameter.id || symbol.kind !== "parameter"
          || symbol.name !== parameter.name || symbol.type !== parameter.type
          || canonical(symbol.presence) !== canonical(parameter.presence)
          || !validParameterPresence(parameter.presence,parameter,fn.parameterInitializers[index],snapshot.source.content,fn.range)
          || !sameRange(symbol.range, parameter.range)) {
        throw new TypeError("parameter differs from its symbol");
      }
      if (fn.parameterInitializers[index]) visitExpression(fn.parameterInitializers[index],parameterScope);
    }
    visitStatements(fn.body, parameterScope);
  }
  if (usedNodes.size !== snapshot.nodes.length) throw new TypeError("unused snapshot node");
  return deepFreeze({ snapshotId: snapshot.snapshotId, functions: snapshot.functions.length, calls });
}
