// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sourceLock from "../eng/frontend-source.lock.json" with { type: "json" };
import contractRegistry from "../contracts/registry.json" with { type: "json" };

const frontendContract = contractRegistry["tsfg.frontend-snapshot"];
export const frontendContractVersion = frontendContract.semver;

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
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
  return snapshot?.contractVersion === frontendContractVersion
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
  if (Object.keys(ownedInput ?? {}).sort().join(",") !== "config,declarations,files,rootFile,sourceRoot"
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
    : declarationVersion === "minimal-scalars-v2" ? "minimal-scalars-v2.d.ts" : null;
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
  if (output.status !== "ok") {
    return deepFreeze({ status: "error", inputIdentity, diagnostics: output.diagnostics ?? [] });
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
    ...(value.symbol ? { symbol: { snapshotId, id: value.symbol } } : {}),
    ...(value.target ? { target: { snapshotId, id: value.target } } : {}),
    ...(value.arguments ? { arguments: value.arguments.map(expression) } : {}),
  });
  const functions = output.functions.map(fn => ({
    ...fn,
    symbol: { snapshotId, id: fn.symbol },
    parameters: fn.parameters.map(parameter => ({ ...parameter, ref: { snapshotId, id: parameter.id } })),
    body: fn.body.map(statement => ({
      ...statement,
      ...(statement.symbol ? { symbol: { ...statement.symbol, ref: { snapshotId, id: statement.symbol.id } } } : {}),
      ...(statement.expression ? { expression: expression(statement.expression) } : {}),
      ...(statement.initializer ? { initializer: expression(statement.initializer) } : {}),
    })),
  }));
  const nodes = [];
  const types = [];
  let invalidScalar = false;
  const typeRef = name => {
    if (!["bool", "i32", "f64"].includes(name)) {
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
  };
  for (const fn of functions) {
    recordNode(fn, "function");
    fn.returnTypeRef = typeRef(fn.returnType);
    for (const parameter of fn.parameters) recordNode(parameter, "parameter");
    for (const statement of fn.body) {
      recordNode(statement, statement.kind);
      if (statement.expression) recordExpression(statement.expression);
      if (statement.initializer) recordExpression(statement.initializer);
    }
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
    schemaHash: frontendContract.schemaHash, snapshotId, inputIdentity,
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
      || !Array.isArray(snapshot.functions) || !Array.isArray(snapshot.symbols)) {
    throw new TypeError("unsupported frontend snapshot contract");
  }
  let calls = 0;
  const checkNode = (value, kind) => {
    if (resolveNode(snapshot, value.node).kind !== kind) throw new TypeError("node kind differs from its reference");
  };
  const checkType = (name, ref) => {
    const type = resolveType(snapshot, ref);
    if (type.kind !== "scalar" || type.scalar !== name) throw new TypeError("type differs from its reference");
  };
  for (const symbol of snapshot.symbols) {
    resolveSymbol(snapshot, symbol.ref);
    checkType(symbol.type, symbol.typeRef);
  }
  const visitExpression = expression => {
    if (!expression || typeof expression !== "object") throw new TypeError("invalid expression");
    checkNode(expression, expression.kind);
    checkType(expression.type, expression.typeRef);
    if (expression.symbol) resolveSymbol(snapshot, expression.symbol);
    if (expression.target) {
      const target = resolveSymbol(snapshot, expression.target);
      const fn = snapshot.functions.find(item => item.symbol.id === target.id);
      const parameters = fn?.parameters?.map(parameter => parameter.type);
      const arguments_ = expression.arguments;
      if (expression.kind !== "call" || !fn || !Array.isArray(parameters)
          || !Array.isArray(arguments_) || !Array.isArray(expression.signature?.parameters)
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
      for (const argument of expression.arguments) visitExpression(argument);
    }
  };
  for (const fn of snapshot.functions) {
    checkNode(fn, "function");
    checkType(fn.returnType, fn.returnTypeRef);
    resolveSymbol(snapshot, fn.symbol);
    if (!Array.isArray(fn.parameters) || !Array.isArray(fn.body)) {
      throw new TypeError("invalid function structure");
    }
    for (const parameter of fn.parameters) {
      checkNode(parameter, "parameter");
      checkType(parameter.type, parameter.typeRef);
      resolveSymbol(snapshot, parameter.ref);
    }
    for (const statement of fn.body) {
      checkNode(statement, statement.kind);
      if (statement.symbol) resolveSymbol(snapshot, statement.symbol.ref);
      if (statement.expression) visitExpression(statement.expression);
      if (statement.initializer) visitExpression(statement.initializer);
    }
  }
  return deepFreeze({ snapshotId: snapshot.snapshotId, functions: snapshot.functions.length, calls });
}
