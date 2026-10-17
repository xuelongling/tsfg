// SPDX-License-Identifier: MIT
import { canonical, limits, check, failure } from './exception-hir-common.mjs';
import { exceptionHirIdentity } from './exception-hir-identity.mjs';
import { createExceptionHirRegions } from './exception-hir-regions.mjs';

// One cold projection owns this registry. A header is declared at its actual
// lexical Region; bodies are projected once and emitted in Source table order.
/** @param {any} context */
export function projectExceptionHirFunctions(context) {
  const { functions, definitions, types, budget, moduleId, moduleScope, sourcePath, claimed, aggregates } = context;
  const raw = new Map(), headers = new Map(), projected = new Map(), active = new Set();
  const lexical = functions.some(/** @param {any} fn */ fn => fn.lexicalParent !== undefined);
  if (lexical && aggregates) failure('capability', 'aggregate and lexical HIR combinations require their own tracer');
  for (const fn of functions) {
    check(raw.size < limits.derived.functions, 'limit', 'HIR function table budget exceeded');
    check(!raw.has(fn.symbol), 'identity', 'HIR function identity is repeated');
    if (fn.returnType === 'unknown') failure('capability', 'unknown-result HIR functions require their own tracer');
    check(Array.isArray(fn.parameters), 'schema', 'HIR parameter list is missing');
    check(fn.parameters.length <= limits.derived.parametersPerFunction, 'limit', 'HIR parameter budget exceeded');
    if (lexical && (fn.returnType !== 'bool' || fn.returnPresence !== undefined || fn.returnSignature !== undefined))
      failure('capability', 'lexical HIR functions require nonnullable bool results');
    if (fn.lexicalParent !== undefined) {
      check(raw.has(fn.lexicalParent), 'scope', 'HIR lexical parent must precede its child');
      if (fn.parameters.length) failure('capability', 'nested HIR parameters require their own tracer');
    }
    if (fn.captures !== undefined) {
      check(Array.isArray(fn.captures) && fn.captures.length <= limits.derived.arrayItems,
        'limit', 'HIR capture array budget exceeded');
      if (fn.lexicalParent === undefined || fn.captures.length === 0
          || fn.captures.some(/** @param {any} capture */ capture => capture.read !== true || capture.write !== false))
        failure('capability', 'HIR captures require original enclosing catch reads');
    }
    if (fn.parameterInitializers !== undefined) {
      check(Array.isArray(fn.parameterInitializers) && fn.parameterInitializers.length === fn.parameters.length,
        'schema', 'HIR parameter initializers must remain aligned');
      if (fn.parameterInitializers.some(/** @param {any} value */ value => value !== null))
        failure('capability', 'HIR parameter defaults require their own tracer');
    }
    const parameterTypes = [];
    for (const parameter of fn.parameters) {
      if (parameter.type === 'unknown' || parameter.presence && (parameter.presence.optional || parameter.presence.default))
        failure('capability', 'unknown or optional HIR parameters require their own tracer');
      if ((parameter.type === 'function') !== (fn.returnType === 'function'))
        failure('capability', 'mixed callable and scalar HIR declarations require their own tracer');
      parameterTypes.push(types.value(parameter.type, parameter.signature, parameter.presence));
    }
    const returnType = types.value(fn.returnType, fn.returnSignature, fn.returnPresence);
    const signatureHash = exceptionHirIdentity('signature', { parameters: parameterTypes, returnType });
    const type = types.callable(parameterTypes, returnType), definition = definitions.get(fn.symbol);
    check(definition?.kind === 'function' && definition.name === fn.name && definition.type === fn.returnType
      && definition.lexicalOwner === fn.lexicalParent, 'scope', 'HIR function does not own its declaration symbol');
    raw.set(fn.symbol, { fn, definition, type, returnType, signatureHash });
  }
  /** @param {any} fn @param {any} parent @param {any} scope */
  function declareHeader(fn, parent, scope) {
    check(headers.size < limits.derived.functions, 'limit', 'HIR function header budget exceeded');
    check(!headers.has(fn.symbol), 'identity', 'HIR function is declared more than once');
    const info = raw.get(fn.symbol), path = parent ? scope.path : [];
    const lexicalParent = parent ? parent.id : null, declaringScope = parent ? scope.scope : moduleScope;
    const id = exceptionHirIdentity('function', { module: moduleId, parent: lexicalParent,
      declaringScopePath: path, name: fn.name, signatureHash: info.signatureHash, range: fn.range });
    const header = { id, module: moduleId, sourcePath, nameRange: info.definition.range,
      type: info.type, returnType: info.returnType, signatureHash: info.signatureHash,
      lexicalParent, declaringScope, rawSymbol: fn.symbol };
    headers.set(fn.symbol, header); return header;
  }
  /** @param {any} fn @param {any} header @param {any} lookup */
  function projectFunction(fn, header, lookup) {
    check(!active.has(fn.symbol) && !projected.has(fn.symbol), 'scope', 'HIR function body is projected more than once');
    active.add(fn.symbol);
    try {
      const value = regions.project(fn, header, lookup);
      check(projected.size < limits.derived.functions, 'limit', 'HIR function array budget exceeded');
      projected.set(fn.symbol, value);
    } finally { active.delete(fn.symbol); }
  }
  const adapter = {
    /** @param {any} item @param {any} parent @param {any} scope */
    declare(item, parent, scope) {
      const info = raw.get(item.symbol.id);
      check(info && info.fn.lexicalParent === parent.rawSymbol
        && canonical(item.symbol) === canonical(info.definition) && canonical(item.range) === canonical(info.fn.range),
      'scope', 'HIR nested declaration has no identical owned table body');
      return declareHeader(info.fn, parent, scope);
    },
    /** @param {any} item @param {any} parent @param {any} scope @param {any} lookup */
    projectDeclaration(item, parent, scope, lookup) {
      const info = raw.get(item.symbol.id), header = headers.get(item.symbol.id);
      check(info && header && header.lexicalParent === parent.id && header.declaringScope === scope.scope,
        'scope', 'HIR nested function belongs to a different declaring Region');
      projectFunction(info.fn, header, lookup); return header;
    },
    /** @param {any} value @param {any} lookup */
    call(value, lookup) {
      const info = raw.get(value.target), target = headers.get(value.target);
      if (!info || !target || target.lexicalParent === null || info.fn.parameters.length || info.fn.returnType !== 'bool')
        failure('capability', 'HIR direct calls require an owned zero-parameter lexical bool function');
      if (!Array.isArray(value.arguments) || value.arguments.length)
        failure('capability', 'HIR lexical call arguments require their own tracer');
      check(value.type === 'bool' && canonical(value.signature) === canonical({ parameters: [], returnType: 'bool' }),
        'type', 'HIR direct call signature differs from its actual function');
      const binding = lookup(value.target);
      check(binding.role === 'function' && binding.type === target.type,
        'scope', 'HIR direct call does not resolve its visible function binding');
      return { kind: 'directCall', type: target.returnType, range: value.range, target: target.id,
        name: value.name ?? null, signature: { ownerKind: 'function', owner: target.id, type: target.type,
          presence: null, returnPresence: null }, arguments: [] };
    },
  };
  const regions = createExceptionHirRegions({ definitions, types, budget, claimed, aggregates }, adapter);
  for (const fn of functions) if (fn.lexicalParent === undefined)
    projectFunction(fn, declareHeader(fn, null, null), undefined);
  check(headers.size === functions.length && projected.size === functions.length,
    'scope', 'HIR leaves a function declaration or body unprojected');
  const result = [];
  for (const fn of functions) result.push(projected.get(fn.symbol));
  return { headers, functions: result };
}
