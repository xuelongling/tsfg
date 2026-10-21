// SPDX-License-Identifier: MIT
// Test-owned data and complete comparisons; no expected value comes from a producer.
import assert from 'node:assert/strict';
import { expectedArrayCore13 } from './array-core13-literal.mjs';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { prepareArrayCalls } from '../../compiler/array-call-context.mjs';
import { deriveReadSpanPlan } from '../../compiler/array-readspan-model.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,
  verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { jcs,sha,fresh,wire,deeplyFrozen } from './array-test-fixtures.mjs';
export { jcs,sha,fresh,wire,deeplyFrozen };
/** Pretty independent containers are not wire frames. @param {any} pin @returns {Promise<any>} */
export async function oracle(pin) {
  const bytes=await readFile(new URL(pin.file,import.meta.url));
  assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
  return JSON.parse(bytes.toString('utf8'));
}
/** Root binds existing qualified actual manifests; this helper never launches Source.
 * @returns {Promise<Map<string,Buffer>>} */
export async function actualPackets() {
  const pins=JSON.parse(process.env.TSFG_READSPAN_RETURN_SOURCE_MANIFESTS??'null');
  assert.ok(Array.isArray(pins)&&pins.length>0,'Root must bind final-identity actual Source manifests');
  const packets=new Map();
  for(const pin of pins) {
    const bytes=await readFile(pin.path);assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
    const manifest=JSON.parse(bytes.toString('utf8'));assert.ok(Array.isArray(manifest.cases));
    for(const row of manifest.cases) {
      const name=row.name??row.id,record=row.packet;
      assert.equal(typeof name,'string');assert.ok(record);assert.ok(!packets.has(name),'duplicate actual '+name);
      const raw=await readFile(record.path);assert.equal(raw.length,record.bytes);assert.equal(sha(raw),record.sha256);
      packets.set(name,raw);
    }
  }
  return packets;
}
/** @param {any} row @returns {any} */
export function expectedBase(row) {
  if(row.projectedHIR)return fresh(row.projectedHIR);
  const hir=fresh(row.completeHir);delete hir.readSpanPlan;return hir;
}
/** Capture the complete own public diagnostic, not stack. @param {any} error */
export const dto=error=>({message:error.message,...Object.fromEntries(Object.keys(error).map(k=>[k,error[k]]))});
/** @param {()=>any} action @param {any} expected */
export function rejects(action,expected) {
  let error;try{action();}catch(cause){error=cause;}
  assert.ok(error instanceof TypeError,'the exact public boundary must refuse');assert.deepEqual(dto(error),expected);
}
/** Facts, projection, fixed identity and flow are compared before a plan is constructed.
 * @param {any} row @param {Buffer} raw */
