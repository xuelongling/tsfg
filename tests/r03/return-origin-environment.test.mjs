// SPDX-License-Identifier: MIT
// Handwritten admitted-shape HIR and fixed graph premises only. These are not
// Frontend facts, Scope admission, physical/GC authority or program execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonReturnOriginSource} from '../../compiler/common-program-return-origin-source.mjs';
const commonEffects=(hir,spend,physical=null,storage=null,kinds=null,rows=null)=>commonReturnOriginSource(hir,spend,physical,storage,kinds,rows===null?null:new Map([...rows].map(([id,row])=>{const {returnOrigins,...upper}=row.upper;return [id,{...row,upper,returnOrigins}];})));
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {solveReturnOriginContexts} from '../../compiler/common-program-return-origin-domain.mjs';
import {commonReturnOriginDirectories} from '../../compiler/common-program-return-origin-directories.mjs';
import {readCommonReturnOriginGraph} from '../../compiler/common-program-return-origin-graph.mjs';
import {commonReturnOriginsInclusion} from '../../compiler/common-program-return-origin-inclusion.mjs';
import {signatureId} from '../../compiler/module-callable-common.mjs';

const B='fixture:B',V='fixture:B/v',Fn='fixture:Reader',E='fixture:FactoryEnv',S='fixture:FactoryEnv/p',P='make/p';
const Make='make',Read='read',Caller='caller',range={start:0,end:100},sourcePath='/environment-fixture.ts';
/** @type {{lexicalEnvironment:string|null,activationEnvironment:string|null}} */
const none={lexicalEnvironment:null,activationEnvironment:null};
const protocol=(lexicalEnvironment=null,activationEnvironment=null)=>({lexicalEnvironment,activationEnvironment});
/** @returns {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
const emptyGraph=()=>({format:{family:'tsfg.return-origin-graph-candidate',version:5},nodes:[],heaps:[{kind:'entry'}],controls:[{kind:'entry'}],calls:[],normal:[],language:[],exits:{normal:[{heap:0,control:0}],language:[]},accesses:[]});
/** @param {import('../../compiler/common-program-return-origin-graph.mjs').Graph} returnOrigins */
const upper=(returnOrigins,parameters=[],captures=[])=>({returnOrigins,parameters:parameters.map((_,index)=>({index,read:false,write:false,structural:false})),captures,
  globals:{reads:[],writes:[]},hostResources:{reads:[],writes:[]},facets:{allocation:false,managedReference:false,ehControl:false,mayThrow:false,await:false,lock:false,escape:false,unknownHost:false}});
// Independent fixed contracts: make stores its parameter in a fresh Env and
// returns exactly Code{read,that Env}; read returns that Env's captured payload.
// No expected upper is computed from effects.derived() or the current body.
/** @returns {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
const readGraph=()=>({...emptyGraph(),nodes:[{kind:'environmentInput',type:null,layout:E},
  {kind:'capture',type:B,id:S,layout:E,environment:[0],heap:0,control:0}],normal:[1]});
/** @returns {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
const makeGraph=()=>({...emptyGraph(),nodes:[{kind:'parameter',type:B,index:0},
  {kind:'environmentCreate',type:null,layout:E,parent:null,site:'fixed:activation',control:0},
  {kind:'code',type:Fn,functionId:Read,environment:[1],control:0}],
  heaps:[{kind:'entry'},{kind:'store',previous:0,bases:[1],selector:'capture:'+S,view:'env:'+E,values:[0],initialize:true,control:0}],normal:[2],exits:{normal:[{heap:1,control:0}],language:[]}});
/** @param {{lexicalParent?:string|null,lexicalEnvironment?:string|null,activationEnvironment?:string|null,captures?:{binding:string,read:boolean,write:boolean}[]}} [extra] */
const fn=(id,parameters,returnType,body,extra={})=>({id,name:id,kind:'source',sourceBinding:'raw:'+id,sourcePath,range,parameters,bindings:[],captures:[],returnType,body,
  signatureHash:signatureId({parameters:parameters.map(row=>row.type),returns:returnType}),ownerType:null,receiverBinding:null,lexicalParent:null,...none,...extra});
const ref=(binding,type=B,start=10)=>({kind:'bindingReference',binding,type,range:{start,end:start+1}});
const direct=(callee,args,type,start)=>({kind:'call',callee,arguments:args,type,signature:{parameters:args.map(row=>row.type),returnType:type},range:{start,end:start+5}});
const invoke=(value,start)=>({kind:'indirectCall',expression:value,arguments:[],type:B,signature:{parameters:[],returnType:B},range:{start,end:start+5}});
const writeV=(receiver,start=70)=>({kind:'expression',range:{start,end:start+10},value:{kind:'fieldAssignment',type:'i32',operator:'=',range:{start,end:start+9},
  target:{kind:'fieldTarget',type:'i32',property:V,receiver,range:{start,end:start+6}},value:{kind:'integerLiteral',type:'i32',token:'1',decimal:'1',range:{start:start+8,end:start+9}}}});
const hirRows=functions=>({rootFile:sourcePath,types:[{id:B,kind:'reference',name:'B',sourceType:'raw:B',methods:[],fields:[{id:V,sourceBinding:'raw:B/v',name:'v',type:'i32',readonly:false}]},
  {id:'i32',kind:'scalar',name:'i32'},{id:'void',kind:'void',name:'void'},{id:'bool',kind:'scalar',name:'bool'},{id:Fn,kind:'function',parameters:[],returnType:B}],functions,globals:[],
  environments:[{id:E,owner:Make,parent:null,slots:[{key:S,binding:P,type:B,writable:false,kind:'local'}]}],hostImports:[],hostContext:null,modules:[],closure:{roots:[],requiredRoots:[]},snapshot:{payload:{compatibilityWitnesses:[]}}});
