// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeCore, accepted } from './generic-core-package-capture.mjs';
import { canonical, coreCandidateSchema, nullableCoreFixture, sha256 } from './nullable-core-fixtures.mjs';

// Synthetic Core strings exercise the real CLI only. These are not Source
// goldens, a substitute checker, a carrier executor, or runtime ABI evidence.
const fixture = nullableCoreFixture();
const span = 'tsfg_source.start = 0 : i64, tsfg_source.end = 1 : i64';
const fullSpan = 'tsfg_source.start = 0 : i64, tsfg_source.end = ' + fixture.source.content.length + ' : i64';
const header = fixture.core.slice(0, fixture.core.indexOf('func.func @'));
const sum = '!tsfg_nullable.i32<3>', undef = '!tsfg_nullable.i32<1>', nil = '!tsfg_nullable.i32<2>';
const badHash = 'sha256:' + '0'.repeat(64);
const metadata = /\[core-ir-nullable-metadata\]/;
const proof = /\[core-ir-nullable-proof\]/;
const cfg = /\[core-ir-nullable-cfg\]/;
const localType = /\[core-ir-nullable-type\]/;
const localShape = /\[core-ir-nullable-operation\]/;
const invalid = /\[core-ir-invalid\]/;
const markerText = 'tsfg_core.nullable = {family = "tsfg.core-nullable-candidate", version = 1 : i32, schema = "'
  + coreCandidateSchema + '", profile = "i32-null-undefined-internal-v1"}';
