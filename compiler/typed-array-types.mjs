// SPDX-License-Identifier: MIT
// Logical source type catalogue validation; physical layout is a separate domain.
import {canonical,sha256,scalarTypeIds} from './identity.mjs';
import {check,byteOrder,hash,sourceRange,originId} from './typed-array-schema.mjs';

export function validateTypedArrayTypes(payload,sources) {
  const types=new Map();
  for(const row of payload.types) {
    check(!types.has(row.id)&&(!types.size||byteOrder([...types.keys()].at(-1),row.id)<0),'type');
    types.set(row.id,row);
  }
  check(types.size>0,'type');
  const requireType=id=>{check(types.has(id),'type');return types.get(id);};
  for(const row of types.values()) {
    if(['undefined','null','void'].includes(row.kind))check(row.id===row.kind&&row.constructor===null,'type');
    if(row.sourcePath!==undefined) {
      const source=sources.get(row.sourcePath);check(source,'source');
      sourceRange(row.declarationRange,source.content);sourceRange(row.nameRange,source.content,row.declarationRange);
    }
    if(['scalar','string'].includes(row.kind)) {
      check(row.id===row.name&&(row.kind==='string'?row.name==='string':Object.hasOwn(scalarTypeIds,row.name))
        &&row.sourcePath===payload.sourceRoot+'/minimal-arrays-v8.d.ts'&&row.constructor===null,'type');
      const source=sources.get(row.sourcePath).content;
      check(source.slice(row.nameRange.start,row.nameRange.end)===(row.kind==='string'?'String':row.name),'source');
    }
    if(['array','readSpan'].includes(row.kind)) {
      requireType(row.elementType);
      check(row.id===row.kind+'<'+row.elementType+'>'&&row.constructor===null
        &&row.sourcePath===payload.sourceRoot+'/minimal-arrays-v8.d.ts','type');
      const content=sources.get(row.sourcePath).content;
      sourceRange(row.indexSignatureRange,content,row.declarationRange);
      check(content.slice(row.nameRange.start,row.nameRange.end)===(row.kind==='array'?'Array':'ReadSpan'),'source');
    }
    if(row.kind==='union') {
      check(row.members.length>=2&&row.constructor===null,'type');
      row.members.forEach((id,index)=>{
        const member=requireType(id);check(member.kind!=='union'&&(!index||byteOrder(row.members[index-1],id)<0),'type');
      });
      check(row.id==='union<'+row.members.join(',')+'>','type');
    }
    if(['value','reference'].includes(row.kind)) {
      check(row.id==='nominal:'+sha256('tsfg.array-facts.nominal.v8\0'+canonical(row.nominalKey)).slice(7),'identity');
      check(row.sourcePath===row.nominalKey.sourcePath&&!row.sourcePath.endsWith('.d.ts'),'type');
      check(row.kind!=='value'||row.nominalKey.category==='value','type');
      hash(row.runtimeKey);
      check(row.runtimeKey===sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({
        files:payload.files.map(({path,sha256})=>({path,sha256})),nominalKey:row.nominalKey})),'identity');
      if(row.base)check(requireType(row.base).kind==='reference'&&row.kind==='reference','type');
      const fields=new Set();
      for(const field of row.fields) {
        hash(field.id);requireType(field.type);check(!fields.has(field.id),'type');fields.add(field.id);
        const source=sources.get(field.origin.source);check(source,'source');
        sourceRange(field.origin,source.content,row.declarationRange);
        if(field.parameterBinding) {
          const parameter=row.constructor?.parameters.find(value=>value.id===field.parameterBinding);
          check(parameter&&parameter.name===field.name&&parameter.declaredType===field.type
            &&field.id===sha256('tsfg.array-facts.field.v8\0'+canonical({sourcePath:row.sourcePath,nameRange:parameter.nameRange})),'field-initialization');
        }
      }
      for(const method of row.methods??[])hash(method);
    }
  }
  // Value-containment must be finite; managed reference/container edges stop the
  // walk. This proves a layout exists without rejecting legal reference cycles.
  const active=new Set(),complete=new Set();
  function finite(id) {
    if(complete.has(id))return;check(!active.has(id),'recursive-value');active.add(id);
    const type=requireType(id);
    if(type.kind==='union')for(const member of type.members)finite(member);
    if(type.kind==='value')for(const field of type.fields)finite(field.type);
    active.delete(id);complete.add(id);
  }
  for(const id of types.keys())finite(id);
  return types;
}

export function validateTypedArrayDeclarations(payload,sources) {
  for(const [row,owner,read] of [[payload.arrayLength,'Array<T>',false],[payload.readSpanLength,'ReadSpan<T>',true]]) {
    check(row.ownerType===owner&&row.name==='length'&&row.kind==='property'
      &&row.sourcePath===payload.sourceRoot+'/minimal-arrays-v8.d.ts'&&row.officialType==='number'
      &&(read?row.readonly===true&&row.readType==='u32':row.writeType==='u32'),'declaration');
    const content=sources.get(row.sourcePath)?.content;check(typeof content==='string','declaration');
    sourceRange(row.declarationRange,content);sourceRange(row.nameRange,content,row.declarationRange);
    sourceRange(row.typeRange,content,row.declarationRange);
    check(row.id===originId(row.sourcePath,row.nameRange)
      &&content.slice(row.nameRange.start,row.nameRange.end)==='length'
      &&content.slice(row.typeRange.start,row.typeRange.end)===(read?'u32':'number'),'declaration');
  }
  const intrinsic=payload.readSpanIntrinsic,content=sources.get(intrinsic.sourcePath)?.content;
  check(typeof content==='string'&&intrinsic.sourcePath===payload.sourceRoot+'/minimal-arrays-v8.d.ts'
    &&intrinsic.kind==='intrinsic'&&intrinsic.name==='readSpan','declaration');
  sourceRange(intrinsic.declarationRange,content);sourceRange(intrinsic.nameRange,content,intrinsic.declarationRange);
  check(intrinsic.id===originId(intrinsic.sourcePath,intrinsic.nameRange)
    &&content.slice(intrinsic.nameRange.start,intrinsic.nameRange.end)==='readSpan','declaration');
}
