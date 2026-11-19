// SPDX-License-Identifier: MIT
// Production Source-facts→HIR→Core data route, not Source or C++ execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteFieldReaching} from '../../compiler/finite-field-reaching.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';

async function callerEntry() {
  const bytes=await readFile(new URL('./testdata/typed-array-entry/4ba3371076ddd76ce6bec0c842ebff1881a826afcb81800a32914570eb4e9874-package.json',import.meta.url));
  assert.equal(bytes.length,9760);assert.equal(sha256(bytes),'sha256:f133f8c23e44e1ca3672069ab11c19d0277f9c3cabd1b4a156ae7b2f58836f05');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);assert.equal(built.status,'ok');
  return {hir:built.hir,context};
}

test('internal field read uses the actual caller-before write, not the official union flow',async()=>{
  const {hir,context}=await callerEntry(),read=hir.functions.find(fn=>fn.name==='read'),run=hir.functions.find(fn=>fn.name==='run');
  assert.ok(read);assert.ok(run);
  const plan=buildFiniteCoreDomains(hir,context).definition,core=lowerFormalHir(hir,context),
    access=plan.fieldReaching.reads.find(row=>row.node.startsWith(read.id+'/')),
    write=plan.fieldReaching.writes.find(row=>row.id.startsWith(run.id+'/'));
  assert.ok(access);assert.ok(write);assert.ok(access.reaching.length>0);
  assert.ok(access.reaching.every(row=>row.versions.length===1&&row.versions[0]===write.id));
  const value=plan.nodes.find(row=>row.id===access.node);assert.ok(value);
  assert.deepEqual(plan.domains.find(row=>row.id===value.domainId)?.actualTypes,[scalarTypeIds.i32]);
  const caller=core.split('  func.func @"f'+run.id.slice(7)+'"')[1].split('\n  }')[0],
    store=caller.split('\n').find(line=>line.includes('"tsfg_core.domain.field_store"')),
    call=caller.split('\n').find(line=>line.includes('"func.call"')&&line.includes(read.id));
  assert.ok(store);assert.ok(call);assert.ok(caller.indexOf(store)<caller.indexOf(call));
  const callee=core.split('  func.func @"f'+read.id.slice(7)+'"')[1].split('\n  }')[0],
    field=callee.split('\n').find(line=>line.includes('"tsfg_core.domain.field_read"'));
  assert.ok(field);assert.ok(field.includes(write.id),'read version binds the real write in another callable');
  assert.equal(callee.split('\n').filter(line=>line.includes('"tsfg_core.domain.field_read"')).length,1);
});

test('a literally skipped caller stays in the inventory without erasing another caller’s field proof',async()=>{
  const {hir,context}=await callerEntry(),read=hir.functions.find(fn=>fn.name==='read'),run=hir.functions.find(fn=>fn.name==='run');
  const [store,returned]=run.body,call=returned.value,scalar=store.expression.value;
  assert.equal(store.expression.kind,'fieldAssignment');assert.equal(call.kind,'call');
  const plan=buildFiniteCoreDomains(hir,context).definition,prefix=run.id+'/body/',
    site=prefix+'0/expression/right/left\0'+read.id,
    write=prefix+'1/expression/value',shift=rows=>rows.map(row=>row.id.startsWith(prefix+'0/')?
      {...row,id:prefix+'1'+row.id.slice(prefix.length+1)}:row),
    modelPlan={...plan,fields:shift(plan.fields),carrierFields:shift(plan.carrierFields)};
  const right={kind:'binary',operator:'===',left:call,right:scalar,type:scalarTypeIds.bool,range:call.range};
  for(const takesRhs of [false,true]) {
    const left={kind:'boolean',value:takesRhs,type:scalarTypeIds.bool,range:call.range};
    const guard={kind:'shortCircuit',operator:'&&',left,right,type:scalarTypeIds.bool,range:call.range};
    const fn={...run,body:[{...store,expression:guard},store,returned]};
    const model={...hir,functions:hir.functions.map(row=>row.id===run.id?fn:row)};
    const reaching=buildFiniteFieldReaching(model,modelPlan,()=>{});
    assert.deepEqual(reaching.callContexts.find(row=>row.site===site)?.fields,[]);
    const access=reaching.reads.find(row=>row.node.startsWith(read.id+'/'));
    assert.deepEqual(access?.reaching.flatMap(row=>row.sources),takesRhs?[]:[write]);
  }
});

test('a literal if return cuts off later field writes and call input without removing their inventory',async()=>{
  const {hir,context}=await callerEntry(),read=hir.functions.find(fn=>fn.name==='read'),run=hir.functions.find(fn=>fn.name==='run');
  const [store,returned]=run.body,plan=buildFiniteCoreDomains(hir,context).definition,prefix=run.id+'/body/',
    first=prefix+'0/expression/value',second=prefix+'2/expression/value',
    duplicate=rows=>[...rows,...rows.filter(row=>row.id.startsWith(prefix+'0/')).map(row=>({...row,id:prefix+'2'+row.id.slice(prefix.length+1)}))],
    modelPlan={...plan,fields:duplicate(plan.fields),carrierFields:duplicate(plan.carrierFields)};
  for(const early of [true,false]) {
    const condition={kind:'boolean',value:early,type:scalarTypeIds.bool,range:returned.range};
    const branch={kind:'if',range:returned.range,condition,then:[returned],else:[]};
    const fn={...run,body:[store,branch,store,returned]},model={...hir,functions:hir.functions.map(row=>row.id===run.id?fn:row)};
    const reaching=buildFiniteFieldReaching(model,modelPlan,()=>{});
    const access=reaching.reads.find(row=>row.node.startsWith(read.id+'/'));
    assert.deepEqual(access?.reaching.flatMap(row=>row.sources),[early?first:second]);
    assert.deepEqual(reaching.writes.filter(row=>row.id.startsWith(prefix)).map(row=>row.node),[first,second]);
    const skipped=prefix+(early?'3/value':'1/then/0/value')+'\0'+read.id;
    assert.deepEqual(reaching.callContexts.find(row=>row.site===skipped)?.fields,[]);
  }
});

test('literal false while keeps an unexecuted call in the inventory without contributing a field input',async()=>{
  const {hir,context}=await callerEntry(),read=hir.functions.find(fn=>fn.name==='read'),run=hir.functions.find(fn=>fn.name==='run');
  const [store,returned]=run.body,plan=buildFiniteCoreDomains(hir,context).definition,prefix=run.id+'/body/';
  assert.equal(returned.value.kind,'call');
  const shift=rows=>rows.map(row=>row.id.startsWith(prefix+'0/')?{...row,id:prefix+'1'+row.id.slice(prefix.length+1)}:row);
  const modelPlan={...plan,fields:shift(plan.fields),carrierFields:shift(plan.carrierFields)};
  const condition={kind:'boolean',value:false,type:scalarTypeIds.bool,range:returned.range};
  const loop={kind:'while',range:returned.range,condition,
    body:[{kind:'expression',range:returned.range,expression:returned.value}]};
  const fn={...run,body:[loop,store,returned]},model={...hir,functions:hir.functions.map(row=>row.id===run.id?fn:row)};
  const reaching=buildFiniteFieldReaching(model,modelPlan,()=>{});
  const access=reaching.reads.find(row=>row.node.startsWith(read.id+'/'));
  assert.deepEqual(access?.reaching.flatMap(row=>row.sources),[prefix+'1/expression/value']);
  const skipped=prefix+'0/body/0/expression\0'+read.id;
  assert.deepEqual(reaching.callContexts.find(row=>row.site===skipped)?.fields,[]);
});
