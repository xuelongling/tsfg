// SPDX-License-Identifier: MIT
// Independent cold fixtures; no product projector/canonical/identity dependency.
// Basis: frozen-contract c27fceee..., manual facts64e164fc:14 owners/42 UTF16 ranges/29 units.
// Oracle JSON fields are fixed literals. IDs use published tsfg.type\0string,
// tsfg.signature\0()->string and tsfg.function\0path\0name\0signatureHex preimages.
// ASI/endpoints are manual cold examples, never actual Source/admission/Runtime evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const selectedId = 'sha256:968f1dc089d12b8826af05e413f8789db95c1495b941d9aab754daa869986009';
export const stringTypeId = 'sha256:7d62b2f4422bdcf8ffbd8d54487d799753faecc3655296bfd81d3e94b606a46e';
export const stringSignature = 'sha256:854eb80faa738dba624abb80156ef142ab727222ac63c01620c51768ad44e5c4';
export const h10 = 'sha256:09c18929e4c6acecd4eea93318c56ccddb7d66e693be311aec220e3c0fe7c073';
export const manualUnits = [
  [], [0], [55357,56832], [55357,56832], [55357,56832], [55296], [56320],
  [56832,55357], [65,55296,0,56320,90], [92,34,10,13,9,65,66],
  [55296,56320], [57344], [101,769], [233],
];
export const manualRanges = [
  [[23,67],[55,65],[62,64]], [[69,115],[101,113],[108,112]],
  [[117,163],[149,161],[156,160]], [[165,218],[197,216],[204,215]],
  [[220,276],[252,274],[259,273]], [[278,328],[310,326],[317,325]],
  [[330,380],[362,378],[369,377]], [[382,438],[414,436],[421,435]],
  [[440,500],[472,498],[479,497]], [[502,566],[534,564],[541,563]],
  [[568,624],[600,622],[607,621]], [[626,676],[658,674],[665,673]],
  [[678,729],[710,727],[717,726]], [[731,781],[763,779],[770,778]],
];

/** @param {string | Uint8Array} bytes */
export const rawHash = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {string | Uint8Array} bytes */
export const hash = bytes => 'sha256:' + rawHash(bytes);
/** @param {any} value @returns {string} */
export function canonical(value) {
  if (typeof value === 'string') assert.ok(value.isWellFormed());
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const text = JSON.stringify(value);
  assert.equal(typeof text, 'string');
  return /** @type {string} */ (text);
}
/** @param {any} value */
export const wire = value => Buffer.from(canonical(value) + '\n');
/** Trusted JSON fixture/mutant only; unsafe objects never use this clone. @param {any} value @returns {any} */
export const copy = value => JSON.parse(JSON.stringify(value));
/** @param {string} path @param {string} name */
export const functionId = (path, name) => hash('tsfg.function\0' + path + '\0' + name + '\0' + stringSignature.slice(7));

