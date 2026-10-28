// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonRegions,emptyRegionValue} from '../../compiler/common-program-regions.mjs';
function fixture(){
 const domain=commonRegions(commonMeter(100000)),heap=new Map(),scope=domain.scope('loop','factory-call');
 const make=(reference,type='env:Reader')=>domain.allocate(scope,'verified-activation',reference,type,heap);
 return {domain,heap,scope,make};
}
test('a current receiver can contain an older value without discarding that alternative',()=>{
 const {domain:d,heap,scope,make}=fixture(),env=make('environment'),array=make('array','Array');
 d.age(array,scope);d.store(env,'owner',array,heap);const loaded=d.load(env,'owner',heap);
 assert.equal(loaded.opaque,true);assert.equal(d.closed(loaded,scope),false);
});
test('an old receiver cannot borrow the fields of the next current receiver version',()=>{
 const {domain:d,heap,scope,make}=fixture(),old=make('environment'),first=make('array','Array');
 d.store(old,'owner',first,heap);d.age(old,scope);
 const current=make('environment'),second=make('array','Array');d.store(current,'owner',second,heap);
 assert.equal(d.closed(d.load(current,'owner',heap),scope),true);
 assert.equal(d.closed(d.load(old,'owner',heap),scope),false);
});
test('different invocations of the same raw reference remain different origin relations',()=>{
 const {domain:d,heap,scope,make}=fixture(),left=make('same-environment'),rightScope=d.scope('loop','another-factory-call'),
 right=d.allocate(rightScope,'verified-activation','same-environment','env:Reader',heap);
 assert.notDeepEqual([...left.roots],[...right.roots]);assert.equal(d.closed(right,scope),false);
});
test('joining current with older or an empty companion never gives complete current ownership',()=>{
 const {domain:d,heap,scope,make}=fixture(),value=make('environment'),old=d.copy(value);
 d.age(old,scope);d.merge(value,old);assert.equal(d.closed(value,scope),false);
 const separate=make('other-environment'),empty=emptyRegionValue();empty.empty=true;d.merge(separate,empty);
 assert.equal(d.closed(separate,scope),false);
});
test('an outward use blocks the whole related current graph rather than just its outer node',()=>{
 const {domain:d,heap,scope,make}=fixture(),env=make('environment'),array=make('array','Array');
 d.store(env,'owner',array,heap);d.escape(env,heap);assert.equal(d.closed(array,scope),false);
});
test('region copying charges before visiting evidence roots',()=>{
 const spend=commonMeter(1);spend();
 const d=commonRegions(spend),value={...emptyRegionValue(),roots:{size:1,[Symbol.iterator](){throw new Error('unpaid traversal');}}};
 assert.throws(()=>d.copy(value),/** @param {any} e */e=>e.code==='r03-common-program-limit');
});

