// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';

/** @typedef {{block:number,instruction:number,registers:number[]}} RootRecord */
const sources = new Map(), algorithms = new Map();
const fixture = name => new URL('./fixtures/reference-source/' + name, import.meta.url);
const identities = {
  'multiple-sources': 'sha256:b49b569266659fb9aed15dfacf677687dd4e3b57bc1b0405b2e8dcc10604ae32',
  'local-assignment-result': 'sha256:f577d1cf1f157f6bf9b8ccd8ebe5d11d30ec40d4f8967ccc96adb11672919c09',
};
async function loadSource(name) {
  const [bytes, bindingText] = await Promise.all([
    readFile(fixture(name + '.facts.json')), readFile(fixture(name + '.binding.json'), 'utf8'),
  ]);
  assert.equal(sha256(bytes), identities[name]);
  const binding = JSON.parse(bindingText);
  /** @type {[string,string][]} */
  const originals = name === 'multiple-sources'
    ? [['/original/a-main.ts', 'a-main.source.ts'], ['/original/z-base.ts', 'z-base.source.ts']]
    : [['/original/main.ts', 'source.ts']];
  for (const [path, suffix] of originals) {
    const content = await readFile(fixture(name + '.' + suffix), 'utf8');
    const source = binding.sources.find(value => value.path === path);
    assert.ok(source); assert.equal(source.declaration, false);
    assert.equal(sha256(content), source.sha256); assert.equal(content.length, source.utf16Length);
    assert.deepEqual(source.surrogateStarts, [3]);
  }
  const owned = buildReferenceHir(decodeReferenceFacts(bytes, binding));
  const persisted = Buffer.from(printReferenceHir(owned)), hir = readReferenceHir(persisted); persisted.fill(0);
  assert.deepEqual(hir, owned); assert.equal(hir.format.version, 4);
  assert.equal(hir.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v4');
  for (const owner of hir.classes) assert.equal(owner.constructor.access, 'public');
  const core = lowerHir(hir);
  assert.equal(core, lowerHir(readReferenceHir(Buffer.from(printReferenceHir(hir)))));
  return { hir, core };
}
function source(name) {
  if (!sources.has(name)) sources.set(name, loadSource(name));
  return sources.get(name);
}
async function compiled(core) {
  const first = await invokeCore(core); accepted(first);
  const second = await invokeCore(first.stdout); accepted(second);
  const optimized = await invokeCore(first.stdout, '--optimize'); accepted(optimized);
  assert.deepEqual(second.stdout, first.stdout, 'canonical reloading is byte stable');
  assert.deepEqual(optimized.stdout, first.stdout, 'identity optimization recomputes and validates the same root map');
  return first.stdout.toString('utf8');
}
function rejected(result, cause) {
  assert.equal(result.close.code, 3, result.stderr.toString('utf8'));
  assert.equal(result.stdout.length, 0, 'a rejected consumer emits no Core or packet');
  assert.match(result.stderr.toString('utf8'), cause);
}
function changeOperation(core, name, callback) {
  const lines = core.split('\n'), at = lines.findIndex(line => line.includes(JSON.stringify(name) + '('));
  assert.ok(at >= 0, 'actual Core contains ' + name);
  const changed = callback(lines[at]); assert.notEqual(changed, lines[at]);
  lines[at] = changed; return lines.join('\n');
}
// Mutate only a declared public metadata attribute, retaining the actual body
// and all producer facts. These are malformed Core inputs, not Source graphs.
function changeMetadata(core, before, after) {
  const end = core.indexOf('\n'), header = core.slice(0, end);
  assert.ok(end > 0 && header.startsWith('module '));
  assert.ok(header.includes(before), 'actual metadata contains the field being mutated');
  const changed = header.replace(before, after); assert.notEqual(changed, header);
  return changed + core.slice(end);
}
function ownedFunction(core, owner, name) {
  const matches = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)]
    .filter(match => match[1].includes('tsfg_core.logical_name = ' + JSON.stringify(name))
      && match[1].includes('tsfg_core.reference_owner = ' + JSON.stringify(owner)));
  assert.equal(matches.length, 1);
  const match = matches[0];
  return { whole: match[0], header: match[1], body: match[2] };
}
function replaceBody(core, fn, body) {
  const replacement = '  func.func ' + fn.header + '\n' + body + '\n  }';
  assert.ok(core.includes(fn.whole)); return core.replace(fn.whole, replacement);
}

