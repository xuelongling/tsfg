// SPDX-License-Identifier: MIT
// One analysis graph inventory, with public canonical Core plans kept distinct
// from nonserialized constructor root plans. No second actual solver.
import {commonImplicitConstructionPlans} from './common-program-implicit-construction-plans.mjs';
import {planCommonFunction} from './common-program-control.mjs';
import {classifyArrayCallGraph} from './array-call-graph.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonInternalConstructionPlans,commonInternalConstructionDirectory} from './common-program-internal-constructions.mjs';

// Typed inner seam, called by commonProgramPlan only after real HIR admission
// and complete ordinary model/callable construction with the same spend.
export function commonConstructionPlans(input,owners){
  const {spend}=input,implicit=new Set();
  spend(input.types.size);for(const type of input.types.values())if(['reference','value'].includes(type.kind)&&type.construction&&type.construction.kind!=='explicit')implicit.add(type.id);
  const edges=[],dependencies=new Map();
  // Walk only typed statement/expression edges, not Source text or snapshots.
  const collect=rows=>{
    spend(rows.length);const pending=[...rows],targets=new Set();let hasSuper=false;
    for(let index=0;index<pending.length;index++){
      spend();const node=pending[index];
      if(node.kind==='new'&&implicit.has(node.type)){spend();targets.add(node.type);}
      if(node.kind==='superConstruct'){hasSuper=true;if(implicit.has(node.callee)){spend();targets.add(node.callee);}}
      for(const key of ['expression','left','right','receiver','index','value','target','initializer','condition','tryBlock','catchClause','finallyBlock','block'])
        if(node[key]){spend();pending.push(node[key]);}
      for(const key of ['elements','arguments','body','then','else'])if(node[key]){spend(node[key].length);for(const child of node[key])pending.push(child);}
    }
    return {targets,hasSuper};
  };
  for(const id of implicit){
    spend();const type=input.types.get(id),initializers=[];
    spend(type.construction.initializationFields.length);
    for(const field of type.construction.initializationFields){const value=input.fields.get(field).initializer;if(value)initializers.push(value);}
    const {targets}=collect(initializers);if(implicit.has(type.base)){spend();targets.add(type.base);}
    dependencies.set(id,targets);spend(targets.size);for(const target of targets)edges.push({caller:id,target});
  }
  spend(implicit.size+edges.length);const cyclic=new Set();
  for(const component of classifyArrayCallGraph([...implicit],edges).components)if(component.cyclic){spend(component.members.length);for(const id of component.members)cyclic.add(id);}
  const reachesCycle=seeds=>{
    const pending=[],seen=new Set();spend(seeds.size);for(const id of seeds)pending.push(id);
    let recursive=false;
    for(let index=0;index<pending.length;index++){
      spend();const id=pending[index];if(seen.has(id))continue;seen.add(id);recursive ||= cyclic.has(id);
      const targets=dependencies.get(id);spend(targets?.size??0);for(const target of targets??[])pending.push(target);
    }
    return recursive;
  };
  // This creates each private constructor plan once, before public planning.
  // Public owners are not lowered by the projection, so no duplicate FnIDs.
  const projected=commonImplicitConstructionPlans(input,[]),corePlans=[],publicPlans=[],privateCoreCalls=[];
  spend(owners.length*4+input.bindings.size);const publicFunctions=new Set(owners.map(owner=>owner.id)),publicBindings=new Set(input.bindings.keys());
  spend(input.types.size);for(const type of input.types.values())if(type.kind==='array'){
    spend(Math.ceil((type.id.length+8)/8)+1);publicBindings.add('element:'+type.id);
  }
  spend(projected.privateTargets.size);const privateIds=new Set(projected.privateTargets.values());
  for(const owner of owners){
    spend();const initial=collect(owner.body),seeds=initial.targets,type=input.types.get(owner.ownerType);
    // Base constructors initialize own fields at entry. Derived fields are
    // lowered at actual super occurrences, including syntactically untaken arms.
    if(owner.kind==='construction-body'&&type&&(!type.base||initial.hasSuper)){
      const values=[];spend(type.construction.initializationFields.length);
      for(const id of type.construction.initializationFields){const value=input.fields.get(id).initializer;if(value)values.push(value);}
      for(const id of collect(values).targets){spend();seeds.add(id);}
    }
    const recursive=reachesCycle(seeds);
    // Already supported acyclic Core retains the original inline normal form.
    // Cyclic inputs use defined private invokes for analysis, never recursion
    // through the compiler stack or a second legacy actual engine.
    let plan=planCommonFunction(recursive?projected.model:input,owner);
    if(recursive){
      // The tree scan includes dead statements. Reuse actual lowering's
      // frontier instead of inventing a second statement reachability solver.
      // If no emitted call reaches a type cycle, canonical inline lowering is
      // finite. Only this false-positive case needs another planning attempt;
      // exactly one public plan is retained and analyzed.
      const emitted=new Set();
      for(const block of plan.graph.blocks)for(const op of block.instructions){spend();if(op.name==='tsfg_program.invoke'&&privateIds.has(op.properties.function_id)){
        spend();emitted.add(projected.model.functions.get(op.properties.function_id).ownerType);
      }}
      if(!reachesCycle(emitted))plan=planCommonFunction(input,owner);
    }
    publicPlans.push(plan);corePlans.push(plan);
    for(const block of plan.graph.blocks)for(const op of block.instructions){
      spend();if(op.name==='tsfg_program.invoke'&&privateIds.has(op.properties.function_id)){
        spend();privateCoreCalls.push({functionId:owner.id,target:op.properties.function_id});
      }
    }
  }
  spend(publicPlans.length+projected.plans.length);
  return {...projected,plans:[...publicPlans,...projected.plans],corePlans,
    construction:{publicFunctions,publicBindings,privateIds,privateCoreCalls,cyclicTypes:cyclic},coverage:projected.coverage};
}

// Resolve the separate draft internal directory before serializing any body.
// Public canonical plans remain unchanged; only real helper dependencies add
// non-Published definitions. Both inventories use the same actual solution.
export function requireCommonCoreConstructionPlans(program){
  const helpers=commonInternalConstructionPlans(program);program.model.spend(program.corePlans.length+helpers.length);
  return [...program.corePlans,...helpers];
}

export function commonPublicCoreRepresentation(program,carriers){
  const record=carriers.record(),{publicFunctions,publicBindings}=program.construction;
  program.model.spend(record.bindings.length+record.functions.length);
  const bindings=record.bindings.filter(row=>publicBindings.has(row.id)),functions=record.functions.filter(row=>publicFunctions.has(row.id));
  check(bindings.length===publicBindings.size&&functions.length===publicFunctions.size,'identity','public Core storage/function inventory is incomplete');
  return {domains:record.domains,bindings,functions,internalConstructors:commonInternalConstructionDirectory(program,carriers)};
}

// Both solver passes retain the same complete-coverage gate. Neither a real
// observation nor a private plan can repair missing callable/entry evidence.
export function combineCommonConstructionCoverage(program,values){
  for(const pass of [values.capacity,values.actual]){
    const current=pass.storageObservations.coverage,projection=program.coverage;
    program.model.spend((current.issues.length+projection.issues.length)*2);
    const issues=new Set([...current.issues,...projection.issues]);program.model.spend(issues.size);
    pass.storageObservations.coverage={complete:current.complete&&projection.complete,issues:[...issues]};
  }
  return values;
}
