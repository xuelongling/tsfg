// SPDX-License-Identifier: MIT
// Exact v8 logical DTO boundary. This never imports the official checker/AST.
import descriptor from '../contracts/array-generic-facts.schema.json' with {type:'json'};
import {canonical, own, sha256} from './identity.mjs';
export const typedArrayFactsFormat = own({family:'tsfg.array-facts-package-candidate',version:8,
  schemaHash:'sha256:1b108a3524bc8e42d4a28c0a7059991967689bad5d29cbb6e574ec7049a2f197'});
export const typedArrayJsonPolicy = Object.freeze({bytes:2097152,depth:64,jsonTokens:200000,
  stringBytes:1048576,safeNonnegativeIntegers:true,allowNul:true,rejectPrototypeKeys:false});
export function typedArrayFailure(kind, primary = undefined, cause = undefined) {
  throw Object.assign(new TypeError('r03-typed-array-'+kind+': invalid owned generic Array input',{cause}),
    {code:'r03-typed-array-'+kind,ruleId:'r01-input-boundary',phase:'input',...(primary?{primary}:{})});
}
export const check = (condition, kind = 'schema', primary = undefined) => {if(!condition)typedArrayFailure(kind,primary);};
check(sha256(canonical(descriptor)+'\n')===typedArrayFactsFormat.schemaHash,'schema-identity');
export const hash = value => check(typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value),'identity');
export const byteOrder = (a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b));

function kindKeys(value, name) {
  const group = {arrayGenericExpression:'expressionKinds',arrayGenericTarget:'targetKinds',
    arrayGenericStatement:'statementKinds',arrayGenericType:'typeKinds'}[name];
  if(!group)return;
  const specific=descriptor[group][value.kind];
  check(Array.isArray(specific),'kind');
  check(specific.every(key=>Object.hasOwn(value,key)),'schema');
  const optional = name==='arrayGenericExpression'
    ? value.kind==='numericLiteral'?['decimal','bits']:value.kind==='call'?['receiver']:value.kind==='stringConcat'?['operator']:[]
    : name==='arrayGenericType'&&['value','reference'].includes(value.kind)?['markerOrigin','base','methods']
    : name==='arrayGenericStatement'&&value.kind==='return'?['value']:[];
  if(name==='arrayGenericExpression')optional.push('compatibilityRoots');
  const base=descriptor.objects[name].required;
  check(Object.keys(value).every(key=>base.includes(key)||specific.includes(key)||optional.includes(key)),'schema');
}

/** Field tables are hashed with the protocol: unknown keys cannot disappear in projection. */
export function checkTypedArrayShape(value, name='arrayGenericPackage', nullable=false) {
  if(nullable&&value===null)return;
  if(name.startsWith('*'))return checkTypedArrayShape(value,name.slice(1),true);
  if(name.startsWith('[]')) {
    check(Array.isArray(value),'schema');
    for(const item of value)checkTypedArrayShape(item,name.slice(2));
    return;
  }
  if(name==='string'){check(typeof value==='string'&&value.isWellFormed(),'schema');return;}
  if(name==='bool'){check(typeof value==='boolean','schema');return;}
  if(name==='int'||name==='int32') {
    check(Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=0&&(name!=='int32'||value<=2147483647),'schema');return;
  }
  const object=descriptor.objects[name];check(object,'schema');
  check(value&&typeof value==='object'&&!Array.isArray(value),'schema');
  check(object.required.every(key=>Object.hasOwn(value,key))
    &&Object.keys(value).every(key=>Object.hasOwn(object.properties,key)),'schema');
  kindKeys(value,name);
  for(const [key,child] of Object.entries(value)) {
    check(child!==null||object.required.includes(key),'schema');
    checkTypedArrayShape(child,object.properties[key]);
  }
}

export function logicalPath(value) {
  check(typeof value==='string'&&value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')
    &&value.slice(1).split('/').every(part=>part&&part!=='.'&&part!=='..'),'source');return value;
}
export function sourceRange(span,source,parent=undefined) {
  const bounds=parent??{start:0,end:source.length};
  const boundary=index=>!(source.charCodeAt(index)>=0xdc00&&source.charCodeAt(index)<=0xdfff
    &&source.charCodeAt(index-1)>=0xd800&&source.charCodeAt(index-1)<=0xdbff);
  check(span&&Number.isSafeInteger(span.start)&&Number.isSafeInteger(span.end)&&span.start>=bounds.start
    &&span.start<span.end&&span.end<=bounds.end&&boundary(span.start)&&boundary(span.end),'source');
  return span;
}
export const originId=(sourcePath,nameRange)=>sha256('tsfg.array-facts.binding.v1\0'+canonical({sourcePath,nameRange}));
export const signatureId=(sourcePath,declarationRange)=>sha256('tsfg.array-facts.signature.v8\0'+canonical({sourcePath,declarationRange}));
