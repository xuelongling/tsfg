// SPDX-License-Identifier: MIT
// These normalized owned-graph units carry no Source-production qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonMethodModel} from './common-program-model-cases.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {commonMethods} from '../../compiler/common-program-methods.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
const invocation=program=>program.plans.find(p=>p.owner.id==='entry').entry.instructions.find(op=>op.name==='tsfg_program.invoke_method');
for(const [mode,target,result]of /** @type {[string,string,number][]} */([['override','derived.m',3],['inherited','base.m',1],['structural','derived.m',3]]))
  test('normalized method graph selects actual implementation without changing receiver: '+mode,()=>{
    const program=commonMethodModel(mode),values=analyzeCommonGraphs(program),entry=[...values.actual.contexts.values()].find(c=>c.plan.owner.id==='entry');
    assert.equal(entry.normal,true);assert.equal(entry.returned.number,result);
    const calls=[...values.actual.contexts.values()].filter(c=>!c.root);assert.ok(calls.length);assert.ok(calls.every(c=>c.plan.owner.id===target));
    for(const c of calls){assert.equal(c.args[0].tags.size,1);for(const ref of c.args[0].refs)assert.equal(values.actual.objects.get(ref).type,[...c.args[0].tags][0]);}
  });
test('normalized method table rejects omissions, forged targets, signatures and noncanonical order',()=>{
  for(const mutate of [p=>p.dispatch.pop(),p=>{p.dispatch[0].target='missing';},p=>{p.signature_hash='forged';},p=>p.dispatch.reverse()]){
    const program=commonMethodModel();mutate(invocation(program).properties);
    assert.throws(()=>analyzeCommonGraphs(program),/** @param {any} e */e=>e.code==='r03-common-program-method');
  }
});
test('owned method selection rejects invalid override ancestry and charges before table publication',()=>{
  const program=commonMethodModel(),hir=program.model.hir;
  assert.throws(()=>commonMethods(hir,commonMeter(1)),/r03-common-program-limit/);
  const bad=structuredClone(hir);bad.functions.find(fn=>fn.id==='base.m').overrideTarget='derived.m';
  assert.throws(()=>commonMethods(bad,commonMeter()),/r03-common-program-method/);
  const skipped=structuredClone(hir);skipped.functions.find(fn=>fn.id==='derived.m').overrideTarget='base.m';
  assert.throws(()=>commonMethods(skipped,commonMeter()),/r03-common-program-method/);
  let remaining=100000;const spend=(n=1)=>{if(n>remaining)throw new TypeError('method-work-limit');remaining-=n;},directory=commonMethods(hir,spend);
  remaining=0;assert.throws(()=>directory.dispatch('base.m',hir.functions.find(fn=>fn.id==='base.m').ownerType),/method-work-limit/);
});
test('a concrete receiver view does not include its nominal siblings or ancestors',()=>{
  const {model}=commonMethodModel(),derived=model.functions.get('derived.m').ownerType,table=commonMethods(model.hir,commonMeter()).dispatch('base.m',derived);
  assert.deepEqual(table,[{receiver_type:derived,target:'derived.m',signature_hash:'unit:derived.m'}]);
});
function paddedCatalogue() {
  const hir=commonMethodModel().model.hir;
  for(let i=0;i<1024;i++){const id='unit:scalar'+i;hir.types.push(Object.assign({id,kind:'scalar',name:'i32'},{sourceType:id}));}
  return hir;
}
test('non-nominal catalogue validation consumes work beyond construction of the two indexes',()=>{
  const hir=paddedCatalogue();
  assert.throws(()=>commonMethods(hir,commonMeter(2*hir.types.length+64)),/r03-common-program-limit/);
  assert.equal(commonMethods(hir,commonMeter()).dispatch('base.m',hir.functions.find(fn=>fn.id==='base.m').ownerType).length,3);
});
test('non-nominal catalogue scans charge each method-view cache miss before publishing a table',()=>{
  const hir=paddedCatalogue();let remaining=100000;
  const spend=(n=1)=>{if(n>remaining)throw new TypeError('catalogue-work-limit');remaining-=n;},directory=commonMethods(hir,spend);
  for(const [member,count]of /** @type {[string,number][]} */([['base.m',3],['middle.m',2]])){
    const view=hir.functions.find(fn=>fn.id===member).ownerType;remaining=512;
    assert.throws(()=>directory.dispatch(member,view),/catalogue-work-limit/);
    remaining=100000;assert.equal(directory.dispatch(member,view).length,count);
    remaining=1;assert.equal(directory.dispatch(member,view).length,count,'only a complete successful table may enter the cache');
  }
});
