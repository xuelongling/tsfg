// SPDX-License-Identifier: MIT
// Selected M12 proof closure. Pair references inherit the original expression
// anchor; neither names nor runtime/layout identities supply missing edges.
import {canonical} from './identity.mjs';
import {byteOrder,check} from './typed-array-schema.mjs';

const pair=(source,target)=>canonical([source,target]);
const identity=proof=>canonical([proof.origin.source,proof.origin.start,proof.origin.end,proof.sourceType,proof.targetType]);
function order(left,right) {
  return byteOrder(left.origin.source,right.origin.source)||left.origin.start-right.origin.start
    ||left.origin.end-right.origin.end||byteOrder(left.sourceType,right.sourceType)||byteOrder(left.targetType,right.targetType);
}
export function typedArrayWitnesses(records,spend) {
  const directory=new Map(),reachable=new Set(),complete=new Set(),consumed=new Map();
  check(records.length<=100000,'limit');let previous;
  for(const record of records) {
    spend();const proof=record.compatibility,key=identity(proof);
    check(!previous||order(previous,proof)<0,'compatibility-order');previous=proof;
    const dependencies=new Map();let prior;
    for(const dependency of record.dependencies) {
      spend();check(!prior||byteOrder(prior.sourceType,dependency.sourceType)<0
        ||prior.sourceType===dependency.sourceType&&byteOrder(prior.targetType,dependency.targetType)<0,'compatibility-order');
      prior=dependency;dependencies.set(pair(dependency.sourceType,dependency.targetType),dependency);
    }
    directory.set(key,{proof,dependencies,missingOptionalProperties:record.missingOptionalProperties});consumed.set(key,new Set());
  }
  for(const {proof,dependencies} of directory.values())for(const dependency of dependencies.values()) {
    spend();check(directory.has(identity({...dependency,origin:proof.origin})),'compatibility-closure');
  }
  function select(root,anchor) {
    spend();const record=directory.get(identity({...root,origin:anchor}));
    check(record,'compatibility-root');
    return record;
  }
  function verify(record,validate) {
    // Validate each selected pair once with a worklist. Explicit cycle edges
    // do not recurse on the host stack or skip any member representation check.
    const pending=[record];
    while(pending.length) {
      spend();const current=pending.pop(),key=identity(current.proof);reachable.add(key);
      if(complete.has(key))continue;
      const choices=validate(current.proof,(sourceType,targetType)=>{
        spend();return current.dependencies.has(pair(sourceType,targetType));
      },current.missingOptionalProperties);
      for(const choice of choices.values()) {
        spend();const selected=pair(choice.sourceType,choice.targetType);consumed.get(key).add(selected);
        pending.push(directory.get(identity({...choice,origin:current.proof.origin})));
      }
      complete.add(key);
    }
    return true;
  }
  function finish() {
    check(reachable.size===directory.size,'compatibility-closure');
    for(const [key,record] of directory) {
      spend();check(consumed.get(key).size===record.dependencies.size,'compatibility-closure');
    }
  }
  return {select,verify,finish};
}