// This reader only deserializes the public canonical root attribute. Expected
// liveness below is hand worked; no production helper or liveness algorithm is copied.
function rootField(canonical, owner) {
  const lines = canonical.split('\n').filter(line => line.startsWith('  }) {')
    && line.includes('tsfg_core.logical_name = "replace"')
    && line.includes('tsfg_core.reference_owner = ' + JSON.stringify(owner)));
  assert.equal(lines.length, 1);
  const line = lines[0], key = 'tsfg_core.reference_roots = ', at = line.indexOf(key);
  assert.ok(at >= 0);
  const start = at + key.length; assert.equal(line[start], '[');
  let depth = 0, end = -1;
  for (let i = start; i < line.length; i++) {
    if (line[i] === '[') depth++;
    if (line[i] === ']' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > start);
  return { line, start, end, text: line.slice(start, end) };
}
function readRoots(canonical, owner) {
  const { text } = rootField(canonical, owner);
  const pattern = /\{block = (\d+) : i64, instruction = (\d+) : i64, registers = \[([^\]]*)\]\}/g;
  const matches = [...text.matchAll(pattern)];
  assert.equal(text.slice(1, -1).replace(pattern, '').replace(/[,\s]/g, ''), '', 'root records use their exact public shape');
  return matches.map(match => ({ block: Number(match[1]), instruction: Number(match[2]),
    registers: match[3].trim() === '' ? [] : match[3].split(',').map(token => {
      const number = token.trim().match(/^(\d+)(?:\s*:\s*i64)?$/); assert.ok(number); return Number(number[1]);
    }) }));
}
/** @param {RootRecord[]} roots */
function rootText(roots) {
  return '[' + roots.map(root => '{block = ' + root.block + ' : i64, instruction = ' + root.instruction
    + ' : i64, registers = [' + root.registers.map(value => value + ' : i64').join(', ') + ']}').join(', ') + ']';
}
function changeCanonicalRoots(canonical, owner, roots) {
  const field = rootField(canonical, owner);
  return canonical.replace(field.line, field.line.slice(0, field.start) + rootText(roots) + field.line.slice(field.end));
}
function supplyRoots(core, fn, roots) {
  assert.doesNotMatch(fn.header, /tsfg_core\.reference_roots/);
  const header = fn.header.replace('attributes {', 'attributes {tsfg_core.reference_roots = ' + rootText(roots) + ', ');
  return core.replace(fn.whole, '  func.func ' + header + '\n' + fn.body + '\n  }');
}

