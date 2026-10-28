// SPDX-License-Identifier: MIT
// Data ownership only. The supplied standard batch is from the independent
// production Core verifier; this module never parses or evaluates MLIR text.
import descriptor from '../contracts/query-tmeta-development.json' with {type:'json'};
import layoutDescriptor from '../contracts/component-layout-development.json' with {type:'json'};
import {canonical,sha256,own} from './identity.mjs';
import {readGenericJson,copyGenericJsonBytes} from './generic-json.mjs';
import {printSystemQueryFacts} from './system-query-facts.mjs';
import {readSystemQueryEffects} from './system-query-effects.mjs';
import {commonSemanticIdentities,commonFieldId} from './common-program-identities.mjs';

export const queryTmetaSchema=sha256(canonical(descriptor));
const policy={...descriptor.limits,allowNul:true,rejectPrototypeKeys:true,safeNonnegativeIntegers:true};
/** @typedef {Readonly<{index:number,componentType:string,sourceComponentType:string,access:'read'|'write',alignment:number,stride:number,bufferArgument:number,strideArgument:number}>} QueryTmetaColumn */
/** @typedef {Readonly<{tupleIndex:number,sourceBinding:string,componentType:string,mode:'read'|'write',columnIndex:number,bufferArgument:number}>} QueryTmetaTuple */
/** @typedef {Readonly<{argument:number,sourceBinding:string,sourceParameter:number,type:'f32'}>} QueryTmetaScalar */
/** @typedef {Readonly<{abiType:string,columns:readonly QueryTmetaColumn[],entrySymbol:string,logicalFunctionId:string,loop:number,queryBinding:string,rowCountArgument:0,scalars:readonly QueryTmetaScalar[],signatureHash:string,source:import('./system-query-effects.mjs').QueryEffectSource,sourceFunctionId:string,tupleOccurrences:readonly QueryTmetaTuple[]}>} QueryTmetaEntry */
/** @typedef {Readonly<{batch:string,batchHash:string,componentLayouts:string,effects:string,effectsHash:string,entries:readonly QueryTmetaEntry[],functionIdentityDomain:string,inputIdentity:string,layoutHash:string,packageId:string,sourcePacket:string,sourceRequest:string,target:import('./system-query-facts.mjs').SystemQueryFacts['program']['target']}>} QueryTmetaPayload */
/** @typedef {Readonly<{family:'tsfg.query-tmeta',version:1,schemaHash:string,payload:string,payloadHash:string}>} QueryTmetaEnvelope */
/** @typedef {Readonly<{envelope:QueryTmetaEnvelope,payload:QueryTmetaPayload,effects:import('./system-query-effects.mjs').SystemQueryEffects}>} SystemQueryTmeta */
/** @typedef {{id:string,kind:string,name:string,base?:string,sourcePath?:string,declarationRange?:{start:number,end:number},nominalKey?:{category:string},fields?:{name:string,type:string,readonly:boolean,origin:{source:string,start:number,end:number}}[]}} LayoutSourceType */
/** @returns {never} */
function fail(detail){throw new TypeError('r10-query-tmeta: '+detail);}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail('exact metadata record required');
  return /** @type {Record<string,unknown>} */(value);
}
/** @param {unknown} value @returns {string} */
function text(value){if(typeof value!=='string')fail('metadata string required');return value;}
/** @param {unknown} value @returns {number} */
function integer(value){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||Object.is(value,-0))fail('metadata integer required');return value;}
/** @param {unknown} value @returns {unknown[]} */
function array(value){if(!Array.isArray(value))fail('metadata array required');return value;}
/** @param {unknown} a @param {unknown} b */
function equal(a,b){if(canonical(a)!==canonical(b))fail('Source/batch/ABI binding differs');}
/** @param {string} value */
function json(value){const parsed=readGenericJson(copyGenericJsonBytes(Buffer.from(value),policy),policy);if(parsed.text!==canonical(parsed.value)+'\n')fail('canonical metadata required');return parsed.value;}

