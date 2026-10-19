// SPDX-License-Identifier: MIT
// Whole expectations and hostile controls were frozen independently before Product5 output.
// Root owns official Source proof and execution; this suite never produces expected packets.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { buildHir,verifyHir,printHir,readHir,lowerHir,analyzeArrayCalls,
  verifyArrayCalls,printArrayCalls,readArrayCalls } from '../../compiler/hir.mjs';
import { pinned,jcs,sha,fresh,wire,deeplyFrozen } from './array-test-fixtures.mjs';

// The preserved corrected FIRST container is pretty JSON; its embedded wire texts are canonical.
const firstBytes=await readFile(new URL('./readspan-parameters-first-oracle.json',import.meta.url));
assert.equal(firstBytes.length,160231);
assert.equal(sha(firstBytes),'d284772f1f5e5893fa93419c3cbb0dae1c9b4940acb975341fb22c0e7db449d4');
const first=JSON.parse(firstBytes.toString());
const adjacent=await pinned('./readspan-parameters-adjacent-oracle.json',714878,
  'b5c94447410b6f3dbaef0a9d09fda73b5439739f514dade4c1b8226eff3ba4c7');
const controls=await pinned('./readspan-parameters-cold-oracle.json',252806,
  'cce245399cb570c5736086f3534dd55e8f8cb00b568707713c03fc63f678db50');
const official=await pinned('./readspan-parameters-official-crosscheck.json',15590,
  '5478d8d5740c9541ee52ef1c861f52cdfe781d7515f1391f2f03fc419409bb30');
