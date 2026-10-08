// SPDX-License-Identifier: MIT
import { signatureHash, functionIdentity, scalarName } from "./identity.mjs";

export const presenceMask = shape => shape ? Number(shape.undefined) | Number(shape.null) << 1
  | Number(shape.optional) << 2 | Number(shape.default) << 3 : 0;
export const hasState = shape => (presenceMask(shape) & 3) !== 0;
export const presenceName = (name, shape) => presenceMask(shape)
  ? `${name}@${presenceMask(shape).toString(16).padStart(2,"0")}` : name;
export const parameterNames = parameters => parameters.map(p => presenceName(scalarName(p.type), p.presence));
export const presenceSignature = (result, parameters) => signatureHash(result, parameterNames(parameters));
export const presenceIdentity = (path, name, result, parameters) => functionIdentity(path, name, result, parameterNames(parameters));
export const presenceEncoding = parameters => parameters.map(p => presenceMask(p.presence).toString(16).padStart(2,"0")).join("");

const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const contained = (r, parent) => exactKeys(r, ["start","end"]) && Number.isSafeInteger(r.start)
  && Number.isSafeInteger(r.end) && r.start >= parent.start && r.start < r.end && r.end <= parent.end;
const tokens = text => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g,"").replace(/\s/g,"");

// These are source-span integrity guards for already checker-owned facts.
// Types remain the official producer's nominal payload and finite members.
export function validParameterPresence(shape, parameter, initializer, source, parent) {
  if (!exactKeys(shape,["undefined","null","optional","default","range","annotation"])
      || ["undefined","null","optional","default"].some(key => typeof shape[key] !== "boolean")
      || !contained(shape.range,parent) || !contained(parameter.range,shape.range)
      || !contained(shape.annotation,shape.range) || parameter.range.end > shape.annotation.start
      || shape.default !== Boolean(initializer)) return false;
  const prefix=tokens(source.slice(parameter.range.end,shape.annotation.start));
  if (![":","?:"].includes(prefix) || shape.optional !== (prefix === "?:" || shape.default)) return false;
  const spelling=tokens(source.slice(shape.annotation.start,shape.annotation.end));
  const members=spelling.split("|").map(name => ({boolean:"bool",number:"f64"}[name] ?? name));
  const payload=scalarName(parameter.type) ?? parameter.type;
  if (new Set(members).size !== members.length || !members.includes(payload)
      || members.some(name => ![payload,"undefined","null"].includes(name))
      || shape.null !== members.includes("null")
      || shape.undefined !== (members.includes("undefined") || shape.optional)
      || tokens(source.slice(shape.range.start,parameter.range.start)) !== "") return false;
  if (initializer) return contained(initializer.range,shape.range)
    && shape.annotation.end <= initializer.range.start
    && tokens(source.slice(shape.annotation.end,initializer.range.start)) === "="
    && tokens(source.slice(initializer.range.end,shape.range.end)) === "";
  return tokens(source.slice(shape.annotation.end,shape.range.end)) === "";
}
