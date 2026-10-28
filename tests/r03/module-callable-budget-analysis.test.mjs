// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeModuleCalls,verifyHir} from '../../compiler/hir.mjs';
import {capture,publication,within,analysisLimit,assertPure} from './module-callable-budget-helpers.mjs';

// Counts below are structural formulae from the source graphs and declared
// domains. No private solver/meter is called and no limit is lowered.
test('public aggregation work: real current-body chain propagates 256 globals over adjacent chain lengths',async()=>{
 for(const edges of [86,87]){
  const {bundle,hir}=await capture('aggregation-work-'+edges),context=publication(bundle,hir),g=256;
  assert.equal(hir.globals.length,g);assert.equal(hir.functions.filter(f=>f.kind==='source').length,edges+1);
  const rounds=edges*(edges+3)/2,derived=g*rounds+edges*(edges+1),complete=(g+1)*rounds+edges*(edges+2)+g;
  assert.ok(g*(edges+2)+edges+1<65536,'members remain below their independent guard');
  console.log('TSFG_MODULE_CALLABLE_23D_BUDGET_FORMULA aggregation-work '+JSON.stringify({edges,derived,complete}));
  if(edges===86){assert.ok(complete<=1000000);const report=analyzeModuleCalls(hir,context);assert.equal(report.functions.length,87);const root=hir.closure.roots[0].target;assert.equal(report.functions.find(f=>f.functionId===root).derived.reads.length,g);within(report,'legal aggregation-work report');}
  else {assert.ok(derived>1000000);assert.throws(()=>analyzeModuleCalls(hir,context),analysisLimit);}
 }
});
test('public aggregation members: independent 62/63 callers consume the fixed 1024-global callee upper',async()=>{
 for(const callers of [62,63]){
  const {bundle,hir}=await capture('aggregation-members-'+callers),context=publication(bundle,hir),members=(callers+1)*1025;
  assert.equal(hir.globals.length,1024);assert.equal(hir.closure.roots.length,callers);
  console.log('TSFG_MODULE_CALLABLE_23D_BUDGET_FORMULA aggregation-members '+JSON.stringify({callers,members}));
  if(callers===62){assert.ok(members<=65536);const report=analyzeModuleCalls(hir,context);assert.equal(report.functions.length,63);for(const f of report.functions.filter(f=>f.functionId!==hir.functions.find(x=>x.name==='callee').id))assert.equal(f.effective.reads.length,1024);within(report,'legal aggregation-members report');}
  else {assert.ok(members>65536);assert.throws(()=>analyzeModuleCalls(hir,context),analysisLimit);}
 }
});
// Fixed root callable parameters already equal allowed Top: merging the root
// adds no growth; its first root observation adds one. Fixed total is 138.
test('public solver growth: unknown callback observes each of 124 finite arguments with four callback parameters cross 200k only at adjacent site',async()=>{
 for(const sites of [401,402]){
  const {bundle,hir}=await capture('solver-growth-top-'+sites),context=publication(bundle,hir),growth=138+498*sites;
  assert.equal(hir.functions.filter(f=>f.kind==='source').length,127);assert.equal(bundle.official.symbols,626);assert.equal(bundle.official.calls,sites+1);
  console.log('TSFG_MODULE_CALLABLE_23D_BUDGET_FORMULA solver-growth '+JSON.stringify({sites,growth}));
  if(sites===401){assert.ok(growth<=200000);const report=analyzeModuleCalls(hir,context);assert.equal(report.effectiveTargets.calls.length,402);assert.equal(report.functions.length,126);within(report,'legal solver-growth report');}
  else {assert.ok(growth>200000);assert.throws(()=>analyzeModuleCalls(hir,context),analysisLimit);}
 }
});
test('public solver work: finite 256-local loop reaches its actual state fixed point across the 1M work boundary',async()=>{
 // The official while body is one block statement; its step is charged in
 // each of the 256 iterations in addition to assignments, padding and joins.
 let previousDigest;
 for(const padding of [1567,1568]){
  const {bundle,hir}=await capture('solver-work-256-'+padding),context=publication(bundle,hir),work=197381+512*padding;
  assert.equal(bundle.official.symbols,260);assert.equal(bundle.official.calls,0);assert.equal(hir.functions.find(f=>f.name==='entry').body.filter(s=>s.kind==='local').length,256);
  if(previousDigest)assert.equal(context.expectedDigest,previousDigest,'padding changes body identity without republishing the fixed declared scope');previousDigest=context.expectedDigest;
  console.log('TSFG_MODULE_CALLABLE_23D_BUDGET_FORMULA solver-work '+JSON.stringify({padding,work}));
  if(padding===1567){assert.ok(work<=1000000);const report=analyzeModuleCalls(hir,context);assert.equal(report.functions.length,1);assertPure(report);within(report,'legal solver-work report');}
  else {assert.ok(work>1000000);assert.throws(()=>analyzeModuleCalls(hir,context),analysisLimit);}
 }
});
test('public typed HIR pool independently interns exactly 256 types and rejects the adjacent 257th',async()=>{
 const lower=await capture('types-256');assert.equal(lower.hir.types.length,256);verifyHir(lower.hir);
 const context=publication(lower.bundle,lower.hir);analyzeModuleCalls(lower.hir,context);
 const upper=await capture('types-257');assert.equal(upper.built.status,'error');
});
