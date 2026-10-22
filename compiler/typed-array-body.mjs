// SPDX-License-Identifier: MIT
// Cold typed occurrences and original anchors, never a second evaluator/checker.
import {canonical,integerNames,integerRange} from './identity.mjs';
import {floatBits} from './float.mjs';
import {identifierName} from './module-facts.mjs';
import {check,hash,sourceRange,originId,signatureId} from './typed-array-schema.mjs';
import {typedArrayInteger} from './typed-array-literals.mjs';
import {typedArrayRelations} from './typed-array-relations.mjs';

export function validateTypedArrayFunctions(payload,sources,types) {
  const functions=new Map(),all=[...payload.functions];
  for(const type of types.values())if(type.constructor)all.push(type.constructor);
  for(const fn of all) {
    check(!functions.has(fn.id),'function');functions.set(fn.id,fn);hash(fn.id);
    const source=sources.get(fn.sourcePath);check(source&&!fn.sourcePath.endsWith('.d.ts'),'source');
    sourceRange(fn.declarationRange,source.content);sourceRange(fn.nameRange,source.content,fn.declarationRange);
    check(fn.id===sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath:fn.sourcePath,declarationRange:fn.declarationRange}))
      &&types.has(fn.returnType),'function');
    if(fn.ownerType)check(['value','reference'].includes(types.get(fn.ownerType)?.kind),'function');
    if(fn.returnAnnotationRange)sourceRange(fn.returnAnnotationRange,source.content,fn.declarationRange);
    const bindings=new Map();
    for(const row of [...fn.parameters,...fn.bindings]) {
      check(!bindings.has(row.id)&&types.has(row.declaredType),'binding');bindings.set(row.id,row);
      sourceRange(row.declarationRange,source.content,fn.declarationRange);sourceRange(row.nameRange,source.content,row.declarationRange);
      check(row.id===originId(fn.sourcePath,row.nameRange)
        &&identifierName(source.content.slice(row.nameRange.start,row.nameRange.end))===row.name,'binding');
      for(const key of ['annotationRange','elementAnnotationRange'])if(row[key])sourceRange(row[key],source.content,row.declarationRange);
    }
  }
  const relation=typedArrayRelations(types,functions,payload.compatibilityWitnesses);
  function verifyFunction(fn,initializers=[]) {
    const source=sources.get(fn.sourcePath).content,bindings=new Map([...fn.parameters,...fn.bindings].map(row=>[row.id,row]));
    let declared=new Set(fn.parameters.map(row=>row.id));
    const seenDeclarations=new Set(declared);
    const spelling=range=>source.slice(range.start,range.end);
    function expression(value,parent=fn.declarationRange,target=false,expected=undefined) {
      sourceRange(value.range,source,parent);check(types.has(value.type),'type');
      if(!target)check(types.has(value.flowType),'type');
      if(!target&&['scalar','string','null','undefined','void'].includes(types.get(value.type).kind))
        check(value.flowType===value.type,'flow');
      if(!target)relation.expression(value,expected,{source:fn.sourcePath,...value.range});
      if(['bindingReference','bindingTarget'].includes(value.kind)) {
        const row=bindings.get(value.binding);check(row&&declared.has(row.id)&&row.declaredType===value.type,'binding');
        check(identifierName(spelling(value.range))===row.name,'source');
        if(target)check(row.writable,'binding');
      }
      if(value.kind==='thisReference')check(fn.ownerType===value.type&&spelling(value.range)==='this','binding');
      if(['fieldAccess','fieldTarget'].includes(value.kind)) {
        let owner=types.get(value.receiver.flowType);
        while(owner&&!owner.fields?.some(field=>field.id===value.property&&field.type===value.type))owner=types.get(owner.base);
        check(owner&&['value','reference'].includes(owner.kind),'field');
      }
      if(value.kind==='undefinedLiteral'||value.kind==='nullLiteral')check(spelling(value.range)===(value.kind==='undefinedLiteral'?'undefined':'null'),'source');
      if(value.kind==='booleanLiteral')check(value.type==='bool'&&['true','false'].includes(value.token)&&spelling(value.range)===value.token,'literal');
      if(value.kind==='numericLiteral') {
        check(value.token.length<=65536&&spelling(value.range)===value.token,'literal');
        if(integerNames.includes(value.type)) {
          let number;try{number=typedArrayInteger(value.token);}catch{check(false,'literal');}
          const [min,max]=integerRange(value.type);check(number.toString()===value.decimal&&number>=min&&number<=max,'literal');
        }else check(['f32','f64'].includes(value.type)&&floatBits(value.token,value.type)===value.bits,'literal');
      }
      if(value.kind==='stringLiteral') {
        check(value.type==='string'&&value.codeUnits.every(unit=>Number.isInteger(unit)&&unit>=0&&unit<=65535),'literal');
        const raw=spelling(value.range);check(raw.length>=2&&['"',"'"].includes(raw[0])&&raw.at(-1)===raw[0],'literal');
      }
      if(value.operatorRange){sourceRange(value.operatorRange,source,value.range);if(value.operator)check(spelling(value.operatorRange)===value.operator,'source');}
      if(value.annotationRange)sourceRange(value.annotationRange,source,value.range);
      if(value.calleeRange)sourceRange(value.calleeRange,source,value.range);
      if(value.nameRange)sourceRange(value.nameRange,source,value.range);
      if(value.allocationSite)check(value.allocationSite===originIdForAllocation(fn.sourcePath,value.range),'identity');
      if(value.target)expression(value.target,value.range,true);
      for(const key of ['receiver','index','expression','value','left','right'])if(value[key]) {
        const slot=key==='value'&&value.target?value.target.type
          :key==='receiver'&&value.kind==='call'?functions.get(value.callee)?.ownerType
          :key==='expression'&&value.kind==='parentheses'?expected:undefined;
        expression(value[key],value.range,false,slot);
      }
      for(const [index,child] of (value.arguments??value.elements??[]).entries())expression(child,value.range,false,
        value.arguments?value.signature?.parameters[index]:types.get(value.type)?.elementType);
      if(['elementTarget','checkedElementAccess'].includes(value.kind)) {
        const array=types.get(value.receiver.flowType);check(['array','readSpan'].includes(array?.kind)
          &&array.elementType===value.type&&value.index.flowType==='u32','type');
        if(value.kind==='elementTarget')check(array.kind==='array','type');
      }
      if(value.kind==='arrayLiteral')check(types.get(value.type)?.kind==='array','type');
      if(value.signature) {
        const signature=value.signature;hash(signature.id);
        check(signature.id===signatureId(signature.sourcePath,signature.declarationRange)
          &&signature.parameters.length===value.arguments.length&&types.has(signature.returnType),'signature');
        for(const id of signature.parameters)check(types.has(id),'signature');
        if(value.kind==='new') {
          const type=types.get(value.type),ctor=type?.constructor,origin=ctor??type;
          check(['value','reference'].includes(type?.kind)&&value.flowType===type.id
            &&value.callee===(ctor?.id??type.id)&&signature.returnType===type.id
            &&signature.sourcePath===origin.sourcePath&&canonical(signature.declarationRange)===canonical(origin.declarationRange)
            &&canonical(signature.parameters)===canonical(ctor?.parameters.map(row=>row.declaredType)??[]),'signature');
        }
        if(value.kind==='call'&&value.callee!==payload.readSpanIntrinsic.id) {
          const callee=functions.get(value.callee);check(callee&&callee.sourcePath===signature.sourcePath
            &&canonical(callee.declarationRange)===canonical(signature.declarationRange)
            &&callee.returnType===signature.returnType
            &&canonical(callee.parameters.map(p=>p.declaredType))===canonical(signature.parameters),'signature');
        }
      }
    }
    function body(statements,parent) {
      const outer=declared;declared=new Set(outer);
      let end=parent.start;
      for(const row of statements) {
        sourceRange(row.range,source,parent);check(row.range.start>=end,'source');end=row.range.end;
        if(row.kind==='constDeclaration'||row.kind==='letDeclaration') {
          check(bindings.has(row.binding)&&!seenDeclarations.has(row.binding),'binding');
          expression(row.initializer,row.range,false,bindings.get(row.binding).declaredType);declared.add(row.binding);seenDeclarations.add(row.binding);
        }else if(row.value)expression(row.value,row.range,false,row.kind==='return'?fn.returnType:undefined);
        if(row.condition)expression(row.condition,row.range);
        for(const key of ['then','else','body'])if(row[key])body(row[key],row.range);
      }
      declared=outer;
    }
    for(const {value,type} of initializers)expression(value,fn.declarationRange,false,type);
    body(fn.body,fn.declarationRange);
    check(fn.bindings.every(row=>seenDeclarations.has(row.id)),'binding');
  }
  for(const fn of all)verifyFunction(fn);
  for(const type of types.values())if(type.fields?.some(field=>field.initializer)) {
    // This is the actual declaration's lexical scope, not a fabricated Source
    // function/constructor. Field initialization is lowered from its own facts.
    verifyFunction({ownerType:type.id,sourcePath:type.sourcePath,declarationRange:type.declarationRange,
      parameters:[],bindings:[],body:[]},type.fields.flatMap(field=>field.initializer?[{value:field.initializer,type:field.type}]:[]));
  }
  for(const row of payload.exports)check(functions.get(row.functionId)?.name===row.name,'export');
  relation.finish();
  return functions;
}

import {sha256} from './identity.mjs';
const originIdForAllocation=(sourcePath,declarationRange)=>sha256('tsfg.array-facts.allocation.v8\0'+canonical({sourcePath,declarationRange}));
