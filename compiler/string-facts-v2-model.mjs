// SPDX-License-Identifier: MIT
// V2 owns two literal leaves and their operation; Source semantics are not reconstructed.
import { stringFactsRecord as record, stringFactsSourceInput, stringFactsRange } from './string-facts-model.mjs';

/** @param {string} category @param {any} [cause] @returns {never} */
export function stringFactsV2Failure(category, cause = undefined) {
  const code = 'r03-string-facts-' + category;
  throw Object.assign(new TypeError(code + ': invalid private string-facts v2 candidate', { cause }),
    { code, ruleId: 'r01-input-boundary', phase: 'input' });
}
const check = (condition, category = 'schema') => { if (!condition) stringFactsV2Failure(category); };
const field = (value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
function array(value, maximum, minimum = 0, category = 'limit') {
  check(Array.isArray(value));
  check(value.length >= minimum && value.length <= maximum, category);
  return value;
}

// Fixed model paths only, after the shared graph preflight and before identity hashes.
export function checkStringFactsV2DomainBudget(payload, limits) {
  const files = field(payload, 'files');
  if (Array.isArray(files)) for (const file of files) {
    const content = field(file, 'content');
    if (typeof content === 'string') check(Buffer.byteLength(content, 'utf8') <= limits.sourceUTF8Bytes, 'limit');
  }
  const functions = field(payload, 'functions');
  if (!Array.isArray(functions)) return;
  check(functions.length <= limits.functions, 'limit');
  let total = 0;
  for (const fn of functions) {
    const body = field(fn, 'body');
    if (!Array.isArray(body) || body.length !== 1) continue;
    const value = field(body[0], 'value');
    let concat = 0;
    for (const leaf of [field(value, 'left'), field(value, 'right')]) {
      const units = field(leaf, 'codeUnits');
      if (!Array.isArray(units)) continue;
      check(units.length <= limits.valueCodeUnits, 'limit');
      total += units.length; concat += units.length;
      check(total <= limits.packageCodeUnits, 'limit');
    }
    check(concat <= limits.concatCodeUnits, 'limit');
  }
}

function literal(value, parent, source, limits) {
  record(value, ['kind', 'type', 'range', 'codeUnits']);
  check(value.kind === 'stringLiteral' && value.type === 'string');
  const where = stringFactsRange(value.range, parent, source.content);
  const quote = source.content[where.start];
  check(where.end - where.start >= 2 && (quote === '"' || quote === "'")
    && source.content[where.end - 1] === quote, 'range');
  const units = array(value.codeUnits, limits.valueCodeUnits);
  for (const unit of units) check(Number.isSafeInteger(unit) && !Object.is(unit, -0)
    && unit >= 0 && unit <= 65535, 'code-unit');
  return where;
}

/** @param {any} payload @param {any} limits */
export function validateStringFactsV2Payload(payload, limits) {
  try {
    record(payload, ['sourceRoot', 'rootFile', 'config', 'declarations', 'files', 'positionUnit', 'functions']);
    check(payload.positionUnit === 'utf16');
    checkStringFactsV2DomainBudget(payload, limits);
    const { source, input } = stringFactsSourceInput(payload, limits);
    const functions = array(payload.functions, limits.functions, 1), names = new Set();
    const sourceRange = { start: 0, end: source.utf16Length };
    let previousEnd = 0;
    for (const fn of functions) {
      record(fn, ['name', 'sourcePath', 'declarationRange', 'parameters', 'returnType', 'body']);
      check(typeof fn.name === 'string' && fn.name.length > 0 && fn.name.isWellFormed());
      check(fn.sourcePath === source.path && !names.has(fn.name), 'owner'); names.add(fn.name);
      check(fn.returnType === 'string'); array(fn.parameters, 0, 0, 'schema');
      const declaration = stringFactsRange(fn.declarationRange, sourceRange, source.content);
      check(declaration.start >= previousEnd, 'range'); previousEnd = declaration.end;
      const statement = array(fn.body, 1, 1, 'schema')[0];
      record(statement, ['kind', 'range', 'value']); check(statement.kind === 'return');
      const returned = stringFactsRange(statement.range, declaration, source.content, true), value = statement.value;
      record(value, ['kind', 'type', 'range', 'operatorRange', 'left', 'right']);
      check(value.kind === 'stringConcat' && value.type === 'string');
      const concat = stringFactsRange(value.range, returned, source.content);
      const plus = stringFactsRange(value.operatorRange, concat, source.content);
      const left = literal(value.left, concat, source, limits), right = literal(value.right, concat, source, limits);
      check(concat.start > returned.start && concat.start === left.start && concat.end === right.end
        && left.end <= plus.start && plus.end === plus.start + 1 && plus.end <= right.start
        && source.content[plus.start] === '+', 'range');
    }
    return { family: 'tsfg.string-facts-request-candidate', version: 2, input };
  } catch (cause) {
    if (cause?.ruleId === 'r01-input-boundary' && cause?.phase === 'input') throw cause;
    const prefix = 'r03-string-facts-';
    stringFactsV2Failure(typeof cause?.code === 'string' && cause.code.startsWith(prefix)
      ? cause.code.slice(prefix.length) : 'schema', cause);
  }
}
