// SPDX-License-Identifier: MIT
import { canonical, sha256, scalarTypeIds } from './identity.mjs';
import { descriptor, hirSchemaHash, limits, check, failure } from './exception-hir-common.mjs';

/** @param {string} entity @param {any} record */
export function exceptionHirIdentity(entity, record) {
  const domains = /** @type {Record<string, string>} */ (descriptor.identity.domains);
  check(Object.hasOwn(domains, entity), 'identity', 'unknown HIR identity domain');
  return sha256(domains[entity] + '\0' + hirSchemaHash + '\0' + canonical(record));
}

// Tables remain private to one projection. Capacity is checked before insertion.
export function createExceptionHirTypes() {
  const entries = new Map();
  /** @param {any} record */
  function intern(record) {
    const id = record.kind === 'scalar' ? scalarTypeIds[record.name] : exceptionHirIdentity('type', record);
    if (!entries.has(id)) {
      check(entries.size < limits.derived.types, 'limit', 'HIR type table budget exceeded');
      entries.set(id, { id, ...record });
    }
    return id;
  }
  return {
    /** @param {string} name @param {any} [signature] @param {any} [presence] */
    value(name, signature = undefined, presence = undefined) {
      const mask = (presence?.undefined ? 1 : 0) | (presence?.null ? 2 : 0);
      if (presence?.optional || presence?.default)
        failure('capability', 'HIR optional/default values require their own tracer');
      if (mask) {
        if (name !== 'i32' || signature !== undefined || mask === 3)
          failure('capability', 'HIR nullable values currently require i32 with exactly one absence member');
        return intern({ kind: 'nullable', base: intern({ kind: 'scalar', name: 'i32' }), mask });
      }
      if (name === 'function') {
        if (presence !== undefined) failure('capability', 'HIR callable values require absent presence metadata');
        // A callable value describes a type, never an inferred runtime target.
        // The cold consumer currently owns only the exact nonnullable () => bool shape.
        if (!signature || Object.keys(signature).sort().join(',') !== 'parameters,returnType'
            || !Array.isArray(signature.parameters) || signature.parameters.length !== 0
            || signature.returnType !== 'bool')
          failure('capability', 'HIR callable values require a nonnullable zero-parameter bool signature');
        return intern({ kind: 'callable', parameters: [], returnType: intern({ kind: 'scalar', name: 'bool' }) });
      }
      if (signature !== undefined) failure('capability', 'HIR noncallable values cannot carry a callable signature');
      if (name === 'unknown') return intern({ kind: 'unknown' });
      if (!Object.hasOwn(scalarTypeIds, name)) failure('capability', 'HIR value type is not implemented: ' + name);
      return intern({ kind: 'scalar', name });
    },
    /** @param {string[]} parameters @param {string} returnType */
    callable(parameters, returnType) {
      check(parameters.length <= limits.derived.parametersPerFunction, 'limit', 'HIR signature parameter budget exceeded');
      check(parameters.every(id => entries.has(id)) && entries.has(returnType), 'type', 'HIR callable refers to an unowned type');
      return intern({ kind: 'callable', parameters, returnType });
    },
    records() {
      return [...entries.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    },
  };
}

export function createExceptionHirProjectionBudget() {
  let scopes = 0, bindings = 0;
  return {
    scope() {
      check(scopes < limits.derived.scopeCount, 'limit', 'HIR scope budget exceeded');
      scopes++;
    },
    binding() {
      check(bindings < limits.derived.bindings, 'limit', 'HIR binding budget exceeded');
      bindings++;
    },
  };
}