const noTransfer=()=>({parameters:[],returns:null,slotWrites:[]});
function fixture(){
  const make=fn(Make,[{id:'make/input',type:B,writable:true}],Fn,[{kind:'constDeclaration',binding:P,range,initializer:ref('make/input')},
    {kind:'return',range,value:{kind:'functionReference',functionId:Read,type:Fn,range}}],{activationEnvironment:E});make.bindings=[{id:P,type:B,writable:false}];
  const read=fn(Read,[],B,[{kind:'return',range,value:ref(P)}],{lexicalParent:Make,lexicalEnvironment:E,captures:[{binding:P,read:true,write:false}]});
  const caller=fn(Caller,[{id:'entry/p',type:B},{id:'entry/q',type:B}],'void',[
    {kind:'constDeclaration',binding:'first',range:{start:20,end:29},initializer:direct(Make,[ref('entry/p')],Fn,20)},
    {kind:'constDeclaration',binding:'second',range:{start:40,end:49},initializer:direct(Make,[ref('entry/q')],Fn,40)},
    writeV(invoke(ref('first',Fn,60),60))
  ]);caller.bindings=[{id:'first',type:Fn,writable:false},{id:'second',type:Fn,writable:false}];
  const hir=hirRows([caller,make,read]),makeUpper=upper(makeGraph(),[B]),readUpper=upper(readGraph(),[],[{slot:S,read:true,write:false,structural:false}]);
  makeUpper.facets.allocation=true;makeUpper.facets.managedReference=true;makeUpper.facets.escape=true;readUpper.facets.managedReference=true;
  const records=new Map([[Make,{upper:makeUpper,callables:{...noTransfer(),returns:{top:false,functions:[Read]}}}],
    [Read,{upper:readUpper,callables:noTransfer()}],[Caller,{upper:upper(emptyGraph(),[B,B]),callables:noTransfer()}]]);
  return {hir,caller,make,read,records};
}
const uppers=records=>new Map([...records].map(([id,row])=>[id,row.upper]));
function extract(input){
  // The fixed table wins even over an existing body-observation provider.
  const spend=commonMeter(1000000),physical={references:new Map(),escaping:new Map(),model:{callables:{site(){assert.fail('fixed record targets must take precedence');}}}},
    effects=commonEffects(input.hir,spend,physical,null,null,input.records),body=effects.derive(input.caller,uppers(input.records)).upper;
  return {effects,body,spend};
}
const callbacks=input=>({projectField:()=>null,mayAlias:()=>true,actualType:id=>({kind:id===B?'reference':id===Fn?'function':id==='void'?'void':'scalar',fields:[]}),
  environments:new Map(input.hir.environments.map(row=>[row.id,row])),rootProtocol:none});
const fixed=input=>new Map([...input.records].map(([id,row])=>{
  const owner=input.hir.functions.find(fn=>fn.id===id);assert.ok(owner);
  return [id,{graph:row.upper.returnOrigins,upper:row.upper,protocol:protocol(owner.lexicalEnvironment,owner.activationEnvironment)}];
}));

test('draft5 ordinary control: an environment-free parameter return keeps its owner',()=>{
  const Relay='ordinaryRelay',relay=fn(Relay,[{id:'relay/p',type:B}],B,[{kind:'return',range,value:ref('relay/p')}]),
    caller=fn(Caller,[{id:'entry/p',type:B}],'void',[writeV(direct(Relay,[ref('entry/p')],B,30))]),hir=hirRows([caller,relay]);hir.environments=[];
  const records=new Map([[Relay,{upper:upper({...emptyGraph(),nodes:[{kind:'parameter',type:B,index:0}],normal:[0]},[B]),callables:noTransfer()}],
    [Caller,{upper:upper(emptyGraph(),[B]),callables:noTransfer()}]]);
  const {body,spend}=extract({hir,caller,records});assert.equal(body.parameters[0].write,true);
  const owned=commonReturnOriginDirectories(hir,spend).read(Caller,body.returnOrigins);assert.ok(owned.status==='typed');
  assert.deepEqual(owned.graph.format,{family:'tsfg.return-origin-graph-candidate',version:5},'the owning reader must return draft5, not restamp it as draft3');
});

test('Source: same FnId from two activations retains each saved Code environment',()=>{
  const input=fixture(),{body,spend}=extract(input);
  assert.equal(body.parameters[0].write,true,'saved first closure still writes p');
  assert.equal(body.parameters[1].write,false,'creating a second same-Fn closure does not redirect the first to q');
  assert.equal(commonReturnOriginDirectories(input.hir,spend).read(Caller,body.returnOrigins).status,'typed');
  input.caller.body.push(writeV(invoke(ref('second',Fn,85),85),90));
  const both=extract(input).body;assert.equal(both.parameters[0].write,true);assert.equal(both.parameters[1].write,true);
});

