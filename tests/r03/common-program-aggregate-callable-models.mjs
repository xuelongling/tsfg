// SPDX-License-Identifier: MIT
// Normalized actual-flow controls; official whole Source is checked separately.
import {ownedClosureChoiceModel} from './common-program-owned-environment-models.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
export function aggregateCallableModel(mode='held'){
  const result=ownedClosureChoiceModel(mode==='coexisting'?'bad':mode==='same-code'||mode==='nested'||mode==='single'?'held':mode),
    {model,plans}=result.program,chooser=plans.find(p=>p.owner.id==='chooser'),
    type='unit:CallableHolder',field={id:type+'/reader',sourceBinding:type+'/reader',name:'reader',type:'unit:Callable'},
    range={start:270,end:280};
  const add=(id,slot)=>{const row={id,kind:'reference',fields:[slot],methods:[]};
    model.types.set(id,row);model.hir.types.push(row);model.fields.set(slot.id,slot);
    model.bindings.set(slot.sourceBinding,{id:slot.sourceBinding,type:slot.type,role:'field'});};
  add(type,field);
  const companion={id:type+'/independent',sourceBinding:type+'/independent',name:'independent',type:'unit:Callable'};
  if(mode==='coexisting'){
    model.types.get(type).fields.push(companion);model.fields.set(companion.id,companion);
    model.bindings.set(companion.sourceBinding,{id:companion.sourceBinding,type:companion.type,role:'field'});
  }
  if(mode==='same-code'){
    for(const block of chooser.graph.blocks)for(const op of block.instructions)
      if(op.name==='tsfg_program.invoke'&&op.properties.function_id==='rightFactory')op.properties.function_id='leftFactory';
    for(let i=plans.length-1;i>=0;i--)if(plans[i].owner.id.startsWith('rightFactory')){
      model.functions.delete(plans[i].owner.id);result.records.delete(plans[i].owner.id);plans.splice(i,1);}
    model.environments.delete('unit:rightFactory');model.hir.environments=model.hir.environments.filter(e=>e.id!=='unit:rightFactory');
  }
  let returned=type;
  const outer='unit:NestedCallableHolder',outerField={id:outer+'/inner',sourceBinding:outer+'/inner',name:'inner',type};
  if(mode==='nested'){add(outer,outerField);returned=outer;}
  chooser.returnType=returned;chooser.owner.returnType=returned;
  const firstCallResult=chooser.graph.blocks.find(b=>b.parameters[0]?.type==='unit:Callable').parameters[0];
  for(const block of chooser.graph.blocks){const terminal=block.instructions.at(-1);
    if(!['func.return','tsfg_program.return_throw'].includes(terminal?.name)
      ||chooser.graph.registers.get(terminal.operands[0])?.view!=='unit:Callable')continue;
    const selected=mode==='single'?firstCallResult:{name:terminal.operands[0],type:'unit:Callable'};
    block.instructions.pop();block.terminated=false;
    const box=chooser.graph.emit(block,'allocate_reference',[],type,{type,construction:'unit:holder'},range);
    chooser.graph.emit(block,'field_store',[box,selected],null,{field:field.id,initialize:true},range);
    if(mode==='coexisting')chooser.graph.emit(block,'field_store',[box,{...firstCallResult}],null,{field:companion.id,initialize:true},range);
    let value=box;if(mode==='nested'){
      value=chooser.graph.emit(block,'allocate_reference',[],outer,{type:outer,construction:'unit:outer'},range);
      chooser.graph.emit(block,'field_store',[value,box],null,{field:outerField.id,initialize:true},range);}
    chooser.graph.terminal(block,terminal.name.replace('tsfg_program.',''),[value],[],{},{start:290,end:299});
  }
  model.hir.functions=[...model.functions.values()];return result;
}
export function aggregatePureCompanionModel(){
  const result=aggregateCallableModel('coexisting'),{model,plans}=result.program,
    chooser=plans.find(p=>p.owner.id==='chooser'),reader=plans.find(p=>p.owner.id==='leftFactory/reader'),
    range={start:300,end:309},owner={...reader.owner,id:'pureCompanion',name:'pureCompanion',sourceBinding:'pureCompanion',
      parameters:[],lexicalParent:null,lexicalEnvironment:null,activationEnvironment:null,range},
    graph=createCommonGraph(model,owner),entry=graph.newBlock(),pure={owner,graph,entry,parameters:[],returnType:owner.returnType};
  const one=graph.emit(entry,'constant',[],owner.returnType,{decimal:'1',token:'1'},range);
  graph.terminal(entry,'func.return',[one],[],{},range);plans.push(pure);model.functions.set(owner.id,owner);
  result.records.set(owner.id,{upper:{parameters:[],captures:[],globals:{reads:[],writes:[]},facets:{unknownHost:false}}});
  model.callables.summaries.set(owner.id,{parameters:new Map()});
  const callableBlocks=chooser.graph.blocks.filter(b=>b.parameters[0]?.type==='unit:Callable'),second=callableBlocks[1],
    condition=second.instructions.pop();second.terminated=false;
  const pureValue=chooser.graph.emit(second,'make_closure',[],'unit:Callable',{
    function_id:owner.id,signature_hash:owner.signatureHash,environment_layout:null},range);
  second.instructions.push(condition);second.terminated=true;
  const no=chooser.graph.blocks.find(b=>b.name===condition.successors[1]),join=callableBlocks.at(-1);
  no.instructions.at(-1).operands=[pureValue.name];
  for(const op of join.instructions)if(op.name==='tsfg_program.field_store')
    op.operands[1]=op.properties.field.endsWith('/independent')?join.parameters[0].name:second.parameters[0].name;
  model.hir.functions=[...model.functions.values()];return result;
}
