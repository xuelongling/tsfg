// SPDX-License-Identifier: MIT
// Normalized physical-activation controls; these are not Source proof packets.
import {boolTypeId,i32TypeId} from '../../compiler/identity.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {ownedEnvironmentModel,ownedClosureChoiceModel} from './common-program-owned-environment-models.mjs';
import {commonBorrowModel} from './common-program-borrow-models.mjs';
export function allocationActivationModel(wrapped=false,mode='acyclic'){
  const value=ownedEnvironmentModel(),{model,plans}=value.program,callable='unit:Callable',range={start:310,end:319};
  model.types.set(boolTypeId,{id:boolTypeId,kind:'scalar',name:'bool'});model.hir.types.push(model.types.get(boolTypeId));
  function plan(id,parameters){
    const owner={id,name:id,sourceBinding:id,kind:'source',sourcePath:'/unit-model.ts',range,signatureHash:'unit:signature',
      parameters,returnType:callable,lexicalParent:null,lexicalEnvironment:null,activationEnvironment:null},
      graph=createCommonGraph(model,owner),entry=graph.newBlock(parameters.map(p=>p.type)),p={owner,graph,entry,parameters,returnType:callable};
    for(const parameter of parameters)model.bindings.set(parameter.id,{...parameter,role:'parameter'});
    model.functions.set(id,owner);plans.push(p);model.callables.summaries.set(id,{parameters:new Map()});
    value.records.set(id,{upper:{globals:{reads:[],writes:[]},parameters:parameters.map((_,index)=>({index,read:true,write:false,structural:false})),captures:[],facets:{unknownHost:false}}});return p;
  }
  const ret=(p,b,v)=>p.graph.terminal(b,'func.return',[v],[],{},{start:360,end:369});
  const invoke=(p,b,target,start)=>{const normal=p.graph.newBlock([callable]),language=p.graph.newBlock([model.payload]);
    p.graph.terminal(b,'invoke',[],[normal,language],{function_id:target,signature_hash:'unit:signature'},{start,end:start+9});
    p.graph.terminal(language,'return_throw',[{...language.parameters[0]}],[],{},{start:start+10,end:start+19});return normal;};
  let target='entry';if(wrapped){const wrapper=plan('allocationWrapper',[]),normal=invoke(wrapper,wrapper.entry,target,340);ret(wrapper,normal,{...normal.parameters[0]});target=wrapper.owner.id;}
  const chooser=plan('allocationChooser',[{id:'allocationChooser/condition',type:boolTypeId}]),
    first=invoke(chooser,chooser.entry,target,310),second=invoke(chooser,first,target,330),
    yes=chooser.graph.newBlock(),no=chooser.graph.newBlock(),join=chooser.graph.newBlock([callable]);
  chooser.graph.conditional(second,{...chooser.entry.parameters[0]},yes,no,range);
  chooser.graph.branch(yes,join,[{...first.parameters[0]}],range);
  if(mode==='loop')chooser.graph.branch(no,chooser.entry,[{...chooser.entry.parameters[0]}],range);
  else chooser.graph.branch(no,join,[{...second.parameters[0]}],range);ret(chooser,join,{...join.parameters[0]});
  if(mode==='unknown-host')value.records.get(target).upper.facets.unknownHost=true;
  model.hir.closure.roots=[{kind:'application',target:chooser.owner.id}];model.hir.functions=[...model.functions.values()];
  return {...value,chooser:chooser.owner.id,ownerSlot:'unit:owner-slot'};
}
export function allocationUncertainModel(top=false){
  const value=ownedClosureChoiceModel('indirect'),chooser=value.program.plans.find(p=>p.owner.id==='chooser'),
    branch=chooser.entry.instructions.find(op=>op.name==='cf.cond_br'),
    temporary={...chooser.entry,instructions:[],terminated:false},range={start:300,end:309},
    condition=chooser.graph.emit(temporary,'boolean',[],boolTypeId,{value:true},range);
  chooser.entry.instructions.splice(chooser.entry.instructions.indexOf(branch),0,...temporary.instructions);branch.operands=[condition.name];
  const call=chooser.graph.blocks.flatMap(b=>b.instructions).find(op=>op.name==='tsfg_program.invoke_indirect');
  if(top)call.properties.targets.top=true;else value.records.get('rightFactory').upper.facets.unknownHost=true;
  return value;
}
export function allocationArgumentContextsModel(){
  const value=allocationActivationModel(),{model,plans}=value.program,chooser=plans.find(p=>p.owner.id===value.chooser),
    reader=plans.find(p=>p.owner.lexicalParent==='entry'),range={start:380,end:389},
    body=reader.entry,temporary={...body,instructions:[],terminated:false},
    one=reader.graph.emit(temporary,'constant',[],i32TypeId,{decimal:'1',token:'1'},range),
    allocated=reader.graph.emit(temporary,'array_create',[one],'unit:Array',{allocation:'argument-context'},range);
  body.instructions.splice(body.instructions.length-1,0,...temporary.instructions);
  const join=chooser.graph.blocks.find(b=>b.instructions.some(op=>op.name==='func.return'));
  join.instructions.pop();join.terminated=false;chooser.returnType=i32TypeId;chooser.owner.returnType=i32TypeId;
  const normal=chooser.graph.newBlock([i32TypeId]),language=chooser.graph.newBlock([model.payload]);
  chooser.graph.terminal(join,'invoke_indirect',[{...join.parameters[0]}],[normal,language],
    {signature_hash:reader.owner.signatureHash,targets:{top:false,functions:[{function_id:reader.owner.id,signature_hash:reader.owner.signatureHash}]}},range);
  chooser.graph.terminal(normal,'func.return',[{...normal.parameters[0]}],[],{},range);
  chooser.graph.terminal(language,'return_throw',[{...language.parameters[0]}],[],{},range);
  return {...value,reader:reader.owner.id,allocationRegister:allocated.name,allocationSuffix:'/'+reader.owner.id+'/object/'+allocated.name};
}
export function allocationRepeatedHolderModel(){
  const value=commonBorrowModel('return-holder'),{model,plans}=value.program,p=plans.find(p=>p.owner.id==='entry'),
    body=p.entry,returned=body.instructions.pop(),range={start:400,end:409},parameter={id:'entry/loop',type:boolTypeId};
  model.types.set(boolTypeId,{id:boolTypeId,kind:'scalar',name:'bool'});model.hir.types.push(model.types.get(boolTypeId));
  model.bindings.set(parameter.id,{...parameter,role:'parameter'});p.owner.parameters=[parameter];p.parameters=[parameter];
  value.records.get('entry').upper.parameters=[{index:0,read:true,write:false,structural:false}];
  const entry=p.graph.newBlock([boolTypeId]),done=p.graph.newBlock();p.entry=entry;body.terminated=false;
  p.graph.branch(entry,body,[],range);p.graph.conditional(body,{...entry.parameters[0]},body,done,range);
  p.graph.terminal(done,'func.return',[{name:returned.operands[0],type:p.returnType}],[],{},range);return value;
}