const scalarTypes = [
  ['i32', 'i32'], ['bool', 'i1'], ['i8', '!tsfg_core.integer<"i8">'],
  ['i16', '!tsfg_core.integer<"i16">'], ['i64', '!tsfg_core.integer<"i64">'],
  ['u8', '!tsfg_core.integer<"u8">'], ['u16', '!tsfg_core.integer<"u16">'],
  ['u32', '!tsfg_core.integer<"u32">'], ['u64', '!tsfg_core.integer<"u64">'],
  ['isize', '!tsfg_core.integer<"isize">'], ['usize', '!tsfg_core.integer<"usize">'],
  ['f32', 'f32'], ['f64', 'f64'],
];
function changed(input, before, after) {
  assert.ok(input.includes(before), 'mutation anchor exists: ' + before);
  assert.notEqual(before, after);
  return input.replace(before, after);
}
function lineChanged(input, needle, transform) {
  const lines = input.split('\n'), matching = lines.filter(line => line.includes(needle));
  assert.equal(matching.length, 1, 'one mutation line: ' + needle);
  return changed(input, matching[0], transform(matching[0]));
}
function withoutMarker(input) {
  return changed(input, ', ' + markerText, '').replace(/, tsfg_nullable\.role = "(?:entry|internal)"/g, '');
}
const hashRecord = (domain, record) => sha256(domain + '\0' + coreCandidateSchema + '\0' + canonical(record));
function typeHash(type) {
  const scalar = scalarTypes.find(([, spelling]) => spelling === type);
  if (scalar) return hashRecord('tsfg.core-nullable-candidate.type.v1', {kind: 'scalar', name: scalar[0]});
  const membership = new Map([[undef, 1], [nil, 2], [sum, 3]]).get(type);
  assert.ok(membership, 'only explicitly authored type records are permitted');
  return hashRecord('tsfg.core-nullable-candidate.type.v1',
    {kind: 'nullable-i32', undefined: Boolean(membership & 1), null: Boolean(membership & 2)});
}
function identity(declaration) {
  const returnType = typeHash(declaration.result);
  const signatureHash = hashRecord('tsfg.core-nullable-candidate.signature.v1',
    {parameters: declaration.parameters.map(typeHash), returnType});
  const id = hashRecord('tsfg.core-nullable-candidate.function.v1',
    {name: declaration.name, signatureHash, source: {path: fixture.source.path, digest: fixture.source.hash}});
  return {returnType, signatureHash, id};
}
function operation(result, name, operands, types, resultType, extra = '') {
  return '  ' + (result ? result + ' = ' : '') + '"' + name + '"(' + operands.join(', ') + ') {'
    + (extra ? extra + ', ' : '') + span + '} : (' + types.join(', ') + ') -> ' + (resultType ?? '()');
}
const returned = (value, type) => operation('', 'func.return', [value], [type], null);
const constant = (value = '%zero') => operation(value, 'tsfg_core.constant', [], [], 'i32', 'value = 0 : i32');
const get = (value, type = sum) => operation('%payload', 'tsfg_nullable.get', [value], [type], 'i32');
const tagTest = (value, type, tag) => operation('%test', 'tsfg_nullable.tag_test', [value], [type], 'i1', 'tag = ' + tag + ' : i32');
const branch = (block, value, type) => '  cf.br ^' + block + (value ? '(' + value + ' : ' + type + ')' : '') + ' {' + span + '}';
const conditional = (condition, yes, no) => '  cf.cond_br ' + condition + ', ^' + yes + ', ^' + no + ' {' + span + '}';
const loopFuel = '  "tsfg_core.fuel"() {event = 2 : i32, ' + span + '} : () -> ()';
function call(value, target, operand) {
  const info = identity(target);
  return operation(value, 'func.call', [operand], target.parameters, target.result,
    'callee = @' + target.name + ', tsfg_core.function_id = "' + info.id
      + '", tsfg_core.signature_hash = "' + info.signatureHash + '"');
}
// A small text emitter, not a verifier: each body below is handwritten. Hashes
// use descriptor records, independent of C++ production verification.
function program(declarations) {
  return header + declarations.map(declaration => {
    const info = identity(declaration), parameters = declaration.parameters.map((type, i) => '%arg' + i + ': ' + type);
    return 'func.func @' + declaration.name + '(' + parameters.join(', ') + ') -> ' + declaration.result
      + ' attributes {tsfg_core.function_id = "' + info.id + '", tsfg_core.signature_hash = "' + info.signatureHash
      + '", tsfg_core.type_id = "' + info.returnType + '", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = '
      + fixture.source.content.length + ' : i64, tsfg_nullable.role = "' + declaration.role + '"} {\n'
      + '  "tsfg_core.fuel"() {event = 1 : i32, ' + fullSpan + '} : () -> ()\n'
      + declaration.body.join('\n') + '\n}';
  }).join('\n') + '\n}\n';
}
const entry = (type = 'i32', name = 'boundary') =>
  ({name, parameters: [type], result: type, role: 'entry', body: [returned('%arg0', type)]});
const internal = (body, parameters = [sum], result = 'i32', name = 'inspect') =>
  ({name, parameters, result, role: 'internal', body});
const withInternal = declaration => program([entry(), declaration]);
async function reject(input, diagnostic, detail) {
  const result = await invokeCore(input);
  assert.deepEqual(result.exit, {code: 3, signal: null});
  assert.deepEqual(result.close, {code: 3, signal: null});
  assert.equal(result.stdout.length, 0, 'failure publishes no partial canonical output');
  const stderr = result.stderr.toString('utf8');
  assert.ok(result.stderr.length > 0 && result.stderr.length < 65536, 'bounded complete raw stderr');
  assert.ok(stderr.endsWith('\n'), 'raw diagnostic ends at a complete line');
  assert.ok(!stderr.includes('\ufffd') && !stderr.includes('\0'), 'diagnostic bytes decode without truncation');
  assert.match(stderr, diagnostic);
  if (detail) assert.match(stderr, detail);
}

