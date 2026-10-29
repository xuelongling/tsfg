// SPDX-License-Identifier: MIT
// Owning normalized compiler data only; these are not official Source facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonEnvironments} from '../../compiler/common-program-environments.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {selectCommonCarriers} from '../../compiler/common-program-carriers.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {commonSourceGrammar,commonTypeSyntax} from '../../compiler/common-program-source.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';

function booleanEquality(left=true,right=true,operator='===',mode='literal') {
  const bool=scalarTypeIds.bool,i32=scalarTypeIds.i32,undefinedId=sha256('tsfg.type\0undefined'),numeric=mode.startsWith('numeric-'),
    rows=[{id:bool,kind:'scalar',name:'bool'},{id:i32,kind:'scalar',name:'i32'},
      {id:scalarTypeIds.u32,kind:'scalar',name:'u32'},{id:undefinedId,kind:'undefined'},
      {id:'unknown',kind:'unknown'},{id:'union',kind:'union',members:[bool,i32]}],
    parameters=mode==='numeric-unknown'?[{id:'input',type:'unknown'}]:mode==='boolean'?[{id:'input',type:bool}]:mode==='unknown'?[{id:'condition',type:bool},{id:'input',type:'unknown'}]
      :mode==='multiple'?[{id:'condition',type:bool}]:[],
    owner={id:'comparison',name:'comparison',kind:'source',sourcePath:'/unit.ts',range:{start:0,end:1},parameters,returnType:numeric?i32:bool},
    model={types:new Map(rows.map(row=>[row.id,row])),functions:new Map([[owner.id,owner]]),bindings:new Map(),fields:new Map(),
      globals:new Map(),environments:new Map(),slots:new Map(),spend:commonMeter(),payload:'payload',
      hir:{types:rows,functions:[owner],globals:[],environments:[],snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[{kind:'application',target:owner.id}]}}},
    graph=createCommonGraph(model,owner),entry=graph.newBlock(parameters.map(p=>p.type)),range={start:0,end:1},
    emit=(block,name,args,type,props={})=>graph.emit(block,name,args,type,props,range),
    boolean=(block,value)=>emit(block,'boolean',[],bool,{value});
  let block=entry,first=mode==='boolean'?{...entry.parameters[0]}:boolean(entry,left);
  if(mode==='unknown'||mode==='multiple'){
    const yes=graph.newBlock(),no=graph.newBlock(),join=graph.newBlock([mode==='unknown'?'unknown':'union']);
    graph.conditional(entry,{...entry.parameters[0]},yes,no,range);
    graph.branch(yes,join,[first],range);
    graph.branch(no,join,[mode==='unknown'?{...entry.parameters[1]}:emit(no,'constant',[],i32,{decimal:'0',token:'0'})],range);
    block=join;first={...join.parameters[0]};
  }
  if(mode==='bottom'){
    const dead=graph.newBlock(),live=graph.newBlock();graph.conditional(entry,boolean(entry,false),dead,live,range);
    graph.terminal(live,'func.return',[boolean(live,false)],[],{},range);block=dead;
  }
  if(numeric){
    if(mode==='numeric-unknown')first={...entry.parameters[0]};
    if(mode==='numeric-scalar')first=emit(block,'constant',[],scalarTypeIds.u32,{decimal:'0',token:'0'});
    if(mode==='numeric-undefined')first=emit(block,'undefined',[],undefinedId,{});
    first=emit(block,'view',[first],i32,{});
  }
  const result=numeric?emit(block,'binary',[first,emit(block,'constant',[],i32,{decimal:'1',token:'1'})],i32,{operator:'+'})
    :emit(block,'strict_equal',[first,boolean(block,right)],bool,{operator});graph.terminal(block,'func.return',[result],[],{},range);
  const flow=analyzeCommonGraphs({model,plans:[{owner,parameters,graph,entry,returnType:owner.returnType}]});
  return {flow,result:owner.id+'/'+result.name};
}

