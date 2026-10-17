// SPDX-License-Identifier: MIT
import { genericPackageJsonPolicy, genericPackageIoJsonPolicy, genericJsonFailure as failure } from "./generic-json-budget.mjs";
export { checkGenericJsonValueBudget, genericPackageJsonPolicy, genericPackageIoJsonPolicy } from "./generic-json-budget.mjs";

/** @param {Readonly<import("./generic-json-budget.mjs").GenericJsonPolicy>} policy */
function stringValue(value, policy) {
  if (typeof value !== "string" || !value.isWellFormed() || !policy.allowNul && value.includes("\0")) failure(policy, "schema");
  if (Buffer.byteLength(value, "utf8") > policy.stringBytes) failure(policy, "limit");
}

// The same strict walker serves allocation preflight and a bounded string probe.
// It allocates no DTO graph. An explicit stack preserves byte-bounded legacy
// readers without imposing the stricter depth policy of a not-yet-selected family.
/**
 * @param {Readonly<import("./generic-json-budget.mjs").GenericJsonPolicy>} [policy]
 * @param {readonly string[] | null} [selectedPath]
 * @returns {{kind: string, value?: string} | undefined}
 */
export function preflightGenericJson(text, policy = genericPackageJsonPolicy, selectedPath = null) {
  let index = 0, tokens = 0;
  /** @type {{kind: string, value?: string} | undefined} */
  let selection;
  const stack = [];
  const fail = () => failure(policy, "json");
  const event = () => { if (++tokens > policy.jsonTokens) failure(policy, "limit"); };
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[index] ?? "!")) index++; };
  function string() {
    const start = index++;
    while (index < text.length) {
      const char = text[index++];
      if (char === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, index)); } catch { fail(); }
        stringValue(value, policy);
        return value;
      }
      if (char === "\\") {
        if (index === text.length) fail();
        index++;
      }
    }
    fail();
  }
  function select(match, kind, value = undefined) {
    // Preserve an existing prefix even when the requested leaf is absent. A
    // caller must distinguish an absent format from a malformed present format.
    if (selectedPath && match > 0 && match < selectedPath.length && !selection) selection = { kind: 'incomplete' };
    if (selectedPath && match === selectedPath.length) selection = { kind, value };
  }
  function value(match) {
    whitespace();
    const char = text[index];
    if (char === "{" || char === "[") {
      if (stack.length + 1 > policy.depth) failure(policy, "limit");
      event(); index++;
      const object = char === "{";
      select(match, object ? "object" : "array");
      stack.push({ object, end: object ? "}" : "]", names: null, after: false, first: true, match });
      return;
    }
    event();
    if (char === '"') { const decoded = string(); select(match, "string", decoded); return; }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) {
        index += literal.length; select(match, literal === "null" ? "null" : "boolean"); return;
      }
    }
    const start = index;
    while (/[0-9eE+.\-]/.test(text[index] ?? "!")) index++;
    const number = text.slice(start, index);
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(number)) fail();
    if (policy.safeNonnegativeIntegers) {
      const numeric = Number(number);
      if (!Number.isSafeInteger(numeric) || numeric < 0 || Object.is(numeric, -0)) failure(policy, "schema");
    }
    select(match, "number");
  }
  try {
  value(selectedPath ? 0 : -1);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    whitespace();
    if (frame.after) {
      if (text[index] === frame.end) { index++; event(); stack.pop(); continue; }
      if (text[index++] !== ",") fail();
      frame.after = false; frame.first = false; whitespace();
    }
    if (frame.first && text[index] === frame.end) { index++; event(); stack.pop(); continue; }
    let match = -1;
    if (frame.object) {
      if (text[index] !== '"') fail();
      const name = string(); event();
      frame.names ??= new Set();
      if (frame.names.has(name)) fail();
      if (policy.rejectPrototypeKeys && ["__proto__", "constructor", "prototype"].includes(name)) failure(policy, "schema");
      frame.names.add(name);
      if (selectedPath && frame.match >= 0 && selectedPath[frame.match] === name) match = frame.match + 1;
      whitespace();
      if (text[index++] !== ":") fail();
    }
    frame.after = true;
    value(match);
  }
  whitespace();
  if (index !== text.length) fail();
  return selection;
  } catch (error) {
    if (selectedPath) Object.defineProperty(error, 'jsonSelection', { value: selection });
    throw error;
  }
}

/** @param {Readonly<import("./generic-json-budget.mjs").GenericJsonPolicy>} policy */
function textBytes(bytes, policy) {
  if (!(bytes instanceof Uint8Array)) failure(policy, "input");
  if (bytes.byteLength > policy.bytes) failure(policy, "limit");
  const copy = Uint8Array.from(bytes);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy); }
  catch { failure(policy, "utf8"); }
  if (text.charCodeAt(0) === 0xfeff) failure(policy, "canonical");
  return { bytes: copy, text };
}

/**
 * Own and strictly scan bytes, selecting only a named string path, before any
 * whole-graph parse. A probe is not an accepted DTO or an alternative reader.
 * @param {Readonly<import("./generic-json-budget.mjs").GenericJsonPolicy>} policy
 * @param {readonly string[] | null} [selectedPath]
 */
export function inspectGenericJson(bytes, policy, selectedPath = null) {
  const input = textBytes(bytes, policy);
  const selection = preflightGenericJson(input.text, policy, selectedPath);
  return { ...input, selection };
}

/** Own bytes and finish lexical/budget validation before allocating a JSON graph. */
/** @param {Readonly<import("./generic-json-budget.mjs").GenericJsonPolicy>} [policy] */
export function readGenericJson(bytes, policy = genericPackageJsonPolicy) {
  const { bytes: ownedBytes, text } = inspectGenericJson(bytes, policy);
  let value;
  try { value = JSON.parse(text); } catch { failure(policy, "json"); }
  return { bytes: ownedBytes, text, value };
}
