// SPDX-License-Identifier: MIT
// Independent finite String Core structural oracle for canonical CLI output.
// This parses no Source, executes no guest and imports no compiler implementation.
import assert from 'node:assert/strict';
import { TextDecoder } from 'node:util';

/** Decode only MLIR quoted-string tokens: simple escapes or exactly two hex bytes.
 * Byte decoding is UTF8-fatal; literal backslash tokens are consumed once, never reinterpreted.
 * @param {string} token */
export function decodeMlirString(token) {
  assert.ok(token.length >= 2 && token[0] === '"' && token.at(-1) === '"' && token.isWellFormed());
  /** @type {number[]} */ const bytes = [];
  /** @type {Record<string, number>} */ const simple = {'n': 10, 't': 9, '"': 34, '\\': 92};
  for (let i = 1; i < token.length - 1; i++) {
    const ch = token[i];
    if (ch === '\\') {
      const next = token[++i];
      assert.ok(i < token.length - 1, 'complete MLIR escape token');
      if (Object.hasOwn(simple, next)) bytes.push(simple[next]);
      else {
        const hex = token.slice(i, i + 2);
        assert.ok(i + 1 < token.length - 1 && /^[0-9a-fA-F]{2}$/.test(hex), 'two-digit MLIR hex byte');
        bytes.push(Number.parseInt(hex, 16)); i++;
      }
    } else {
      const point = token.codePointAt(i); assert.ok(point !== undefined);
      assert.ok(point >= 32 && point !== 34, 'raw quoted-string character');
      bytes.push(...Buffer.from(String.fromCodePoint(point), 'utf8'));
      if (point > 65535) i++;
    }
  }
  return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(Uint8Array.from(bytes));
}



