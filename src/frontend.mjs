// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import sourceLock from "../eng/frontend-source.lock.json" with { type: "json" };

export const frontendContractVersion = "3";

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

function ownFunctions(functions, snapshotId, symbols) {
  const byId = new Map(symbols.map(symbol => [symbol.id, symbol]));
  if (byId.size !== symbols.length || symbols.some(symbol => typeof symbol.id !== "string")) {
    throw new TypeError("invalid symbol table");
  }
  const ownExpression = expression => {
    if (!expression) return expression;
    if (expression.symbol === undefined) return expression;
    const symbol = byId.get(expression.symbol);
    if (!symbol || symbol.type !== expression.type) throw new TypeError("invalid expression symbol");
    return { ...expression, symbol: { snapshotId, id: expression.symbol } };
  };
  const ownStatement = statement => ({
    ...statement,
    ...(statement.symbol ? {
      symbol: (() => {
        const symbol = byId.get(statement.symbol.id);
        if (!symbol || symbol.type !== statement.symbol.type) throw new TypeError("invalid declaration symbol");
        return { ...statement.symbol, ref: { snapshotId, id: statement.symbol.id } };
      })(),
    } : {}),
    ...(statement.expression ? { expression: ownExpression(statement.expression) } : {}),
    ...(statement.initializer ? { initializer: ownExpression(statement.initializer) } : {}),
    ...(statement.target ? { target: ownExpression(statement.target) } : {}),
    ...(statement.value ? { value: ownExpression(statement.value) } : {}),
    ...(statement.body ? { body: statement.body.map(ownStatement) } : {}),
  });
  return functions.map(fn => ({
    ...fn,
    parameters: fn.parameters.map(parameter => {
      if (!byId.has(parameter.id)) throw new TypeError("invalid parameter symbol");
      return { ...parameter, ref: { snapshotId, id: parameter.id } };
    }),
    body: fn.body.map(ownStatement),
  }));
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
      ? [...ownedInput.files].sort((a, b) => String(a?.path).localeCompare(String(b?.path)))
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
  const declarationVersion = ownedInput?.declarations?.version;
  const declarationFile = declarationVersion === "minimal-bool-v1" ? "minimal-bool-v1.d.ts"
    : declarationVersion === "minimal-scalars-v2" ? "minimal-scalars-v2.d.ts" : null;
  if (!declarationFile) return rejectInput(inputIdentity, ownedInput?.rootFile ?? "");
  const declarationBytes = await readFile(new URL(`./${declarationFile}`, import.meta.url), "utf8");
  const declarationPaths = ownedInput?.declarations?.paths;
  const declared = Array.isArray(declarationPaths) && declarationPaths.length === 1
    ? ownedInput.files?.find(file => file.path === declarationPaths[0]) : undefined;
  if (declared?.content !== declarationBytes) {
    return rejectInput(inputIdentity, declared?.path ?? ownedInput?.rootFile ?? "");
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
  if (!Array.isArray(output.functions) || !Array.isArray(output.symbols) || output.functions.length === 0) {
    return { status: "tool-error", inputIdentity, message: "incomplete frontend response" };
  }
  const snapshotId = digest(canonical({ contractVersion: frontendContractVersion, inputIdentity, frontendSource }));
  const symbols = output.symbols.map(symbol => ({ ...symbol, ref: { snapshotId, id: symbol.id } }));
  let functions;
  try { functions = ownFunctions(output.functions, snapshotId, symbols); }
  catch { return { status: "tool-error", inputIdentity, message: "invalid frontend references" }; }
  const source = ownedInput.files.find(file => file.path === ownedInput.rootFile);
  const snapshot = deepFreeze({ contractVersion: frontendContractVersion, snapshotId, inputIdentity,
    frontendSource, capability: declarationVersion === "minimal-scalars-v2" ? "locals-assignment-v3" : declarationVersion,
    source, functions, symbols, diagnostics: [] });
  return { status: "ok", snapshot };
}

export function resolveSymbol(snapshot, ref) {
  if (snapshot?.contractVersion !== frontendContractVersion || ref?.snapshotId !== snapshot.snapshotId) {
    throw new TypeError("symbol reference belongs to a different snapshot or contract");
  }
  const symbol = snapshot.symbols.find(item => item.id === ref.id);
  if (!symbol) throw new RangeError("unknown symbol reference");
  return symbol;
}
