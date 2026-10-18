// SPDX-License-Identifier: MIT
// Own complete flat functions, parameter uses and per-allocation normal-continuation state.
import { arrayCheck as check, arrayRecord as record, list, digest, range, nameAt,
  originIdentity, window, compact, lineBreak } from './array-facts-common.mjs';
import { binding, reference, literal, element, scalar, integer, lengthTarget } from './array-facts-expressions.mjs';

function parameters(fn, source, ids, names) {
  const known = new Map(); let end = fn.nameRange.end;
  for (const [index, row] of list(fn.parameters, 0, 8).entries()) {
    record(row, ['id','name','kind','declaredType','writable','declarationRange','nameRange','annotationRange']);
    check(row.kind === 'parameter' && ['f64','u32'].includes(row.declaredType) && row.writable === true, 'input');
    digest(row.id); range(row.declarationRange, fn.declarationRange, source.content);
    range(row.nameRange, row.declarationRange, source.content); nameAt(row.name, row.nameRange, source.content);
    range(row.annotationRange, row.declarationRange, source.content);
    nameAt(row.declaredType, row.annotationRange, source.content);
    check(row.declarationRange.start === row.nameRange.start && row.declarationRange.end === row.annotationRange.end
      && row.nameRange.end < row.annotationRange.start
      && compact(source.content, {start: row.nameRange.end, end: row.annotationRange.start}) === ':'
      && compact(source.content, {start: end, end: row.declarationRange.start}) === (index ? ',' : '('), 'input');
    check(row.id === originIdentity('tsfg.array-facts.binding.v1', source.path, row.nameRange, 'nameRange')
      && !ids.has(row.id) && !names.has(row.name), 'identity');
    ids.add(row.id); names.add(row.name); known.set(row.id, row); end = row.declarationRange.end;
  }
  const tail = compact(source.content, {start: end, end: fn.returnAnnotationRange.start});
  check(fn.parameters.length ? tail === '):' || tail === ',):' : tail === '():', 'input');
  return known;
}
function terminate(statement, expression, next, source) {
  const tail = window(source.content, expression.end, statement.range.end).trim();
  check(tail === '' || tail === ';', 'input');
  if (!tail && next) check(lineBreak(source.content.slice(expression.end, next.range.start)), 'input');
}
function variable(statement, row, fn, source, known, sites, count) {
  record(statement, ['kind','binding','range','initializer']);
  check(statement.binding === row.id, 'input'); binding(row, fn, source, known);
  check(statement.range.start < row.declarationRange.start && row.declarationRange.end <= statement.range.end
    && row.declarationRange.start === row.nameRange.start
    && /^const\s+$/.test(window(source.content, statement.range.start, row.nameRange.start)), 'input');
  const init = statement.initializer;
  if (init?.kind === 'arrayLiteral') {
    check(row.annotationRange !== null, 'input'); literal(init, row.declarationRange, source, sites, count);
  } else reference(init, row.declarationRange, source, known);
  check(row.nameRange.end <= init.range.start && row.declarationRange.end === init.range.end, 'input');
  const annotation = row.annotationRange;
  if (annotation !== null) check(compact(source.content, {start: row.nameRange.end, end: annotation.start}) === ':', 'input');
  check(compact(source.content, {start: annotation === null ? row.nameRange.end : annotation.end, end: init.range.start}) === '=', 'input');
  return init.range;
}
function mutation(statement, fn, source, known, params, property, owners, lengths) {
  record(statement, ['kind','range','expressionRange','operatorRange','target','value']);
  const store = statement.kind === 'elementAssignment';
  check(store || statement.kind === 'lengthAssignment', 'input');
  range(statement.expressionRange, statement.range, source.content);
  range(statement.operatorRange, statement.expressionRange, source.content);
  check(source.content.slice(statement.operatorRange.start, statement.operatorRange.end) === '=', 'input');
  if (store) {
    element(statement.target, statement.expressionRange, source, known, params, true);
    scalar(statement.value, statement.expressionRange, source, known, params);
  } else {
    lengthTarget(statement.target, statement.expressionRange, source, known, property);
    integer(statement.value, statement.expressionRange, source, params, true);
  }
  const target = statement.target, value = statement.value, op = statement.operatorRange;
  check(statement.range.start === statement.expressionRange.start && target.range.start === statement.expressionRange.start
    && statement.expressionRange.end === value.range.end && target.range.end <= op.start && op.end <= value.range.start
    && window(source.content, target.range.end, op.start).trim() === ''
    && window(source.content, op.end, value.range.start).trim() === '', 'input');
  const owner = owners.get(target.array.binding), previous = lengths.get(owner);
  const operand = store ? target.index : value;
  if (operand.kind === 'reference') lengths.set(owner, null);
  else {
    const n = Number(operand.decimal);
    check(previous === null || n <= previous, 'density');
    lengths.set(owner, store ? previous === null ? null : Math.max(previous, n + 1) : n);
  }
  return statement.expressionRange;
}
export function validateArrayFunctions(payload, source) {
  const functions = list(payload.functions, 1, 16), ids = new Set(), names = new Set(), sites = new Set();
  let previousEnd = 0; const count = { units: 0 };
  for (const fn of functions) {
    record(fn, ['id','name','sourcePath','declarationRange','nameRange','returnType','returnAnnotationRange','parameters','bindings','body']);
    check(fn.sourcePath === source.path && fn.returnType === 'f64', 'input'); digest(fn.id);
    range(fn.declarationRange, {start: 0, end: source.content.length}, source.content);
    check(fn.declarationRange.start >= previousEnd && window(source.content, previousEnd, fn.declarationRange.start).trim() === '', 'input');
    previousEnd = fn.declarationRange.end;
    range(fn.nameRange, fn.declarationRange, source.content); nameAt(fn.name, fn.nameRange, source.content);
    range(fn.returnAnnotationRange, fn.declarationRange, source.content); nameAt('f64', fn.returnAnnotationRange, source.content);
    check(/^export\s+function\s+$/.test(window(source.content, fn.declarationRange.start, fn.nameRange.start)), 'input');
    check(fn.id === originIdentity('tsfg.array-facts.binding.v1', source.path, fn.nameRange, 'nameRange')
      && !ids.has(fn.id) && !names.has(fn.name), 'identity');
    ids.add(fn.id); names.add(fn.name);
    const localNames = new Set(), params = parameters(fn, source, ids, localNames);
    const bindings = list(fn.bindings, 1, 17), body = list(fn.body, 2, 50), known = new Map();
    const owners = new Map(), lengths = new Map();
    let end = fn.returnAnnotationRange.end, localIndex = 0, mutations = 0;
    for (const [index, statement] of body.entries()) {
      range(statement?.range, fn.declarationRange, source.content);
      check(statement.range.start >= end && statement.range.end < fn.declarationRange.end
        && compact(source.content, {start: end, end: statement.range.start}) === (index ? '' : '{'), 'input');
      let expression;
      if (statement.kind === 'variable') {
        check(index < body.length - 1 && localIndex < bindings.length, 'input');
        const row = bindings[localIndex++];
        expression = variable(statement, row, fn, source, known, sites, count);
        check(!ids.has(row.id) && !localNames.has(row.name), 'identity'); ids.add(row.id); localNames.add(row.name);
        const init = statement.initializer;
        const owner = init.kind === 'arrayLiteral' ? init.allocationSite : owners.get(init.binding);
        owners.set(row.id, owner);
        if (init.kind === 'arrayLiteral') lengths.set(owner, init.elements.length);
        known.set(row.id, row);
      } else if (statement.kind === 'return') {
        record(statement, ['kind','range','value']); check(index === body.length - 1, 'input');
        element(statement.value, statement.range, source, known, params);
        expression = statement.value.range;
        check(/^return\s+$/.test(window(source.content, statement.range.start, expression.start))
          && !lineBreak(source.content.slice(statement.range.start, expression.start)), 'input');
      } else {
        check(index < body.length - 1, 'input'); check(++mutations <= 32, 'limit');
        expression = mutation(statement, fn, source, known, params, payload.arrayLength, owners, lengths);
      }
      terminate(statement, expression, body[index + 1], source); end = statement.range.end;
    }
    check(localIndex === bindings.length && body.at(-1).kind === 'return'
      && compact(source.content, {start: end, end: fn.declarationRange.end}) === '}', 'input');
  }
  check(window(source.content, previousEnd, source.content.length).trim() === '', 'input');
  return functions;
}
