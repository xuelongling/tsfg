// SPDX-License-Identifier: MIT
// Cold expression syntax, scalar provenance and literal identity; never evaluates reads.
import { floatBits } from './float.mjs';
import { arrayCheck as check, arrayRecord as record, arrayFactsFailure as failure, list, text, digest, range, originIdentity, nameAt, tokenAt, window, compact, arrayIndexDecimal } from './array-facts-common.mjs';

export function binding(row, fn, source, known) {
  record(row, ['id','name','kind','declaredType','writable','declarationRange','nameRange',
    'annotationRange','elementAnnotationRange']);
  digest(row.id); text(row.name);
  check(row.kind === 'const' && row.declaredType === 'array.f64' && row.writable === false, 'input');
  range(row.declarationRange, fn.declarationRange, source.content);
  range(row.nameRange, row.declarationRange, source.content); nameAt(row.name, row.nameRange, source.content);
  check(row.id === originIdentity('tsfg.array-facts.binding.v1', source.path, row.nameRange, 'nameRange')
    && !known.has(row.id), 'identity');
  check((row.annotationRange === null) === (row.elementAnnotationRange === null), 'input');
  if (row.annotationRange !== null) {
    range(row.annotationRange, row.declarationRange, source.content);
    range(row.elementAnnotationRange, row.annotationRange, source.content);
    nameAt('f64', row.elementAnnotationRange, source.content);
    check(window(source.content, row.annotationRange.start, row.elementAnnotationRange.start).trim() === ''
      && compact(source.content, {start: row.elementAnnotationRange.end, end: row.annotationRange.end}) === '[]'
      && row.nameRange.end <= row.annotationRange.start, 'input');
  }
}
export function reference(value, parent, source, known, type = 'array.f64') {
  record(value, ['kind','binding','flowType','range']);
  check(value.kind === 'reference' && value.flowType === type && known.has(value.binding) && known.get(value.binding).declaredType === type, 'input');
  range(value.range, parent, source.content);
  nameAt(known.get(value.binding).name, value.range, source.content);
}
export function literal(value, parent, source, sites, count) {
  record(value, ['kind','type','range','allocationSite','elements']);
  check(value.kind === 'arrayLiteral' && value.type === 'array.f64', 'input');
  range(value.range, parent, source.content); digest(value.allocationSite);
  check(value.allocationSite === originIdentity('tsfg.array-facts.allocation-site.v1', source.path, value.range, 'range')
    && !sites.has(value.allocationSite), 'identity');
  sites.add(value.allocationSite);
  list(value.elements, 0, 256); count.units += value.elements.length;
  check(count.units <= 4096, 'limit');
  check(source.content[value.range.start] === '[' && source.content[value.range.end - 1] === ']', 'input');
  let end = value.range.start + 1, ordinal = 0;
  for (const item of value.elements) {
    floating(item, value.range, source);
    check(item.range.start >= end && item.range.end < value.range.end, 'input');
    check(window(source.content, end, item.range.start).trim() === (ordinal++ ? ',' : ''), 'input');
    end = item.range.end;
  }
  const tail = window(source.content, end, value.range.end - 1).trim();
  check(tail === '' || ordinal > 0 && tail === ',', 'input');
}
export function floating(value, parent, source) {
  record(value, ['kind','type','range','token','bits']);
  check(value.kind === 'numericLiteral' && value.type === 'f64', 'input');
  range(value.range, parent, source.content); text(value.token);
  tokenAt(value.token, value.range, source.content, true);
  let bits;
  try { bits = floatBits(value.token, 'f64'); } catch { failure('input'); }
  check(value.bits === bits, 'input');
}
export function integer(value, parent, source, parameters, length = false) {
  if (value?.kind === 'reference') { reference(value, parent, source, parameters, 'u32'); return; }
  record(value, ['kind','type','range','token','decimal']);
  check(value.kind === (length ? 'lengthLiteral' : 'indexLiteral') && value.type === 'u32', 'input');
  range(value.range, parent, source.content); tokenAt(value.token, value.range, source.content);
  check(value.decimal === arrayIndexDecimal(value.token, length ? 4294967295n : 4294967294n), 'input');
}
export function element(value, parent, source, known, parameters, target = false) {
  record(value, ['kind','type','range','array','index']);
  check(value.kind === (target ? 'elementTarget' : 'checkedElementAccess') && value.type === 'f64', 'input');
  range(value.range, parent, source.content);
  reference(value.array, value.range, source, known);
  integer(value.index, value.range, source, parameters);
  check(value.range.start === value.array.range.start && value.array.range.end < value.index.range.start
    && value.index.range.end < value.range.end
    && compact(source.content, {start: value.array.range.end, end: value.index.range.start}) === '['
    && compact(source.content, {start: value.index.range.end, end: value.range.end}) === ']', 'input');
}
export function scalar(value, parent, source, known, parameters) {
  if (value?.kind === 'numericLiteral') floating(value, parent, source);
  else if (value?.kind === 'reference') reference(value, parent, source, parameters, 'f64');
  else element(value, parent, source, known, parameters);
}
export function lengthTarget(value, parent, source, known, property) {
  record(value, ['kind','type','range','array','property','nameRange']);
  check(value.kind === 'lengthTarget' && value.type === 'u32' && value.property === property.id, 'input');
  range(value.range, parent, source.content); reference(value.array, value.range, source, known);
  range(value.nameRange, value.range, source.content); nameAt('length', value.nameRange, source.content);
  check(value.range.start === value.array.range.start && value.range.end === value.nameRange.end
    && value.array.range.end < value.nameRange.start
    && compact(source.content, {start: value.array.range.end, end: value.nameRange.start}) === '.', 'input');
}
