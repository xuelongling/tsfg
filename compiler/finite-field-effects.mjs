// SPDX-License-Identifier: MIT
// Physical field writes over the existing owned callable graph. Preserving an
// existing field needs absence of a write to that FieldId, never noalias or a
// caller's value as a universal constructor-entry fact.
export function finiteFieldWriteVersion(path,value,sourcePath,target) {
  return {id:path+'/field-version/'+target.actualType+'/'+target.fieldId,node:path+'/value',
    actualType:target.actualType,field:target.fieldId,origin:{source:sourcePath,...value.range}};
}
export function literalBooleanRhs(value) {
  if((value.kind==='shortCircuit'||value.kind==='binary')&&
      (value.operator==='&&'||value.operator==='||')&&value.left.kind==='boolean')
    return value.left.value===(value.operator==='&&');
  return null;
}
export function literalIfArm(value) {
  return value.kind==='if'&&value.condition.kind==='boolean'?(value.condition.value?'then':'else'):null;
}
export function finiteFieldEffects(hir,plan,callables,phases,charge,lexicalWrites,keepAllWrites) {
  const fields=new Map((plan.carrierFields??plan.fields).map(row=>{charge();return [row.id,row];})),
    calls=new Map(plan.calls.map(row=>{charge();return [row.id,row];})),types=new Map(hir.types.map(row=>{charge();return [row.id,row];})),
    constructors=new Map(),effects=new Map(),
    sites=new Map(),cyclicFunctions=new Set(),recursive=new Set();
  const terminal=new WeakMap();
  const endsBody=body=>body?.some(row=>{charge();return endsStatement(row);})??false;
  function endsStatement(statement) {
    if(statement.kind==='return'||statement.kind==='constructorReturn')return true;
    if(statement.kind!=='block'&&statement.kind!=='if')return false;
    if(terminal.has(statement))return terminal.get(statement);
    const arm=literalIfArm(statement),ends=statement.kind==='block'?endsBody(statement.body):
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
        effect.writes=true;const selected=fields.get(path);
        if(!selected?.targets.length)effect.unknown=true;
        for(const row of selected?.targets??[]) {
          charge();if(row.fieldId){
            effect.fields.add(row.fieldId);
            if((keepAllWrites||!mayExecute)&&value.kind==='fieldAssignment'){
              charge();const version=finiteFieldWriteVersion(path,value,fn.sourcePath,row);
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
      if(value.kind==='while'){cyclicFunctions.add(fn.id);effect.unknown=true;}
      if(value.kind==='call') {
        const targets=value.receiver?(calls.get(path)?.targets??[]).map(row=>row.functionId):[value.target];
        if(!targets.length)effect.unknown=true;
        for(const id of targets)if(id!==hir.intrinsics.readSpan.id){
          target(id);sites.set(path+'\0'+id,{target:id,mayExecute});
        }
      }
      const skipRight=literalBooleanRhs(value)===false,arm=literalIfArm(value);
      for(const [key,child]of Object.entries(value))if(child&&typeof child==='object') {
        const skipped=key==='right'&&skipRight||key==='then'&&arm==='else'||key==='else'&&arm==='then';
        charge();stack.push({value:child,path:path+'/'+key,mayExecute:mayExecute&&!skipped});
      }
    }
  }
  for(const [id,effect]of effects) {
    const work=[],seen=new Set();for(const target of effect.callees){charge();work.push(target);}
    for(let cursor=0;cursor<work.length;++cursor) {
      charge();const target=work[cursor];if(target===id){recursive.add(id);effect.unknown=true;break;}
      if(seen.has(target))continue;seen.add(target);
      for(const child of effects.get(target)?.callees??[]){charge();work.push(child);}
    }
  }
  let changed;
  do {
    changed=false;
    for(const effect of effects.values())for(const id of effect.callees) {
      charge();const child=effects.get(id),unknown=!child||child.unknown;
      if(unknown&&!effect.unknown){effect.unknown=true;changed=true;}
      if((!child||child.writes)&&!effect.writes){effect.writes=true;changed=true;}
      for(const field of child?.fields??[]) {
        charge();if(!effect.fields.has(field)){effect.fields.add(field);changed=true;}
      }
    }
  }while(changed);
  return {effects,sites,recursive,cyclicFunctions};
}
