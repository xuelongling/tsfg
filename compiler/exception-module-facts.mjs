// SPDX-License-Identifier: MIT
import path from 'node:path';
import { check, record, array, text, range, same, wireLimits } from './exception-common.mjs';
import { exceptionSourceGrammar } from './exception-source-grammar.mjs';
import { exceptionIdentifierName } from './exception-identifiers.mjs';
import { exceptionScalar, exceptionValueType } from './exception-types.mjs';
import { exceptionPresenceAnnotation, verifyExceptionParameterPresence, verifyExceptionReturnPresence } from './exception-presence.mjs';
import { exceptionScope, declareExceptionBinding } from './exception-scope.mjs';
import { verifyExceptionBlock, verifyExceptionStatement, exceptionStatementsCanComplete } from './exception-statements.mjs';

// The private module DTO is a source-owned registry, not legacy HIR. Every body
// and initialization reenters the same exception/flow checker before returning.
function importSource(edge, module, grammar, sources, exportTables, index) {
  const first = index, g = grammar;
  let next = g.expect(index, 'import');
  check(g.spelling(next) === '{', 'capability', 'only direct named import clauses have a cold tracer'); next = g.expect(next, '{');
  const bindings = array(edge.bindings, wireLimits.symbols, 1);
  for (const [ordinal, binding] of bindings.entries()) {
    if (ordinal) next = g.expect(next, ',');
    const imported = exceptionIdentifierName(g.at(next++).text);
    if (g.spelling(next) === 'as') next = g.expect(next, 'as');
    else next--;
    const local = next++, spelling = g.at(local).text, name = exceptionIdentifierName(spelling);
    check(binding.name === spelling && exportTables.get(edge.sourcePath).get(imported) === binding.target, 'scope', 'named import does not bind the actual exported function');
    g.name(binding.range, name, edge.range, local, true);
  }
  if (g.spelling(next) === ',') next = g.expect(next, ',');
  next = g.expect(next, '}'); next = g.expect(next, 'from');
  const literal = g.at(next++).text, quote = literal[0];
  check((quote === '"' || quote === "'") && literal.at(-1) === quote && !literal.includes('\\'), 'capability', 'escaped module specifiers require a separate cold tracer');
  const specifier = literal.slice(1, -1);
  check(specifier === edge.specifier && /^\.\.?\//.test(specifier) && !specifier.includes('\0'), 'source', 'module specifier differs from its original literal');
  const logical = path.posix.normalize(path.posix.join(path.posix.dirname(module.sourcePath), specifier));
  const candidates = [...new Set([logical, logical + '.ts', logical + '/index.ts', logical.replace(/\.js$/, '.ts')])].filter(candidate => sources.has(candidate));
  check(candidates.length === 1, 'capability', 'relative module association is absent or ambiguous in supplied sources');
  check(candidates[0] === edge.sourcePath, 'input', 'import points to another supplied source');
  if (g.spelling(next) === ';') next++;
  g.raw(edge.range, g.root, first, next - 1); return next;
}
export function verifyExceptionModuleFacts(prepared, facts, exports) {
  record(facts, ['status','inputs','symbols','functions','modules']);
  check(facts.status === 'ok' && same(facts.inputs, prepared.files.map(file => file.path)), 'input');
  const sources = new Map(prepared.sources.map(source => [source.path, source]));
  const definitions = new Map(), functions = array(facts.functions, wireLimits.functions, 1), byFunction = new Map(), ownFunctions = new Map();
  for (const [ordinal, symbol] of array(facts.symbols, wireLimits.symbols).entries()) {
    record(symbol, ['id','name','kind','type','writable','range','sourcePath'], ['presence']);
    check(symbol.id === 's' + (ordinal + 1) && !definitions.has(symbol.id), 'symbol'); text(symbol.name);
    const source = sources.get(symbol.sourcePath); check(source, 'scope', 'definition belongs to an unconsumed source'); range(symbol.range, { start: 0, end: source.content.length }, source.content);
    check(['function','parameter','local'].includes(symbol.kind) && typeof symbol.writable === 'boolean', 'capability');
    if (symbol.kind === 'local') exceptionValueType(symbol.type, prepared.profile); else exceptionScalar(symbol.type, prepared.profile);
    if (symbol.kind !== 'local') check(symbol.writable === (symbol.kind === 'parameter'), 'permission');
    if (symbol.kind !== 'parameter') check(!Object.hasOwn(symbol, 'presence'), 'schema');
    definitions.set(symbol.id, symbol);
  }
  for (const [ordinal, fn] of functions.entries()) {
    record(fn, ['name','symbol','sourcePath','parameters','returnType','body','range'], ['parameterInitializers']);
    const definition = definitions.get(fn.symbol), source = sources.get(fn.sourcePath);
    check(source && definition?.kind === 'function' && definition.sourcePath === fn.sourcePath && definition.name === fn.name
      && definition.type === fn.returnType && fn.symbol === 's' + (ordinal + 1), 'symbol');
    range(fn.range, { start: 0, end: source.content.length }, source.content); exceptionScalar(fn.returnType, prepared.profile);
    array(fn.parameters, wireLimits.parameters); array(fn.body);
    const names = ownFunctions.get(fn.sourcePath) ?? new Map(); check(!names.has(fn.name), 'symbol', 'duplicate top-level function');
    names.set(fn.name, fn.symbol); ownFunctions.set(fn.sourcePath, names); byFunction.set(fn.symbol, fn);
  }
  const modules = array(facts.modules, wireLimits.files, 1), byModule = new Map(), exportTables = new Map(), visible = new Map();
  check(same(modules.map(module => module?.sourcePath), prepared.sources.map(source => source.path)), 'input', 'each consumed source must own exactly one sorted module');
  for (const module of modules) {
    record(module, ['sourcePath','external','imports','exports','globals','initialization']);
    check(module.external === true && array(module.globals).length === 0, 'capability', 'script merging and global value initialization require a separate cold tracer');
    array(module.imports); array(module.initialization); const table = new Map();
    for (const binding of array(module.exports)) {
      record(binding, ['name','target','range']); text(binding.name); const fn = byFunction.get(binding.target);
      check(fn && fn.sourcePath === module.sourcePath && fn.name === binding.name && !table.has(binding.name) && same(binding.range, fn.range), 'exports');
      table.set(binding.name, binding.target);
    }
    byModule.set(module.sourcePath, module); exportTables.set(module.sourcePath, table);
  }
  for (const module of modules) {
    const view = new Map(ownFunctions.get(module.sourcePath) ?? []);
    for (const edge of module.imports) {
      record(edge, ['kind','specifier','sourcePath','range','bindings']);
      check(edge.kind === 'import' && byModule.has(edge.sourcePath), 'capability', 'only direct named imports between consumed TS modules are implemented');
      const source = sources.get(module.sourcePath); range(edge.range, { start: 0, end: source.content.length }, source.content);
      for (const binding of array(edge.bindings, wireLimits.symbols, 1)) {
        record(binding, ['name','target','range']); const name = exceptionIdentifierName(binding.name), target = byFunction.get(binding.target);
        check(target?.sourcePath === edge.sourcePath && [...exportTables.get(edge.sourcePath).values()].includes(binding.target)
          && !view.has(name), 'scope', 'import target is foreign, unexported or duplicated'); view.set(name, binding.target);
      }
    }
    visible.set(module.sourcePath, view);
  }
  const claimed = new Set(); let nextLocal = functions.length + 1, nextFunction = 0;
  const context = { source: null, grammar: null, profile: prepared.profile, definitions, aggregate: null, module: null,
    returnType: '', returnMask: 0, returnSignature: undefined, steps: 0, calls: 0, claim(id) {
      const definition = definitions.get(id);
      check(definition && !claimed.has(id) && definition.sourcePath === context.source.path, 'symbol', 'declaration has duplicate or foreign source ownership');
      if (definition.kind !== 'function') check(id === 's' + nextLocal++, 'symbol', 'module declaration order differs from source traversal'); claimed.add(id);
    } };
  const derivedExports = [];
  for (const source of prepared.sources) {
    const module = byModule.get(source.path), g = exceptionSourceGrammar(source), bindings = [], initializationScope = exceptionScope();
    context.source = source; context.grammar = g; context.module = { functions: byFunction, visible: visible.get(source.path) };
    let next = 0, importOrdinal = 0, initializationOrdinal = 0;
    while (next < g.length) {
      if (g.spelling(next) === 'import') {
        const edge = module.imports[importOrdinal++]; check(edge, 'source', 'source import lacks its owned DTO');
        next = importSource(edge, module, g, sources, exportTables, next); continue;
      }
      if (g.spelling(next) !== 'function' && g.spelling(next) !== 'export') {
        const item = module.initialization[initializationOrdinal++];
        check(item?.kind === 'try', 'capability', 'only top-level exception regions have an initialization tracer');
        context.returnType = ''; context.returnMask = 0; check(++context.steps <= wireLimits.jsonTokens, 'limit');
        next = verifyExceptionStatement(item, g.root, initializationScope, context, next); continue;
      }
      const fn = functions[nextFunction++], first = next, exported = g.spelling(next) === 'export';
      check(fn?.sourcePath === source.path, 'symbol', 'function ordering differs from complete source traversal');
      if (exported) next = g.expect(next, 'export');
      check(g.spelling(next) === 'function', 'capability', 'only direct named function exports have a cold tracer'); next = g.expect(next, 'function');
      const definition = definitions.get(fn.symbol); g.name(definition.range, fn.name, fn.range, next); context.claim(fn.symbol);
      next = g.expect(next + 1, '('); const scope = exceptionScope();
      for (const [ordinal, parameter] of fn.parameters.entries()) {
        if (ordinal) next = g.expect(next, ',');
        check(parameter?.kind === 'parameter' && parameter.writable === true && same(parameter, definitions.get(parameter.id)), 'symbol');
        const name = next; g.name(parameter.range, parameter.name, fn.range, next); next = g.expect(next + 1, ':');
        exceptionScalar(parameter.type, prepared.profile);
        const annotation = exceptionPresenceAnnotation(g, next, parameter.type, prepared.profile); next = annotation.next;
        check(annotation.mask === 0, 'capability', 'nullable module parameters require a separate cold tracer');
        verifyExceptionParameterPresence(parameter.presence, annotation, name, fn.range, g); declareExceptionBinding(parameter, scope, context);
      }
      if (fn.parameters.length && g.spelling(next) === ',') next = g.expect(next, ',');
      next = g.expect(next, ')'); next = g.expect(next, ':');
      const result = exceptionPresenceAnnotation(g, next, fn.returnType, prepared.profile); next = result.next;
      check(result.mask === 0, 'capability'); verifyExceptionReturnPresence(fn, definition, result, g);
      if (fn.parameters.length) check(same(fn.parameterInitializers, fn.parameters.map(() => null)), 'schema');
      else check(!Object.hasOwn(fn, 'parameterInitializers'), 'schema');
      context.returnType = fn.returnType; context.returnMask = 0;
      next = verifyExceptionBlock({ body: fn.body, range: { start: g.rawStart(next), end: fn.range.end } }, fn.range, scope, context, next);
      g.raw(fn.range, g.root, first, next - 1); check(!exceptionStatementsCanComplete(fn.body), 'type', 'non-void module function can complete normally');
      if (exported) bindings.push({ name: fn.name, target: fn.symbol, sourcePath: source.path, range: fn.range, definition: definition.range });
    }
    check(importOrdinal === module.imports.length && initializationOrdinal === module.initialization.length, 'source', 'module import/initialization coverage is incomplete');
    bindings.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
    check(module.external === (module.imports.length > 0 || bindings.length > 0)
      && same(module.exports, bindings.map(({ name, target, range }) => ({ name, target, range }))), 'exports', 'complete source export set differs');
    derivedExports.push({ sourcePath: source.path, external: module.external, bindings });
  }
  check(nextFunction === functions.length && claimed.size === definitions.size, 'symbol', 'module registry contains unowned declarations');
  check(same(exports, derivedExports), 'exports', 'complete per-source official export groups differ from owned declarations');
  for (const root of prepared.moduleInput.closure.roots) {
    if (root.kind === 'module-initialization') check(root.name === '$moduleInit' && byModule.has(root.sourcePath), 'input');
    else check((exportTables.get(root.sourcePath)?.get(root.name) ?? ownFunctions.get(root.sourcePath)?.get(root.name)) !== undefined, 'input', 'closure root does not name an actual same-source function');
  }
  return { functions: functions.length, calls: context.calls };
}
