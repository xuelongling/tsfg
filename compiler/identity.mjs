// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";

export const sha256 = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export function canonical(value) {
  if (typeof value === "string" && !value.isWellFormed())
    throw new TypeError("canonical input contains a lone surrogate");
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => {
      if (!key.isWellFormed()) throw new TypeError("canonical input key contains a lone surrogate");
      return `${JSON.stringify(key)}:${canonical(value[key])}`;
    }).join(",")}}`;
  return JSON.stringify(value);
}
export function own(value) {
  const copy = structuredClone(value);
  const freeze = item => {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(copy);
}
export const i32TypeId = sha256("tsfg.type\0i32");
export const i32SignatureHash = sha256("tsfg.signature\0()->i32");
export const boolTypeId = sha256("tsfg.type\0bool");
export const integerNames = ["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "isize", "usize"];
export const scalarTypeIds = Object.fromEntries([...integerNames, "bool"].map(name => [name, sha256(`tsfg.type\0${name}`)]));
export const scalarName = id => Object.keys(scalarTypeIds).find(name => scalarTypeIds[name] === id);
export function integerRange(name) {
  if (!integerNames.includes(name)) throw new TypeError("unknown integer type");
  // The supported target is exact-match Windows x86_64. Core derives its
  // pointer width from LLVM DataLayout; the Runtime checks the native ABI.
  const bits = BigInt(name.endsWith("size") ? 64 : name.slice(1));
  const signed = name.startsWith("i");
  return signed ? [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n] : [0n, (1n << bits) - 1n];
}
export const signatureHash = (type, parameters = []) => sha256(`tsfg.signature\0(${parameters.join(",")})->${type}`);
export const functionIdentity = (sourcePath, name, type = "i32", parameters = []) => sha256(
  `tsfg.function\0${sourcePath}\0${name}\0${signatureHash(type, parameters).slice(7)}`);