test('nullable boundary accepts all 13 scalar entry signatures and declared caps', async t => {
  for (const [name, type] of scalarTypes) await t.test(name + ' entry passthrough', async () => {
    const declaration = entry(type), info = identity(declaration);
    const result = await invokeCore(program([declaration]));
    accepted(result);
    const printed = result.stdout.toString('utf8');
    for (const value of [info.id, info.signatureHash, info.returnType]) assert.ok(printed.includes(value));
    assert.ok(printed.includes('tsfg_nullable.role = "entry"'));
  });
  await t.test('64 parameters and 256 UTF8 name bytes are accepted', async () => {
    const declaration = {...entry('i32', 'b'.repeat(256)), parameters: Array(64).fill('i32')};
    accepted(await invokeCore(program([declaration])));
  });
});

test('nullable boundary rejects marker, role and hidden-type violations', async t => {
  const hiddenSignature = withoutMarker(withInternal(internal([constant(), returned('%zero', 'i32')], [nil])));
  const hiddenAttribute = lineChanged(withoutMarker(program([entry()])), '"tsfg_core.fuel"',
    line => changed(line, '{event =', '{hidden = !tsfg_nullable.i32<1>, event ='));
  const unused = withoutMarker(program([{...entry(), body: [
    operation('%unused', 'tsfg_nullable.wrap_i32', ['%arg0'], ['i32'], sum), returned('%arg0', 'i32'),
  ]}]));
  const cases = [
    ['missing marker', changed(fixture.core, ', ' + markerText, ''), /\[core-ir-nullable-marker\]/],
    ['wrong marker family', changed(fixture.core, 'family = "tsfg.core-nullable-candidate"', 'family = "wrong"'), metadata],
    ['extra marker member', changed(fixture.core, 'version = 1 : i32, schema =', 'extra = true, version = 1 : i32, schema ='), metadata],
    ['wrong marker version type', changed(fixture.core, 'version = 1 : i32, schema =', 'version = 1 : i64, schema ='), metadata],
    ['wrong marker schema', changed(fixture.core, 'schema = "' + coreCandidateSchema, 'schema = "' + badHash), metadata],
    ['missing role', changed(fixture.core, ', tsfg_nullable.role = "entry"', ''), metadata],
    ['unknown role', changed(fixture.core, 'tsfg_nullable.role = "entry"', 'tsfg_nullable.role = "public"'), metadata],
    ['no entry', changed(fixture.core, 'tsfg_nullable.role = "entry"', 'tsfg_nullable.role = "internal"'), metadata],
    ['two entries', program([entry(), entry('i32', 'second')]), metadata],
    ['hidden nullable signature and unused argument', hiddenSignature, /\[core-ir-nullable-marker\]/],
    ['hidden nullable TypeAttr', hiddenAttribute, /\[core-ir-nullable-marker\]/],
    ['unused nullable result', unused, /\[core-ir-nullable-marker\]/],
    ['reference marker mixed in', changed(fixture.core, 'module attributes {', 'module attributes {tsfg_core.reference = {}, '), metadata],
    ['module table mixed in', changed(fixture.core, 'module attributes {', 'module attributes {tsfg_core.modules = [], '), metadata],
  ];
  for (const [name, input, diagnostic] of cases) await t.test(name, () => reject(input, diagnostic));
});

