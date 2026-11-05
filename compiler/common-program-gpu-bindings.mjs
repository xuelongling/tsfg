// SPDX-License-Identifier: MIT
import {commonProgramCore} from './common-program-core.mjs';
import {commonBudget,commonJson,commonRecord,commonCheck,canonical,sha256,own} from './common-program-common.mjs';

/** @typedef {'read'|'write'|'read-write'} GpuAccess */
/** @typedef {{sourceId:string,start:number,end:number}} GpuSource */
/** @typedef {{access:GpuAccess,source:GpuSource}} GpuResource */
/** @typedef {{kind:'global'|'parameter',id:string,kernel:string|null,set:number,binding:number,access:GpuAccess}} GpuBinding */
/** @typedef {{family:'tsfg.gpu-logical-binding-request',version:1,target:'vulkan',kernels:string[],bindings:GpuBinding[]}} GpuBindingRequest */
const requestFamily='tsfg.gpu-logical-binding-request',planFamily='tsfg.gpu-logical-binding-plan';
/** @param {unknown} value */
const hash=value=>typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value);
/** @param {boolean} condition @param {string} kind @param {string} message @param {object} [details] */
function check(condition,kind,message,details={}) {
  commonCheck(condition,'gpu-'+kind,message,{ruleId:'r01-gpu',phase:'lowering',...details});
}
/** @param {{sourcePath:string,range:{start:number,end:number}}} row @returns {GpuSource} */
const source=row=>({sourceId:row.sourcePath,...row.range});
/** @param {GpuBinding} row */
const resourceKey=row=>row.kind+':'+(row.kernel??'')+':'+row.id;
/** @param {unknown} value */
const digest=value=>sha256(canonical(value)+'\n');

// This consumer checks compiler data. Descriptor numbers are logical names;
// neither CPU layout nor API/device capabilities are inferred from them.
/** @param {unknown} value @returns {GpuBindingRequest} */
function requestInput(value) {
  commonBudget(value);commonRecord(value,['family','version','target','kernels','bindings']);
  const request=/** @type {GpuBindingRequest} */(value);
  check(request.family===requestFamily&&request.version===1,'request','unsupported logical GPU request identity');
  check(request.target==='vulkan','target','unsupported logical GPU target');
  check(Array.isArray(request.kernels)&&request.kernels.length>0&&request.kernels.length<=32&&
    request.kernels.every((id,index)=>hash(id)&&(index===0||request.kernels[index-1]<id)),
  'request','logical GPU kernels must be ordered unique identities');
  check(Array.isArray(request.bindings)&&request.bindings.length<=4096,'request','logical GPU resource table exceeds its bound');
  const resources=new Set();
  request.bindings.forEach((row,index)=>{
    commonRecord(row,['kind','id','kernel','set','binding','access']);
    check(hash(row.id)&&(row.kind==='global'?row.kernel===null:row.kind==='parameter'&&hash(row.kernel)),
      'resource','unsupported or foreign logical GPU resource identity');
    check([row.set,row.binding].every(n=>Number.isInteger(n)&&n>=0&&n<=4294967295)&&
      ['read','write','read-write'].includes(row.access),'request','invalid logical descriptor or access');
    const previous=request.bindings[index-1];
    check(index===0||previous.set<row.set||previous.set===row.set&&previous.binding<row.binding,
      'slot','logical descriptor slots must be ordered and unique');
    const key=resourceKey(row);check(!resources.has(key),'resource','logical GPU resource is bound more than once');resources.add(key);
  });
  return request;
}

/** @param {Parameters<typeof commonProgramCore>[0]} input
 * @param {Parameters<typeof commonProgramCore>[1]} publication
 * @param {Parameters<typeof commonProgramCore>[2]} kernelRequest @param {unknown} value */
