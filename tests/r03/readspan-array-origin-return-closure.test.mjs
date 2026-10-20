// SPDX-License-Identifier: MIT
// Independent closure gold predates output; no Source process or legacy helper migration runs here.
// Direct public seams keep this slice separate until the stopped legacy39 migration is qualified.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,
  verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { jcs,sha,fresh,wire,deeplyFrozen } from './array-test-fixtures.mjs';

/** @param {any} actual @param {any} expected @param {string} label */
function whole(actual,expected,label) {
  const a=jcs(actual),e=jcs(expected);
  assert.ok(a===e,label+'; actual sha256='+sha(a??'undefined')+' expected sha256='+sha(e??'undefined'));
}
/** @param {Buffer} actual @param {Buffer} expected @param {string} label */
function bytes(actual,expected,label) {
  assert.ok(actual.equals(expected),label+'; actual sha256='+sha(actual)+' expected sha256='+sha(expected));
}
/** @param {any} actual @param {string} expected @param {string} label */
function text(actual,expected,label) {
  assert.equal(typeof actual,'string');
  assert.ok(actual===expected,label+'; actual sha256='+sha(actual)+' expected sha256='+sha(expected));
}
const original=await readFile(new URL('./readspan-array-origin-return-closure-oracle.json',import.meta.url));
assert.equal(original.length,806245);
assert.equal(sha(original),'88f8fc8b79117f8cc941b2409dd12a70e9499ee7692aeb14565e0501cad750bc');
const frozen=JSON.parse(original.toString('utf8'));
assert.equal(frozen.family,'tsfg.m26d-independent-array-origin-closure-whole-oracle');
/** @type {any[]} */
const rows=frozen.cases;
whole(rows.map(row=>row.name),['tail-array-call-return-local-escape','reachable-forty-root-call-results'],
  'two complete independent closure cases');
const originalExpectations=jcs(frozen);

/** @param {any} pin @returns {Promise<Buffer>} */
async function readPin(pin) {
  assert.ok(pin&&typeof pin==='object');assert.equal(typeof pin.path,'string');
  assert.ok(/^(?:[A-Za-z]:[\\/]|\/)/.test(pin.path),'actual pin uses an absolute path');
  assert.ok(Number.isSafeInteger(pin.bytes)&&pin.bytes>0);assert.match(pin.sha256,/^[0-9a-f]{64}$/);
  const raw=await readFile(pin.path);assert.equal(raw.length,pin.bytes);assert.equal(sha(raw),pin.sha256);
  return raw;
}
const pin=JSON.parse(process.env.TSFG_READSPAN_ARRAY_RETURN_CLOSURE_SOURCE_MANIFEST??'null');
assert.ok(pin,'Root binds qualified actual Source bytes; this test never launches Source');
const manifest=JSON.parse((await readPin(pin)).toString('utf8'));
assert.ok(Array.isArray(manifest.cases));assert.equal(manifest.cases.length,2);
/** @type {Map<string,Buffer>} */
const actual=new Map();
for(const row of manifest.cases) {
  assert.ok(rows.some(expected=>expected.name===row.name));assert.ok(!actual.has(row.name));
  actual.set(row.name,await readPin(row.packet));
}
assert.equal(actual.size,2);

/** Negative candidates are complete independently authored input only, never successful partial output.
 * @param {any} row @param {Buffer} raw @returns {any} */
