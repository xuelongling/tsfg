// SPDX-License-Identifier: MIT
// Deterministic complete ordinary-call classification; trusted facts supply all occurrences.
const compare = (left,right) => Buffer.compare(Buffer.from(left),Buffer.from(right));
/** Partition a closed call graph, yielding each component after its callees.
 * @param {ReadonlyMap<string,ReadonlySet<string>>} targets
 * @param {()=>void} [charge] */
export function callComponentsInDependencyOrder(targets,charge=()=>{}) {
  const indices = new Map(), low = new Map(), active = new Set(), stack = [], components = [];
  const ordered = (left,right) => { charge(); return compare(left,right); };
  let next = 0;
  const enter = id => {
    charge();
    indices.set(id,next); low.set(id,next++); stack.push(id); active.add(id);
    return {id,edges:[...targets.get(id)].sort(ordered),nextEdge:0};
  };
  for (const root of targets.keys()) {
    charge();
    if (indices.has(root)) continue;
    const frames = [enter(root)];
    while (frames.length) {
      const frame = frames.at(-1), id = frame.id;
      if (frame.nextEdge < frame.edges.length) {
        charge();
        const target = frame.edges[frame.nextEdge++];
        if (!indices.has(target)) frames.push(enter(target));
        else if (active.has(target)) low.set(id,Math.min(low.get(id),indices.get(target)));
        continue;
      }
      frames.pop();
      const parent = frames.at(-1);
      if (parent) low.set(parent.id,Math.min(low.get(parent.id),low.get(id)));
      if (low.get(id) !== indices.get(id)) continue;
      const members = [];
      let member;
      do {
        charge(); member = stack.pop(); active.delete(member); members.push(member);
      } while (member !== id);
      members.sort(ordered);
      components.push({members,cyclic:members.length > 1 || targets.get(id).has(id)});
    }
  }
  return components;
}

/** Preserve the deterministic array component and work order.
 * @param {readonly string[]} functionIds
 * @param {readonly {caller:string,target:string}[]} occurrenceEdges */
export function classifyArrayCallGraph(functionIds,occurrenceEdges) {
  const targets = new Map(functionIds.map(id => [id,new Set()]));
  for (const edge of occurrenceEdges) targets.get(edge.caller).add(edge.target);
  const components = callComponentsInDependencyOrder(targets);
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
