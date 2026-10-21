// SPDX-License-Identifier: MIT
// Exact bounded whole comparisons keep failure logs small; every expected value predates SUT output.
import assert from 'node:assert/strict';
import { expectedArrayCore13 } from './array-core13-literal.mjs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,
  verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { jcs,sha,fresh,wire,deeplyFrozen } from './array-test-fixtures.mjs';

/** @param {any} actual @param {any} expected @param {string} label */
function equalWhole(actual,expected,label) {
  const a=jcs(actual),e=jcs(expected);
  assert.ok(a===e,label+'; actual sha256='+sha(a??'undefined')+' expected sha256='+sha(e??'undefined'));
}
/** @param {Buffer} actual @param {Buffer} expected @param {string} label */
function equalBytes(actual,expected,label) {
  assert.ok(actual.equals(expected),label+'; actual sha256='+sha(actual)+' expected sha256='+sha(expected));
}
/** @param {any} actual @param {string} expected @param {string} label */
function equalText(actual,expected,label) {
  assert.equal(typeof actual,'string');
  assert.ok(actual===expected,label+'; actual sha256='+sha(actual)+' expected sha256='+sha(expected));
}
const original=await readFile(new URL('./readspan-array-origin-return-global-budget-oracle.json',import.meta.url));
assert.equal(original.length,6577625);
assert.equal(sha(original),'a44edaf98c6a88058331e1d618ce8fc85faa900130febb03fdc7a45f8657ac7a');
const frozen=JSON.parse(original.toString('utf8'));
assert.equal(frozen.family,'tsfg.m26d-independent-global-bound-whole-oracle');
/** @type {any[]} */
const rows=frozen.cases;
equalWhole(rows.map(row=>row.name),['global1024','global1025'],'two independent boundary cases');
const originalExpectations=jcs(frozen);

/** @param {any} pin @returns {Promise<Buffer>} */
async function readPin(pin) {
  assert.ok(pin&&typeof pin==='object');assert.equal(typeof pin.path,'string');
  assert.ok(/^(?:[A-Za-z]:[\\/]|\/)/.test(pin.path),'actual pin uses an absolute path');
  assert.ok(Number.isSafeInteger(pin.bytes)&&pin.bytes>0);assert.match(pin.sha256,/^[0-9a-f]{64}$/);
  const bytes=await readFile(pin.path);assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
  return bytes;
}
const pin=JSON.parse(process.env.TSFG_READSPAN_ARRAY_RETURN_BUDGET_SOURCE_MANIFEST??'null');
assert.ok(pin,'Root binds one qualified actual Source manifest; this test never launches Source');
const manifest=JSON.parse((await readPin(pin)).toString('utf8'));
assert.ok(Array.isArray(manifest.cases));assert.equal(manifest.cases.length,2);
/** @type {Map<string,Buffer>} */
const actual=new Map();
for(const row of manifest.cases) {
  assert.ok(rows.some(expected=>expected.name===row.name));assert.ok(!actual.has(row.name));
  actual.set(row.name,await readPin(row.packet));
}
assert.equal(actual.size,2);

/** Upper counterfactual values are cold inputs only, never expected publications.
 * @param {any} row @param {Buffer} raw @returns {any} */
