// SPDX-License-Identifier: MIT
// Private static GlobalId proof carrier; original private identities remain visible.
import descriptor from '../contracts/core-kernel-global-candidate.schema.json' with {type:'json'};
import {canonical,sha256,boolTypeId,i32TypeId} from './identity.mjs';
import {coreExchangeFormat,coreQuote} from './core-ssa-emitter.mjs';
import {emitScalarCore} from './scalar-core-emitter.mjs';
import {checkGenericJsonValueBudget} from './generic-json-budget.mjs';
import {verifyModuleCallableHir} from './module-callable-hir.mjs';
import {verifiedModulePublicationScope} from './module-callable-publication.mjs';
import {verifyKernelParallelGroup,verifyKernelParallelProof} from './kernel-access.mjs';

function capability(fn,range){
  throw Object.assign(new TypeError('r03-d-kernel-core-capability: complete scalar direct-call module required'),
    {code:'r03-d-kernel-core-capability',ruleId:'r01-kernel',phase:'lowering',
      ...(fn?{primary:{sourceId:fn.sourcePath,...range}}:{})});
}
function limit(){
  throw Object.assign(new TypeError('r03-d-kernel-core-limit: private Core byte limit exceeded'),
    {code:'r03-d-kernel-core-limit',ruleId:'r01-input-boundary',phase:'lowering'});
}
/** Complete cached-Source owned inputs only; supplied proof is an assertion,
 * never authority. Actual C++ consumers independently recheck Core and bounds.
 * @param {any} hir @param {any} context @param {any} request @param {any} [supplied] */
export function lowerKernelGlobalCore(hir,context,request,supplied=undefined){
  const proof=supplied===undefined?verifyKernelParallelGroup(hir,context,request)
    :verifyKernelParallelProof(supplied,hir,context,request);
  const checked=verifyModuleCallableHir(hir),scalar=t=>[boolTypeId,i32TypeId].includes(t);
  // No pruning or synthetic closure: this first profile carries the entire
  // represented package. Other signatures retain a located capability boundary.
  if(checked.functions.length!==checked.closure.functions.length
      ||checked.functions.some(fn=>!checked.closure.functions.includes(fn.id))
      ||checked.modules.length!==checked.closure.modules.length
      ||checked.modules.some(m=>!checked.closure.modules.includes(m.id)))capability();
  for(const fn of checked.functions){
    if(!scalar(fn.returnType)||fn.parameters.some(p=>!scalar(p.type)))capability(fn,fn.range);
    const walk=value=>{
      if(!value||typeof value!=='object')return;
      if(value.kind==='indirectCall'||value.kind==='functionValue'||value.type&&!scalar(value.type))
        capability(fn,value.range??fn.range);
      for(const item of Object.values(value)){
        if(Array.isArray(item))item.forEach(walk);else if(item&&typeof item==='object')walk(item);
      }
    };
    fn.body.forEach(walk);
    if(Buffer.byteLength(fn.name)>descriptor.limits.sourceNameBytes)capability(fn,fn.range);
  }
  if(checked.sources.some(s=>Buffer.byteLength(s.path)>descriptor.limits.sourceNameBytes))capability();
  for(const g of checked.globals)if(Buffer.byteLength(g.name)>descriptor.limits.sourceNameBytes)capability(g,g.range);
  for(const m of checked.modules)if([...m.bindings,...m.exports].some(b=>Buffer.byteLength(b.name)>descriptor.limits.sourceNameBytes))capability();
  const payload={scope:verifiedModulePublicationScope(checked),context,proof};
  // Bound the combined carrier before canonical/hash allocation. Each upstream
  // value was bounded separately; their union must meet this private profile too.
  try { checkGenericJsonValueBudget(payload,{...descriptor.limits,allowNul:true,rejectPrototypeKeys:true}); }
  catch { limit(); }
  let members=0;
  /** @type {any[]} */
  const pending=[payload];
  while(pending.length){
    const value=pending.pop();
    if(value&&typeof value==='object'){
      if(!Array.isArray(value)&&(members+=Object.keys(value).length)>descriptor.limits.members)limit();
      for(const item of Object.values(value))if(item&&typeof item==='object')pending.push(item);
    }
  }
  const text=canonical(payload);
  if(Buffer.byteLength(text)>descriptor.limits.bytes)limit();
  const source=checked.source;
  const core=emitScalarCore({exchange:coreExchangeFormat,inputIdentity:checked.inputIdentity,
    source:{path:source.path,hash:source.hash,length:source.content.length},target:checked.target,
    functions:checked.functions.map(fn=>({...fn,returnType:{id:fn.returnType},symbol:'f'+fn.id.slice(7)})),
    moduleState:{sources:checked.sources.map(s=>({path:s.path,hash:s.hash,length:s.content.length})),modules:checked.modules,globals:checked.globals,
      hostImports:checked.hostImports,closure:checked.closure}});
  // The shared emitter owns all SSA. This adapter adds one exact module marker
  // at its fixed header terminator, without rewriting an instruction or identity.
  const at=core.indexOf('} {\n');
  if(at<0)capability();
  const marker=', tsfg_core.kernel_global = {family = '+coreQuote(descriptor.family)
    +', version = 1 : i32, schema = '+coreQuote(sha256(canonical(descriptor)))
    +', payload = '+coreQuote(text)+'}';
  const result=core.slice(0,at)+marker+core.slice(at);
  if(Buffer.byteLength(result)>descriptor.limits.bytes)limit();
  return result;
}
