// SPDX-License-Identifier: MIT
// Public checked Source inputs; assertions describe actual SSA, not IR execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import manifest from './testdata/typed-array-consumer-v8/manifest.json' with {type:'json'};
const none={read:false,write:false,structural:false};
const view={parameters:{0:{...none,read:true}},local:none,returnOrigin:{kind:'parameter',index:0}};
async function actual(name){
  const row=manifest.find(row=>row.name===name);assert.ok(row);
  const bytes=await readFile(new URL('./testdata/typed-array-consumer-v8/'+row.file,import.meta.url));
  assert.equal(sha256(bytes).slice(7),row.sha256);const facts=readTypedArrayFacts(bytes);
  const source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
  assert.equal(sha256(source.content).slice(7),row.source.sha256);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  return {facts,source:source.content,context,publication:staticPublication(facts,{view,borrow:view,identity:{local:none}})};
}
function ops(body){
  return body.split('\n').flatMap(line=>{
    const match=/^\s*(?:(%\w+) = )?"([\w.]+)"\(([^)]*)\) \{(.*)\} :/.exec(line);
    return match?[{result:match[1],name:match[2],inputs:match[3]?match[3].split(', '):[],attrs:match[4]}]:[];
  });
}
function strip(name,definitions){
  const seen=new Set();while(true){
    assert.ok(!seen.has(name));seen.add(name);const definition=definitions.get(name);
    if(!definition||!['tsfg_core.domain.view','tsfg_core.domain.refine','tsfg_core.domain.copy'].includes(definition.name))return name;
    assert.equal(definition.inputs.length,1);name=definition.inputs[0];
  }
}
for(const name of ['union-view-return','box-view-return','value-view-return'])
test('actual returned Span preserves formal owner and distinct view SSA: '+name,async()=>{
  const {facts,source,context,publication}=await actual(name),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));const hir=built.hir;
  const helper=hir.functions.find(fn=>fn.name==='view'),caller=hir.functions.find(fn=>fn.name==='read');
  assert.ok(source.includes('return readSpan(a,0,1)'),'source-only owner projection is formal slot zero');
  const state=hir.readSpanPlan.functions.find(fn=>fn.functionId===caller.id);
  assert.equal(state.views.length,1);assert.equal(state.views[0].origin.kind,'callResult');
  assert.equal(state.views[0].owner.kind,'parameter');assert.equal(state.views[0].owner.index,0);
  const core=lowerFormalHir(hir,context,publication);
  const body=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
  const helperBody=body(helper),helperOps=ops(helperBody),helperDefs=new Map(helperOps.map(op=>[op.result,op]));
  const parameter=/\((%\w+):/.exec(helperBody);assert.ok(parameter);
  const span=helperOps.find(op=>op.name==='tsfg_core.domain.read_span'),returned=helperOps.find(op=>op.name==='func.return');
  assert.ok(span&&returned);assert.equal(strip(span.inputs[0],helperDefs),parameter[1]);
  assert.notEqual(span.result,parameter[1],'new view object is not the Array parameter object');
  assert.equal(strip(returned.inputs[0],helperDefs),span.result);
  const callerBody=body(caller),callerOps=ops(callerBody),defs=new Map(callerOps.map(op=>[op.result,op]));
  const call=callerOps.find(op=>op.name==='func.call'),read=callerOps.find(op=>op.name==='tsfg_core.domain.array_read');
  assert.ok(call&&read);assert.ok(call.attrs.includes('tsfg_core.function_id = "'+helper.id+'"'));
  assert.equal(call.inputs.length,1);assert.equal(strip(read.inputs[0],defs),call.result,'checked read uses the actual call result');
  assert.equal(strip(call.inputs[0],defs),/\((%\w+):/.exec(callerBody)[1]);
  assert.ok(!callerOps.some(op=>op.name==='tsfg_core.domain.array_create'),'callsite cannot manufacture a replacement owner');
});
test('actual returned Span alias retains its active structural-write conflict',async()=>{
  const {facts,context,publication}=await actual('view-parameter-alias'),built=buildHir(facts,context,publication);
  assert.equal(built.status,'error');assert.equal(built.hir,undefined);
  assert.equal(built.diagnostics[0].code,'r03-d-readspan-structural-conflict');
  assert.ok(built.diagnostics[0].related.some(item=>item.kind==='borrow-alias'));
});