test('Source: an ordinary wrapper does not merge different arguments at its one factory callsite',()=>{
  const input=fixture(),Wrap='wrapFactory',wrap=fn(Wrap,[{id:'wrap/p',type:B}],Fn,[{kind:'return',range,value:direct(Make,[ref('wrap/p')],Fn,30)}]);
  input.hir.functions.push(wrap);input.caller.body[0].initializer.callee=Wrap;input.caller.body[1].initializer.callee=Wrap;
  /** @type {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
  const graph={...emptyGraph(),nodes:[{kind:'parameter',type:B,index:0},{kind:'call',type:Fn,call:0,completion:'normal'}],
    heaps:[{kind:'entry'},{kind:'call',call:0,completion:'normal'}],controls:[{kind:'entry'},{kind:'call',call:0,completion:'normal'}],
    calls:[{functionId:Make,arguments:[[0]],environment:null,callee:null,receiver:null,heap:0,control:0,site:'one-fixed-make-site'}],normal:[1],exits:{normal:[{heap:1,control:1}],language:[]}};
  const declared=upper(graph,[B]);declared.facets.allocation=true;declared.facets.managedReference=true;declared.facets.escape=true;
  input.records.set(Wrap,{upper:declared,callables:{...noTransfer(),returns:{top:false,functions:[Read]}}});
  const {body}=extract(input);assert.equal(body.parameters[0].write,true);assert.equal(body.parameters[1].write,false);
});

test('Source: activation/code production and readonly captured payload writes use draft5',()=>{
  const input=fixture(),spend=commonMeter(1000000),effects=commonEffects(input.hir,spend,null,null,null,input.records),produced=effects.derive(input.make,uppers(input.records)).upper;
  assert.ok(produced.returnOrigins.nodes.some(row=>row.kind==='environmentCreate'));
  assert.ok(produced.returnOrigins.nodes.some(row=>row.kind==='code'&&row.functionId===Read));
  assert.equal(commonReturnOriginDirectories(input.hir,spend).read(Make,produced.returnOrigins).status,'typed');
  input.read.body=[writeV(ref(P)),{kind:'return',range,value:ref(P)}];
  const captureEffects=commonEffects(input.hir,spend,null,null,null,input.records),body=captureEffects.derive(input.read,uppers(input.records)).upper;
  assert.equal(input.hir.environments[0].slots[0].writable,false);
  assert.equal(body.captures.find(row=>row.slot===S).write,true,'readonly binding is not immutable payload');
  assert.equal(captureEffects.covers(input.records.get(Read).upper,body,uppers(input.records)),false,'a fixed read-only capture permission cannot cover a payload write');
  assert.equal(commonReturnOriginDirectories(input.hir,spend).read(Read,body.returnOrigins).status,'typed');
});

test('Source: fixed callee upper is not narrowed to its current captured-return body',()=>{
  const input=fixture(),G='fixture:allowed-global';input.hir.globals.push({id:G,sourceBinding:'raw:G',type:B,writable:false});
  const published=input.records.get(Read).upper;
  published.returnOrigins.nodes.push({kind:'global',type:B,id:G});published.returnOrigins.normal=[1,2];
  const {effects,body}=extract(input);assert.deepEqual(body.globals.writes,[G]);assert.equal(body.parameters[0].write,true);
  const narrower=uppers(input.records),observed=structuredClone(published);observed.returnOrigins=readGraph();narrower.set(Read,observed);
  assert.deepEqual(effects.derive(input.caller,narrower).upper.globals.writes,[G],'a caller-supplied current-body table cannot override the owned fixed archive');
  const masked=structuredClone(body);masked.globals.writes=[];
  assert.equal(effects.covers(masked,body,uppers(input.records)),false,'dropping the independently published alternative is effects-open');
});

test('Source: a shared captured-cell rebind is a weak slot store, not a write to the new payload',()=>{
  const input=fixture(),Setter='replace';input.hir.environments[0].slots[0].writable=true;input.make.bindings[0].writable=true;input.make.body[0].kind='letDeclaration';
  const setter=fn(Setter,[{id:'replace/q',type:B}],B,[{kind:'expression',range,value:{kind:'bindingAssignment',operator:'=',type:B,range,
    target:{kind:'bindingTarget',binding:P,type:B,range},value:ref('replace/q')}},{kind:'return',range,value:ref(P)}],
    {lexicalParent:Make,lexicalEnvironment:E,captures:[{binding:P,read:true,write:true}]});
  input.hir.functions.push(setter);
  /** @type {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
  const bound={...emptyGraph(),nodes:[{kind:'environmentInput',type:null,layout:E},{kind:'parameter',type:B,index:0},
    {kind:'capture',type:B,id:S,layout:E,environment:[0],heap:1,control:0}],heaps:[{kind:'entry'},{kind:'store',previous:0,bases:[0],selector:'capture:'+S,view:'env:'+E,values:[1],initialize:false,control:0}],normal:[2],exits:{normal:[{heap:1,control:0}],language:[]}};
  const declared=upper(bound,[B],[{slot:S,read:true,write:true,structural:false}]);declared.facets.managedReference=true;declared.facets.escape=true;
  input.records.set(Setter,{upper:declared,callables:noTransfer()});
  const spend=commonMeter(1000000),effects=commonEffects(input.hir,spend,null,null,null,input.records),body=effects.derive(setter,uppers(input.records)).upper;
  assert.equal(body.captures.find(row=>row.slot===S).write,true);assert.equal(body.parameters[0].write,false);
  const solved=solveReturnOriginContexts(body.returnOrigins,fixed(input),{...callbacks(input),rootProtocol:protocol(E)},spend);
  assert.deepEqual([...solved.owners(body.returnOrigins.normal)].sort(),['c:'+S,'p:0'].sort(),'shared slots conservatively retain the entry and assigned payload');
  assert.equal(commonReturnOriginDirectories(input.hir,spend).read(Setter,body.returnOrigins).status,'typed');
});

test('draft5: repeated static activation summary weakly retains earlier and later slot payloads',()=>{
  const input=fixture(),graph={...emptyGraph(),nodes:[{kind:'parameter',type:B,index:0},{kind:'parameter',type:B,index:1},
    {kind:'environmentCreate',type:null,layout:E,parent:null,site:'one-static-allocation',control:0},
    {kind:'code',type:Fn,functionId:Read,environment:[2],control:0},
    {kind:'environmentComponent',type:null,layout:E,functionId:Read,callee:[3],control:0},{kind:'call',type:B,call:0,completion:'normal'}],
    heaps:[{kind:'entry'},{kind:'store',previous:0,bases:[2],selector:'capture:'+S,view:'env:'+E,values:[0],initialize:true,control:0},
      {kind:'store',previous:1,bases:[2],selector:'capture:'+S,view:'env:'+E,values:[1],initialize:false,control:0},{kind:'call',call:0,completion:'normal'}],
    controls:[{kind:'entry'},{kind:'call',call:0,completion:'normal'}],calls:[{functionId:Read,arguments:[],environment:[4],callee:[3],receiver:null,heap:2,control:0,site:'same-summary-read'}],
    normal:[5],exits:{normal:[{heap:3,control:1}],language:[]}};
  const result=solveReturnOriginContexts(graph,fixed(input),{...callbacks(input),rootProtocol:protocol(null,E)},commonMeter(1000000));
  assert.deepEqual([...result.owners(graph.normal)].sort(),['p:0','p:1'],'weak summary is not a unique last instance or a concrete equality claim');
});

test('draft5 typed directory: parent capture follows the admitted actual layout chain',()=>{
  // An independently handwritten directory premise, not a fabricated complete
  // Source program. The separate Source nested-factory case exercises production.
  const Child='fixture:ChildEnv',input=fixture(),spend=commonMeter(1000000),environments=new Map([[E,{parent:null,slots:[{key:S,type:B,writable:false}]}],[Child,{parent:E,slots:[]}]]),
    directory={functionId:Read,types:new Map([[B,{kind:'reference'}]]),functions:new Map([[Read,{kind:'source',parameterTypes:[],returnType:B,...protocol(Child)}]]),globals:new Map(),fields:new Set(),environments,constructions:new Map()};
  /** @type {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
  const graph={...emptyGraph(),nodes:[{kind:'environmentInput',type:null,layout:Child},{kind:'environmentParent',type:null,layout:E,bases:[0],control:0},
    {kind:'capture',type:B,id:S,layout:E,environment:[1],heap:0,control:0}],normal:[2]};
  assert.equal(readCommonReturnOriginGraph(graph,directory,spend).status,'typed');
  const solved=solveReturnOriginContexts(graph,new Map(),{...callbacks(input),environments,rootProtocol:protocol(Child)},spend);
  assert.deepEqual([...solved.owners(graph.normal)],['c:'+S]);
  const bad=structuredClone(graph),parent=bad.nodes.find(row=>row.kind==='environmentParent');assert.ok(parent);parent.layout=Child;
  assert.throws(()=>readCommonReturnOriginGraph(bad,directory,spend),{code:'return-origin-graph-boundary'});
});

test('Source: one nested factory callsite keeps different incoming parent Envs correlated',()=>{
  const input=fixture(),Spawn='spawn',Invoke='invokeSpawner',Spawner='fixture:Spawner',Child='fixture:SpawnEnv',X='spawn/x',CS='fixture:SpawnEnv/x';
  input.hir.types.push({id:Spawner,kind:'function',parameters:[],returnType:Fn});
  const make=fn(Make,[{id:'make/input',type:B}],Spawner,[{kind:'constDeclaration',binding:P,range,initializer:ref('make/input')},
    {kind:'return',range,value:{kind:'functionReference',type:Spawner,functionId:Spawn,range}}],{activationEnvironment:E});make.bindings=[{id:P,type:B,writable:false}];
  const spawn=fn(Spawn,[],Fn,[{kind:'constDeclaration',binding:X,range,initializer:ref(P)},
    {kind:'return',range,value:{kind:'functionReference',type:Fn,functionId:Read,range}}],{lexicalParent:Make,lexicalEnvironment:E,activationEnvironment:Child,captures:[{binding:P,read:true,write:false}]});
  spawn.bindings=[{id:X,type:B,writable:false}];
  const read=fn(Read,[],B,[{kind:'return',range,value:ref(X)}],{lexicalParent:Spawn,lexicalEnvironment:Child,captures:[{binding:X,read:true,write:false}]});
  const invoker=fn(Invoke,[{id:'invoke/f',type:Spawner}],Fn,[{kind:'return',range,value:{kind:'indirectCall',type:Fn,range,expression:ref('invoke/f',Spawner),arguments:[],signature:{parameters:[],returnType:Fn}}}]);
  input.caller.body=[
    {kind:'constDeclaration',binding:'s1',range,initializer:direct(Make,[ref('entry/p')],Spawner,10)},
    {kind:'constDeclaration',binding:'s2',range,initializer:direct(Make,[ref('entry/q')],Spawner,20)},
    {kind:'constDeclaration',binding:'r1',range,initializer:direct(Invoke,[ref('s1',Spawner)],Fn,30)},
    {kind:'constDeclaration',binding:'r2',range,initializer:direct(Invoke,[ref('s2',Spawner)],Fn,40)},
    writeV(invoke(ref('r1',Fn),60),70)
  ];
  input.caller.bindings=[{id:'s1',type:Spawner},{id:'s2',type:Spawner},{id:'r1',type:Fn},{id:'r2',type:Fn}];
  input.hir.functions=[input.caller,make,spawn,read,invoker];input.hir.environments.push({id:Child,owner:Spawn,parent:E,slots:[{key:CS,binding:X,type:B,writable:false,kind:'local'}]});
  const makeBound=makeGraph();const packed=makeBound.nodes.find(row=>row.kind==='code');assert.ok(packed);packed.functionId=Spawn;packed.type=Spawner;
  /** @type {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
  const spawnBound={...emptyGraph(),nodes:[{kind:'environmentInput',type:null,layout:E},
    {kind:'capture',type:B,id:S,layout:E,environment:[0],heap:0,control:0},
    {kind:'environmentCreate',type:null,layout:Child,parent:[0],site:'fixed:nested-activation',control:0},
    {kind:'code',type:Fn,functionId:Read,environment:[2],control:0}],
    heaps:[{kind:'entry'},{kind:'store',previous:0,bases:[2],selector:'capture:'+CS,view:'env:'+Child,values:[1],initialize:true,control:0}],normal:[3],exits:{normal:[{heap:1,control:0}],language:[]}};
  /** @type {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
  const readBound={...emptyGraph(),nodes:[{kind:'environmentInput',type:null,layout:Child},{kind:'capture',type:B,id:CS,layout:Child,environment:[0],heap:0,control:0}],normal:[1]};
  /** @type {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
  const invokeBound={...emptyGraph(),nodes:[{kind:'parameter',type:Spawner,index:0},{kind:'environmentComponent',type:null,layout:E,functionId:Spawn,callee:[0],control:0},{kind:'call',type:Fn,call:0,completion:'normal'}],
    heaps:[{kind:'entry'},{kind:'call',call:0,completion:'normal'}],controls:[{kind:'entry'},{kind:'call',call:0,completion:'normal'}],
    calls:[{functionId:Spawn,arguments:[],environment:[1],callee:[0],receiver:null,heap:0,control:0,site:'one-fixed-spawn-site'}],normal:[2],exits:{normal:[{heap:1,control:1}],language:[]}};
  const makeUpper=upper(makeBound,[B]),spawnUpper=upper(spawnBound,[],[{slot:S,read:true,write:false,structural:false}]),readUpper=upper(readBound,[],[{slot:CS,read:true,write:false,structural:false}]),invokeUpper=upper(invokeBound,[Spawner]);
  for(const bound of [makeUpper,spawnUpper,invokeUpper]){bound.facets.allocation=true;bound.facets.managedReference=true;bound.facets.escape=true;}readUpper.facets.managedReference=true;invokeUpper.parameters[0].read=true;
  input.records=new Map([[Make,{upper:makeUpper,callables:{...noTransfer(),returns:{top:false,functions:[Spawn]}}}],
    [Spawn,{upper:spawnUpper,callables:{...noTransfer(),returns:{top:false,functions:[Read]}}}],[Read,{upper:readUpper,callables:noTransfer()}],
    [Invoke,{upper:invokeUpper,callables:{parameters:[{index:0,allowed:{top:false,functions:[Spawn]}}],returns:{top:false,functions:[Read]},slotWrites:[]}}],
    [Caller,{upper:upper(emptyGraph(),[B,B]),callables:noTransfer()}]]);
  const {body}=extract(input);assert.equal(body.parameters[0].write,true);assert.equal(body.parameters[1].write,false,'the one nested allocation site is contextualized by its incoming parent Env');
});

test('draft5: missing payload/metadata remains open, and v3 is rejected instead of restamped',()=>{
  const input=fixture();input.records.get(Make).upper.returnOrigins.heaps=[{kind:'entry'}];input.records.get(Make).upper.returnOrigins.exits.normal=[{heap:0,control:0}];
  assert.throws(()=>extract(input),{code:'r03-common-program-return-origin-environment-open'});
  const branch=fixture(),partial=branch.records.get(Make).upper.returnOrigins;
  partial.heaps.push({kind:'join',inputs:[0,1]});partial.exits.normal=[{heap:2,control:0}];
  assert.throws(()=>extract(branch),{code:'r03-common-program-return-origin-environment-open'},'one initialized join arm cannot hide a missing payload on the other arm');
  const good=fixture(),spend=commonMeter(1000000),directory=commonReturnOriginDirectories(good.hir,spend),old={...readGraph(),format:{family:'tsfg.return-origin-graph-candidate',version:3}};
  assert.throws(()=>directory.read(Read,old),{code:'return-origin-graph-boundary'});
  assert.throws(()=>solveReturnOriginContexts(old,fixed(good),callbacks(good),spend),{code:'r03-common-program-return-origins'});
});

function formalFixture(){
  const input=fixture(),Relay='relay',incoming='entry/code',relayParameter='relay/code';
  const relay=fn(Relay,[{id:relayParameter,type:Fn}],Fn,[{kind:'return',range,value:ref(relayParameter,Fn)}]);
  input.caller.parameters=[{id:incoming,type:Fn}];input.caller.bindings=[];
  input.caller.body=[writeV(invoke(direct(Relay,[ref(incoming,Fn)],Fn,30),40))];
  input.hir.functions=[input.caller,relay,input.read,input.make];
  const allowed={top:false,functions:[Read]},transfer={parameters:[{index:0,allowed}],returns:allowed,slotWrites:[]};
  input.records.set(Relay,{upper:upper({...emptyGraph(),nodes:[{kind:'parameter',type:Fn,index:0}],normal:[0]},[Fn]),callables:transfer});
  input.records.set(Caller,{upper:upper(emptyGraph(),[Fn]),callables:{parameters:[{index:0,allowed}],returns:null,slotWrites:[]}});
  return {input,relay,Relay};
}

test('Source: a formal Code parameter carries its own conditional Env component',()=>{
  const {input}=formalFixture(),{body,spend}=extract(input);
  assert.equal(body.parameters[0].write,true,'callee capture payload remains rooted at this formal Code input');
  assert.ok(body.returnOrigins.nodes.some(row=>row.kind==='environmentComponent'&&row.functionId===Read));
  assert.equal(body.returnOrigins.nodes.some(row=>row.kind==='environmentCreate'),false,'projection is not an allocated Env instance');
  assert.equal(commonReturnOriginDirectories(input.hir,spend).read(Caller,body.returnOrigins).status,'typed');
});

test('draft5: Fn-only, unbound, wrong-layout and unknown Code components grant no Env',()=>{
  const {input}=formalFixture(),{body,spend}=extract(input),directory=commonReturnOriginDirectories(input.hir,spend);
  for(const mutate of [
    graph=>{const node=graph.nodes.find(row=>row.kind==='environmentComponent');assert.ok(node);node.functionId=Make;},
    graph=>{const node=graph.nodes.find(row=>row.kind==='environmentComponent');assert.ok(node);node.layout='missing-layout';},
    graph=>{const node=graph.nodes.find(row=>row.kind==='environmentComponent');assert.ok(node);node.callee=[];},
    graph=>{const call=graph.calls.find(row=>row.functionId===Read);assert.ok(call);call.environment=null;}
  ]){const bad=structuredClone(body.returnOrigins);mutate(bad);assert.throws(()=>directory.read(Caller,bad),{code:'return-origin-graph-boundary'});}
  for(const kind of /** @type {const} */(['unknown','nonowning'])){
    const bad=structuredClone(body.returnOrigins),node=bad.nodes.find(row=>row.kind==='environmentComponent'),call=bad.calls.find(row=>row.functionId===Read);assert.ok(node&&call);
    const id=bad.nodes.length;bad.nodes.push(kind==='unknown'?{kind,type:null}:{kind,type:'i32'});node.callee=[id];call.callee=[id];
    assert.equal(directory.read(Caller,bad).status,'typed','a DTO is not evidence of an actual Code value');
    assert.throws(()=>solveReturnOriginContexts(bad,fixed(input),callbacks(input),spend),{code:'r03-common-program-return-origin-environment-open'});
  }
});

