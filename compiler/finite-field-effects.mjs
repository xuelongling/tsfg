// SPDX-License-Identifier: MIT
// Physical field writes over the existing owned callable graph. Preserving an
// existing field needs absence of a write to that FieldId, never noalias or a
// caller's value as a universal constructor-entry fact.
import {callComponentsInDependencyOrder} from './array-call-graph.mjs';
import {isBooleanAssignment,isFieldNullishAssignment} from './finite-presence.mjs';

export function finiteFieldStorePath(path,value) {
  return value.kind==='fieldUpdate'||value.operator&&value.operator!=='='?path+'/writeback':path;
}

export function finiteFieldWriteVersion(path,value,sourcePath,target) {
  return {id:path+'/field-version/'+target.actualType+'/'+target.fieldId,node:path+'/value',
    actualType:target.actualType,field:target.fieldId,origin:{source:sourcePath,...value.range}};
}
export function booleanOperand(value,charge) {
  let inverted=false,negation,depth=0;
  while(value.kind==='group'||value.kind==='unary'&&value.operator==='!'){
    charge();depth++;
    if(value.kind==='unary'){inverted=!inverted;negation??=value;}
    value=value.operand;
  }
  return {operand:value,inverted,negation,depth};
}
export function booleanLiteral(value,charge) {
  const {operand,inverted,negation}=booleanOperand(value,charge);
  if(operand.kind!=='boolean')return null;
  return negation?{...operand,value:operand.value!==inverted,range:negation.range}:operand;
}
export function literalBooleanRhs(value,charge) {
  if((value.kind!=='shortCircuit'&&value.kind!=='binary')||
      (value.operator!=='&&'&&value.operator!=='||'))return null;
  const left=booleanLiteral(value.left,charge);
  return left===null?null:left.value===(value.operator==='&&');
}
export function literalIfArm(value,charge) {
  const condition=value.kind==='if'?booleanLiteral(value.condition,charge):null;
  return condition===null?null:condition.value?'then':'else';
}
export function literalLoopCondition(value,charge) {
  return value.kind==='while'?booleanLiteral(value.condition,charge)?.value??null:null;
}

/** @typedef {{target:string,fields:Map<string,Set<string>>,mayExecute:boolean}} FieldCallContext */
/** @param {()=>void} charge */
export function createFieldCallContexts(charge) {
  /** @type {Map<string,Map<string,FieldCallContext>>} */
  const byTarget=new Map();
  return {
    // Site identities include the target, so an update stays in the same bucket.
    /** @param {string} site @param {FieldCallContext} row */
    set(site,row) {
      charge();
      let rows=byTarget.get(row.target);
      if(!rows)byTarget.set(row.target,rows=new Map());
      rows.set(site,row);
    },
    /** @param {string} target */
    incoming(target) {
      const fields=[];
      for(const row of byTarget.get(target)?.values()??[]) {
        charge();
        if(row.mayExecute)fields.push(row.fields);
      }
      return fields;
    },
    *[Symbol.iterator]() {
      for(const rows of byTarget.values())yield* rows;
    },
  };
}

