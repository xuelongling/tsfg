// SPDX-License-Identifier: MIT
// Owned member semantics shared by finite authority and storage consumers.
// A missing result requires an explicit checked structural witness. Merely
// failing physical lookup never proves absence.
import {canonical,sha256} from './identity.mjs';
import {typedArrayRepresentation} from './typed-array-representation.mjs';
export const undefinedMemberType=sha256('tsfg.type\0undefined');
export function actualFieldResolver(types,views,owners,charge) {
  return (actual,id,view)=>{
    const mapped=views.get(actual+'\0'+view+'\0'+id);
    if(mapped)return typeof mapped==='string'?owners.get(mapped).field:mapped;
    let type=types.get(actual);const seen=new Set();
    while(type){charge();if(seen.has(type.id))throw new TypeError('r03-member-presence: inheritance cycle');seen.add(type.id);
      const direct=type.fields?.find(row=>row.id===id);if(direct)return direct;
      type=type.base?types.get(type.base):null;}
    return null;
  };
}
export function memberPresence(owned,charge) {
  const types=new Map(owned.types.map(type=>[type.id,type])),fields=new Map(),owners=new Map();
  const require=value=>{if(!value)throw new TypeError('r03-member-presence: invalid member authority');};
  const leaves=id=>{const result=new Set(),todo=[id],seen=new Set();
    while(todo.length){charge();const current=todo.pop();if(seen.has(current))continue;seen.add(current);
      const type=types.get(current);require(type);if(type.kind==='union')todo.push(...type.members);else result.add(current);}
    return [...result].sort();};
  for(const type of owned.types)for(const field of type.fields??[]) {
    charge();require(!fields.has(field.id));fields.set(field.id,field);owners.set(field.id,type.id);
    if(field.propertyPresence) {
      const {optional,declaredType}=field.propertyPresence;require(typeof optional==='boolean'&&types.has(declaredType));
      require(canonical(leaves(field.type))===canonical([...new Set([...leaves(declaredType),...(optional?[undefinedMemberType]:[])])].sort()));
    }
  }
  function nominal(id) {
    const result=new Map(),seen=new Set();let type=types.get(id);
    while(type){charge();require(!seen.has(type.id));seen.add(type.id);
      for(const field of type.fields??[]){charge();if(!result.has(field.name))result.set(field.name,field);}
      type=types.get(type.base);}
    return result;
  }
  const representation=typedArrayRepresentation(types,charge);
  function compatible(source,target) {
    // Reuse the established ordinary-slot union/container relation. Static
    // Source permission is separate from actual runtime payload alternatives.
    return representation.logical(source,target,(from,to)=>{
      const seen=new Set();let current=types.get(from);
      while(current){charge();require(!seen.has(current.id));seen.add(current.id);if(current.id===to)return true;current=types.get(current.base);}
      return owned.compatibilityWitnesses.some(record=>{charge();return record.compatibility.sourceType===from&&record.compatibility.targetType===to;});
    })!==null;
  }
  function missing(actual,target) {
    charge();const field=fields.get(target);require(field?.propertyPresence?.optional===true);
    const found=nominal(actual).get(field.name);
    if(found) {
      return compatible(found.type,field.type)?{source:found.id,target}:null;
    }
    return {target,missing:true};
  }
  const declarations=[];
  for(const [id,field] of fields)if(field.propertyPresence) {
    charge();declarations.push({ownerType:owners.get(id),id,name:field.name,type:field.type,
      declaredType:field.propertyPresence.declaredType,optional:field.propertyPresence.optional});
  }
  declarations.sort((a,b)=>{charge();return a.id<b.id?-1:a.id>b.id?1:0;});
  return {types,fields,nominal,missing,compatible,declarations};
}
