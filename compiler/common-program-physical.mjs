// SPDX-License-Identifier: MIT
import {commonProgramPlan} from './common-program-plan.mjs';
import {analyzeCommonGraphs} from './common-program-actual.mjs';
import {selectCommonCarriers} from './common-program-carriers.mjs';
import {combineCommonConstructionCoverage} from './common-program-construction-plans.mjs';
// Physical reachability supplies only additional body obligations. It cannot
// change stable semantic scope or narrow an already published capability.
/** @param {{borrowProof?:boolean,storageAuthoring?:boolean}} options */
export function commonProgramPhysical(hir,records=null,options={borrowProof:false}) {
  return commonConstructionPhysical(commonProgramPlan(hir,records),records,options);
}
// Typed inner operation shared by the admitted entry and literal model tests.
// Owns the single actual invocation, capacity selection and public maps.
/** @param {{borrowProof?:boolean,storageAuthoring?:boolean}} options */
export function commonConstructionPhysical(program,records=null,options={borrowProof:false}) {
  const values=combineCommonConstructionCoverage(program,analyzeCommonGraphs(program,records,options)),carriers=selectCommonCarriers(program,values),references=new Map(),escaping=new Map();
  const managed=value=>Boolean(value&&(value.unknown||[...value.pairs.values()].some(pair=>pair.environment!==null)||[...value.tags].some(id=>program.model.types.get(id)?.kind!=='function'&&carriers.layout(id).referenceCount>0)));
  for(const plan of program.corePlans){const id=plan.owner.id;references.set(id,false);escaping.set(id,false);
    for(const [name,row]of plan.graph.registers){program.model.spend();if(!row.view.startsWith('cell:')&&managed(values.capacity.observed.get(id+'/'+name)))references.set(id,true);}}
  for(const context of values.capacity.contexts.values())if(escaping.has(context.plan.owner.id)&&managed(context.returned))escaping.set(context.plan.owner.id,true);
  return {...program,values,carriers,references,escaping};
}