function stateFor(row,raw) {
  const synthetic=row.counterfactual;
  if(synthetic) {
    assert.equal(synthetic.status,'SYNTHETIC_COMPLETE_INPUT_ONLY_NEVER_EXPECTED_PUBLISHED_HIR_OR_REPORT');
    assert.equal(row.completeHir,null);assert.equal(row.completeAnalysis,null);
    assert.equal(synthetic.expectedPublishedHIR,null);assert.equal(synthetic.expectedPublishedAnalysis,null);
  }
  const hir=fresh(synthetic?.hir??row.completeHir),report=fresh(synthetic?.report??row.completeAnalysis);
  return {packet:JSON.parse(raw.toString('utf8')),hir,report,context:fresh(row.publicationContext),
    facts:{...fresh(row.factsContext),factsBytes:Buffer.from(raw)},hirBytes:wire(hir),reportBytes:wire(report)};
}
/** @param {any} state */
function snapshot(state) {
  const {factsBytes,...facts}=state.facts;
  return {text:jcs({packet:state.packet,hir:state.hir,report:state.report,context:state.context,facts}),
    factsBytes:Buffer.from(factsBytes),hirBytes:Buffer.from(state.hirBytes),reportBytes:Buffer.from(state.reportBytes)};
}
/** @param {any} state @param {any} before */
function unchanged(state,before) {
  const after=snapshot(state);equalText(after.text,before.text,'complete mutable inputs unchanged');
  for(const field of ['factsBytes','hirBytes','reportBytes'])equalBytes(after[field],before[field],field+' unchanged');
}
/** @param {()=>any} action @param {any} expected */
function rejects(action,expected) {
  /** @type {any} */
  let error;try{action();}catch(cause){error=cause;}
  assert.ok(error instanceof TypeError,'public boundary must reject with TypeError');
  /** @type {any} */
  const publicError=error;
  const dto={message:publicError.message,...Object.fromEntries(Object.keys(publicError).map(key=>[key,publicError[key]]))};
  equalWhole(dto,expected,'complete public diagnostic');
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
/** This fixture has unique formal slots and no aliases, so its public root/use rows are the fee ledger.
 * @param {any} hir */
function inclusivePlan(hir) {
  /** @type {any[]} */
  const functions=hir.readSpanPlan.functions;
  const views=functions.flatMap(fn=>fn.views);
  const uses=views.reduce((sum,view)=>sum+view.useEvents.length,0);
  assert.equal(views.length,171);assert.equal(uses,853);assert.equal(views.length+uses,1024);
  assert.ok(views.every(view=>view.aliases.length===0));
}
/** @param {any} row @param {string} name @param {()=>any} action @param {any} state */
function checkEntry(row,name,action,state) {
  if(row.expectedDiagnostic) {
    if(name==='buildHir') {
      const result=action();equalWhole(result,{status:'error',diagnostics:[row.expectedDiagnostic]},'no partial upper publication');
      deeplyFrozen(result);
    }else rejects(action,row.expectedDiagnostic);
    return;
  }
  if(name==='lowerHir'){assert.equal(action(),expectedArrayCore13(state.hir,state.facts,state.context));return;}
  const result=action();
  if(name==='printHir')equalText(result,jcs(row.completeHir)+'\n','complete canonical HIR');
  else if(name==='printArrayCalls')equalText(result,jcs(row.completeAnalysis)+'\n','complete canonical report');
  else {
    const expected=name==='buildHir'?{status:'ok',hir:row.completeHir}:
      name.endsWith('ArrayCalls')?row.completeAnalysis:row.completeHir;
    equalWhole(result,expected,'complete '+name);deeplyFrozen(result);
    if(name==='buildHir')inclusivePlan(result.hir);
  }
}

for(const row of rows)test('26d global boundary actual whole facts and owned HIR8 projection: '+row.name,()=>{
  const raw=actual.get(row.name);assert.ok(raw);const before=Buffer.from(raw);
  equalBytes(raw,Buffer.from(row.packageText),'actual Source packet equals independent complete literal');
  const packet=readArrayFactsCandidate(raw);equalWhole(packet,row.package,'complete owned facts');deeplyFrozen(packet);
  equalBytes(writeArrayFactsCandidate(packet),raw,'complete facts read/write roundtrip');
  equalWhole(projectArrayFacts(packet),row.projectedHIR,'complete owned projection');
  equalBytes(raw,before,'actual Source bytes unchanged');equalText(jcs(frozen),originalExpectations,'oracle unchanged');
});
for(const row of rows)test('26d inclusive1024 or exact1025 refusal through nine public seams: '+row.name,async t=>{
  const raw=actual.get(row.name);assert.ok(raw);const before=Buffer.from(raw);
  for(const [name,action]of Object.entries(entries))await t.test(name,()=>{
    const state=stateFor(row,raw),captured=snapshot(state);
    checkEntry(row,name,()=>action(state),state);unchanged(state,captured);
    equalBytes(raw,before,'original actual Source bytes unchanged');
  });
  equalText(jcs(frozen),originalExpectations,'independent whole oracle unchanged');
});