test('Source: captured readonly Code preserves its own payload owner, not a foreign c:key',()=>{
  const input=fixture(),Holder='holder',H='fixture:HolderEnv',C='fixture:HolderEnv/code',binding='holder/code';
  const holder=fn(Holder,[{id:'holder/input',type:Fn}], 'void',[{kind:'constDeclaration',binding,range,initializer:ref('holder/input',Fn)}],{activationEnvironment:H});holder.bindings=[{id:binding,type:Fn,writable:false}];
  input.caller.parameters=[];input.caller.bindings=[];input.caller.lexicalParent=Holder;input.caller.lexicalEnvironment=H;
  input.caller.captures=[{binding,read:true,write:false}];input.caller.body=[writeV(invoke(ref(binding,Fn,30),30))];
  input.hir.functions.push(holder);input.hir.environments.push({id:H,owner:Holder,parent:null,slots:[{key:C,binding,type:Fn,writable:false,kind:'local'}]});
  const allowed={top:false,functions:[Read]},holderUpper=upper({...emptyGraph(),nodes:[{kind:'parameter',type:Fn,index:0},{kind:'environmentCreate',type:null,layout:H,parent:null,site:'fixed:holder',control:0}],
    heaps:[{kind:'entry'},{kind:'store',previous:0,bases:[1],selector:'capture:'+C,view:'env:'+H,values:[0],initialize:true,control:0}],exits:{normal:[{heap:1,control:0}],language:[]}},[Fn]);holderUpper.facets.allocation=true;holderUpper.facets.managedReference=true;
  input.records.set(Holder,{upper:holderUpper,callables:{parameters:[{index:0,allowed}],returns:null,slotWrites:[]}});
  input.records.set(Caller,{upper:upper(emptyGraph(),[],[{slot:C,read:true,write:true,structural:false}]),callables:noTransfer()});
  const {body,spend}=extract(input);assert.deepEqual(body.captures.map(row=>row.slot),[C]);assert.equal(body.captures[0].write,true);
  assert.equal(commonReturnOriginDirectories(input.hir,spend).read(Caller,body.returnOrigins).status,'typed');
  const wrong=structuredClone(body.returnOrigins),component=wrong.nodes.find(row=>row.kind==='environmentComponent');assert.ok(component);component.functionId=Holder;
  assert.throws(()=>commonReturnOriginDirectories(input.hir,spend).read(Caller,wrong),{code:'return-origin-graph-boundary'});
});

