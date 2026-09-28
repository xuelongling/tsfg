// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

export const frontendContractVersion = "1";

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

/** @param {any} input @param {{ executable?: string }} [options] */
export async function analyzeFrontend(input, { executable } = {}) {
  const ownedInput = structuredClone(input);
  const inputIdentity = digest(canonical(ownedInput));
  const config = ownedInput?.config;
  if (!config || Object.keys(config).sort().join(",") !== "allowJs,noEmit,strict"
      || config.allowJs !== false || config.noEmit !== true || config.strict !== true) {
    return deepFreeze({ status: "error", inputIdentity, diagnostics: [{
      code: "r02b-d-input", ruleId: "r01-input-boundary", category: "input",
      file: ownedInput?.rootFile ?? "", range: { start: 0, end: 0 },
    }] });
  }
  const declarationBytes = await readFile(new URL("./minimal-bool-v1.d.ts", import.meta.url), "utf8");
  const declarationPaths = ownedInput?.declarations?.paths;
  const declared = Array.isArray(declarationPaths) && declarationPaths.length === 1
    ? ownedInput.files?.find(file => file.path === declarationPaths[0]) : undefined;
  if (ownedInput?.declarations?.version !== "minimal-bool-v1" || declared?.content !== declarationBytes) {
    return deepFreeze({ status: "error", inputIdentity, diagnostics: [{
      code: "r02b-d-input", ruleId: "r01-input-boundary", category: "input",
      file: declared?.path ?? ownedInput?.rootFile ?? "", range: { start: 0, end: 0 },
    }] });
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
  const frontendSource = digest(binary);
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
  const functions = output.functions.map(fn => ({
    ...fn,
    parameters: fn.parameters.map(parameter => ({ ...parameter, ref: { snapshotId, id: parameter.id } })),
    body: fn.body.map(statement => ({
      ...statement,
      expression: { ...statement.expression, symbol: { snapshotId, id: statement.expression.symbol } },
    })),
  }));
  const source = ownedInput.files.find(file => file.path === ownedInput.rootFile);
  const snapshot = deepFreeze({ contractVersion: frontendContractVersion, snapshotId, inputIdentity,
    frontendSource, capability: "minimal-bool-v1", source, functions, symbols, diagnostics: [] });
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
