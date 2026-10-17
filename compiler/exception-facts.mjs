// SPDX-License-Identifier: MIT
import { check, record, array, text, range, same, wireLimits } from './exception-common.mjs';
import { exceptionSourceGrammar } from './exception-source-grammar.mjs';
import { verifyExceptionModuleFacts } from './exception-module-facts.mjs';
import { verifyExceptionBlock, exceptionStatementsCanComplete } from './exception-statements.mjs';
import { exceptionScope, declareExceptionBinding } from './exception-scope.mjs';
import { exceptionScalar, exceptionValueType, verifyExceptionScriptGlobal } from './exception-types.mjs';
import { exceptionPresenceAnnotation, verifyExceptionParameterPresence, verifyExceptionReturnPresence } from './exception-presence.mjs';
import { exceptionCallableSignature, exceptionCallableAnnotation } from './exception-callable.mjs';
import { prepareExceptionClosures } from './exception-closures.mjs';
import { verifyExceptionExpression } from './exception-expressions.mjs';
import { createExceptionAggregateRegistry, verifyExceptionAggregateDeclaration, exceptionAggregatePresenceAnnotation,
  recordExceptionAggregateFunction, finishExceptionAggregates } from './exception-aggregate-facts.mjs';

const symbolMetadata = ['sourcePath','bindingKind'];
const functionMetadata = ['sourcePath'];

