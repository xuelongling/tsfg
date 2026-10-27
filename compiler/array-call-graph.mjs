// SPDX-License-Identifier: MIT
// Deterministic complete ordinary-call classification; trusted facts supply all occurrences.
const compare = (left,right) => Buffer.compare(Buffer.from(left),Buffer.from(right));
/** No owner effects or work charges live in graph discovery.
 * @param {readonly string[]} functionIds
 * @param {readonly {caller:string,target:string}[]} occurrenceEdges */
export function classifyArrayCallGraph(functionIds,occurrenceEdges) {
  const targets = new Map(functionIds.map(id => [id,new Set()]));
  for (const edge of occurrenceEdges) targets.get(edge.caller).add(edge.target);
  const indices = new Map(), low = new Map(), active = new Set(), stack = [], components = [];
  let next = 0;
  const visit = id => {
    indices.set(id,next); low.set(id,next++); stack.push(id); active.add(id);
    for (const target of [...targets.get(id)].sort(compare)) {
      if (!indices.has(target)) { visit(target); low.set(id,Math.min(low.get(id),low.get(target))); }
      else if (active.has(target)) low.set(id,Math.min(low.get(id),indices.get(target)));
    }
    if (low.get(id) !== indices.get(id)) return;
    const members = [];
    let member;
    do { member = stack.pop(); active.delete(member); members.push(member); } while (member !== id);
    members.sort(compare);
    components.push({members,cyclic:members.length > 1 || targets.get(id).has(id)});
  };
  for (const id of functionIds) if (!indices.has(id)) visit(id);
  components.sort((left,right) => compare(left.members[0],right.members[0]));
  const componentOf = new Map();
  components.forEach((component,index) => component.members.forEach(id => componentOf.set(id,index)));
  const pending = components.map(() => new Set()), callers = components.map(() => new Set());
  for (const edge of occurrenceEdges) {
    const caller = componentOf.get(edge.caller), target = componentOf.get(edge.target);
    if (caller !== target) { pending[caller].add(target); callers[target].add(caller); }
  }
  const ready = components.flatMap((_,index) => pending[index].size ? [] : [index]), calleeFirst = [];
  while (ready.length) {
    ready.sort((left,right) => compare(components[left].members[0],components[right].members[0]));
    const complete = ready.shift(); calleeFirst.push(complete);
    for (const caller of callers[complete]) {
      pending[caller].delete(complete);
      if (!pending[caller].size) ready.push(caller);
    }
  }
  return Object.freeze({components:Object.freeze(components.map(component => Object.freeze({
    members:Object.freeze(component.members),cyclic:component.cyclic,
  }))),calleeFirst:Object.freeze(calleeFirst)});
}
