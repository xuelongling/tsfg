// SPDX-License-Identifier: MIT
import { i32TypeId, boolTypeId, scalarName } from './identity.mjs';
import { floatBits, floatNames } from './float.mjs';
import { hasState } from './presence.mjs';
import { localReferenceTarget, expressionLeaf } from './scalar-source.mjs';
import { scalarOperations } from './scalar-operators.mjs';

// Presence tags participate in the ordinary SSA definition table, so the same
// branch, loop and expression joins carry payloads and finite absence states.
export const stateBinding = id => `$presence:${id}`;
export const scalarAbiTypes = parameters => parameters.flatMap(p => [p.type, ...(hasState(p.presence) ? [i32TypeId] : [])]);

export function createScalarStateEmitter(fn, api) {
  const stateful = new Set(fn.parameters.filter(p=>hasState(p.presence)).map(p=>p.id));
  const operation=(name,operands,types,result,range)=>api.operation(`tsfg_core.${name}`,operands,types,result,'',range);
  const constant=(type,token,range)=> {
    const name=scalarName(type);
    const value=floatNames.includes(name) ? api.quote(floatBits(token,name))
      : type===i32TypeId ? `${token} : i32` : type===boolTypeId ? `${token} : i1` : api.quote(token);
    return api.operation('tsfg_core.constant',[],[],type,`value = ${value}`,range);
  };
  const represent=value=>value.kind==='group' ? represent(value.operand)
    // Payload reads retain the shared emitter's domain leaf and budget hooks.
    : value.kind==='reference' ? {payload:api.emit(value),state:stateful.has(value.binding)?api.lookup(stateBinding(value.binding)):null}
    : value.kind==='write' ? (api.emit(value),represent(localReferenceTarget(value.left)))
    : value.kind==='absence' ? {payload:constant(value.type,'0',value.range),state:constant(i32TypeId,value.absence==='undefined'?'1':'2',value.range)}
    : {payload:api.emit(value),state:null};
  const store=(id,value,range)=> {
    api.assign(id,value.payload);
    if(stateful.has(id))api.assign(stateBinding(id),value.state??constant(i32TypeId,'0',range));
    return value.payload;
  };
  const emit=value=>{
    if(value.kind==='absence')return represent(value).payload;
    if(value.kind==='presenceTest') {
      const left=expressionLeaf(value.left),right=expressionLeaf(value.right);
      const ref=left.kind==='reference'?left:right, absent=left.kind==='absence'?left:right;
      return operation(scalarOperations[value.operator],[api.lookup(stateBinding(ref.binding)),constant(i32TypeId,absent.absence==='undefined'?'1':'2',absent.range)],[i32TypeId,i32TypeId],boolTypeId,value.range);
    }
    if(value.kind==='update') {
      const old=api.emit(value.operand), one=constant(value.type,'1',value.range);
      const next=operation(value.operator==='++'?'add':'sub',[old,one],[value.type,value.type],value.type,value.range);
      store(localReferenceTarget(value.operand).binding,{payload:next,state:null},value.range);
      return value.prefix?next:old;
    }
    if(value.kind!=='write')return undefined;
    const target=localReferenceTarget(value.left);
    if(value.operator==='??=') {
      if(!stateful.has(target.binding))return api.lookup(target.binding);
      const condition=operation('ne',[api.lookup(stateBinding(target.binding)),constant(i32TypeId,'0',value.left.range)],[i32TypeId,i32TypeId],boolTypeId,value.range);
      return api.branchValue(condition,value.type,value.range,()=>store(target.binding,represent(value.right),value.range),()=>api.lookup(target.binding));
    }
    if(['&&=','||='].includes(value.operator)) {
      const old=api.emit(value.left), rhs=()=>store(target.binding,represent(value.right),value.range), shortcut=()=>old;
      return api.branchValue(old,value.type,value.range,value.operator==='&&='?rhs:shortcut,value.operator==='&&='?shortcut:rhs);
    }
    // Capture the old payload before RHS side effects can replace its binding.
    const old=value.operator==='='?null:api.emit(value.left), rhs=represent(value.right);
    const result=value.operator==='='?rhs.payload:operation(scalarOperations[value.operator.slice(0,-1)],[old,rhs.payload],[value.type,value.right.type],value.type,value.range);
    return store(target.binding,{payload:result,state:value.operator==='='?rhs.state:null},value.range);
  };
  return {emit,represent,constant,
    local(binding,value,range) {
      if(hasState(binding.presence)||!value) {stateful.add(binding.id);api.declare(stateBinding(binding.id),i32TypeId);}
      if(value)store(binding.id,represent(value),range);
      else store(binding.id,{payload:constant(binding.type,'0',range),state:constant(i32TypeId,'1',range)},range);
    },
    assign:(id,value,range)=>store(id,represent(value),range),
    call(target,arguments_,range) {
      const values=arguments_.map(represent), operands=[];
      for(const [index,parameter] of target.parameters.entries()) {
        const value=values[index]??{payload:constant(parameter.type,'0',range),state:constant(i32TypeId,'1',range)};
        operands.push(value.payload);
        if(hasState(parameter.presence))operands.push(value.state??constant(i32TypeId,'0',range));
      }
      return {operands,types:scalarAbiTypes(target.parameters)};
    },
    initialize() {
      for(const [index,parameter] of fn.parameters.entries()) {
        const value=fn.parameterInitializers?.[index]; if(!value)continue;
        const range=parameter.presence.range;
        const condition=operation('eq',[api.lookup(stateBinding(parameter.id)),constant(i32TypeId,'1',range)],[i32TypeId,i32TypeId],boolTypeId,range);
        api.branchValue(condition,parameter.type,range,()=>store(parameter.id,represent(value),value.range),()=>api.lookup(parameter.id));
      }
    },
  };
}
