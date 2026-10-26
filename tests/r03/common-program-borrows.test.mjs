// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonBorrowGraph} from '../../compiler/common-program-borrows.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {commonBorrowModel,commonBorrowAlternativeModel,commonBorrowConstructorModel} from './common-program-borrow-models.mjs';
const actual=name=>projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./common-borrow-'+name+'.json',import.meta.url))));
for(const name of ['valid','conflict'])test('official whole Program aggregate borrow '+name,()=>{
  const hir=actual(name),publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  if(name==='valid'){const core=emitCommonProgramCore(hir,publication,request);assert.match(core,/tsfg_program.readspan/);assert.match(core,/tsfg_program.array_read/);}
  else{const fn=hir.functions.find(fn=>fn.name==='borrowOrdinary'),source=hir.sources.find(s=>s.path===fn.sourcePath).content,start=source.indexOf('a.length = 0;');
    assert.throws(()=>emitCommonProgramCore(hir,publication,request),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict'&&e.primary.sourceId===fn.sourcePath&&e.primary.start===start);}
});
for(const name of ['last-use','fresh-disjoint','owner-alias-conflict','field-replacement','unreachable-resize','exact-no-change','value-snapshot'])test('official whole Program borrow boundary '+name,()=>{
  const hir=actual(name),publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  if(name==='owner-alias-conflict')assert.throws(()=>emitCommonProgramCore(hir,publication,request),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict');
  else assert.match(emitCommonProgramCore(hir,publication,request),/tsfg_program.readspan/);
});

// These compact graph controls are synthetic domain checks, not Source/Go or
// Runtime qualification. Adapter integration above uses original whole facts.
function model(){const graph=commonBorrowGraph(commonMeter());for(const id of ['entry','define','modify','use','exit'])graph.point(id);
  graph.fresh.add('a');graph.fresh.add('b');graph.edge('entry','define');graph.edge('define','modify');graph.edge('modify','use');graph.edge('use','exit');
  graph.define('define','span',{ids:new Set(['a']),pending:false});return graph;}
test('borrow domain last use and fresh owner separation',()=>{
  let graph=model();graph.use('define',new Set(['span']));graph.effect('modify',{ids:new Set(['a']),pending:false},{});graph.verify();
  graph=model();graph.use('use',new Set(['span']));graph.effect('modify',{ids:new Set(['b']),pending:false},{});graph.verify();
});
test('borrow domain aliased and unknown owners are distinct failures',()=>{
  for(const [owner,code]of [['a','borrow-conflict'],['parameter','borrow-pending']]){const graph=model();graph.use('use',new Set(['span']));graph.effect('modify',{ids:new Set([owner]),pending:false},{});
    assert.throws(()=>graph.verify(),/** @param {any} e */e=>e.code==='r03-common-program-'+code);}
});
test('borrow domain exclusive branch does not join heap lifetime into uses',()=>{
  const graph=commonBorrowGraph(commonMeter());for(const p of ['entry','yes','no','exit'])graph.point(p);graph.define('entry','span',{ids:new Set(['a']),pending:false});
  graph.edge('entry','yes');graph.edge('entry','no');graph.edge('yes','exit');graph.edge('no','exit');graph.use('yes',new Set(['span']));graph.effect('no',{ids:new Set(['a']),pending:false},{});graph.verify();
});
test('borrow domain repeated descriptor does not kill a retained older borrow',()=>{
  const graph=model();graph.define('modify','span',{ids:new Set(['a']),pending:false},true);graph.use('use',new Set(['span']));graph.effect('modify',{ids:new Set(['a']),pending:false},{});
  assert.throws(()=>graph.verify(),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict');
});
test('borrow domain unknown fixed effect and external storage stay pending',()=>{
  let graph=model();graph.use('use',new Set(['span']));graph.effect('modify',{ids:new Set(),pending:true},{});assert.throws(()=>graph.verify(),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
  graph=model();graph.escape('modify',new Set(['span']),false,{});assert.throws(()=>graph.verify(),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
test('borrow domain work exhaustion returns no partial success',()=>{const graph=commonBorrowGraph(commonMeter(1));graph.point('entry');assert.throws(()=>graph.verify(),/** @param {any} e */e=>e.code==='r03-common-program-limit');});
for(const mode of ['direct','method','indirect'])test('normalized '+mode+' consumes full fixed structural upper',()=>{
  let value=commonBorrowModel(mode);analyzeCommonGraphs(value.program,value.records);
  value=commonBorrowModel(mode,true);assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict');
});
for(const mode of ['consume','factory'])test('normalized call '+mode+' preserves actual borrow identity and last use',()=>{
  const {program,records}=commonBorrowModel(mode);const values=analyzeCommonGraphs(program,records);assert.ok(values.actual.borrows.borrows>0);
});
test('normalized external Holder storage cannot extend a local owner lifetime',()=>{
  const {program,records}=commonBorrowModel('external-store');assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
for(const mode of ['return-holder','return-array'])test('review retention '+mode+' retains its original allocated owner',()=>{
  const {program,records}=commonBorrowModel(mode);analyzeCommonGraphs(program,records);
});
test('review retention does not admit direct Span or unknown owner returns',()=>{
  for(const mode of ['return-direct-span','return-unknown-owner']){const {program,records}=commonBorrowModel(mode);assert.throws(()=>analyzeCommonGraphs(program,records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');}
});
test('review retention requires original matching element and nonrepeated allocation',()=>{
  let value=commonBorrowModel('return-holder');value.program.model.types.get('unit:Span').elementType='different-element';
  assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
  value=commonBorrowModel('return-holder');value.program.model.hir.closure.roots.push({kind:'application',target:'entry'});
  assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
test('review retention follows an actual called activation without merging its universal root',()=>{
  const {program,records}=commonBorrowModel('holder-factory');analyzeCommonGraphs(program,records);
});
test('review unknown Span use rejects while unknown scalar transport stays separate',()=>{
  let value=commonBorrowModel('unknown-span');assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
  value=commonBorrowModel('unknown-pass');analyzeCommonGraphs(value.program,value.records);
});
test('review direct lexical call accounts for its hidden environment before Source parameters',()=>{
  let value=commonBorrowModel('hidden');analyzeCommonGraphs(value.program,value.records);
  value=commonBorrowModel('hidden',true);assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-conflict');
});
test('review budget charges live values killed by a definition',()=>{
  let active=false,remaining=84;const spend=(n=1)=>{if(active){remaining-=n;if(remaining<0)throw Object.assign(new Error('limit'),{code:'r03-common-program-limit'});}},graph=commonBorrowGraph(spend);
  graph.point('define');graph.point('use');graph.edge('define','use');for(let i=0;i<16;i++){const id='s'+i;graph.define('define',id,{ids:new Set(['a']),pending:false});graph.use('use',new Set([id]));}
  active=true;assert.throws(()=>graph.verify(),/** @param {any} e */e=>e.code==='r03-common-program-limit');
});
test('review budget charges every effect edge even when successor liveness is empty',()=>{
  let active=false,remaining=256;const spend=(n=1)=>{if(active){remaining-=n;if(remaining<0)throw Object.assign(new Error('limit'),{code:'r03-common-program-limit'});}},graph=commonBorrowGraph(spend);
  graph.point('effect');for(let i=0;i<12;i++){graph.point('exit'+i);graph.edge('effect','exit'+i);}for(let i=0;i<64;i++)graph.effect('effect',{ids:new Set(),pending:true},{});
  active=true;assert.throws(()=>graph.verify(),/** @param {any} e */e=>e.code==='r03-common-program-limit');
});
test('review must owning backing follows every real CFG field alternative',()=>{
  let value=commonBorrowAlternativeModel(),solved=analyzeCommonGraphs(value.program);
  assert.equal(solved.actual.observed.get(value.entryId+'/'+value.backingRead).refs.size,2,'actual field join must contain A and B');
  assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
  value=commonBorrowAlternativeModel(true);analyzeCommonGraphs(value.program,value.records);
});
test('review construction-body initializes its actual receiver without granting ordinary external stores',()=>{
  let value=commonBorrowConstructorModel();analyzeCommonGraphs(value.program,value.records);
  value=commonBorrowConstructorModel('source');assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
test('review must backing includes absence tags independent of object references',()=>{
  const value=commonBorrowAlternativeModel(false,true),solved=analyzeCommonGraphs(value.program),actual=solved.actual.observed.get(value.entryId+'/'+value.backingRead);
  assert.equal(actual.refs.size,1);assert.ok(actual.tags.has(sha256('tsfg.type\0undefined')));
  assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>e.code==='r03-common-program-borrow-pending');
});