test('Source authoring: temporary empty return cannot hide a missing/nonowning Env source',()=>{
  const {input,relay,Relay}=formalFixture();input.hir.types.push({id:'undefined',kind:'undefined',name:'undefined'});
  relay.body=[{kind:'return',range,value:{kind:'as',type:Fn,range,expression:{kind:'undefinedLiteral',type:'undefined',range}}}];
  input.records.get(Relay).upper.returnOrigins={...emptyGraph(),nodes:[{kind:'nonowning',type:'undefined'}],normal:[0]};
  // This authoring-only premise supplies Code membership, never an Env or
  // Actual instance. It is independent of both the current return body and
  // the inferred effect rows whose temporary Bottom is under test.
  const spend=commonMeter(1000000),physical={references:new Map(),escaping:new Map(),model:{callables:{site:()=>({top:false,functions:[Read]})}}},
    effects=commonEffects(input.hir,spend,physical);
  assert.throws(()=>effects.derived(),{code:'r03-common-program-return-origin-environment-open'});
  assert.throws(()=>Reflect.apply(effects.derive,effects,[input.caller,uppers(input.records),false,true]),{code:'r03-common-program-return-origin-environment-open'},'a fourth public argument cannot enable provisional mode');
  const consumer=commonEffects(input.hir,spend,null,null,null,input.records);
  assert.throws(()=>consumer.derived(),{code:'r03-common-program-publication-mode'});
});

