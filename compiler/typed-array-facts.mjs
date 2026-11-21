// SPDX-License-Identifier: MIT
// Bounded owned facts from the selected official producer. Self-consistency is
// distinct from Source admission; the caller pins the actual producer package.
import {canonical,own,sha256} from './identity.mjs';
import {copyGenericJsonBytes,readGenericJson,checkGenericJsonValueBudget} from './generic-json.mjs';
import {typedArrayFactsFormat as format,typedArrayJsonPolicy as policy,
  typedArrayFailure,check,checkTypedArrayShape,logicalPath,byteOrder} from './typed-array-schema.mjs';
import {validateTypedArrayTypes,validateTypedArrayDeclarations} from './typed-array-types.mjs';
import {validateTypedArrayFunctions} from './typed-array-body.mjs';
import {validateTypedArrayDensity} from './typed-array-density.mjs';
import stringLengthDescriptor from '../contracts/array-generic-facts-v9.schema.json' with {type:'json'};
import stringSliceDescriptor from '../contracts/array-generic-facts-v10.schema.json' with {type:'json'};
import stringIndexDescriptor from '../contracts/array-generic-facts-v11.schema.json' with {type:'json'};
export {typedArrayFactsFormat} from './typed-array-schema.mjs';

export const typedArrayFactsV9Format=own({family:format.family,version:9,
  schemaHash:sha256(canonical(stringLengthDescriptor)+'\n')});
const typedArrayV9={descriptor:stringLengthDescriptor,factsFormat:typedArrayFactsV9Format,
  requestDomain:'tsfg.array-facts.request.v9',packageDomain:'tsfg.array-facts.package.v9',
  declarationVersion:'minimal-arrays-v9',declarationHash:'03f2ae31cd79b01e468c519f429d7f50a95aafae5c35cbb7053d7a58483ea480'};
export const typedArrayFactsV10Format=own({family:format.family,version:10,
  schemaHash:sha256(canonical(stringSliceDescriptor)+'\n')});
const typedArrayV10={descriptor:stringSliceDescriptor,factsFormat:typedArrayFactsV10Format,
  requestDomain:'tsfg.array-facts.request.v10',packageDomain:'tsfg.array-facts.package.v10',
  declarationVersion:'minimal-arrays-v10',declarationHash:'6dbd7df35f5325c57a0cad4fba8230a7484346fd9003cca01580f381cb2dee14'};
export const typedArrayFactsV11Format=own({family:format.family,version:11,
  schemaHash:sha256(canonical(stringIndexDescriptor)+'\n')});
const typedArrayV11={descriptor:stringIndexDescriptor,factsFormat:typedArrayFactsV11Format,
  requestDomain:'tsfg.array-facts.request.v11',packageDomain:'tsfg.array-facts.package.v11',
  declarationVersion:'minimal-arrays-v11',declarationHash:'cc7f7430abdc075dda7cfa96d4331dcfdd35781a8762256a0ab3ce250af765b5'};
const arrayProfiles={9:typedArrayV9,10:typedArrayV10,11:typedArrayV11};
function arrayProfile(version) {
  check([8,9,10,11].includes(version),'context');
  return arrayProfiles[version];
}

function verify(value,profile=undefined) {
  checkGenericJsonValueBudget(value,{...policy,bytes:policy.bytes-1});
  checkTypedArrayShape(value,'arrayGenericPackage',false,profile?.descriptor);
  const selected=profile?.factsFormat??format;
  check(value.family===selected.family&&value.version===selected.version&&value.schemaHash===selected.schemaHash,'identity');
  const payload=value.payload;
  logicalPath(payload.sourceRoot);logicalPath(payload.rootFile);
  check(payload.rootFile.startsWith(payload.sourceRoot+'/')&&payload.rootFile.endsWith('.ts')
    &&!payload.rootFile.endsWith('.d.ts')&&payload.positionUnit==='utf16','source');
  check(canonical(payload.config)===canonical({strict:true,noEmit:true,allowJs:false})&&payload.diagnostics.length===0,'config');
  const declarationVersion=profile?.declarationVersion??'minimal-arrays-v8';
  const declarations=payload.sourceRoot+'/'+declarationVersion+'.d.ts';
  check(payload.declarations.version===declarationVersion
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
  const declarationHash=profile?.declarationHash??'0d30a2f626bb7455decf36f5a7a8d3308d4254100d2cb10e7c0d2353d28b141e';
  check(sources.has(payload.rootFile)&&sources.get(declarations)?.sha256===declarationHash,'declaration');
  const types=validateTypedArrayTypes(payload,sources,declarations);
  const validation=profile?.createValidation?.();
  if(validation)validation.validateFields(payload,sources,types);
  validateTypedArrayDeclarations(payload,sources,declarations);validateTypedArrayFunctions(payload,sources,types,validation);
  validateTypedArrayDensity(payload);
  const request={family:profile?.requestFamily??'tsfg.array-facts-request-candidate',version:selected.version,input:{
    sourceRoot:payload.sourceRoot,rootFile:payload.rootFile,
    files:payload.files.map(({path,content,sha256})=>({path,content,sha256})),
    declarations:payload.declarations,config:payload.config}};
  check(value.requestId===sha256((profile?.requestDomain??'tsfg.array-facts.request.v8')+'\0'+canonical(request)+'\n')
    &&value.packageId===sha256((profile?.packageDomain??'tsfg.array-facts.package.v8')+'\0'+selected.schemaHash+'\0'+canonical(payload)),'identity');
  return value;
}
function mapped(error) {
  if(error?.code?.startsWith('r03-typed-array-'))throw error;
  typedArrayFailure(error?.code?.endsWith('-limit')?'limit':'input',undefined,error);
}
export function readTypedArrayFacts(bytes,version=8) {
  return readSelectedTypedArrayFacts(bytes,arrayProfile(version));
}
// A selected profile is supplied only by its explicit public boundary; the old
// reader never guesses a profile from untrusted family/version fields.
export function readSelectedTypedArrayFacts(bytes,profile=undefined) {
  try {
    const input=readGenericJson(copyGenericJsonBytes(bytes,policy),policy);
    const value=verify(input.value,profile);check(input.text===canonical(value)+'\n','canonical');return own(value);
  }catch(error){mapped(error);}
}
export function writeTypedArrayFacts(input,version=8) {
  return writeSelectedTypedArrayFacts(input,arrayProfile(version));
}
export function writeSelectedTypedArrayFacts(input,profile=undefined) {
  try {return Buffer.from(canonical(verify(input,profile))+'\n');}catch(error){mapped(error);}
}
