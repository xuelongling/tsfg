// SPDX-License-Identifier: MIT
// Actual-flow component controls; complete original Source is verified apart.
import {ownedClosureChoiceModel} from './common-program-owned-environment-models.mjs';
export function selectedCaptureModel(mode='other') {
  const result=ownedClosureChoiceModel(),{model,plans}=result.program,
    chooser=plans.find(p=>p.owner.id==='chooser'),reader=plans.find(p=>p.owner.id==='leftFactory/reader'),
    layout=model.environments.get('unit:leftFactory'),array='unit:Array',span='unit:Span',scalar=model.types.get(array).elementType,range={start:270,end:279};
  const emit=(p,b,name,args,type,properties={})=>p.graph.emit(b,name,args,type,properties,range),
    constant=(p,b,n)=>emit(p,b,'constant',[],scalar,{decimal:String(n),token:String(n)}),
    ret=(p,b,value,thrown=false)=>p.graph.terminal(b,thrown?'return_throw':'func.return',[value],[],{},range);
  // Both calls use the same original code and slot key, with two activations.
  for(const block of chooser.graph.blocks)for(const op of block.instructions)if(op.name==='tsfg_program.invoke'&&op.properties.function_id==='rightFactory')op.properties.function_id='leftFactory';
  for(let i=plans.length-1;i>=0;i--)if(plans[i].owner.id.startsWith('rightFactory')){
    const id=plans[i].owner.id;plans.splice(i,1);model.functions.delete(id);result.records.delete(id);model.callables.summaries.delete(id);
  }
  model.environments.delete('unit:rightFactory');model.hir.environments=model.hir.environments.filter(r=>r.id!=='unit:rightFactory');
  const terminal=reader.entry.instructions.pop();reader.entry.terminated=false;
  const owner=emit(reader,reader.entry,'env_load',[{...reader.entry.parameters[0]}],array,{layout:layout.id,binding:layout.slots[0].binding,key:layout.slots[0].key});
  emit(reader,reader.entry,'array_resize',[owner,constant(reader,reader.entry,0)],null);
  ret(reader,reader.entry,{name:terminal.operands[0],type:scalar});
  result.records.get(reader.owner.id).upper.captures=[{slot:layout.slots[0].key,read:true,write:true,structural:true},{slot:layout.slots[1].key,read:true,write:false,structural:false}];
  let from,callee;
  if(mode==='may'){
    from=chooser.graph.blocks.find(b=>b.instructions.some(op=>op.name==='func.return'));from.instructions.pop();from.terminated=false;callee={...from.parameters[0]};
  }else{
    from=chooser.graph.blocks.find(b=>b.instructions.some(op=>op.name==='cf.cond_br'));const branch=from.instructions.pop();from.terminated=false;callee={...from.parameters[0]};
    const remove=new Set(branch.successors);for(const name of branch.successors){const block=chooser.graph.blocks.find(b=>b.name===name);for(const op of block.instructions)for(const target of op.successors)remove.add(target);}
    for(let i=chooser.graph.blocks.length-1;i>=0;i--)if(remove.has(chooser.graph.blocks[i].name))chooser.graph.blocks.splice(i,1);
  }
  chooser.owner.returnType=scalar;chooser.returnType=scalar;
  const normal=chooser.graph.newBlock([scalar]),language=chooser.graph.newBlock([model.payload]);
  chooser.graph.terminal(from,'invoke_indirect',[callee],[normal,language],{signature_hash:'unit:signature',targets:{top:false,functions:[{function_id:reader.owner.id,signature_hash:'unit:signature'}]}},range);
  ret(chooser,language,{...language.parameters[0]},true);
  const definitions=chooser.entry.instructions.filter(op=>op.name==='tsfg_program.readspan'),borrow=definitions[mode==='selected'?1:0],
    value=emit(chooser,normal,'array_read',[{name:borrow.result,type:span},constant(chooser,normal,0)],scalar,{element:scalar});ret(chooser,normal,value);
  model.hir.functions=[...model.functions.values()];return result;
}
