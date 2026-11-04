// SPDX-License-Identifier: MIT
// Private descriptor/schema literals only. No Compiler/Source producer,
// publication admission, packet, Runtime JSON reader, Actual or VM is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>JSON.parse(readFileSync(new URL('../../contracts/'+name,import.meta.url),'utf8'));
const core=read('common-program-core-development.json'),wire=read('common-program-bytecode-development.schema.json'),binding=read('common-program-wire-development.json');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const hash=value=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
const abi=wire.tables.find(row=>row.name==='abis').schema.anyOf.find(row=>row.items?.properties?.kind?.const==='common').items;
const fixed=wire.tables.find(row=>row.name==='authority').schema.anyOf.find(row=>row.properties?.fixedPublication?.properties?.stableScope).properties.fixedPublication;
const scopeRow=fixed.properties.stableScope.properties.functions.items;
// Independent small schema evaluator for these literal records. It exercises
// actual required/nullable schema rules, not production parser implementation.
function accepts(schema,value){
  if(schema.anyOf&&!schema.anyOf.some(branch=>accepts(branch,value)))return false;
  if(schema.allOf&&!schema.allOf.every(branch=>accepts(branch,value)))return false;
  if(schema.if&&!accepts(accepts(schema.if,value)?schema.then??{}:schema.else??{},value))return false;
  if(Object.hasOwn(schema,'const')&&JSON.stringify(schema.const)!==JSON.stringify(value))return false;
  if(schema.enum&&!schema.enum.some(item=>JSON.stringify(item)===JSON.stringify(value)))return false;
  if(schema.type==='null'&&value!==null||schema.type==='integer'&&!Number.isSafeInteger(value)||schema.type==='string'&&typeof value!=='string'||schema.type==='boolean'&&typeof value!=='boolean'||schema.type==='array'&&!Array.isArray(value)||schema.type==='object'&&(!value||typeof value!=='object'||Array.isArray(value)))return false;
  if(typeof value==='number'&&(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))return false;
  if(typeof value==='string'&&(schema.minLength!==undefined&&value.length<schema.minLength||schema.maxLength!==undefined&&value.length>schema.maxLength||schema.pattern&&!new RegExp(schema.pattern,'u').test(value)))return false;
  if(Array.isArray(value)&&(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems||schema.items&&!value.every(item=>accepts(schema.items,item))))return false;
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    if(schema.required?.some(name=>!Object.hasOwn(value,name)))return false;
    if(schema.additionalProperties===false&&Object.keys(value).some(name=>!Object.hasOwn(schema.properties??{},name)))return false;
    if(schema.properties&&Object.entries(schema.properties).some(([name,child])=>Object.hasOwn(value,name)&&!accepts(child,value[name])))return false;
  }
  return true;
}
const id='sha256:'+'0'.repeat(64);
const ordinaryAbi={kind:'common',function:0,signature:id,parameters:[],argumentTypes:[],methodMinimumArgumentCount:null,ordinaryMinimumArgumentCount:null,
  receiver:null,construction:null,receiverFrame:null,lexicalEnvironment:null,physicalParameters:[],result:null,resultCarrier:null,sourcePlan:{carriers:[],blocks:[{parameters:[],operations:[]}]}};
const ordinaryScope={functionId:id,signatureHash:id,kind:'source',declKey:{sourcePath:'/literal-ordinary-contract.ts',path:[],kind:'function',name:'consume'},access:'public',
  lexicalParent:null,lexicalEnvironment:null,activationEnvironment:null,captures:[],parameterTypes:[],methodMinimumArgumentCount:null,ordinaryParameterInitialization:null,returnType:id,construction:null};
test('Core7/Common20/pub6/fixed6 have one exact descriptor identity and preserve Graph5',()=>{
  assert.equal(core.version,7);assert.equal(core.publication.version,6);assert.equal(wire.header.find(row=>row[0]==='version')[1],'u32:20');assert.equal(wire.capabilities.exact,1020);
  assert.equal(binding.privateCore.version,7);assert.equal(binding.wire.version,20);assert.equal(binding.wire.capability,1020);
  assert.equal(hash(core),"sha256:0d27cadc89ca5f59d0f6c721a81d6f9c42c74bfab597986c4627dfd9c823cd59");assert.equal(hash(wire),"sha256:08b3b4b43f12a7b7a86fe89ebe0c16b1d0a5585bdcac6569f00cabd5fed4c775");assert.equal(binding.privateCore.schemaHash,hash(core));assert.equal(binding.wire.schemaHash,hash(wire));
  assert.equal(fixed.properties.publication.properties.format.properties.version.const,6);
  assert.equal(fixed.properties.stableScope.properties.profile.const,'common-program-fixed-v6');
  assert.match(core.publication.returnOrigins.format,/version5$/u);
});
test('ABI requires an explicit nullable ordinary minimum independently of method minimum',()=>{
  assert(accepts(abi,ordinaryAbi));
  const missing={...ordinaryAbi};delete missing.ordinaryMinimumArgumentCount;assert(!accepts(abi,missing));
  for(const minimum of [-1,65,1.5,'0',false])assert(!accepts(abi,{...ordinaryAbi,ordinaryMinimumArgumentCount:minimum}));
  assert(!accepts(abi,{...ordinaryAbi,ordinaryMinimumArgumentCount:0}));
  assert(accepts(abi,{...ordinaryAbi,ordinaryMinimumArgumentCount:0,parameters:[0],argumentTypes:[0],physicalParameters:[{kind:4,ref:0}],sourcePlan:{carriers:['payload'],blocks:[{parameters:[0],operations:[]}]}}));
});
test('both fixed copies require full nullable incoming and minimum metadata',()=>{
  assert.deepEqual(scopeRow,fixed.properties.publication.properties.scope.properties.functions.items);
  assert(accepts(scopeRow,ordinaryScope));
  const missing={...ordinaryScope};delete missing.ordinaryParameterInitialization;assert(!accepts(scopeRow,missing));
  const inputs={minimumArgumentCount:0,argumentTypes:[id]},fdiScope={...ordinaryScope,parameterTypes:[id]};assert(accepts(scopeRow,{...fdiScope,ordinaryParameterInitialization:inputs}));
  assert(!accepts(scopeRow,{...ordinaryScope,ordinaryParameterInitialization:{minimumArgumentCount:0,argumentTypes:[]}}));
  for(const invalid of [{argumentTypes:[]},{minimumArgumentCount:0},{...inputs,minimumArgumentCount:65},{...inputs,extra:true},{...inputs,argumentTypes:[0]}])
    assert(!accepts(scopeRow,{...fdiScope,ordinaryParameterInitialization:invalid}));
  for(const kind of ['method','construction-body'])assert(!accepts(scopeRow,{...fdiScope,kind,ordinaryParameterInitialization:inputs}));
  for(const field of ['lexicalParent','lexicalEnvironment'])assert(!accepts(scopeRow,{...fdiScope,[field]:id,ordinaryParameterInitialization:inputs}));
  const method={...ordinaryScope,kind:'method',declKey:{...ordinaryScope.declKey,kind:'method'},parameterTypes:[id],methodMinimumArgumentCount:0};
  assert(accepts(scopeRow,method));
  assert(!accepts(scopeRow,{...method,ordinaryParameterInitialization:{minimumArgumentCount:0,argumentTypes:[id]}}));
});