test('draft5 containment keeps Code target/Env pairing and shared capture-store obligations',()=>{
  const input=fixture(),graph=makeGraph(),contracts=new Map([...fixed(input)].map(([id,row])=>[id,{graph:row.graph}])),spend=commonMeter(1000000);
  assert.equal(commonReturnOriginsInclusion(graph,graph,contracts,spend).status,'covered');
  const wrong=structuredClone(graph);wrong.nodes.push({kind:'environmentCreate',type:null,layout:E,parent:null,site:'other-activation',control:0});
  const code=wrong.nodes.find(row=>row.kind==='code');assert.ok(code);code.environment=[3];
  assert.equal(commonReturnOriginsInclusion(graph,wrong,contracts,spend).status,'open');
  const noStore=structuredClone(graph);noStore.exits.normal=[{heap:0,control:0}];
  assert.equal(commonReturnOriginsInclusion(graph,noStore,contracts,spend).status,'open');
});

test('draft5: a weak store through alternative Envs cannot establish MUST initialization',()=>{
  const input=fixture(),graph=input.records.get(Make).upper.returnOrigins;
  graph.nodes.push({kind:'environmentCreate',type:null,layout:E,parent:null,site:'second-possible-activation',control:0});
  const store=graph.heaps[1];assert.ok(store.kind==='store');store.bases=[1,3];
  assert.equal(commonReturnOriginDirectories(input.hir,commonMeter(1000000)).read(Make,graph).status,'typed');
  // refs are MAY alternatives, not an all-target broadcast: this store may
  // select the second Env while the returned Code still selects the first.
  assert.throws(()=>extract(input),{code:'r03-common-program-return-origin-environment-open'},'an alternative base cannot prove the returned Env slot initialized');

  const prior=fixture(),bound=prior.records.get(Make).upper,defined=bound.returnOrigins;
  prior.make.parameters.push({id:'make/other',type:B,writable:true});prior.make.signatureHash=signatureId({parameters:[B,B],returns:Fn});
  bound.parameters.push({index:1,read:false,write:false,structural:false});
  prior.caller.body.slice(0,2).forEach(declaration=>{declaration.initializer.arguments.push(ref('entry/q'));declaration.initializer.signature.parameters.push(B);});
  defined.nodes.push({kind:'environmentCreate',type:null,layout:E,parent:null,site:'second-possible-activation',control:0},{kind:'parameter',type:B,index:1});
  const exact=defined.heaps[1];assert.ok(exact.kind==='store');
  // The first singleton initialization gives A payload p. The later MAY write
  // through {A,B} can still add q to A: it must neither establish a missing
  // MUST definition nor discard its genuine MAY payload effect.
  defined.heaps.push({...exact,previous:1,bases:[1,3],values:[4]});defined.exits.normal=[{heap:2,control:0}];
  const {body}=extract(prior);assert.equal(body.parameters[0].write,true);assert.equal(body.parameters[1].write,true);
});


