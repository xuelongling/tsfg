// SPDX-License-Identifier: MIT
import descriptorValue from '../contracts/exception-core-candidate-v1.schema.json' with { type: 'json' };
import { canonical, own, sha256, i32TypeId } from './identity.mjs';
import { checkGenericJsonValueBudget } from './generic-json.mjs';
export { canonical, own, sha256, i32TypeId };
export const descriptor = own(descriptorValue), limits = descriptor.limits;
export const coreSchemaHash = sha256(canonical(descriptor));
/** @returns {never} */
export function failure(category, message = 'invalid private exception Core') {
  const capability = category === 'capability';
  const code = capability ? 'r03-d-capability' : 'r03-exception-core-' + category;
  throw Object.assign(new TypeError(code + ': ' + message),
    { code, ruleId: capability ? 'r01-ts-baseline' : 'r01-input-boundary', phase: 'lowering' });
}
export const check = (condition, category = 'schema', message = undefined) => { if (!condition) failure(category, message); };
check(coreSchemaHash === 'sha256:62e69eda2f22f85d55d132bff04f0b60229db69031ca51113c746d6e9424b359', 'schema');
export const entity = (kind, record) => sha256(descriptor.identity.domains[kind] + '\0' + coreSchemaHash + '\0' + canonical(record));
export const payloadTypeId = entity('type', { kind: 'payload', members: [i32TypeId] });
const hirPolicy = own({ bytes: limits.hirJcsBytesIncludingLF - 1, depth: limits.hirJsonDepth,
  jsonTokens: limits.hirJsonTokens, stringBytes: limits.hirJcsBytesIncludingLF,
  allowNul: true, rejectPrototypeKeys: true, safeNonnegativeIntegers: true });
export function hirBudget(hir) {
  try { checkGenericJsonValueBudget(hir, hirPolicy); }
  catch (error) { failure(error.code?.endsWith('-limit') ? 'limit' : 'schema', 'embedded HIR exceeds private Core policy'); }
}
export const orderedRange = value => ({ start: value.start, end: value.end });
export function publicationBudget() {
  let bytes = 0, work = 0, instructions = 0;
  const step = () => check(++work <= limits.structuralWork, 'limit', 'Core work budget exceeded');
  const reserve = count => { step(); check(Number.isSafeInteger(count) && count >= 0
    && count <= limits.coreTextBytes - bytes, 'limit', 'Core text byte budget exceeded'); bytes += count; };
  const append = text => { reserve(Buffer.byteLength(text)); return text; };
  const budget = {
    step, block: count => check(count <= limits.coreBlocks, 'limit', 'Core block budget exceeded'),
    register: count => check(count <= limits.coreValues, 'limit', 'Core value budget exceeded'),
    parameters: count => check(count <= limits.sourceParameters, 'limit', 'Core parameter budget exceeded'),
    edge: count => check(count <= limits.coreEdges, 'limit', 'Core edge budget exceeded'),
    label: text => reserve(Buffer.byteLength(text)),
    line: text => { check(++instructions <= limits.coreInstructions, 'limit', 'Core operation budget exceeded'); reserve(Buffer.byteLength(text) + 1); },
  };
  // Measure the escaped form before building it. The input was bounded before
  // canonicalization; this second budget accounts for MLIR byte escaping.
  function quote(value) {
    step(); let width = 2;
    for (const character of value) {
      const point = character.codePointAt(0) ?? 0;
      width += point >= 32 && point <= 126 && point !== 34 && point !== 92 ? 1
        : 3 * (point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4);
    }
    reserve(width); const input = Buffer.from(value, 'utf8'), pieces = ['"'];
    for (const byte of input) { step(); pieces.push(byte >= 32 && byte <= 126 && byte !== 34 && byte !== 92
      ? String.fromCharCode(byte) : '\\' + byte.toString(16).toUpperCase().padStart(2, '0')); }
    pieces.push('"'); return pieces.join('');
  }
  function attribute(value, key = '') {
    step();
    if (typeof value === 'string') return quote(value);
    if (typeof value === 'number') return append(value + ' : ' + (key === 'version' || key === 'event' ? 'i32' : 'i64'));
    if (typeof value === 'boolean') return append(String(value));
    const array = Array.isArray(value); append(array ? '[' : '{');
    const parts = [], entries = array ? value.map(child => ['', child]) : Object.entries(value);
    for (const [name, child] of entries) {
      if (parts.length) append(', ');
      parts.push((array ? '' : append(name + ' = ')) + attribute(child, name));
    }
    append(array ? ']' : '}'); return (array ? '[' : '{') + parts.join(', ') + (array ? ']' : '}');
  }
  return { budget, step, reserve, append, quote, attribute };
}
