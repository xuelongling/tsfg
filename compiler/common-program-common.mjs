// SPDX-License-Identifier: MIT
import sourceDescriptor from '../contracts/common-program-source-v2.schema.json' with {type:'json'};
import hirDescriptor from '../contracts/common-program-hir-v2.schema.json' with {type:'json'};
import {canonical,own,sha256} from './identity.mjs';
import {readGenericJson,copyGenericJsonBytes,checkGenericJsonValueBudget} from './generic-json.mjs';
export {canonical,own,sha256};
export const commonSourceDescriptor=own(sourceDescriptor);
export const commonSourceFormat=own({family:'tsfg.program-facts-package-candidate',version:2,
  schemaHash:sha256(canonical(sourceDescriptor)+'\n')});
export const commonHirFormat=own({family:'tsfg.program-hir-candidate',version:2,
  schemaHash:sha256(canonical(hirDescriptor)+'\n')});
export const commonJsonPolicy=Object.freeze({bytes:8388608,depth:128,jsonTokens:1000000,
  stringBytes:2097152,safeNonnegativeIntegers:true,allowNul:true,rejectPrototypeKeys:false});
/** @returns {never} */
export function commonFailure(kind,message='complete common Program differs',details={}) {
  const code='r03-common-program-'+kind;
  throw Object.assign(new TypeError(code+': '+message),{code,ruleId:'r01-input-boundary',phase:'hir',...details});
}
export const commonCheck=(condition,kind='input',message=undefined,details=undefined)=>{
  if(!condition)commonFailure(kind,message,details);
};
/** @param {((units:number)=>void)} [spend] */
export function commonBudget(value,spend=undefined) {
  let charging=false;
  /** @type {((units:number)=>void)|undefined} */
  const charge=spend===undefined?undefined:units=>{charging=true;spend(units);charging=false;};
  try{checkGenericJsonValueBudget(value,{...commonJsonPolicy,bytes:commonJsonPolicy.bytes-1},charge);}
  catch(error){if(charging)throw error;commonFailure(error.code?.endsWith('-limit')?'limit':'input');}
}
export function commonJson(bytes) {
  try{const input=readGenericJson(copyGenericJsonBytes(bytes,commonJsonPolicy),commonJsonPolicy);
    commonBudget(input.value);commonCheck(input.text===canonical(input.value)+'\n','canonical');return input.value;
  }catch(error){if(error.code?.startsWith('r03-common-program-'))throw error;
    commonFailure(error.code?.endsWith('-limit')?'limit':'json');}
}
export function commonMeter(limit=100000) {
  commonCheck(Number.isInteger(limit)&&limit>0&&limit<=2000000,'limit');let remaining=limit;
  return (amount=1)=>{commonCheck(Number.isSafeInteger(amount)&&amount>=0&&amount<=remaining,'limit');remaining-=amount;};
}
export const commonSame=(a,b)=>canonical(a)===canonical(b);
export function commonRecord(value,required,optional=[]) {
  commonCheck(value&&typeof value==='object'&&!Array.isArray(value),'schema');
  commonCheck(required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key)),'schema');
}
