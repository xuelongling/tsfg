// SPDX-License-Identifier: MIT
// Complete cold Array facts ownership; official checking remains with Source.
// The frame boundary completes safe graph preflight before entering this model.
import { canonical, sha256 } from './identity.mjs';
import { floatBits, numericTokenSyntax } from './float.mjs';
import { identifierName, sourceTrivia, skipCallTrivia } from './module-facts.mjs';

export const arrayFactsLimits = Object.freeze({ bytes: 2097152, depth: 64, jsonTokens: 200000,
  stringBytes: 1048576, safeNonnegativeIntegers: true, allowNul: true, rejectPrototypeKeys: true });
export function arrayFactsFailure(kind, cause = undefined) {
  throw Object.assign(new TypeError('r03-array-facts-' + kind + ': invalid owned Array facts', { cause }),
    { code: 'r03-array-facts-' + kind, ruleId: 'r01-input-boundary', phase: 'input' });
}
export const arrayCheck = (condition, kind = 'schema') => { if (!condition) arrayFactsFailure(kind); };
export function arrayRecord(value, keys) {
  arrayCheck(value && typeof value === 'object' && !Array.isArray(value));
  arrayCheck(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
const list = (value, min, max) => {
  arrayCheck(Array.isArray(value));
  arrayCheck(value.length >= min && value.length <= max, 'limit'); return value;
};
const text = value => arrayCheck(typeof value === 'string' && value.length > 0 && value.isWellFormed(), 'input');
const digest = value => arrayCheck(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value), 'identity');
const equal = (a, b) => canonical(a) === canonical(b);
function logicalPath(value) {
  text(value);
  arrayCheck(value.startsWith('/') && !value.includes('\\') && !value.includes('\0')
    && value.slice(1).split('/').every(part => part && part !== '.' && part !== '..'), 'input');
  return value;
}
const originIdentity = (domain, sourcePath, range, field) =>
  sha256(domain + '\0' + canonical({ sourcePath, [field]: range }));
function range(value, parent, content) {
  arrayRecord(value, ['start', 'end']);
  const boundary = i => !(content.charCodeAt(i) >= 0xdc00 && content.charCodeAt(i) <= 0xdfff
    && content.charCodeAt(i - 1) >= 0xd800 && content.charCodeAt(i - 1) <= 0xdbff);
  arrayCheck(Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end)
    && !Object.is(value.start, -0) && !Object.is(value.end, -0)
    && value.start >= parent.start && value.start < value.end && value.end <= parent.end
    && boundary(value.start) && boundary(value.end), 'input');
  return value;
}
const window = (content, start, end) => sourceTrivia(content, start, end);
const compact = (content, span) => window(content, span.start, span.end).replace(/\s/g, '');
const lineBreak = text => /[\r\n\u2028\u2029]/.test(text);
function tokenAt(token, span, content, signed = false) {
  const raw = content.slice(span.start, span.end);
  if (!signed || !/^[+-]/.test(token)) { arrayCheck(raw === token, 'input'); return; }
  arrayCheck(raw[0] === token[0], 'input');
  const rest = raw.slice(1), offset = skipCallTrivia(rest);
  arrayCheck(offset >= 0 && rest.slice(offset) === token.slice(1), 'input');
}
function nameAt(name, span, content) {
  text(name);
  let decoded;
  try { decoded = identifierName(content.slice(span.start, span.end)); } catch { arrayFactsFailure('input'); }
  arrayCheck(decoded === name, 'input');
}