async function buildAlgorithm(kind) {
  const actual = await source('local-assignment-result');
  const owner = actual.hir.classes.find(value => value.name === 'Derived'); assert.ok(owner);
  const method = owner.methods.find(value => value.name === 'replace'); assert.ok(method);
  const fn = ownedFunction(actual.core, owner.runtimeKey, 'replace');
  const parameters = [...fn.header.matchAll(/(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">)/g)];
  assert.equal(parameters.length, 3);
  const [self, other, replacement] = parameters.map(value => value[1]);
  const derived = parameters[0][2], base = parameters[1][2]; assert.equal(parameters[2][2], derived);
  const access = 'ref:' + derived.match(/<"([^"]+)">/)[1];
  const viewRecords = [...actual.core.matchAll(/\{key = "[^"]+", members = \[[^\]]*\], source = "(ref:[^"]+)", target = "(ref:[^"]+)"\}/g)];
  const view = viewRecords.findIndex(value => value[1] === access && value[2] === access); assert.ok(view >= 0);
  const signature = fn.header.match(/tsfg_core\.signature_hash = "([^"]+)"/)[1];
  const member = sha256(['tsfg.core-reference.member.v1', owner.runtimeKey, 'method', method.origin.source,
    String(method.origin.start), String(method.origin.end), method.name].join('\0'));
  const anchor = 'tsfg_source.start = ' + method.origin.start + ' : i64, tsfg_source.end = ' + method.origin.end + ' : i64';
  const fuel = event => '    "tsfg_core.fuel"() {event = ' + event + ' : i32, ' + anchor + '} : () -> ()';
  const call = (result, argument) => '    ' + result + ' = "tsfg_core.ref.call"(' + self + ', ' + other + ', ' + argument
    + ') {dispatch = "virtual", method = ' + JSON.stringify(member) + ', signature = ' + JSON.stringify(signature) + ', '
    + anchor + '} : (' + derived + ', ' + base + ', ' + derived + ') -> ' + derived;
  const identity = (result, left, right) => '    ' + result + ' = "tsfg_core.ref.identity"(' + left + ', ' + right
    + ') {negate = false, ' + anchor + '} : (' + derived + ', ' + derived + ') -> i1';
  const returned = value => '    "func.return"(' + value + ') {' + anchor + '} : (' + derived + ') -> ()';
  let body, callBefore, callAfter, expected;
  // Core-only: retain actual metadata/signature and replace only this body.
  // These diamonds/backedges were never official Source/checker facts or executed.
  if (kind === 'diamond') {
    body = [fuel(1), '    %condition = "tsfg_core.constant"() {value = 1 : i1, ' + anchor + '} : () -> i1',
      '    cf.cond_br %condition, ^left(' + replacement + ' : ' + derived + '), ^right(' + replacement + ' : ' + derived + ') {' + anchor + '}',
      '  ^left(%leftArg: ' + derived + '):', call('%leftResult', '%leftArg'),
      '    cf.br ^join(%leftResult : ' + derived + ') {' + anchor + '}',
      '  ^right(%rightArg: ' + derived + '):',
      '    %alias = "tsfg_core.ref.view"(%rightArg) {view = ' + view + ' : i64, ' + anchor + '} : (' + derived + ') -> ' + derived,
      call('%rightResult', '%rightArg'), identity('%same', '%rightArg', '%alias'),
      '    cf.cond_br %same, ^join(%rightResult : ' + derived + '), ^join(%alias : ' + derived + ') {' + anchor + '}',
      '  ^join(%out: ' + derived + '):', returned('%out')].join('\n');
    // Registers: entry 0,1,2; condition3; leftArg4/result5;
    // rightArg6/alias7/result8/same9; join out10. Both right aliases live after call.
    expected = [{ block: 1, instruction: 0, registers: [0,1,4] }, { block: 2, instruction: 1, registers: [0,1,6,7] }];
  } else {
    callBefore = call('%result', '%loopArg'); callAfter = call('%result', replacement);
    body = [fuel(1), '    cf.br ^loop(' + replacement + ', ' + other + ' : ' + derived + ', ' + base + ') {' + anchor + '}',
      '  ^loop(%loopArg: ' + derived + ', %dead: ' + base + '):', fuel(2), callBefore,
      identity('%condition', '%result', '%result'),
      '    cf.cond_br %condition, ^loop(%result, %dead : ' + derived + ', ' + base + '), ^exit(%result, %dead : '
        + derived + ', ' + base + ') {' + anchor + '}',
      '  ^exit(%out: ' + derived + ', %neverUsed: ' + base + '):', returned('%out')].join('\n');
    // Registers: entry 0,1,2; loopArg3/dead4/result5/condition6; out7/neverUsed8.
    // dead only forwards to unused phi slots. Current result and scalar are absent.
    expected = [{ block: 1, instruction: 1, registers: [0,1,3] }];
  }
  const core = replaceBody(actual.core, fn, body), changedFunction = ownedFunction(core, owner.runtimeKey, 'replace');
  const canonical = await compiled(core);
  assert.deepEqual(readRoots(canonical, owner.runtimeKey), expected);
  return { core, fn: changedFunction, owner: owner.runtimeKey, expected, canonical, callBefore, callAfter };
}
function algorithm(kind) {
  if (!algorithms.has(kind)) algorithms.set(kind, buildAlgorithm(kind));
  return algorithms.get(kind);
}

test('actual cold reference fixtures use real C++ canonical roots and reject wire9 encoding', async () => {
  for (const name of ['multiple-sources', 'local-assignment-result']) {
    const actual = await source(name), canonical = await compiled(actual.core);
    assert.ok(actual.core.includes('profile = "tsfg-owned-class-facts-candidate-v4"'));
    assert.ok(actual.core.includes('version = 4 : i64'));
    assert.ok(actual.core.includes('schema = "sha256:efd525313efdb99543e402a05f6d6fce4d5867cacde0ae2584260d4cd1dcac29"'));
    assert.equal([...actual.core.matchAll(/constructor = \{access = "public", /g)].length, actual.hir.classes.length);
    for (const item of actual.hir.sources) {
      assert.ok(canonical.includes(JSON.stringify(item.path))); assert.ok(canonical.includes(JSON.stringify(item.sha256)));
    }
    for (const owner of actual.hir.classes) assert.ok(canonical.includes(JSON.stringify(owner.runtimeKey)));
    assert.equal([...canonical.matchAll(/"func\.func"\(/g)].length, name === 'multiple-sources' ? 6 : 3);
    assert.match(canonical, /tsfg_core\.reference_roots = \[/);
    rejected(await invokeCore(canonical, '--emit-bytecode'), /\[r04-core-reference-unsupported\]/);
  }
});

test('private Core v4 requires explicit public constructor access and exact version profile and schema', async () => {
  const { core } = await source('multiple-sources');
  const constructor = 'constructor = {access = "public", ';
  /** @type {[string,RegExp][]} */
  const cases = [
    [changeMetadata(core, constructor, 'constructor = {'),
      /\[core-ir-reference-metadata\] constructor descriptor fields differ/],
    ...['', 'private', 'protected'].map(access => /** @type {[string,RegExp]} */ ([
      changeMetadata(core, constructor, 'constructor = {access = ' + JSON.stringify(access) + ', '),
      /\[core-ir-reference-metadata\] constructor access must be public/,
    ])),
    [changeMetadata(core, 'version = 4 : i64', 'version = 2 : i64'),
      /\[core-ir-reference-metadata\] candidate version differs/],
    [changeMetadata(core, 'profile = "tsfg-owned-class-facts-candidate-v4"', 'profile = "tsfg-owned-class-facts-candidate-v3"'),
      /\[core-ir-reference-metadata\] candidate profile differs/],
    [changeMetadata(core, 'schema = "sha256:efd525313efdb99543e402a05f6d6fce4d5867cacde0ae2584260d4cd1dcac29"',
      'schema = "sha256:' + '0'.repeat(64) + '"'),
      /\[core-ir-reference-metadata\] candidate schema differs/],
  ];
  for (const [input, cause] of cases) rejected(await invokeCore(input), cause);
});

test('real reference Core rejects invalid field view callee SSA and source operands at their actual boundaries', async () => {
  const { core } = await source('multiple-sources'), invalidHash = 'sha256:' + '0'.repeat(64);
  /** @type {[string,RegExp][]} */
  const cases = [
    [changeOperation(core, 'tsfg_core.ref.field.write', line => line.replace(/field = "[^"]+"/, 'field = ' + JSON.stringify(invalidHash))),
      /\[core-ir-reference-invalid\] field is outside the accessible receiver view/],
    [changeOperation(core, 'tsfg_core.ref.view', line => line.replace(/view = \d+ : i64/, 'view = 999999 : i64')),
      /\[core-ir-reference-invalid\] view identity or operand\/result differs/],
    [changeOperation(core, 'func.call', line => line.replace(/tsfg_core\.function_id = "[^"]+"/, 'tsfg_core.function_id = ' + JSON.stringify(invalidHash))),
      /\[core-ir-reference-invalid\] direct call identity or arity differs/],
    [changeOperation(core, 'tsfg_core.ref.field.write', line => line.replace(/(\([^,]+,\s*)%[A-Za-z0-9_]+\)/, '$1%missing)')),
      /\[core-ir-invalid\] parse or verification failed/],
    [changeOperation(core, 'tsfg_core.ref.field.write', line => line.replace(/tsfg_source\.start = \d+ : i64/, 'tsfg_source.start = 0 : i64')),
      /\[core-ir-reference-cfg\] source anchor or region differs/],
  ];
  // MLIR parser details are not exposed by the current main; SSA rejection is
  // asserted at that actual generic parse boundary, not as a specific type RED.
  for (const [input, cause] of cases) rejected(await invokeCore(input), cause);
});

test('Core-only diamond and loop recompute exact live-before reference roots across typed phi edges', async () => {
  const diamond = await algorithm('diamond'), loop = await algorithm('loop');
  assert.deepEqual(readRoots(diamond.canonical, diamond.owner), [
    { block: 1, instruction: 0, registers: [0,1,4] }, { block: 2, instruction: 1, registers: [0,1,6,7] },
  ]);
  assert.deepEqual(readRoots(loop.canonical, loop.owner), [{ block: 1, instruction: 1, registers: [0,1,3] }]);
});

test('canonical supplied roots reject missing extra nonreference wrong-position and stale CFG maps', async () => {
  const loop = await algorithm('loop');
  const invalid = [
    [{ block: 1, instruction: 1, registers: [0,3] }],
    [{ block: 1, instruction: 1, registers: [0,1,2,3] }],
    [{ block: 1, instruction: 1, registers: [0,1,3,6] }],
    [{ block: 1, instruction: 2, registers: [0,1,3] }],
  ];
  for (const roots of invalid) rejected(await invokeCore(changeCanonicalRoots(loop.canonical, loop.owner, roots)),
    /\[core-ir-reference-roots\] supplied root map differs from complete CFG recomputation/);
  // Reuse the actually generated canonical map, then change only a typed call
  // operand in the public pre-canonical body. Correct roots become [0,1,2].
  const oldMap = readRoots(loop.canonical, loop.owner);
  const supplied = supplyRoots(loop.core, loop.fn, oldMap);
  const stale = supplied.replace(loop.callBefore, loop.callAfter); assert.notEqual(stale, supplied);
  rejected(await invokeCore(stale), /\[core-ir-reference-roots\] supplied root map differs from complete CFG recomputation/);
});
