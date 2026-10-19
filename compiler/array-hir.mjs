// SPDX-License-Identifier: MIT
// One complete Array orchestration; public adapters never recursively verify each other.
import { canonical, own, readSpanTypeId } from './identity.mjs';
import { writeArrayFactsCandidate } from './array-facts.mjs';
import { arrayFactsLimits } from './array-facts-common.mjs';
import { copyGenericJsonBytes, readGenericJson } from './generic-json.mjs';
import { readArrayFactsContext, projectArrayFacts, checkArrayHirInput,
  matchArrayHir, arrayHirFailure } from './array-hir-model.mjs';
import { prepareArrayCalls } from './array-call-context.mjs';
import { deriveReadSpanPlan, consumeReadSpanPlan } from './array-readspan-model.mjs';

function completeProgram(hir, fixedContext, analysis) {
  checkArrayHirInput(hir);
  const views = hir.functions.some(fn => fn.body.some(stmt =>
    stmt.kind === 'local' && stmt.binding.type === readSpanTypeId));
  let prepared, readSpan;
  if (views || fixedContext !== undefined || analysis) {
    try { prepared = prepareArrayCalls(hir,fixedContext); }
    catch (error) {
      if (!analysis && ['r03-d-array-call-effects','r03-d-array-call-effects-identity'].includes(error.code))
        arrayHirFailure('context',error);
      throw error;
    }
  }
  if (views) {
    readSpan = deriveReadSpanPlan(hir,prepared);
    hir.readSpanPlan = readSpan.plan;
  }
  checkArrayHirInput(hir);
  return {hir:own(hir),prepared,readSpan};
}
function finishProgram(program) {
  if (program.readSpan) consumeReadSpanPlan(program.hir,program.prepared,program.readSpan.work);
  return program;
}
function prepareInput(hir, factsContext, fixedContext, analysis) {
  const {facts} = readArrayFactsContext(factsContext);
  checkArrayHirInput(hir);
  const expected = projectArrayFacts(facts);
  const {readSpanPlan,...base} = hir;
  matchArrayHir(base,expected);
  const result = completeProgram(expected,fixedContext,analysis);
  const bound = readSpanPlan?.publication, binding = result.hir.readSpanPlan?.publication;
  if (binding && bound && typeof bound === 'object'
    && /^sha256:[0-9a-f]{64}$/.test(bound.scopeDigest) && /^sha256:[0-9a-f]{64}$/.test(bound.publishedDigest)
    && (bound.scopeDigest !== binding.scopeDigest || bound.publishedDigest !== binding.publishedDigest))
    arrayHirFailure('context');
  matchArrayHir(hir,result.hir);
  return finishProgram(result);
}
export function verifySelectedArrayHir(hir, factsContext, fixedContext = undefined) {
  return prepareInput(hir,factsContext,fixedContext,false).hir;
}
/** Private complete preparation for the existing ArrayCalls report adapters. */
export function prepareArrayAnalysis(hir, factsContext, fixedContext) {
  return prepareInput(hir,factsContext,fixedContext,true);
}
export function buildArrayHir(input, factsContext, fixedContext = undefined) {
  try {
    const {bytes,facts} = readArrayFactsContext(factsContext);
    let supplied;
    try { supplied = writeArrayFactsCandidate(input); }
    catch (cause) { arrayHirFailure(cause?.code?.endsWith('-limit') ? 'limit' : 'invalid',cause); }
    if (!supplied.equals(bytes)) arrayHirFailure('context');
    const result = Object.freeze({status:'ok',hir:finishProgram(completeProgram(projectArrayFacts(facts),fixedContext,false)).hir});
    // Absent fields stay absent at runtime; keep the shared result union readable.
    return /** @type {typeof result & {readonly diagnostics?:undefined}} */ (result);
  } catch (error) {
    /** @type {any} */
    const diagnostic = {code:error.code ?? 'r03-array-hir-invalid',
      ruleId:error.ruleId ?? 'r01-input-boundary',phase:error.phase ?? 'hir',message:error.message};
    for (const key of ['primary','related','conflict','functionId','facet'])
      if (Object.hasOwn(error,key)) diagnostic[key] = error[key];
    const result = Object.freeze({status:'error',diagnostics:Object.freeze([own(diagnostic)])});
    return /** @type {typeof result & {readonly hir?:undefined}} */ (result);
  }
}
export function readArrayHir(bytes, factsContext, fixedContext = undefined) {
  readArrayFactsContext(factsContext);
  let input;
  try { input = readGenericJson(copyGenericJsonBytes(bytes,arrayFactsLimits),arrayFactsLimits); }
  catch (cause) {
    arrayHirFailure(cause?.code?.endsWith('-limit') ? 'limit'
      : cause?.code?.endsWith('-canonical') ? 'canonical' : 'invalid',cause);
  }
  const hir = verifySelectedArrayHir(input.value,factsContext,fixedContext);
  if (input.text !== canonical(hir) + '\n') arrayHirFailure('canonical');
  return hir;
}
