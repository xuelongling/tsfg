// SPDX-License-Identifier: MIT
// Project an owning normalized CFG. Receiver and initialization ordering is
// already lowered here; Source syntax/ranges do not authorize an operation.
import {commonCheck as check} from './common-program-common.mjs';

const represented=new Set(['cell','catch_bind','store','load','value_copy','view','assert','pack','unpack','undefined',
  'constant','floating','boolean','null','string','strict_equal','binary','unary','compare','global_load',
  'receiver_create','receiver_child','receiver_allocate','receiver_get','receiver_bind','receiver_result',
  'initialize_begin','initialize_end','initialize_field','field_load','field_store','env_alloc','env_parent','env_load','env_init','env_store','make_closure',
  'invoke','cf.br','route','cf.cond_br','func.return','return_throw','fuel','enter_handler','finally_enter','unreachable']);

// A valid owned CFG can still use a transfer this private projector does not
// represent. Local availability owns that distinction; malformed CFGs and
// exhausted work are not converted into capability absence.
export function unavailableConstructorReturnOriginOperation(plan,spend) {
  for(const block of plan.graph.blocks){spend();for(const op of block.instructions){spend(Math.ceil(op.name.length/8)+2);
    if(!represented.has(op.name.replace('tsfg_program.','')))return op.name;
  }}return null;
}