test('Source: full fixed A/B permission survives a returned CodeA-only graph',()=>{
  const input=fixture(),Other='otherAllowed',G='fixture:other-write';
  input.hir.globals.push({id:G,sourceBinding:'raw:'+G,type:B,writable:false});
  const other=fn(Other,[],B,[{kind:'return',range,value:{kind:'globalReference',global:G,type:B,range}}]);input.hir.functions.push(other);
  const wider=upper(emptyGraph());wider.globals.writes=[G];wider.facets.managedReference=true;
  input.records.set(Other,{upper:wider,callables:noTransfer()});
  input.records.get(Make).callables.returns={top:false,functions:[Read,Other].sort()};
  assert.deepEqual(makeGraph().nodes.filter(row=>row.kind==='code').map(row=>row.functionId),[Read],'fixed returned data contains only CodeA');
  assert.throws(()=>extract(input),/** @param {unknown} error */error=>error instanceof TypeError&&'code' in error&&error.code==='r03-common-program-return-origin-environment-open',
    'permitted B cannot disappear merely because the saved Code/environment is A; the unresolved full capability stays OPEN');
});

// Distinct local actual tags refine aliases. Neither Source spelling nor
// separate allocation sites establishes uniqueness for equal tags/formals.
test('Source local arrays with the same actual tag retain conservative aliases',()=>{
  const A='fixture:ArrayB',arrayType={id:A,kind:'array',name:A,elementType:B},p='entry/p',q='entry/q',a='entry/a',b='entry/b',array=(binding,start)=>({kind:'arrayLiteral',type:A,allocationSite:'array:'+start,range:{start,end:start+3},elements:[ref(binding,B,start)]}),
    element=binding=>({kind:'checkedElementAccess',type:B,receiver:ref(binding,A),index:{kind:'integerLiteral',type:'i32',token:'0',decimal:'0',range},range});
  const owner=fn(Caller,[{id:p,type:B},{id:q,type:B}],'void',[
    {kind:'constDeclaration',binding:a,range,initializer:array(p,10)},{kind:'constDeclaration',binding:b,range,initializer:array(q,20)},writeV(element(a))]);
  owner.bindings=[{id:a,type:A,writable:false},{id:b,type:A,writable:false}];const hir=hirRows([owner]);hir.environments=[];hir.types.push(arrayType);
  const body=commonReturnOriginSource(hir,commonMeter(1000000)).derive(owner,new Map()).upper;
  assert.equal(body.parameters[0].write,true);assert.equal(body.parameters[1].write,true,'equal actual tags remain may-alias across distinct sites');
});