// Declaration ownership is independent of reads: unused locals still have one
// owner, while references never claim or mutate a declaration's type or scope.
export function verifyExceptionFacts(prepared, facts, exports) {
  if (prepared.moduleInput) return verifyExceptionModuleFacts(prepared, facts, exports);
  record(facts, ['status','inputs','symbols'], ['functions','modules','aggregateFacts']);
  check(facts.modules === undefined, 'capability', 'module facts have no private consumer tracer yet');
  check(facts.status === 'ok' && same(facts.inputs, prepared.files.map(file => file.path)), 'input');
  check(prepared.sources.length === 1, 'capability');
  const source = prepared.sources[0], grammar = exceptionSourceGrammar(source), profile = prepared.profile;
  const closures = prepareExceptionClosures(facts.functions);
  const definitions = new Map(), claimed = new Set();
  for (const [ordinal, symbol] of array(facts.symbols, wireLimits.symbols).entries()) {
    record(symbol, ['id','name','kind','type','writable','range'], ['presence','returnPresence','signature','lexicalOwner', ...symbolMetadata]);
    check(symbolMetadata.every(key => !Object.hasOwn(symbol, key)), 'capability', 'module symbol metadata is not implemented');
    if (!closures) check(!Object.hasOwn(symbol, 'lexicalOwner'), 'capability', 'lexical metadata requires an owned nested declaration');
    check(symbol.id === 's' + (ordinal + 1) && !definitions.has(symbol.id), 'symbol'); text(symbol.name);
    check(['function','parameter','local','class','field'].includes(symbol.kind), 'capability');
    text(symbol.type);
    if (symbol.type === 'function') {
      check(symbol.kind === 'function' || symbol.kind === 'parameter', 'capability', 'callable locals are not implemented');
      if (symbol.kind === 'parameter') {
        exceptionCallableSignature(symbol.signature);
        check(!Object.hasOwn(symbol, 'presence'), 'schema', 'callable parameters must omit scalar presence metadata');
      } else check(!Object.hasOwn(symbol, 'signature'), 'signature', 'function result signature belongs to its function DTO');
    } else {
      check(!Object.hasOwn(symbol, 'signature'), 'signature', 'noncallable symbol must omit callable metadata');
    }
    check(typeof symbol.writable === 'boolean', 'symbol');
    if (['function','parameter','class'].includes(symbol.kind)) check(symbol.writable === (symbol.kind === 'parameter'), 'type');
    if (symbol.kind !== 'parameter') check(!Object.hasOwn(symbol, 'presence'), 'schema');
    if (symbol.kind !== 'function') check(!Object.hasOwn(symbol, 'returnPresence'), 'schema');
    range(symbol.range, grammar.root, source.content); definitions.set(symbol.id, symbol);
  }
  const functions = facts.functions === undefined ? [] : array(facts.functions, wireLimits.functions, 1);
  check(functions.length > 0, 'capability', 'ordinary exception facts require an owned function');
  const aggregate = createExceptionAggregateRegistry(prepared, facts, definitions, grammar), prefix = aggregate?.prefixIds ?? [];
  check(!closures || !aggregate, 'capability', 'aggregate closure combinations require a separate cold tracer');
  if (closures) closures.bindDefinitions(definitions);
  for (const id of prefix) claimed.add(id);
  for (const symbol of definitions.values()) {
    if (['class','field'].includes(symbol.kind) || symbol.type === 'function') continue;
    if (symbol.kind === 'local') exceptionValueType(symbol.type, profile, aggregate);
    else if (!aggregate?.byType.has(symbol.type)) exceptionScalar(symbol.type, profile);
  }
  let nextLocal = prefix.length + functions.length + 1;
  const context = { source, grammar, profile, definitions, aggregate, closures, activeFunction: /** @type {any} */ (null), verifyNestedFunction: /** @type {any} */ (null), returnType: '', returnMask: 0, returnSignature: undefined, steps: 0, claim(id) {
    check(definitions.has(id) && !claimed.has(id), 'symbol', 'definition has missing or duplicate declaration ownership');
    if (closures) closures.claim(definitions.get(id), context.activeFunction);
    else if (definitions.get(id).kind !== 'function') check(id === 's' + nextLocal++, 'symbol', 'declaration registry order differs from source traversal');
    claimed.add(id);
  } };
  const names = new Set(aggregate?.declarations.map(decl => decl.name) ?? []), bindings = [];
  /** @param {any} fn @param {number} ordinal @param {number} index @param {any} [parentScope] @returns {number} */
  const verifyFunction = (fn, ordinal, index, parentScope = undefined) => {
    const previous = { activeFunction: context.activeFunction, returnType: context.returnType, returnMask: context.returnMask, returnSignature: context.returnSignature };
    context.activeFunction = fn;
    try {
      let next = index;
      record(fn, ['name','symbol','parameters','returnType','body','range'], ['parameterInitializers','returnPresence','returnSignature','lexicalParent','captures', ...functionMetadata]);
      check(functionMetadata.every(key => !Object.hasOwn(fn, key)), 'capability', 'module function metadata is not implemented');
      if (!closures) check(!Object.hasOwn(fn, 'lexicalParent') && !Object.hasOwn(fn, 'captures'), 'capability');
      range(fn.range, grammar.root, source.content); text(fn.name);
      const nested = Object.hasOwn(fn, 'lexicalParent');
      if (!nested) { check(!names.has(fn.name), 'symbol', 'duplicate top-level function'); names.add(fn.name); }
      const definition = definitions.get(fn.symbol);
      check(definition && definition.kind === 'function' && definition.name === fn.name
        && definition.type === fn.returnType && fn.symbol === 's' + (prefix.length + ordinal + 1), 'symbol');
      const callable = fn.returnType === 'function';
      if (callable) {
        check(!aggregate && !closures, 'capability', 'callable declarations with aggregate/closure input require a separate cold tracer');
        exceptionCallableSignature(fn.returnSignature);
        check(!Object.hasOwn(fn, 'returnPresence') && !Object.hasOwn(definition, 'returnPresence'), 'schema', 'callable results must omit scalar return presence');
      } else {
        if (!aggregate?.byType.has(fn.returnType)) exceptionScalar(fn.returnType, profile);
        check(!Object.hasOwn(fn, 'returnSignature'), 'signature', 'noncallable function must omit a return signature');
      }
      context.returnType = fn.returnType; context.returnSignature = callable ? fn.returnSignature : undefined; context.returnMask = 0;
      const first = next, exported = grammar.spelling(next) === 'export';
      check(!nested || !exported, 'source', 'nested function cannot export');
      if (exported) next = grammar.expect(next, 'export');
      next = grammar.expect(next, 'function'); grammar.name(definition.range, fn.name, fn.range, next);
      context.claim(definition.id); next = grammar.expect(next + 1, '(');
      const scope = closures ? closures.enter(fn, parentScope) : exceptionScope();
      const parameters = array(fn.parameters, wireLimits.parameters);
      for (const [ordinal, parameter] of parameters.entries()) {
        if (ordinal) next = grammar.expect(next, ',');
        check(parameter && parameter.kind === 'parameter' && parameter.writable === true, 'type');
        const name = next;
        grammar.name(parameter.range, parameter.name, fn.range, next); next = grammar.expect(next + 1, ':');
        if (callable) {
          check(parameter.type === 'function', 'capability', 'mixed callable/scalar function parameters are not implemented');
          check(!Object.hasOwn(parameter, 'presence'), 'schema', 'callable parameters must omit scalar presence metadata');
          next = exceptionCallableAnnotation(grammar, next, parameter.signature, profile);
        } else {
          if (!aggregate?.byType.has(parameter.type)) exceptionScalar(parameter.type, profile);
          const annotation = aggregate
            ? exceptionAggregatePresenceAnnotation(aggregate, grammar, next, parameter.type, profile)
            : exceptionPresenceAnnotation(grammar, next, parameter.type, profile); next = annotation.next;
          verifyExceptionParameterPresence(parameter.presence, annotation, name, fn.range, grammar);
          if (closures) check(annotation.mask === 0, 'capability', 'nullable closure parameters require a separate cold tracer');
        }
        declareExceptionBinding(parameter, scope, context);
      }
      if (parameters.length && grammar.spelling(next) === ',') next = grammar.expect(next, ',');
      next = grammar.expect(next, ')'); next = grammar.expect(next, ':');
      if (callable) {
        next = exceptionCallableAnnotation(grammar, next, fn.returnSignature, profile);
        check(!Object.hasOwn(fn, 'parameterInitializers'), 'schema', 'callable function route must omit parameter initializers');
      } else {
        const result = aggregate
          ? exceptionAggregatePresenceAnnotation(aggregate, grammar, next, fn.returnType, profile)
          : exceptionPresenceAnnotation(grammar, next, fn.returnType, profile); next = result.next;
        verifyExceptionReturnPresence(fn, definition, result, grammar); context.returnMask = result.mask;
        if (parameters.length) check(same(fn.parameterInitializers, parameters.map(() => null)), 'schema');
        else check(!Object.hasOwn(fn, 'parameterInitializers'), 'schema');
      }
      const bodyFirst = next;
      next = verifyExceptionBlock({ body: fn.body, range: { start: grammar.rawStart(next), end: fn.range.end } }, fn.range, scope, context, next);
      grammar.raw(fn.range, grammar.root, first, next - 1);
      recordExceptionAggregateFunction(aggregate, fn, bodyFirst, next);
      if (closures) closures.exit(fn);
      check(!exceptionStatementsCanComplete(fn.body), 'type', 'non-void function has a normal completion without a return value');
      if (exported) bindings.push({ name: fn.name, target: fn.symbol, sourcePath: source.path, range: fn.range, definition: definition.range });
      return next;
    } finally { Object.assign(context, previous); }
  };
  context.verifyNestedFunction = (fn, index, scope) => verifyFunction(fn, functions.indexOf(fn), index, scope);
  let next = 0;
  for (const [ordinal, fn] of functions.entries()) {
    if (fn.lexicalParent) continue;
    while (grammar.spelling(next) === '@') next = verifyExceptionAggregateDeclaration(aggregate, context, next, verifyExceptionExpression);
    next = verifyFunction(fn, ordinal, next);
  }
  while (grammar.spelling(next) === '@') next = verifyExceptionAggregateDeclaration(aggregate, context, next, verifyExceptionExpression);
  finishExceptionAggregates(aggregate);
  if (closures) closures.finish();
  check(next === grammar.length, 'capability', 'source has uncovered declarations or export forms');
  check(claimed.size === definitions.size, 'symbol', 'symbol registry contains an unowned declaration');
  bindings.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
  const external = bindings.length > 0;
  if (!external) for (const name of names) {
    verifyExceptionScriptGlobal(name, prepared.declarationValues);
    check(prepared.aggregateInput?.globals.get(name) !== 'function', 'capability', 'script ambient function merging requires a separate cold proof');
  }
  if (!external && aggregate) for (const declaration of aggregate.declarations) {
    const binding = prepared.aggregateInput.typeBindings.get(declaration.name);
    if (!binding) continue;
    check(binding.kind !== 'alias', 'scope', 'script class conflicts with an actual pinned DTS type alias');
    check(false, 'capability', 'script class merging with a pinned DTS interface (arity ' + binding.arity + ') requires a separate cold proof');
  }
  check(same(exports, [{ sourcePath: source.path, external, bindings }]), 'exports', 'complete direct export set differs from source-owned functions');
  return { functions: functions.length, calls: closures?.calls ?? 0 };
}
