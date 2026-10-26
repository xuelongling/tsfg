// SPDX-License-Identifier: MIT
// Normalized actual-flow controls only; these are not official Source facts.
import {i32TypeId,boolTypeId} from '../../compiler/identity.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {commonBorrowModel} from './common-program-borrow-models.mjs';
export function readspanClosureModel(mode='last-use') {
  const result=commonBorrowModel('hidden'),{model,plans}=result.program,
    root=plans.find(p=>p.owner.id==='entry'),target=plans.find(p=>p.owner.id==='target'),
    array='unit:Array',span='unit:Span',callable='unit:Callable',layout=model.environments.get('unit:Environment'),
    slot={binding:'entry/span',key:'unit:slot',type:span,writable:true,kind:'local'};
  layout.slots=[slot];model.slots.set(slot.binding,{...slot,layout:layout.id});
  model.types.get(callable).parameters=[];
  model.bindings.set(slot.binding,{id:slot.binding,type:span,role:'local'});
  Object.assign(root.owner,{activationEnvironment:layout.id});
  if(mode==='escape-return'){root.owner.returnType=callable;root.returnType=callable;}
  Object.assign(target.owner,{parameters:[]});target.parameters=[{id:'lexical:target',type:'env:'+layout.id,hidden:true}];
  result.records.get('target').upper.parameters=[];
  const fresh=(plan,parameters=[])=>{const graph=createCommonGraph(model,plan.owner),entry=graph.newBlock(parameters.map(p=>p.type));Object.assign(plan,{graph,entry,parameters});return entry;};
  const range={start:10,end:20},emit=(plan,block,name,args,type,props={})=>plan.graph.emit(block,name,args,type,props,range),
    constant=(plan,block,n)=>emit(plan,block,'constant',[],i32TypeId,{decimal:String(n),token:String(n)}),
    ret=(plan,block,value)=>plan.graph.terminal(block,'func.return',[value],[],{},range),
    read=(plan,block,value)=>emit(plan,block,'array_read',[value,constant(plan,block,0)],i32TypeId,{element:i32TypeId});
  const body=fresh(target,target.parameters),loaded=emit(target,body,'env_load',[{...body.parameters[0]}],span,{layout:layout.id,binding:slot.binding,key:slot.key});
  ret(target,body,read(target,body,loaded));
  const entry=fresh(root),env=emit(root,entry,'env_alloc',[],'env:'+layout.id,{layout:layout.id}),
    a=emit(root,entry,'array_create',[constant(root,entry,1)],array,{allocation:'a'}),
    b=emit(root,entry,'array_create',[constant(root,entry,2)],array,{allocation:'b'}),
    borrow=owner=>emit(root,entry,'readspan',[owner,constant(root,entry,0),constant(root,entry,1)],span),
    original=borrow(a),replacement=borrow(b),properties={layout:layout.id,binding:slot.binding,key:slot.key};
  emit(root,entry,'env_init',[env,original],null,properties);
  const closure=emit(root,entry,'make_closure',[env],callable,{function_id:'target',signature_hash:'unit:signature',environment_layout:layout.id});
  let current=entry;
  const resize=(block,owner)=>emit(root,block,'array_resize',[owner,constant(root,block,0)],null),
    call=()=>{const normal=root.graph.newBlock([i32TypeId]),language=root.graph.newBlock([model.payload]),indirect=mode==='indirect',
      props=indirect?{signature_hash:'unit:signature',targets:{top:false,functions:[{function_id:'target',signature_hash:'unit:signature'}]}}
        :{function_id:'target',signature_hash:'unit:signature'};
      root.graph.terminal(current,indirect?'invoke_indirect':'invoke',[indirect?closure:env],[normal,language],props,{start:30,end:40});
      root.graph.terminal(language,'return_throw',[{...language.parameters[0]}],[],{},range);current=normal;return {...normal.parameters[0]};};
  if(mode==='escape-global'){
    const global={id:'unit:global',sourceBinding:'unit:global-binding',type:callable};model.globals.set(global.id,global);model.hir.globals.push(global);
    model.bindings.set(global.sourceBinding,{id:global.sourceBinding,type:callable,role:'global'});
    emit(root,current,'global_store',[closure],null,{global:global.id,initialize:false});ret(root,current,constant(root,current,1));
  }else if(mode==='never-called'){resize(current,a);ret(root,current,constant(root,current,1));}
  else if(mode==='late-use'){resize(current,a);const value=call();ret(root,current,value);}
  else if(mode==='mutable'||mode==='mutable-conflict'||mode==='mutable-after-use'){
    if(mode==='mutable-after-use')call();
    emit(root,current,'env_store',[env,replacement],null,properties);resize(current,mode==='mutable-conflict'?b:a);
    const value=call();ret(root,current,value);
  }else if(mode==='escape-return')ret(root,current,closure);
  else {const value=call();resize(current,a);ret(root,current,value);}
  model.hir.functions=[...model.functions.values()];return result;
}
export function readspanClosureMayEnvironmentModel(){
  const result=readspanClosureModel(),{model,plans}=result.program,root=plans.find(p=>p.owner.id==='entry'),
    layout=model.environments.get('unit:Environment'),slot=layout.slots[0],environment='env:'+layout.id,
    parameter={id:'entry/condition',type:boolTypeId},range={start:50,end:60};
  model.types.set(boolTypeId,{id:boolTypeId,kind:'scalar',name:'bool'});model.hir.types.push(model.types.get(boolTypeId));
  model.bindings.set(parameter.id,{...parameter,role:'parameter'});root.owner.parameters=[parameter];root.parameters=[parameter];
  result.records.get('entry').upper.parameters=[{index:0,read:true,write:false,structural:false}];
  const graph=createCommonGraph(model,root.owner),entry=graph.newBlock([boolTypeId]);Object.assign(root,{graph,entry});
  const emit=(block,name,args,type,props={})=>graph.emit(block,name,args,type,props,range),
    constant=n=>emit(entry,'constant',[],i32TypeId,{decimal:String(n),token:String(n)}),zero=constant(0),one=constant(1),
    a=emit(entry,'array_create',[one],'unit:Array',{allocation:'a'}),b=emit(entry,'array_create',[one],'unit:Array',{allocation:'b'}),
    sa=emit(entry,'readspan',[a,zero,one],'unit:Span'),sb=emit(entry,'readspan',[b,zero,one],'unit:Span'),
    first=emit(entry,'env_alloc',[],environment,{layout:layout.id}),second=emit(entry,'env_alloc',[],environment,{layout:layout.id}),
    props={layout:layout.id,binding:slot.binding,key:slot.key},yes=graph.newBlock(),no=graph.newBlock(),join=graph.newBlock([environment]);
  emit(entry,'env_init',[first,sa],null,props);emit(entry,'env_init',[second,sb],null,props);
  graph.conditional(entry,{...entry.parameters[0]},yes,no,range);graph.branch(yes,join,[first],range);graph.branch(no,join,[second],range);
  emit(join,'env_store',[{...join.parameters[0]},sb],null,props);emit(join,'array_resize',[a,zero],null);
  const normal=graph.newBlock([i32TypeId]),language=graph.newBlock([model.payload]);
  graph.terminal(join,'invoke',[first],[normal,language],{function_id:'target',signature_hash:'unit:signature'},range);
  graph.terminal(normal,'func.return',[{...normal.parameters[0]}],[],{},range);graph.terminal(language,'return_throw',[{...language.parameters[0]}],[],{},range);
  return result;
}
export function readspanClosureParentModel(){
  const result=readspanClosureModel(),{model,plans}=result.program,target=plans.find(p=>p.owner.id==='target'),
    root=plans.find(p=>p.owner.id==='entry'),parent=model.environments.get('unit:Environment'),range={start:70,end:80},
    child={id:'unit:ChildEnvironment',owner:'middle',parent:parent.id,slots:[{binding:'middle/n',key:'unit:child-slot',type:i32TypeId,writable:false,kind:'local'}]},
    owner={...target.owner,id:'middle',name:'middle',sourceBinding:'middle',lexicalParent:'entry',lexicalEnvironment:parent.id,activationEnvironment:child.id},
    graph=createCommonGraph(model,owner),parameters=[{id:'lexical:middle',type:'env:'+parent.id,hidden:true}],entry=graph.newBlock(parameters.map(p=>p.type)),
    middle={owner,graph,parameters,entry,returnType:i32TypeId},emit=(p,b,name,args,type,props={})=>p.graph.emit(b,name,args,type,props,range);
  model.environments.set(child.id,child);model.hir.environments.push(child);model.functions.set(owner.id,owner);plans.push(middle);
  model.bindings.set('middle/n',{id:'middle/n',type:i32TypeId,role:'local'});model.slots.set('middle/n',{...child.slots[0],layout:child.id});
  result.records.set('middle',{upper:{globals:{reads:[],writes:[]},parameters:[],captures:[],facets:{unknownHost:false}}});model.callables.summaries.set('middle',{parameters:new Map()});
  const env=emit(middle,entry,'env_alloc',[{...entry.parameters[0]}],'env:'+child.id,{layout:child.id}),one=emit(middle,entry,'constant',[],i32TypeId,{decimal:'1',token:'1'});
  emit(middle,entry,'env_init',[env,one],null,{layout:child.id,binding:'middle/n',key:child.slots[0].key});
  const normal=graph.newBlock([i32TypeId]),language=graph.newBlock([model.payload]);graph.terminal(entry,'invoke',[env],[normal,language],{function_id:'target',signature_hash:'unit:signature'},range);
  graph.terminal(normal,'func.return',[{...normal.parameters[0]}],[],{},range);graph.terminal(language,'return_throw',[{...language.parameters[0]}],[],{},range);
  Object.assign(target.owner,{lexicalParent:'middle',lexicalEnvironment:child.id});target.parameters=[{id:'lexical:target',type:'env:'+child.id,hidden:true}];
  const targetGraph=createCommonGraph(model,target.owner),body=targetGraph.newBlock(['env:'+child.id]);Object.assign(target,{graph:targetGraph,entry:body});
  const outer=emit(target,body,'env_parent',[{...body.parameters[0]}],'env:'+parent.id,{layout:parent.id}),span=emit(target,body,'env_load',[outer],'unit:Span',{layout:parent.id,binding:parent.slots[0].binding,key:parent.slots[0].key}),
    zero=emit(target,body,'constant',[],i32TypeId,{decimal:'0',token:'0'}),read=emit(target,body,'array_read',[span,zero],i32TypeId,{element:i32TypeId});targetGraph.terminal(body,'func.return',[read],[],{},range);
  for(const block of root.graph.blocks)for(const op of block.instructions)if(['tsfg_program.invoke','tsfg_program.make_closure'].includes(op.name))op.properties.function_id='middle';
  model.hir.functions=[...model.functions.values()];return result;
}
export function readspanCrossCallModel(mode='last-use'){
  const result=commonBorrowModel(),{model,plans}=result.program,target=plans.find(p=>p.owner.id==='target'),root=plans.find(p=>p.owner.id==='entry'),
    array='unit:Array',span='unit:Span',callable='unit:Callable',returned=mode==='fresh-return'?span:i32TypeId,
    parameters=[{id:'target/p0',type:array},...(mode==='upper-only'?[]:[{id:'target/p1',type:span}])],range={start:110,end:120};
  Object.assign(target.owner,{parameters,returnType:returned});target.parameters=parameters;target.returnType=returned;
  for(const p of parameters)model.bindings.set(p.id,{...p,role:'parameter'});
  Object.assign(model.types.get(callable),{parameters:parameters.map(p=>p.type),returnType:returned});
  result.records.get('target').upper.parameters=parameters.map((_,index)=>({index,read:true,write:false,structural:index===0}));
  const reset=p=>{const graph=createCommonGraph(model,p.owner),entry=graph.newBlock(p.parameters.map(p=>p.type));Object.assign(p,{graph,entry});return entry;},
    emit=(p,b,name,args,type,properties={})=>p.graph.emit(b,name,args,type,properties,range),
    constant=(p,b,n)=>emit(p,b,'constant',[],i32TypeId,{decimal:String(n),token:String(n)}),
    read=(p,b,s)=>emit(p,b,'array_read',[s,constant(p,b,0)],i32TypeId,{element:i32TypeId}),
    borrow=(p,b,a)=>emit(p,b,'readspan',[a,constant(p,b,0),constant(p,b,0)],span),
    ret=(p,b,value,thrown=false)=>p.graph.terminal(b,thrown?'return_throw':'func.return',[value],[],{},range),
    body=reset(target),owner={...body.parameters[0]},view={...body.parameters[1]};
  let value=constant(target,body,1);
  if(mode!=='fresh-return'&&mode!=='upper-only')value=read(target,body,view);
  if(mode!=='upper-only')emit(target,body,'array_resize',[owner,constant(target,body,0)],null);
  if(mode==='late-callee-use')value=read(target,body,view);
  if(mode==='fresh-return')value=borrow(target,body,owner);
  ret(target,body,value,mode==='throw-late-use');
  const entry=reset(root),a=emit(root,entry,'array_create',[constant(root,entry,1)],array,{allocation:'a'}),s=borrow(root,entry,a),
    normal=root.graph.newBlock([returned]),language=root.graph.newBlock([model.payload]);
  let name='invoke',args=mode==='upper-only'?[a]:[a,s];
  /** @type {any} */
  let properties={function_id:'target',signature_hash:'unit:signature'};
  if(mode==='wide-indirect'){
    const other={...target.owner,id:'unconnected',parameters:parameters.map((p,i)=>({...p,id:'unconnected/p'+i}))},graph=createCommonGraph(model,other),
      otherEntry=graph.newBlock(other.parameters.map(p=>p.type)),plan={owner:other,graph,entry:otherEntry,parameters:other.parameters,returnType:returned};
    model.functions.set(other.id,other);plans.push(plan);for(const p of other.parameters)model.bindings.set(p.id,{...p,role:'parameter'});
    result.records.set(other.id,{upper:{...result.records.get('target').upper}});ret(plan,otherEntry,constant(plan,otherEntry,1));
    const closure=emit(root,entry,'make_closure',[],callable,{function_id:'target',signature_hash:'unit:signature',environment_layout:null});
    name='invoke_indirect';args=[closure,a,s];properties={signature_hash:'unit:signature',targets:{top:false,functions:['target','unconnected'].map(function_id=>({function_id,signature_hash:'unit:signature'}))}};
  }
  if(mode==='unknown-host')result.records.get('target').upper.facets.unknownHost=true;
  root.graph.terminal(entry,name,args,[normal,language],properties,{start:130,end:140});
  const later=['late-caller-use','upper-only'].includes(mode)?read(root,normal,s):mode==='fresh-return'?read(root,normal,{...normal.parameters[0]}):constant(root,normal,1);
  ret(root,normal,later);
  if(mode==='throw-late-use')ret(root,language,read(root,language,s));else root.graph.terminal(language,'return_throw',[{...language.parameters[0]}],[],{},range);
  model.hir.functions=[...model.functions.values()];return result;
}
export function readspanRecursiveCallModel(){
  const result=readspanCrossCallModel(),{model,plans}=result.program,target=plans.find(p=>p.owner.id==='target'),root=plans.find(p=>p.owner.id==='entry'),
    parameter={id:'target/condition',type:boolTypeId},range={start:150,end:160};
  model.types.set(boolTypeId,{id:boolTypeId,kind:'scalar',name:'bool'});model.hir.types.push(model.types.get(boolTypeId));
  target.parameters.push(parameter);model.bindings.set(parameter.id,{...parameter,role:'parameter'});
  result.records.get('target').upper.parameters.push({index:2,read:true,write:false,structural:false});
  const graph=createCommonGraph(model,target.owner),entry=graph.newBlock(target.parameters.map(p=>p.type)),base=graph.newBlock(),recursive=graph.newBlock(),
    normal=graph.newBlock([i32TypeId]),language=graph.newBlock([model.payload]),owner={...entry.parameters[0]},span={...entry.parameters[1]},
    zero=graph.emit(entry,'constant',[],i32TypeId,{decimal:'0',token:'0'},range),falseValue=graph.emit(entry,'boolean',[],boolTypeId,{value:false},range);
  Object.assign(target,{graph,entry});graph.conditional(entry,{...entry.parameters[2]},recursive,base,range);
  const read=block=>graph.emit(block,'array_read',[span,zero],i32TypeId,{element:i32TypeId},range),value=read(base);
  graph.emit(base,'array_resize',[owner,zero],null,{},range);graph.terminal(base,'func.return',[value],[],{},range);
  graph.terminal(recursive,'invoke',[owner,span,falseValue],[normal,language],{function_id:'target',signature_hash:'unit:signature'},range);
  graph.terminal(normal,'func.return',[read(normal)],[],{},range);graph.terminal(language,'return_throw',[{...language.parameters[0]}],[],{},range);
  for(const block of root.graph.blocks)for(const op of [...block.instructions])if(op.name==='tsfg_program.invoke'){
    const temporary={...block,instructions:[],terminated:false},value=root.graph.emit(temporary,'boolean',[],boolTypeId,{value:true},range);
    block.instructions.splice(block.instructions.indexOf(op),0,temporary.instructions[0]);op.operands.push(value.name);
  }
  return result;
}
export function readspanReturnedCaptureModel(modified=false,thrown=false){
  const result=readspanClosureModel('escape-return'),{model,plans}=result.program,factory=plans.find(p=>p.owner.id==='entry'),
    layout=model.environments.get('unit:Environment'),slot=layout.slots[0],array='unit:Array',span='unit:Span',callable='unit:Callable',range={start:170,end:180},
    parameters=[{id:'entry/owner',type:array},{id:slot.binding,type:span}],
    emit=(p,b,name,args,type,properties={})=>p.graph.emit(b,name,args,type,properties,range),
    constant=(p,b,n)=>emit(p,b,'constant',[],i32TypeId,{decimal:String(n),token:String(n)});
  // Only the wrapper is a universal entry. The factory receives the same
  // actual Array and descriptor, so retention cannot hide a missing last use.
  Object.assign(factory.owner,{parameters,lexicalParent:'caller'});factory.parameters=parameters;
  for(const p of parameters)model.bindings.set(p.id,{...p,role:'parameter'});
  const graph=createCommonGraph(model,factory.owner),entry=graph.newBlock(parameters.map(p=>p.type));Object.assign(factory,{graph,entry});
  const env=emit(factory,entry,'env_alloc',[],'env:'+layout.id,{layout:layout.id});
  emit(factory,entry,'env_init',[env,{...entry.parameters[1]}],null,{layout:layout.id,binding:slot.binding,key:slot.key});
  const closure=emit(factory,entry,'make_closure',[env],callable,{function_id:'target',signature_hash:'unit:signature',environment_layout:layout.id});
  if(modified)emit(factory,entry,'array_resize',[{...entry.parameters[0]},constant(factory,entry,0)],null);
  graph.terminal(entry,thrown?'return_throw':'func.return',[closure],[],{},range);
  result.records.get('entry').upper.parameters=parameters.map((_,index)=>({index,read:true,write:false,structural:modified&&index===0}));
  const owner={...factory.owner,id:'caller',parameters:[],returnType:i32TypeId,lexicalParent:null,activationEnvironment:null},
    callerGraph=createCommonGraph(model,owner),callerEntry=callerGraph.newBlock(),caller={owner,graph:callerGraph,entry:callerEntry,parameters:[],returnType:i32TypeId};
  model.functions.set(owner.id,owner);plans.push(caller);result.records.set(owner.id,{upper:{globals:{reads:[],writes:[]},parameters:[],captures:[],facets:{unknownHost:false}}});
  const a=emit(caller,callerEntry,'array_create',[constant(caller,callerEntry,1)],array,{allocation:'a'}),
    s=emit(caller,callerEntry,'readspan',[a,constant(caller,callerEntry,0),constant(caller,callerEntry,1)],span),
    normal=callerGraph.newBlock([callable]),language=callerGraph.newBlock([model.payload]);
  callerGraph.terminal(callerEntry,'invoke',[a,s],[normal,language],{function_id:'entry',signature_hash:'unit:signature'},range);
  for(const completion of [normal,language])callerGraph.terminal(completion,'func.return',[constant(caller,completion,1)],[],{},range);
  model.hir.closure.roots=[{kind:'application',target:'caller'}];model.hir.functions=[...model.functions.values()];return result;
}
export function readspanConstructionThrowModel(){
  const result=readspanClosureModel('escape-return'),factory=result.program.plans.find(p=>p.owner.id==='entry');
  factory.owner.kind='construction-body';
  for(const block of factory.graph.blocks)for(const op of block.instructions)if(op.name==='func.return')op.name='tsfg_program.return_throw';
  return result;
}
export function readspanIncomingEnvironmentReturnModel(parent=false,modified=false){
  const result=readspanReturnedCaptureModel(),{model,plans}=result.program,factory=plans.find(p=>p.owner.id==='entry'),caller=plans.find(p=>p.owner.id==='caller'),
    layout=model.environments.get('unit:Environment'),range={start:190,end:200},
    selected=parent?{id:'unit:IncomingChild',owner:'caller',parent:layout.id,slots:[]}:layout;
  if(parent){model.environments.set(selected.id,selected);model.hir.environments.push(selected);}
  const parameters=[{id:'lexical:entry',type:'env:'+selected.id,hidden:true}],graph=createCommonGraph(model,factory.owner),entry=graph.newBlock(parameters.map(p=>p.type));
  Object.assign(factory.owner,{parameters:[],lexicalEnvironment:selected.id,activationEnvironment:null});Object.assign(factory,{graph,entry,parameters});
  result.records.get('entry').upper.parameters=[];
  const outer=parent?graph.emit(entry,'env_parent',[{...entry.parameters[0]}],'env:'+layout.id,{layout:layout.id},range):{...entry.parameters[0]},
    closure=graph.emit(entry,'make_closure',[outer],'unit:Callable',{function_id:'target',signature_hash:'unit:signature',environment_layout:layout.id},range);
  graph.terminal(entry,'func.return',[closure],[],{},range);
  const call=caller.entry.instructions.find(op=>op.name==='tsfg_program.invoke'),temporary={...caller.entry,instructions:[],terminated:false},
    original={name:call.operands[1],type:'unit:Span'},owner={name:call.operands[0],type:'unit:Array'},
    env=caller.graph.emit(temporary,'env_alloc',[],'env:'+layout.id,{layout:layout.id},range);
  caller.graph.emit(temporary,'env_init',[env,original],null,{layout:layout.id,binding:layout.slots[0].binding,key:layout.slots[0].key},range);
  const passed=parent?caller.graph.emit(temporary,'env_alloc',[env],'env:'+selected.id,{layout:selected.id},range):env;
  if(modified){const zero=caller.graph.emit(temporary,'constant',[],i32TypeId,{decimal:'0',token:'0'},range);caller.graph.emit(temporary,'array_resize',[owner,zero],null,{},range);}
  caller.entry.instructions.splice(caller.entry.instructions.indexOf(call),0,...temporary.instructions);call.operands=[passed.name];
  return result;
}
