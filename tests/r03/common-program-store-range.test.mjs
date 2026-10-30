// SPDX-License-Identifier: MIT
// Synthetic declaration stores retain their original span during parent lookup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonProgramValues} from '../../compiler/common-program-values.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {i32TypeId} from '../../compiler/identity.mjs';

test('synthetic captured store anchors each parent walk to its original declaration',()=>{
  const range=Object.freeze({start:2569,end:2583}),binding='captured-body-cell',
    model={spend:commonMeter(1000),limits:{registersPerFunction:16,blocksPerFunction:4,instructionsPerFunction:16},
      types:new Map([[i32TypeId,{id:i32TypeId,kind:'scalar',name:'i32'}]]),bindings:new Map([[binding,{id:binding,type:i32TypeId}]]),
      environments:new Map([['body',{parent:null}],['middle',{parent:'body'}],['inner',{parent:'middle'}]]),
      slots:new Map([[binding,{binding,key:'body-cell',layout:'body',type:i32TypeId}]])},
    graph=createCommonGraph(model,{id:'store-range',range:{start:0,end:3000}}),
    entry=graph.newBlock(['env:inner','env:middle',i32TypeId]),
    state={current:entry,cells:new Map(),environments:new Map([['inner',entry.parameters[0]],['middle',entry.parameters[1]]])},
    unused=()=>assert.fail('a synthetic store must not invoke a function'),
    values=commonProgramValues(model,graph,state,unused,unused),
    target={kind:'bindingTarget',binding,type:i32TypeId};
  assert.equal(Object.hasOwn(target,'range'),false);
  values.store(target,entry.parameters[2],range,true);
  const parents=entry.instructions.filter(op=>op.name==='tsfg_program.env_parent');
  assert.ok(parents.length>0);
  for(const parent of parents){
    assert.ok(Number.isSafeInteger(parent.range.start)&&Number.isSafeInteger(parent.range.end));
    assert.deepEqual(parent.range,range);
  }
  const initialized=entry.instructions.find(op=>op.name==='tsfg_program.env_init');
  assert.ok(initialized);assert.equal(initialized.operands[0],parents.at(-1).result);
  assert.deepEqual(initialized.range,range);
});
