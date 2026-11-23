// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {commonProgramModel,createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {commonProgramValues} from '../../compiler/common-program-values.mjs';

const models=await Promise.all(['value-field-updates','value-floating-arithmetic'].map(async fixture=>{
  const raw=await fs.readFile(new URL('./testdata/formal-value-llvm-v3/'+fixture+'/package.json',import.meta.url));
  return commonProgramModel(projectCommonProgram(readCommonProgramFacts(raw))).model;
}));
const [integers,floats]=models;

function checkUpdate(model,owner,update,unitName,unitProperties) {
  const {target,type,range,operator,prefix}=update;
  const graph=createCommonGraph(model,owner),entry=graph.newBlock([model.cell(target.receiver.type)]);
  const state={current:entry,cells:new Map([[target.receiver.binding,entry.parameters[0]]])};
  const unused=()=>assert.fail('field updates do not call a function');
  const result=commonProgramValues(model,graph,state,unused,unused,unused).expression(update);
  assert.deepEqual(entry.instructions.map(row=>row.name),[
    'tsfg_program.load','tsfg_program.field_load','tsfg_program.'+unitName,
    'tsfg_program.binary','tsfg_program.value_copy','tsfg_program.field_store',
  ]);
  const [receiver,old,unit,arithmetic,copy,store]=entry.instructions;
  assert.deepEqual(unit.properties,unitProperties);
  assert.deepEqual([old.view,unit.view,arithmetic.view,copy.view,result.type],[type,type,type,type,type]);
  assert.deepEqual(old.operands,[receiver.result]);
  assert.deepEqual(arithmetic.operands,[old.result,unit.result]);
  assert.deepEqual(arithmetic.properties,{operator:operator==='++'?'+':'-'});
  assert.deepEqual(copy.operands,[arithmetic.result]);
  assert.deepEqual(store.operands,[receiver.result,copy.result]);
  assert.equal(old.properties.field,target.property);
  assert.equal(store.properties.field,target.property);
  assert.deepEqual(entry.instructions.map(row=>row.range),[target.receiver.range,target.range,range,range,range,range]);
  assert.equal(result.name,prefix?arithmetic.result:old.result);
}

for(const name of ['valueFieldPostfix','valueFieldPrefix']) {
  const owner=[...integers.functions.values()].find(fn=>fn.name===name);
  const update=owner.body[0].value;
  test('retained i32 '+name+' keeps its integer unit and field update order',()=>{
    checkUpdate(integers,owner,update,'constant',{token:'1',decimal:'1'});
  });
  for(const [width,bits] of [['32','3f800000'],['64','3ff0000000000000']]) {
    test('synthetic f'+width+' '+name+' uses the exact floating unit and field update order',()=>{
      const floatingOwner=[...floats.functions.values()].find(fn=>fn.name==='valueF'+width+'Arithmetic');
      // Reuse a genuine Common field access as the location and the retained i32 update as the operator shape.
      const field=floatingOwner.body[0].initializer.expression;
      assert.equal(field.kind,'fieldAccess');
      const target={...field,kind:'fieldTarget'};
      const range={start:target.range.start-(update.prefix?2:0),end:target.range.end+(update.prefix?0:2)};
      const operatorRange=update.prefix?{start:range.start,end:target.range.start}:{start:target.range.end,end:range.end};
      const synthetic={...update,type:target.type,declaredType:target.declaredType,target,range,operatorRange};
      checkUpdate(floats,floatingOwner,synthetic,'floating',{token:'1',bits});
    });
  }
}
