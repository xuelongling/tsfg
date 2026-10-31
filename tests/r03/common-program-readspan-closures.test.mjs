// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonMeter,canonical} from '../../compiler/common-program-common.mjs';
import {commonBorrowGraph} from '../../compiler/common-program-borrows.mjs';
import {commonBorrowObservations} from '../../compiler/common-program-borrow-observations.mjs';
import {commonCoreSchema} from '../../compiler/common-program-plan.mjs';
import {sha256} from '../../compiler/identity.mjs';
import constructionOracle from './testdata/common-readspan-closures/private4-construction-oracle.json' with {type:'json'};
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
// Historical private3 function hashes stay recorded. The independent retained
// IR oracle below preserves every other function byte and the unchanged
// ordinary operations while checking the approved Source9 construction form.
const originalFunctionDigests=new Map([
  ['safe-lastuse','sha256:1efd93893ce26d9b0b3ec782075d6b92e7602a9a9a8a9dc6fa485f68353dc7e0'],
  ['never-called','sha256:36182197ec26fc1e88f5ca6ea194ff6dfd9a0db836d68e617be463d35694dfaa'],
  ['mutable-safe','sha256:ef3079d15f9522fca97b1b3bec015300d7cab343f36fb2c0730bf335c6229979'],
  ['parameter-safe','sha256:ccdc8d3c9c760079f8e6d1ecc1448bd75e4997c55d599043d8ea4b7c9dfb91fe']]);

