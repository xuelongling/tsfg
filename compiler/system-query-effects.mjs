// SPDX-License-Identifier: MIT
// The versioned output boundary of the independent verified Core analysis.
import {readGenericJson,copyGenericJsonBytes,genericPackageJsonPolicy} from './generic-json.mjs';
import {canonical,own} from './identity.mjs';
import {functionId,signatureId} from './module-callable-common.mjs';
import {printSystemQueryFacts} from './system-query-facts.mjs';
import {systemQueryTypeId} from './system-query-core.mjs';

/** @typedef {Readonly<{path:string,start:number,end:number}>} QueryEffectSource */
/** @typedef {Readonly<{componentType:string,sourceComponentType:string,mode:'read'|'write'}>} QueryCapability */
/** @typedef {Readonly<{componentType:string,field:string,sourceField:string,readCount:number,writeCount:number}>} QueryFieldEffects */
/** @typedef {Readonly<{kind:'read'|'write',componentType:string,field:string,sourceField:string,tupleIndex:number,sourceBinding:string,source:QueryEffectSource}>} QueryFieldOperation */
/** @typedef {Readonly<{tupleIndex:number,sourceBinding:string,componentType:string,sourceComponentType:string,mode:'read'|'write',source:QueryEffectSource}>} QueryEffectColumn */
/** @typedef {Readonly<{index:number,selectionId:string,queryBinding:string,source:QueryEffectSource,columns:readonly QueryEffectColumn[],capabilities:readonly QueryCapability[],fieldEffects:readonly QueryFieldEffects[],operations:readonly QueryFieldOperation[]}>} QueryLoopEffects */
/** @typedef {Readonly<{functionId:string,sourceFunctionId:string,signatureHash:string,source:QueryEffectSource,capabilities:readonly QueryCapability[],fieldEffects:readonly QueryFieldEffects[],loops:readonly QueryLoopEffects[]}>} QuerySystemEffects */
/** @typedef {Readonly<{left:string,right:string,components:readonly string[]}>} QueryConflict */
/** @typedef {Readonly<{family:'tsfg.system-query-effects-candidate',version:1,queryVersion:1,coreVersion:'0.12.0',inputIdentity:string,packageId:string,target:Readonly<{target:string,triple:string,llvmDataLayout:string,pointerBits:string}>,source:Readonly<{path:string,sha256:string,utf16Length:number}>,systems:readonly QuerySystemEffects[],conflicts:readonly QueryConflict[]}>} SystemQueryEffects */

/** @returns {never} */
function fail(detail){throw new TypeError('r10-query-effects-input: '+detail);}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail('exact record required');
  return /** @type {Record<string,unknown>} */(value);
}
/** @param {unknown} value @returns {unknown[]} */
function array(value){if(!Array.isArray(value))fail('array required');return value;}
/** @param {unknown} value @returns {string} */
function hash(value){if(typeof value!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value))fail('identity required');return value;}
/** @param {unknown} value @returns {number} */
function integer(value){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||Object.is(value,-0))fail('unsigned integer required');return value;}
function equal(left,right){if(canonical(left)!==canonical(right))fail('identity or normalized analysis differs');}

/** Read actual C++ analysis output against its opaque checked Source receipt.
 * This validates the output protocol and relationships, not Source execution.
 * @param {Uint8Array} bytes
 * @param {import('./system-query-facts.mjs').SystemQueryFacts} facts
 * @param {unknown} context
 * @returns {SystemQueryEffects}
 */
