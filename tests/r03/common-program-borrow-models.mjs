// SPDX-License-Identifier: MIT
// Normalized private actual-flow models, with no Source/Core qualification.
import {i32TypeId,scalarTypeIds,boolTypeId,sha256} from '../../compiler/identity.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {commonMethods} from '../../compiler/common-program-methods.mjs';
export function commonBorrowModel(mode='direct',structural=false) {
  const array='unit:Array',span='unit:Span',callable='unit:Callable',box='unit:Box',unknown='unit:Unknown',holders='unit:Holders',field={id:'Box/span',sourceBinding:'Box/span',name:'span',type:span},
    rows=[{id:i32TypeId,kind:'scalar',name:'i32'},{id:scalarTypeIds.u32,kind:'scalar',name:'u32'},
      {id:array,kind:'array',elementType:i32TypeId},{id:span,kind:'readSpan',elementType:i32TypeId},
      {id:callable,kind:'function',parameters:[array],returnType:i32TypeId},{id:unknown,kind:'unknown'},{id:holders,kind:'array',elementType:box},
      {id:box,kind:'reference',fields:[field],methods:mode==='method'?['target']:[]}];
  const functions=new Map(),bindings=new Map([[field.sourceBinding,{id:field.sourceBinding,type:span,role:'field'}]]),plans=[],records=new Map(),
    model={types:new Map(rows.map(t=>[t.id,t])),functions,bindings,fields:new Map([[field.id,field]]),globals:new Map(),slots:new Map(),environments:new Map(),
      spend:commonMeter(1000000),payload:'payload:unit',limits:{registersPerFunction:4096,blocksPerFunction:256,instructionsPerFunction:8192},
      hir:{types:rows,functions:[],globals:[],environments:[],snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[{kind:'application',target:'entry'}]}}};
  function plan(id,types=[],returnType=i32TypeId,method=false){
    const parameters=types.map((type,i)=>({id:id+'/p'+i,type})),owner={id,name:id,sourceBinding:id,kind:method?'method':'source',ownerType:method?box:null,
      sourcePath:'/unit-model.ts',range:{start:0,end:1},signatureHash:'unit:signature',parameters:method?parameters.slice(1):parameters,returnType},
      graph=createCommonGraph(model,owner),entry=graph.newBlock(types),p={owner,parameters,graph,entry,returnType};
    for(const parameter of parameters)bindings.set(parameter.id,{...parameter,role:'parameter'});functions.set(id,owner);plans.push(p);
    records.set(id,{upper:{globals:{reads:[],writes:[]},parameters:parameters.map((_,index)=>({index,read:true,write:false,structural:false})),captures:[],facets:{unknownHost:false}}});return p;
  }
  const emit=(p,b,name,args,type,properties={})=>p.graph.emit(b,name,args,type,properties,{start:10,end:20});
  const constant=(p,b,n)=>emit(p,b,'constant',[],i32TypeId,{decimal:String(n),token:String(n)});
  const ret=(p,b,value)=>p.graph.terminal(b,'func.return',[value],[],{},{start:20,end:21});
  const view=parameter=>({...parameter});
  function invoke(p,b,name,args,properties,resultType=i32TypeId){const normal=p.graph.newBlock([resultType]),language=p.graph.newBlock([model.payload]);
    p.graph.terminal(b,name,args,[normal,language],properties,{start:30,end:40});p.graph.terminal(language,'return_throw',[view(language.parameters[0])],[],{},{start:40,end:41});return normal;}
  function makeSpan(p,b,a){return emit(p,b,'readspan',[a,constant(p,b,0),constant(p,b,1)],span);}
  const layout={id:'unit:Environment',owner:'entry',parent:null,slots:[]};
  if(mode==='hidden'){model.environments.set(layout.id,layout);model.hir.environments.push(layout);}
  const target=plan('target',mode==='hidden'?['env:'+layout.id,array]:mode==='method'?[box,array]:[mode==='consume'?span:array],mode==='factory'?span:mode==='holder-factory'?box:i32TypeId,mode==='method');
  if(mode==='hidden'){
    Object.assign(target.owner,{lexicalParent:'entry',lexicalEnvironment:layout.id,parameters:[target.parameters[1]]});Object.assign(target.parameters[0],{hidden:true});
    records.get('target').upper.parameters=[{index:0,read:true,write:false,structural}];
  }
  if(mode==='holder-factory'){
    const owned=emit(target,target.entry,'array_create',[constant(target,target.entry,1)],array,{allocation:'unit'}),borrow=makeSpan(target,target.entry,owned),holder=emit(target,target.entry,'allocate_reference',[],box,{type:box,construction:'unit'});
    emit(target,target.entry,'field_store',[holder,borrow],null,{field:field.id,initialize:true});ret(target,target.entry,holder);
  }else if(mode==='consume')ret(target,target.entry,emit(target,target.entry,'array_read',[view(target.entry.parameters[0]),constant(target,target.entry,0)],i32TypeId,{element:i32TypeId}));
  else if(mode==='factory')ret(target,target.entry,makeSpan(target,target.entry,view(target.entry.parameters[0])));
  else ret(target,target.entry,constant(target,target.entry,1));
  if(structural)records.get('target').upper.parameters[mode==='method'?1:0].structural=true;
  const entry=plan('entry',mode==='external-store'?[box]:['unknown-span','unknown-pass','return-unknown-owner'].includes(mode)?[unknown]:[],
    mode==='return-array'?holders:mode==='holder-factory'||mode.startsWith('return-')?mode==='return-direct-span'?span:box:i32TypeId),
    a=mode==='return-unknown-owner'?emit(entry,entry.entry,'assert',[view(entry.entry.parameters[0])],array,{operator:'as'}):emit(entry,entry.entry,'array_create',[constant(entry,entry.entry,1)],array,{allocation:'unit'}),s=makeSpan(entry,entry.entry,a);
  if(mode.startsWith('return-')){
    const holder=emit(entry,entry.entry,'allocate_reference',[],box,{type:box,construction:'unit'});emit(entry,entry.entry,'field_store',[holder,s],null,{field:field.id,initialize:true});
    ret(entry,entry.entry,mode==='return-direct-span'?s:mode==='return-array'?emit(entry,entry.entry,'array_create',[holder],holders,{allocation:'unit'}):holder);
  }else if(mode==='unknown-span'||mode==='unknown-pass'){
    const value=view(entry.entry.parameters[0]);ret(entry,entry.entry,mode==='unknown-pass'?value:emit(entry,entry.entry,'readspan_length',[emit(entry,entry.entry,'assert',[value],span,{operator:'as'})],scalarTypeIds.u32));
  }else if(mode==='external-store'){
    emit(entry,entry.entry,'field_store',[view(entry.entry.parameters[0]),s],null,{field:field.id,initialize:false});ret(entry,entry.entry,constant(entry,entry.entry,1));
  }else if(mode==='holder-factory'){
    const normal=invoke(entry,entry.entry,'invoke',[a],{function_id:'target',signature_hash:'unit:signature'},box);ret(entry,normal,view(normal.parameters[0]));
  }else if(mode==='factory'){
    const first=invoke(entry,entry.entry,'invoke',[a],{function_id:'target',signature_hash:'unit:signature'},span),b=emit(entry,first,'array_create',[constant(entry,first,2)],array,{allocation:'unit'}),
      second=invoke(entry,first,'invoke',[b],{function_id:'target',signature_hash:'unit:signature'},span);
    emit(entry,second,'array_resize',[b,constant(entry,second,0)],null);ret(entry,second,emit(entry,second,'array_read',[view(first.parameters[0]),constant(entry,second,0)],i32TypeId,{element:i32TypeId}));
  }else{
    let args=[mode==='consume'?s:a],name='invoke',properties=/** @type {any} */({function_id:'target',signature_hash:'unit:signature'});
    if(mode==='hidden')args=[emit(entry,entry.entry,'env_alloc',[],'env:'+layout.id,{layout:layout.id}),a];
    if(mode==='indirect'){const fn=emit(entry,entry.entry,'make_closure',[],callable,{function_id:'target',signature_hash:'unit:signature',environment_layout:null});
      args=[fn,a];name='invoke_indirect';properties={signature_hash:'unit:signature',targets:{top:false,functions:[{function_id:'target',signature_hash:'unit:signature'}]}};}
    if(mode==='method'){const receiver=emit(entry,entry.entry,'allocate_reference',[],box,{type:box,construction:'unit'});args=[receiver,a];name='invoke_method';
      model.hir.functions=[...functions.values()];properties={function_id:'target',signature_hash:'unit:signature',dispatch:commonMethods(model.hir,model.spend).dispatch('target',box)};}
    const normal=invoke(entry,entry.entry,name,args,properties);
    if(mode==='consume'){emit(entry,normal,'array_resize',[a,constant(entry,normal,0)],null);ret(entry,normal,view(normal.parameters[0]));}
    else ret(entry,normal,emit(entry,normal,'array_read',[s,constant(entry,normal,0)],i32TypeId,{element:i32TypeId}));
  }
  model.hir.functions=[...functions.values()];model.callables={summaries:new Map([...functions].map(([id])=>[id,{parameters:new Map()}]))};
  return {program:{model,plans},records};
}
export function commonBorrowAlternativeModel(sameBacking=false,absentBacking=false){
  const result=commonBorrowModel('return-holder'),{model,plans}=result.program,p=plans.find(p=>p.owner.id==='entry'),
    type='unit:InlineHolder',array='unit:Array',span='unit:Span',range={start:50,end:60},
    fields=[{id:type+'/span',sourceBinding:type+'/span',name:'span',type:span},{id:type+'/backing',sourceBinding:type+'/backing',name:'backing',type:array}];
  model.types.set(type,{id:type,kind:'value',fields,methods:[]});model.types.set(boolTypeId,{id:boolTypeId,kind:'scalar',name:'bool'});model.hir.types.push(model.types.get(type),model.types.get(boolTypeId));
  const absence=sha256('tsfg.type\0undefined');if(absentBacking){model.types.set(absence,{id:absence,kind:'undefined'});model.hir.types.push(model.types.get(absence));}
  for(const field of fields){model.fields.set(field.id,field);model.bindings.set(field.sourceBinding,{id:field.sourceBinding,type:field.type,role:'field'});}
  const parameter={id:'entry/condition',type:boolTypeId};model.bindings.set(parameter.id,{...parameter,role:'parameter'});Object.assign(p.owner,{parameters:[parameter],returnType:type});
  const graph=createCommonGraph(model,p.owner),entry=graph.newBlock([boolTypeId]);Object.assign(p,{graph,entry,parameters:[parameter],returnType:type});
  result.records.get('entry').upper.parameters=[{index:0,read:true,write:false,structural:false}];
  const emit=(b,name,args,view,props={})=>graph.emit(b,name,args,view,props,range),constant=n=>emit(entry,'constant',[],i32TypeId,{decimal:String(n),token:String(n)}),
    zero=constant(0),one=constant(1),a=emit(entry,'array_create',[one],array,{allocation:'unit'}),b=emit(entry,'array_create',[one],array,{allocation:'unit'}),
    borrowed=emit(entry,'readspan',[a,zero,one],span),holder=emit(entry,'construct_value',[],type,{type,construction:'unit'}),yes=graph.newBlock(),no=graph.newBlock(),join=graph.newBlock();
  emit(entry,'field_store',[holder,borrowed],null,{field:fields[0].id,initialize:true});graph.conditional(entry,{...entry.parameters[0]},yes,no,range);
  emit(yes,'field_store',[holder,a],null,{field:fields[1].id,initialize:true});graph.branch(yes,join,[],range);
  const alternative=absentBacking?emit(no,'view',[emit(no,'undefined',[],absence)],array,{target:array}):sameBacking?a:b;
  emit(no,'field_store',[holder,alternative],null,{field:fields[1].id,initialize:true});graph.branch(no,join,[],range);
  const copied=emit(join,'value_copy',[holder],type,{type}),returned=emit(join,'field_load',[copied],array,{field:fields[1].id});
  graph.terminal(join,'func.return',[copied],[],{},range);return {...result,backingRead:returned.name,entryId:p.owner.id};
}
export function commonBorrowConstructorModel(role='construction-body'){
  const result=commonBorrowModel('external-store'),{model,plans}=result.program,p=plans.find(p=>p.owner.id==='entry'),
    parameters=[{id:'entry/this',type:'unit:Box'},{id:'entry/span',type:'unit:Span'}],range={start:70,end:80};
  Object.assign(p.owner,{kind:role,ownerType:'unit:Box',receiverBinding:parameters[0].id,parameters:[parameters[1]],returnType:'unit:Box'});
  for(const [index,parameter]of parameters.entries())model.bindings.set(parameter.id,{...parameter,role:index===0?'receiver':'parameter'});
  const graph=createCommonGraph(model,p.owner),entry=graph.newBlock(parameters.map(p=>p.type));Object.assign(p,{graph,entry,parameters,returnType:'unit:Box'});
  graph.emit(entry,'field_store',entry.parameters.map(p=>({...p})),null,{field:'Box/span',initialize:true},range);
  graph.terminal(entry,'func.return',[{...entry.parameters[0]}],[],{},range);
  result.records.get('entry').upper.parameters=parameters.map((_,index)=>({index,read:true,write:false,structural:false}));return result;
}
