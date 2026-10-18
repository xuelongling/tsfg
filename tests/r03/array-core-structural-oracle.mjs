// SPDX-License-Identifier: MIT
// Closed structural oracle for the frozen Array Core domain, independent of compiler code.
// This consumes every token/attribute/operation. It does not parse Source or execute guests.
import assert from 'node:assert/strict';
import { decodeMlirString } from './string-core-structural-oracle.mjs';

/** @param {string} text @returns {Array<{kind:string,value:string}>} */
function tokens(text) {
  assert.ok(text.isWellFormed(), 'whole Core is well-formed Unicode');
  const out = [];
  for (let i = 0; i < text.length;) {
    if (/\s/.test(text[i])) { i++; continue; }
    if (text[i] === '"') {
      const begin = i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i++] === '"') { closed = true; break; }
      }
      assert.ok(closed, 'complete quoted token');
      out.push({kind:'string', value:decodeMlirString(text.slice(begin,i))}); continue;
    }
    if (text.slice(i,i+2) === '->') {out.push({kind:'punctuation',value:'->'});i+=2;continue;}
    if ('()[]{}<>,:=@'.includes(text[i])) {
      out.push({kind:'punctuation',value:text[i++]}); continue;
    }
    const begin = i;
    while (i < text.length && !/\s/.test(text[i]) && !'()[]{}<>,:=@"'.includes(text[i])
      && text.slice(i,i+2) !== '->') i++;
    assert.ok(i > begin, 'recognized finite grammar token');
    out.push({kind:'word',value:text.slice(begin,i)});
  }
  return out;
}

/** Normalize only SSA spelling and dictionary order; preserve all domain values.
 * Supports the emitter's original assembly and the same CLI's generic printer.
 * @param {string} text */