/** @param {string} value */
const escaped = value => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
/** @param {string} text @param {string} key */
function stringAttr(text, key) {
  const matches = [...text.matchAll(new RegExp('(?:^|[\\s,{])' + escaped(key) + '\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")', 'g'))];
  assert.equal(matches.length, 1, key + ' exactly once');
  return decodeMlirString(matches[0][1]);
}
/** @param {string} text @param {string} key @param {number} [width] */
function intAttr(text, key, width = 64) {
  const matches = [...text.matchAll(new RegExp('(?:^|[\\s,{])' + escaped(key) + '\\s*=\\s*(-?\\d+)\\s*:\\s*i' + width + '\\b', 'g'))];
  assert.equal(matches.length, 1, key + ' exactly once');
  const value = Number(matches[0][1]); assert.ok(Number.isSafeInteger(value)); return value;
}
/** @param {string} text */
const anchor = text => ({start: intAttr(text, 'tsfg_source.start'), end: intAttr(text, 'tsfg_source.end')});
/** @param {string} text @param {number} begin */
function closeBrace(text, begin) {
  assert.equal(text[begin], '{');
  let depth = 1, quoted = false, escape = false;
  for (let i = begin + 1; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  assert.fail('balanced complete function body required');
}
/** Supports the original assembly input and the existing CLI generic printer.
 * @param {string} text @returns {Array<{name:string, body:string, span:string, header:string}>} */
function functions(text) {
  const generic = [...text.matchAll(/"func\.func"\(\)\s*<\{([^}]*)\}>\s*\(\s*\{/g)];
  const custom = [...text.matchAll(/\bfunc\.func\s+@("(?:[^"\\]|\\.)*"|[^\s(]+)\(\)\s*->\s*!tsfg_string\.string\s+attributes\s*\{[^}]*\}\s*\{/g)];
  const headers = generic.length ? generic : custom;
  assert.ok(headers.length > 0, 'complete function collection');
  return headers.map((m, index) => {
    const start = /** @type {number} */ (m.index), begin = start + m[0].length - 1, end = closeBrace(text, begin);
    const header = m[0], name = generic.length ? stringAttr(header, 'sym_name')
      : (m[1].startsWith('"') ? decodeMlirString(m[1]) : m[1]);
    if (generic.length) assert.match(header, /function_type\s*=\s*\(\)\s*->\s*!tsfg_string\.string/);
    return {name, header, body: text.slice(begin + 1, end),
      span: text.slice(start, index + 1 < headers.length ? headers[index + 1].index : text.length)};
  });
}
/** @param {string} text */
function table(text) {
  const match = text.match(/tsfg_string\.function_ids\s*=\s*\[([^\]]*)\]/);
  assert.ok(match, 'complete ordered function table');
  const values = [...match[1].matchAll(/"(?:[^"\\]|\\.)*"/g)].map(m => decodeMlirString(m[0]));
  assert.equal(match[1].replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/[\s,]/g, ''), '');
  return values;
}
/** @param {string} text */
function units(text) {
  const match = text.match(/code_units\s*=\s*array<i32(?::\s*([^>]*))?>/);
  assert.ok(match, 'DenseI32ArrayAttr required');
  if (match[1] === undefined || match[1].trim() === '') return [];
  return match[1].split(',').map(item => {
    assert.match(item.trim(), /^\d+$/);
    const n = Number(item.trim()); assert.ok(Number.isInteger(n) && n >= 0 && n <= 65535); return n;
  });
}

/** Compare every frozen function, original anchor, unit and ordered SSA use.
 * Expected is the pre-product whole oracle case, never a CLI-generated snapshot.
 * @param {string} text @param {any} expected */
export function assertStringCoreSemantics(text, expected) {
  for (const key of ['version', 'input_identity', 'source_hash', 'source_path', 'target', 'triple', 'data_layout', 'bytecode_schema']) {
    assert.equal(stringAttr(text, 'tsfg_core.' + key), stringAttr(expected.core, 'tsfg_core.' + key));
  }
  assert.equal(intAttr(text, 'tsfg_core.source_length'), intAttr(expected.core, 'tsfg_core.source_length'));
  const marker = text.match(/tsfg_core\.string\s*=\s*\{([^}]*)\}/);
  const oldMarker = expected.core.match(/tsfg_core\.string\s*=\s*\{([^}]*)\}/);
  assert.ok(marker); assert.ok(oldMarker);
  for (const key of ['family', 'schema', 'profile']) assert.equal(stringAttr(marker[1], key), stringAttr(oldMarker[1], key));
  for (const key of ['version', 'facts_version']) assert.equal(intAttr(marker[1], key, 32), intAttr(oldMarker[1], key, 32));
  assert.deepEqual(table(text), expected.semantic.map(fn => fn.functionId));
  const fns = functions(text); assert.equal(fns.length, expected.semantic.length);
  const actual = fns.map((fn, index) => {
    const fixed = expected.semantic[index], body = fn.body;
    const fuel = body.match(/"tsfg_core\.fuel"\(\)\s*\{([^}]*)\}\s*:\s*\(\)\s*->\s*\(\)/);
    assert.ok(fuel); assert.equal(intAttr(fuel[1], 'event', 32), 1);
    const functionRange = {start: intAttr(fn.span, 'tsfg_core.function_start'), end: intAttr(fn.span, 'tsfg_core.function_end')};
    assert.deepEqual(anchor(fuel[1]), functionRange);
    const constants = [...body.matchAll(/(%[\w$.-]+)\s*=\s*"tsfg_string\.constant"\(\)\s*\{([^}]*)\}\s*:\s*\(\)\s*->\s*!tsfg_string\.string/g)];
    assert.equal(constants.length, fixed.leaves.length);
    const names = new Map(constants.map((m, ordinal) => [m[1], '%v' + ordinal]));
    const concat = body.match(/(%[\w$.-]+)\s*=\s*"tsfg_string\.concat"\((%[\w$.-]+),\s*(%[\w$.-]+)\)\s*\{([^}]*)\}\s*:\s*\(!tsfg_string\.string,\s*!tsfg_string\.string\)\s*->\s*!tsfg_string\.string/);
    if (concat) names.set(concat[1], '%v2');
    assert.equal(Boolean(concat), fixed.orderedConcatOperands !== null);
    const returned = body.match(/"func\.return"\((%[\w$.-]+)\)\s*\{([^}]*)\}\s*:\s*\(!tsfg_string\.string\)\s*->\s*\(\)/);
    assert.ok(returned);
    const operationNames = [...body.matchAll(/"([\w.]+)"\(/g)].map(m => m[1]);
    assert.deepEqual(operationNames, ['tsfg_core.fuel', ...constants.map(() => 'tsfg_string.constant'),
      ...(concat ? ['tsfg_string.concat'] : []), 'func.return']);
    return {name: fn.name, functionId: stringAttr(fn.span, 'tsfg_core.function_id'),
      signatureHash: stringAttr(fn.span, 'tsfg_core.signature_hash'), typeId: stringAttr(fn.span, 'tsfg_core.type_id'),
      functionRange, returnRange: anchor(returned[2]),
      expressionRange: concat ? anchor(concat[4]) : anchor(constants[0][2]),
      operatorRange: concat ? {start: intAttr(concat[4], 'tsfg_source.operator_start'), end: intAttr(concat[4], 'tsfg_source.operator_end')} : null,
      leaves: constants.map((m, ordinal) => ({register: '%v' + ordinal, codeUnits: units(m[2]), range: anchor(m[2])})),
      orderedConcatOperands: concat ? [names.get(concat[2]), names.get(concat[3])] : null,
      returnedRegister: names.get(returned[1])};
  });
  assert.deepEqual(actual, expected.semantic, 'whole independently fixed per-function semantics');
  return {functions: actual.length, leaves: actual.reduce((n, fn) => n + fn.leaves.length, 0),
    concats: actual.filter(fn => fn.orderedConcatOperands !== null).length};
}
