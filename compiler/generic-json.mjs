// SPDX-License-Identifier: MIT
import { genericPackageLimits, packageFailure, packageString } from "./generic-package-shape.mjs";

// Validate syntax and allocation budgets before JSON.parse builds the DTO graph.
// This scanner retains only object-key sets; it does not interpret generic types.
export function preflightGenericJson(text) {
  const limits = genericPackageLimits;
  let index = 0, tokens = 0;
  const fail = () => packageFailure("json");
  const event = () => { if (++tokens > limits.jsonTokens) packageFailure("limit"); };
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[index] ?? "!")) index++; };
  function string() {
    const start = index++;
    while (index < text.length) {
      const char = text[index++];
      if (char === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, index)); } catch { fail(); }
        packageString(value);
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
      if (depth > limits.depth) packageFailure("limit");
      event(); index++; whitespace();
      const object = char === "{", end = object ? "}" : "]", names = new Set();
      if (text[index] === end) { index++; event(); return; }
      while (true) {
        if (object) {
          if (text[index] !== '"') fail();
          const name = string(); event();
          if (names.has(name)) fail();
          if (["__proto__", "constructor", "prototype"].includes(name)) packageFailure("schema");
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

function textBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) packageFailure("input");
  if (bytes.byteLength > genericPackageLimits.bytes) packageFailure("limit");
  // Take ownership before decoding. Shared memory could otherwise change between
  // syntax validation, identity verification and the canonical-byte comparison.
  const copy = Uint8Array.from(bytes);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy); }
  catch { packageFailure("utf8"); }
  if (text.charCodeAt(0) === 0xfeff) packageFailure("canonical");
  return { bytes: copy, text };
}

/** Own bytes and finish lexical/budget validation before allocating a JSON graph. */
export function readGenericJson(bytes) {
  const input = textBytes(bytes);
  preflightGenericJson(input.text);
  let value;
  try { value = JSON.parse(input.text); } catch { packageFailure("json"); }
  return { ...input, value };
}
