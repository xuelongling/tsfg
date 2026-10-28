// SPDX-License-Identifier: MIT
// Container classification uses the owned catalogue, never a distinguished T.
import {finiteCallables} from './finite-callables.mjs';
import {typedReferenceAuthority} from './typed-reference-authority.mjs';
export const hasConditionalArrayRhs=value=>value.kind==='shortCircuit'
  ||value.kind==='binary'&&['&&','||','??'].includes(value.operator);
export function arrayConstructionTarget(hir,id) {
  const type=hir.types.find(type=>type.construction?.id===id);
  return type?.constructor??type?.construction?.id;
}
export function arrayAnalysisTypes(hir) {
  const types=new Map(hir.types.map(row=>[row.id,row])),parents=new Map();
  for(const row of hir.types)if(row.kind==='union')for(const member of row.members) {
    if(!parents.has(member))parents.set(member,[]);parents.get(member).push(row.id);
  }
  const closure=kind=>{
    const result=new Set(hir.types.filter(row=>row.kind===kind).map(row=>row.id)),queue=[...result];
    for(let index=0;index<queue.length;index++)for(const parent of parents.get(queue[index])??[])
      if(!result.has(parent)){result.add(parent);queue.push(parent);}
    return result;
  };
  const arrays=closure('array'),views=closure('readSpan');
  return {types,isArray:id=>arrays.has(id),isView:id=>views.has(id),isOwner:id=>arrays.has(id)||views.has(id)};
}

/** Children in evaluation order. Targets own receiver/index exactly once. */
export function arrayExpressionChildren(value,path) {
  const result=[],add=key=>{if(value[key])result.push([value[key],[...path,key]]);};
  if(value.target&&typeof value.target==='object')add('target');
  add('receiver');add('index');add('operand');add('left');add('right');add('value');
  for(const key of ['arguments','elements'])for(const [index,child] of (value[key]??[]).entries())
    result.push([child,[...path,key,index]]);
  return result;
}

export function arrayReferenceBinding(value) {
  while(value&&['group','assertType','nonNull'].includes(value.kind))value=value.operand;
  return value?.kind==='reference'?value.binding:null;
}

export function visitArrayBody(body,visit,path=['body']) {
  const expression=(value,at)=>{
    if(!value)return;
    visit(value,at);
    for(const [child,childPath] of arrayExpressionChildren(value,at))expression(child,childPath);
  };
  for(const [index,statement] of body.entries()) {
    const at=[...path,index];
    for(const key of ['initializer','expression','value','condition'])expression(statement[key],[...at,key]);
    for(const key of ['then','else','body'])if(statement[key])visitArrayBody(statement[key],visit,[...at,key]);
  }
}

export function arrayProgramShape(hir,charge=undefined) {
  const types=arrayAnalysisTypes(hir),callables=finiteCallables(hir),ids=new Set(callables.map(fn=>fn.id)),occurrences=[];
  const functions=new Map(callables.map(fn=>[fn.id,fn]));let authority,views=false;
  const targets=value=>{
    if(value.kind!=='call'||!value.receiver||types.types.get(functions.get(value.target)?.ownerType)?.kind!=='reference'
      ||functions.get(value.target)?.role==='construction-body')return [value.target];
    authority??=typedReferenceAuthority(hir,charge);return authority.possibleMethods(value.receiver.type,value.target);
  };
  for(const fn of callables) {
    views ||=types.isView(fn.returnType.id)||fn.parameters.some(p=>types.isView(p.type));
    visitArrayBody(fn.body,(value,path)=>{
      views ||=types.isView(value.type);
      const target=['construct','superConstruct'].includes(value.kind)?arrayConstructionTarget(hir,value.construction):value.target;
      if(['call','construct','superConstruct'].includes(value.kind)&&ids.has(target))
        for(const selected of value.kind==='call'?targets(value):[target])occurrences.push({caller:fn.id,target:selected,path});
    });
    for(const statement of fn.body)if(statement.kind==='forwardBaseConstruction')
      occurrences.push({caller:fn.id,target:arrayConstructionTarget(hir,statement.construction),path:['body']});
    const type=fn.construction?hir.types.find(type=>type.construction?.id===fn.construction):undefined;
    if(type)for(const step of type.construction.initialization)if(step.value)visitArrayBody([{expression:step.value}],(value,path)=>{
      views ||=types.isView(value.type);
      const target=['construct','superConstruct'].includes(value.kind)?arrayConstructionTarget(hir,value.construction):value.target;
      if(['call','construct','superConstruct'].includes(value.kind)&&ids.has(target))
        for(const selected of value.kind==='call'?targets(value):[target])occurrences.push({caller:fn.id,target:selected,path});
    });
  }
  return {...types,views,occurrences,callables,authority};
}
