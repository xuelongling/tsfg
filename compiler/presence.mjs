// SPDX-License-Identifier: MIT
import { signatureHash, functionIdentity, scalarName, scalarTypeIds } from "./identity.mjs";

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

const annotationNames = new Set([...Object.keys(scalarTypeIds), "boolean", "number", "undefined", "null"]);

// Read only the finite spelling of already checker-owned members. Parentheses
// do not change membership, and trivia must not join separate source tokens.
function annotationMembers(text) {
  const spelling = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, " ");
  const members = new Set();
  let index = 0, depth = 0, operand = true;
  while (index < spelling.length) {
    if (/\s/.test(spelling[index])) { index++; continue; }
    const token = spelling[index];
    if (token === "(") { if (!operand) return null; depth++; index++; continue; }
    if (token === ")") { if (operand || depth === 0) return null; depth--; index++; continue; }
    if (token === "|") { if (operand) return null; operand = true; index++; continue; }
    if (!operand) return null;
    const raw = /^(?:[A-Za-z_$]|\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4}))(?:[A-Za-z0-9_$]|\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4}))*/.exec(spelling.slice(index))?.[0];
    if (!raw) return null;
    let name;
    try {
      name = raw.replace(/\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g,
        (_, point, unit) => String.fromCodePoint(Number.parseInt(point ?? unit, 16)));
    } catch { return null; }
    if (!annotationNames.has(name)
        || ["undefined", "null", "boolean", "number"].includes(name) && raw !== name) return null;
    members.add(({boolean: "bool", number: "f64"})[name] ?? name);
    index += raw.length;
    operand = false;
  }
  return operand || depth !== 0 ? null : [...members];
}

export function validPresenceFlow(flow, shape) {
  return exactKeys(flow,["undefined","null"]) && typeof flow.undefined === "boolean" && typeof flow.null === "boolean"
    && (!flow.undefined || shape.undefined) && (!flow.null || shape.null);
}

// Incoming omission for a default parameter is distinct from its annotation.
// Callers may omit it, but its initializer can only produce declared members.
export function annotationStates(shape, source) {
  const members=annotationMembers(source.slice(shape.annotation.start,shape.annotation.end)) ?? [];
  return 1 | (members.includes("undefined") ? 2 : 0) | (members.includes("null") ? 4 : 0);
}

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
  const members=annotationMembers(source.slice(shape.annotation.start,shape.annotation.end)) ?? [];
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

export function validLocalPresence(shape, binding, initializer, source, parent) {
  if (!exactKeys(shape,["undefined","null","optional","default","range","annotation"])
      || typeof shape.undefined !== "boolean" || typeof shape.null !== "boolean" || !hasState(shape)
      || shape.optional !== false || shape.default !== false
      || !contained(shape.range,parent) || !contained(binding.range,shape.range) || !contained(shape.annotation,shape.range)
      || binding.range.end > shape.annotation.start || tokens(source.slice(binding.range.end,shape.annotation.start)) !== ":"
      || tokens(source.slice(shape.range.start,binding.range.start)) !== "") return false;
  const payload=scalarName(binding.type) ?? binding.type;
  const members=annotationMembers(source.slice(shape.annotation.start,shape.annotation.end)) ?? [];
  if (new Set(members).size !== members.length || !members.includes(payload) || members.some(name=>![payload,"undefined","null"].includes(name))
      || shape.undefined !== members.includes("undefined") || shape.null !== members.includes("null")) return false;
  if (initializer) return contained(initializer.range,shape.range) && shape.annotation.end <= initializer.range.start
    && tokens(source.slice(shape.annotation.end,initializer.range.start)) === "=" && tokens(source.slice(initializer.range.end,shape.range.end)) === "";
  return tokens(source.slice(shape.annotation.end,shape.range.end)) === "";
}
