// SPDX-License-Identifier: MIT
// Pure proposed fixed-summary equations; not author-run. No Source/Program/VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonReturnOrigins} from '../../compiler/common-program-return-origins.mjs';

const sorted=values=>[...values].sort();
const setup=()=>{
  let remaining=2000000;const contracts=new Map(),spend=(units=1)=>{assert.ok(Number.isSafeInteger(units)&&units>=0&&units<=remaining);remaining-=units;};
  const actualType=type=>type==='C'?{kind:'value',fields:[{id:'box'}]}:{kind:type==='void'?'void':'reference',fields:[]};
  const make=(options={})=>commonReturnOrigins(spend,{contracts,actualType,...options});
  const publish=(id,graph)=>contracts.set(id,{graph,upper:null});return {make,publish};
};

test('fixed contexts keep unrelated reads out of a parameter return',()=>{
  const {make,publish}=setup(),pass=make(),p=pass.root('parameter','B',0);publish('pass',pass.snapshot(p,new Set()));
  const caller=make(),actual=caller.root('parameter','B',0),unrelated=caller.root('global','B','G');caller.access(unrelated,'read');
  const result=caller.call('pass',[actual],'B','pass');caller.access(result.normal,'write');
  assert.deepEqual(sorted(caller.owners(result.normal)),['p:0']);
  assert.deepEqual(sorted(caller.effects().accesses.get('write')),['p:0']);
});

test('fixed context entry heaps preserve read before write and p/q alias order',()=>{
  const {make,publish}=setup(),callee=make(),p=callee.root('parameter','Box',0),q=callee.root('parameter','Box',1),saved=callee.select(q,'field:owner','B','Box'),global=callee.root('global','B','G');
  callee.write(p,'field:owner',global,{view:'Box'});const after=callee.select(q,'field:owner','B','Box');
  publish('old',callee.snapshot(saved,new Set()));publish('after',callee.snapshot(after,new Set()));
  const caller=make(),box=caller.root('local','Box',null,'box'),old=caller.root('parameter','B',0);caller.write(box,'field:owner',old,{view:'Box',initialize:true});
  const entry=caller.checkpoint(),before=caller.call('old',[box,box],'B','old');assert.deepEqual(sorted(caller.owners(before.normal)),['p:0']);
  caller.restore(entry);const returned=caller.call('after',[box,box],'B','after');assert.deepEqual(sorted(caller.owners(returned.normal)),['g:G','p:0']);
});

test('clone initialization belongs to a saved fixed context heap',()=>{
  const {make,publish}=setup(),callee=make(),p=callee.root('parameter','i32',0);publish('copy',callee.snapshot(callee.copy(p,'i32','return'),new Set()));
  const caller=make(),original=caller.root('local','C',null,'original'),old=caller.root('global','B','G');caller.write(original,'field:box',old,{view:'C',initialize:true});
  const copied=caller.call('copy',[original],'i32','copy').normal,replacement=caller.root('global','B','H');caller.write(copied,'field:box',replacement,{view:'C'});
  assert.deepEqual(sorted(caller.owners(caller.select(original,'field:box','B','C'))),['g:G']);
  assert.deepEqual(sorted(caller.owners(caller.select(copied,'field:box','B','C'))),['g:G','g:H']);
});

test('unproductive recursive normal control cannot create a continuation write',()=>{
  const {make,publish}=setup(),callee=make(),p=callee.root('parameter','B',0),again=callee.call('forever',[p],'B','recurse');
  publish('forever',callee.snapshot(again.normal,new Set()));const caller=make(),actual=caller.root('parameter','B',0),result=caller.call('forever',[actual],'B','entry');
  caller.write(actual,'field:v',caller.root('global','B','G'),{view:'B'});
  assert.equal(caller.live(result.normalState),false);assert.deepEqual(sorted(caller.owners(result.normal)),[]);assert.equal(caller.effects().accesses.has('write'),false);
});

test('normal and language contexts retain lexical capture and parameter realms',()=>{
  const {make,publish}=setup(),callee=make(),p=callee.root('parameter','B',0),capture=callee.root('capture','B','slot');
  publish('choose',callee.snapshot(capture,p));const caller=make(),actual=caller.root('global','B','G'),result=caller.call('choose',[actual],'B','choose');
  assert.deepEqual(sorted(caller.owners(result.normal)),['c:slot']);assert.deepEqual(sorted(caller.owners(result.language)),['g:G']);
  assert.equal(caller.live(result.normalState),true);assert.equal(caller.live(result.languageState),true);
});

test('recursive projection contexts match left and right counts',()=>{
  const {make,publish}=setup(),callee=make(),p=callee.root('parameter','N',0),base=callee.checkpoint(),left=callee.select(p,'field:left','N','N'),nested=callee.call('F',[left],'N','recurse');
  const right=callee.select(nested.normal,'field:right','N','N');publish('F',callee.snapshot(callee.union([p,right]),new Set(),{normal:[base,nested.normalState],language:[]}));
  // This fixture supplies independent distinct-allocation evidence. It does
  // not qualify a Source allocator/M12 producer or infer noalias from names.
  const caller=make({mayAlias:(a,b)=>a.node.kind==='local'&&b.node.kind==='local'?a.id===b.id:true}),a=caller.root('local','N',null,'A'),l=caller.root('local','N',null,'L'),ll=caller.root('local','N',null,'LL'),lr=caller.root('local','N',null,'LR');
  const good=caller.root('global','N','G'),one=caller.root('global','N','H'),wrong=caller.root('global','N','Z');
  for(const [object,field,value]of /** @type {[Set<number>,string,Set<number>][]} */ ([[a,'left',l],[a,'right',wrong],[l,'left',ll],[l,'right',one],[ll,'right',lr],[lr,'right',good]]))caller.write(object,'field:'+field,value,{view:'N',initialize:true});
  const result=caller.call('F',[a],'N','entry');assert.deepEqual(sorted(caller.owners(result.normal)),['g:G','g:H','local:return-origin']);
});
