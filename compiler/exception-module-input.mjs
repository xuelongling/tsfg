// SPDX-License-Identifier: MIT
import { normalizeClosure } from './modules.mjs';
import { check } from './exception-common.mjs';

// Reuse root tuple validation only. Every supplied TS is an actual Program root
// on Source's closure route, so no import-reachability pruning is permitted.
export function prepareExceptionModuleInput(input, supplied, profile) {
  if (!Object.hasOwn(input, 'compilationClosure')) return null;
  check(!profile.marker && !Object.hasOwn(input.declarations, 'markerProfile'), 'capability', 'aggregate/module combinations require a separate cold tracer');
  let closure;
  try { closure = normalizeClosure(input.compilationClosure); }
  catch { check(false, 'input', 'compilation closure root tuples differ'); }
  const sources = supplied.filter(file => !file.path.endsWith('.d.ts'));
  const sourcePaths = new Set(sources.map(file => file.path)), primary = input.sourceRoot + '/' + profile.primary;
  check(sources.length > 0 && sources.every(file => file.path.endsWith('.ts'))
    && supplied.length === sources.length + 1 && supplied.some(file => file.path === primary)
    && sourcePaths.has(input.rootFile), 'input', 'complete module source/declaration closure differs');
  const key = root => JSON.stringify([root.kind, root.sourcePath, root.name]);
  const roots = new Set(closure.roots.map(key));
  for (const root of [...closure.roots, ...closure.requiredRoots]) check(sourcePaths.has(root.sourcePath), 'input', 'closure root belongs to an unconsumed source');
  for (const root of closure.requiredRoots) check(roots.has(key(root)), 'input', 'required root is absent from embedding roots');
  return { closure };
}