/** @param {string} name @param {string} functions */
function assertPrivate4ConstructionTransition(name,functions){
  const expected=constructionOracle.ordinary,prior=constructionOracle.cases.find(row=>row.name===name),
    start=functions.indexOf('  func.func @"program_'+expected.functionId.slice(7)+'"');assert.ok(start>=0);
  const next=functions.indexOf('  func.func ',start+1),end=next<0?functions.length:next,body=functions.slice(start,end);
  assert.equal(commonCoreSchema,constructionOracle.schema);
  assert.equal(body.split('\n')[0],expected.header,'ordinary signature, public role and declaration anchor stay byte-exact');
  assert.deepEqual(body.split('\n').filter(line=>/^\s+cf\./.test(line)).map(line=>line.replaceAll(/%v\d+/g,'%value').replaceAll(/\^bb\d+/g,'^block')),
    expected.unchangedBranches,'existing ordinary control edges and payload types only renumber their SSA/block names');
  if(prior){
    assert.equal(prior.historicalFunctionsSha256,originalFunctionDigests.get(name),'retain the independently recorded private3 identity');
    assert.equal(sha256(functions.slice(0,start)+functions.slice(end)),prior.unchangedFunctionsSha256,
      'all other function and borrow-anchor bytes match the retained private3 IR');
  }
  const unquote=token=>{/** @type {unknown} */ const value=JSON.parse(token);assert.ok(typeof value==='string');return value;};
  const operations=body.split('\n').flatMap(line=>{
    const match=/^\s+(?:(%\w+) = )?"([^"]+)"\(([^)]*)\)/.exec(line);if(!match)return [];
    const source=/tsfg_source.start = (\d+) : i64, tsfg_source.end = (\d+) : i64/.exec(line);assert.ok(source);
    const property=/properties = ("(?:\\.|[^"\\])*")/.exec(line),view=/view_type = ("(?:\\.|[^"\\])*")/.exec(line),
      edges=/\[([^\]]+)\]/.exec(line);
    return [{name:match[2],result:match[1]??null,operands:match[3]?match[3].split(',').map(value=>value.trim()):[],
      properties:property?unquote(property[1]):null,view:view?unquote(view[1]):null,
      range:[Number(source[1]),Number(source[2])],successors:edges?edges[1].split(',').map(value=>value.trim().slice(1)):[],line}];
  });
  const protocol=operations.filter(row=>/^tsfg_program\.(receiver_|initialize_)/.test(row.name)),
    atNew=op=>op.range[0]===expected.newRange[0]&&op.range[1]===expected.newRange[1],
    failures=operations.filter(row=>row.name==='tsfg_program.return_throw'&&atNew(row));
  assert.deepEqual(protocol.map(row=>row.name),expected.protocolOrder.map(row=>'tsfg_program.'+row));
  assert.equal(operations.some(row=>row.name==='tsfg_program.allocate_reference'||row.name==='tsfg_program.construct_value'),false);
  assert.deepEqual(operations.filter(row=>!protocol.includes(row)&&!failures.includes(row)).map(row=>({name:row.name,
    properties:row.properties,view:row.view,range:row.range,operands:row.operands.length})),expected.unchangedOperations,
    'ordinary keeps every non-construction operation, side effect and source anchor from the retained IR');
  const [create,allocate,bind,begin,field,endPhase,result]=protocol,frame=create.result,cursor=begin.result,afterField=field.result;
  assert.ok(frame&&cursor&&afterField);assert.deepEqual(create.operands,[]);
  assert.equal(create.view,'receiver:'+expected.owner);assert.ok(create.line.endsWith('-> !tsfg_program.carrier<"receiver:'+expected.owner+'">'));
  assert.deepEqual(JSON.parse(create.properties??'{}'),{construction:expected.construction,new_target:expected.owner,owner:expected.owner});
  assert.deepEqual(allocate.operands,[frame]);assert.deepEqual(bind.operands,[frame,allocate.result]);
  assert.equal(allocate.view,expected.owner);assert.equal(bind.successors.length,2);assert.equal(result.successors.length,2);
  const blockParameter=label=>{
    const line=body.split('\n').find(row=>row.startsWith('  ^'+label+'('));assert.ok(line);
    const match=/^  \^[^(]+\((%\w+): (.+)\):$/.exec(line);assert.ok(match);return {name:match[1],type:match[2]};
  },selected=blockParameter(bind.successors[0]),returned=blockParameter(result.successors[0]),
    bindFailure=blockParameter(bind.successors[1]),resultFailure=blockParameter(result.successors[1]);
  for(const value of [selected,returned])assert.equal(value.type,'!tsfg_program.carrier<"'+expected.owner+'">');
  for(const value of [bindFailure,resultFailure])assert.equal(value.type,'!tsfg_program.carrier<"payload:<core-schema>">');
  assert.deepEqual(failures.map(row=>row.operands),[[bindFailure.name],[resultFailure.name]]);
  assert.deepEqual(begin.operands,[frame,selected.name]);assert.equal(begin.view,'initialization:'+expected.owner);
  assert.deepEqual(field.operands.slice(0,2),[cursor,selected.name]);assert.equal(field.view,'initialization:'+expected.owner);
  assert.deepEqual(JSON.parse(field.properties??'{}'),{field:expected.field,owner:expected.owner});
  assert.deepEqual(field.range,expected.fieldRange);assert.deepEqual(endPhase.operands,[afterField,selected.name]);
  assert.deepEqual(result.operands,[frame]);
  for(const operation of protocol)if(operation!==field){assert.deepEqual(operation.range,expected.newRange);
    if(operation!==create)assert.deepEqual(JSON.parse(operation.properties??'{}'),{owner:expected.owner});}
  assert.deepEqual(operations.filter(row=>row.operands.includes(frame)).map(row=>row.name),
    ['receiver_allocate','receiver_bind','initialize_begin','receiver_result'].map(row=>'tsfg_program.'+row),'Frame is control only, never stored, copied or returned as data');
  assert.deepEqual(operations.filter(row=>row.operands.includes(cursor)).map(row=>row.name),['tsfg_program.initialize_field']);
  assert.deepEqual(operations.filter(row=>row.operands.includes(afterField)).map(row=>row.name),['tsfg_program.initialize_end']);
  const copiedField=operations.find(row=>row.name==='tsfg_program.value_copy'&&row.range[0]===expected.fieldRange[0]&&row.range[1]===expected.fieldRange[1]),
    copiedObject=operations.find(row=>row.name==='tsfg_program.value_copy'&&row.range[0]===1008&&row.range[1]===1028);
  assert.ok(copiedField&&copiedObject);assert.equal(field.operands[2],copiedField.result);
  assert.deepEqual(copiedObject.operands,[returned.name],'the successful selected object, never Frame, initializes box');
}
for(const [name,conflict]of cases)test('official whole Program ReadSpan capture '+name,()=>{
  const hir=projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./testdata/common-readspan-closures/'+name+'.json',import.meta.url)))),
    publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
  if(conflict===null){const core=emitCommonProgramCore(hir,publication,request);assert.match(core,/tsfg_program.env_load/);
    const markerHir=/, hir = ("(?:\\.|[^"\\])*")/.exec(core),markerHash=/, hir_hash = ("(?:\\.|[^"\\])*")/.exec(core);
    assert.ok(markerHir&&markerHash);const expectedHir=canonical(hir);
    assert.equal(JSON.parse(markerHir[1]),expectedHir,'direct quoted token output preserves the independent canonical HIR bytes');
    assert.equal(JSON.parse(markerHash[1]),sha256(expectedHir+'\n'),'only the same verified HIR+LF digest is reused');
    if(originalCoreDigests.has(name)){
      assert.notEqual(sha256(core),originalCoreDigests.get(name));
      const functions=core.slice(core.indexOf('\n')+1).replaceAll('!tsfg_program.carrier<"payload:'+commonCoreSchema+'">','!tsfg_program.carrier<"payload:<core-schema>">');
      assertPrivate4ConstructionTransition(name,functions);}
    else assertPrivate4ConstructionTransition(name,core.slice(core.indexOf('\n')+1).replaceAll('!tsfg_program.carrier<"payload:'+commonCoreSchema+'">','!tsfg_program.carrier<"payload:<core-schema>">'));}
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
    observer=commonBorrowObservations({internalFunctions:new Set(),model:{spend,types:new Map()},records:new Map(),objects:new Map()}),
    op={name:'tsfg_program.invoke_'+mode,properties:mode==='indirect'?{targets:{top:false,functions:rows}}:{dispatch:rows}};
  assert.throws(()=>observer.prepareCall('call',{},op,[],{values:new Map(),heap:new Map()},[]),e=>e===aborted);
  assert.equal(entered,false,'target map must not allocate before work/cancellation admission');
});