for(const left of [false,true])for(const right of [false,true])for(const operator of ['===','!=='])
test('actual sole boolean literals '+left+' '+operator+' '+right,()=>{
  const {flow,result}=booleanEquality(left,right,operator),value=flow.actual.observed.get(result);
  assert.deepEqual([...value.tags],[scalarTypeIds.bool]);assert.equal(value.truth,((left===right)===(operator==='==='))?2:1);
});
for(const mode of ['boolean','unknown','multiple'])test('actual equality retains uncertainty: '+mode,()=>{
  const {flow,result}=booleanEquality(true,true,'===',mode),value=flow.actual.observed.get(result);
  assert.equal(value.truth,3);assert.deepEqual([...value.tags],[scalarTypeIds.bool]);
});
test('an unreachable equality does not publish a bottom operand or result',()=>{
  const {flow,result}=booleanEquality(true,true,'===','bottom');assert.equal(flow.actual.observed.has(result),false);
});
for(const mode of ['bool','unknown','scalar'])test('actual numeric consumption still rejects '+mode,()=>{
  let published;assert.throws(()=>{published=booleanEquality(true,true,'===','numeric-'+mode);},e=>
    e instanceof Error&&'code' in e&&e.code==='r03-common-program-capability'&&e.message.includes('unsupported actual numeric consumption'));
  assert.equal(published,undefined);
});
test('an actual undefined numeric operand retains its request trap',()=>{
  const {flow,result}=booleanEquality(true,true,'===','numeric-undefined'),operation=flow.actual.operations.get(result);
  assert.equal(operation.requestTrap,true);assert.equal(operation.normal,false);
  assert.equal(flow.actual.observed.get(result).tags.size,0);
});

function guardedScalarLoad(mode='direct'){
  const bool=scalarTypeIds.bool,i32=scalarTypeIds.i32,range={start:0,end:1},
    rows=[{id:bool,kind:'scalar',name:'bool'},{id:i32,kind:'scalar',name:'i32'},
      {id:'U',kind:'union',members:[bool,i32]},{id:'unknown',kind:'unknown'}],
    parameters=[{id:'condition',type:bool},...(mode==='unknown'?[{id:'input',type:'unknown'}]:[])],
    owner={id:'guarded',name:'guarded',kind:'source',sourcePath:'/unit.ts',range,parameters,returnType:'U',signatureHash:'signature',activationEnvironment:'env'},
    slots=[{binding:'held',key:'held',type:'U',writable:true,kind:'local'},{binding:'other',key:'other',type:'U',writable:true,kind:'local'}],
    environment={id:'env',owner:owner.id,parent:null,slots},
    model={types:new Map(rows.map(row=>[row.id,row])),functions:new Map([[owner.id,owner]]),bindings:new Map(slots.map(s=>[s.binding,{id:s.binding,type:s.type,role:'local'}])),
      fields:new Map(),globals:new Map(),environments:new Map([['env',environment]]),slots:new Map(slots.map(s=>[s.binding,{...s,layout:'env'}])),
      spend:commonMeter(),payload:'payload',hir:{types:rows,functions:[owner],globals:[],environments:[environment],
        snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[{kind:'application',target:owner.id}]}}},
    graph=createCommonGraph(model,owner),entry=graph.newBlock(parameters.map(p=>p.type)),plans=[{owner,parameters,graph,entry,returnType:'U'}],
    emit=(block,name,args,type,properties={})=>graph.emit(block,name,args,type,properties,range),
    number=block=>emit(block,'constant',[],i32,{decimal:'1',token:'1'}),
    yesValue=emit(entry,'boolean',[],bool,{value:true}),env=emit(entry,'env_alloc',[],'env:env',{layout:'env'}),
    otherEnv=mode==='different-ssa'?emit(entry,'view',[env],'env:env',{}):env,
    properties={layout:'env',key:'held',binding:'held'},other={layout:'env',key:'other',binding:'other'},
    yes=graph.newBlock(),no=graph.newBlock(),testBlock=mode==='bottom'?entry:graph.newBlock(),
    matched=graph.newBlock(),resultBlock=graph.newBlock(mode==='call'?[i32]:[]),
    bridge=['bridge','store-bridge','call'].includes(mode)?graph.newBlock():resultBlock;
  let initial=number(entry);
  if(mode==='bottom'){const cell=emit(entry,'cell',[],'cell:U',{});initial=emit(entry,'load',[cell],'U',{});}
  emit(entry,'env_init',[env,initial],null,properties);emit(entry,'env_init',[env,yesValue],null,other);
  if(mode!=='bottom'){
    graph.conditional(entry,{...entry.parameters[0]},yes,no,range);
    emit(yes,'env_store',[env,yesValue],null,properties);graph.branch(yes,mode==='ambiguous'?resultBlock:testBlock,[],range);
    emit(no,'env_store',[env,mode==='unknown'?{...entry.parameters[1]}:number(no)],null,properties);graph.branch(no,testBlock,[],range);
  }
  const first=emit(testBlock,'env_load',[env],'U',properties),literal=emit(testBlock,'boolean',[],bool,{value:true}),
    operator=mode==='not-equal'?'!==':'===',equal=emit(testBlock,'strict_equal',mode==='reversed'?[literal,first]:[first,literal],bool,{operator});
  graph.conditional(testBlock,equal,mode==='double-target'?resultBlock:operator==='==='?matched:bridge,mode==='double-target'?resultBlock:operator==='==='?bridge:matched,range);
  graph.terminal(matched,'func.return',[number(matched)],[],{},range);
  if(mode==='bridge')graph.branch(bridge,resultBlock,[],range);
  if(mode==='store-bridge'){emit(bridge,'env_store',[env,yesValue],null,properties);graph.branch(bridge,resultBlock,[],range);}
  if(mode==='call'){
    const callee={...owner,id:'callee',parameters:[],returnType:i32,activationEnvironment:null},calleeGraph=createCommonGraph(model,callee),calleeEntry=calleeGraph.newBlock();
    const constant=calleeGraph.emit(calleeEntry,'constant',[],i32,{decimal:'1',token:'1'},range);calleeGraph.terminal(calleeEntry,'func.return',[constant],[],{},range);
    model.functions.set(callee.id,callee);model.hir.functions.push(callee);plans.push({owner:callee,parameters:[],graph:calleeGraph,entry:calleeEntry,returnType:i32});
    const language=graph.newBlock([model.payload]);graph.terminal(language,'return_throw',[{...language.parameters[0]}],[],{},range);
    graph.terminal(bridge,'invoke',[],[resultBlock,language],{function_id:callee.id,signature_hash:'signature'},range);
  }
  if(mode==='store')emit(resultBlock,'env_store',[env,yesValue],null,properties);
  if(mode==='cycle'){const loop=graph.newBlock();graph.branch(loop,loop,[],range);}
  const loaded=emit(resultBlock,'env_load',[otherEnv],'U',mode==='different-key'?other:properties),good=['direct','bridge','reversed','not-equal'].includes(mode);
  let returned=loaded,witness=null,later=null;
  if(good){const view=emit(resultBlock,'view',[loaded],i32,{});returned=emit(resultBlock,'binary',[view,number(resultBlock)],i32,{operator:'+'});}
  if(good)later=emit(resultBlock,'env_load',[env],'U',properties);
  if(mode==='bottom'){witness=emit(resultBlock,'strict_equal',[loaded,yesValue],bool,{operator:'==='});returned=witness;}
  graph.terminal(resultBlock,'func.return',[returned],[],{},range);
  const flow=analyzeCommonGraphs({model,plans});return {flow,loaded:owner.id+'/'+loaded.name,witness:witness?owner.id+'/'+witness.name:null,first:owner.id+'/'+first.name,later:later?owner.id+'/'+later.name:null};
}
for(const mode of ['direct','bridge','reversed','not-equal'])test('actual scalar guard preserves capacity and narrows only its SSA read: '+mode,()=>{
  const {flow,loaded,first,later}=guardedScalarLoad(mode);
  assert.ok(flow.capacity.observed.get(first).tags.has(scalarTypeIds.bool));assert.ok(flow.capacity.observed.get(first).tags.has(scalarTypeIds.i32));
  assert.deepEqual([...flow.actual.observed.get(loaded).tags],[scalarTypeIds.i32]);
  assert.ok(flow.actual.observed.get(later).tags.has(scalarTypeIds.bool));assert.ok(flow.actual.observed.get(later).tags.has(scalarTypeIds.i32),'shared heap remains conservative');
});
for(const mode of ['store','store-bridge','call','ambiguous','double-target','different-ssa','different-key','unknown','cycle'])
test('actual scalar guard remains conservative across '+mode,()=>{
  const {flow,loaded}=guardedScalarLoad(mode),value=flow.actual.observed.get(loaded);assert.ok(value.tags.has(scalarTypeIds.bool));
  if(mode==='unknown')assert.equal(value.unknown,true);
});
test('an empty guarded read terminates before equality can manufacture activity',()=>{
  const {flow,witness}=guardedScalarLoad('bottom');assert.equal(flow.actual.observed.has(witness),false);
  assert.equal([...flow.actual.contexts.values()].find(c=>c.plan.owner.id==='guarded').normal,false);
});