test('nullable boundary rejects ABI, identity, tag and exact-type violations', async t => {
  const info = fixture.functions.find(item => item.name === 'entry');
  const replaceEntryHash = (attribute, value) => changed(fixture.core, attribute + ' = "' + value + '"',
    attribute + ' = "' + badHash + '"');
  const sumEntry = program([{...entry(sum), result: 'i32', body: [constant(), returned('%zero', 'i32')]}]);
  const zeroArgumentSum = program([{...entry(), parameters: [], result: nil, body: [
    operation('%nil', 'tsfg_nullable.absence', [], [], nil, 'tag = 2 : i32'), returned('%nil', nil),
  ]}]);
  const badMaskId = withInternal(internal([returned('%arg0', undef)], [undef], undef, 'echo'));
  const echoId = identity(internal([], [undef], undef, 'echo'));
  const cases = [
    ['nullable entry parameter', sumEntry, metadata],
    ['zero argument nullable entry return', zeroArgumentSum, metadata],
    ['return type identity', replaceEntryHash('tsfg_core.type_id', info.returnType), metadata],
    ['signature identity', replaceEntryHash('tsfg_core.signature_hash', info.signatureHash), metadata],
    ['function identity', replaceEntryHash('tsfg_core.function_id', info.id), metadata],
    ['mask identity is not physical carrier identity', changed(badMaskId, 'tsfg_core.type_id = "' + echoId.returnType + '"',
      'tsfg_core.type_id = "' + typeHash(nil) + '"'), metadata],
    ['call function identity', lineChanged(fixture.core, '%echoed = "func.call"',
      line => line.replace(/tsfg_core.function_id = "sha256:[a-f0-9]{64}"/, 'tsfg_core.function_id = "' + badHash + '"')), metadata],
    ['call signature identity', lineChanged(fixture.core, '%echoed = "func.call"',
      line => line.replace(/tsfg_core.signature_hash = "sha256:[a-f0-9]{64}"/, 'tsfg_core.signature_hash = "' + badHash + '"')), metadata],
    ['unknown type mask', changed(fixture.core, '!tsfg_nullable.i32<2>', '!tsfg_nullable.i32<4>'), invalid, /\[core-ir-nullable-type\]/],
    ['unknown absence tag', changed(fixture.core, 'tag = 2 : i32', 'tag = 3 : i32'), localType],
    ['present is not an absence', changed(fixture.core, 'tag = 2 : i32', 'tag = 0 : i32'), localType],
    ['absence tag outside declared mask', withInternal(internal([
      operation('%absent', 'tsfg_nullable.absence', [], [], undef, 'tag = 2 : i32'), returned('%absent', undef),
    ], [], undef)), localType],
    ['unknown nullable attribute', lineChanged(fixture.core, '%null = "tsfg_nullable.absence"',
      line => changed(line, '{tag =', '{invented = true, tag =')), localShape],
    ['sum cannot use scalar eq', withInternal(internal([
      operation('%equal', 'tsfg_core.eq', ['%arg0', '%arg0'], [sum, sum], 'i1'), returned('%equal', 'i1'),
    ], [sum], 'i1')), /\[core-ir-type\]/],
    ['unknown operation', changed(fixture.core, '"tsfg_nullable.wrap_i32"', '"tsfg_nullable.invented"'), invalid, /unregistered|unknown|not.*registered/i],
    ['return needs exact mask', withInternal(internal([returned('%arg0', nil)], [nil], sum)), invalid, /type/i],
    ['edge needs exact mask', withInternal(internal([
      branch('join', '%arg0', nil), '^join(%phi: ' + sum + '):', returned('%phi', sum),
    ], [nil], sum)), invalid, /type/i],
    ['call needs explicit narrowing', lineChanged(fixture.core, '%after = "func.call"',
      line => changed(changed(line, '(%narrowed)', '(%value)'), ': (' + nil + ') ->', ': (' + sum + ') ->')), invalid, /type/i],
  ];
  for (const [name, input, diagnostic, detail] of cases) await t.test(name, () => reject(input, diagnostic, detail));
});