function stateFor(row,raw) {
  if(row.expectedDiagnostic) {
    assert.equal(row.completeHir,null);assert.equal(row.completeAnalysis,null);
    assert.equal(row.completeReadSpanPlan,null);assert.equal(row.completeFlow,null);
    assert.equal(row.counterfactualInput.status,'UNPUBLISHABLE_NEGATIVE_INPUT_ONLY_NOT_PARTIAL_SUCCESS');
  }
  const hir=fresh(row.completeHir??row.counterfactualInput.hir);
  const report=fresh(row.completeAnalysis??row.counterfactualInput.report);
  return {packet:JSON.parse(raw.toString('utf8')),hir,report,context:fresh(row.publicationContext),
    facts:{...fresh(row.factsContext),factsBytes:Buffer.from(raw)},hirBytes:wire(hir),reportBytes:wire(report)};
}
/** @param {any} state @returns {any} */
function snapshot(state) {
  const {factsBytes,...facts}=state.facts;
  return {values:jcs({packet:state.packet,hir:state.hir,report:state.report,context:state.context,facts}),
    factsBytes:Buffer.from(factsBytes),hirBytes:Buffer.from(state.hirBytes),reportBytes:Buffer.from(state.reportBytes)};
}
/** @param {any} state @param {any} before */
function unchanged(state,before) {
  const after=snapshot(state);text(after.values,before.values,'complete mutable inputs unchanged');
  for(const key of ['factsBytes','hirBytes','reportBytes'])bytes(after[key],before[key],key+' unchanged');
}
/** @param {()=>any} action @param {any} expected */
function rejects(action,expected) {
  /** @type {any} */
  let error;try{action();}catch(cause){error=cause;}
  assert.ok(error instanceof TypeError,'public boundary must reject with TypeError');
  /** @type {any} */
  const publicError=error;
  const dto={message:publicError.message,...Object.fromEntries(Object.keys(publicError).map(key=>[key,publicError[key]]))};
  whole(dto,expected,'complete public diagnostic');
}
/** @type {Record<string,(state:any)=>any>} */
const entries={
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
/** Actual public DTOs demonstrate a reachable40-root function, not an illegal41-root source.
 * @param {any} hir */
function fortyRootWitness(hir) {
  /** @type {any[]} */
  const functions=hir.functions;
  const entry=functions.find(fn=>fn.name==='entry');
  assert.ok(entry);assert.equal(entry.parameters.length,8);assert.equal(entry.body.length,34);
  assert.equal(entry.body.filter((/** @type {any} */ s)=>s.kind==='local').length,17);
  const plan=hir.readSpanPlan,body=plan.functions.find((/** @type {any} */ f)=>f.functionId===entry.id);
  assert.equal(body.views.length,40);assert.equal(body.events.length,64);assert.equal(plan.calls.length,32);
  for(let i=0;i<8;i++) {
    const view=body.views[i];assert.equal(view.origin.kind,'parameter');assert.equal(view.origin.index,i);
    assert.equal(view.binding,entry.parameters[i].id);assert.equal(view.lastUseEvent,null);
    assert.equal(view.useEvents.length,0);assert.equal(view.aliases.length,0);
  }
  const results=body.views.slice(8),owner=results[0].owner;
  assert.equal(results.length,32);assert.equal(new Set(results.map((/** @type {any} */ v)=>v.viewId)).size,32);
  for(let i=0;i<32;i++) {
    const view=results[i],create=body.events[view.origin.createEvent];
    assert.equal(view.origin.kind,'callResult');whole(view.owner,owner,'same backing owner, distinct families');
    assert.equal(view.useEvents.length,0);assert.equal(view.aliases.length,0);
    assert.equal(view.origin.createEvent,2*i+1);assert.equal(view.lastUseEvent,view.origin.createEvent);
    assert.equal(view.binding,i<16?entry.body[i+1].binding.id:null);
    assert.equal(create.kind,'view-call-result-create-complete');assert.equal(create.binding,view.binding);
    assert.equal(create.parameterIndex,0);assert.equal(create.viewId,view.viewId);
    whole(plan.calls[create.callIndex].expressionPath,
      ['body',i+1,i<16?'initializer':'expression'],'full sorted call-table join');
  }
  /** @type {any[]} */
  const states=plan.functions;
  const allViews=states.flatMap(state=>state.views);
  assert.equal(allViews.length,41);assert.equal(new Set(allViews.map(view=>view.viewId)).size,41);
  const uses=allViews.reduce((sum,view)=>sum+view.useEvents.length,0);
  assert.equal(uses,1);assert.equal(allViews.length+uses,42);
}
/** @param {any} row @param {string} name @param {()=>any} action */
function checkEntry(row,name,action) {
  if(row.expectedDiagnostic) {
    if(name==='buildHir') {
      const result=action();whole(result,{status:'error',diagnostics:[row.expectedDiagnostic]},
        'whole escape refusal without partial HIR/report');deeplyFrozen(result);
    }else rejects(action,row.expectedDiagnostic);
    return;
  }
  if(name==='lowerHir'){rejects(action,row.expectedLowerDiagnostic);return;}
  const result=action();
  if(name==='printHir')text(result,jcs(row.completeHir)+'\n','complete canonical HIR');
  else if(name==='printArrayCalls')text(result,jcs(row.completeAnalysis)+'\n','complete canonical report');
  else {
    const expected=name==='buildHir'?{status:'ok',hir:row.completeHir}:
      name.endsWith('ArrayCalls')?row.completeAnalysis:row.completeHir;
    whole(result,expected,'complete '+name);deeplyFrozen(result);
    if(name==='buildHir')fortyRootWitness(result.hir);
  }
}
for(const row of rows)test('26d closure actual complete facts and owned HIR8 projection: '+row.name,()=>{
  const raw=actual.get(row.name);assert.ok(raw);const before=Buffer.from(raw);
  bytes(raw,Buffer.from(row.packageText),'actual Source packet equals independent complete literal');
  const packet=readArrayFactsCandidate(raw);whole(packet,row.package,'complete owned facts');deeplyFrozen(packet);
  bytes(writeArrayFactsCandidate(packet),raw,'complete facts canonical roundtrip');
  whole(projectArrayFacts(packet),row.projectedHIR,'complete owned HIR8 projection');
  bytes(raw,before,'actual Source bytes unchanged');text(jcs(frozen),originalExpectations,'oracle unchanged');
});
for(const row of rows)test('26d call-return escape or reachable40 roots through nine public seams: '+row.name,async t=>{
  const raw=actual.get(row.name);assert.ok(raw);const before=Buffer.from(raw);
  for(const [name,action]of Object.entries(entries))await t.test(name,()=>{
    const state=stateFor(row,raw),captured=snapshot(state);
    checkEntry(row,name,()=>action(state));unchanged(state,captured);
    bytes(raw,before,'Root actual Source bytes unchanged');
  });
  text(jcs(frozen),originalExpectations,'independent closure oracle unchanged');
});
