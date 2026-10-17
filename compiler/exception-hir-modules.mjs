// SPDX-License-Identifier: MIT
import { limits, check, failure } from './exception-hir-common.mjs';
import { exceptionHirIdentity } from './exception-hir-identity.mjs';

// Source/module ownership is private to one cold projection. All module IDs and
// implicit scopes exist before function headers, imports or closure targets.
/** @param {any} snapshot @param {any} budget */
export function createExceptionHirModules(snapshot, budget) {
  const { sources, exports: groups, facts, identityInput } = snapshot;
  const explicit = facts.modules !== undefined, bySource = new Map();
  check(Array.isArray(sources) && Array.isArray(groups), 'schema', 'HIR sources and exports must be arrays');
  check(sources.length <= limits.derived.files && groups.length <= limits.derived.files,
    'limit', 'HIR source budget exceeded');
  if (!explicit && (sources.length !== 1 || identityInput.compilationClosure !== undefined))
    failure('capability', 'HIR multi-source ownership requires actual module facts');
  if (explicit && facts.aggregateFacts !== undefined)
    failure('capability', 'aggregate and module HIR combinations require their own tracer');
  check(groups.length === sources.length && (!explicit || Array.isArray(facts.modules)
    && facts.modules.length === sources.length), 'source', 'HIR source/module coverage differs');
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index], group = groups[index], original = explicit ? facts.modules[index] : null;
    check(!bySource.has(source.path) && group.sourcePath === source.path,
      'source', 'HIR export group has foreign or repeated source ownership');
    if (original) {
      check(original.sourcePath === source.path && original.external === group.external,
        'source', 'HIR module differs from its actual export group');
      if (original.external !== true || !Array.isArray(original.globals) || original.globals.length)
        failure('capability', 'HIR global storage and script modules require their own tracer');
    }
    const id = exceptionHirIdentity('module', { source: { path: source.path, digest: source.hash }, external: group.external });
    budget.scope();
    const scope = exceptionHirIdentity('scope', { ownerKind: 'module', owner: id, path: [] });
    bySource.set(source.path, { source, group, original, id, scope, ownFunctions: new Map(), visible: new Map() });
  }
  // Per-function sourcePath is optional only in the verified single-source
  // facts format; explicit module facts always retain their defining path.
  for (const fn of facts.functions ?? []) {
    const sourcePath = fn.sourcePath ?? (explicit ? undefined : sources[0].path), module = bySource.get(sourcePath);
    check(module, 'source', 'HIR function has no defining source');
    if (fn.lexicalParent === undefined) {
      check(!module.ownFunctions.has(fn.name), 'scope', 'HIR top-level function spelling is repeated');
      module.ownFunctions.set(fn.name, fn.symbol); module.visible.set(fn.name, fn.symbol);
    }
  }
  if (explicit) for (const module of bySource.values()) {
    check(Array.isArray(module.original.imports) && module.original.imports.length <= limits.derived.arrayItems,
      'limit', 'HIR import array budget exceeded');
    for (const edge of module.original.imports) {
      const defining = bySource.get(edge.sourcePath);
      check(defining && edge.kind === 'import', 'source', 'HIR import has no actual defining module');
      check(Array.isArray(edge.bindings) && edge.bindings.length <= limits.derived.arrayItems,
        'limit', 'HIR import binding array budget exceeded');
      for (const binding of edge.bindings) {
        check(!module.visible.has(binding.name)
          && defining.group.bindings.some(/** @param {any} exported */ exported => exported.target === binding.target),
        'scope', 'HIR import target is unexported or its local spelling is repeated');
        module.visible.set(binding.name, binding.target);
      }
    }
  }
  return {
    explicit,
    /** @param {any} fn */
    forFunction(fn) {
      const module = bySource.get(fn.sourcePath ?? (explicit ? undefined : sources[0].path));
      check(module, 'source', 'HIR function has no defining module');
      return { id: module.id, scope: module.scope, sourcePath: module.source.path };
    },
    /** @param {string} sourcePath @param {any} value @param {any} target */
    authorizeCall(sourcePath, value, target) {
      const caller = bySource.get(sourcePath), defining = bySource.get(target.sourcePath);
      check(explicit && caller && defining && defining.id === target.module
        && caller.visible.get(value.name) === value.target,
      'scope', 'HIR call does not name an actual visible same-source or imported function');
    },
    /** @param {any} context */
    project(context) {
      const { headers, functions, projectInitialization, aggregates } = context, modules = [], exports = [];
      /** @param {any} root @param {any} module */
      function projectRoot(root, module) {
        let target;
        if (root.kind === 'module-initialization') {
          check(root.name === '$moduleInit', 'scope', 'HIR initialization root has a foreign name'); target = module.id;
        } else {
          const header = headers.get(module.ownFunctions.get(root.name));
          check(header && header.module === module.id, 'scope', 'HIR closure root has no actual same-source function');
          target = header.id;
        }
        return { kind: root.kind, sourcePath: root.sourcePath, name: root.name, target };
      }
      for (const module of bySource.values()) {
        const { source, group, original, id, scope } = module, bindings = [], imports = [];
        check(Array.isArray(group.bindings) && group.bindings.length <= limits.derived.arrayItems,
          'limit', 'HIR export array budget exceeded');
        for (const binding of group.bindings) {
          const target = headers.get(binding.target);
          check(target && target.module === id && binding.sourcePath === source.path,
            'scope', 'HIR export has no same-source function');
          bindings.push({ name: binding.name, target: target.id, sourcePath: binding.sourcePath,
            range: binding.range, definition: binding.definition });
        }
        if (original) for (const edge of original.imports) {
          const defining = bySource.get(edge.sourcePath), imported = [];
          for (const binding of edge.bindings) {
            const target = headers.get(binding.target);
            check(target && target.module === defining.id, 'scope', 'HIR import target has foreign defining ownership');
            imported.push({ name: binding.name, target: target.id, range: binding.range });
          }
          imports.push({ specifier: edge.specifier, sourcePath: edge.sourcePath,
            module: defining.id, range: edge.range, bindings: imported });
        }
        let closure = null;
        if (identityInput.compilationClosure !== undefined) {
          const raw = identityInput.compilationClosure;
          closure = { roots: raw.roots.filter(/** @param {any} root */ root => root.sourcePath === source.path)
            .map(/** @param {any} root */ root => projectRoot(root, module)),
          requiredRoots: raw.requiredRoots.filter(/** @param {any} root */ root => root.sourcePath === source.path)
            .map(/** @param {any} root */ root => projectRoot(root, module)) };
        }
        const initialization = original === null ? null : projectInitialization(original.initialization,
          { id, scope, sourcePath: source.path, range: { start: 0, end: source.content.length } });
        modules.push({ id, sourcePath: source.path, external: group.external,
          functions: functions.filter(/** @param {any} fn */ fn => fn.sourcePath === source.path)
            .map(/** @param {any} fn */ fn => fn.id),
          aggregateTypes: aggregates?.typeIds() ?? [], imports, globals: [], initialization, closure,
          coverage: aggregates?.coverage(headers) ?? null });
        exports.push({ module: id, sourcePath: source.path, external: group.external, bindings });
      }
      return { modules, exports };
    },
  };
}
