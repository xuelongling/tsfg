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
export const signatureHash = type => sha256(`tsfg.signature\0()->${type}`);
export const functionIdentity = (sourcePath, name, type = "i32") => sha256(
  `tsfg.function\0${sourcePath}\0${name}\0${signatureHash(type).slice(7)}`);