export function createCommonGpuBindingPlan(input,publication,kernelRequest,value) {
  // Keep whole-Program Source/actual/borrow validation before target selection.
  // Prior effect, call-chain and borrow failures retain their original identity.
  const checked=commonProgramCore(input,publication,kernelRequest,{borrowProof:true}),{hir,proof,borrowProof}=checked;
  const request=requestInput(value),functions=new Map(hir.functions.map(fn=>[fn.id,fn]));
  const first=functions.get(request.kernels[0])??functions.get(proof.targets[0])??hir.functions[0],primary=first?source(first):undefined;
  check(request.kernels.every(id=>proof.targets.includes(id)),'kernel','logical GPU target is outside the verified kernel group',{primary});
  const selected=new Set(request.kernels),accesses=proof.accesses.filter(row=>selected.has(row.functionId));
  const reads=new Set(accesses.flatMap(row=>row.reads)),writes=new Set(accesses.flatMap(row=>row.writes));
  const types=new Map(hir.types.map(row=>[row.id,row])),globals=new Map(hir.globals.map(row=>[row.id,row]));
  /** @param {string} id */
  const i32=id=>{const type=types.get(id);return type?.kind==='scalar'&&type.sourceType==='i32'&&type.name==='i32';};
  const kernels=request.kernels.map(functionId=>{
    const fn=functions.get(functionId),returnType=types.get(fn.returnType);
    check(!fn.ownerType&&(i32(fn.returnType)||returnType?.kind==='void'),'capability',
      'GPU logical signature type or receiver is not implemented',{primary:source(fn),functionId});
    return {functionId,source:source(fn)};
  });
  /** @type {Map<string,GpuResource>} */
  const available=new Map();
  [...new Set([...reads,...writes])].sort().forEach(id=>{
    const global=globals.get(id);
    check(i32(global.type),'capability','GPU logical global type is not implemented',{primary:source(global),globalId:id});
    const access=reads.has(id)?writes.has(id)?'read-write':'read':'write';
    available.set('global::'+id,{access,source:source(global)});
  });
  request.kernels.forEach(functionId=>{
    const fn=functions.get(functionId),upper=accesses.find(row=>row.functionId===functionId);
    fn.parameters.forEach((parameter,index)=>{
      const permission=upper.parameters[index];
      check(i32(parameter.type)&&!permission.write&&!permission.structural,'capability',
        'GPU logical parameter type or mutable access is not implemented',{primary:{sourceId:fn.sourcePath,...parameter.range},functionId,parameterId:parameter.id});
      available.set('parameter:'+functionId+':'+parameter.id,{access:'read',source:{sourceId:fn.sourcePath,...parameter.range}});
    });
  });
  const bindings=request.bindings.map(row=>{
    const resource=available.get(resourceKey(row));
    check(resource!==undefined,'resource','logical GPU resource is outside the selected fixed access set',{primary,resourceId:row.id});
    const admitted=/** @type {GpuResource} */(resource);
    check(admitted.access===row.access,'access','logical GPU resource access differs from its fixed contract',{primary:admitted.source,resourceId:row.id});
    return {...row,type:'i32',source:admitted.source};
  });
  const bound=new Set(request.bindings.map(resourceKey)),missing=[...available].find(([key])=>!bound.has(key))?.[1];
  check(bindings.length===available.size,'coverage','logical GPU resources do not cover the selected fixed access set',{primary:missing?.source??primary});
  const plan={family:planFamily,version:1,target:request.target,scope:'static-logical',inputIdentity:proof.inputIdentity,
    hirDigest:proof.hirDigest,scopeDigest:proof.scopeDigest,publishedDigest:proof.publishedDigest,
    kernelProofDigest:digest(proof),borrowProofDigest:digest(borrowProof),requestDigest:digest(request),
    groupTargets:proof.targets,kernels,bindings};
  commonBudget(plan);return own(plan);
}

/** @param {unknown} plan @param {Parameters<typeof createCommonGpuBindingPlan>[0]} hir
 * @param {Parameters<typeof createCommonGpuBindingPlan>[1]} publication
 * @param {Parameters<typeof createCommonGpuBindingPlan>[2]} kernelRequest @param {unknown} request */
export function verifyCommonGpuBindingPlan(plan,hir,publication,kernelRequest,request) {
  commonBudget(plan);const expected=createCommonGpuBindingPlan(hir,publication,kernelRequest,request);
  check(canonical(plan)===canonical(expected),'plan','logical GPU plan differs from complete independent reconstruction');return expected;
}
/** @param {Parameters<typeof verifyCommonGpuBindingPlan>} args */
export const printCommonGpuBindingPlan=(...args)=>canonical(verifyCommonGpuBindingPlan(...args))+'\n';
/** @param {unknown} bytes @param {Parameters<typeof createCommonGpuBindingPlan>[0]} hir
 * @param {Parameters<typeof createCommonGpuBindingPlan>[1]} publication
 * @param {Parameters<typeof createCommonGpuBindingPlan>[2]} kernelRequest @param {unknown} request */
export const readCommonGpuBindingPlan=(bytes,hir,publication,kernelRequest,request)=>
  verifyCommonGpuBindingPlan(commonJson(bytes),hir,publication,kernelRequest,request);
