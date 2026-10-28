// SPDX-License-Identifier: MIT
import { check, record, array, text, range, same, wireLimits } from './exception-common.mjs';
import { exceptionScalar, exceptionAnnotation } from './exception-types.mjs';
import { exceptionScope } from './exception-scope.mjs';
import { exceptionIdentifierName } from './exception-identifiers.mjs';

// Aggregate IDs resolve only through this snapshot's complete nominal registry.
// The ordinary statement/expression verifier still owns every executable body.
export function createExceptionAggregateRegistry(prepared, facts, definitions, grammar) {
  if (!prepared.aggregateInput) {
    check(!Object.hasOwn(facts, 'aggregateFacts'), 'schema', 'aggregate facts require actual marker input'); return null;
  }
  record(facts.aggregateFacts, ['profile','declarations','sourceCoverage']);
  check(facts.aggregateFacts.profile === 'minimal-aggregates-v1', 'input');
  const declarations = array(facts.aggregateFacts.declarations, wireLimits.functions, 1);
  array(facts.aggregateFacts.sourceCoverage);
  const state = { prepared, facts: facts.aggregateFacts, definitions, grammar, declarations,
    byType: new Map(), byName: new Map(), fields: new Map(), constructors: new Map(), prefixIds: [], seen: new Set(), coverage: [] };
  const source = prepared.sources[0];
  for (const [ordinal, decl] of declarations.entries()) {
    record(decl, ['id','name','symbol','category','nominalKey','markerOrigin','instanceType','constructorType','fields','constructors','memberCoverage','range','bodyRange','noInheritance']);
    text(decl.name); check(decl.id === 'a' + (ordinal + 1) && !state.byName.has(decl.name), 'identity');
    const marker = prepared.aggregateInput.markers.get(decl.category);
    check(marker && decl.instanceType === decl.id && decl.constructorType === 'constructor:' + decl.id && decl.noInheritance === true, 'type');
    check(same(decl.nominalKey, { sourcePath: source.path, declarationPath: [decl.name], category: decl.category }), 'identity');
    record(decl.markerOrigin, [...Object.keys(marker.origin), 'range']);
    check(same(decl.markerOrigin, { ...marker.origin, range: decl.markerOrigin.range }), 'identity', 'marker origin differs from actual pinned declaration');
    range(decl.range, grammar.root, source.content); range(decl.bodyRange, decl.range, source.content);
    range(decl.markerOrigin.range, decl.range, source.content);
    const symbol = definitions.get(decl.symbol);
    check(symbol && same(symbol, { id: decl.symbol, name: decl.name, kind: 'class', type: decl.id, writable: false, range: symbol.range }), 'symbol');
    array(decl.fields); array(decl.memberCoverage);
    const ctors = array(decl.constructors, 1, 1), ctor = ctors[0];
    check(ctor?.kind === 'implicitDefault', 'capability', 'explicit aggregate constructors require a separate cold tracer');
    check(same(ctor, { id: 'c' + (ordinal + 1), kind: 'implicitDefault', classRef: decl.id,
      signatureDeclaration: null, implementation: null, parameters: [], signature: { parameters: [], returnType: decl.id },
      resultType: decl.id, body: [], parameterInitializers: [], range: decl.range, bodyRange: null }), 'signature', 'implicit constructor must retain its complete original DTO');
    state.byType.set(decl.id, decl); state.byName.set(decl.name, decl); state.constructors.set(ctor.id, { decl, ctor });
    state.prefixIds.push(decl.symbol);
  }
  for (const decl of declarations) for (const [ordinal, field] of decl.fields.entries()) {
    record(field, ['id','ordinal','name','symbol','type','readonly','access','optionalSyntax','definiteAssertionSyntax','initializer','range']);
    text(field.name); check(field.name !== 'constructor', 'source', 'class cannot declare a field named constructor');
    check(field.initializer !== null || field.definiteAssertionSyntax, 'type', 'implicit constructor leaves a required field uninitialized');
    check(!field.definiteAssertionSyntax || field.initializer === null, 'source', 'initialized class fields must omit definite assignment assertions');
    check(field.id === decl.id + '.f' + ordinal && field.ordinal === ordinal && !state.fields.has(field.id), 'identity');
    check(typeof field.readonly === 'boolean' && typeof field.definiteAssertionSyntax === 'boolean'
      && ['public','private','protected'].includes(field.access) && field.optionalSyntax === false, 'schema');
    if (!state.byType.has(field.type)) exceptionScalar(field.type, prepared.profile);
    check(!decl.fields.slice(0, ordinal).some(prior => prior.name === field.name), 'symbol', 'duplicate class property');
    const symbol = definitions.get(field.symbol);
    check(symbol && same(symbol, { id: field.symbol, name: field.name, kind: 'field', type: field.type, writable: !field.readonly, range: symbol.range }), 'symbol');
    range(field.range, decl.bodyRange, source.content);
    state.fields.set(field.id, { decl, field }); state.prefixIds.push(field.symbol);
  }
  state.prefixIds.forEach((id, index) => check(id === 's' + (index + 1), 'symbol', 'class/field registry order differs'));
  for (const decl of declarations) {
    const markerName = prepared.aggregateInput.markers.get(decl.category).name;
    check(!state.byName.has(markerName) && !(facts.functions ?? []).some(fn => !fn.lexicalParent && fn.name === markerName), 'identity', 'source value declaration shadows the actual ambient marker');
  }
  const visiting = new Set(), done = new Set();
  function acyclic(id, depth = 0) {
    check(depth <= wireLimits.depth, 'limit'); check(!visiting.has(id), 'type', 'cyclic aggregate field layout');
    if (done.has(id)) return;
    visiting.add(id);
    for (const field of state.byType.get(id).fields) if (state.byType.has(field.type)) acyclic(field.type, depth + 1);
    visiting.delete(id); done.add(id);
  }
  for (const decl of declarations) acyclic(decl.id);
  return state;
}
export function exceptionAggregateAnnotation(state, grammar, index, type, profile) {
  const name = exceptionIdentifierName(grammar.at(index).text), declaration = state?.byName.get(name);
  if (declaration) {
    check(declaration.id === type, 'type', 'source annotation resolves to a different owned nominal class'); return index + 1;
  }
  check(!state?.byType.has(type), 'type', 'nominal annotation must name its actual class');
  return exceptionAnnotation(grammar, index, type, profile);
}
export function exceptionAggregatePresenceAnnotation(state, grammar, index, type, profile) {
  const next = exceptionAggregateAnnotation(state, grammar, index, type, profile);
  check(grammar.spelling(next) !== '|', 'capability', 'nullable/aggregate declaration combinations require a separate cold tracer');
  return { next, mask: 0, first: index, last: next - 1 };
}
function fieldSource(state, decl, field, context, index, verifyExpression) {
  const g = state.grammar, first = index;
  let next = index, access = 'public';
  const modifier = position => ![':', '!'].includes(g.spelling(position + 1));
  if (['public','private','protected'].includes(g.spelling(next)) && modifier(next)) access = g.spelling(next++);
  const readonly = g.spelling(next) === 'readonly' && modifier(next); if (readonly) next++;
  check(access === field.access && readonly === field.readonly, 'permission');
  const binding = state.definitions.get(field.symbol), name = next;
  // A field symbol uses raw Node.Pos and may start before trimmed field.range.
  g.raw(binding.range, decl.bodyRange, name);
  check(exceptionIdentifierName(g.at(next++).text) === field.name, 'source', 'property declaration name differs');
  const definite = g.spelling(next) === '!'; if (definite) next++;
  check(definite === field.definiteAssertionSyntax, 'source'); next = g.expect(next, ':');
  next = exceptionAggregateAnnotation(state, g, next, field.type, context.profile);
  if (g.spelling(next) === '=') {
    check(field.initializer !== null, 'schema');
    const value = verifyExpression(field.initializer, field.range, exceptionScope(), context, next + 1);
    check(value.type === field.type && value.mask === 0, 'type', 'field initializer payload differs'); next = value.next;
  } else check(field.initializer === null, 'schema');
  if (g.spelling(next) === ';') next++;
  else check(g.spelling(next) === '}' || /[\r\n\u2028\u2029]/.test(context.source.content.slice(g.at(next - 1).end, g.at(next).start)), 'source', 'missing class member separator');
  g.span(field.range, decl.bodyRange, first, next - 1);
  return next;
}
export function verifyExceptionAggregateDeclaration(state, context, index, verifyExpression) {
  check(state && state.seen.size < state.declarations.length, 'source', 'unowned aggregate declaration');
  const decl = state.declarations[state.seen.size], g = state.grammar, first = index;
  let next = g.expect(index, '@');
  const marker = state.prepared.aggregateInput.markers.get(decl.category);
  check(exceptionIdentifierName(g.at(next).text) === marker.name, 'identity', 'decorator must name its actual pinned marker'); next++;
  g.span(decl.markerOrigin.range, decl.range, first, next - 1);
  next = g.expect(next, 'class'); g.name(state.definitions.get(decl.symbol).range, decl.name, decl.range, next++);
  const body = next; next = g.expect(next, '{');
  for (const field of decl.fields) next = fieldSource(state, decl, field, context, next, verifyExpression);
  check(g.spelling(next) === '}', 'capability', 'uncovered class member or explicit constructor is not implemented');
  next = g.expect(next, '}');
  g.span(decl.range, g.root, first, next - 1); g.span(decl.bodyRange, decl.range, body, next - 1);
  const coverage = decl.fields.map(field => ({ kind: 'KindPropertyDeclaration', name: field.name,
    symbol: field.symbol, range: field.range, bodyRange: null }));
  check(same(decl.memberCoverage, coverage), 'source', 'complete class member coverage differs');
  state.coverage.push({ kind: 'class', name: decl.name, symbol: decl.symbol, range: decl.range, bodyRange: decl.bodyRange });
  state.seen.add(decl.id); return next;
}
export function recordExceptionAggregateFunction(state, fn, bodyFirst, afterBody) {
  if (state) state.coverage.push({ kind: 'function', name: fn.name, symbol: fn.symbol, range: fn.range,
    bodyRange: { start: state.grammar.at(bodyFirst).start, end: state.grammar.at(afterBody - 1).end } });
}
export function finishExceptionAggregates(state) {
  if (!state) return;
  check(state.seen.size === state.declarations.length && same(state.facts.sourceCoverage, state.coverage), 'source', 'complete top-level aggregate/function coverage differs');
}
