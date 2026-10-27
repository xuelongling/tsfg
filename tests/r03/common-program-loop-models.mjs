// SPDX-License-Identifier: MIT
// Normalized actual CFG controls, not official Source facts or Core authority.
import {boolTypeId,i32TypeId,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {ownedEnvironmentModel} from './common-program-owned-environment-models.mjs';

const modes=new Set(['held','two','replaced','descriptor-only','old-cell','old-field',
  'live-break','dead-break','unconnected-pure','unconnected-host','recursive','host']);
export function loopFactoryModel(mode='held'){
  if(!modes.has(mode))throw new TypeError('unknown loop model');
  const result=ownedEnvironmentModel(mode==='replaced'?'replaced':mode==='descriptor-only'?'descriptor-only':'held'),
    {model,plans}=result.program,factory=plans.find(p=>p.owner.id==='entry'),reader=plans.find(p=>p.owner.id==='target'),
    callable='unit:Callable',u32=scalarTypeIds.u32,range={start:500,end:509},factoryCalls=[],readerCalls=[];
  if(!model.types.has(boolTypeId)){
    const type={id:boolTypeId,kind:'scalar',name:'bool'};model.types.set(type.id,type);model.hir.types.push(type);
  }
  function plan(id,parameters,returnType){
    const owner={id,name:id,sourceBinding:id,kind:'source',sourcePath:'/loop-model.ts',range,signatureHash:'unit:signature',
      parameters,returnType,lexicalParent:null,lexicalEnvironment:null,activationEnvironment:null},
      graph=createCommonGraph(model,owner),entry=graph.newBlock(parameters.map(p=>p.type)),value={owner,graph,entry,parameters,returnType};
    for(const parameter of parameters)model.bindings.set(parameter.id,{...parameter,role:'parameter'});
    model.functions.set(id,owner);plans.push(value);model.callables.summaries.set(id,{parameters:new Map()});
    result.records.set(id,{upper:{globals:{reads:[],writes:[]},parameters:parameters.map((_,index)=>({index,read:true,write:false,structural:false})),captures:[],facets:{unknownHost:false}}});
    return value;
  }
  const emit=(p,b,name,args,type,props={})=>p.graph.emit(b,name,args,type,props,range),
    number=(p,b,n,type=i32TypeId)=>emit(p,b,'constant',[],type,{decimal:String(n),token:String(n)}),
    ret=(p,b,value,language=false)=>p.graph.terminal(b,language?'return_throw':'func.return',[value],[],{},range);
  if(mode==='host')result.records.get(factory.owner.id).upper.facets.unknownHost=true;
  if(mode==='recursive'){
    const original=factory.entry,parameter={id:'entry/recurse',type:boolTypeId},entry=factory.graph.newBlock([boolTypeId]),
      recursive=factory.graph.newBlock(),normal=factory.graph.newBlock([callable]),language=factory.graph.newBlock([model.payload]);
    factory.parameters=[parameter];factory.owner.parameters=[parameter];factory.entry=entry;
    model.bindings.set(parameter.id,{...parameter,role:'parameter'});
    result.records.get('entry').upper.parameters=[{index:0,read:true,write:false,structural:false}];
    factory.graph.conditional(entry,{...entry.parameters[0]},recursive,original,range);
    const stop=emit(factory,recursive,'boolean',[],boolTypeId,{value:false});
    factory.graph.terminal(recursive,'invoke',[stop],[normal,language],{function_id:'entry',signature_hash:'unit:signature'},range);
    ret(factory,normal,{...normal.parameters[0]});ret(factory,language,{...language.parameters[0]},true);
  }
  let pureCreator=null,pureReader=null;
  if(mode.startsWith('unconnected-')){
    pureReader=plan('loopPureReader',[],i32TypeId);ret(pureReader,pureReader.entry,number(pureReader,pureReader.entry,7));
    pureCreator=plan('loopPureCreator',[],callable);
    const value=emit(pureCreator,pureCreator.entry,'make_closure',[],callable,
      {function_id:pureReader.owner.id,signature_hash:'unit:signature',environment_layout:null});
    ret(pureCreator,pureCreator.entry,value);
    result.records.get(pureCreator.owner.id).upper.facets.unknownHost=mode==='unconnected-host';
  }
  const breaking=mode.endsWith('-break'),parameters=[{id:'loopConsumer/limit',type:u32}];
  if(breaking)parameters.push({id:'loopConsumer/break',type:boolTypeId});
  const root=plan('loopConsumer',parameters,i32TypeId),graph=root.graph,
    header=graph.newBlock([u32]),body=graph.newBlock(),done=graph.newBlock(breaking?[callable]:[]),
    conditionExit=breaking?graph.newBlock():done;
  const invoke=(from,target,args,returnType,indirect=false,targets=null)=>{
    const normal=graph.newBlock([returnType]),language=graph.newBlock([model.payload]),
      properties=indirect?{signature_hash:'unit:signature',targets:{top:false,functions:targets.map(function_id=>({function_id,signature_hash:'unit:signature'}))}}
        :{function_id:target,signature_hash:'unit:signature'};
    graph.terminal(from,indirect?'invoke_indirect':'invoke',args,[normal,language],properties,
      {start:520+factoryCalls.length*20+readerCalls.length*2,end:529+factoryCalls.length*20+readerCalls.length*2});
    const operation=from.instructions.at(-1);ret(root,language,{...language.parameters[0]},true);
    return {block:normal,value:{...normal.parameters[0]},operation};
  };
  const create=from=>{
    let args=mode==='recursive'?[emit(root,from,'boolean',[],boolTypeId,{value:false})]:[],selected;
    if(pureCreator){
      const id='unit:LoopCreator';if(!model.types.has(id)){
        const type={id,kind:'function',parameters:[],returnType:callable};model.types.set(id,type);model.hir.types.push(type);
      }
      const code=emit(root,from,'make_closure',[],id,{function_id:factory.owner.id,signature_hash:'unit:signature',environment_layout:null});
      selected=invoke(from,null,[code],callable,true,[factory.owner.id,pureCreator.owner.id]);
    }else selected=invoke(from,factory.owner.id,args,callable);
    factoryCalls.push(selected.operation);return selected;
  };
  const consume=(from,value)=>{
    const selected=invoke(from,null,[value],i32TypeId,true,[reader.owner.id,...(pureReader?[pureReader.owner.id]:[])]);
    readerCalls.push(selected.operation);return selected;
  };
  let initial=null,outer=null,field=null,current=root.entry;
  if(mode.startsWith('old-')||breaking){const created=create(current);initial=created.value;current=created.block;}
  if(mode==='old-cell'){
    const binding='loopConsumer/saved';model.bindings.set(binding,{id:binding,type:callable,role:'local'});
    outer=emit(root,current,'cell',[],'cell:'+callable,{binding});
    emit(root,current,'store',[outer,initial],null,{binding});
  }else if(mode==='old-field'){
    field={id:'LoopHolder/reader',sourceBinding:'LoopHolder/reader',name:'reader',type:callable};
    const type={id:'unit:LoopHolder',kind:'reference',fields:[field],methods:[]};model.types.set(type.id,type);model.hir.types.push(type);
    model.fields.set(field.id,field);model.bindings.set(field.sourceBinding,{id:field.sourceBinding,type:callable,role:'field'});
    outer=emit(root,current,'allocate_reference',[],type.id,{type:type.id,construction:'unit'});
    emit(root,current,'field_store',[outer,initial],null,{field:field.id,initialize:true});
  }
  graph.branch(current,header,[number(root,current,0,u32)],range);
  const condition=emit(root,header,'binary',[{...header.parameters[0]},{...root.entry.parameters[0]}],boolTypeId,{operator:'<'});
  graph.conditional(header,condition,body,conditionExit,range);
  if(breaking)graph.branch(conditionExit,done,[initial],range);
  let oldLoad=null;
  current=body;
  if(outer){
    oldLoad=emit(root,current,field?'field_load':'load',[outer],callable,field?{field:field.id}:{});
    current=consume(current,oldLoad).block;
  }
  const first=create(current);current=first.block;
  let second=null;if(mode==='two'){second=create(current);current=second.block;}
  if(outer)emit(root,current,field?'field_store':'store',[outer,first.value],null,field?{field:field.id,initialize:false}:{binding:'loopConsumer/saved'});
  current=consume(current,first.value).block;
  if(second)current=consume(current,second.value).block;
  let backedge=current;
  if(breaking){
    const stop=graph.newBlock(),next=graph.newBlock();graph.conditional(current,{...root.entry.parameters[1]},stop,next,range);
    graph.branch(stop,done,[first.value],range);backedge=next;
  }
  const next=emit(root,backedge,'binary',[{...header.parameters[0]},number(root,backedge,1,u32)],u32,{operator:'+'});
  graph.branch(backedge,header,[next],range);
  if(mode==='live-break'){const used=consume(done,{...done.parameters[0]});ret(root,used.block,used.value);}
  else ret(root,done,number(root,done,0));
  model.hir.closure.roots=[{kind:'application',target:root.owner.id}];model.hir.functions=[...model.functions.values()];
  return {...result,mode,root:root.owner.id,factory:factory.owner.id,reader:reader.owner.id,header:header.name,body:body.name,
    backedge:backedge.name,done:done.name,factoryCalls,readerCalls,oldLoad,outer,field,
    ownerSlot:'unit:owner-slot',spanSlot:'unit:slot',pureCreator:pureCreator?.owner.id,pureReader:pureReader?.owner.id};
}
// A may receiver/copy cannot make its unselected empty alternative own A.
// These are normalized actual models, with no official Source-fact authority.
export function loopMayHoldingModel(mode,bothHeld=false){
  if(!['may-field','may-array','inline-value-copy'].includes(mode))throw new TypeError('unknown may holding model');
  const result=loopFactoryModel('descriptor-only'),{model,plans}=result.program,
    factory=plans.find(p=>p.owner.id===result.factory),root=plans.find(p=>p.owner.id===result.root),
    reader=plans.find(p=>p.owner.id===result.reader),array='unit:Array',span='unit:Span',callable='unit:Callable',
    absence=sha256('tsfg.type\0undefined'),maybe='unit:MaybeArrayOwner',holder='unit:MayHolder',
    range={start:600,end:609},field={id:holder+'/keeper',sourceBinding:holder+'/keeper',name:'keeper',type:maybe},
    rows=[{id:absence,kind:'undefined'},{id:maybe,kind:'union',members:[absence,array]},
      mode==='may-array'?{id:holder,kind:'array',elementType:maybe}:{id:holder,kind:mode==='inline-value-copy'?'value':'reference',fields:[field],methods:[]}];
  for(const type of rows){model.types.set(type.id,type);model.hir.types.push(type);}
  if(mode!=='may-array'){
    model.fields.set(field.id,field);model.bindings.set(field.sourceBinding,{id:field.sourceBinding,type:maybe,role:'field'});
  }
  const parameter={id:factory.owner.id+'/choice',type:boolTypeId};
  factory.parameters=[parameter];Object.assign(factory.owner,{parameters:[parameter],lexicalParent:root.owner.id});
  model.bindings.set(parameter.id,{...parameter,role:'parameter'});
  result.records.get(factory.owner.id).upper.parameters=[{index:0,read:true,write:false,structural:false}];
  const graph=createCommonGraph(model,factory.owner),entry=graph.newBlock([boolTypeId]);Object.assign(factory,{graph,entry});
  const emit=(p,b,name,args,type,props={})=>p.graph.emit(b,name,args,type,props,range),
    number=(p,b,n,type=i32TypeId)=>emit(p,b,'constant',[],type,{decimal:String(n),token:String(n)}),
    ret=(p,b,value)=>p.graph.terminal(b,'func.return',[value],[],{},range),
    owned=emit(factory,entry,'array_create',[number(factory,entry,1)],array,{allocation:'A'}),
    borrowed=emit(factory,entry,'readspan',[owned,number(factory,entry,0),number(factory,entry,1)],span),
    empty=emit(factory,entry,'view',[emit(factory,entry,'undefined',[],absence)],maybe,{target:maybe}),
    make=initial=>{
      if(mode==='may-array')return emit(factory,entry,'array_create',[initial],holder,{allocation:'holder'});
      const value=emit(factory,entry,mode==='inline-value-copy'?'construct_value':'allocate_reference',[],holder,{type:holder,construction:'unit'});
      emit(factory,entry,'field_store',[value,initial],null,{field:field.id,initialize:true});return value;
    },left=make(bothHeld?owned:empty),right=make(bothHeld||mode==='inline-value-copy'?owned:empty),
    yes=graph.newBlock(),no=graph.newBlock(),join=graph.newBlock([holder]);
  graph.conditional(entry,{...entry.parameters[0]},yes,no,range);
  graph.branch(yes,join,[left],range);graph.branch(no,join,[right],range);
  const selected={...join.parameters[0]};let captured=right,write=null,copied=null;
  if(mode==='inline-value-copy')copied=captured=emit(factory,join,'value_copy',[selected],holder,{type:holder});
  else {
    const args=mode==='may-array'?[selected,number(factory,join,0),owned]:[selected,owned];
    emit(factory,join,mode==='may-array'?'array_store':'field_store',args,null,mode==='may-array'?{element:maybe}:{field:field.id,initialize:false});
    write=join.instructions.at(-1);
  }
  const layout=model.environments.get('unit:Environment'),slot={binding:'entry/holder',key:'unit:holder-slot',type:holder,writable:true,kind:'local'};
  layout.slots.push(slot);model.slots.set(slot.binding,{...slot,layout:layout.id});model.bindings.set(slot.binding,{id:slot.binding,type:holder,role:'local'});
  const env=emit(factory,join,'env_alloc',[],'env:'+layout.id,{layout:layout.id});
  emit(factory,join,'env_init',[env,borrowed],null,{layout:layout.id,binding:'entry/span',key:result.spanSlot});
  emit(factory,join,'env_init',[env,captured],null,{layout:layout.id,binding:slot.binding,key:slot.key});
  ret(factory,join,emit(factory,join,'make_closure',[env],callable,
    {function_id:reader.owner.id,signature_hash:'unit:signature',environment_layout:layout.id}));
  // The returned reader really reads both captures; no hidden owning capture.
  const readerTerminal=reader.entry.instructions.pop();reader.entry.terminated=false;
  const loaded=emit(reader,reader.entry,'env_load',[{...reader.entry.parameters[0]}],holder,{layout:layout.id,binding:slot.binding,key:slot.key});
  emit(reader,reader.entry,mode==='may-array'?'array_read':'field_load',mode==='may-array'?[loaded,number(reader,reader.entry,0)]:[loaded],maybe,
    mode==='may-array'?{element:maybe}:{field:field.id});
  ret(reader,reader.entry,{name:readerTerminal.operands[0],type:i32TypeId});
  // A finite unknown bool enters the acyclic factory from the real loop call.
  const call=result.factoryCalls[0],block=root.graph.blocks.find(b=>b.instructions.includes(call)),
    temporary={...block,instructions:[],terminated:false},zero=number(root,temporary,0,scalarTypeIds.u32),
    choice=emit(root,temporary,'binary',[{...root.entry.parameters[0]},zero],boolTypeId,{operator:'==='});
  block.instructions.splice(block.instructions.indexOf(call),0,...temporary.instructions);call.operands.push(choice.name);
  return {...result,mode,holder,field:mode==='may-array'?null:field,owned:owned.name,left:left.name,right:right.name,
    selected:selected.name,write,copied:copied?.name,join:join.name,holderSlot:slot.key,condition:parameter.id};
}
