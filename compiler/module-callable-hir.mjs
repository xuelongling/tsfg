// SPDX-License-Identifier: MIT
import {budget,check,same,own,canonical,format,validateShape} from './module-callable-common.mjs';
import {verifyModuleCallableSnapshot} from './module-callable-facts.mjs';
import {projectModuleCallable} from './module-callable-model.mjs';
export function buildModuleCallableHir(snapshot){
  const checked=verifyModuleCallableSnapshot(snapshot),hir=projectModuleCallable(checked);
  validateShape(hir,'hir');return own(JSON.parse(canonical(hir)));
}
export function verifyModuleCallableHir(hir){
  budget(hir);
  for(const [array,max]of [[hir?.functions,192],[hir?.types,256],[hir?.globals,4096],[hir?.modules,64]])if(Array.isArray(array))check(array.length<=max,'limit');
  let nodes=0;
  function count(value){
    if(!value||typeof value!=='object')return;
    if(typeof value.kind==='string')check(++nodes<=16384,'limit');
    for(const child of Object.values(value))if(Array.isArray(child))child.forEach(count);else if(child&&typeof child==='object')count(child);
  }
  for(const fn of Array.isArray(hir?.functions)?hir.functions:[]){if(Array.isArray(fn?.parameters))check(fn.parameters.length<=32,'limit');count(fn.body);}
  check(hir&&same(hir.format,format('tsfg.module-callable-hir-candidate')),'identity');
  // A partial semantic DTO must be a reconstruction mismatch, not a weaker partial verifier.
  const rebuilt=buildModuleCallableHir(hir.snapshot);
  check(same(hir,rebuilt),'reconstruct');return rebuilt;
}