/** Raw literal arithmetic only. Reject before allocating powers or a large BigInt. */
export function arrayIndexDecimal(token) {
  text(token);
  arrayCheck(Buffer.byteLength(token, 'utf8') <= 65536, 'limit');
  arrayCheck(!/^[+-]/.test(token), 'input');
  let syntax;
  try { syntax = numericTokenSyntax(token); } catch { arrayFactsFailure('input'); }
  if (syntax.radix) {
    const clean = syntax.text.replaceAll('_', ''), prefix = clean.slice(0, 2).toLowerCase();
    const digits = clean.slice(2).replace(/^0+/, '') || '0';
    arrayCheck(prefix === '0x' ? digits.length <= 8 : prefix === '0b'
      ? digits.length <= 32 : digits.length < 11 || digits.length === 11 && digits[0] <= '3', 'input');
    const value = BigInt(prefix + digits);
    arrayCheck(value <= 4294967294n, 'input'); return value.toString();
  }
  const match = syntax.decimal;
  arrayCheck(match, 'input');
  const fraction = (match[2] ?? match[3] ?? '').replaceAll('_', '');
  let digits = ((match[1] ?? '').replaceAll('_', '') + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const trimmed = digits.replace(/0+$/, ''), trailing = digits.length - trimmed.length;
  let exponent = (match[4] ?? '0').replaceAll('_', ''), negative = exponent.startsWith('-');
  exponent = exponent.replace(/^[+-]/, '').replace(/^0+/, '') || '0';
  // A nonzero coefficient has at most65536 digits. Any exponent with more than
  // six effective decimal digits is already outside the integer/small-domain bounds.
  arrayCheck(exponent.length <= 6, 'input');
  const scale = (negative ? -Number(exponent) : Number(exponent)) - fraction.length + trailing;
  arrayCheck(scale >= 0 && trimmed.length + scale <= 10, 'input');
  digits = trimmed + '0'.repeat(scale);
  const value = BigInt(digits);
  arrayCheck(value <= 4294967294n, 'input'); return value.toString();
}
function sources(payload) {
  logicalPath(payload.sourceRoot); logicalPath(payload.rootFile);
  const dtsPath = payload.sourceRoot + '/minimal-arrays-v1.d.ts';
  arrayCheck(payload.rootFile.startsWith(payload.sourceRoot + '/') && payload.rootFile.endsWith('.ts')
    && !payload.rootFile.endsWith('.d.ts'), 'input');
  arrayRecord(payload.config, ['strict', 'noEmit', 'allowJs']);
  arrayCheck(payload.config.strict === true && payload.config.noEmit === true && payload.config.allowJs === false, 'input');
  arrayRecord(payload.declarations, ['version', 'paths']);
  arrayCheck(payload.declarations.version === 'minimal-arrays-v1'
    && equal(payload.declarations.paths, [dtsPath]), 'input');
  const files = list(payload.files, 2, 2), seen = new Set();
  let previous;
  for (const file of files) {
    arrayRecord(file, ['path', 'content', 'sha256', 'byteLength', 'utf16Length']);
    logicalPath(file.path);
    arrayCheck(!seen.has(file.path) && [payload.rootFile, dtsPath].includes(file.path), 'input');
    if (previous !== undefined) arrayCheck(Buffer.compare(Buffer.from(previous), Buffer.from(file.path)) < 0, 'input');
    previous = file.path; seen.add(file.path);
    arrayCheck(typeof file.content === 'string' && file.content.isWellFormed(), 'input');
    const size = Buffer.byteLength(file.content, 'utf8');
    arrayCheck(size <= 65536 && file.content.length <= 65536, 'limit');
    arrayCheck(file.byteLength === size && file.utf16Length === file.content.length, 'input');
    arrayCheck(/^[0-9a-f]{64}$/.test(file.sha256) && file.sha256 === sha256(file.content).slice(7), 'identity');
  }
  const declaration = files.find(file => file.path === dtsPath);
  arrayCheck(declaration && declaration.byteLength === 312
    && declaration.sha256 === '04a97584458d9212250e94d4fc517264c277a9ce635fbb14de11452194fd76b2', 'input');
  const source = files.find(file => file.path === payload.rootFile);
  arrayCheck(source, 'input'); return { source, declaration };
}
function types(rows, declaration) {
  list(rows, 2, 2);
  const content = declaration.content;
  const at = token => ({ start: content.indexOf(token), end: content.indexOf(token) + token.length });
  const f64 = { id: 'f64', kind: 'scalar', sourcePath: declaration.path,
    declarationRange: at('type f64 = number;'), nameRange: at('f64') };
  const array = { id: 'array.f64', kind: 'array', elementType: 'f64', sourcePath: declaration.path,
    declarationRange: at('interface Array<T> { [n: number]: T; length: number; }'),
    nameRange: at('Array'), indexSignatureRange: at('[n: number]: T;') };
  arrayCheck(equal(rows, [f64, array]), 'input');
}
function binding(row, fn, source, known) {
  arrayRecord(row, ['id','name','kind','declaredType','writable','declarationRange','nameRange',
    'annotationRange','elementAnnotationRange']);
  digest(row.id); text(row.name);
  arrayCheck(row.kind === 'const' && row.declaredType === 'array.f64' && row.writable === false, 'input');
  range(row.declarationRange, fn.declarationRange, source.content);
  range(row.nameRange, row.declarationRange, source.content); nameAt(row.name, row.nameRange, source.content);
  arrayCheck(row.id === originIdentity('tsfg.array-facts.binding.v1', source.path, row.nameRange, 'nameRange')
    && !known.has(row.id), 'identity');
  arrayCheck((row.annotationRange === null) === (row.elementAnnotationRange === null), 'input');
  if (row.annotationRange !== null) {
    range(row.annotationRange, row.declarationRange, source.content);
    range(row.elementAnnotationRange, row.annotationRange, source.content);
    nameAt('f64', row.elementAnnotationRange, source.content);
    arrayCheck(window(source.content, row.annotationRange.start, row.elementAnnotationRange.start).trim() === ''
      && compact(source.content, {start: row.elementAnnotationRange.end, end: row.annotationRange.end}) === '[]'
      && row.nameRange.end <= row.annotationRange.start, 'input');
  }
}
function reference(value, parent, source, known) {
  arrayRecord(value, ['kind','binding','flowType','range']);
  arrayCheck(value.kind === 'reference' && value.flowType === 'array.f64' && known.has(value.binding), 'input');
  range(value.range, parent, source.content);
  nameAt(known.get(value.binding).name, value.range, source.content);
}
function literal(value, parent, source, sites, count) {
  arrayRecord(value, ['kind','type','range','allocationSite','elements']);
  arrayCheck(value.kind === 'arrayLiteral' && value.type === 'array.f64', 'input');
  range(value.range, parent, source.content); digest(value.allocationSite);
  arrayCheck(value.allocationSite === originIdentity('tsfg.array-facts.allocation-site.v1', source.path, value.range, 'range')
    && !sites.has(value.allocationSite), 'identity');
  sites.add(value.allocationSite);
  list(value.elements, 0, 256); count.units += value.elements.length;
  arrayCheck(count.units <= 4096, 'limit');
  arrayCheck(source.content[value.range.start] === '[' && source.content[value.range.end - 1] === ']', 'input');
  let end = value.range.start + 1, ordinal = 0;
  for (const item of value.elements) {
    arrayRecord(item, ['kind','type','range','token','bits']);
    arrayCheck(item.kind === 'numericLiteral' && item.type === 'f64', 'input');
    range(item.range, value.range, source.content);
    arrayCheck(item.range.start >= end && item.range.end < value.range.end, 'input');
    arrayCheck(window(source.content, end, item.range.start).trim() === (ordinal++ ? ',' : ''), 'input');
    end = item.range.end; text(item.token); tokenAt(item.token, item.range, source.content, true);
    let bits;
    try { bits = floatBits(item.token, 'f64'); } catch { arrayFactsFailure('input'); }
    arrayCheck(item.bits === bits, 'input');
  }
  const tail = window(source.content, end, value.range.end - 1).trim();
  arrayCheck(tail === '' || ordinal > 0 && tail === ',', 'input');
}
function checkedRead(value, parent, source, known) {
  arrayRecord(value, ['kind','type','range','array','index']);
  arrayCheck(value.kind === 'checkedElementAccess' && value.type === 'f64', 'input');
  range(value.range, parent, source.content);
  reference(value.array, value.range, source, known);
  const index = value.index;
  arrayRecord(index, ['kind','type','range','token','decimal']);
  arrayCheck(index.kind === 'indexLiteral' && index.type === 'u32', 'input');
  range(index.range, value.range, source.content);
  arrayCheck(value.range.start === value.array.range.start && value.array.range.end <= index.range.start
    && index.range.end < value.range.end && source.content[value.range.end - 1] === ']', 'input');
  tokenAt(index.token, index.range, source.content);
  arrayCheck(index.decimal === arrayIndexDecimal(index.token)
    && compact(source.content, {start: value.array.range.end, end: index.range.start}) === '['
    && compact(source.content, {start: index.range.end, end: value.range.end}) === ']', 'input');
}
export function validateArrayFactsPayload(payload) {
  arrayRecord(payload, ['sourceRoot','rootFile','positionUnit','config','declarations','files','types','functions','exports','diagnostics']);
  arrayCheck(payload.positionUnit === 'utf16', 'input');
  const { source, declaration } = sources(payload); types(payload.types, declaration);
  list(payload.diagnostics, 0, 0);
  const functions = list(payload.functions, 1, 16), ids = new Set(), names = new Set(), sites = new Set();
  let previousEnd = 0;
  const count = { units: 0 };
  for (const fn of functions) {
    arrayRecord(fn, ['id','name','sourcePath','declarationRange','nameRange','returnType','returnAnnotationRange',
      'parameters','bindings','body']);
    arrayCheck(fn.sourcePath === source.path && fn.returnType === 'f64', 'input'); digest(fn.id);
    range(fn.declarationRange, { start: 0, end: source.content.length }, source.content);
    arrayCheck(fn.declarationRange.start >= previousEnd
      && window(source.content, previousEnd, fn.declarationRange.start).trim() === '', 'input');
    previousEnd = fn.declarationRange.end;
    range(fn.nameRange, fn.declarationRange, source.content); nameAt(fn.name, fn.nameRange, source.content);
    range(fn.returnAnnotationRange, fn.declarationRange, source.content);
    nameAt('f64', fn.returnAnnotationRange, source.content);
    arrayCheck(/^export\s+function\s+$/.test(window(source.content, fn.declarationRange.start, fn.nameRange.start))
      && compact(source.content, {start: fn.nameRange.end, end: fn.returnAnnotationRange.start}) === '():', 'input');
    arrayCheck(fn.id === originIdentity('tsfg.array-facts.binding.v1', source.path, fn.nameRange, 'nameRange')
      && !ids.has(fn.id) && !names.has(fn.name), 'identity');
    ids.add(fn.id); names.add(fn.name); list(fn.parameters, 0, 0);
    const bindings = list(fn.bindings, 1, 17), body = list(fn.body, 2, 18), known = new Map(), localNames = new Set();
    arrayCheck(body.length === bindings.length + 1, 'input');
    let end = fn.returnAnnotationRange.end;
    range(body[0]?.range, fn.declarationRange, source.content);
    arrayCheck(compact(source.content, {start: end, end: body[0].range.start}) === '{', 'input');
    end = body[0].range.start;
    for (const [index, row] of bindings.entries()) {
      binding(row, fn, source, known);
      arrayCheck(!ids.has(row.id) && !localNames.has(row.name), 'identity'); ids.add(row.id); localNames.add(row.name);
      const statement = body[index];
      arrayRecord(statement, ['kind','binding','range','initializer']);
      arrayCheck(statement.kind === 'variable' && statement.binding === row.id, 'input');
      range(statement.range, fn.declarationRange, source.content);
      arrayCheck(statement.range.start >= end && statement.range.start < row.declarationRange.start
        && row.declarationRange.end <= statement.range.end
        && window(source.content, end, statement.range.start).trim() === ''
        && row.declarationRange.start === row.nameRange.start
        && /^const\s+$/.test(window(source.content, statement.range.start, row.nameRange.start)), 'input');
      end = statement.range.end;
      const init = statement.initializer;
      if (init?.kind === 'arrayLiteral') {
        arrayCheck(row.annotationRange !== null, 'input');
        literal(init, row.declarationRange, source, sites, count);
      } else reference(init, row.declarationRange, source, known);
      arrayCheck(row.nameRange.end <= init.range.start && row.declarationRange.end === init.range.end, 'input');
      const annotation = row.annotationRange;
      if (annotation !== null) arrayCheck(compact(source.content, {start: row.nameRange.end, end: annotation.start}) === ':', 'input');
      arrayCheck(compact(source.content, {start: annotation === null ? row.nameRange.end : annotation.end, end: init.range.start}) === '=', 'input');
      const terminator = window(source.content, init.range.end, statement.range.end).trim();
      arrayCheck(terminator === '' || terminator === ';', 'input');
      if (!terminator) {
        range(body[index + 1]?.range, fn.declarationRange, source.content);
        arrayCheck(lineBreak(source.content.slice(init.range.end, body[index + 1].range.start)), 'input');
      }
      known.set(row.id, row);
    }
    const returned = body.at(-1);
    arrayRecord(returned, ['kind','range','value']);
    arrayCheck(returned.kind === 'return', 'input');
    range(returned.range, fn.declarationRange, source.content);
    arrayCheck(returned.range.start >= end && returned.range.end < fn.declarationRange.end
      && window(source.content, end, returned.range.start).trim() === '', 'input');
    checkedRead(returned.value, returned.range, source, known);
    const expression = returned.value.range;
    const prefix = source.content.slice(returned.range.start, expression.start);
    arrayCheck(/^return\s+$/.test(window(source.content, returned.range.start, expression.start))
      && !lineBreak(prefix), 'input');
    const terminator = window(source.content, expression.end, returned.range.end).trim();
    arrayCheck((terminator === '' || terminator === ';')
      && compact(source.content, {start: returned.range.end, end: fn.declarationRange.end}) === '}', 'input');
  }
  arrayCheck(window(source.content, previousEnd, source.content.length).trim() === '', 'input');
  const exports = list(payload.exports, 1, 16);
  arrayCheck(exports.length === functions.length, 'input');
  const expected = functions.map(fn => ({ name: fn.name, functionId: fn.id }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  arrayCheck(equal(exports, expected), 'identity');
}
