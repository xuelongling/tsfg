// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { sha256 } from '../../compiler/identity.mjs';
import schema from '../../contracts/core-reference-candidate.schema.json' with { type: 'json' };
import { invokeCore, accepted } from './generic-core-package-capture.mjs';

let actual;
async function source() {
  if (!actual) actual = (async () => {
    const fixture = suffix => new URL('./fixtures/reference-source/local-assignment-result.' + suffix, import.meta.url);
    const [bytes, bindingText] = await Promise.all([readFile(fixture('facts.json')), readFile(fixture('binding.json'), 'utf8')]);
    assert.equal(sha256(bytes), 'sha256:f577d1cf1f157f6bf9b8ccd8ebe5d11d30ec40d4f8967ccc96adb11672919c09');
    const owned = buildReferenceHir(decodeReferenceFacts(bytes, JSON.parse(bindingText)));
    const hir = readReferenceHir(Buffer.from(printReferenceHir(owned)));
    assert.deepEqual(hir, owned);
    return { hir, core: lowerHir(hir) };
  })();
  return actual;
}
function rejected(result, cause) {
  assert.equal(result.close.code, 3, result.stderr.toString('utf8'));
  assert.equal(result.stdout.length, 0, 'over-budget Core is rejected before any output publication');
  assert.match(result.stderr.toString('utf8'), cause);
}
function padded(core, bytes) {
  const prefix = '//', suffix = '\n';
  const padding = bytes - Buffer.byteLength(core + prefix + suffix);
  assert.ok(padding > 0);
  const input = core + prefix + 'x'.repeat(padding) + suffix;
  assert.equal(Buffer.byteLength(input), bytes);
  return input;
}
test('reference Core accepts its exact UTF8 input budget and rejects one byte beyond', async () => {
  const { core } = await source();
  const baseline = await invokeCore(core); accepted(baseline);
  const exact = await invokeCore(padded(core, schema.limits.bytes)); accepted(exact);
  assert.deepEqual(exact.stdout, baseline.stdout, 'legal comments do not alter the canonical module');
  rejected(await invokeCore(padded(core, schema.limits.bytes + 1)), /core-ir-reference-budget.*input/);
});

async function expandedRoots() {
  const { hir, core } = await source();
  const owner = hir.classes.find(value => value.name === 'Derived'); assert.ok(owner);
  const method = owner.methods.find(value => value.name === 'replace'); assert.ok(method);
  const functions = [...core.matchAll(/^  func\.func ([^\n]+)\n([\s\S]*?)^  \}/gm)];
  const matches = functions.filter(value => value[1].includes('tsfg_core.logical_name = "replace"')
    && value[1].includes('tsfg_core.reference_owner = ' + JSON.stringify(owner.runtimeKey)));
  assert.equal(matches.length, 1);
  const fn = matches[0], header = fn[1];
  const parameters = [...header.matchAll(/(%[A-Za-z0-9_]+):\s*(!tsfg_core\.ref<"[^"]+">)/g)];
  assert.equal(parameters.length, 3);
  const [self, other, replacement] = parameters.map(value => value[1]);
  const derived = parameters[0][2], base = parameters[1][2];
  assert.equal(parameters[2][2], derived);
  const access = 'ref:' + derived.match(/<"([^"]+)">/)[1];
  const views = [...core.matchAll(/\{key = "[^"]+", members = \[[^\]]*\], source = "(ref:[^"]+)", target = "(ref:[^"]+)"\}/g)];
  const view = views.findIndex(value => value[1] === access && value[2] === access); assert.ok(view >= 0);
  const signature = header.match(/tsfg_core\.signature_hash = "([^"]+)"/)[1];
  const member = sha256(['tsfg.core-reference.member.v1', owner.runtimeKey, 'method', method.origin.source,
    String(method.origin.start), String(method.origin.end), method.name].join('\0'));
  const anchor = 'tsfg_source.start = ' + method.origin.start + ' : i64, tsfg_source.end = ' + method.origin.end + ' : i64';
  const body = ['    "tsfg_core.fuel"() {event = 1 : i32, ' + anchor + '} : () -> ()'];
  // Core algorithm input only: no Source/checker or execution credit. Keep each
  // alias live after every call. Raw-u64 root count stays below the old cap,
  // while the complete canonical UTF8 representation exceeds eight MiB.
  for (let i = 0; i < 1000; i++) body.push('    %padding' + i + ' = \"tsfg_core.constant\"() {value = 0 : i1, ' + anchor + '} : () -> i1');
  const baseOwner = hir.classes.find(value => value.name === 'Base'); assert.ok(baseOwner);
  const field = baseOwner.fields.find(value => value.name === 'value'); assert.ok(field);
  const fieldKey = sha256(['tsfg.core-reference.member.v1', baseOwner.runtimeKey, 'field', field.origin.source,
    String(field.origin.start), String(field.origin.end), field.name].join('\0'));
  body.push('    %fieldValue = \"tsfg_core.ref.field.read\"(' + self + ') {field = ' + JSON.stringify(fieldKey)
    + ', ' + anchor + '} : (' + derived + ') -> f64');
  for (let i = 0; i < 512; i++) body.push('    %keep' + i + ' = "tsfg_core.ref.view"(' + replacement
    + ') {view = ' + view + ' : i64, ' + anchor + '} : (' + derived + ') -> ' + derived);
  for (let i = 0; i < 2000; i++) body.push('    %call' + i + ' = "tsfg_core.ref.call"(' + self + ', ' + other + ', ' + replacement
    + ') {dispatch = "virtual", method = ' + JSON.stringify(member) + ', signature = ' + JSON.stringify(signature)
    + ', ' + anchor + '} : (' + derived + ', ' + base + ', ' + derived + ') -> ' + derived);
  for (let i = 0; i < 2000; i++) body.push('    \"tsfg_core.ref.field.write\"(' + self + ', %fieldValue) {field = '
    + JSON.stringify(fieldKey) + ', initialize = false, ' + anchor + '} : (' + derived + ', f64) -> ()');
  for (let i = 0; i < 512; i++) body.push('    %same' + i + ' = "tsfg_core.ref.identity"(%keep' + i + ', ' + replacement
    + ') {negate = false, ' + anchor + '} : (' + derived + ', ' + derived + ') -> i1');
  body.push('    "func.return"(' + replacement + ') {' + anchor + '} : (' + derived + ') -> ()');
  const input = core.replace(fn[0], '  func.func ' + header + '\n' + body.join('\n') + '\n  }');
  assert.ok(Buffer.byteLength(input) < schema.limits.bytes);
  return input;
}
for (const command of ['--canonicalize', '--optimize']) test('reference Core bounds complete canonical root output for ' + command, async () => {
  const { core } = await source(); accepted(await invokeCore(core, command));
  rejected(await invokeCore(await expandedRoots(), command), /core-ir-reference-budget.*output/);
});