export function projectConstructorReturnOrigins({plan,model},catalogue,graph,spend) {
  const fn=plan.owner,registers=new Map(),cells=new Map(),blocks=new Map(),cellTypes=new Map(),parameters=new Set(),normal=new Set(),language=new Set(),normalExits=[],languageExits=[],calls=[];
  for(const block of plan.graph.blocks)if(block!==plan.entry){spend(block.parameters.length);for(const parameter of block.parameters)parameters.add(parameter.name);}
  const graphType=id=>catalogue.types.has(id)?id:null;
  const symbolic=name=>{spend();const value=registers.get(name);check(value,'return-origin-cfg','missing normalized register');return value;};
  const put=(name,values)=>{if(name===null)return;const row=plan.graph.registers.get(name);graph.phi(graphType(row.view),values,'register:'+name);if(!parameters.has(name))registers.set(name,values);};
  const join=(into,from)=>{spend(from.size);for(const value of from)into.add(value);};
  spend(plan.graph.registers.size+plan.graph.blocks.length);
  for(const [name,row]of plan.graph.registers){spend();if(row.view.startsWith('cell:')){cells.set(name,name);cellTypes.set(name,row.view.slice(5));}
    else if(!row.view.startsWith('initialization:'))registers.set(name,graph.phi(graphType(row.view),new Set(),'register:'+name));}
  for(const block of plan.graph.blocks){spend();const state=graph.mergeStates(block===plan.entry?[graph.checkpoint()]:[],'block:'+block.name),locals=new Map();
    for(const [id,type]of cellTypes){spend();locals.set(id,graph.phi(graphType(type),new Set(),'cell:'+id+':'+block.name));}blocks.set(block.name,{block,state,locals});}
  for(const [index,parameter]of plan.parameters.entries()){spend();const target=plan.entry.parameters[index];
    if(parameter.frame)put(target.name,graph.receiverInput());
    else if(parameter.hidden)put(target.name,graph.environmentInput(fn.lexicalEnvironment));
    else {const offset=fn.kind==='construction-body'||fn.kind==='method'?1:0,at=fn.parameters.findIndex(row=>{spend();return row.id===parameter.id;});put(target.name,graph.root('parameter',at<0?parameter.type:fn.parameters[at].type,at<0?0:at+offset));}}
  const edge=(target,state,values,locals)=>{const next=blocks.get(target);check(next,'return-origin-cfg','missing normalized successor');graph.mergeStates([state],'block:'+target);
    spend(values.length);for(const [index,value]of values.entries())put(next.block.parameters[index].name,value);
    for(const [id,type]of cellTypes){spend();graph.phi(graphType(type),locals.get(id)??new Set(),'cell:'+id+':'+target);}};
  const role=owner=>{for(const row of catalogue.constructions.values()){spend();if(row.owner===owner)return row;}check(false,'return-origin-cfg','missing owned construction');};
  const slotFor=binding=>{spend();const slot=catalogue.slots.get(binding);check(slot,'return-origin-cfg','missing owned capture slot');return slot;};
  for(const {block,state,locals:incoming}of blocks.values()){
    spend(incoming.size);const locals=new Map(incoming);graph.restore(state);
    for(const op of block.instructions){spend();const name=op.name.replace('tsfg_program.',''),args=op.operands.map(value=>{spend();return cells.has(value)||plan.graph.registers.get(value).view.startsWith('initialization:')?null:symbolic(value);});
      let value=null;
      if(name==='cell')continue;
      if(name==='catch_bind'){locals.set(cells.get(op.result),args[0]);continue;}
      if(name==='store'){locals.set(cells.get(op.operands[0]),args[1]);continue;}
      if(name==='load'){value=locals.get(cells.get(op.operands[0]))??new Set();}
      else if(name==='value_copy')value=graph.copy(args[0],op.view,fn.id+'/'+op.result);
      else if(name==='view'||name==='assert'||name==='pack'||name==='unpack')value=args[0];
      else if(name==='undefined')value=graph.literal('undefined',graphType(op.view));
      else if(['constant','floating','boolean','null','string','strict_equal','binary','unary','compare'].includes(name))value=graph.literal('other',graphType(op.view));
      else if(name==='global_load'){value=graph.root('global',op.view,op.properties.global);graph.access(value,'read');}
      else if(name==='global_store')check(false,'return-origin-construction-open','global payload transfer is not represented by the normalized graph');
      else if(name==='receiver_create')value=graph.receiverFrame(op.properties.construction,op.properties.new_target,null,fn.id+'/'+op.result);
      else if(name==='receiver_child')value=graph.receiverFrame(role(op.properties.owner).id,null,args[0],fn.id+'/'+op.result);
      else if(name==='receiver_allocate')value=graph.receiverAction('allocate',args[0],new Set(),op.view).normal;
      else if(['receiver_get','receiver_bind','receiver_result'].includes(name)){
        const result=graph.receiverAction(name.slice(9),args[0],args[1]??new Set(),op.properties.owner),saved=graph.checkpoint();
        edge(op.successors[0],result.normalState,[result.normal],locals);edge(op.successors[1],result.languageState,[result.language],locals);graph.restore(saved);continue;
      }else if(name==='initialize_begin'||name==='initialize_end')continue;
      else if(name==='initialize_field'){const field=model.fields.get(op.properties.field);check(field,'return-origin-cfg','missing initialized field');graph.write(args[1],'field:'+field.id,args[2],{view:field.owner,initialize:true});continue;}
      else if(name==='field_load'){const field=model.fields.get(op.properties.field);check(field,'return-origin-cfg','missing field');graph.access(args[0],'read');value=graph.select(args[0],'field:'+field.id,op.view,op.properties.owner??field.owner);}
      else if(name==='field_store'){const field=model.fields.get(op.properties.field);check(field,'return-origin-cfg','missing field');graph.write(args[0],'field:'+field.id,args[1],{view:op.properties.owner??field.owner});continue;}
      else if(name==='env_alloc'){const layout=catalogue.environments.get(op.properties.layout);value=graph.environmentCreate(layout.id,args[0]??null,fn.id+'/'+op.result);}
      else if(name==='env_parent')value=graph.environmentParent(args[0],op.properties.layout);
      else if(name==='env_load'){const slot=slotFor(op.properties.binding);value=graph.capture(args[0],slot.layout,slot.key,slot.type);}
      else if(name==='env_init'||name==='env_store'){const slot=slotFor(op.properties.binding);graph.write(args[0],'capture:'+slot.key,args[1],{view:'env:'+slot.layout,initialize:name==='env_init'});continue;}
      else if(name==='make_closure'){const target=catalogue.functions.get(op.properties.function_id);value=graph.code(op.properties.function_id,target.lexicalEnvironment?args[0]:null,op.view);}
      else if(name==='invoke'){
        const target=catalogue.functions.get(op.properties.function_id);check(target,'return-origin-cfg','private recursive constructor remains outside the fixed public graph');
        let offset=0;const environment=target.lexicalEnvironment?args[offset++]:null,receiver=target.construction?args[offset++]:null,arguments_=args.slice(offset),type=target.construction?.owner??target.returnType,
          result=graph.call(op.properties.function_id,arguments_,type,fn.id+'/'+block.name+'/'+calls.length,{environment,receiver});
        calls.push({functionId:fn.id,target:op.properties.function_id,range:op.range,kind:'call',sourcePath:fn.sourcePath});
        edge(op.successors[0],result.normalState,blocks.get(op.successors[0]).block.parameters.length?[result.normal]:[],locals);
        edge(op.successors[1],result.languageState,[result.language],locals);continue;
      }else if(name==='cf.br'||name==='route'){edge(op.successors[0],graph.checkpoint(),args,locals);continue;}
      else if(name==='cf.cond_br'){const saved=graph.checkpoint();for(const successor of op.successors){spend();edge(successor,saved,[],locals);}continue;}
      else if(name==='func.return'){if(args[0])join(normal,args[0]);normalExits.push(graph.checkpoint());continue;}
      else if(name==='return_throw'){if(args[0])join(language,args[0]);languageExits.push(graph.checkpoint());continue;}
      else if(['fuel','enter_handler','finally_enter','unreachable'].includes(name))continue;
      else check(false,'return-origin-construction-open','normalized constructor graph operation is not represented: '+name);
      if(value!==null)put(op.result,value);
    }
  }
  const result=graph.snapshot(normal,language,{normal:normalExits,language:languageExits}),effects=graph.effects();
  return {graph:result,effects,calls,normal:normalExits.length>0,language:languageExits.length>0};
}
