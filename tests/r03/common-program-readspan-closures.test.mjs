// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonBorrowGraph} from '../../compiler/common-program-borrows.mjs';
import {commonBorrowObservations} from '../../compiler/common-program-borrow-observations.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {readspanClosureModel,readspanClosureMayEnvironmentModel,readspanClosureParentModel,readspanCrossCallModel,readspanRecursiveCallModel,readspanReturnedCaptureModel,readspanConstructionThrowModel,readspanIncomingEnvironmentReturnModel} from './common-program-readspan-closure-models.mjs';
import {commonBorrowConstructorModel} from './common-program-borrow-models.mjs';
/** @type {Array<[string, number|null]>} */
const cases=[['safe-lastuse',null],['later-use-conflict',1553],['never-called',null],['mutable-safe',null],['mutable-conflict',1569],['parameter-safe',null],['parameter-conflict',1474],['parameter-index1-conflict',1474],['consumer-safe-index1',null]];
// Independently captured full Core outputs before the cross-call borrow fix.
const originalCoreDigests=new Map([
  ['safe-lastuse','sha256:0d48b7004036ee35c33ef775122c4c850891c7a89afbb99500927491d92824ab'],
  ['never-called','sha256:6c8c2229806e37abe8054e276cfbb65f2278968d82ae06a6a15d56cc1dcccf84'],
  ['mutable-safe','sha256:18005eda2c9ca9b715683dfe46d36de632dcaffab61a3fc8b88ff15bcd69f633'],
  ['parameter-safe','sha256:de7a7a53b2fb0e0678b5ee43ba324c9c56ea8fa697e1b267e054c5307f321d7c']]);
