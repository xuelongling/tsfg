// SPDX-License-Identifier: MIT
// Explicit selected cold boundary. No family guessing, AST access or execution.
import {isProxy} from 'node:util/types';
import {canonical,own} from './identity.mjs';
import {copyGenericJsonBytes,readGenericJson,checkGenericJsonValueBudget} from './generic-json.mjs';
import {typedArrayJsonPolicy as policy,check,hash} from './typed-array-schema.mjs';
import {readSelectedTypedArrayFacts,writeSelectedTypedArrayFacts} from './typed-array-facts.mjs';
import {projectTypedArrayFacts} from './typed-array-project.mjs';
import {optionalPropertyProfile as profile} from './optional-property-profile.mjs';
export {optionalPropertyFactsFormat,optionalPropertyHirFormat} from './optional-property-profile.mjs';

export const readOptionalPropertyFacts=bytes=>readSelectedTypedArrayFacts(bytes,profile);
export const writeOptionalPropertyFacts=value=>writeSelectedTypedArrayFacts(value,profile);
function context(value) {
  check(value&&typeof value==='object'&&!isProxy(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'context');
  const wanted=['family','version','factsBytes','expectedPackageId'],keys=Reflect.ownKeys(value);
  check(keys.length===wanted.length&&wanted.every(key=>keys.includes(key)),'context');
  const fields=Object.getOwnPropertyDescriptors(value);
  check(wanted.every(key=>fields[key].enumerable&&Object.hasOwn(fields[key],'value')),'context');
  const selected=Object.fromEntries(wanted.map(key=>[key,fields[key].value]));
  check(selected.family==='tsfg.optional-property-facts-context-candidate'&&selected.version===1,'context');
  hash(selected.expectedPackageId);
  const bytes=copyGenericJsonBytes(selected.factsBytes,policy),facts=readOptionalPropertyFacts(bytes);
  check(facts.packageId===selected.expectedPackageId,'context');return {bytes,facts};
}
function project(facts) {
  const hir=projectTypedArrayFacts(facts,profile);
  checkGenericJsonValueBudget(hir,policy);return hir;
}
export function buildOptionalPropertyHir(input,factsContext) {
  try {
    const selected=context(factsContext);
    check(writeOptionalPropertyFacts(input).equals(selected.bytes),'context');
    const result=Object.freeze({status:'ok',hir:own(project(selected.facts))});
    return /** @type {typeof result & {diagnostics?:undefined}} */(result);
  }catch(error) {
    const result=Object.freeze({status:'error',diagnostics:own([{code:error.code??'r03-typed-array-hir',
      ruleId:error.ruleId??'r01-input-boundary',phase:error.phase??'hir',message:error.message}])});
    return /** @type {typeof result & {hir?:undefined}} */(result);
  }
}
export function verifyOptionalPropertyHir(hir,factsContext) {
  const {facts}=context(factsContext);
  checkGenericJsonValueBudget(hir,policy);
  const expected=project(facts);check(canonical(hir)===canonical(expected),'hir-projection');return own(expected);
}
export function readOptionalPropertyHir(bytes,factsContext) {
  // Bind the selected source packet before walking any caller HIR graph.
  context(factsContext);
  const input=readGenericJson(copyGenericJsonBytes(bytes,policy),policy);
  const hir=verifyOptionalPropertyHir(input.value,factsContext);
  check(input.text===canonical(hir)+'\n','canonical');return hir;
}
export function writeOptionalPropertyHir(hir,factsContext) {
  return Buffer.from(canonical(verifyOptionalPropertyHir(hir,factsContext))+'\n');
}
