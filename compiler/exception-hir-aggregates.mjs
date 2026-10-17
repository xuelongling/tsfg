// SPDX-License-Identifier: MIT
import { canonical, limits, check, failure } from './exception-hir-common.mjs';
import { exceptionHirIdentity } from './exception-hir-identity.mjs';

// The cold snapshot owns declaration and marker proof. This registry translates
// nominal ownership, constructors and coverage without inspecting Source text.
/** @param {any} raw @param {any} definitions @param {any} source @param {any} types */
export function createExceptionHirAggregates(raw, definitions, source, types) {
  if (raw === undefined) return null;
  check(Array.isArray(raw.declarations) && raw.declarations.length <= limits.derived.types,
    'limit', 'HIR aggregate declaration budget exceeded');
  check(Array.isArray(raw.sourceCoverage) && raw.sourceCoverage.length <= limits.derived.arrayItems,
    'limit', 'HIR source coverage budget exceeded');
  const bySymbol = new Map(), byConstructor = new Map();
  /** @type {string[]} */
  const ids = [];
  for (const declaration of raw.declarations) {
    check(Array.isArray(declaration.fields) && Array.isArray(declaration.memberCoverage),
      'schema', 'HIR aggregate member tables are missing');
    if (declaration.fields.length || declaration.memberCoverage.length)
      failure('capability', 'HIR aggregate fields require their own tracer');
    if (!['value', 'component'].includes(declaration.category) || declaration.noInheritance !== true)
      failure('capability', 'HIR aggregate category or inheritance requires its own tracer');
    if (!Array.isArray(declaration.constructors) || declaration.constructors.length !== 1
        || declaration.constructors[0].kind !== 'implicitDefault')
      failure('capability', 'HIR aggregate constructors require the implicit default form');
    const original = declaration.constructors[0], symbol = definitions.get(declaration.symbol);
    if (original.parameters.length || original.body.length || original.parameterInitializers.length)
      failure('capability', 'HIR explicit constructor bodies or parameters require their own tracer');
    check(symbol?.kind === 'class' && symbol.type === declaration.id && symbol.name === declaration.name,
      'scope', 'HIR aggregate has no identical owned class symbol');
    check(!bySymbol.has(declaration.symbol) && !byConstructor.has(original.id),
      'identity', 'HIR aggregate registry repeats an identity');
    check(canonical(original.signature) === canonical({ parameters: [], returnType: declaration.id }),
      'type', 'HIR implicit constructor signature differs from its nominal owner');
    const identity = { kind: 'aggregate', source: { path: source.path, digest: source.hash },
      category: declaration.category, declarationPath: declaration.nominalKey.declarationPath };
    const id = exceptionHirIdentity('type', identity), signature = { parameters: [], returnType: id };
    const signatureHash = exceptionHirIdentity('signature', signature);
    const callableType = exceptionHirIdentity('type', { kind: 'callable', ...signature });
    const constructorId = exceptionHirIdentity('constructor', { owner: id, ordinal: 0, signatureHash });
    const constructor = { kind: 'implicitDefault', id: constructorId, owner: id, ordinal: 0,
      type: callableType, signatureHash, signatureDeclaration: null, implementation: null,
      parameters: [], parameterInitializers: [], body: [], range: original.range, bodyRange: null };
    // Nominal identity excludes mutable/derived metadata. All IDs are computed
    // first; full records contain IDs, so the resulting object graph has no cycle.
    check(types.aggregate(declaration.id, identity, { category: declaration.category, name: declaration.name,
      sourcePath: source.path, nameRange: symbol.range, range: declaration.range, bodyRange: declaration.bodyRange,
      nominalKey: declaration.nominalKey, markerOrigin: declaration.markerOrigin, noInheritance: true,
      fields: [], constructors: [constructor], memberCoverage: [] }) === id,
    'identity', 'HIR nominal type registration differs');
    check(types.callable([], id) === callableType, 'identity', 'HIR constructor callable identity differs');
    ids.push(id); bySymbol.set(declaration.symbol, { id, name: declaration.name });
    byConstructor.set(original.id, { id: constructorId, type: callableType, owner: id,
      rawOwner: declaration.id, signature: original.signature });
  }
  return {
    typeIds() { return [...ids]; },
    /** @param {string} symbol */
    ownsSymbol(symbol) { return bySymbol.has(symbol); },
    /** @param {any} value */
    projectConstruct(value) {
      const constructor = byConstructor.get(value.target);
      check(constructor && value.type === constructor.rawOwner, 'identity',
        'HIR construction has no owned nominal constructor');
      if (!Array.isArray(value.arguments) || value.arguments.length)
        failure('capability', 'HIR constructor arguments require their own tracer');
      check(canonical(value.signature) === canonical(constructor.signature),
        'type', 'HIR construction signature differs from its actual constructor');
      return { kind: 'construct', type: constructor.owner, range: value.range, constructorId: constructor.id,
        signature: { ownerKind: 'constructor', owner: constructor.id, type: constructor.type,
          presence: null, returnPresence: null }, arguments: [] };
    },
    /** @param {any} headers */
    coverage(headers) {
      const result = [];
      for (const item of raw.sourceCoverage) {
        let kind, target;
        if (item.kind === 'class') { kind = 'aggregate'; target = bySymbol.get(item.symbol); }
        else if (item.kind === 'function') { kind = 'function'; target = headers.get(item.symbol); }
        else failure('capability', 'HIR aggregate source coverage kind requires its own tracer');
        check(target && definitions.get(item.symbol)?.name === item.name,
          'scope', 'HIR coverage has no identical owned declaration');
        result.push({ kind, name: item.name, target: target.id, range: item.range, bodyRange: item.bodyRange });
      }
      return result;
    },
  };
}
