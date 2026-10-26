// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {aggregateCallableModel,aggregatePureCompanionModel} from './common-program-aggregate-callable-models.mjs';
for(const mode of ['held','single','pure','nested','throw','coexisting'])test('normalized aggregate callable independently holds each selected owner: '+mode,()=>{
  const value=aggregateCallableModel(mode);assert.doesNotThrow(()=>analyzeCommonGraphs(value.program,value.records));
});
test('normalized pure companion alternative cannot hold another field borrowed owner',()=>{
  const value=aggregatePureCompanionModel();assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending'&&e.primary?.start===290&&e.primary?.end===299);
});
// Reusing the same factory currently marks its storage site weak. Conditional
// field retention must not grant uniqueness; the real Source language-positive
// case remains an explicit independent allocation-cardinality gap in parent26.
test('normalized repeated factory retains the independent weak-storage boundary',()=>{
  const value=aggregateCallableModel('same-code');assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending'&&e.primary?.start===290&&e.primary?.end===299);
});
for(const mode of ['bad','bad-throw'])test('normalized aggregate callable cannot borrow a sibling alternative owner: '+mode,()=>{
  const value=aggregateCallableModel(mode);assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending'&&e.primary?.sourceId==='/unit-model.ts'&&e.primary?.start===290&&e.primary?.end===299);
});
for(const reason of ['budget','cancel'])test('normalized aggregate proof propagates '+reason+' without partial success',()=>{
  const measured=aggregateCallableModel();let work=0;measured.program.model.spend=(n=1)=>{work+=n;};
  analyzeCommonGraphs(measured.program,measured.records);
  const value=aggregateCallableModel(),meter=commonMeter(work-1),cancelled=new Error('aggregate proof cancelled');let remaining=work-1,result;
  value.program.model.spend=(n=1)=>{if(reason==='budget')meter(n);else if((remaining-=n)<0)throw cancelled;};
  assert.throws(()=>{result=analyzeCommonGraphs(value.program,value.records);},/** @param {any} e */e=>
    reason==='cancel'?e===cancelled:e.code==='r03-common-program-limit');assert.equal(result,undefined);
});
const fixture=name=>projectCommonProgram(readCommonProgramFacts(fs.readFileSync(new URL('./testdata/common-aggregate-callables/'+name+'.json',import.meta.url))));
for(const name of ['different-code-match-safe','shared-environment-descriptor-safe'])test('official whole Program aggregate callable independently retains its owner: '+name,()=>{
  const hir=fixture(name);assert.doesNotThrow(()=>emitCommonProgramCore(hir,createCommonProgramPublication(hir),{
    targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}));
});
for(const [name,start,end]of [['wrong-owner-alternative-conflict',1760,1778],['descriptor-only-alternative-conflict',1721,1739],
  ['same-code-match-safe',1789,1820]])test('official whole Program preserves '+(name==='same-code-match-safe'?'independent weak allocation gap: ':'unsafe owner boundary: ')+name,()=>{
  const hir=fixture(name);assert.throws(()=>emitCommonProgramCore(hir,createCommonProgramPublication(hir),{
    targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending'&&e.primary?.sourceId===hir.rootFile&&e.primary.start===start&&e.primary.end===end);
});
