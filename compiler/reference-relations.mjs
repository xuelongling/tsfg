// SPDX-License-Identifier: MIT
import { record, check, same, array } from './reference-common.mjs';
import { typeClass } from './reference-hierarchy.mjs';
export const sourceScalar = type => ['t:number','t:boolean','t:void'].includes(type);
export function referenceMembers(state, typeId) {
  const declaration = typeClass(state, typeId), lineage = [];
  for (let item = declaration; item; item = item.base ? state.classes.get(item.base) : null) lineage.push(item);
  const members = new Map();
  for (const item of lineage.reverse()) {
    for (const field of item.fields) members.set(field.symbol, field);
    for (const method of item.methods) {
      if (method.overrideTarget) members.delete(state.methods.get(method.overrideTarget).symbol);
      members.set(method.symbol, method);
    }
  }
  return members;
}
/** Validate explicit official edges; never derive assignability or a projection
 * from runtime keys, equal type IDs, matching names, field ordinals or layout.
 */
export function verifyReferenceWitness(state, value, sourceType, targetType, anchor) {
  record(value, ['assignable','members','origin','sourceType','targetType']);
  check(value.assignable === true && value.sourceType === sourceType && value.targetType === targetType
    && same(value.origin, anchor), 'witness', 'missing or inconsistent official conversion witness', anchor);
  array(value.members);
  if (sourceScalar(sourceType) || sourceScalar(targetType)) {
    check(sourceType === targetType && value.members.length === 0, 'witness'); return;
  }
  const source = referenceMembers(state, sourceType), target = referenceMembers(state, targetType), seen = new Set();
  let previous = '';
  for (const projection of value.members) {
    record(projection, ['source','target']);
    check(source.has(projection.source) && target.has(projection.target) && !seen.has(projection.target)
      && projection.target > previous, 'witness');
    const actual = state.symbols.get(projection.source), view = state.symbols.get(projection.target);
    // Names only cross-check an already explicit edge. They never create one.
    check(actual && view && actual.kind === view.kind && actual.name === view.name, 'witness');
    seen.add(projection.target); previous = projection.target;
  }
  check(seen.size === target.size, 'witness', 'official member projection is incomplete', anchor);
}