/** Read canonical .tmeta against complete owned Source and the independently
 * verified standard batch from the same production Core consumer.
 * @param {Uint8Array} bytes @param {import('./system-query-facts.mjs').SystemQueryFacts} facts
 * @param {unknown} context @param {string} checkedBatch @returns {SystemQueryTmeta}
 */
export function readSystemQueryTmeta(bytes,facts,context,checkedBatch){
  const original=printSystemQueryFacts(facts,context).toString('utf8');
  const transport=readGenericJson(copyGenericJsonBytes(bytes,policy),policy);
  if(transport.text!==canonical(transport.value)+'\n')fail('canonical metadata required');
  const envelope=record(transport.value,descriptor.envelope);
  equal([envelope.family,envelope.version,envelope.schemaHash],['tsfg.query-tmeta',1,queryTmetaSchema]);
  const body=text(envelope.payload);equal(envelope.payloadHash,sha256('tsfg.query-tmeta.v1\0'+body));
  const payload=record(json(body+'\n'),descriptor.payload),packet=text(payload.sourcePacket),request=text(payload.sourceRequest),batch=text(payload.batch);
  const sourceContext=/** @type {{requestBytes:Uint8Array}} */(context);
  equal([packet,request,batch],[canonical(JSON.parse(original))+'\n',Buffer.from(sourceContext.requestBytes).toString('utf8'),checkedBatch]);
  equal([payload.inputIdentity,payload.packageId,payload.target,payload.functionIdentityDomain],
    [facts.inputIdentity,facts.packageId,facts.program.target,descriptor.functionIdentityDomain]);
  const componentLayouts=text(payload.componentLayouts),effectText=text(payload.effects);
  equal([payload.batchHash,payload.layoutHash,payload.effectsHash],[sha256(batch),sha256(componentLayouts),sha256(effectText)]);
  const effects=readSystemQueryEffects(Buffer.from(effectText),facts,context);
  const layoutEnvelope=record(json(componentLayouts),layoutDescriptor.envelope);
  equal([layoutEnvelope.family,layoutEnvelope.version,layoutEnvelope.schemaHash],[layoutDescriptor.family,1,sha256(canonical(layoutDescriptor))]);
  const layoutBody=text(layoutEnvelope.payload);equal(layoutEnvelope.payloadHash,sha256('tsfg.component-layout.v1\0'+layoutBody));
  const layouts=record(json(layoutBody+'\n'),layoutDescriptor.payload),catalog={components:layouts.components,target:layouts.target,types:layouts.types};
  equal([layouts.hirDigest,layouts.inputIdentity,layouts.target],[sha256(canonical(catalog)+'\n'),facts.inputIdentity,facts.program.target]);
  // The Source receipt already owns this DTO. Reuse its semantic IDs and field
  // provenance; sizes/offsets remain the official independent DataLayout result.
  const source=/** @type {{payload:{types:LayoutSourceType[],functions:unknown[]}}} */(JSON.parse(original));
  let work=0;const spend=()=>{if(++work>descriptor.limits.work)fail('metadata work exceeded');};
  const ids=commonSemanticIdentities({...source.payload,globals:[]},spend),types=new Map(source.payload.types.map(type=>[type.id,type]));
  /** @type {Map<string,{type:LayoutSourceType,fields:{id:string,name:string,type:string,readonly:boolean,sourcePath:string,range:{start:number,end:number}}[]}>} */
  const expected=new Map();
  function visit(id,depth=0){
    spend();if(depth>=32)fail('fixed type depth exceeded');const type=types.get(id),semantic=ids.typeIds.get(id);if(expected.has(semantic))return;
    const chain=[];let current=type;while(current){spend();if(chain.length>=32)fail('inheritance depth exceeded');chain.unshift(current);current=types.get(current.base);}
    const fields=chain.flatMap(owner=>(owner.fields??[]).map((field,index)=>({id:commonFieldId(ids.typeIds.get(owner.id),field.name,index),name:field.name,type:ids.typeIds.get(field.type),readonly:field.readonly,sourcePath:field.origin.source,range:{start:field.origin.start,end:field.origin.end}})));
    expected.set(semantic,{type,fields});for(const owner of chain)for(const field of owner.fields??[])visit(field.type,depth+1);
  }
  const components=facts.components.map(component=>component.typeId).sort();equal(layouts.components,components);
  facts.components.forEach(component=>visit(component.sourceType));const ordered=[...expected.keys()].sort(),rows=array(layouts.types);
  if(rows.length!==ordered.length)fail('complete fixed layout inventory differs');
  const fixed=new Map(rows.map((value,index)=>{
    spend();const row=record(value,layoutDescriptor.typeRecord),id=text(row.id),shape=expected.get(id);if(!shape||id!==ordered[index])fail('layout type ordering differs');
    const {type,fields}=shape,scalar=type.kind==='scalar';equal([row.kind,row.name,row.scalar,row.sourcePath,row.range],
      [scalar?'scalar':type.nominalKey?.category==='component'?'component':'value',type.name,scalar?type.name:'',scalar?'':type.sourcePath,scalar?{start:0,end:0}:type.declarationRange]);
    const alignment=integer(row.alignment),stride=integer(row.stride),size=integer(row.byteSize);
    if(!alignment||alignment>65536||(alignment&(alignment-1))||size>65536||size%alignment||stride!==size)fail('layout extent differs');
    const members=array(row.fields);if(members.length!==fields.length)fail('layout field inventory differs');
    members.forEach((value,index)=>{const row=record(value,layoutDescriptor.fieldRecord),{offset,...semantic}=row;equal(semantic,fields[index]);if(integer(offset)>size)fail('layout field offset differs');});
    return [id,{alignment,stride}];
  }));
  const actual=array(payload.entries),entries=[];let cursor=0;
  for(const system of facts.systems){
    const effect=effects.systems.find(row=>row.sourceFunctionId===system.declaration.id);
    for(const loop of effect.loops){
      spend();const row=record(actual[cursor++],descriptor.entry),columns=loop.capabilities.map((cap,index)=>{
        const layout=fixed.get(cap.componentType);return {index,componentType:cap.componentType,sourceComponentType:cap.sourceComponentType,access:cap.mode,
          alignment:layout.alignment,stride:layout.stride,bufferArgument:1+index*2,strideArgument:2+index*2};
      });
      const tuples=loop.columns.map(tuple=>{const column=columns.find(column=>column.componentType===tuple.componentType);return {tupleIndex:tuple.tupleIndex,sourceBinding:tuple.sourceBinding,componentType:tuple.componentType,mode:tuple.mode,columnIndex:column.index,bufferArgument:column.bufferArgument};});
      const scalars=system.parameters.filter(parameter=>!parameter.query).map((parameter,index)=>({argument:1+columns.length*2+index,sourceBinding:parameter.binding.id,sourceParameter:parameter.index,type:/** @type {'f32'} */('f32')}));
      const entry={abiType:'('+['index',...columns.flatMap(()=>['memref<?xi8>','index']),...scalars.map(()=>'f32')].join(', ')+') -> ()',columns,
        entrySymbol:'batch_'+effect.functionId.slice(7)+'_'+loop.index,logicalFunctionId:effect.functionId,loop:loop.index,queryBinding:loop.queryBinding,
        rowCountArgument:/** @type {0} */(0),scalars,signatureHash:effect.signatureHash,source:loop.source,sourceFunctionId:system.declaration.id,tupleOccurrences:tuples};
      equal(row,entry);entries.push(entry);
    }
  }
  if(cursor!==actual.length||cursor>descriptor.limits.entries)fail('complete entry inventory differs');
  const result={envelope:{family:/** @type {'tsfg.query-tmeta'} */('tsfg.query-tmeta'),version:/** @type {1} */(1),schemaHash:queryTmetaSchema,payload:body,payloadHash:text(envelope.payloadHash)},
    payload:{batch,batchHash:sha256(batch),componentLayouts,effects:effectText,effectsHash:sha256(effectText),entries,functionIdentityDomain:descriptor.functionIdentityDomain,
      inputIdentity:facts.inputIdentity,layoutHash:sha256(componentLayouts),packageId:facts.packageId,sourcePacket:packet,sourceRequest:request,target:facts.program.target},effects};
  return own(result);
}
