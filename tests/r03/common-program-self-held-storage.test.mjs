// SPDX-License-Identifier: MIT
// Private actual-flow adapter models, never synthesized ProgramFacts or execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonBorrowObservations} from '../../compiler/common-program-borrow-observations.mjs';
function model(mode='complete'){
  const value=(tag,refs=[],number=null,unknown=false)=>({tags:new Set([tag]),refs:new Set(refs),cells:new Set(),pairs:new Map(),number,unknown,truth:0,region:{roots:new Set(),opaque:false,empty:true}});
  const fields=[{id:'owner',type:'array',readonly:true},{id:'span',type:'span',readonly:mode!=='mutable-descriptor'}],
    types=new Map([['i32',{id:'i32',kind:'scalar'}],['array',{id:'array',kind:'array',elementType:'i32'}],['span',{id:'span',kind:'readSpan',elementType:'i32'}],
      ['holder',{id:'holder',kind:'reference',fields}],['out-array',{id:'out-array',kind:'array',elementType:'holder'}]]),
    objects=new Map([['out',{type:'out-array',weak:true}],['a',{type:'array',weak:mode==='weak-owner'}],['b',{type:'array',weak:false}],['s',{type:'span',weak:false}],['h',{type:'holder',weak:false}]]),
    out=value('out-array',['out']),a=value('array',['a']),b=value('array',['b']),span=value('span',['s']),h=value('holder',['h']),
    heap=new Map([['out/element/*',value('holder',[],null,true)],['a/length',value('i32',[],1)],['a/element/0',value('i32',[],1)],
      ['b/length',value('i32',[],1)],['b/element/0',value('i32',[],2)],['s/owner',value('array',mode==='may-owner'?['a','b']:['a'])],
      ['s/start',value('i32',[],0)],['s/length',value('i32',[],1)],['h/field/owner',a],['h/field/span',mode==='unknown-descriptor'?value('span',['s'],null,true):span]]);
  let work=0;const spend=(count=1)=>{work+=count;assert.ok(work<100000,'bounded private model work');},
    owner={id:'unit:run',kind:'function-body',sourcePath:'/unit25af.ts'},plan={owner,entry:{name:'entry'},graph:{registers:new Map([['other',{view:'span'}]])}},
    c={id:'unit:activation',root:true,args:[out],entryHeap:new Map(heap),plan,regionScope:''},state={heap,regions:new Map()},
    observer=commonBorrowObservations({model:{spend,types,fields:new Map(fields.map(row=>[row.id,row])),environments:new Map()},objects});
  observer.begin(c,heap);let previous=observer.block(c,'entry');
  const step=(at,name,args=[],result=null,view=null)=>{
    observer.edge(previous,at);const op={name:'tsfg_program.'+name,operands:name==='array_read'?['other']:[],properties:{},range:{start:at==='store'?100:200,end:at==='store'?110:210},view};
    const covered=observer.before(c,op,state,args,at);if(result)observer.after(c,op,state,result,at);previous=at;return covered;
  };
  step('a','array_create',[],a);step('b','array_create',[],b);step('s','readspan',[],span,'span');step('h','allocate_reference',[],h);
  if(mode==='other-live'){
    objects.set('other-array',{type:'array',weak:true});objects.set('other-span',{type:'span',weak:false});
    heap.set('other-span/owner',value('array',['other-array']));heap.set('other-span/start',value('i32',[],0));heap.set('other-span/length',value('i32',[],1));
    step('other-definition','readspan',[],value('span',['other-span']),'span');
  }
  const covered=step('store','array_store',[out,value('i32',[],0),h]);
  if(mode==='post-resize')step('resize','array_resize',[a,value('i32',[],0)]);
  if(mode==='other-live')step('other-use','array_read',[value('span',['other-span']),value('i32',[],0)]);
  step('return','func.return');return {covered,finish:()=>observer.finish()};
}
test('stable external storage keeps complete readonly ownership',()=>{const run=model();assert.equal(run.covered,true);assert.ok(run.finish().borrows>0);});
for(const mode of ['weak-owner','may-owner','mutable-descriptor','unknown-descriptor'])test('stable external storage rejects '+mode,()=>{
  const run=model(mode);assert.equal(run.covered,false);assert.throws(run.finish,error=>error instanceof Error&&error.code==='r03-common-program-borrow-pending'&&error.primary.start===100&&error.primary.end===110);
});
test('stable external storage keeps the descriptor live after transfer',()=>{const run=model('post-resize');assert.equal(run.covered,true);
  assert.throws(run.finish,error=>error instanceof Error&&error.code==='r03-common-program-borrow-conflict'&&error.primary.start===200&&error.primary.end===210);
});
test('stable external storage separation does not bless other active owners',()=>{const run=model('other-live');assert.equal(run.covered,true);
  assert.throws(run.finish,error=>error instanceof Error&&error.code==='r03-common-program-borrow-pending'&&error.primary.start===100&&error.primary.end===110);
});
