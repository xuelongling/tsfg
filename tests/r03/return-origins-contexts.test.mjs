// SPDX-License-Identifier: MIT
// Independent Graph4 fixed-summary premises. No Source/Program/VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonReturnOrigins} from '../../compiler/common-program-return-origins.mjs';

const sorted=values=>[...values].sort();
const protocol=(lexicalEnvironment=null,activationEnvironment=null)=>({lexicalEnvironment,activationEnvironment});
const setup=()=>{
  let remaining=2000000;const contracts=new Map(),spend=(units=1)=>{assert.ok(Number.isSafeInteger(units)&&units>=0&&units<=remaining);remaining-=units;};
  // Independent value-copy oracle: the one physical content slot is box in
  // the C view. It is not a Source field-to-M12 projection or a copy proof.
  const actualType=type=>type==='C'?{kind:'value',fields:[{id:'box',view:'C'}]}:{kind:type==='void'?'void':type==='i32'?'scalar':'reference',fields:[]};
  const environments=new Map([['E',{parent:null,slots:[{key:'slot',type:'B',writable:false}]}]]);
  const make=(options={})=>commonReturnOrigins(spend,{contracts,actualType,environments,rootProtocol:protocol(),...options});
  const publish=(id,graph,selected=protocol())=>contracts.set(id,{graph,upper:null,protocol:selected});return {make,publish};
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
  const {make,publish}=setup();
  // The fixed recursive equation exists before any caller is solved. Its
  // literal control has no base return and is not derived from a body result.
  publish('forever',{format:{family:'tsfg.return-origin-graph-candidate',version:4},
    nodes:[{kind:'parameter',type:'B',index:0},{kind:'call',type:'B',call:0,completion:'normal'}],
    heaps:[{kind:'entry'},{kind:'call',call:0,completion:'normal'}],controls:[{kind:'entry'},{kind:'call',call:0,completion:'normal'}],
    calls:[{functionId:'forever',arguments:[[0]],environment:null,callee:null,heap:0,control:0,site:'recurse'}],
    normal:[1],language:[],exits:{normal:[{heap:1,control:1}],language:[]},accesses:[]});
  const caller=make(),actual=caller.root('parameter','B',0),result=caller.call('forever',[actual],'B','entry');
  caller.write(actual,'field:v',caller.root('global','B','G'),{view:'B'});
  assert.equal(caller.live(result.normalState),false);assert.deepEqual(sorted(caller.owners(result.normal)),[]);assert.equal(caller.effects().accesses.has('write'),false);
});

test('normal and language contexts retain lexical capture and parameter realms',()=>{
  const {make,publish}=setup(),callee=make({rootProtocol:protocol('E')}),p=callee.root('parameter','B',0),capture=callee.capture(callee.environmentInput('E'),'E','slot','B');
  publish('choose',callee.snapshot(capture,p),protocol('E'));
  const caller=make({rootProtocol:protocol('E')}),actual=caller.root('global','B','G'),result=caller.call('choose',[actual],'B','choose',{environment:caller.environmentInput('E')});
  assert.deepEqual(sorted(caller.owners(result.normal)),['c:slot']);assert.deepEqual(sorted(caller.owners(result.language)),['g:G']);
  assert.equal(caller.live(result.normalState),true);assert.equal(caller.live(result.languageState),true);
});

test('recursive projection contexts match left and right counts',()=>{
  const {make,publish}=setup();
  // Independent equation F(x) = x | F(x.left).right, with the recursive
  // projection reading that invocation's returned heap and continuation.
  publish('F',{format:{family:'tsfg.return-origin-graph-candidate',version:4},
    nodes:[{kind:'parameter',type:'N',index:0},{kind:'projection',type:'N',bases:[0],selector:'field:left',view:'N',heap:0,control:0},
      {kind:'call',type:'N',call:0,completion:'normal'},{kind:'projection',type:'N',bases:[2],selector:'field:right',view:'N',heap:1,control:1}],
    heaps:[{kind:'entry'},{kind:'call',call:0,completion:'normal'}],controls:[{kind:'entry'},{kind:'call',call:0,completion:'normal'}],
    calls:[{functionId:'F',arguments:[[1]],environment:null,callee:null,heap:0,control:0,site:'recurse'}],
    normal:[0,3],language:[],exits:{normal:[{heap:0,control:0},{heap:1,control:1}],language:[]},accesses:[]});
  // This fixture supplies independent distinct-allocation evidence. It does
  // not qualify a Source allocator/M12 producer or infer noalias from names.
  const caller=make({mayAlias:(a,b)=>a.node.kind==='local'&&b.node.kind==='local'?a.id===b.id:true}),a=caller.root('local','N',null,'A'),l=caller.root('local','N',null,'L'),ll=caller.root('local','N',null,'LL'),lr=caller.root('local','N',null,'LR');
  const good=caller.root('global','N','G'),one=caller.root('global','N','H'),wrong=caller.root('global','N','Z');
  for(const [object,field,value]of /** @type {[Set<number>,string,Set<number>][]} */ ([[a,'left',l],[a,'right',wrong],[l,'left',ll],[l,'right',one],[ll,'right',lr],[lr,'right',good]]))caller.write(object,'field:'+field,value,{view:'N',initialize:true});
  const result=caller.call('F',[a],'N','entry');assert.deepEqual(sorted(caller.owners(result.normal)),['g:G','g:H','local:return-origin']);
});
