// SPDX-License-Identifier: MIT
// The fixed private descriptor uses this small subset, not a general JSON Schema engine.
import { isProxy } from 'node:util/types';
import descriptor from '../contracts/module-callable-candidate.schema.json' with { type: 'json' };
import { canonical, own, sha256, scalarTypeIds } from './identity.mjs';
import { checkGenericJsonValueBudget, copyGenericJsonBytes, readGenericJson, inspectGenericJson } from './generic-json.mjs';
export { canonical, own, sha256, scalarTypeIds };
export const schemaHash = 'sha256:881f96d715d41882739253749f25949d5d9aef5b4c4cd5329e352b3d6ffc1990';
export const limits = Object.freeze({bytes:8388608,depth:128,jsonTokens:200000,stringBytes:1048576,allowNul:true,rejectPrototypeKeys:true});
export const compare = (a,b) => Buffer.from(a).compare(Buffer.from(b));
export const same = (a,b) => canonical(a) === canonical(b);
export const format = family => ({family,version:1,schemaHash});
const messages = {input:'invalid module callable candidate',identity:'module callable candidate identity differs',source:'module callable source facts differ',canonical:'module callable candidate must use canonical JSON plus LF',reconstruct:'module callable HIR differs from complete reconstruction',limit:'module callable candidate budget exceeded'};
export function failure(kind='input') {
  const code='r03-module-callable-'+kind;
  throw Object.assign(new TypeError(code+': '+messages[kind]),{code,ruleId:'r01-input-boundary',phase:'hir'});
}
export function capability() {
  throw Object.assign(new TypeError('r03-d-capability: unsupported module callable candidate capability'),{code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'hir'});
}
export const check=(condition,kind='input')=>{if(!condition)failure(kind);};
export function budget(value,fail=failure) {
  try { checkGenericJsonValueBudget(value,limits); }
  catch(error) { fail(error.code?.endsWith('-limit')?'limit':'input'); }
}
// A selector is metadata only. Never execute a getter, Proxy trap or inherited selector.
export function familyOf(value) {
  if (!value || typeof value!=='object') return undefined;
  check(!isProxy(value));
  check([Object.prototype,null].includes(Object.getPrototypeOf(value)));
  const f=Object.getOwnPropertyDescriptor(value,'format');
  if (!f) return undefined;
  check(Object.hasOwn(f,'value'));
  if (!f.value || typeof f.value!=='object') return undefined;
  check(!isProxy(f.value));
  check([Object.prototype,null].includes(Object.getPrototypeOf(f.value)));
  const family=Object.getOwnPropertyDescriptor(f.value,'family');
  if (!family) return undefined;
  check(Object.hasOwn(family,'value'));
  return family.value;
}
const envelope={bytes:16777216,depth:16777216,jsonTokens:16777216,stringBytes:16777216,allowNul:true,rejectPrototypeKeys:false,safeNonnegativeIntegers:false};
export function requestFamily(bytes) {
  try {return inspectGenericJson(copyGenericJsonBytes(bytes,envelope),envelope,['family']).selection?.value;}
  catch { return undefined; } // The selected strict reader, or unchanged old reader, owns errors.
}
export function readJson(bytes,fail=failure) {
  let input;
  try {input=readGenericJson(copyGenericJsonBytes(bytes,limits),limits);}
  catch(error){fail(error.code?.endsWith('-limit')?'limit':'canonical');}
  budget(input.value,fail);
  if(input.text!==canonical(input.value)+'\n')fail('canonical');
  return input;
}
// Reject unsupported descriptor constructs rather than silently weakening validation.
const keywords=new Set(['$ref','type','const','enum','oneOf','properties','required','additionalProperties','items','minItems','maxItems','minimum','maximum','pattern','minLength','maxLength']);
function descriptorShape(schema,seen=new Set()) {
  if(seen.has(schema))return;seen.add(schema);
  for(const key of Object.keys(schema))check(keywords.has(key),'identity');
  if(schema.$ref){check(schema.$ref.startsWith('#/$defs/')&&descriptor.$defs[schema.$ref.slice(8)],'identity');return;}
  if(schema.type==='object')check(schema.additionalProperties===false,'identity');
  if(schema.properties)Object.values(schema.properties).forEach(x=>descriptorShape(x,seen));
  if(schema.oneOf)schema.oneOf.forEach(x=>descriptorShape(x,seen));
  if(schema.items)descriptorShape(schema.items,seen);
}
check(sha256(canonical(descriptor)+'\n')===schemaHash,'identity');
Object.values(descriptor.$defs).forEach(x=>descriptorShape(x));
export function validateShape(value,name,fail=failure) {
  let work=0;
  function accepts(v,s) {
    if(++work>1000000)fail('limit');
    if(s.$ref)return accepts(v,descriptor.$defs[s.$ref.slice(8)]);
    if(s.oneOf)return s.oneOf.reduce((n,x)=>n+Number(accepts(v,x)),0)===1;
    if(Object.hasOwn(s,'const')&&!same(v,s.const))return false;
    if(s.enum&&!s.enum.some(x=>same(v,x)))return false;
    if(s.type==='null')return v===null;
    if(s.type==='boolean')return typeof v==='boolean';
    if(s.type==='integer')return Number.isSafeInteger(v)&&v>=s.minimum&&v<=s.maximum;
    if(s.type==='string')return typeof v==='string'&&(s.minLength===undefined||v.length>=s.minLength)&&(s.maxLength===undefined||v.length<=s.maxLength)&&(!s.pattern||new RegExp(s.pattern,'u').test(v));
    if(s.type==='array')return Array.isArray(v)&&v.length>=s.minItems&&v.length<=s.maxItems&&v.every(x=>accepts(x,s.items));
    if(s.type==='object')return v!==null&&typeof v==='object'&&!Array.isArray(v)&&s.required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>Object.hasOwn(s.properties,k)&&accepts(v[k],s.properties[k]));
    return true;
  }
  if(!accepts(value,descriptor.$defs[name]))fail('input');
}
export function valueType(kind,signature,depth=0) {
  check(depth<=16,'limit');
  if(kind!=='function'){check((kind==='bool'||kind==='i32')&&(signature===undefined||signature===null),'source');return kind;}
  check(signature,'source');
  check(signature.parameters.length<=32,'limit');
  if(signature.parameterSignatures)check(signature.parameterSignatures.length===signature.parameters.length&&signature.parameterSignatures.some(Boolean),'source');
  return {parameters:signature.parameters.map((x,i)=>valueType(x,signature.parameterSignatures?.[i],depth+1)),returns:valueType(signature.returnType,signature.returnSignature,depth+1)};
}
export const functionType=fn=>({parameters:fn.parameters.map(p=>valueType(p.type,p.signature)),returns:valueType(fn.returnType,fn.returnSignature)});
export const expressionType=v=>valueType(v.type,['call','indirectCall'].includes(v.kind)?v.signature?.returnSignature:v.signature);
export const typeId=type=>typeof type==='string'?scalarTypeIds[type]:sha256('tsfg.module-callable-type.candidate.v1\0'+canonical(type));
export const signatureId=type=>sha256('tsfg.module-callable-signature.candidate.v1\0'+canonical(type));
export const functionId=(path,name,type)=>sha256('tsfg.module-callable-function.candidate.v1\0'+canonical({path,name,signatureHash:signatureId(type)}));
export function meter(fail=failure) {
  let work=0,members=0;
  return {step(){if(++work>1000000)fail('limit');},member(){if(++members>65536)fail('limit');}};
}