for(const [name,conflict]of cases)test('official whole Program ReadSpan capture '+name,()=>{
  const hir=projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./testdata/common-readspan-closures/'+name+'.json',import.meta.url)))),
    publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  if(conflict===null){const core=emitCommonProgramCore(hir,publication,request);assert.match(core,/tsfg_program.env_load/);
    if(originalCoreDigests.has(name))assert.equal(sha256(core),originalCoreDigests.get(name));}
  else assert.throws(()=>emitCommonProgramCore(hir,publication,request),/** @param {any} e */e=>(e.code==='r03-common-program-borrow-conflict'||String(name).startsWith('parameter-')&&e.code==='r03-common-program-borrow-pending')&&e.primary.sourceId===hir.rootFile&&e.primary.start===conflict);
});
test('normalized captured ReadSpan last use permits a later resize',()=>{
  const {program,records}=readspanClosureModel(),solved=analyzeCommonGraphs(program,records);
  assert.ok(solved.actual.borrows.borrows>0);
});
test('normalized escaping closure cannot hide a borrowed owner in its environment',()=>{
  const {program,records}=readspanClosureModel('escape-return');
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
for(const mode of ['never-called','mutable','mutable-after-use','indirect'])test('normalized captured ReadSpan '+mode+' follows actual consumption',()=>{
  const {program,records}=readspanClosureModel(mode);analyzeCommonGraphs(program,records);
});
test('normalized closure global storage scans its selected environment',()=>{
  const {program,records}=readspanClosureModel('escape-global');
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
test('normalized unknown fixed callee cannot retain a captured borrow',()=>{
  const {program,records}=readspanClosureModel();records.get('target').upper.facets.unknownHost=true;
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
test('normalized joined environment updates cannot erase an unselected old slot',()=>{
  const {program,records}=readspanClosureMayEnvironmentModel();
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict');
});
test('normalized nested environment follows its real parent slot before later resize',()=>{
  const {program,records}=readspanClosureParentModel();analyzeCommonGraphs(program,records);
});
test('normalized captured borrow analysis propagates budget and cancellation failures',()=>{
  let value=readspanClosureModel();value.program.model.spend=commonMeter(100);
  assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>e.code==='r03-common-program-limit');
  value=readspanClosureModel();const cancelled=new Error('cancelled'),spend=commonMeter(1000000);let remaining=100;
  value.program.model.spend=(n=1)=>{spend(n);remaining-=n;if(remaining<0)throw cancelled;};
  assert.throws(()=>analyzeCommonGraphs(value.program,value.records),e=>e===cancelled);
});
for(const mode of ['late-use','mutable-conflict'])test('normalized captured ReadSpan '+mode+' rejects at the modifying owner',()=>{
  const {program,records}=readspanClosureModel(mode);
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict'&&e.primary.sourceId==='/unit-model.ts'&&e.primary.start===10);
});
for(const mode of ['last-use','fresh-return'])test('normalized complete call '+mode+' orders actual uses before its fixed return barrier',()=>{
  const {program,records}=readspanCrossCallModel(mode);analyzeCommonGraphs(program,records);
});
for(const mode of ['late-callee-use','late-caller-use','upper-only','throw-late-use','wide-indirect'])test('normalized complete call '+mode+' preserves actual and full fixed boundaries',()=>{
  const {program,records}=readspanCrossCallModel(mode);
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>['r03-common-program-borrow-conflict','r03-common-program-borrow-pending'].includes(e.code));
});
test('normalized unknown-host call keeps conservative entry consumption and escape',()=>{
  const {program,records}=readspanCrossCallModel('unknown-host');
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
test('normalized fixed return barrier freezes only bounded pre-call descriptor identities',()=>{
  const graph=commonBorrowGraph(commonMeter()),eligible=new Set(['old']);graph.fresh.add('a');
  graph.define('old-definition','old',{ids:new Set(['a']),pending:false});graph.define('new-definition','new',{ids:new Set(['a']),pending:false});
  graph.edge('old-definition','new-definition');graph.edge('new-definition','barrier');graph.edge('barrier','use');graph.use('use',new Set(['new']));
  graph.effect('barrier',{ids:new Set(['a']),pending:false},{},eligible);eligible.add('new');graph.verify();
  assert.throws(()=>graph.effect('barrier',{ids:new Set(),pending:false},{},new Set(Array.from({length:4097},(_,i)=>'s'+i))),/** @param {any} e */e=>e.code==='r03-common-program-limit');
  let charge=false;const bounded=commonBorrowGraph((n=1)=>{if(charge&&n>128)throw Error('budget');});bounded.point('barrier');charge=true;
  assert.throws(()=>bounded.effect('barrier',{ids:new Set(['a']),pending:false},{},new Set(Array.from({length:128},(_,i)=>'s'+i))),/budget/);
});
test('normalized recursive SCC keeps an older descriptor live after the recursive mutation',()=>{
  const {program,records}=readspanRecursiveCallModel();
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>['r03-common-program-borrow-conflict','r03-common-program-borrow-pending'].includes(e.code));
});
for(const thrown of [false,true])for(const modified of [false,true])test('normalized escaping incoming capture '+(thrown?'throw':'return')+' '+(modified?'after resize':'unchanged')+' consumes its descriptor',()=>{
  const {program,records}=readspanReturnedCaptureModel(modified,thrown);
  if(modified)assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict'&&e.primary.start===170);
  else analyzeCommonGraphs(program,records);
});
test('normalized construction throw cannot exempt a captured local owner from retention',()=>{
  const {program,records}=readspanConstructionThrowModel();
  assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
test('normalized construction normal receiver return preserves its validated owning storage',()=>{
  const {program,records}=commonBorrowConstructorModel();analyzeCommonGraphs(program,records);
});
for(const parent of [false,true])for(const modified of [false,true])test('normalized incoming environment '+(parent?'parent':'slot')+' returned capture '+(modified?'after resize':'unchanged')+' keeps external owner origin',()=>{
  const {program,records}=readspanIncomingEnvironmentReturnModel(parent,modified);
  if(modified)assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict'&&e.primary.start===190);
  else analyzeCommonGraphs(program,records);
});
for(const mode of ['indirect','method'])for(const reason of ['budget','cancel'])test('normalized target snapshot '+mode+' prepays before map on '+reason,()=>{
  let entered=false,remaining=2;const aborted=new Error(reason),rows=Array.from({length:4},(_,i)=>({function_id:'f'+i,target:'f'+i}));
  rows.map=function(callback,thisArg){entered=true;return Array.prototype.map.call(this,callback,thisArg);};
  const spend=(n=1)=>{if(reason==='cancel'&&n>0)throw aborted;remaining-=n;if(remaining<0)throw aborted;},
    observer=commonBorrowObservations({model:{spend,types:new Map()},records:new Map(),objects:new Map()}),
    op={name:'tsfg_program.invoke_'+mode,properties:mode==='indirect'?{targets:{top:false,functions:rows}}:{dispatch:rows}};
  assert.throws(()=>observer.prepareCall('call',{},op,[],{values:new Map(),heap:new Map()},[]),e=>e===aborted);
  assert.equal(entered,false,'target map must not allocate before work/cancellation admission');
});