test('nullable boundary requires nonempty SSA proofs through calls, phi and loops', async t => {
  const echo = internal([returned('%arg0', sum)], [sum], sum, 'echo');
  const callReset = program([entry(), echo, internal([
    tagTest('%arg0', sum, 0), conditional('%test', 'present', 'absent'), '^present:',
    call('%fresh', echo, '%arg0'), get('%fresh'), returned('%payload', 'i32'),
    '^absent:', constant(), returned('%zero', 'i32'),
  ])]);
  const phi = withInternal(internal([
    conditional('%arg1', 'present', 'absent'), '^present:', constant(),
    operation('%wrapped', 'tsfg_nullable.wrap_i32', ['%zero'], ['i32'], sum), branch('join', '%wrapped', sum),
    '^absent:', operation('%null', 'tsfg_nullable.absence', [], [], sum, 'tag = 2 : i32'),
    branch('join', '%null', sum), '^join(%phi: ' + sum + '):', get('%phi'), returned('%payload', 'i32'),
  ], [sum, 'i1']));
  const loop = withInternal(internal([
    constant(), operation('%initial', 'tsfg_nullable.wrap_i32', ['%zero'], ['i32'], sum),
    branch('loop', '%initial', sum), '^loop(%phi: ' + sum + '):', loopFuel, get('%phi'),
    conditional('%arg1', 'back', 'done'), '^back:',
    operation('%replacement', 'tsfg_nullable.absence', [], [], sum, 'tag = 2 : i32'),
    branch('loop', '%replacement', sum), '^done:', returned('%payload', 'i32'),
  ], [sum, 'i1']));
  const empty = withInternal(internal([
    tagTest('%arg0', nil, 1), conditional('%test', 'impossible', 'possible'),
    '^impossible:', get('%arg0', nil), returned('%payload', 'i32'),
    '^possible:', constant(), returned('%zero', 'i32'),
  ], [nil]));
  /** @type {[string, string, RegExp][]} */
  const cases = [
    ['unproved payload', withInternal(internal([get('%arg0'), returned('%payload', 'i32')])), proof],
    ['empty edge is not payload proof', empty, proof],
    ['unproved narrowing', withInternal(internal([
      operation('%narrow', 'tsfg_nullable.retype', ['%arg0'], [sum], nil), returned('%narrow', nil),
    ], [sum], nil)), proof],
    ['fake safe attribute cannot grant proof', withInternal(internal([
      operation('%payload', 'tsfg_nullable.get', ['%arg0'], [sum], 'i32', 'safe = true'), returned('%payload', 'i32'),
    ])), localShape],
    ['call resets present argument to full declaration', callReset, proof],
    ['one bad phi predecessor prevents extraction', phi, proof],
    ['loop backedge cannot retain first-iteration payload proof', loop, proof],
  ];
  for (const [name, input, diagnostic] of cases) await t.test(name, () => reject(input, diagnostic));
});

test('nullable boundary enforces fuel, reachability and small preallocation caps', async t => {
  const noFuel = program([entry()]).split('\n').filter(line => !line.includes('"tsfg_core.fuel"')).join('\n');
  const bypass = withInternal(internal([
    branch('header'), '^header:', loopFuel, branch('spin'), '^spin:',
    conditional('%arg1', 'spin', 'done'), '^done:', returned('%arg0', 'i32'),
  ], ['i32', 'i1']));
  const dead = program([{...entry(), body: [
    returned('%arg0', 'i32'), '^dead:', constant(), returned('%zero', 'i32'),
  ]}]);
  const cases = [
    ['missing entry fuel', noFuel, cfg],
    ['cycle bypasses loop-fuel block', bypass, cfg],
    ['structurally dead block', dead, cfg],
    ['65 parameters rejected before flow allocation', program([{...entry(), parameters: Array(65).fill('i32')}]), metadata],
    ['257 UTF8 name bytes', program([entry('i32', 'b'.repeat(257))]), metadata],
    ['noncanonical logical path', changed(fixture.core, 'tsfg_core.source_path = "/core/nullable-candidate.ts"',
      'tsfg_core.source_path = "/core/../nullable-candidate.ts"'), metadata],
    ['malformed source digest', changed(fixture.core, 'tsfg_core.source_hash = "' + fixture.source.hash + '"',
      'tsfg_core.source_hash = "' + badHash.slice(0, -1) + '"'), metadata],
    ['operation anchor past owner', lineChanged(fixture.core, '%null = "tsfg_nullable.absence"',
      line => line.replace(/tsfg_source.end = \d+ : i64/, 'tsfg_source.end = 4294967295 : i64')), metadata],
  ];
  for (const [name, input, diagnostic] of cases) await t.test(name, () => reject(input, diagnostic));
});