assert.equal(first.cases.length,2);assert.equal(adjacent.cases.length,16);
const adjacentProduct=adjacent.cases.filter(row=>row.hir!==undefined);
const sourceNegative=adjacent.cases.filter(row=>row.hir===undefined);
assert.equal(adjacentProduct.length,12);assert.equal(sourceNegative.length,4);
assert.equal(adjacent.contextOnlyControls.length,2);
assert.deepEqual(sourceNegative.map(row=>row.id),[
  'nominal-array-as-view','nominal-const-annotation-from-array',
  'explicit-view-u32-rejected','optional-view-parameter-rejected',
]);
for(const row of sourceNegative){
  assert.equal(row.expectedOutcome,'not-reached-source-capability');
  assert.equal(row.expectedFactsWrites,0);assert.equal(row.selectedPacketConstructed,false);
  assert.equal(row.sourceExpected.outcome,'capability');
  assert.equal(row.sourceExpected.expectedFactsWrites,0);
  assert.equal(row.expectedSourceError.code,'r03-array-facts-capability');
  assert.equal(row.expectedSourceError.phase,'capability');
  for(const field of ['hir','packageText','factsContext','context','expectedReport'])
    assert.equal(Object.hasOwn(row,field),false);
}
assert.equal(controls.coldMutants.length,5);assert.equal(controls.contextMutants.length,4);
/** @param {any} row @returns {any} */
const normalized=row=>{
  assert.ok(row.hir);assert.equal(typeof row.packageText,'string');
  return {...row,id:row.id??row.name,analysis:row.analysis??row.expectedReport,
    coreDiagnostic:row.expectedCoreDiagnostic??row.core?.expectedDiagnostic};
};
const cases=[...first.cases,...adjacentProduct,...adjacent.contextOnlyControls].map(normalized);
assert.equal(cases.length,16);
/** @param {string} id @returns {any} */
const byId=id=>{const row=cases.find(value=>value.id===id);assert.ok(row);return row;};
/** @param {any} row @returns {any} */
function cold(row){
  const report=fresh(row.analysis??row.preConsumerAnalysis);
  return {packet:JSON.parse(row.packageText),hir:fresh(row.hir),context:fresh(row.context),report,
    facts:{...fresh(row.factsContext),factsBytes:Buffer.from(row.packageText)},
    hirBytes:wire(row.hir),reportBytes:wire(report)};
}
/** @param {any} state @param {any} row @param {any} [hir] @param {any} [report] */
function unchanged(state,row,hir=row.hir,report=row.analysis??row.preConsumerAnalysis){
  assert.deepEqual(state.packet,JSON.parse(row.packageText));assert.deepEqual(state.hir,hir);
  assert.deepEqual(state.context,row.context);assert.deepEqual(state.report,report);
  assert.deepEqual(state.facts,{...fresh(row.factsContext),factsBytes:Buffer.from(row.packageText)});
  assert.deepEqual(state.hirBytes,wire(hir));assert.deepEqual(state.reportBytes,wire(report));
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
/** @param {any} state @param {string} entry @returns {any} */
function invoke(state,entry){
  let value,error,threw=false;
  try{value=entries[entry](state);}catch(cause){error=cause;threw=true;}
  return {value,error,threw};
}
/** @param {any} error */
const dto=error=>({message:error.message,
  ...Object.fromEntries(Object.keys(error).map(key=>[key,error[key]]))});
/** @param {any} outcome @param {any} expected */
function rejected(outcome,expected){
  assert.equal(outcome.threw,true);assert.ok(outcome.error instanceof TypeError);
  assert.deepEqual(dto(outcome.error),expected);
}
/** @param {any} row @param {string} entry @param {any} outcome */
function checked(row,entry,outcome){
  if(row.expectedDiagnostic){
    if(entry==='buildHir'){
      assert.equal(outcome.threw,false);
      assert.deepEqual(outcome.value,{status:'error',diagnostics:[row.expectedDiagnostic]});
      deeplyFrozen(outcome.value);
    }else rejected(outcome,row.expectedDiagnostic);
    return;
  }
  if(entry==='lowerHir'){rejected(outcome,row.coreDiagnostic);return;}
  assert.equal(outcome.threw,false,outcome.error?.stack);
  const expected=entry==='buildHir'?{status:'ok',hir:row.hir}:
    entry==='printHir'?jcs(row.hir)+'\n':
    entry==='printArrayCalls'?jcs(row.analysis)+'\n':
    entry.endsWith('ArrayCalls')?row.analysis:row.hir;
  assert.deepEqual(outcome.value,expected);deeplyFrozen(outcome.value);
}

for(const row of cases)test('26b complete cold public seams: '+row.id,async t=>{
  assert.equal(row.provenance.productionModuleImported,false);
  assert.equal(row.provenance.productionOutputSampled,false);
  assert.deepEqual(readArrayFactsCandidate(Buffer.from(row.packageText)),JSON.parse(row.packageText));
  for(const entry of Object.keys(entries))await t.test(entry,()=>{
    const state=cold(row),outcome=invoke(state,entry);unchanged(state,row);
    checked(row,entry,outcome);
    if(!outcome.threw&&!row.expectedDiagnostic){
      const saved=outcome.value;
      state.packet.payload.functions.length=0;state.hir.functions.length=0;
      state.context.contracts.length=0;state.report.functions.length=0;
      state.facts.factsBytes.fill(0);state.hirBytes.fill(0);state.reportBytes.fill(0);
      checked(row,entry,{...outcome,value:saved});
    }
  });
});

for(const mutant of controls.coldMutants)test('26b whole-plan rejection: '+mutant.id,async t=>{
  const row=byId(mutant.baseCase),hir=mutant.hir,report=mutant.reportWithSelfConsistentHirDigest;
  for(const entry of Object.keys(entries))await t.test(entry,()=>{
    const state=cold(row);state.hir=fresh(hir);state.hirBytes=wire(hir);
    state.report=fresh(report);state.reportBytes=wire(report);
    const outcome=invoke(state,entry);unchanged(state,row,hir,report);
    if(entry==='buildHir')checked(row,entry,outcome);
    else rejected(outcome,mutant.seams[entry].expectedDiagnostic);
  });
});

for(const mutant of controls.contextMutants)test('26b fixed capability and complete slots: '+mutant.id,async t=>{
  const base=byId(mutant.baseCase),row={...base,context:mutant.context};
  for(const entry of Object.keys(entries))await t.test(entry,()=>{
    const state=cold(row),outcome=invoke(state,entry);unchanged(state,row);
    const expected=mutant.seams[entry].expectedDiagnostic;
    if(entry==='buildHir'){
      assert.equal(outcome.threw,false);
      assert.deepEqual(outcome.value,{status:'error',diagnostics:[expected]});
    }else rejected(outcome,expected);
  });
});

test('26b independent official custody, full slots, shared completion and fixed R=false remain explicit',()=>{
  assert.equal(official.comparison.differenceCount,0);
  assert.equal(official.comparison.official4x0For16,true);
  assert.equal(official.comparison.actualIndependentFacts12WholeExact,true);
  const before=byId('before'),after=byId('after');
  assert.deepEqual([before.work.owner,after.work.owner],[37,37]);
  assert.deepEqual([before.work.borrowUses,after.work.borrowUses],[1,1]);
  assert.deepEqual([before.work.borrowTotal,after.work.borrowTotal],[4,3]);
  const formal=after.hir.readSpanPlan.functions[0].views[0];
  assert.equal(formal.origin.kind,'parameter');assert.equal(formal.lastUseEvent,null);
  assert.deepEqual(formal.useEvents,[]);assert.equal(formal.owner.kind,'parameter');
  const repeated=byId('same-family-two-view-arguments');
  const group=repeated.hir.readSpanPlan.functions.flatMap(f=>f.events)
    .find(e=>e.kind==='view-call-complete'&&e.uses.length===2);
  assert.ok(group);assert.equal(group.uses[0].viewId,group.uses[1].viewId);
  assert.notEqual(group.uses[0].index,group.uses[1].index);
  const mixed=byId('mixed-full-slots');
  assert.ok(mixed.hir.readSpanPlan.calls.some(call=>call.arguments.some(arg=>arg.index>0)));
  for(const row of cases){
    assert.equal(row.hir.format.version,5);assert.equal(row.hir.facts.version,5);
    assert.equal(row.hir.readSpanPlan.version,2);assert.equal(row.context.version,2);
    assert.equal(JSON.parse(row.packageText).version,5);
  }
});

test('26b selected complete context rejects accessor and Proxy data without invoking traps',()=>{
  const row=byId('required-checked-read');
  for(const hostile of ['getter','proxy']){
    let touched=0;
    const state=cold(row);
    state.context=hostile==='getter'
      ?Object.defineProperty(fresh(row.context),'contracts',{enumerable:true,get(){touched++;return []}})
      :new Proxy(fresh(row.context),{
        get(){touched++;throw new Error('unexpected get')},
        getPrototypeOf(){touched++;throw new Error('unexpected prototype')},
        ownKeys(){touched++;throw new Error('unexpected ownKeys')},
        getOwnPropertyDescriptor(){touched++;throw new Error('unexpected descriptor')},
      });
    for(const [entry,action]of Object.entries(entries)){
      const outcome=invoke(state,entry);
      const code=entry.endsWith('ArrayCalls')?'r03-d-array-call-effects':'r03-array-hir-context';
      if(entry==='buildHir'){
        assert.equal(outcome.threw,false);assert.equal(outcome.value.status,'error');
        assert.equal(outcome.value.diagnostics[0].code,code);
      }else{assert.equal(outcome.threw,true);assert.ok(outcome.error instanceof TypeError);assert.equal(outcome.error.code,code);}
      assert.equal(touched,0,entry+' must not invoke '+hostile);
      assert.equal(typeof action,'function');
    }
  }
});
