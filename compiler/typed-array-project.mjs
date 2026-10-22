// SPDX-License-Identifier: MIT
// The sole protocol-to-domain transform: semantic identities and owned HIR nodes.
import descriptor from '../contracts/typed-array-hir.schema.json' with {type:'json'};
import bytecode from '../contracts/bytecode.schema.json' with {type:'json'};
import {canonical,own,sha256,functionIdentity,signatureHash} from './identity.mjs';
export const typedArrayHirFormat=own({contractVersion:'0.13.0',schemaHash:sha256(canonical(descriptor)+'\n')});

export function projectTypedArrayFacts(facts) {
  const payload=facts.payload,sourceTypes=new Map(payload.types.map(row=>[row.id,row]));
  const names=new Map(),typeIds=new Map();
  function typeName(id) {
    if(names.has(id))return names.get(id);
    const row=sourceTypes.get(id);
    const name=row.kind==='array'?'Array<'+typeName(row.elementType)+'>'
      :row.kind==='readSpan'?'ReadSpan<'+typeName(row.elementType)+'>'
      :row.kind==='union'?'Union<'+row.members.map(typeName).sort().join(',')+'>'
      :['value','reference'].includes(row.kind)?(row.kind==='value'?'value':'ref')+'<'+row.runtimeKey+'>'
      :row.kind==='scalar'?row.name:row.kind;
    names.set(id,name);typeIds.set(id,sha256('tsfg.type\0'+name));return name;
  }
  payload.types.forEach(row=>typeName(row.id));
  const functions=[...payload.functions,...payload.types.flatMap(row=>row.constructor?[row.constructor]:[])];
  const functionIds=new Map(),signatures=new Map(),receivers=new Map();
  for(const fn of functions) {
    const parameters=[...(fn.ownerType?[typeName(fn.ownerType)]:[]),...fn.parameters.map(row=>typeName(row.declaredType))];
    const name=fn.ownerType?typeName(fn.ownerType)+'.'+fn.name:fn.name;
    functionIds.set(fn.id,functionIdentity(fn.sourcePath,name,typeName(fn.returnType),parameters));
    signatures.set(fn.id,signatureHash(typeName(fn.returnType),parameters));
    if(fn.ownerType)receivers.set(fn.id,'this@'+fn.id);
  }
  const fields=new Map(payload.types.flatMap(row=>(row.fields??[]).map(field=>[field.id,
    sha256('tsfg.field\0'+typeIds.get(row.id)+'\0'+field.name)])));
  const member=id=>fields.get(id)??functionIds.get(id);
  const compatibility=proof=>({...structuredClone(proof),sourceType:typeIds.get(proof.sourceType),targetType:typeIds.get(proof.targetType),
    members:proof.members.map(row=>({source:member(row.source),target:member(row.target)}))});
  function expression(value,fn) {
    const common={type:typeIds.get(value.flowType??value.type),declaredType:typeIds.get(value.type),range:{...value.range}};
    const kinds={numericLiteral:['f32','f64'].includes(value.type)?'floating':'constant',booleanLiteral:'boolean',
      undefinedLiteral:'undefined',nullLiteral:'null',bindingReference:'reference',arrayLiteral:'arrayCreate',
      checkedElementAccess:'arrayReadChecked',arrayLength:'arrayLength',readSpanLength:'readSpanLength',
      elementAssignment:'arrayStoreDenseChecked',lengthAssignment:'arrayResizeChecked',
      elementCompoundAssignment:'arrayCompoundAssignment',elementUpdate:'arrayUpdate',
      elementTarget:'arrayElementTarget',lengthTarget:'arrayLengthTarget',bindingTarget:'localTarget',fieldTarget:'fieldTarget',
      bindingAssignment:'assignment',bindingUpdate:'update',fieldAssignment:'fieldAssignment',fieldUpdate:'fieldUpdate',
      parentheses:'group',nonNull:'nonNull',as:'assertType',new:'construct',call:'call',thisReference:'reference'};
    /** @type {any} */
    const result={kind:kinds[value.kind]??value.kind,...common};
    if(value.kind==='thisReference') {
      if(receivers.has(fn.id))result.binding=receivers.get(fn.id);
      else {result.kind='this';result.ownerType=typeIds.get(fn.ownerType);}
    }
    for(const key of ['token','decimal','bits','codeUnits','binding','allocationSite','operator','prefix'])
      if(Object.hasOwn(value,key))result[key]=structuredClone(value[key]);
    if(value.property)result.property=['fieldAccess','fieldTarget'].includes(value.kind)
      ?fields.get(value.property):value.property;
    if(value.kind==='booleanLiteral')result.value=value.token==='true';
    for(const key of ['operatorRange','annotationRange','calleeRange','nameRange'])if(value[key])result[key]={...value[key]};
    for(const key of ['receiver','index','expression','value','left','right','target'])
      if(value[key])result[key==='expression'?'operand':key]=expression(value[key],fn);
    for(const key of ['elements','arguments'])if(value[key])result[key]=value[key].map(child=>expression(child,fn));
    if(value.callee) {
      result.target=functionIds.get(value.callee)??typeIds.get(value.callee)??value.callee;
      result.sourceSignature={id:value.signature.id,sourcePath:value.signature.sourcePath,
        range:{...value.signature.declarationRange},parameters:value.signature.parameters.map(id=>typeIds.get(id)),
        returnType:typeIds.get(value.signature.returnType)};
      result.signatureHash=signatures.get(value.callee)??null;
    }
    if(value.compatibilityRoots)result.compatibilityRoots=value.compatibilityRoots.map(pair=>({
      sourceType:typeIds.get(pair.sourceType),targetType:typeIds.get(pair.targetType)}));
    return result;
  }
  function binding(row){return {id:row.id,name:row.name,type:typeIds.get(row.declaredType),writable:row.writable,
    range:{...row.declarationRange},nameRange:{...row.nameRange},annotationRange:structuredClone(row.annotationRange),
    elementAnnotationRange:structuredClone(row.elementAnnotationRange)};}
  function projectFunction(fn) {
    const bindings=new Map([...fn.parameters,...fn.bindings].map(row=>[row.id,binding(row)]));
    function statements(body) {return body.map(row=>{
      if(row.kind==='constDeclaration'||row.kind==='letDeclaration')return {kind:'local',range:{...row.range},
        binding:bindings.get(row.binding),initializer:expression(row.initializer,fn)};
      const result={kind:row.kind,range:{...row.range}};
      if(row.value)result[row.kind==='expression'?'expression':'value']=expression(row.value,fn);
      if(row.condition)result.condition=expression(row.condition,fn);
      for(const key of ['then','else','body'])if(row[key])result[key]=statements(row[key]);
      return result;
    });}
    const result={id:functionIds.get(fn.id),sourceBinding:fn.id,name:fn.name,sourcePath:fn.sourcePath,
      signatureHash:signatures.get(fn.id),returnType:{id:typeIds.get(fn.returnType),kind:sourceTypes.get(fn.returnType).kind,name:typeName(fn.returnType)},
      parameters:fn.parameters.map(binding),range:{...fn.declarationRange},nameRange:{...fn.nameRange},
      returnAnnotationRange:structuredClone(fn.returnAnnotationRange),body:statements(fn.body)};
    if(fn.ownerType) {
      result.ownerType=typeIds.get(fn.ownerType);
      result.parameters.unshift({id:receivers.get(fn.id),name:'this',type:result.ownerType,writable:false,
        range:{...fn.nameRange},nameRange:{...fn.nameRange},annotationRange:null,elementAnnotationRange:null,implicit:true});
    }
    if(fn.overrideTarget)result.overrideTarget=functionIds.get(fn.overrideTarget);
    return result;
  }
  const types=payload.types.map(row=>{
    const result={id:typeIds.get(row.id),kind:row.kind,name:typeName(row.id),sourceType:row.id};
    if(row.sourcePath)result.origin={sourcePath:row.sourcePath,declarationRange:{...row.declarationRange},nameRange:{...row.nameRange},
      ...(row.indexSignatureRange?{indexSignatureRange:{...row.indexSignatureRange}}:{})};
    if(row.elementType)result.elementType=typeIds.get(row.elementType);
    if(row.members)result.members=row.members.map(id=>typeIds.get(id)).sort();
    if(row.base)result.base=typeIds.get(row.base);
    if(row.runtimeKey)result.runtimeKey=row.runtimeKey;
    if(row.nominalKey)result.nominalKey=structuredClone(row.nominalKey);
    if(row.markerOrigin)result.markerOrigin=structuredClone(row.markerOrigin);
    if(row.fields)result.fields=row.fields.map(field=>({id:fields.get(field.id),sourceBinding:field.id,name:field.name,
      type:typeIds.get(field.type),readonly:field.readonly,origin:{...field.origin},
      ...(field.parameterBinding?{parameterBinding:field.parameterBinding}:{}),
      ...(field.initializer?{initializer:expression(field.initializer,{id:row.constructor?.id??row.id,ownerType:row.id})}:{})}));
    if(row.methods)result.methods=row.methods.map(id=>functionIds.get(id));
    if(['value','reference'].includes(row.kind))result.constructor=row.constructor?functionIds.get(row.constructor.id):null;
    return result;
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {format:{...typedArrayHirFormat},inputIdentity:facts.packageId,
    facts:{version:8,schemaHash:facts.schemaHash,requestId:facts.requestId},rootFile:payload.rootFile,
    sources:payload.files.map(row=>({path:row.path,content:row.content,hash:'sha256:'+row.sha256})),
    target:structuredClone(bytecode.target),types,functions:functions.map(projectFunction),
    compatibilityWitnesses:payload.compatibilityWitnesses.map(record=>({compatibility:compatibility(record.compatibility),
      dependencies:record.dependencies.map(pair=>({sourceType:typeIds.get(pair.sourceType),targetType:typeIds.get(pair.targetType)}))})),
    exports:payload.exports.map(row=>({name:row.name,functionId:functionIds.get(row.functionId)})),
    intrinsics:{arrayLength:structuredClone(payload.arrayLength),readSpanLength:structuredClone(payload.readSpanLength),
      readSpan:structuredClone(payload.readSpanIntrinsic)}};
}
