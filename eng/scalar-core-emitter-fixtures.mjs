// SPDX-License-Identifier: MIT
import { functionIdentity, signatureHash, scalarTypeIds, sha256 } from '../compiler/identity.mjs';
import { moduleIdentity, initializerIdentity, compilationClosure } from '../compiler/modules.mjs';
import registry from '../contracts/registry.json' with { type: 'json' };
import bytecodeSchema from '../contracts/bytecode.schema.json' with { type: 'json' };

// Representation-only fixtures: these owned records exercise public HIR validation,
// not official Source checking or execution. Position lookups describe fixed test
// strings; they are not a language parser. Root shares these exact inputs for an
// independent BASE-emitter byte comparison, without duplicating production SSA.
const type = name => ({ kind: 'scalar', name, id: scalarTypeIds[name] });
const at = (content, text, from = 0) => {
  const start = content.indexOf(text, from);
  if (start < 0) throw new Error('missing fixture token: ' + text);
  return { start, end: start + text.length };
};
const reference = (binding, name, range) => ({ kind: 'reference', binding, type: scalarTypeIds[name], range });
const constant = (decimal, range) => ({ kind: 'constant', type: scalarTypeIds.i32, decimal, token: decimal, range });
const returned = (content, value, from) => ({ kind: 'return',
  range: { start: content.indexOf('return ', from), end: value.range.end }, value });
