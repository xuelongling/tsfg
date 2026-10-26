// SPDX-License-Identifier: MIT
import {commonProgramPlan} from './common-program-plan.mjs';
import {analyzeCommonGraphs} from './common-program-actual.mjs';
import {selectCommonCarriers} from './common-program-carriers.mjs';
// Physical reachability supplies only additional body obligations. It cannot
// change stable semantic scope or narrow an already published capability.
export function commonProgramPhysical(hir,records=null) {
  const program=commonProgramPlan(hir,records),values=analyzeCommonGraphs(program,records),carriers=selectCommonCarriers(program,values),references=new Map(),escaping=new Map();
  const managed=value=>Boolean(value&&(value.unknown||[...value.pairs.values()].some(pair=>pair.environment!==null)||[...value.tags].some(id=>program.model.types.get(id)?.kind!=='function'&&carriers.layout(id).referenceCount>0)));
  for(const plan of program.plans){const id=plan.owner.id;references.set(id,false);escaping.set(id,false);
    for(const [name,row]of plan.graph.registers){program.model.spend();if(!row.view.startsWith('cell:')&&managed(values.capacity.observed.get(id+'/'+name)))references.set(id,true);}}
  for(const context of values.capacity.contexts.values())if(managed(context.returned))escaping.set(context.plan.owner.id,true);
  return {...program,values,carriers,references,escaping};
}
