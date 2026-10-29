// SPDX-License-Identifier: MIT
// Published semantic identity excludes current Source tokens and implementation.
// Source IDs and runtimeKey remain provenance, never a replacement nominal key.
import {canonical,sha256,scalarTypeIds} from './identity.mjs';
import {functionId,signatureId} from './module-callable-common.mjs';
import {moduleIdentity,globalIdentity} from './modules.mjs';
import {commonLexicalScopes} from './common-program-lexical.mjs';

export const commonIdentity=(kind,value)=>sha256('tsfg.common-program.'+kind+'.v1\0'+canonical(value));
export const commonDeclKey=(sourcePath,path,kind,name)=>({sourcePath,path:[...path],kind,name});
export const commonInitializerId=path=>commonIdentity('initializer',{module:moduleIdentity(path)});
export const commonFieldId=(owner,name,index)=>commonIdentity('field',{owner,name,index});

// A labelled finite graph permits legal reference cycles without recursive
// hashing. Its edges are semantic labels, not mutable raw v8 runtime identities.
export function commonSemanticIdentities(payload,spend) {
  const types=new Map(payload.types.map(row=>[row.id,row]));
  const functions=new Map([...payload.functions,...payload.types.flatMap(row=>row.constructor?[row.constructor]:[])].map(row=>[row.id,row]));
  const labels=new Map(),active=new Set(),shapes=new Map(),typeIds=new Map();
  function label(id) {
    spend();if(labels.has(id))return labels.get(id);
    const row=types.get(id);if(!row||active.has(id))throw new TypeError('invalid semantic type identity');
    active.add(id);let result;
    if(['value','reference'].includes(row.kind))result=canonical({kind:row.kind,nominal:row.nominalKey});
    else if(row.kind==='function')result=canonical({kind:'function',parameters:row.parameters.map(label),returnType:label(row.returnType)});
    else if(row.kind==='union')result=canonical({kind:row.kind,members:row.members.map(label).sort()});
    else if(['array','readSpan'].includes(row.kind))result=canonical({kind:row.kind,element:label(row.elementType)});
    else result=canonical({kind:row.kind,name:row.name??row.kind});
    active.delete(id);labels.set(id,result);return result;
  }
  for(const id of types.keys())label(id);
  const callableShape=fn=>({parameters:fn.parameters.map(p=>label(p.declaredType)),returnType:label(fn.returnType)});
  function shape(row) {
    const result={label:label(row.id),kind:row.kind};
    if(row.kind==='function'){result.parameters=row.parameters.map(label);result.returnType=label(row.returnType);}
    if(row.base)result.base=label(row.base);
    if(row.elementType)result.elementType=label(row.elementType);
    if(row.members)result.members=row.members.map(label).sort();
    if(row.fields)result.fields=row.fields.map((field,index)=>({name:field.name,index,type:label(field.type),readonly:field.readonly,access:field.access}));
    if(row.methods)result.methods=row.methods.map(id=>{spend();const fn=functions.get(id);
      if(!fn)throw new TypeError('method missing from semantic type directory');return {name:fn.name,access:fn.access,...callableShape(fn)};});
    if(row.construction)result.construction={access:row.construction.access,
      parameters:row.construction.signature.parameters.map(label),returnType:label(row.id)};
    return result;
  }
  for(const row of types.values())shapes.set(row.id,shape(row));
  const children=row=>[...(row.base?[row.base]:[]),...(row.elementType?[row.elementType]:[]),...(row.members??[]),
    ...(row.fields??[]).map(field=>field.type),...(row.methods??[]).flatMap(id=>{const fn=functions.get(id);return [fn.returnType,...fn.parameters.map(p=>p.declaredType)];}),
    ...(row.construction?.signature.parameters??[]),...(row.kind==='function'?[...row.parameters,row.returnType]:[])];
  function semanticType(id) {
    if(typeIds.has(id))return typeIds.get(id);spend();const row=types.get(id);
    if(row.kind==='scalar'){typeIds.set(id,scalarTypeIds[row.name]);return scalarTypeIds[row.name];}
    if(['string','unknown','undefined','null','void'].includes(row.kind)) {
      const result=sha256('tsfg.type\0'+row.kind);typeIds.set(id,result);return result;
    }
    const seen=new Set(),pending=[id],graph=[];
    while(pending.length){spend();const next=pending.pop();if(seen.has(next))continue;seen.add(next);
      const current=types.get(next);if(!current)throw new TypeError('unowned semantic dependency');
      graph.push(shapes.get(next));for(const child of children(current)){spend();pending.push(child);}}
    graph.sort((a,b)=>a.label<b.label?-1:a.label>b.label?1:0);
    const result=commonIdentity('type',{root:labels.get(id),graph});typeIds.set(id,result);return result;
  }
  for(const id of types.keys())semanticType(id);
  const callableTypes=new Map(),functionIds=new Map(),signatures=new Map(),declKeys=new Map();
  const activeFunctions=new Set();
  const scopes=new Map([...functions].map(([id,fn])=>[id,commonLexicalScopes(fn,spend)]));
  function identifyFunction(fn) {
    spend();if(functionIds.has(fn.id))return;
    if(activeFunctions.has(fn.id))throw new TypeError('cyclic lexical function');activeFunctions.add(fn.id);
    const parent=fn.lexicalParent?functions.get(fn.lexicalParent):null;
    if(fn.lexicalParent&&!parent)throw new TypeError('unknown lexical parent');if(parent)identifyFunction(parent);
    const owner=fn.ownerType?types.get(fn.ownerType):null;
    const parentKey=parent?declKeys.get(parent.id):null;
    const path=parentKey?[...parentKey.path,parentKey.kind,parentKey.name,...scopes.get(parent.id).get(fn.id).scope.path]:owner?['type',...owner.nominalKey.declarationPath]:[];
    const kind=owner?(owner.constructor?.id===fn.id?'constructor':'method'):'function';
    const key=commonDeclKey(fn.sourcePath,path,kind,fn.name),qualified=canonical({path,kind,name:fn.name});
    const type={parameters:[...(owner?[semanticType(owner.id)]:[]),...fn.parameters.map(p=>semanticType(p.declaredType))],returns:semanticType(fn.returnType)};
    declKeys.set(fn.id,key);callableTypes.set(fn.id,type);signatures.set(fn.id,signatureId(type));
    functionIds.set(fn.id,functionId(fn.sourcePath,qualified,type));activeFunctions.delete(fn.id);
  }
  for(const fn of functions.values())identifyFunction(fn);
  const globals=new Map(payload.globals.map(row=>{spend();const b=row.binding;
    return [b.id,globalIdentity(row.sourcePath,row.bindingKind==='default-export'?'$default':b.name,semanticType(b.declaredType))];}));
  return {types,typeIds,labels,shapes,functions,callableTypes,functionIds,signatures,declKeys,globals,
    moduleId:moduleIdentity,initializerId:commonInitializerId};
}