export function readSystemQueryEffects(bytes,facts,context){
  printSystemQueryFacts(facts,context);
  const transport=readGenericJson(copyGenericJsonBytes(bytes,genericPackageJsonPolicy),genericPackageJsonPolicy);
  const root=record(transport.value,['family','version','queryVersion','coreVersion','inputIdentity','packageId','target','source','systems','conflicts']);
  if(root.family!=='tsfg.system-query-effects-candidate'||root.version!==1||root.queryVersion!==1||root.coreVersion!=='0.12.0')fail('analysis format differs');
  equal([root.inputIdentity,root.packageId,root.target],[facts.inputIdentity,facts.packageId,facts.program.target]);
  const primary=facts.program.files.find(row=>row.path===facts.program.rootFile);
  const sourceIdentity={path:primary.path,sha256:'sha256:'+primary.sha256,utf16Length:primary.utf16Length};equal(root.source,sourceIdentity);
  const sourceComponents=new Map(facts.components.map(row=>[row.typeId,row.sourceType]));
  const sources=new Map(facts.program.files.map(row=>[row.path,row.utf16Length]));let remaining=1000000;
  const spend=()=>{if(--remaining<0)fail('analysis work exceeded');};
  /** @param {unknown} value @param {QueryEffectSource|null} [bounds] @returns {QueryEffectSource} */
  const source=(value,bounds=null)=>{
    const row=record(value,['path','start','end']);if(typeof row.path!=='string'||!sources.has(row.path))fail('source path differs');
    const start=integer(row.start),end=integer(row.end);if(start>=end||end>sources.get(row.path))fail('source range differs');
    if(bounds&&(row.path!==bounds.path||start<bounds.start||end>bounds.end))fail('source range outside owner');
    return {path:row.path,start,end};
  };
  /** @param {readonly QueryCapability[]} rows @returns {QueryCapability[]} */
  const normalize=rows=>[...rows.reduce((map,row)=>{
    const previous=map.get(row.componentType);if(!previous||row.mode==='write')map.set(row.componentType,row);return map;
  },new Map(/** @type {[string,QueryCapability][]} */([]))).values()].sort((a,b)=>a.componentType<b.componentType?-1:1);
  /** @param {unknown} value @returns {QueryCapability[]} */
  const caps=value=>{
    let previous='';return array(value).map(value=>{
      spend();const row=record(value,['componentType','sourceComponentType','mode']),componentType=hash(row.componentType);
      const sourceComponentType=sourceComponents.get(componentType);
      if(componentType<=previous||!sourceComponentType||sourceComponentType!==row.sourceComponentType||(row.mode!=='read'&&row.mode!=='write'))fail('normalized component capability differs');
      previous=componentType;return {componentType,sourceComponentType,mode:row.mode};
    });
  };
  /** @param {unknown} value @returns {QueryFieldEffects[]} */
  const fieldRows=value=>{
    let previous='';return array(value).map(value=>{
      spend();const row=record(value,['componentType','field','sourceField','readCount','writeCount']);
      const componentType=hash(row.componentType),field=hash(row.field),sourceField=hash(row.sourceField),readCount=integer(row.readCount),writeCount=integer(row.writeCount);
      const key=componentType+'\0'+field+'\0'+sourceField;
      if(key<=previous||!sourceComponents.has(componentType)||readCount+writeCount===0)fail('normalized field effects differ');
      previous=key;return {componentType,field,sourceField,readCount,writeCount};
    });
  };
  /** @param {readonly QueryFieldOperation[]} operations @returns {QueryFieldEffects[]} */
  const countFields=operations=>{
    const map=new Map(/** @type {[string,{componentType:string,field:string,sourceField:string,readCount:number,writeCount:number}][]} */([]));for(const operation of operations){spend();const {componentType,field,sourceField}=operation,key=componentType+'\0'+field+'\0'+sourceField;
      const row=map.get(key)??{componentType,field,sourceField,readCount:0,writeCount:0};row[operation.kind==='read'?'readCount':'writeCount']++;map.set(key,row);}
    return [...map].sort(([a],[b])=>a<b?-1:1).map(([,row])=>row);
  };
  const originalSystems=new Map(facts.systems.map(system=>{
    const signature={parameters:system.parameters.map(parameter=>parameter.query?systemQueryTypeId(parameter.query):parameter.type),returns:system.returnType};
    return [functionId(system.declaration.sourcePath,canonical({path:[],kind:'function',name:system.declaration.name}),signature),{system,signature}];
  }));
  let previousSystem='';
  const systems=array(root.systems).map(value=>{
    spend();const row=record(value,['functionId','sourceFunctionId','signatureHash','source','capabilities','fieldEffects','loops']),id=hash(row.functionId),original=originalSystems.get(id);
    if(id<=previousSystem||!original)fail('system inventory differs');previousSystem=id;
    const {system,signature}=original,owner=source(row.source);
    equal([row.sourceFunctionId,row.signatureHash,owner],[system.declaration.id,signatureId(signature),{path:system.declaration.sourcePath,...system.declaration.range}]);
    const capabilities=caps(row.capabilities);
    equal(capabilities,normalize(system.parameters.flatMap(parameter=>parameter.query?.items.map(item=>({componentType:item.componentType,sourceComponentType:item.sourceComponentType,mode:item.mode}))??[])));
    const loops=array(row.loops).map((value,index)=>{
      spend();const loop=record(value,['index','selectionId','queryBinding','source','columns','capabilities','fieldEffects','operations']),originalLoop=system.loops[index];
      if(loop.index!==index||!originalLoop)fail('loop inventory differs');const owner=source(loop.source);
      const parameter=system.parameters.find(parameter=>parameter.binding.id===originalLoop.queryBinding);
      equal([loop.selectionId,loop.queryBinding,owner],[systemQueryTypeId(parameter.query),originalLoop.queryBinding,{path:system.declaration.sourcePath,...originalLoop.range}]);
      const columns=array(loop.columns).map((value,index)=>{
        spend();const column=record(value,['tupleIndex','sourceBinding','componentType','sourceComponentType','mode','source']),binding=originalLoop.bindings[index];
        if(!binding)fail('column inventory differs');const result={tupleIndex:integer(column.tupleIndex),sourceBinding:hash(column.sourceBinding),componentType:hash(column.componentType),sourceComponentType:column.sourceComponentType,mode:column.mode,source:source(column.source,owner)};
        const expected={tupleIndex:binding.index,sourceBinding:binding.declaration.id,componentType:binding.componentType,sourceComponentType:binding.sourceComponentType,mode:binding.mode,source:{path:system.declaration.sourcePath,...binding.declaration.range}};equal(result,expected);return expected;
      });
      if(columns.length!==originalLoop.bindings.length)fail('missing columns');const capabilities=caps(loop.capabilities);equal(capabilities,normalize(columns.map(({componentType,sourceComponentType,mode})=>({componentType,sourceComponentType,mode}))));
      /** @type {QueryFieldOperation[]} */
      const expectedOperations=[];
      /** @param {'read'|'write'} kind @param {import('./system-query-facts.mjs').SystemQueryLoopExpression} value @param {import('./system-query-facts.mjs').SystemQueryRange} range */
      const memory=(kind,value,range)=>{
        spend();const binding=originalLoop.bindings.find(binding=>binding.declaration.id===value.receiver.binding);
        expectedOperations.push({kind,componentType:binding.componentType,field:value.property,sourceField:value.sourceField,tupleIndex:binding.index,sourceBinding:binding.declaration.id,source:{path:system.declaration.sourcePath,...range}});
      };
      // Project memory descriptors from the already typed expression tree.
      // This does not evaluate values or repeat Source type/binding checking.
      /** @param {import('./system-query-facts.mjs').SystemQueryLoopExpression} value */
      const accesses=value=>{
        spend();if(value.kind==='fieldAccess')memory('read',value,value.range);
        else if(value.kind==='binary'){accesses(value.left);accesses(value.right);}
        else if(value.kind==='fieldAssignment'){
          if(value.operator==='+=')memory('read',value.target,value.target.range);
          accesses(value.value);memory('write',value.target,value.range);
        }
      };
      for(const statement of originalLoop.statements)accesses(statement.value);
      /** @type {QueryFieldOperation[]} */
      const operations=array(loop.operations).map(value=>{
        spend();const op=record(value,['kind','componentType','field','sourceField','tupleIndex','sourceBinding','source']),index=integer(op.tupleIndex),column=columns[index];
        const componentType=hash(op.componentType),field=hash(op.field),sourceField=hash(op.sourceField),sourceBinding=hash(op.sourceBinding);
        if(!column||componentType!==column.componentType||sourceBinding!==column.sourceBinding||
          (op.kind!=='read'&&op.kind!=='write')||(op.kind==='write'&&column.mode!=='write'))fail('field operation receiver/permission differs');
        return {kind:op.kind,componentType,field,sourceField,tupleIndex:index,sourceBinding,source:source(op.source,owner)};
      });
      equal(operations,expectedOperations);
      const fieldEffects=fieldRows(loop.fieldEffects);equal(fieldEffects,countFields(operations));
      return {index,selectionId:hash(loop.selectionId),queryBinding:hash(loop.queryBinding),source:owner,columns,capabilities,fieldEffects,operations};
    });
    if(loops.length!==system.loops.length)fail('missing loops');const fieldEffects=fieldRows(row.fieldEffects);equal(fieldEffects,countFields(loops.flatMap(loop=>loop.operations)));
    return {functionId:id,sourceFunctionId:hash(row.sourceFunctionId),signatureHash:hash(row.signatureHash),source:owner,capabilities,fieldEffects,loops};
  });
  if(systems.length!==originalSystems.size)fail('missing systems');
  /** @type {QueryConflict[]} */
  const conflicts=[];
  for(let i=0;i<systems.length;i++)for(let j=i+1;j<systems.length;j++){
    spend();const left=systems[i],right=systems[j],other=new Map(right.capabilities.map(row=>[row.componentType,row.mode]));
    const components=left.capabilities.filter(row=>{spend();return other.has(row.componentType)&&(row.mode==='write'||other.get(row.componentType)==='write');}).map(row=>row.componentType);
    if(components.length)conflicts.push({left:left.functionId,right:right.functionId,components});
  }
  equal(root.conflicts,conflicts);
  /** @type {SystemQueryEffects} */
  const result={family:'tsfg.system-query-effects-candidate',version:1,queryVersion:1,coreVersion:'0.12.0',inputIdentity:facts.inputIdentity,packageId:facts.packageId,target:facts.program.target,source:sourceIdentity,systems,conflicts};
  return own(result);
}