for(const {content,valid} of [{content:'i32 | bool | i32',valid:true},{content:'(i32 | bool)',valid:true},
  {content:'i32 | i32',valid:false},{content:'i32 | bool | string',valid:false},{content:'bool | bool',valid:false}])
test('original union annotation coverage: '+content,()=>{
  const spend=commonMeter(),types=new Map([{id:'i32',kind:'scalar',name:'i32'},{id:'bool',kind:'scalar',name:'bool'},
    {id:'U',kind:'union',members:['bool','i32']}].map(row=>[row.id,row])),grammar=commonSourceGrammar({path:'/unit.ts',content},spend),
    run=()=>commonTypeSyntax(grammar,{start:0,end:content.length},'U',types,spend);
  if(valid)assert.deepEqual(run(),[]);else assert.throws(run,e=>e instanceof Error&&'code' in e&&e.code==='r03-common-program-source');
});

for(const role of ['local','parameter'])for(const writable of [false,true])
test('normalized i32/bool '+role+' retains the original '+(writable?'mutable':'const')+' shared slot',()=>{
  const binding={id:'held',name:'held',kind:role,type:'U',writable},
    owner={id:'owner',lexicalParent:null,parameters:role==='parameter'?[binding]:[],bindings:role==='local'?[binding]:[],
      body:role==='local'?[{kind:writable?'letDeclaration':'constDeclaration',binding:'held',initializer:{kind:'numericLiteral'}}]:[],captures:[]},
    left={id:'left',lexicalParent:'owner',parameters:[],bindings:[],body:[],captures:[{binding:'held',read:true,write:false}]},
    right={...left,id:'right',captures:[{binding:'held',read:false,write:true}]},
    grandchild={...left,id:'grandchild',lexicalParent:'left'},
    members=[scalarTypeIds.bool,scalarTypeIds.i32].sort(),
    types=new Map([{id:'U',kind:'union',members},...members.map(id=>({id,kind:'scalar'}))].map(row=>[row.id,row])),
    result=commonEnvironments([owner,left,right,grandchild],types,commonMeter());
  assert.equal(result.environments.length,1);assert.equal(result.slots.size,1);
  assert.deepEqual(result.environments[0].slots,[result.slots.get('held')]);
  assert.equal(result.slots.get('held').type,'U');assert.equal(result.slots.get('held').writable,writable);
  for(const child of [left,right,grandchild])assert.equal(result.metadata(child).lexicalEnvironment,result.metadata(owner).activationEnvironment);
  assert.deepEqual(types.get('U'),{id:'U',kind:'union',members});
});