export function upstream(row,raw) {
  assert.deepEqual(raw,Buffer.from(row.packageText),'actual Source bytes equal independent complete facts');
  const packet=readArrayFactsCandidate(raw);assert.deepEqual(packet,row.package??JSON.parse(row.packageText));
  assert.deepEqual(writeArrayFactsCandidate(packet),raw);deeplyFrozen(packet);
  const base=projectArrayFacts(packet);assert.deepEqual(base,expectedBase(row));
  const context=row.publicationContext;
  const scopeDigest='sha256:'+sha('tsfg.array-call-scope.v4\0'+jcs(row.scope));
  assert.equal(context.scopeDigest,scopeDigest);
  for(const {digest,...body} of context.contracts)
    assert.equal(digest,'sha256:'+sha('tsfg.array-published-contract.v4\0'+jcs(body)));
  assert.equal(context.expectedDigest,'sha256:'+sha('tsfg.array-publication.v4\0'
    +jcs({scopeDigest,contracts:context.contracts})));
  if(row.completeFlow===null) {rejects(()=>prepareArrayCalls(base,fresh(context)),row.expectedDiagnostic);return;}
  const prepared=prepareArrayCalls(base,fresh(context));assert.deepEqual(prepared.flow,row.completeFlow);
  assert.deepEqual([...prepared.records.values()],context.contracts);
  assert.equal(prepared.scopeDigest,scopeDigest);assert.equal(prepared.publishedDigest,context.expectedDigest);
  if(!row.completeReadSpanPlan) {
    assert.equal(row.completeHir,null);rejects(()=>deriveReadSpanPlan(base,prepared),row.expectedDiagnostic);return;
  }
  const result=deriveReadSpanPlan(base,prepared);assert.deepEqual(result.plan,row.completeReadSpanPlan);
  assert.equal(result.work,row.work.viewGlobal);
  assert.deepEqual({...base,readSpanPlan:result.plan},row.completeHir);
}
/** @param {any} row @param {Buffer} raw @param {any} [synthetic] @returns {any} */
export function stateFor(row,raw,synthetic=undefined) {
  const hir=fresh(synthetic?.hir??row.completeHir??row.projectedHIR);
  const report=fresh(synthetic?.report??row.completeAnalysis??{});
  return {packet:JSON.parse(raw.toString('utf8')),hir,report,context:fresh(row.publicationContext),
    facts:{...fresh(row.factsContext),factsBytes:Buffer.from(raw)},hirBytes:wire(hir),reportBytes:wire(report)};
}
/** Avoid serializing byte buffers as million-key objects. @param {any} state @returns {any} */
export function captureState(state) {
  const {factsBytes,...facts}=state.facts;
  return {values:jcs({packet:state.packet,hir:state.hir,report:state.report,context:state.context,facts}),
    factsBytes:Buffer.from(factsBytes),hirBytes:Buffer.from(state.hirBytes),reportBytes:Buffer.from(state.reportBytes)};
}
/** @param {any} state @param {any} before */
export function unchangedState(state,before) {
  const after=captureState(state);assert.equal(after.values,before.values);
  for(const key of ['factsBytes','hirBytes','reportBytes'])assert.deepEqual(after[key],before[key]);
}
/** @type {Record<string,(state:any)=>any>} */
export const entries={
  buildHir:s=>buildHir(s.packet,s.facts,s.context),
  verifyHir:s=>verifyHir(s.hir,s.facts,s.context),
  printHir:s=>printHir(s.hir,s.facts,s.context),
  readHir:s=>readHir(s.hirBytes,s.facts,s.context),
  lowerHir:s=>lowerHir(s.hir,s.facts,s.context),
  analyzeArrayCalls:s=>analyzeArrayCalls(s.hir,s.facts,s.context),
  verifyArrayCalls:s=>verifyArrayCalls(s.report,s.hir,s.facts,s.context),
  printArrayCalls:s=>printArrayCalls(s.report,s.hir,s.facts,s.context),
  readArrayCalls:s=>readArrayCalls(s.reportBytes,s.hir,s.facts,s.context),
};
/** @param {any} row @param {string} entry @param {()=>any} action @param {any} state */
export function checkEntry(row,entry,action,state) {
  if(row.expectedDiagnostic) {
    // The fixed contract maps identity failures only at HIR seams; ArrayCalls keeps its own DTO.
    const expected=row.expectedDiagnostic.code==='r03-d-array-call-effects-identity'
      && ['buildHir','verifyHir','printHir','readHir','lowerHir'].includes(entry)
      ? {code:'r03-array-hir-context',ruleId:'r01-input-boundary',phase:'hir',
        message:'r03-array-hir-context: invalid selected Array HIR'} : row.expectedDiagnostic;
    if(entry==='buildHir') {
      const result=action();assert.deepEqual(result,{status:'error',diagnostics:[expected]});deeplyFrozen(result);
    }else rejects(action,expected);
    return;
  }
  if(entry==='lowerHir') {
    assert.equal(action(),expectedArrayCore13(state.hir,state.facts,state.context));return;
  }
  const expected=entry==='buildHir'?{status:'ok',hir:row.completeHir}:
    entry==='printHir'?jcs(row.completeHir)+'\n':entry==='printArrayCalls'?jcs(row.completeAnalysis)+'\n':
    entry.endsWith('ArrayCalls')?row.completeAnalysis:row.completeHir;
  const result=action();assert.deepEqual(result,expected);deeplyFrozen(result);
}
