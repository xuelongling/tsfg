// SPDX-License-Identifier: MIT
import {canonical} from './identity.mjs';
import {exceptionCoreFailure} from './formal-exception-model.mjs';
// Expressions return typed SSA values. Only the control planner may create
// exceptional successors; no leaf treats a trap as a language exception.
export function formalExceptionValues(model,graph,state,invoke){
  const {coreType,quote,bindings,types,payload}=model;
  const attrs=record=>Object.entries(record).map(([k,v])=>k+' = '+(typeof v==='boolean'?String(v):quote(v))).join(', ');
  const op=(name,operands,type,properties,range)=>{
    model.publication.step();const nameValue=type===null?null:graph.variable();
    graph.operationLine(state.current,nameValue,name,operands.map(v=>v.name),operands.map(v=>v.type),type,attrs(properties),range);
    return type===null?null:{name:nameValue,type};
  };
  const pack=(value,range)=>types.get(value.type)?.kind==='unknown'||value.type===payload?{...value,type:payload}
    :op('tsfg_eh.pack',[value],payload,{payload_type:value.type},range);
  const location=target=>{
    if(target.kind==='targetGroup')return location(target.operand);
    const cell=state.cells.get(target.binding);if(!cell)exceptionCoreFailure('binding has no current reached cell');return cell;
  };
  const store=(target,value,range,initialize=false)=>{
    while(target.kind==='targetGroup')target=target.operand;
    const b=bindings.get(target.binding),cell=location(target);if(!b)exceptionCoreFailure('unknown binding target');
    const stored=types.get(b.type)?.kind==='unknown'?pack(value,range):value;
    if(coreType(stored.type)!==coreType(b.type))exceptionCoreFailure('binding store changes declared payload type');
    op('tsfg_eh.store',[cell,stored],null,{binding:b.id,initialize},range);return value;
  };
  function expression(e){
    model.publication.step();if(!e||!types.has(e.type))exceptionCoreFailure('expression has no owned type');
    if(e.kind==='group')return expression(e.operand);
    if(e.kind==='bindingRead'){
      const b=bindings.get(e.binding),cell=state.cells.get(e.binding);if(!b||!cell)exceptionCoreFailure('unreached binding read');
      const value=op('tsfg_eh.load',[cell],b.type,{binding:b.id},e.range);
      return e.type===b.type?value:op('tsfg_eh.project',[value],e.type,{binding:b.id,target_type:e.type},e.range);
    }
    if(e.kind==='bindingWrite')return store(e.target,expression(e.value),e.range);
    if(e.kind==='boolean')return op('tsfg_core.constant',[],e.type,{value:e.value},e.range);
    if(e.kind==='typeTest')return op('tsfg_eh.type_test',[expression(e.operand)],e.type,
      {tag:e.tag,operator:e.operator,order:e.order},e.range);
    if(e.kind==='binary'){
      const left=expression(e.left),right=expression(e.right);
      return op(e.operator==='==='?'tsfg_core.eq':'tsfg_core.ne',[left,right],e.type,{},e.range);
    }
    if(e.kind==='presenceWiden')return op('tsfg_eh.presence_widen',[expression(e.operand)],e.type,{},e.range);
    if(e.kind==='functionReference')return op('tsfg_eh.function',[],e.type,{function_id:e.target},e.range);
    if(e.kind==='indirectCall'){
      const callee=expression(e.callee),argumentsList=e.arguments.map(expression);
      return invoke(e,[callee,...argumentsList]);
    }
    if(e.kind==='directCall')return invoke(e,e.arguments.map(expression));
    if(e.kind==='construct'){
      const value=op('tsfg_eh.construct',[],e.type,{constructor:e.constructorId},e.range);
      for(const field of types.get(e.type).fields){
        if(!field.initializer)exceptionCoreFailure('field has no owned initializer');
        op('tsfg_eh.field_initialize',[value,expression(field.initializer)],null,{field:field.id},field.range);
      }return value;
    }
    if(e.kind==='fieldRead')return op('tsfg_eh.field_read',[expression(e.receiver)],e.type,
      {field_path:canonical(e.fieldPath)},e.range);
    exceptionCoreFailure('unsupported owned expression '+e.kind);
  }
  return {expression,op,pack,store,location};
}