function holdingArray(){
 const f=fixture(),{domain:d,heap,make}=f,root=make('reader'),owner=make('backing','OwnerArray'),
  holder=make('holder','HolderArray'),span=make('view','Span'),types=new Map([
   ['OwnerArray',{kind:'array',elementType:'i32'}],['HolderArray',{kind:'array',elementType:'OwnerArray'}],['Span',{kind:'readSpan',elementType:'i32'}]]);
 d.store(span,'owner',owner,heap);d.store(root,'slot/view',span,heap);d.store(root,'slot/holder',holder,heap);
 d.store(holder,'element/0',owner,heap);d.store(holder,'length',d.number(1),heap);
 return {...f,root,owner,holder,types,held:()=>d.holds(root,heap,'view','backing',f.scope,types)};
}
test('a current owning Array element retains the backing through growth',()=>{
 const {domain:d,heap,holder,held}=holdingArray();assert.equal(held(),true);
 d.store(holder,'length',d.number(2),heap);assert.equal(held(),true);
});
test('an unknown index overwrite cannot turn a may element into a must owner',()=>{
 const {domain:d,heap,make,holder,held}=holdingArray();d.store(holder,'element/*',make('other','OwnerArray'),heap);
 assert.equal(held(),false);
});
test('shrinking then growing cannot revive an old owning element',()=>{
 const {domain:d,heap,holder,held}=holdingArray();d.store(holder,'length',d.number(0),heap);
 d.store(holder,'length',d.number(1),heap);assert.equal(held(),false);
});
test('a possibly pure companion cannot lend an owner to the sibling descriptor path',()=>{
 const {domain:d,heap,make,root,owner,types,held}=holdingArray(),companion=make('companion');
 d.store(companion,'slot/owner',owner,heap);companion.empty=true;
 d.store(root,'slot/holder',companion,heap);assert.equal(held(),false);
});
for(const reverse of [false,true])test('joining an absent owning element preserves the empty branch: '+reverse,()=>{
 const {domain:d,heap,holder,held}=holdingArray(),other=d.heapCopy(heap),truncated=reverse?heap:other;
 d.store(holder,'length',d.number(0),truncated);d.store(holder,'length',d.number(1),truncated);
 d.heapJoin(heap,other);assert.equal(held(),false);
});
function irreducible(outer=false){
 const operation=(name,operands,successors)=>({name,operands,successors,result:null}),
  branch=to=>operation('cf.br',[],[to]),condition=(a,b)=>operation('cf.cond_br',['%condition'],[a,b]),
  blocks=[{name:'entry',parameters:[{name:'%condition'}],instructions:[outer?branch('header'):condition('A','B')]}];
 if(outer)blocks.push({name:'header',parameters:[],instructions:[condition('A','B')]});
 blocks.push({name:'A',parameters:[],instructions:[branch('B')]},
  {name:'B',parameters:[],instructions:[condition('A',outer?'latch':'exit')]});
 if(outer)blocks.push({name:'latch',parameters:[],instructions:[condition('header','exit')]});
 blocks.push({name:'exit',parameters:[],instructions:[operation('func.return',[],[])]});
 const domain=commonRegions(commonMeter(100000)),id='irreducible';domain.prepare([{owner:{id},entry:blocks[0],graph:{blocks}}]);
 return {domain,id,layout:domain.layouts.get(id)};
}
test('a double-entry CFG SCC is not an acyclic callee',()=>{
 const {layout}=irreducible();assert.equal(layout.loops.size,0);assert.equal(layout.acyclic,false);
});
test('an outer natural loop cannot hide an uncovered inner CFG cycle',()=>{
 const {domain,id,layout}=irreducible(true);assert.ok(layout.loops.has('header'));
 assert.equal(domain.loopAt(id,'A'),null);
});
test('an outward store into another invocation blocks the referent region',()=>{
 const {domain:d,heap,scope,make}=fixture(),value=make('held'),owner=make('backing','Array'),
  other=d.scope('loop','other-invocation'),receiver=d.allocate(other,'verified-activation','caller-storage','env:Caller',heap);
 d.store(value,'slot/owner',owner,heap);d.store(receiver,'slot/saved',value,heap,true);
 assert.equal(d.closed(owner,scope),false);
});
test('region prepare prepays a straight-line instruction scan with no successor edges',()=>{
 const instructions=Array.from({length:256},(_,index)=>({name:'tsfg_program.constant',operands:[],successors:[],result:'%v'+index})),
  entry={name:'entry',parameters:[],instructions:[...instructions,{name:'func.return',operands:['%v255'],successors:[],result:null}]},
  domain=commonRegions(commonMeter(64));
 assert.throws(()=>domain.prepare([{owner:{id:'straight-line'},entry,graph:{blocks:[entry]}}]),
  /** @param {any} error */error=>error.code==='r03-common-program-limit');
});
test('region feedback prepays empty version rows before walking them',()=>{
 const setup=commonMeter(100000),remaining=commonMeter(2);let feedback=false;
 const d=commonRegions(amount=>(feedback?remaining:setup)(amount)),
  entry={name:'header',parameters:[],instructions:[{name:'cf.br',operands:[],successors:['header'],result:null}]},
  plan={owner:{id:'empty-row-loop'},entry,graph:{blocks:[entry]}},scope=d.scope('caller/header','factory'),
  state={values:new Map(),heap:new Map(),regions:new Map()};
 d.prepare([plan]);for(let index=0;index<100;index++)d.allocate(scope,'factory','empty-'+index,'env:Empty',state.regions);
 feedback=true;
 assert.throws(()=>d.feedback({id:'caller',plan},'header','header',state),
  /** @param {any} error */error=>error.code==='r03-common-program-limit');
});