test('Source formal array and local allocation retain conservative aliases',()=>{
  const A='fixture:ArrayB',arrayType={id:A,kind:'array',name:A,elementType:B},p='entry/p',q='entry/q',a='entry/a',owner=fn(Caller,[{id:p,type:A},{id:q,type:B}],'void',[
    {kind:'constDeclaration',binding:a,range,initializer:{kind:'arrayLiteral',type:A,allocationSite:'local-array',range,elements:[ref(q)]}},
    writeV({kind:'checkedElementAccess',type:B,receiver:ref(p,A),index:{kind:'integerLiteral',type:'i32',token:'0',decimal:'0',range},range})]);
  owner.bindings=[{id:a,type:A,writable:false}];const hir=hirRows([owner]);hir.environments=[];hir.types.push(arrayType);
  const body=commonReturnOriginSource(hir,commonMeter(1000000)).derive(owner,new Map()).upper;
  assert.equal(body.parameters[0].write,true);assert.equal(body.parameters[1].write,true,'a formal Source view is not a concrete allocation tag');
});

test('Source Code formation keeps complete protocol metadata for a null-return member without granting calls',()=>{
  const owner=fn(Caller,[],Fn,[{kind:'return',range,value:{kind:'functionReference',type:Fn,functionId:Read,range}}]),
    target=fn(Read,[],B,[{kind:'return',range,value:{kind:'as',type:B,range,expression:{kind:'undefinedLiteral',type:'undefined',range}}}]),
    invoker=fn('invoke-unavailable',[],B,[{kind:'return',range,value:direct(Read,[],B,20)}]),hir=hirRows([owner,target,invoker]);hir.environments=[];hir.types=[...hir.types,{id:'undefined',kind:'undefined',name:'undefined'}];
  const {returnOrigins:unused,...declared}=upper(emptyGraph()),records=new Map([['invoke-unavailable',{upper:declared,returnOrigins:emptyGraph(),callables:noTransfer()}],[Caller,{upper:declared,returnOrigins:emptyGraph(),callables:{...noTransfer(),returns:{top:false,functions:[Read]}}}],[Read,{upper:declared,returnOrigins:null,callables:noTransfer()}]]),
    source=commonReturnOriginSource(hir,commonMeter(1000000),null,null,null,records),body=source.derive(owner,null).upper;
  assert.equal(body.returnOrigins.nodes.some(node=>node.kind==='code'&&node.functionId===Read),true);
  assert.equal(body.facets.managedReference,false,'an environment-free Code is not automatically a managed reference');assert.equal(records.get(Read).returnOrigins,null);
  assert.throws(()=>source.derive(invoker,null),{code:'r03-common-program-return-origin-call-open'});
});

test('draft5 MUST rejects an uninitialized language exit even when the normal exit defines the same activation',()=>{
  const input=fixture(),graph=makeGraph();graph.language=[...graph.normal];graph.exits.language=[{heap:0,control:0}];
  assert.throws(()=>solveReturnOriginContexts(graph,fixed(input),{...callbacks(input),rootProtocol:protocol(null,E)},commonMeter(1000000)),{code:'r03-common-program-return-origin-environment-open'});
});

test('a full capture permission with no saved owner in the fixed call closure remains Open',()=>{
  const input=fixture(),Foreign='fixture:ForeignEnv',ForeignSlot='fixture:ForeignEnv/value',ForeignOwner='foreign-owner',ForeignRead='foreign-read',ForeignBinding='foreign-value';
  const owner=fn(ForeignOwner,[{id:ForeignBinding,type:B}],Fn,[{kind:'return',range,value:{kind:'functionReference',type:Fn,functionId:ForeignRead,range}}],{activationEnvironment:Foreign}),
    reader=fn(ForeignRead,[],B,[{kind:'return',range,value:ref(ForeignBinding)}],{lexicalParent:ForeignOwner,lexicalEnvironment:Foreign,captures:[{binding:ForeignBinding,read:true,write:false}]});
  input.hir.functions.push(owner,reader);input.hir.environments.push({id:Foreign,owner:ForeignOwner,parent:null,slots:[{key:ForeignSlot,binding:ForeignBinding,type:B,writable:false,kind:'parameter'}]});
  /** @type {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
  const ownerGraph={...emptyGraph(),nodes:[{kind:'parameter',type:B,index:0},{kind:'environmentCreate',type:null,layout:Foreign,parent:null,site:'independent-foreign-activation',control:0},
    {kind:'code',type:Fn,functionId:ForeignRead,environment:[1],control:0}],heaps:[{kind:'entry'},{kind:'store',previous:0,bases:[1],selector:'capture:'+ForeignSlot,view:'env:'+Foreign,values:[0],initialize:true,control:0}],normal:[2],exits:{normal:[{heap:1,control:0}],language:[]}};
  /** @type {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
  const childGraph={...emptyGraph(),nodes:[{kind:'environmentInput',type:null,layout:Foreign},{kind:'capture',type:B,id:ForeignSlot,layout:Foreign,environment:[0],heap:0,control:0}],normal:[1]};
  const ownerUpper=upper(ownerGraph,[B]);ownerUpper.facets.allocation=true;ownerUpper.facets.managedReference=true;ownerUpper.facets.escape=true;
  input.records.set(ForeignOwner,{upper:ownerUpper,callables:{...noTransfer(),returns:{top:false,functions:[ForeignRead]}}});
  input.records.set(ForeignRead,{upper:upper(childGraph,[],[{slot:ForeignSlot,read:true,write:false,structural:false}]),callables:noTransfer()});
  input.records.get(Read).upper.captures.push({slot:ForeignSlot,read:true,write:false,structural:false});
  assert.throws(()=>extract(input),{code:'r03-common-program-return-origin-environment-open'});
});
