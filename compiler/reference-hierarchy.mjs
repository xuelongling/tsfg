// SPDX-License-Identifier: MIT
import { check } from './reference-common.mjs';
/** Ancestry follows explicit owned IDs, never a class/member spelling. */
export function ancestor(state, descendant, target) {
  const seen = new Set();
  while (descendant) {
    check(!seen.has(descendant), 'inheritance'); seen.add(descendant);
    if (descendant === target) return true;
    const item = state.classes.get(descendant); check(item, 'closure'); descendant = item.base;
  }
  return false;
}
export function typeClass(state, id) {
  const type = state.types.get(id);
  check(type && ['class-instance','class-this','class-this-view'].includes(type.kind), 'closure');
  const item = state.classes.get(type.declaration); check(item, 'closure'); return item;
}
function nearestInheritedMember(state, base, name) {
  while (base) {
    const declaration = state.classes.get(base); check(declaration, 'closure');
    const field = declaration.fields.find(member => member.name === name);
    if (field) return { kind: 'field', member: field };
    const method = declaration.methods.find(member => member.name === name);
    if (method) return { kind: 'method', member: method };
    base = declaration.base;
  }
  return null;
}
export function verifyReferenceHierarchy(state) {
  for (const item of state.classes.values()) {
    check(typeof item.base === 'string' && (!item.base || state.classes.has(item.base)), 'inheritance');
    let current = item.id; const seen = new Set();
    while (current) {
      check(!seen.has(current), 'inheritance', 'class inheritance is cyclic', item.origin);
      seen.add(current); const declaration = state.classes.get(current); check(declaration, 'closure'); current = declaration.base;
    }
    for (const method of item.methods) {
      const nearest = nearestInheritedMember(state, item.base, method.name);
      const overridable = nearest?.kind === 'method' && nearest.member.access !== 'private';
      // Names identify a lookup barrier only. A missing official edge is rejected,
      // never reconstructed. Private/non-method shadows do not create an edge,
      // and an explicit edge cannot jump past them to a more distant ancestor.
      check(overridable ? method.overrideTarget === nearest.member.id : method.overrideTarget === '', 'override',
        'owned method override edge is missing or differs from its nearest inherited member', method.origin);
      if (method.overrideTarget) {
        const target = state.methods.get(method.overrideTarget);
        check(target && target.owner !== item.id && ancestor(state, item.base, target.owner)
          && method.name === target.name && target.access !== 'private', 'override');
        // Official checking owns signature variance/accessibility compatibility.
        // This checks the supplied edge without imposing signature ID equality.
      }
    }
  }
  const views = [];
  for (const type of state.types.values()) if (type.kind === 'class-this-view') {
    const target = state.classes.get(type.declaration), argument = state.types.get(type.thisArgument);
    check(target && argument?.kind === 'class-this' && state.classes.has(argument.declaration)
      && type.target === target.instanceType && ancestor(state, argument.declaration, target.id)
      && type.id === target.id + '.this-view:' + type.thisArgument, 'closure');
    views.push(type.id);
  }
  return views;
}
