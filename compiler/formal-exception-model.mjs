// SPDX-License-Identifier: MIT
import descriptor from '../contracts/formal-exception-core-development.json' with {type:'json'};
import {verifyExceptionHir} from './exception-hir.mjs';
import {scalarName,canonical,sha256} from './identity.mjs';
import {coreQuote,coreExchangeFormat} from './core-ssa-emitter.mjs';
import {publicationBudget} from './exception-core-common.mjs';
export const formalExceptionSchema=sha256(canonical(descriptor));
export function exceptionCoreFailure(detail){throw Object.assign(new TypeError('r03-formal-exception-core: '+detail),
  {code:'r03-formal-exception-core',ruleId:'r01-input-boundary',phase:'lowering'});}
export function formalExceptionModel(input){
  const hir=verifyExceptionHir(input);
  if(!hir.target||hir.target.target!=='windows-x86_64-msvc')throw Object.assign(new TypeError('r03-d-capability: explicit exception Core target is required'),
    {code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
  const types=new Map(hir.types.map(t=>[t.id,t])),functions=new Map(hir.functions.map(f=>[f.id,f])),bindings=new Map(),regions=new Map();
  const cell=id=>'cell:'+id,payload='payload:'+formalExceptionSchema;
  function region(node,owner){
    if(regions.has(node.scope))exceptionCoreFailure('duplicate region');regions.set(node.scope,{node,owner});
    for(const b of node.bindings){if(bindings.has(b.id)||bindings.size>=descriptor.limits.logicalArguments)
      exceptionCoreFailure('duplicate or over-budget program binding');bindings.set(b.id,{...b,scope:node.scope,owner});}
    for(const s of node.body){if(s.kind==='block')region(s.region,owner);if(s.kind==='if'){region(s.thenRegion,owner);if(s.elseRegion)region(s.elseRegion,owner);}
      if(s.kind==='while')region(s.bodyRegion,owner);
      if(s.kind==='try'){region(s.tryRegion,owner);if(s.catchClause)region(s.catchClause.region,owner);if(s.finallyRegion)region(s.finallyRegion,owner);}}
  }
  for(const f of hir.functions)region(f.body,f.id);
  for(const m of hir.modules)if(m.initialization)region(m.initialization,m.id);
  const coreType=id=>{
    if(id==='void')return 'none';if(id===payload)return '!tsfg_eh.payload<'+coreQuote(formalExceptionSchema)+'>';
    if(id.startsWith('cell:')){if(!bindings.has(id.slice(5)))exceptionCoreFailure('unknown cell');return '!tsfg_eh.cell<'+coreQuote(id.slice(5))+'>';}
    const t=types.get(id);if(!t)exceptionCoreFailure('unknown type');
    if(t.kind==='unknown')return coreType(payload);
    if(t.kind!=='scalar')return '!tsfg_eh.value<'+coreQuote(id)+'>';
    const name=scalarName(id);return name==='bool'?'i1':['i32','f32','f64'].includes(name)?name:'!tsfg_core.integer<'+coreQuote(name)+'>';
  };
  const publication=publicationBudget(descriptor.limits);
  return {hir,types,functions,bindings,regions,cell,payload,coreType,publication,quote:coreQuote,exchange:coreExchangeFormat,
    schema:formalExceptionSchema,limits:descriptor.limits,signature:fn=>types.get(fn.type),symbol:id=>'f'+id.slice(7)};
}
