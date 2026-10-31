// SPDX-License-Identifier: MIT
// One logical typed SSA/CFG precedes actual flow and physical carrier selection.
import descriptor from '../contracts/common-program-core-development.json' with {type:'json'};
import {verifyCommonProgramHir} from './common-program-hir.mjs';
import {commonConstructionPlans} from './common-program-construction-plans.mjs';
import {commonCheck as check,commonMeter,canonical,sha256} from './common-program-common.mjs';
import {commonTargets} from './common-program-targets.mjs';
import {commonMethods} from './common-program-methods.mjs';
export const commonCoreSchema=sha256(canonical(descriptor));
export const commonCoreFormat=Object.freeze({family:descriptor.family,version:descriptor.version,marker:descriptor.marker.name});
export function createCommonGraph(model,owner) {
  const blocks=[],registers=new Map();let next=0,nextBlock=0,operations=0,edges=0;
  const variable=view=>{model.spend();check(registers.size<descriptor.limits.registersPerFunction,'limit');const id='%v'+next++;registers.set(id,{view});return id;};
  const block=(types=[])=>{model.spend(types.length+1);check(blocks.length<descriptor.limits.blocksPerFunction,'limit');
    const result={name:'bb'+nextBlock++,parameters:types.map(view=>({name:variable(view),type:view})),instructions:[],terminated:false,incoming:0};blocks.push(result);return result;};
  const emit=(from,name,values,view,properties,range,successors=[])=>{
    model.spend(values.length+successors.length+1);check(from&&!from.terminated&&++operations<=descriptor.limits.instructionsPerFunction,'ssa');
    check(values.every(value=>registers.has(value.name)),'ssa');check(successors.every(to=>blocks.includes(to)),'ssa');edges+=successors.length;check(edges<=4096,'limit');
    const op={name:name.startsWith('cf.')||name.startsWith('func.')?name:'tsfg_program.'+name,operands:values.map(value=>value.name),result:view===null?null:variable(view),
      view,properties:{...properties},range:{...range},successors:successors.map(to=>to.name)};
    for(const to of successors)to.incoming++;from.instructions.push(op);if(op.result)registers.get(op.result).operation=op;
    return op.result?{name:op.result,type:view}:null;
  };
  const terminal=(from,name,values,to,props,range)=>{emit(from,name,values,null,props,range,to);from.terminated=true;};
  return {owner,blocks,registers,newBlock:block,emit,terminal,
    branch(from,to,args,range){terminal(from,'cf.br',args,[to],{},range);},
    conditional(from,value,left,right,range){terminal(from,'cf.cond_br',[value],[left,right],{},range);}};
}
export function commonProgramModel(input,records=null) {
  const hir=verifyCommonProgramHir(input),spend=commonMeter(descriptor.limits.work),types=new Map(hir.types.map(row=>[row.id,row]));
  for(const name of ['undefined','null','bool']){const id=sha256('tsfg.type\0'+name);if(!types.has(id))types.set(id,{id,kind:name==='bool'?'scalar':name,name});}
  const functions=new Map(hir.functions.map(fn=>[fn.id,fn])),bindings=new Map(),fields=new Map(),globals=new Map(hir.globals.map(row=>[row.id,row]));
  const add=(row,role,owner)=>{spend();check(!bindings.has(row.id),'identity');bindings.set(row.id,{...row,role,owner});};
  for(const fn of hir.functions){for(const p of fn.parameters)add(p,'parameter',fn.id);for(const b of fn.bindings)add(b,b.kind,fn.id);
    if(fn.ownerType)add({id:fn.receiverBinding,type:fn.ownerType,name:'this',writable:false,range:fn.nameRange},'receiver',fn.id);}
  for(const global of hir.globals)add({id:global.sourceBinding,type:global.type,name:global.name,writable:global.writable,range:global.range},'global',global.id);
  for(const type of hir.types)for(const field of type.fields??[]){fields.set(field.id,{...field,owner:type.id});add({id:field.sourceBinding,type:field.type,name:field.name,
    writable:!field.readonly,range:field.origin},'field',type.id);}
  const modules=hir.modules.map(module=>({id:module.initializer,name:'$moduleInit',kind:'module-initializer',sourcePath:module.sourcePath,returnType:'void',parameters:[],bindings:[],
    signatureHash:sha256('tsfg.common-program.initializer-signature.v1\0void'),range:{start:0,end:hir.sources.find(source=>source.path===module.sourcePath).content.length},body:module.initialization}));
  spend(hir.environments.length);const environments=new Map(hir.environments.map(row=>[row.id,row])),slots=new Map();
  for(const env of hir.environments){spend(env.slots.length);for(const slot of env.slots)slots.set(slot.binding,{...slot,layout:env.id});}
  const callables=commonTargets(hir,spend,records);
  const hosts=new Map(hir.hostImports.map(row=>[row.id,row]));
  const model={hir,types,functions,bindings,fields,globals,hosts,spend,environments,slots,callables,methods:commonMethods(hir,spend),schema:commonCoreSchema,payload:'payload:'+commonCoreSchema,limits:descriptor.limits,
    cell:id=>'cell:'+id};
  spend(hir.functions.length+modules.length+2);
  return {model,owners:[...hir.functions,...modules]};
}

export function commonProgramPlan(input,records=null) {
  const {model,owners}=commonProgramModel(input,records);
  return commonConstructionPlans(model,owners);
}
