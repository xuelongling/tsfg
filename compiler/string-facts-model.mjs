// SPDX-License-Identifier: MIT
// Structural ownership only: official checking and Source completeness stay with the producer.
import { sha256 } from './identity.mjs';

const DTS_HASH = 'd629059f5175a580a8a7b19531c7d8cff1bfa7b61320f6638cf4ee25fbf5a141';
const DTS_NAME = 'minimal-scalars-v2.d.ts';

/** @returns {never} */
export function stringFactsFailure(category) {
  const code = 'r03-string-facts-' + category;
  throw Object.assign(new TypeError(code + ': invalid private string-facts candidate'), { code });
}
const check = (condition, category = 'schema') => { if (!condition) stringFactsFailure(category); };

// The frame and payload use the same exact-record contract after JSON preflight.
export function stringFactsRecord(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  check(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
function array(value, maximum, minimum = 0, category = 'limit') {
  check(Array.isArray(value));
  check(value.length >= minimum && value.length <= maximum, category);
  return value;
}
function integer(value) {
  check(Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0));
  return value;
}
function logicalPath(value) {
  check(typeof value === 'string');
  check(value.isWellFormed() && !value.includes('\0')
    && value.startsWith('/') && value.length >= 2 && !value.includes('\\')
    && value.slice(1).split('/').every(part => part && part !== '.' && part !== '..'), 'input');
  return value;
}
function sourceInput(payload, limits) {
  const sourceRoot = logicalPath(payload.sourceRoot), rootFile = logicalPath(payload.rootFile);
  check(rootFile.startsWith(sourceRoot + '/') && rootFile.endsWith('.ts') && !rootFile.endsWith('.d.ts'), 'input');
  stringFactsRecord(payload.config, ['strict', 'noEmit', 'allowJs']);
  check(payload.config.strict === true && payload.config.noEmit === true && payload.config.allowJs === false, 'input');
  stringFactsRecord(payload.declarations, ['version', 'paths']);
  const declarations = payload.declarations, declarationPath = sourceRoot + '/' + DTS_NAME;
  check(declarations.version === 'minimal-scalars-v2', 'input');
  array(declarations.paths, 1, 1, 'input');
  check(declarations.paths[0] === declarationPath, 'input');
  const supplied = array(payload.files, 2, 2, 'input'), seen = new Set();
  let previous;
  for (const file of supplied) {
    stringFactsRecord(file, ['path', 'content', 'sha256', 'byteLength', 'utf16Length']);
    const name = logicalPath(file.path);
    check(name.startsWith(sourceRoot + '/') && !seen.has(name)
      && (name === rootFile || name === declarationPath), 'input');
    if (previous !== undefined) check(Buffer.compare(Buffer.from(previous), Buffer.from(name)) < 0, 'input');
    previous = name; seen.add(name);
    check(typeof file.content === 'string' && file.content.isWellFormed());
    const byteLength = Buffer.byteLength(file.content, 'utf8');
    check(byteLength <= limits.sourceUTF8Bytes, 'limit');
    integer(file.byteLength); integer(file.utf16Length);
    check(file.byteLength === byteLength && file.utf16Length === file.content.length, 'source');
    check(typeof file.sha256 === 'string' && /^[0-9a-f]{64}$/.test(file.sha256)
      && file.sha256 === sha256(file.content).slice(7), 'identity');
  }
  check(seen.has(rootFile) && seen.has(declarationPath)
    && !rootFile.startsWith(declarationPath + '/') && !declarationPath.startsWith(rootFile + '/'), 'input');
  const declaration = supplied.find(file => file.path === declarationPath);
  check(declaration.byteLength === 362 && declaration.sha256 === DTS_HASH, 'input');
  return { source: supplied.find(file => file.path === rootFile),
    input: { sourceRoot, rootFile, config: payload.config, declarations,
      files: supplied.map(({ path, content, sha256 }) => ({ path, content, sha256 })) } };
}
function range(value, parent, content, nested = false) {
  stringFactsRecord(value, ['start', 'end']);
  const { start, end } = value;
  const boundary = index => !(content.charCodeAt(index) >= 0xdc00 && content.charCodeAt(index) <= 0xdfff
    && content.charCodeAt(index - 1) >= 0xd800 && content.charCodeAt(index - 1) <= 0xdbff);
  check(Number.isSafeInteger(start) && Number.isSafeInteger(end) && !Object.is(start, -0) && !Object.is(end, -0)
    && start >= parent.start && start < end && end <= parent.end
    && (!nested || start > parent.start && end < parent.end) && boundary(start) && boundary(end), 'range');
  return value;
}

/**
 * Validate the full closed data model without parsing or evaluating TypeScript.
 * Bounds/ownership are checked here; a self-consistent package cannot prove that
 * its values or declaration list equal the official checked Source semantics.
 * @param {any} payload
 * @param {any} limits
 */
export function validateStringFactsPayload(payload, limits) {
  stringFactsRecord(payload, ['sourceRoot', 'rootFile', 'config', 'declarations', 'files', 'positionUnit', 'functions']);
  check(payload.positionUnit === 'utf16');
  const { source, input } = sourceInput(payload, limits);
  const functions = array(payload.functions, limits.functions, 1), names = new Set();
  const sourceRange = { start: 0, end: source.utf16Length };
  let previousEnd = 0, totalUnits = 0;
  for (const fn of functions) {
    stringFactsRecord(fn, ['name', 'sourcePath', 'declarationRange', 'parameters', 'returnType', 'body']);
    check(typeof fn.name === 'string' && fn.name.length > 0 && fn.name.isWellFormed());
    check(fn.sourcePath === source.path && !names.has(fn.name), 'owner');
    names.add(fn.name);
    check(fn.returnType === 'string'); array(fn.parameters, 0, 0, 'schema');
    const declaration = range(fn.declarationRange, sourceRange, source.content);
    check(declaration.start >= previousEnd, 'range'); previousEnd = declaration.end;
    const body = array(fn.body, 1, 1, 'schema'), statement = body[0];
    stringFactsRecord(statement, ['kind', 'range', 'value']); check(statement.kind === 'return');
    const statementRange = range(statement.range, declaration, source.content, true), value = statement.value;
    stringFactsRecord(value, ['kind', 'type', 'range', 'codeUnits']);
    check(value.kind === 'stringLiteral' && value.type === 'string');
    // ASI can end a return at its literal; the literal still starts after return.
    const literalRange = range(value.range, statementRange, source.content);
    check(literalRange.start > statementRange.start && literalRange.end - literalRange.start >= 2, 'range');
    const units = array(value.codeUnits, limits.valueCodeUnits);
    totalUnits += units.length; check(totalUnits <= limits.packageCodeUnits, 'limit');
    for (const unit of units) check(Number.isSafeInteger(unit) && !Object.is(unit, -0)
      && unit >= 0 && unit <= 65535, 'code-unit');
  }
  return { family: 'tsfg.string-facts-request-candidate', version: 1, input };
}
