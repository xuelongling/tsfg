// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildHir} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildTypedLayouts,writeTypedLayoutModule,checkTypedLayoutBudget} from '../../compiler/typed-layouts.mjs';
async function input() {
  const bytes=await readFile(new URL('./testdata/typed-array-source-v8-probe.json',import.meta.url));
  const facts=readTypedArrayFacts(bytes),ctx={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,ctx);assert.equal(built.status,'ok');return {hir:built.hir,ctx};
}
test('actual shallow shared catalogue reserves finite work before ownership and writing',async()=>{
  const {hir,ctx}=await input();
  assert.throws(()=>buildTypedLayouts(hir,ctx,{work:1}),/r03-typed-layout: layout work limit/);
  assert.throws(()=>writeTypedLayoutModule(hir,ctx,{work:1}),/r03-typed-layout: layout work limit/);
});
test('actual shallow catalogue respects a lower containment depth',async()=>{
  const {hir,ctx}=await input();
  assert.throws(()=>buildTypedLayouts(hir,ctx,{depth:0}),/r03-typed-layout: layout depth limit/);
  assert.deepEqual(buildTypedLayouts(hir,ctx,{depth:1}),buildTypedLayouts(hir,ctx));
});

test('a two-level shared value/union DAG is charged by expanded occurrences',()=>{
  const id=name=>'sha256:'+createHash('sha256').update('test.physical-budget\0'+name).digest('hex');
  const leaf=(name,code)=>({typeId:id(name),byteSize:1,alignment:1,referenceCount:0,
    variants:[{tag:0,kind:'value',fields:[{offset:0,code}],references:[],children:[]}]});
  const value=(name,child)=>({typeId:id(name),byteSize:child.byteSize+2,alignment:2,referenceCount:0,
    variants:[{tag:0,kind:'value',fields:[],references:[],children:[{tagOffset:0,offset:2,referenceOffset:0,layout:child}]}]});
  const union=(name,left,right)=>({typeId:id(name),byteSize:Math.ceil((Math.max(left.byteSize,right.byteSize)+2)/2)*2,
    alignment:2,referenceCount:0,variants:[left,right].map((child,tag)=>({tag,kind:'value',fields:[],references:[],
      children:[{tagOffset:0,offset:2,referenceOffset:0,layout:child}]}))});
  const i8=leaf('i8',3),u8=leaf('u8',6),layouts=[i8,u8];let prior=union('U0',i8,u8);layouts.push(prior);
  for(let level=1;level<=2;level++) {
    const v=value('V'+level,prior),w=value('W'+level,prior);prior=union('U'+level,v,w);layouts.push(v,w,prior);
  }
  // Nine physical definitions, only a 12-byte root, and 227 expanded work.
  // This shallow fixture exercises sharing safely; it is not Source facts.
  const catalogue={entries:layouts.map(layout=>({typeId:layout.typeId,layout}))};
  function naiveCost(layout) {
    return 1+layout.variants.reduce((sum,variant)=>sum+1+variant.fields.length+variant.references.length+variant.children.length
      +variant.children.reduce((sum,child)=>sum+naiveCost(child.layout),0),0);
  }
  assert.equal(layouts.reduce((sum,layout)=>sum+naiveCost(layout),0),227);assert.equal(prior.byteSize,12);
  assert.deepEqual(checkTypedLayoutBudget(catalogue,{work:227,depth:5}),{work:227,depth:5});
  assert.throws(()=>checkTypedLayoutBudget(catalogue,{work:226}),/layout work limit/);
  assert.throws(()=>checkTypedLayoutBudget(catalogue,{depth:4}),/layout depth limit/);
  assert.throws(()=>checkTypedLayoutBudget(catalogue,{work:100001}),/invalid layout limits/);
  assert.throws(()=>checkTypedLayoutBudget(catalogue,{depth:33}),/invalid layout limits/);
});

test('actual ownership retains a frozen shared child after budget validation',async()=>{
  const {hir,ctx}=await input(),result=buildTypedLayouts(hir,ctx);
  const union=result.entries.find(entry=>entry.layout.variants.length>1).layout;
  const child=union.variants.flatMap(variant=>variant.children)[0].layout;
  assert.strictEqual(child,result.entries.find(entry=>entry.typeId===child.typeId).layout);
  assert.ok(Object.isFrozen(child)&&Object.isFrozen(child.variants)&&Object.isFrozen(union));
});
