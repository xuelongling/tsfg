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
    /** @param {string} name */
    value(name) {
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
