// SPDX-License-Identifier: MIT
// Whole owned HIR is always reconstructed against a separately selected packet.
import {isProxy} from 'node:util/types';
import {canonical,own} from './identity.mjs';
import {copyGenericJsonBytes,readGenericJson,checkGenericJsonValueBudget} from './generic-json.mjs';
import {typedArrayJsonPolicy as policy,check,hash} from './typed-array-schema.mjs';
import {readTypedArrayFacts,writeTypedArrayFacts} from './typed-array-facts.mjs';
import {projectTypedArrayFacts} from './typed-array-project.mjs';
import {prepareArrayCalls,arrayCallFailure} from './array-call-context.mjs';
import {createArrayOwnerTools} from './array-owner-trace.mjs';
import {deriveReadSpanPlan,consumeReadSpanPlan} from './array-readspan-model.mjs';
import {arrayProgramShape} from './array-analysis-types.mjs';
import {classifyArrayCallGraph} from './array-call-graph.mjs';

export function isTypedArrayContext(value) {
  if(!value||typeof value!=='object'||isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const fields=Object.getOwnPropertyDescriptors(value);
  return fields.family?.value==='tsfg.array-facts-context-candidate';
}
function context(value) {
  check(value&&typeof value==='object'&&!isProxy(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'context');
  const keys=Reflect.ownKeys(value),wanted=['family','version','factsBytes','expectedPackageId'];
  check(keys.length===wanted.length&&wanted.every(key=>keys.includes(key)),'context');
  const fields=Object.getOwnPropertyDescriptors(value);
  check(wanted.every(key=>fields[key].enumerable&&Object.hasOwn(fields[key],'value')),'context');
  const selected=Object.fromEntries(wanted.map(key=>[key,fields[key].value]));
  check(selected.family==='tsfg.array-facts-context-candidate'&&selected.version===2,'context');hash(selected.expectedPackageId);
  const bytes=copyGenericJsonBytes(selected.factsBytes,policy),facts=readTypedArrayFacts(bytes);
  check(facts.packageId===selected.expectedPackageId,'context');return {bytes,facts};
}
function prepare(facts,publicationContext,analysis=false) {
  let work=0;const tools=createArrayOwnerTools(()=>{if(++work>16384)arrayCallFailure('limit');});
  const hir=projectTypedArrayFacts(facts),shape=arrayProgramShape(hir,tools.charge);
  const graph=classifyArrayCallGraph(shape.callables.map(fn=>fn.id),shape.occurrences);
  const cyclic=graph.components.some(row=>row.cyclic);
  let prepared,readSpan;
  if(shape.views||cyclic||publicationContext!==undefined||analysis)prepared=prepareArrayCalls(hir,publicationContext,tools,shape.authority);
  if(shape.views){readSpan=deriveReadSpanPlan(hir,prepared);hir.readSpanPlan=readSpan.plan;}
  checkGenericJsonValueBudget(hir,policy);return {hir,prepared,readSpan};
}
function finish(program) {
  if(program.readSpan)consumeReadSpanPlan(program.hir,program.prepared,program.readSpan.work);
  return {...program,hir:own(program.hir)};
}
export function prepareTypedArrayAnalysis(hir,factsContext,publicationContext) {
  return verifyProgram(hir,factsContext,publicationContext,true);
}
function verifyProgram(hir,factsContext,publicationContext,analysis=false) {
  const {facts}=context(factsContext);
  checkGenericJsonValueBudget(hir,policy);
  const program=prepare(facts,publicationContext,analysis);
  check(canonical(hir)===canonical(program.hir),'hir-projection');return finish(program);
}
export function verifyTypedArrayHir(hir,factsContext,publicationContext=undefined) {
  return verifyProgram(hir,factsContext,publicationContext).hir;
}
export function buildTypedArrayHir(input,factsContext,publicationContext=undefined) {
  try {
    const {bytes,facts}=context(factsContext);
    check(writeTypedArrayFacts(input).equals(bytes),'context');
    const result=Object.freeze({status:'ok',hir:finish(prepare(facts,publicationContext)).hir});
    return /** @type {typeof result & {diagnostics?:undefined}} */(result);
  }catch(error) {
    const result=Object.freeze({status:'error',diagnostics:own([{code:error.code??'r03-typed-array-hir',
      ruleId:error.ruleId??'r01-input-boundary',phase:error.phase??'hir',message:error.message,
      ...Object.fromEntries(['primary','related','conflict','functionId','facet'].filter(key=>Object.hasOwn(error,key)).map(key=>[key,error[key]]))}])});
    return /** @type {typeof result & {hir?:undefined}} */(result);
  }
}
export function readTypedArrayHir(bytes,factsContext,publicationContext=undefined) {
  const input=readGenericJson(copyGenericJsonBytes(bytes,policy),policy);
  const hir=verifyTypedArrayHir(input.value,factsContext,publicationContext);
  check(input.text===canonical(hir)+'\n','canonical');return hir;
}
