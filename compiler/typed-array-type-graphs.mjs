// SPDX-License-Identifier: MIT
// Flat TypeId references are not bounded by JSON nesting. These two semantic
// walks use explicit stacks and the existing finite work ceiling, not host depth.
import {check} from './typed-array-schema.mjs';

export function checkTypedValueContainment(types,work=100000) {
  check(Number.isInteger(work)&&work>0&&work<=100000,'limit');
  const active=new Set(),complete=new Set();
  for(const root of types.keys()) {
    if(complete.has(root))continue;
    const pending=[{id:root,exit:false}];
    while(pending.length) {
      check(--work>=0,'limit');const row=pending.pop();
      if(row.exit){active.delete(row.id);complete.add(row.id);continue;}
      if(complete.has(row.id))continue;
      check(!active.has(row.id),'recursive-value');active.add(row.id);
      const type=types.get(row.id);check(type,'type');pending.push({id:row.id,exit:true});
      const children=type.kind==='union'?type.members:type.kind==='value'?type.fields.map(field=>field.type):[];
      for(let index=children.length-1;index>=0;index--) {
        check(--work>=0,'limit');pending.push({id:children[index],exit:false});
      }
    }
  }
}

export function typedReferenceWeights(classes,spend) {
  const weights=new Map();
  for(const root of classes.keys()) {
    const path=[],active=new Set();let current=root;
    while(current&&!weights.has(current)) {
      spend();check(!active.has(current),'inheritance');active.add(current);
      const type=classes.get(current);check(type,'compatibility');path.push(type);current=type.base;
    }
    while(path.length) {
      spend();const type=path.pop();
      weights.set(type.id,type.fields.length+type.methods.length+1+(type.base?weights.get(type.base):0));
    }
  }
  return weights;
}
