// SPDX-License-Identifier: MIT
import {createCoreSsaGraph} from './core-ssa-graph.mjs';
import {formalExceptionValues} from './formal-exception-values.mjs';
import {exceptionCoreFailure} from './formal-exception-model.mjs';
// A completion is control, never a scalar sentinel. A finally clone receives
// the already-evaluated pending value as a typed block argument. Its own abrupt
// completion is routed to the outer handlers, replacing that pending completion.
export function formalExceptionFunction(model,owner){
  const {coreType,quote,payload,publication}=model;
  const signature=owner.type?model.signature(owner):{parameters:[],returnType:'void'};
  const captures=owner.captures??[];
  if(signature.parameters.length>model.limits.sourceParameters||captures.length>model.limits.captureCells)
    exceptionCoreFailure('Source parameter or logical capture-cell budget exceeded');
  const argumentBindings=new Set(owner.parameters??[]);
  if(argumentBindings.size!==signature.parameters.length)exceptionCoreFailure('duplicate Source parameter binding');
  for(const capture of captures){if(argumentBindings.has(capture.binding))exceptionCoreFailure('overlapping logical argument binding');
    argumentBindings.add(capture.binding);}
  if(argumentBindings.size>model.bindings.size||[...argumentBindings].some(id=>!model.bindings.has(id)))
    exceptionCoreFailure('logical arguments are not distinct owned program bindings');
  publication.budget.parameters(signature.parameters.length+captures.length);
  const parameterTypes=[...signature.parameters,...captures.map(c=>model.cell(c.binding))];
  const graph=createCoreSsaGraph(coreType,publication.budget),entry=graph.newBlock(parameterTypes);
  const state={current:entry,cells:new Map()},tasks=[];let clones=0;
  const properties=record=>Object.entries(record).map(([k,v])=>k+' = '+(typeof v==='boolean'?String(v):quote(v))).join(', ');
  const terminator=(name,values,successors,record,range)=>{
    publication.step();graph.successors(successors.length);for(const successor of successors)successor.incoming++;graph.line(state.current,'    "'+name+'"('+values.map(v=>v.name).join(', ')+')'
      +(successors.length?' ['+successors.map(b=>'^'+b.name).join(', ')+']':'')+' {'+(properties(record)?properties(record)+', ':'')+graph.attrsFor(range)
      +'} : ('+values.map(v=>coreType(v.type)).join(', ')+') -> ()');state.current.terminated=true;
  };
  const route=(target,values,record,range)=>terminator('tsfg_eh.route',values,[target],record,range);
  const rootRange=owner.range??owner.initialization.range;
  const outer={
    returned:(value,range)=>{graph.line(state.current,'    "func.return"('+value.name+') {'+graph.attrsFor(range)
      +'} : ('+coreType(value.type)+') -> ()');state.current.terminated=true;},
    thrown:(value,range)=>terminator('tsfg_eh.raise',[value],[],{},range),
  };
  let handlers=outer;
  const invoke=(expression,args)=>{
    const indirect=expression.kind==='indirectCall',callee=indirect?null:model.functions.get(expression.target);
    if(!indirect&&!callee)exceptionCoreFailure('unknown actual callee');
    for(const capture of callee?.captures??[]){const value=state.cells.get(capture.binding);
      if(!value)exceptionCoreFailure('callee capture has no actual cell');args.push(value);}
    const normal=graph.newBlock([expression.type]),exceptional=graph.newBlock([payload]);
    const cells=new Map(state.cells),currentHandlers=handlers;
    terminator(indirect?'tsfg_eh.invoke_indirect':'tsfg_eh.invoke',args,[normal,exceptional],indirect
      ?{callable_type:expression.callee.type}:{callee:model.symbol(callee.id),function_id:callee.id},expression.range);
    tasks.push(()=>{state.current=exceptional;state.cells=new Map(cells);handlers=currentHandlers;
      currentHandlers.thrown({...exceptional.parameters[0]},expression.range);});
    state.current=normal;return {...normal.parameters[0]};
  };
  const values=formalExceptionValues(model,graph,state,invoke);
  function enter(region,initial=new Map()){
    values.op('tsfg_eh.enter',[],null,{scope:region.scope},region.range);
    for(const binding of region.bindings){
      const cell=values.op('tsfg_eh.cell',[],model.cell(binding.id),{binding:binding.id},binding.range);
      state.cells.set(binding.id,cell);
      if(initial.has(binding.id))values.store({binding:binding.id},initial.get(binding.id),binding.range,true);
    }
  }
  function region(node,active,onNormal,initial=new Map()){
    publication.step();const inherited=new Map(state.cells),previous=handlers;handlers=active;enter(node,initial);
    for(let index=0;index<node.body.length&&!state.current.terminated;index++){
      const statement=node.body[index];publication.step();
      if(statement.kind==='local')values.store({binding:statement.binding},values.expression(statement.initializer),statement.range,true);
      else if(statement.kind==='assign')values.store(statement.target,values.expression(statement.value),statement.range);
      else if(statement.kind==='functionDeclaration'){
        const declared=model.functions.get(statement.target);if(!declared)exceptionCoreFailure('unknown lexical declaration');
        const captured=(declared.captures??[]).map(c=>{const value=state.cells.get(c.binding);
          if(!value)exceptionCoreFailure('unreached declaration capture');return value;});
        const fn=values.op('tsfg_eh.function',captured,declared.type,{function_id:declared.id},statement.range);
        values.store({binding:statement.binding},fn,statement.range,true);
      }else if(statement.kind==='return')active.returned(values.expression(statement.value),statement.range);
      else if(statement.kind==='throw')active.thrown(values.pack(values.expression(statement.value),statement.range),statement.range);
      else if(statement.kind==='block')region(statement.region,active,()=>{});
      else if(statement.kind==='if')conditional(statement,active);
      else if(statement.kind==='while')loop(statement,active);
      else if(statement.kind==='try')attempt(statement,active);
      else exceptionCoreFailure('unsupported region statement '+statement.kind);
    }
    if(!state.current.terminated)onNormal();state.cells=inherited;handlers=previous;
  }
  function conditional(statement,active){
    const condition=values.expression(statement.condition),left=graph.newBlock(),right=graph.newBlock(),joined=graph.newBlock();
    const cells=new Map(state.cells);graph.conditional(state.current,condition.name,left,right,statement.range);
    const finish=()=>graph.branch(state.current,joined,[],statement.range);
    state.current=left;state.cells=new Map(cells);region(statement.thenRegion,active,finish);
    state.current=right;state.cells=new Map(cells);
    if(statement.elseRegion)region(statement.elseRegion,active,finish);else finish();
    state.cells=cells;
    if(joined.incoming)state.current=joined;
    else graph.blocks.splice(graph.blocks.indexOf(joined),1);
  }
  function attempt(statement,active){
    const after=graph.newBlock(),caught=statement.catchClause?graph.newBlock([payload]):null,cells=new Map(state.cells);
    const finish=(kind,value,range)=>{
      const resume=pending=>kind==='normal'?graph.branch(state.current,after,[],statement.range)
        :kind==='return'?active.returned(pending,range):active.thrown(pending,range);
      if(!statement.finallyRegion){resume(value);return;}
      if(++clones>model.limits.finallyClones)exceptionCoreFailure('finally clone budget exceeded');
      const final=graph.newBlock(value?[value.type]:[]);
      route(final,value?[value]:[],{completion:kind,finally_scope:statement.finallyRegion.scope},range);
      const pending=value?{...final.parameters[0]}:null;
      state.current=final;state.cells=new Map(cells);
      region(statement.finallyRegion,active,()=>resume(pending));
    };
    const attempted={returned:(v,r)=>finish('return',v,r),
      thrown:(v,r)=>caught?route(caught,[v],{completion:'throw',catch_scope:statement.catchClause.region.scope},r):finish('throw',v,r)};
    region(statement.tryRegion,attempted,()=>finish('normal',null,statement.range));
    if(caught){state.current=caught;state.cells=new Map(cells);const initial=new Map();
      if(statement.catchClause.binding)initial.set(statement.catchClause.binding,{...caught.parameters[0]});
      region(statement.catchClause.region,{returned:(v,r)=>finish('return',v,r),thrown:(v,r)=>finish('throw',v,r)},
        ()=>finish('normal',null,statement.range),initial);}
    state.cells=cells;
    if(after.incoming)state.current=after;
    else graph.blocks.splice(graph.blocks.indexOf(after),1);
  }
  function loop(statement,active){
    const header=graph.newBlock(),body=graph.newBlock(),after=graph.newBlock(),cells=new Map(state.cells);
    graph.branch(state.current,header,[],statement.range);state.current=header;
    graph.fuel(header,2,statement.condition.range);
    const condition=values.expression(statement.condition);
    graph.conditional(state.current,condition.name,body,after,statement.condition.range);
    state.current=body;state.cells=new Map(cells);
    region(statement.bodyRegion,active,()=>graph.branch(state.current,header,[],statement.range));
    state.current=after;state.cells=cells;
    if(statement.condition.kind==='boolean'&&statement.condition.value===true)
      terminator('tsfg_eh.unreachable',[],[],{},statement.range);
  }
  for(const [index,capture] of captures.entries())state.cells.set(capture.binding,{...entry.parameters[signature.parameters.length+index]});
  if(owner.type)graph.fuel(entry,1,rootRange);
  const initial=new Map((owner.parameters??[]).map((id,index)=>[id,{...entry.parameters[index]}]));
  region(owner.body??owner.initialization,outer,()=>{
    if(signature.returnType!=='void')exceptionCoreFailure('unproved implicit successful function exit');
    else{values.op('tsfg_eh.publish',[],null,{module:owner.id},rootRange);graph.line(state.current,'    func.return');state.current.terminated=true;}
  },initial);
  while(tasks.length)tasks.shift()();
  const body=graph.blocks.map((block,index)=>{
    const label=index===0?'':publication.combine(['  ^',block.name,block.parameters.length?'(':'',
      ...block.parameters.flatMap((p,i)=>[i?', ':'',p.name,': ',coreType(p.type)]),block.parameters.length?')':'',':\n']);
    return label+block.lines.join('\n');
  }).join('\n');
  const attrs={function_id:owner.id,source_path:owner.sourcePath,role:owner.type?'source':'module-initializer'};
  const attributeText=Object.entries(attrs).map(([k,v])=>'tsfg_eh.'+k+' = '+quote(v)).join(', ');
  const parameters=entry.parameters.map(p=>p.name+': '+coreType(p.type));
  const pieces=['  func.func @',quote(model.symbol(owner.id)),'('];
  for(const [index,parameter] of parameters.entries()){if(index)pieces.push(', ');pieces.push(parameter);}
  pieces.push(')',signature.returnType==='void'?'':' -> '+coreType(signature.returnType),' attributes {',attributeText,'} {\n');
  const header=publication.combine(pieces),footer=publication.append('\n  }');
  return header+body+footer;
}
