// SPDX-License-Identifier: MIT
// Normalized actual-flow controls; official Source fixtures are checked apart.
import {boolTypeId} from '../../compiler/identity.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {readspanClosureModel} from './common-program-readspan-closure-models.mjs';
export function ownedEnvironmentModel(mode='held') {
  const result=readspanClosureModel('escape-return'),{model,plans}=result.program,
    root=plans.find(p=>p.owner.id==='entry'),layout=model.environments.get('unit:Environment'),
    slot={binding:'entry/owner',key:'unit:owner-slot',type:'unit:Array',writable:true,kind:'local'},
    range={start:210,end:220},body=root.entry,instructions=body.instructions,
    env=instructions.find(op=>op.name==='tsfg_program.env_alloc'),
    arrays=instructions.filter(op=>op.name==='tsfg_program.array_create'),
    value=op=>({name:op.result,type:op.view}),properties={layout:layout.id,binding:slot.binding,key:slot.key};
  if(mode==='descriptor-only')return result;
  layout.slots.push(slot);model.slots.set(slot.binding,{...slot,layout:layout.id});
  model.bindings.set(slot.binding,{id:slot.binding,type:slot.type,role:'local'});
  const temporary={...body,instructions:[],terminated:false};
  root.graph.emit(temporary,'env_init',[value(env),value(arrays[0])],null,properties,range);
  const closure=instructions.find(op=>op.name==='tsfg_program.make_closure');
  instructions.splice(instructions.indexOf(closure),0,...temporary.instructions);
  const terminal=instructions.pop();body.terminated=false;
  const store=(block,array)=>root.graph.emit(block,'env_store',[value(env),value(array)],null,properties,range),
    finish=(block,thrown=false)=>root.graph.terminal(block,thrown?'return_throw':'func.return',[{name:terminal.operands[0],type:root.returnType}],[],{},range);
  if(mode==='maybe-owner'){
    model.types.set(boolTypeId,{id:boolTypeId,kind:'scalar',name:'bool'});model.hir.types.push(model.types.get(boolTypeId));
    const parameter={id:'entry/condition',type:boolTypeId},entry=root.graph.newBlock([boolTypeId]),yes=root.graph.newBlock(),no=root.graph.newBlock(),join=root.graph.newBlock();
    root.owner.parameters=[parameter];root.parameters=[parameter];root.entry=entry;
    model.bindings.set(parameter.id,{...parameter,role:'parameter'});
    result.records.get('entry').upper.parameters=[{index:0,read:true,write:false,structural:false}];
    root.graph.branch(entry,body,[],range);root.graph.conditional(body,{...entry.parameters[0]},yes,no,range);
    store(yes,arrays[0]);store(no,arrays[1]);root.graph.branch(yes,join,[],range);root.graph.branch(no,join,[],range);finish(join);
  }else{
    if(['replaced','restored','throw-replaced'].includes(mode))store(body,arrays[1]);
    if(mode==='restored')store(body,arrays[0]);
    if(mode==='resized'){
      // Reuse the already typed zero of the original readspan operation.
      const borrow=instructions.find(op=>op.name==='tsfg_program.readspan');
      root.graph.emit(body,'array_resize',[value(arrays[0]),{name:borrow.operands[1],type:root.graph.registers.get(borrow.operands[1]).view}],null,{},range);
    }
    finish(body,mode.startsWith('throw-'));
  }
  return result;
}
export function ownedClosureChoiceModel(mode='held') {
  const result=ownedEnvironmentModel(),{model,plans}=result.program,array='unit:Array',span='unit:Span',callable='unit:Callable',range={start:230,end:240};
  model.functions.clear();plans.length=0;result.records.clear();model.environments.clear();model.slots.clear();model.hir.environments=[];
  model.types.set(boolTypeId,{id:boolTypeId,kind:'scalar',name:'bool'});model.hir.types.push(model.types.get(boolTypeId));
  function plan(id,parameters,returns,parent=null,environment=null){
    const owner={id,name:id,sourceBinding:id,kind:'source',sourcePath:'/unit-model.ts',range,signatureHash:'unit:signature',
      parameters:parameters.filter(p=>!p.hidden),returnType:returns,lexicalParent:parent,lexicalEnvironment:environment,activationEnvironment:null},graph=createCommonGraph(model,owner),entry=graph.newBlock(parameters.map(p=>p.type)),p={owner,parameters,graph,entry,returnType:returns};
    for(const parameter of parameters)model.bindings.set(parameter.id,{...parameter,role:'parameter'});
    model.functions.set(id,owner);plans.push(p);result.records.set(id,{upper:{globals:{reads:[],writes:[]},parameters:owner.parameters.map((_,index)=>({index,read:true,write:false,structural:false})),captures:[],facets:{unknownHost:false}}});
    model.callables.summaries.set(id,{parameters:new Map()});return p;
  }
  const scalar=model.types.get(array).elementType,
    emit=(p,b,name,args,type,properties={})=>p.graph.emit(b,name,args,type,properties,range),
    number=(p,b,n)=>emit(p,b,'constant',[],scalar,{decimal:String(n),token:String(n)}),
    ret=(p,b,value,thrown=false)=>p.graph.terminal(b,thrown?'return_throw':'func.return',[value],[],{},range);
  function factory(id,pure=false,descriptorOnly=false){
    const ps=[{id:id+'/a',type:array},{id:id+'/r',type:span}],f=plan(id,ps,callable),layout={id:'unit:'+id,owner:id,parent:null,slots:ps.filter((_,i)=>!descriptorOnly||i===1).map(p=>({binding:p.id,key:p.id,type:p.type,writable:true,kind:'parameter'}))};
    if(!pure){model.environments.set(layout.id,layout);model.hir.environments.push(layout);f.owner.activationEnvironment=layout.id;
      for(const slot of layout.slots)model.slots.set(slot.binding,{...slot,layout:layout.id});}
    const reader=plan(id+'/reader',pure?[]:[{id:id+'/lexical',type:'env:'+layout.id,hidden:true}],scalar,id,pure?null:layout.id);
    let value=number(reader,reader.entry,1);
    if(!pure){const loaded=emit(reader,reader.entry,'env_load',[{...reader.entry.parameters[0]}],span,{layout:layout.id,binding:ps[1].id,key:ps[1].id});
      value=emit(reader,reader.entry,'array_read',[loaded,number(reader,reader.entry,0)],scalar,{element:scalar});}
    ret(reader,reader.entry,value);
    let env=null;if(!pure){env=emit(f,f.entry,'env_alloc',[],'env:'+layout.id,{layout:layout.id});for(const [i,p]of ps.entries())if(!descriptorOnly||i===1)emit(f,f.entry,'env_init',[env,{...f.entry.parameters[i]}],null,{layout:layout.id,binding:p.id,key:p.id});}
    ret(f,f.entry,emit(f,f.entry,'make_closure',env?[env]:[],callable,{function_id:reader.owner.id,signature_hash:'unit:signature',environment_layout:pure?null:layout.id}));return f;
  }
  const left=factory('leftFactory'),right=factory('rightFactory',mode==='pure',mode.includes('bad')),
    chooser=plan('chooser',[{id:'chooser/condition',type:boolTypeId}],callable),entry=chooser.entry,
    a=emit(chooser,entry,'array_create',[number(chooser,entry,1)],array,{allocation:'a'}),
    b=emit(chooser,entry,'array_create',[number(chooser,entry,2)],array,{allocation:'b'}),
    borrow=owner=>emit(chooser,entry,'readspan',[owner,number(chooser,entry,0),number(chooser,entry,1)],span),ra=borrow(a),rb=borrow(b);
  if(mode.startsWith('indirect')){
    const selector='unit:FactoryCallable',row={id:selector,kind:'function',parameters:[array,span],returnType:callable};model.types.set(selector,row);model.hir.types.push(row);
    const aCode=emit(chooser,entry,'make_closure',[],selector,{function_id:left.owner.id,signature_hash:'unit:signature',environment_layout:null}),
      bCode=emit(chooser,entry,'make_closure',[],selector,{function_id:right.owner.id,signature_hash:'unit:signature',environment_layout:null}),
      yes=chooser.graph.newBlock(),no=chooser.graph.newBlock(),join=chooser.graph.newBlock([selector]),normal=chooser.graph.newBlock([callable]),language=chooser.graph.newBlock([model.payload]);
    chooser.graph.conditional(entry,{...entry.parameters[0]},yes,no,range);chooser.graph.branch(yes,join,[aCode],range);chooser.graph.branch(no,join,[bCode],range);
    chooser.graph.terminal(join,'invoke_indirect',[{...join.parameters[0]},a,ra],[normal,language],{signature_hash:'unit:signature',targets:{top:false,functions:[left,right].map(p=>({function_id:p.owner.id,signature_hash:'unit:signature'}))}},{start:210,end:219});
    ret(chooser,language,{...language.parameters[0]},true);ret(chooser,normal,{...normal.parameters[0]},mode==='indirect-throw');
    model.hir.closure.roots=[{kind:'application',target:'chooser'}];model.hir.functions=[...model.functions.values()];return result;
  }
  let callOrdinal=0;
  const invoke=(from,target,args)=>{const normal=chooser.graph.newBlock([callable]),language=chooser.graph.newBlock([model.payload]),start=210+10*callOrdinal++;
    chooser.graph.terminal(from,'invoke',args,[normal,language],{function_id:target.owner.id,signature_hash:'unit:signature'},{start,end:start+9});ret(chooser,language,{...language.parameters[0]},true);return normal;},
    first=invoke(entry,left,[a,ra]),second=invoke(first,right,mode.startsWith('bad')?[a,ra]:[b,rb]),yes=chooser.graph.newBlock(),no=chooser.graph.newBlock(),join=chooser.graph.newBlock([callable]);
  chooser.graph.conditional(second,{...entry.parameters[0]},yes,no,range);chooser.graph.branch(yes,join,[{...first.parameters[0]}],range);chooser.graph.branch(no,join,[{...second.parameters[0]}],range);
  ret(chooser,join,{...join.parameters[0]},mode==='throw'||mode==='bad-throw');
  model.hir.closure.roots=[{kind:'application',target:'chooser'}];model.hir.functions=[...model.functions.values()];return result;
}