export function parseArrayCore(text) {
  const input = tokens(text);
  let position = 0;
  const peek = () => input[position]?.value;
  /** @param {string} [value] */
  function take(value) {
    const next = input[position++];
    assert.ok(next, 'complete Core token');
    if (value !== undefined) assert.equal(next.value, value, 'exact Core syntax');
    return next;
  }
  /** @param {string} open @param {string} close @param {() => any} read */
  function list(open, close, read) {
    take(open); const values = [];
    if (peek() !== close) {
      do {values.push(read()); if (peek() !== ',') break; take(',');} while (true);
    }
    take(close); return values;
  }
  /** @returns {string} */
  function type() {
    const head = take();
    assert.equal(head.kind, 'word', 'nominal/scalar type');
    if (peek() !== '<') return head.value;
    take('<'); const argument = take();
    assert.equal(argument.kind, 'string', 'finite quoted nominal type argument'); take('>');
    return head.value + '<' + JSON.stringify(argument.value) + '>';
  }
  /** @returns {string[]} */
  function resultTypes() {return peek() === '(' ? list('(',')',type) : [type()];}
  /** @returns {any} */
  function value() {
    if (peek() === '{') return dictionary();
    if (peek() === '[') return list('[',']',value);
    if (peek() === '(') {
      const inputs = list('(',')',type);take('->');
      return {kind:'function-type',inputs,results:resultTypes()};
    }
    const atom = take();
    if (atom.kind === 'string') return atom.value;
    if (atom.value === 'array') {
      take('<');const elementType = take().value, values = [];
      if (peek() === ':') {
        take(':');
        do {
          const item = take();assert.match(item.value,/^-?\d+$/);values.push(item.value);
          if (peek() !== ',') break;take(',');
        } while (true);
      }
      take('>');return {kind:'dense-array',elementType,values};
    }
    if (/^-?\d+$/.test(atom.value)) {
      take(':');return {kind:'integer',value:atom.value,width:take().value};
    }
    if (atom.value === 'true' || atom.value === 'false') return {kind:'boolean',value:atom.value};
    assert.fail('unexpected attribute value ' + atom.value);
  }
  /** @returns {Record<string,any>} */
  function dictionary() {
    take('{');const entries = [];
    if (peek() !== '}') {
      do {
        const key = take();assert.ok(key.kind === 'word' || key.kind === 'string');
        take('=');entries.push([key.value,value()]);
        if (peek() !== ',') break;take(',');
      } while (true);
    }
    take('}');
    assert.equal(new Set(entries.map(e=>e[0])).size, entries.length, 'no dropped duplicate attr');
    return Object.fromEntries(entries.sort(([a],[b])=>a<b?-1:a>b?1:0));
  }
  /** @param {Map<string,string>} registers */
  function operation(registers) {
    let result, rawResult;
    if (peek()?.startsWith('%')) {
      rawResult = take().value;take('=');assert.ok(!registers.has(rawResult), 'unique SSA definition');
      result = '%v' + registers.size;
    }
    const name = take();assert.equal(name.kind,'string','generic finite operation');
    const operands = list('(',')',()=>{
      const raw = take().value;assert.ok(registers.has(raw),'defined local SSA operand');
      return registers.get(raw);
    });
    if (rawResult !== undefined) registers.set(rawResult,result);
    let properties = {};
    if (peek() === '<') {take('<');properties=dictionary();take('>');}
    const attributes = peek() === '{' ? dictionary() : {};
    take(':');const inputTypes=list('(',')',type);take('->');const outputTypes=resultTypes();
    assert.equal(inputTypes.length,operands.length,'complete operand type list');
    assert.equal(outputTypes.length,result === undefined ? 0 : 1,'complete result type list');
    return {name:name.value,results:result === undefined ? [] : [result],operands,
      inputTypes,outputTypes,properties,attributes};
  }
  function body() {
    const registers = new Map(), operations = [];
    if (peek()?.startsWith('^')) {
      take();take(':'); // The only optional entry label has no arguments.
    }
    while (peek() !== '}') operations.push(operation(registers));
    take('}');return operations;
  }
  function func() {
    let properties, attributes, operations;
    if (input[position]?.kind === 'string') {
      take('func.func');take('(');take(')');take('<');properties=dictionary();take('>');
      take('(');take('{');operations=body();take(')');
      attributes=peek()==='{'?dictionary():{};
      take(':');take('(');take(')');take('->');take('(');take(')');
    } else {
      take('func.func');take('@');const symbol = take();
      assert.ok(symbol.kind==='string'||symbol.kind==='word');
      const inputs=list('(',')',type);take('->');const results=resultTypes();
      properties={function_type:{kind:'function-type',inputs,results},sym_name:symbol.value};
      take('attributes');attributes=dictionary();take('{');operations=body();
    }
    return {properties,attributes,operations};
  }
  let attributes;const functions = [];
  if (input[position]?.kind === 'string') {
    take('builtin.module');take('(');take(')');take('(');take('{');
    while (peek() !== '}') functions.push(func());
    take('}');take(')');attributes=peek()==='{'?dictionary():{};
    take(':');take('(');take(')');take('->');take('(');take(')');
  } else {
    take('module');take('attributes');attributes=dictionary();take('{');
    while (peek() !== '}') functions.push(func());
    take('}');
  }
  assert.equal(position,input.length,'whole Core consumed without ignored suffix');
  return {attributes,functions};
}

/** Compare the entire closed structure against the independent pre-product text.
 * @param {string} actual @param {{core:string}} expected */
export function assertArrayCoreSemantics(actual, expected) {
  const parsed=parseArrayCore(actual), frozen=parseArrayCore(expected.core);
  assert.deepEqual(parsed,frozen,'every module/function/local/type/range and ordered SSA operation');
  return {functions:parsed.functions.length,
    sites:parsed.functions.reduce((n,fn)=>n+fn.operations.filter(op=>op.name==='tsfg_array.create').length,0),
    aliases:parsed.functions.reduce((n,fn)=>n+fn.operations.filter(op=>op.name==='tsfg_array.alias').length,0),
    elements:parsed.functions.reduce((n,fn)=>n+fn.operations.filter(op=>op.name==='tsfg_core.constant'
      &&op.outputTypes[0]==='f64').length,0),
    checkedReads:parsed.functions.reduce((n,fn)=>n+fn.operations.filter(op=>op.name==='tsfg_array.read_checked').length,0)};
}
