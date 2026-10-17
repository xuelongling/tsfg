// SPDX-License-Identifier: MIT
import { canonical } from './identity.mjs';
import { limits, check, failure } from './exception-hir-common.mjs';
import { exceptionHirIdentity } from './exception-hir-identity.mjs';

// The boundary supplies a cold-rebuilt snapshot. This module projects lexical
// ownership and current expressions; it does not reparse Source or infer flow.
/** @param {any} definitions @param {any} types @param {any} budget @param {Set<string>} claimed */
export function createExceptionHirRegions(definitions, types, budget, claimed) {
  /** @param {any} fn @param {any} header */
  function project(fn, header) {
    /** @param {any} parent @param {any[]} path @param {string} role @param {any} range */
    function region(parent, path, role, range) {
      check(path.length <= limits.derived.regionNesting, 'limit', 'HIR region nesting budget exceeded');
      budget.scope();
      return { parent, bySymbol: new Map(), ordinals: new Map(), node: {
        kind: 'region', role, scope: exceptionHirIdentity('scope', { ownerKind: 'function', owner: header.id, path }),
        parentScope: parent ? parent.node.scope : null, path, range, bindings: [], body: [],
      } };
    }
    /** @param {any} scope @param {any} raw @param {string} role */
    function bind(scope, raw, role) {
      const registered = definitions.get(raw.id);
      check(registered && canonical(registered) === canonical(raw), 'scope', 'HIR declaration has no identical owned symbol');
      check(!claimed.has(raw.id), 'scope', 'HIR binding is declared more than once');
      check(scope.node.bindings.length < limits.derived.arrayItems, 'limit', 'HIR region binding array budget exceeded');
      budget.binding();
      const index = scope.ordinals.get(role) ?? 0;
      const id = exceptionHirIdentity('binding', { ownerKind: 'function', owner: header.id,
        scopePath: scope.node.path, role, index });
      const binding = { id, name: raw.name, role, type: types.value(raw.type), writable: raw.writable,
        range: raw.range, presence: raw.presence ?? null };
      claimed.add(raw.id); scope.ordinals.set(role, index + 1); scope.bySymbol.set(raw.id, binding);
      scope.node.bindings.push(binding); return binding;
    }
    /** @param {any} scope @param {string} symbol */
    function resolve(scope, symbol) {
      for (let current = scope; current; current = current.parent) {
        const binding = current.bySymbol.get(symbol);
        if (binding) return binding;
      }
      failure('scope', 'HIR reference has no visible original binding');
    }
    /** @param {any} raw @param {any} scope */
    function expression(raw, scope) {
      check(raw && typeof raw === 'object', 'schema', 'HIR expression is missing');
      if (raw.kind !== 'reference') failure('capability', 'HIR expression kind is not implemented: ' + raw.kind);
      if (raw.presenceFlow !== undefined || raw.signature !== undefined)
        failure('capability', 'nullable or callable HIR references require their own tracer');
      const binding = resolve(scope, raw.symbol);
      return { kind: 'bindingRead', type: types.value(raw.type), range: raw.range, binding: binding.id, presenceFlow: null };
    }
    /** @param {any} parent @param {number} statement @param {string} slot @param {any} range */
    function child(parent, statement, slot, range) {
      check(parent.node.path.length < limits.derived.regionNesting, 'limit', 'HIR region nesting budget exceeded');
      return region(parent, [...parent.node.path, { statement, slot }], slot, range);
    }
    /** @param {any} items @param {any} scope */
    function body(items, scope) {
      check(Array.isArray(items), 'schema', 'HIR body must be an owned statement array');
      check(items.length <= limits.derived.arrayItems, 'limit', 'HIR body array budget exceeded');
      // Region declarations exist at scope entry, retaining source declaration
      // order; the strict snapshot already checked TDZ and initialization rules.
      for (const item of items) if (item.kind === 'variable') bind(scope, item.symbol, 'local');
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        check(scope.node.body.length < limits.derived.arrayItems, 'limit', 'HIR body array budget exceeded');
        if (item.kind === 'throw') {
          scope.node.body.push({ kind: 'throw', range: item.range, value: expression(item.expression, scope) });
        } else if (item.kind === 'variable') {
          const binding = scope.bySymbol.get(item.symbol.id);
          scope.node.body.push({ kind: 'local', range: item.range, binding: binding.id,
            initializer: expression(item.initializer, scope) });
        } else if (item.kind === 'try') {
          const fact = item.exception;
          check(fact && fact.tryBlock, 'schema', 'HIR try region is missing');
          check(fact.catchClause !== undefined || fact.finallyBlock !== undefined, 'schema', 'HIR try requires catch or finally');
          const attempted = child(scope, index, 'try', fact.tryBlock.range);
          body(fact.tryBlock.body, attempted);
          let caught = null, finalized = null;
          if (fact.catchClause !== undefined) {
            const raw = fact.catchClause, handled = child(scope, index, 'catch', raw.block.range);
            // Catch names belong to the clause header, outside the block range.
            // Preserve that raw name range rather than forcing block containment.
            const binding = raw.binding === undefined ? null : bind(handled, raw.binding, 'catch');
            body(raw.block.body, handled);
            caught = { range: raw.range, binding: binding?.id ?? null, declarationRange: raw.declarationRange ?? null,
              annotationRange: raw.annotationRange ?? null, region: handled.node };
          }
          if (fact.finallyBlock !== undefined) {
            const raw = fact.finallyBlock, final = child(scope, index, 'finally', raw.range);
            body(raw.body, final); finalized = final.node;
          }
          scope.node.body.push({ kind: 'try', range: item.range, tryRegion: attempted.node,
            catchClause: caught, finallyRegion: finalized });
        } else failure('capability', 'HIR statement kind is not implemented: ' + item.kind);
      }
    }
    const root = region(null, [], 'function', fn.range), parameters = [];
    for (const raw of fn.parameters) parameters.push(bind(root, raw, 'parameter').id);
    body(fn.body, root);
    return { id: header.id, module: header.module, sourcePath: header.sourcePath, name: fn.name,
      nameRange: header.nameRange, range: fn.range, type: header.type, signatureHash: header.signatureHash,
      lexicalParent: null, declaringScope: header.declaringScope, parameters,
      parameterInitializers: fn.parameterInitializers === undefined ? null : [...fn.parameterInitializers],
      captures: null, returnPresence: null, body: root.node };
  }
  return { project };
}
