// SPDX-License-Identifier: MIT
// Project admitted fixed semantic declarations for the graph boundary. No body, Actual
// sample, storage capacity, instance, Borrow fact or writable flag selects roots.
import {readCommonReturnOriginGraph} from './common-program-return-origin-graph.mjs';
import {commonCheck as check} from './common-program-common.mjs';

export function commonReturnOriginDirectories(hir,spend) {
  spend(hir.types.length+hir.functions.length+hir.globals.length+hir.environments.length+1);
  const types=new Map(),functions=new Map(),globals=new Map(),environments=new Map(),fields=new Set();
  for(const type of hir.types){spend();types.set(type.id,{kind:type.kind});for(const field of type.fields??[]){spend();fields.add(field.id);}}
  for(const fn of hir.functions){spend(fn.parameters.length+2);const parameterTypes=[];
    // A construction body's private frame is never manufactured as an object
    // receiver root. The ordinary reader reports its protocol OPEN.
    if(fn.kind==='method')parameterTypes.push(fn.ownerType);
    for(const parameter of fn.parameters)parameterTypes.push(parameter.type);
    functions.set(fn.id,{kind:fn.kind,parameterTypes,returnType:fn.returnType,
      lexicalEnvironment:fn.lexicalEnvironment??null,activationEnvironment:fn.activationEnvironment??null});
  }
  for(const global of hir.globals){spend();globals.set(global.id,global.type);}
  for(const env of hir.environments){spend(env.slots.length+1);const slots=[];for(const slot of env.slots)slots.push({key:slot.key,type:slot.type,writable:slot.writable});environments.set(env.id,{parent:env.parent,slots});}
  const read=(functionId,raw)=>{
    spend();const fn=functions.get(functionId);check(fn,'return-origin-function-context');
    // The complete admitted Env layout chain, not a current-body read list,
    // binds draft4 slot addressing and the fixed hidden lexical protocol.
    return readCommonReturnOriginGraph(raw,{functionId,types,functions,globals,fields,environments},spend);
  };
  return {read};
}