test('the complete existing scalar vocabulary remains a finite original union',()=>{
  const members=Object.values(scalarTypeIds).sort(),binding={id:'held',name:'held',kind:'parameter',type:'U',writable:true},
    owner={id:'owner',lexicalParent:null,parameters:[binding],bindings:[],body:[],captures:[]},
    child={id:'child',lexicalParent:'owner',parameters:[],bindings:[],body:[],captures:[{binding:'held',read:true,write:false}]},
    types=new Map([{id:'U',kind:'union',members},...members.map(id=>({id,kind:'scalar'}))].map(row=>[row.id,row]));
  assert.equal(commonEnvironments([owner,child],types,commonMeter()).slots.get('held').type,'U');
});

for(const kind of ['null','undefined','string','array','function','reference','value','readSpan','unknown','void'])
test('multiple scalar members do not admit extra '+kind+' capture payloads',()=>{
  const binding={id:'held',name:'held',kind:'parameter',type:'U',writable:true},
    owner={id:'owner',lexicalParent:null,parameters:[binding],bindings:[],body:[],captures:[]},
    child={id:'child',lexicalParent:'owner',parameters:[],bindings:[],body:[],captures:[{binding:'held',read:true,write:false}]},
    types=new Map([['U',{kind:'union',members:['i32','bool','other']}],['i32',{kind:'scalar'}],['bool',{kind:'scalar'}],['other',{kind}]]);
  assert.throws(()=>commonEnvironments([owner,child],types,commonMeter()),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-capability');
});

for(const observed of [['i32'],['bool'],['i32','bool']])
test('scalar-union physical capacity preserves only observed tags: '+observed.join('/'),()=>{
  const rows=Object.entries(scalarTypeIds).map(([name,id])=>({id,name,kind:'scalar'})),
    types=new Map(rows.map(row=>[row.id,row])),model={types,bindings:new Map([['held',{id:'held',role:'parameter',type:'U'}]]),
      spend:commonMeter(),payload:'payload:unit',environments:new Map()},a=commonAbstract(model),value=a.empty();
  for(const name of observed)a.merge(value,a.literal(scalarTypeIds[name]));
  const before=a.copy(value),carriers=selectCommonCarriers({model,plans:[]},{abstract:a,fieldSeeds:new Map(),globalSeeds:new Map(),elementSeeds:new Map(),
    capacity:{observed:new Map([['binding/held',value]]),contexts:new Map()}}),carrier=carriers.bindings.get('held');
  assert.deepEqual([...value.tags].sort(),observed.map(name=>scalarTypeIds[name]).sort());assert.deepEqual(value,before);
  assert.equal(value.refs.size,0);assert.equal(value.cells.size,0);assert.equal(value.pairs.size,0);
  if(observed.length===1)assert.equal(carrier,scalarTypeIds[observed[0]]);
  else{
    const domain=carriers.domains.get(carrier);assert.deepEqual(domain.actualTypes,[scalarTypeIds.i32,scalarTypeIds.bool].sort());
    assert.equal(domain.representation,'finite-union');assert.equal(domain.tagBytes,2);
    assert.deepEqual(carriers.layout(carrier),{byteSize:8,alignment:4,referenceCount:0});
  }
});