function fn(path, name, result, parameterNames, parameters, range, body) {
  return { id: functionIdentity(path, name, result, parameterNames),
    name, signatureHash: signatureHash(result, parameterNames), returnType: type(result), parameters, range, body };
}
function program(path, content, functions) {
  return { contractVersion: registry['tsfg.hir'].semver, schemaHash: registry['tsfg.hir'].schemaHash,
    inputIdentity: sha256('scalar emitter representation fixture ' + path), source: { path, content, hash: sha256(content) },
    target: bytecodeSchema.target, functions };
}
function parameter(id, name, scalar, range) {
  return { id, name, type: scalarTypeIds[scalar], writable: true, range };
}
function branchFixture() {
  const path = '/scalar/branch.ts';
  const content = 'function pass(input: f64): f64 { return input; }\n'
    + 'function entry(flag: bool, value: f64): f64 { if (flag) { return pass(value); } else { return value; } }';
  const second = content.indexOf('function entry');
  const passRead = reference('p0', 'f64', at(content, 'input', content.indexOf('return ')));
  const pass = fn(path, 'pass', 'f64', ['f64'],
    [parameter('p0', 'input', 'f64', at(content, 'input'))],
    { start: 0, end: content.indexOf('}') + 1 }, [returned(content, passRead, 0)]);
  const conditional = content.indexOf('if (', second), thenStart = content.indexOf('{', conditional);
  const thenEnd = content.indexOf('}', thenStart) + 1;
  const elseStart = content.indexOf('{', thenEnd), elseEnd = content.indexOf('}', elseStart) + 1;
  const callRange = at(content, 'pass(value)', thenStart), argument = reference('p1', 'f64', at(content, 'value', callRange.start));
  const call = { kind: 'call', type: scalarTypeIds.f64, target: pass.id,
    signatureHash: pass.signatureHash, arguments: [argument], range: callRange };
  const alternative = reference('p1', 'f64', at(content, 'value', content.indexOf('return ', elseStart)));
  const branch = { kind: 'if', range: { start: conditional, end: elseEnd },
    condition: reference('p0', 'bool', at(content, 'flag', conditional)),
    thenBody: [{ kind: 'block', range: { start: thenStart, end: thenEnd }, body: [returned(content, call, thenStart)] }],
    elseBody: [{ kind: 'block', range: { start: elseStart, end: elseEnd }, body: [returned(content, alternative, elseStart)] }] };
  const entry = fn(path, 'entry', 'f64', ['bool', 'f64'], [
    parameter('p0', 'flag', 'bool', at(content, 'flag', second)),
    parameter('p1', 'value', 'f64', at(content, 'value', second))],
  { start: second, end: content.length }, [branch]);
  return program(path, content, [pass, entry]);
}
function loopFixture() {
  const path = '/scalar/loop.ts';
  const content = 'function loop(input: i32): i32 { let value: i32 = input; while (value < 3) { value = value + 1; } return value; }';
  const binding = at(content, 'value'), initializer = at(content, 'input', binding.end);
  const local = { kind: 'local', range: { start: binding.start, end: initializer.end },
    binding: { id: 'l0', name: 'value', type: scalarTypeIds.i32, writable: true, range: binding },
    initializer: reference('p0', 'i32', initializer) };
  const whileStart = content.indexOf('while '), conditionRead = at(content, 'value', whileStart);
  const three = at(content, '3', conditionRead.end), blockStart = content.indexOf('{', whileStart);
  const target = at(content, 'value', blockStart), left = at(content, 'value', target.end), one = at(content, '1', left.end);
  const assignment = { kind: 'assign', range: { start: target.start, end: one.end },
    target: reference('l0', 'i32', target), value: { kind: 'binary', operator: '+', type: scalarTypeIds.i32,
      range: { start: left.start, end: one.end }, left: reference('l0', 'i32', left), right: constant('1', one) } };
  const blockEnd = content.indexOf('}', blockStart) + 1;
  const loop = { kind: 'while', range: { start: whileStart, end: blockEnd },
    condition: { kind: 'binary', operator: '<', type: scalarTypeIds.bool,
      range: { start: conditionRead.start, end: three.end },
      left: reference('l0', 'i32', conditionRead), right: constant('3', three) },
    body: [{ kind: 'block', range: { start: blockStart, end: blockEnd }, body: [assignment] }] };
  const read = reference('l0', 'i32', at(content, 'value', content.indexOf('return ')));
  return program(path, content, [fn(path, 'loop', 'i32', ['i32'],
    [parameter('p0', 'input', 'i32', at(content, 'input'))], { start: 0, end: content.length },
    [local, loop, returned(content, read, blockEnd)])]);
}
function shortCircuitFixture() {
  const path = '/scalar/short.ts', content = 'function both(a: bool, b: bool): bool { return a && b; }';
  const start = content.indexOf('return '), left = at(content, 'a', start), right = at(content, 'b', left.end);
  const value = { kind: 'shortCircuit', operator: '&&', type: scalarTypeIds.bool,
    range: { start: left.start, end: right.end }, left: reference('p0', 'bool', left), right: reference('p1', 'bool', right) };
  return program(path, content, [fn(path, 'both', 'bool', ['bool', 'bool'], [
    parameter('p0', 'a', 'bool', at(content, 'a:')), parameter('p1', 'b', 'bool', at(content, 'b:'))]
    .map(p => ({ ...p, range: { start: p.range.start, end: p.range.end - 1 } })),
  { start: 0, end: content.length }, [returned(content, value, start)])]);
}
function moduleFixture() {
  const hir = { ...branchFixture(), sources: [], globals: [], hostImports: [], modules: [], closure: undefined };
  const sourcePath = hir.source.path;
  hir.functions = hir.functions.map(value => ({ ...value, sourcePath, kind: 'source' }));
  // Module HIR owns the checked call spelling in addition to its stable target;
  // the fixed source token pass(value) resolves through this module's bindings.
  hir.functions[1].body[0].thenBody[0].body[0].value.name = 'pass';
  const initializer = initializerIdentity(sourcePath, hir.source.hash);
  hir.functions.push({ id: initializer, name: '$moduleInit', sourcePath, kind: 'module-initialization',
    signatureHash: signatureHash('i32', []), returnType: type('i32'), parameters: [],
    range: { start: 0, end: hir.source.content.length }, body: [] });
  hir.sources = [hir.source]; hir.globals = []; hir.hostImports = [];
  hir.modules = [{ id: moduleIdentity(sourcePath), sourcePath, dependencies: [], initializer,
    exports: [{ name: 'entry', target: hir.functions[1].id }],
    bindings: hir.functions.filter(value => value.kind === 'source').map(value => ({ name: value.name, target: value.id })) }];
  hir.closure = compilationClosure({ modules: hir.modules, functions: hir.functions,
    configuration: { roots: [{ kind: 'application', sourcePath, name: 'entry' }], requiredRoots: [] } });
  return hir;
}
export function scalarCoreFixtures() {
  return [{ name: 'ordinary f64 calls and bool branches', hir: branchFixture() },
    { name: 'ordinary loop locals and SSA block arguments', hir: loopFixture() },
    { name: 'ordinary bool short circuit', hir: shortCircuitFixture() },
    { name: 'module closure and lifecycle initializer', hir: moduleFixture() }];
}