export function finiteFieldEffects(hir,plan,callables,phases,charge,lexicalWrites,keepAllWrites) {
  const fields=new Map((plan.carrierFields??plan.fields).map(row=>{charge();return [row.id,row];})),
    calls=new Map(plan.calls.map(row=>{charge();return [row.id,row];})),types=new Map(hir.types.map(row=>{charge();return [row.id,row];})),
    constructors=new Map(),effects=new Map(),
    sites=new Map(),cyclicFunctions=new Set();
  const terminal=new WeakMap();
  const endsBody=body=>body?.some(row=>{charge();return endsStatement(row);})??false;
  function endsStatement(statement) {
    if(statement.kind==='return'||statement.kind==='constructorReturn')return true;
    if(literalLoopCondition(statement,charge)===true)return true;
    if(statement.kind!=='block'&&statement.kind!=='if')return false;
    if(terminal.has(statement))return terminal.get(statement);
    const arm=literalIfArm(statement,charge),ends=statement.kind==='block'?endsBody(statement.body):
      arm?endsBody(statement[arm]):endsBody(statement.then)&&endsBody(statement.else);
    terminal.set(statement,ends);return ends;
  }
  for(const fn of callables) {
    charge();effects.set(fn.id,{writes:false,fields:new Set(),callees:new Set(),unknown:false});
    if(fn.role==='construction-body')constructors.set(fn.construction,fn.id);
  }
  for(const fn of callables) {
    const effect=effects.get(fn.id),stack=[{value:fn.body,path:fn.id+'/body',mayExecute:true}];
    const target=id=>{charge();if(id)effect.callees.add(id);if(!effects.has(id))effect.unknown=true;};
    while(stack.length) {
      charge();const {value,path,mayExecute}=stack.pop();if(!value||typeof value!=='object')continue;
      if(Array.isArray(value)) {
        // A terminated sequence still contributes its lexical writes and calls.
        let live=mayExecute;
        for(const [index,child]of value.entries())if(child&&typeof child==='object') {
          charge();stack.push({value:child,path:path+'/'+index,mayExecute:live});
          if(live&&endsStatement(child))live=false;
        }
        continue;
      }
      if(value.kind==='fieldAssignment'||value.kind==='fieldUpdate') {
        effect.writes=true;const store=finiteFieldStorePath(path,value),selected=fields.get(store);
        if(!selected?.targets.length)effect.unknown=true;
        for(const row of selected?.targets??[]) {
          charge();if(row.fieldId){
            effect.fields.add(row.fieldId);
            if(keepAllWrites||!mayExecute||isFieldNullishAssignment(value)||isBooleanAssignment(value)){
              charge();const version=finiteFieldWriteVersion(store,value,fn.sourcePath,row);
              lexicalWrites.set(version.id,version);
            }
          }else effect.unknown=true;
        }
      }
      if(value.kind==='initializeOwnFields') {
        effect.writes=true;const phase=phases.get(value.construction),owner=types.get(value.ownerType);
        if(!phase)effect.unknown=true;
        for(const event of phase?.events??[]){charge();effect.fields.add(event.output.field);}
        for(const init of owner?.construction?.initialization??[])if(init.value) {
          charge();stack.push({value:init.value,path:'construction/'+value.construction+'/initialization/'+init.field,mayExecute});
        }
      }
      if(['construct','superConstruct','forwardBaseConstruction'].includes(value.kind)) {
        effect.writes=true;target(constructors.get(value.construction));
      }
      const skipLoop=literalLoopCondition(value,charge)===false;
      if(value.kind==='while'&&mayExecute&&!skipLoop){cyclicFunctions.add(fn.id);effect.unknown=true;}
      if(value.kind==='call') {
        const targets=value.receiver?(calls.get(path)?.targets??[]).map(row=>row.functionId):[value.target];
        if(!targets.length)effect.unknown=true;
        for(const id of targets)if(id!==hir.intrinsics.readSpan.id){
          target(id);sites.set(path+'\0'+id,{target:id,mayExecute});
        }
      }
      const skipRight=literalBooleanRhs(value,charge)===false,arm=literalIfArm(value,charge);
      for(const [key,child]of Object.entries(value))if(child&&typeof child==='object') {
        const skipped=key==='right'&&skipRight||key==='then'&&arm==='else'||key==='else'&&arm==='then'
          ||key==='body'&&skipLoop;
        charge();stack.push({value:child,path:path+'/'+key,mayExecute:mayExecute&&!skipped});
      }
    }
  }
  const recursive=summarizeFieldCalls(effects,charge);
  return {effects,sites,recursive,cyclicFunctions};
}

function summarizeFieldCalls(effects,charge) {
  const targets=new Map(),recursive=new Set();
  for(const [id,effect] of effects) {
    charge();
    const known=new Set();
    for(const target of effect.callees) {
      charge();
      if(effects.has(target))known.add(target);
      else {effect.writes=true;effect.unknown=true;}
    }
    targets.set(id,known);
  }
  for(const {members,cyclic} of callComponentsInDependencyOrder(targets,charge)) {
    charge();
    const ownMembers=new Set(members),fields=new Set();
    let writes=false,unknown=cyclic;
    const merge=effect=>{
      charge();
      writes||=effect.writes;
      unknown||=effect.unknown;
      for(const field of effect.fields){charge();fields.add(field);}
    };
    for(const id of members) {
      charge();
      if(cyclic)recursive.add(id);
      merge(effects.get(id));
      for(const target of targets.get(id)) {
        charge();
        if(!ownMembers.has(target))merge(effects.get(target));
      }
    }
    for(const id of members) {
      charge();
      const effect=effects.get(id);
      effect.writes=writes;
      effect.unknown=unknown;
      for(const field of fields){charge();effect.fields.add(field);}
    }
  }
  return recursive;
}
