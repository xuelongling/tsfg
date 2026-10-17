// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';

// Hand-authored Core conformance input. This is neither official Source output
// nor an execution oracle: only the real C++ Core boundary is under test.
export const coreCandidateSchema = 'sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd';
export const descriptorFileSha256 = 'f5781163c46aceb6ed913396005b9379a1834ce00b73f7f9260499b560dff514';
const formalSchema = 'sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6';
const layout = 'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128';

/** @typedef {'i32' | 'u' | 'n' | 'nu'} FixtureType */
/** @typedef {{name: string, parameters: FixtureType[], result: FixtureType, role: 'entry' | 'internal'}} Declaration */
/** @param {string | Uint8Array} value */
export const sha256 = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
/** @param {unknown} value @returns {string} */
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const text = JSON.stringify(value);
  if (typeof text !== 'string') throw new TypeError('fixture requires JSON data');
  return text;
}
/** @param {string} domain @param {unknown} record */
const candidateHash = (domain, record) => sha256(domain + '\0' + coreCandidateSchema + '\0' + canonical(record));
/** @type {Record<FixtureType, {mlir: string, record: unknown}>} */
const types = {
  i32: { mlir: 'i32', record: {kind: 'scalar', name: 'i32'} },
  u: { mlir: '!tsfg_nullable.i32<1>', record: {kind: 'nullable-i32', undefined: true, null: false} },
  n: { mlir: '!tsfg_nullable.i32<2>', record: {kind: 'nullable-i32', undefined: false, null: true} },
  nu: { mlir: '!tsfg_nullable.i32<3>', record: {kind: 'nullable-i32', undefined: true, null: true} },
};
/** @param {FixtureType} type */
const typeHash = type => candidateHash('tsfg.core-nullable-candidate.type.v1', types[type].record);
/** @param {{start: number, end: number}} range */
const at = range => 'tsfg_source.start = ' + range.start + ' : i64, tsfg_source.end = ' + range.end + ' : i64';
/** @param {string[]} functions @param {string} source @param {string} path @param {boolean} nullable */
function moduleText(functions, source, path, nullable) {
  const attrs = [
    'tsfg_core.version = "0.9.0"', 'tsfg_core.bytecode_schema = "' + formalSchema + '"',
    'tsfg_core.target = "windows-x86_64-msvc"', 'tsfg_core.triple = "x86_64-pc-windows-msvc"',
    'tsfg_core.data_layout = "' + layout + '"',
    'tsfg_core.input_identity = "' + sha256('M20 hand-authored Core input\0' + source) + '"',
    'tsfg_core.source_hash = "' + sha256(source) + '"', 'tsfg_core.source_path = ' + JSON.stringify(path),
    'tsfg_core.source_length = ' + source.length + ' : i64',
  ];
  if (nullable) attrs.push('tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "'
    + coreCandidateSchema + '", profile = "i32-null-undefined-internal-v1"}');
  return 'module attributes {' + attrs.join(', ') + '} {\n' + functions.join('\n') + '\n}\n';
}

export function scalarCoreControl() {
  const source = 'export function scalarControl(): i32 { return 42; }', path = '/core/scalar-control.ts';
  const signature = sha256('tsfg.signature\0()->i32');
  const id = sha256('tsfg.function\0' + path + '\0scalarControl\0' + signature.slice(7));
  const range = {start: 0, end: source.length}, value = source.indexOf('42'), returned = source.indexOf('return');
  const attrs = 'tsfg_core.function_id = "' + id + '", tsfg_core.signature_hash = "' + signature
    + '", tsfg_core.type_id = "' + sha256('tsfg.type\0i32') + '", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = '
    + source.length + ' : i64';
  return moduleText(['func.func @scalarControl() -> i32 attributes {' + attrs + '} {\n'
    + '  "tsfg_core.fuel"() {event = 1 : i32, ' + at(range) + '} : () -> ()\n'
    + '  %value = "tsfg_core.constant"() {value = 42 : i32, ' + at({start: value, end: value + 2}) + '} : () -> i32\n'
    + '  "func.return"(%value) {' + at({start: returned, end: source.indexOf(';', returned) + 1}) + '} : (i32) -> ()\n}'],
  source, path, false);
}

