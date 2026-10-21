// SPDX-License-Identifier: MIT
// Bounded owned facts from the selected official producer. Self-consistency is
// distinct from Source admission; the caller pins the actual producer package.
import {canonical,own,sha256} from './identity.mjs';
import {copyGenericJsonBytes,readGenericJson,checkGenericJsonValueBudget} from './generic-json.mjs';
import {typedArrayFactsFormat as format,typedArrayJsonPolicy as policy,
  typedArrayFailure,check,checkTypedArrayShape,logicalPath,byteOrder} from './typed-array-schema.mjs';
import {validateTypedArrayTypes,validateTypedArrayDeclarations} from './typed-array-types.mjs';
import {validateTypedArrayFunctions} from './typed-array-body.mjs';
export {typedArrayFactsFormat} from './typed-array-schema.mjs';

function verify(value) {
  checkGenericJsonValueBudget(value,{...policy,bytes:policy.bytes-1});
  checkTypedArrayShape(value);
  check(value.family===format.family&&value.version===format.version&&value.schemaHash===format.schemaHash,'identity');
  const payload=value.payload;
  logicalPath(payload.sourceRoot);logicalPath(payload.rootFile);
  check(payload.rootFile.startsWith(payload.sourceRoot+'/')&&payload.rootFile.endsWith('.ts')
    &&!payload.rootFile.endsWith('.d.ts')&&payload.positionUnit==='utf16','source');
  check(canonical(payload.config)===canonical({strict:true,noEmit:true,allowJs:false})&&payload.diagnostics.length===0,'config');
  const declarations=payload.sourceRoot+'/minimal-arrays-v8.d.ts';
  check(payload.declarations.version==='minimal-arrays-v8'
    &&canonical(payload.declarations.paths)===canonical([declarations]),'declaration');
  const sources=new Map();let sourceBytes=0;
  check(payload.files.length>=2&&payload.files.length<=64,'limit');
  for(const file of payload.files) {
    logicalPath(file.path);check(file.path.startsWith(payload.sourceRoot+'/')&&file.path.endsWith('.ts'),'source');
    check(!sources.has(file.path)&&(!sources.size||byteOrder([...sources.keys()].at(-1),file.path)<0),'source');
    check(file.byteLength===Buffer.byteLength(file.content,'utf8')&&file.utf16Length===file.content.length
      &&file.sha256===sha256(file.content).slice(7),'identity');
    sourceBytes+=file.byteLength;check(sourceBytes<=1048576,'limit');sources.set(file.path,file);
  }
  check(sources.has(payload.rootFile)&&sources.get(declarations)?.sha256===
    '0d30a2f626bb7455decf36f5a7a8d3308d4254100d2cb10e7c0d2353d28b141e','declaration');
  const types=validateTypedArrayTypes(payload,sources);
  validateTypedArrayDeclarations(payload,sources);validateTypedArrayFunctions(payload,sources,types);
  const request={family:'tsfg.array-facts-request-candidate',version:8,input:{
    sourceRoot:payload.sourceRoot,rootFile:payload.rootFile,
    files:payload.files.map(({path,content,sha256})=>({path,content,sha256})),
    declarations:payload.declarations,config:payload.config}};
  check(value.requestId===sha256('tsfg.array-facts.request.v8\0'+canonical(request)+'\n')
    &&value.packageId===sha256('tsfg.array-facts.package.v8\0'+format.schemaHash+'\0'+canonical(payload)),'identity');
  return value;
}
function mapped(error) {
  if(error?.code?.startsWith('r03-typed-array-'))throw error;
  typedArrayFailure(error?.code?.endsWith('-limit')?'limit':'input',undefined,error);
}
export function readTypedArrayFacts(bytes) {
  try {
    const input=readGenericJson(copyGenericJsonBytes(bytes,policy),policy);
    const value=verify(input.value);check(input.text===canonical(value)+'\n','canonical');return own(value);
  }catch(error){mapped(error);}
}
export function writeTypedArrayFacts(input) {
  try {return Buffer.from(canonical(verify(input))+'\n');}catch(error){mapped(error);}
}
