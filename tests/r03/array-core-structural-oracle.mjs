// SPDX-License-Identifier: MIT
// Closed structural oracle for the frozen Array Core domain, independent of compiler code.
// This consumes every token/attribute/operation. It does not parse Source or execute guests.
import assert from 'node:assert/strict';
import { decodeMlirString } from './string-core-structural-oracle.mjs';

/** @param {string} text @returns {Array<{kind:string,value:string}>} */
export function coreOracleTokens(text) {
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
  const input = coreOracleTokens(text);
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
    if (peek() === '@') { take('@');return {kind:'symbol',value:take().value}; }
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
      // MLIR's generic printer omits the default i64 type inside ArrayAttr.
      const width=peek()===':'?(take(':'),take().value):'i64';
      return {kind:'integer',value:atom.value,width};
    }
    if (atom.value === 'true' || atom.value === 'false') return {kind:'boolean',value:atom.value};
    if (atom.value === 'unit') return {kind:'unit'};
    assert.fail('unexpected attribute value ' + atom.value);
  }
  /** @returns {Record<string,any>} */
  function dictionary() {
    take('{');const entries = [];
    if (peek() !== '}') {
      do {
        const key = take();assert.ok(key.kind === 'word' || key.kind === 'string');
        // Generic MLIR may elide the value of a named UnitAttr.
        entries.push([key.value,peek()==='='?(take('='),value()):{kind:'unit'}]);
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
    // MLIR stores func.call's callee as an inherent property in generic output;
    // its ordinary generic input spells the same symbol in the attr dictionary.
    if (name.value === 'func.call' && Object.hasOwn(properties,'callee')) {
      assert.ok(!Object.hasOwn(attributes,'callee'),'callee represented once');
      attributes.callee=properties.callee;delete properties.callee;
    }
    take(':');const inputTypes=list('(',')',type);take('->');const outputTypes=resultTypes();
    assert.equal(inputTypes.length,operands.length,'complete operand type list');
    assert.equal(outputTypes.length,result === undefined ? 0 : 1,'complete result type list');
    return {name:name.value,results:result === undefined ? [] : [result],operands,
      inputTypes,outputTypes,properties,attributes};
  }
  /** @param {Array<{raw:string,type:string}>} parameters */
  function body(parameters=[]) {
    const registers=new Map(), normalized=[],operations=[];
    /** @param {{raw:string,type:string}} parameter */
    function declare(parameter){
      assert.ok(!registers.has(parameter.raw),'unique entry parameter');
      const name='%v'+registers.size;registers.set(parameter.raw,name);
      normalized.push({name,type:parameter.type});
    }
    parameters.forEach(declare);
    if(peek()?.startsWith('^')){
      take();
      if(peek()==='('){
        const block=list('(',')',()=>{const raw=take().value;take(':');return {raw,type:type()};});
        assert.equal(parameters.length,0,'entry arguments represented once');block.forEach(declare);
      }
      take(':');
    }
    while(peek()!=='}')operations.push(operation(registers));
    take('}');return {parameters:normalized,operations};
  }
  function func() {
    let properties,attributes,bodyResult;
    if(input[position]?.kind==='string'){
      take('func.func');take('(');take(')');take('<');properties=dictionary();take('>');
      take('(');take('{');bodyResult=body();take(')');
      attributes=peek()==='{'?dictionary():{};
      take(':');take('(');take(')');take('->');take('(');take(')');
    }else{
      take('func.func');take('@');const symbol=take();
      assert.ok(symbol.kind==='string'||symbol.kind==='word');
      const parameters=list('(',')',()=>{const raw=take().value;assert.ok(raw.startsWith('%'));take(':');return {raw,type:type()};});
      take('->');const results=resultTypes();
      properties={function_type:{kind:'function-type',inputs:parameters.map(p=>p.type),results},sym_name:symbol.value};
      take('attributes');attributes=dictionary();take('{');bodyResult=body(parameters);
    }
    assert.deepEqual(bodyResult.parameters.map(p=>p.type),properties.function_type.inputs,'complete typed entry block');
    return {properties,attributes,...bodyResult};
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
  const parsed=parseArrayCore(actual),frozen=parseArrayCore(expected.core);
  assert.deepEqual(parsed,frozen,'every module/function/parameter/type/property/range and ordered SSA edge');
  const operations=parsed.functions.flatMap(fn=>fn.operations);
  /** @param {string} name */
  const count=name=>operations.filter(op=>op.name===name).length;
  return {functions:parsed.functions.length,
    parameters:parsed.functions.reduce((n,fn)=>n+fn.parameters.length,0),
    sites:count('tsfg_array.create'),aliases:count('tsfg_array.alias'),
    elements:operations.filter(op=>op.name==='tsfg_array.create').reduce((n,op)=>n+op.operands.length,0),
    checkedReads:count('tsfg_array.read_checked'),stores:count('tsfg_array.store_dense_checked'),
    resizes:count('tsfg_array.resize_checked'),constants:count('tsfg_core.constant'),
    operations:operations.length,
    registers:parsed.functions.reduce((n,fn)=>n+fn.parameters.length+fn.operations.reduce((m,op)=>m+op.results.length,0),0)};
}

/** Empty optional proof tables carry the same zero-row value; every other field is retained.
 * @param {string} text */
export function parseArrayCoreProofValue(text){const value=parseArrayCore(text);
 for(const fn of value.functions)for(const key of ['tsfg_array.call_roots','tsfg_array.view_lifetimes'])
  if(Array.isArray(fn.attributes[key])&&fn.attributes[key].length===0)delete fn.attributes[key];
 return value;
}