export function nullableCoreFixture() {
  const path = '/core/nullable-candidate.ts';
  const source = [
    'export function entry(kind: i32): i32 {',
    '  if (kind === 0) return classify(echoBoth(null));',
    '  if (kind === 1) return classify(echoBoth(echoUndefined(undefined)));',
    '  const three: i32 = 3;',
    '  return classify(echoBoth(three));',
    '}',
    'function echoBoth(value: i32 | null | undefined): i32 | null | undefined { return value; }',
    'function classify(value: i32 | null | undefined): i32 {',
    '  if (value === undefined) return 2;',
    '  const after: i32 | null = echoNull(value);',
    '  if (after === null) return 1;',
    '  return after;',
    '}',
    'function echoNull(value: i32 | null): i32 | null { return value; }',
    'function echoUndefined(value: i32 | undefined): i32 | undefined { return value; }',
    '',
  ].join('\n');
  /** @type {Declaration[]} */
  const declarations = [
    {name: 'entry', parameters: ['i32'], result: 'i32', role: 'entry'},
    {name: 'echoBoth', parameters: ['nu'], result: 'nu', role: 'internal'},
    {name: 'classify', parameters: ['nu'], result: 'i32', role: 'internal'},
    {name: 'echoNull', parameters: ['n'], result: 'n', role: 'internal'},
    {name: 'echoUndefined', parameters: ['u'], result: 'u', role: 'internal'},
  ];
  const functions = declarations.map((declaration, index) => {
    const start = source.indexOf((index === 0 ? 'export ' : '') + 'function ' + declaration.name + '(');
    const next = declarations[index + 1];
    const boundary = next ? source.indexOf('function ' + next.name + '(') : source.length;
    const end = source.lastIndexOf('}', boundary - 1) + 1;
    if (start < 0 || end <= start) throw new Error('invalid authored declaration span');
    const returnType = typeHash(declaration.result);
    const signatureHash = candidateHash('tsfg.core-nullable-candidate.signature.v1',
      {parameters: declaration.parameters.map(typeHash), returnType});
    const id = candidateHash('tsfg.core-nullable-candidate.function.v1',
      {name: declaration.name, signatureHash, source: {path, digest: sha256(source)}});
    return {...declaration, id, signatureHash, returnType, range: {start, end}};
  });
  /** @param {string} name */
  const fn = name => {
    const found = functions.find(item => item.name === name);
    if (!found) throw new Error('unknown authored function');
    return found;
  };
  /** @param {string} name @param {string} needle */
  const span = (name, needle) => {
    const owner = fn(name), start = source.indexOf(needle, owner.range.start), end = start + needle.length;
    if (start < owner.range.start || end > owner.range.end) throw new Error('invalid authored operation span');
    return {start, end};
  };
  /** @param {string} name @param {string} needle */
  const origin = (name, needle) => at(span(name, needle));
  /** @param {string} name */
  const fuel = name => '  "tsfg_core.fuel"() {event = 1 : i32, ' + at(fn(name).range) + '} : () -> ()';
  /** @param {string} result @param {string} callee @param {string} operand @param {string} caller @param {string} needle */
  const call = (result, callee, operand, caller, needle) => {
    const target = fn(callee);
    return '  ' + result + ' = "func.call"(' + operand + ') {callee = @' + callee
      + ', tsfg_core.function_id = "' + target.id + '", tsfg_core.signature_hash = "' + target.signatureHash
      + '", ' + origin(caller, needle) + '} : (' + target.parameters.map(type => types[type].mlir).join(', ')
      + ') -> ' + types[target.result].mlir;
  };
  /** @param {string} name @param {string[]} lines */
  const define = (name, lines) => {
    const owner = fn(name);
    return 'func.func @' + name + '(%value: ' + types[owner.parameters[0]].mlir + ') -> ' + types[owner.result].mlir
      + ' attributes {tsfg_core.function_id = "' + owner.id + '", tsfg_core.signature_hash = "' + owner.signatureHash
      + '", tsfg_core.type_id = "' + owner.returnType + '", tsfg_core.function_start = ' + owner.range.start
      + ' : i64, tsfg_core.function_end = ' + owner.range.end + ' : i64, tsfg_nullable.role = "' + owner.role
      + '"} {\n' + [fuel(name), ...lines].join('\n') + '\n}';
  };
  /** @param {string} name @param {string} value @param {FixtureType} type @param {string} needle */
  const returned = (name, value, type, needle) => '  "func.return"(' + value + ') {' + origin(name, needle)
    + '} : (' + types[type].mlir + ') -> ()';
  const entry = define('entry', [
    '  %zero = "tsfg_core.constant"() {value = 0 : i32, ' + origin('entry', 'kind === 0') + '} : () -> i32',
    '  %chooseNull = "tsfg_core.eq"(%value, %zero) {' + origin('entry', 'kind === 0') + '} : (i32, i32) -> i1',
    '  cf.cond_br %chooseNull, ^nullPath, ^otherPath {' + origin('entry', 'kind === 0') + '}',
    '^nullPath:',
    '  %null = "tsfg_nullable.absence"() {tag = 2 : i32, ' + origin('entry', 'null') + '} : () -> !tsfg_nullable.i32<2>',
    '  %nullWide = "tsfg_nullable.retype"(%null) {' + origin('entry', 'null') + '} : (!tsfg_nullable.i32<2>) -> !tsfg_nullable.i32<3>',
    '  cf.br ^join(%nullWide : !tsfg_nullable.i32<3>) {' + origin('entry', 'null') + '}',
    '^otherPath:',
    '  %one = "tsfg_core.constant"() {value = 1 : i32, ' + origin('entry', 'kind === 1') + '} : () -> i32',
    '  %chooseUndefined = "tsfg_core.eq"(%value, %one) {' + origin('entry', 'kind === 1') + '} : (i32, i32) -> i1',
    '  cf.cond_br %chooseUndefined, ^undefinedPath, ^presentPath {' + origin('entry', 'kind === 1') + '}',
    '^undefinedPath:',
    '  %undefined = "tsfg_nullable.absence"() {tag = 1 : i32, ' + origin('entry', 'undefined') + '} : () -> !tsfg_nullable.i32<1>',
    call('%echoU', 'echoUndefined', '%undefined', 'entry', 'echoUndefined(undefined)'),
    '  %undefinedWide = "tsfg_nullable.retype"(%echoU) {' + origin('entry', 'undefined') + '} : (!tsfg_nullable.i32<1>) -> !tsfg_nullable.i32<3>',
    '  cf.br ^join(%undefinedWide : !tsfg_nullable.i32<3>) {' + origin('entry', 'undefined') + '}',
    '^presentPath:',
    '  %three = "tsfg_core.constant"() {value = 3 : i32, ' + origin('entry', 'three: i32 = 3') + '} : () -> i32',
    '  %present = "tsfg_nullable.wrap_i32"(%three) {' + origin('entry', 'three: i32 = 3') + '} : (i32) -> !tsfg_nullable.i32<3>',
    '  cf.br ^join(%present : !tsfg_nullable.i32<3>) {' + origin('entry', 'three') + '}',
    '^join(%selected: !tsfg_nullable.i32<3>):',
    call('%echoed', 'echoBoth', '%selected', 'entry', 'echoBoth(three)'),
    call('%classified', 'classify', '%echoed', 'entry', 'classify(echoBoth(three))'),
    returned('entry', '%classified', 'i32', 'return classify(echoBoth(three));'),
  ]);
  const classify = define('classify', [
    '  %isUndefined = "tsfg_nullable.tag_test"(%value) {tag = 1 : i32, ' + origin('classify', 'value === undefined') + '} : (!tsfg_nullable.i32<3>) -> i1',
    '  cf.cond_br %isUndefined, ^undefinedResult, ^withoutUndefined {' + origin('classify', 'value === undefined') + '}',
    '^undefinedResult:',
    '  %two = "tsfg_core.constant"() {value = 2 : i32, ' + origin('classify', 'return 2;') + '} : () -> i32',
    returned('classify', '%two', 'i32', 'return 2;'),
    '^withoutUndefined:',
    '  %narrowed = "tsfg_nullable.retype"(%value) {' + origin('classify', 'echoNull(value)') + '} : (!tsfg_nullable.i32<3>) -> !tsfg_nullable.i32<2>',
    call('%after', 'echoNull', '%narrowed', 'classify', 'echoNull(value)'),
    '  %isNull = "tsfg_nullable.tag_test"(%after) {tag = 2 : i32, ' + origin('classify', 'after === null') + '} : (!tsfg_nullable.i32<2>) -> i1',
    '  cf.cond_br %isNull, ^nullResult, ^presentResult {' + origin('classify', 'after === null') + '}',
    '^nullResult:',
    '  %one = "tsfg_core.constant"() {value = 1 : i32, ' + origin('classify', 'return 1;') + '} : () -> i32',
    returned('classify', '%one', 'i32', 'return 1;'),
    '^presentResult:',
    '  %payload = "tsfg_nullable.get"(%after) {' + origin('classify', 'return after;') + '} : (!tsfg_nullable.i32<2>) -> i32',
    returned('classify', '%payload', 'i32', 'return after;'),
  ]);
  const echo = (/** @type {string} */ name, /** @type {FixtureType} */ type) =>
    define(name, [returned(name, '%value', type, 'return value;')]);
  return {core: moduleText([entry, echo('echoBoth', 'nu'), classify, echo('echoNull', 'n'), echo('echoUndefined', 'u')],
    source, path, true), source: {path, content: source, hash: sha256(source)}, functions};
}
