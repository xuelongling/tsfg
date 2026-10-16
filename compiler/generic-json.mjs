// SPDX-License-Identifier: MIT
import { genericPackageJsonPolicy, genericPackageIoJsonPolicy, genericJsonFailure as failure } from "./generic-json-budget.mjs";
export { checkGenericJsonValueBudget, genericPackageJsonPolicy, genericPackageIoJsonPolicy } from "./generic-json-budget.mjs";

/** @param {Readonly<import("./generic-json-budget.mjs").GenericJsonPolicy>} policy */
function stringValue(value, policy) {
  if (typeof value !== "string" || !value.isWellFormed() || !policy.allowNul && value.includes("\0")) failure(policy, "schema");
  if (Buffer.byteLength(value, "utf8") > policy.stringBytes) failure(policy, "limit");
}

// Validate syntax and allocation budgets before JSON.parse builds the DTO graph.
// This scanner retains only object-key sets; it does not interpret generic types.
/** @param {Readonly<import("./generic-json-budget.mjs").GenericJsonPolicy>} [policy] */
export function preflightGenericJson(text, policy = genericPackageJsonPolicy) {
  const limits = policy;
  let index = 0, tokens = 0;
  const fail = () => failure(policy, "json");
  const event = () => { if (++tokens > limits.jsonTokens) failure(policy, "limit"); };
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
  function value(depth) {
    whitespace();
    const char = text[index];
    if (char === "{" || char === "[") {
      if (depth > limits.depth) failure(policy, "limit");
      event(); index++; whitespace();
      const object = char === "{", end = object ? "}" : "]", names = new Set();
      if (text[index] === end) { index++; event(); return; }
      while (true) {
        if (object) {
          if (text[index] !== '"') fail();
          const name = string(); event();
          if (names.has(name)) fail();
          if (policy.rejectPrototypeKeys && ["__proto__", "constructor", "prototype"].includes(name)) failure(policy, "schema");
          names.add(name); whitespace();
          if (text[index++] !== ":") fail();
        }
        value(depth + 1); whitespace();
        if (text[index] === end) { index++; event(); return; }
        if (text[index++] !== ",") fail();
        whitespace();
      }
    }
    event();
    if (char === '"') { string(); return; }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) { index += literal.length; return; }
    }
    const start = index;
    while (/[0-9eE+.\-]/.test(text[index] ?? "!")) index++;
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text.slice(start, index))) fail();
  }
  value(1); whitespace();
  if (index !== text.length) fail();
}

/** @param {Readonly<import("./generic-json-budget.mjs").GenericJsonPolicy>} policy */
function textBytes(bytes, policy) {
  if (!(bytes instanceof Uint8Array)) failure(policy, "input");
  if (bytes.byteLength > policy.bytes) failure(policy, "limit");
  // Take ownership before decoding. Shared memory could otherwise change between
  // syntax validation, identity verification and the canonical-byte comparison.
  const copy = Uint8Array.from(bytes);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy); }
  catch { failure(policy, "utf8"); }
  if (text.charCodeAt(0) === 0xfeff) failure(policy, "canonical");
  return { bytes: copy, text };
}

/** Own bytes and finish lexical/budget validation before allocating a JSON graph. */
/** @param {Readonly<import("./generic-json-budget.mjs").GenericJsonPolicy>} [policy] */
export function readGenericJson(bytes, policy = genericPackageJsonPolicy) {
  const input = textBytes(bytes, policy);
  preflightGenericJson(input.text, policy);
  let value;
  try { value = JSON.parse(input.text); } catch { failure(policy, "json"); }
  return { ...input, value };
}
