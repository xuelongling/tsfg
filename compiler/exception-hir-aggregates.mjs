// SPDX-License-Identifier: MIT
import { canonical, limits, check, failure } from './exception-hir-common.mjs';
import { exceptionHirIdentity } from './exception-hir-identity.mjs';
import { projectExceptionHirBoolean } from './exception-hir-regions.mjs';

// The cold snapshot owns declaration and marker proof. This registry translates
// nominal ownership, constructors and coverage without inspecting Source text.
/** @param {any} raw @param {any} definitions @param {any} source @param {any} types */
export function createExceptionHirAggregates(raw, definitions, source, types) {
  if (raw === undefined) return null;
  check(Array.isArray(raw.declarations) && raw.declarations.length <= limits.derived.types,
    'limit', 'HIR aggregate declaration budget exceeded');
  check(Array.isArray(raw.sourceCoverage) && raw.sourceCoverage.length <= limits.derived.arrayItems,
    'limit', 'HIR source coverage budget exceeded');
  const bySymbol = new Map(), byConstructor = new Map(), byField = new Map();
  /** @type {string[]} */
  const ids = [];
  for (const declaration of raw.declarations) {
    check(Array.isArray(declaration.fields) && Array.isArray(declaration.memberCoverage),
      'schema', 'HIR aggregate member tables are missing');
    check(declaration.fields.length <= limits.derived.arrayItems
      && declaration.memberCoverage.length <= limits.derived.arrayItems,
    'limit', 'HIR aggregate member budget exceeded');
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
    const fields = [], memberCoverage = [];
    for (const field of declaration.fields) {
      if (field.type !== 'bool' || field.initializer === null)
        failure('capability', 'HIR aggregate fields currently require a boolean initializer');
      check(fields.length === field.ordinal, 'identity', 'HIR field ordinal differs from declaration order');
      check(byField.size < limits.derived.bindings, 'limit', 'HIR field table budget exceeded');
      const definition = definitions.get(field.symbol);
      check(definition?.kind === 'field' && definition.type === field.type && definition.name === field.name,
        'scope', 'HIR field has no identical owned symbol');
      check(!byField.has(field.id) && !bySymbol.has(field.symbol),
        'identity', 'HIR field registry repeats an identity');
      const fieldId = exceptionHirIdentity('field', { owner: id, ordinal: field.ordinal });
      const projected = { id: fieldId, owner: id, ordinal: field.ordinal, name: field.name,
        nameRange: definition.range, type: types.value(field.type), readonly: field.readonly, access: field.access,
        optionalSyntax: field.optionalSyntax, definiteAssertionSyntax: field.definiteAssertionSyntax,
        initializer: projectExceptionHirBoolean(field.initializer, types), range: field.range };
      fields.push(projected); byField.set(field.id, { field: projected, rawOwner: declaration.id, rawSymbol: field.symbol });
      bySymbol.set(field.symbol, { id: fieldId, owner: id, name: field.name, kind: 'field' });
    }
    for (const item of declaration.memberCoverage) {
      if (item.kind !== 'KindPropertyDeclaration')
        failure('capability', 'HIR aggregate member coverage kind requires its own tracer');
      const target = bySymbol.get(item.symbol);
      check(target?.kind === 'field' && target.owner === id && target.name === item.name,
        'scope', 'HIR member coverage has no identical owned field');
      memberCoverage.push({ kind: 'field', name: item.name, target: target.id,
        range: item.range, bodyRange: item.bodyRange });
    }
    // Nominal identity excludes mutable/derived metadata. All IDs are computed
    // first; full records contain IDs, so the resulting object graph has no cycle.
    check(types.aggregate(declaration.id, identity, { category: declaration.category, name: declaration.name,
      sourcePath: source.path, nameRange: symbol.range, range: declaration.range, bodyRange: declaration.bodyRange,
      nominalKey: declaration.nominalKey, markerOrigin: declaration.markerOrigin, noInheritance: true,
      fields, constructors: [constructor], memberCoverage }) === id,
    'identity', 'HIR nominal type registration differs');
    check(types.callable([], id) === callableType, 'identity', 'HIR constructor callable identity differs');
    ids.push(id); bySymbol.set(declaration.symbol, { id, name: declaration.name });
    byConstructor.set(original.id, { id: constructorId, type: callableType, owner: id,
      rawOwner: declaration.id, signature: original.signature });
  }
  return {
    typeIds() { return [...ids]; },
    /** @param {any} value @param {any} receiver */
    projectField(value, receiver) {
      check(Array.isArray(value.fieldPath) && value.fieldPath.length > 0
        && value.fieldPath.length <= limits.derived.arrayItems, 'limit', 'HIR field path budget differs');
      let owner = receiver.type, last;
      const fieldPath = [];
      for (const rawId of value.fieldPath) {
        const entry = byField.get(rawId);
        check(entry && entry.field.owner === owner, 'identity', 'HIR field path crosses nominal ownership');
        if (entry.field.access !== 'public')
          failure('capability', 'HIR private field reads require their own tracer');
        fieldPath.push(entry.field.id); owner = entry.field.type; last = entry;
      }
      check(last && value.symbol === last.rawSymbol && types.value(value.type) === last.field.type,
        'type', 'HIR field read differs from its final owned member');
      const permission = value.permission;
      check(permission.readable === true && permission.constructorSelf === false
        && permission.writable === !last.field.readonly && permission.classRef === last.rawOwner,
      'type', 'HIR field permission differs from its final nominal owner');
      return { kind: 'fieldRead', type: last.field.type, range: value.range, receiver, fieldPath,
        permission: { readable: true, writable: !last.field.readonly, constructorSelf: false, owner: last.field.owner } };
    },
    /** @param {any} value @param {any} left @param {any} right */
    projectBinary(value, left, right) {
      if (value.type !== 'bool' || !['===', '!=='].includes(value.operator))
        failure('capability', 'HIR aggregate binary values require strict boolean equality');
      const type = types.value('bool');
      check(left.type === type && right.type === type, 'type', 'HIR binary operands must retain current boolean types');
      return { kind: 'binary', type, range: value.range, operator: value.operator, left, right };
    },
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