/** @type {Record<string, [number, string]>} */
const fixturePins = {
  'string-facts-lossless.frozen-v1.jcs.json': [6147,'64e164fc00016eda6052453993c0eab1de9cac0f4879de3b79fe42df4b38a468'],
  'string-hir-lossless.frozen-v1.jcs.json': [9752,'52134f47e84ef5cad2e1d624327b6b87404f4e39275762851d100c344241a6ed'],
  'string-facts-asi.frozen-v1.jcs.json': [1614,'c1f618d4d4ad077d198fb7108097d6e775a9671cc00120a99c63f1957e794fdb'],
  'string-hir-asi.frozen-v1.jcs.json': [1191,'d5ca8f106aef6d56baebe3894f7a46ad46bb1eb8164afde12cab7c57d7a46a62'],
  'string-facts-hir-boundaries.frozen-v1.jcs.json': [1765,'889d7099586def2d6b19311bd464adb898e9a1edb2cf76f966b1e408697315a0'],
  'string-hir-boundaries.frozen-v1.jcs.json': [1340,'1c47810bcafa0dd7e0dd35e55145fd351ad280170d6f58fafc8611801af1c78e'],
};
/** @param {'lossless' | 'asi' | 'boundaries'} [name] */
export function example(name = 'lossless') {
  const factsName = name === 'boundaries' ? 'string-facts-hir-boundaries.frozen-v1.jcs.json'
    : 'string-facts-' + name + '.frozen-v1.jcs.json';
  const hirName = 'string-hir-' + name + '.frozen-v1.jcs.json';
  /** @param {string} file */
  const load = file => {
    const bytes = readFileSync(new URL(file, import.meta.url));
    assert.equal(bytes.length, fixturePins[file][0]);
    assert.equal(rawHash(bytes), fixturePins[file][1]);
    return bytes;
  };
  const factsBytes = load(factsName), hirBytes = load(hirName);
  const expectedIds = { lossless: selectedId,
    asi: 'sha256:b8f07ba02dc94999b04db1372a5821ad4c6abfbd1e4a42791fbd073e7145a03b',
    boundaries: 'sha256:aefa8f43d87096fbaa38830e6819c74fde2fdac0288d78a34bcc19fd9506af65' };
  const facts = JSON.parse(factsBytes.toString('utf8')), hir = JSON.parse(hirBytes.toString('utf8'));
  const expectedPackageId = expectedIds[name];
  assert.equal(facts.packageId, expectedPackageId);
  assert.equal(hir.inputIdentity, expectedPackageId);
  return { factsBytes, hirBytes, facts, hir, expectedPackageId };
}
/** @param {Uint8Array} bytes @param {string} [expectedPackageId] */
export const context = (bytes, expectedPackageId = selectedId) => ({ factsBytes: Buffer.from(bytes), expectedPackageId });
/** Rehash private input identities only; no HIR projection or Source semantics. @param {any} facts @returns {any} */
export function sealFacts(facts) {
  const value = copy(facts), p = value.payload;
  const request = { family: 'tsfg.string-facts-request-candidate', version: 1,
    input: { sourceRoot: p.sourceRoot, rootFile: p.rootFile, config: p.config,
      declarations: p.declarations, files: p.files.map(({ path, content, sha256 }) => ({ path, content, sha256 })) } };
  value.requestId = hash('tsfg.string-facts.request.v1\0' + canonical(request) + '\n');
  value.packageId = hash('tsfg.string-facts.package.v1\0' + value.schemaHash + '\0' + canonical(p));
  return value;
}
/** @param {any} facts @param {string} source */
export function setSource(facts, source) {
  const result = copy(facts), file = result.payload.files.find(f => f.path === result.payload.rootFile);
  Object.assign(file, { content: source, byteLength: Buffer.byteLength(source), utf16Length: source.length, sha256: rawHash(source) });
  return sealFacts(result);
}
/** Hand-authored cold source/DTO grammar, not a TS parser or HIR oracle. @param {number} count */
export function manualEmptyFunctions(count) {
  const base = example().facts;
  let source = '\r\n// manual cold empty functions\r\n';
  /** @type {any[]} */ const functions = [];
  for (let i = 0; i < count; i++) {
    const name = 'e' + i, declaration = 'export function ' + name + '(): string { return ""; }\r\n';
    const start = source.length, ret = start + declaration.indexOf('return '), literal = start + declaration.indexOf('""');
    functions.push({ name, sourcePath: '/src/main.ts', parameters: [], returnType: 'string',
      declarationRange: { start, end: start + declaration.lastIndexOf('}') + 1 },
      body: [{ kind: 'return', range: { start: ret, end: literal + 3 },
        value: { kind: 'stringLiteral', type: 'string', range: { start: literal, end: literal + 2 }, codeUnits: [] } }] });
    source += declaration;
  }
  base.payload.functions = functions;
  return setSource(base, source);
}
/** @param {number} count */
export function manualRepeatedA(count) {
  const base = manualEmptyFunctions(1), literal = '"' + 'A'.repeat(count) + '"';
  const source = 'export function e0(): string { return ' + literal + '; }\n';
  const ret = source.indexOf('return '), start = source.indexOf('"'), end = start + literal.length;
  base.payload.functions[0] = { name: 'e0', sourcePath: '/src/main.ts', parameters: [], returnType: 'string',
    declarationRange: { start: 0, end: source.length - 1 }, body: [{ kind: 'return', range: { start: ret, end: end + 1 },
      value: { kind: 'stringLiteral', type: 'string', range: { start, end }, codeUnits: Array(count).fill(65) } }] };
  return setSource(base, source);
}
/** @param {any} value */
export function deeplyFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const item of Object.values(value)) deeplyFrozen(item);
}
/** @param {() => any} action @param {string | string[]} codes */
export function rejectsCode(action, codes) {
  const accepted = Array.isArray(codes) ? codes : [codes];
  assert.throws(action, error => {
    assert.ok(error instanceof Error);
    const failure = /** @type {any} */ (error);
    assert.ok(accepted.includes(failure.code), 'expected public machine code; actual=' + failure.code + ': ' + failure.message);
    return true;
  });
}
