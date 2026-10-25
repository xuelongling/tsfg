// SPDX-License-Identifier: MIT
import descriptor from '../contracts/formal-exception-core-development.json' with {type:'json'};
// Publication owns bounded formatting, not Source/HIR admission or type identity.
const check=(condition,category,message)=>{if(!condition)throw Object.assign(new TypeError('r03-formal-exception-core-'+category+': '+message),{code:'r03-formal-exception-core-'+category,ruleId:'r01-input-boundary',phase:'lowering'});};
const limits=descriptor.limits;
export function publicationBudget(policy = limits) {
  let bytes = 0, work = 0, instructions = 0;
  const step = () => check(++work <= policy.structuralWork, 'limit', 'Core work budget exceeded');
  const reserve = count => { step(); check(Number.isSafeInteger(count) && count >= 0
    && count <= policy.coreTextBytes - bytes, 'limit', 'Core text byte budget exceeded'); bytes += count; };
  const append = text => { reserve(Buffer.byteLength(text)); return text; };
  // Callers bound fragment counts before mapping. Reserve the whole formatted
  // text before join allocates that text; fragments already have bounded IDs.
  const combine = (parts,separator='') => {
    reserve(parts.reduce((size,part)=>size+Buffer.byteLength(part),0)
      +Math.max(0,parts.length-1)*Buffer.byteLength(separator));
    return parts.join(separator);
  };
  const budget = {
    step, block: count => check(count <= policy.coreBlocks, 'limit', 'Core block budget exceeded'),
    register: count => check(count <= policy.coreValues, 'limit', 'Core value budget exceeded'),
    parameters: count => check(count <= policy.logicalArguments, 'limit', 'Core internal logical argument budget exceeded'),
    edge: count => check(count <= policy.coreEdges, 'limit', 'Core edge budget exceeded'),
    label: text => reserve(Buffer.byteLength(text)),
    line: text => { check(++instructions <= policy.coreInstructions, 'limit', 'Core operation budget exceeded'); reserve(Buffer.byteLength(text) + 1); },
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
  return { budget, step, reserve, append, combine, quote, attribute };
}
