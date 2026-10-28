// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {callableFieldsModel} from './common-program-callable-fields-models.mjs';
for(const mode of ['constructor','assignment','initializer','alias','inherited'])test('whole owned callable field targets: '+mode,()=>{
  const {hir,range,expected}=callableFieldsModel(mode),flow=commonTargets(hir,commonMeter());
  assert.deepEqual(flow.site('root',range),{top:false,functions:expected});
});
for(const mode of ['unknown-writer','external','host','array','unknown-assertion','scalar-assertion','unproved-alias','unproved-view','erased-view','erased-binding','erased-parameter','erased-return','erased-storage'])test('unproved callable field targets stay TOP: '+mode,()=>{
  const {hir,range}=callableFieldsModel(mode);assert.equal(commonTargets(hir,commonMeter()).site('root',range).top,true);
});
test('fixed Host permission can rewrite passed storage despite a pure current body',()=>{
  const {hir,range}=callableFieldsModel('permission-host'),flow=commonTargets(hir,commonMeter()),records=new Map([...flow.contracts].map(([id,callables])=>[id,{callables,upper:{facets:{unknownHost:id==='sink'}}}]));
  assert.equal(flow.site('root',range).top,false);assert.equal(commonTargets(hir,commonMeter(),records).site('root',range).top,true);
});
test('fixed constructor Host permission can rewrite newly constructed storage',()=>{
  const {hir,range}=callableFieldsModel(),flow=commonTargets(hir,commonMeter()),records=new Map([...flow.contracts].map(([id,callables])=>[id,{callables,upper:{facets:{unknownHost:id==='ctor'}}}]));
  assert.equal(commonTargets(hir,commonMeter(),records).site('root',range).top,true);
});
test('fixed constructor parameter upper wins over selected instance arguments',()=>{
  const {hir,writer,range}=callableFieldsModel(),inferred=commonTargets(hir,commonMeter()),records=new Map([...inferred.contracts].map(([id,callables])=>[id,{callables}]));
  records.get('ctor').callables.parameters[0].allowed.functions.push('unrelated');writer.body=[];
  const fixed=commonTargets(hir,commonMeter(),records);assert.deepEqual(fixed.site('root',range),{top:false,functions:['left','right','unrelated']});
});
test('field target graph work is budgeted and cancellable',()=>{
  const {hir}=callableFieldsModel();assert.throws(()=>commonTargets(hir,commonMeter(10)),/** @param {any} e */e=>e.code==='r03-common-program-limit');
  let count=0;assert.throws(()=>commonTargets(hir,()=>{if(++count===40)throw Error('cancel');}),/cancel/);assert.equal(count,40);
});
