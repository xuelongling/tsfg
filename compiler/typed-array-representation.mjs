// SPDX-License-Identifier: MIT
// R01 representation checks over owned logical IDs, separate from TS's erased
// number relation. Reference conversions require an explicit M12 pair callback.
import {integerNames} from './identity.mjs';
import {check} from './typed-array-schema.mjs';

export function typedArrayRepresentation(types,spend) {
  const container=type=>['array','readSpan'].includes(type.kind);
  function merge(target,selected) {
    for(const [key,pair] of selected){spend();target.set(key,pair);}return target;
  }
  const selected=(from,to)=>new Map([[from+'\0'+to,{sourceType:from,targetType:to}]]);
  function containsNominal(id) {
    const pending=[id],seen=new Set();
    while(pending.length) {
      spend();const next=pending.pop();if(seen.has(next))continue;seen.add(next);
      const type=types.get(next);check(type,'type');
      if(type.kind==='reference'||type.kind==='value')return true;
      if(container(type))pending.push(type.elementType);
      else if(type.kind==='union')for(const member of type.members){spend();pending.push(member);}
    }
    return false;
  }
  function numerics(id,result=new Map(),depth=0,seen=new Set()) {
    spend();const key=depth+'\0'+id;if(seen.has(key))return result;seen.add(key);
    const type=types.get(id);check(type,'type');
    if(integerNames.includes(id)||['f32','f64'].includes(id)) {
      if(!result.has(depth))result.set(depth,new Set());result.get(depth).add(id);
    }else if(type.kind==='union')for(const member of type.members)numerics(member,result,depth,seen);
    else if(container(type))numerics(type.elementType,result,depth+1,seen);
    return result;
  }
  function assertion(from,to,reference) {
    const source=numerics(from),target=numerics(to);
    for(const [depth,kinds] of source)if(target.has(depth))
      check([...kinds].some(kind=>target.get(depth).has(kind)),'representation');
    function view(from,to) {
      spend();if(from===to)return new Map();
      const source=types.get(from),target=types.get(to);
      if(['undefined','null','void'].includes(target.kind))return new Map();
      if(source.kind==='union'||target.kind==='union') {
        const payload=type=>(type.members??[type.id]).filter(id=>!['undefined','null'].includes(id));
        const fromPayload=payload(source),toPayload=payload(target);
        if(toPayload.every(id=>fromPayload.includes(id))||fromPayload.every(id=>toPayload.includes(id)))return new Map();
      }
      if(source.kind==='union') {
        const payload=source.members.filter(id=>!['undefined','null'].includes(id));
        const result=new Map();
        for(const id of payload)merge(result,view(id,to));
        return result;
      }
      if(target.kind==='union') {
        if(target.members.includes(from))return new Map();
        const payload=target.members.filter(id=>!['undefined','null'].includes(id));
        if(payload.length===1)return view(from,payload[0]);
        if(containsNominal(from)) {
          const choice=logical(from,to,reference);check(choice!==null,'compatibility');return choice;
        }
      }
      if(container(source)&&container(target))return view(source.elementType,target.elementType);
      if(source.kind==='reference'&&target.kind==='reference') {
        check(reference(from,to),'compatibility');return selected(from,to);
      }
      check(source.kind!=='value'&&target.kind!=='value','representation');
      return new Map();
    }
    return view(from,to);
  }
  // Ordinary slot relations cover every source variant. Assertions above may
  // select an existing variant; their overlap rule cannot serve this boundary.
  function logical(from,to,reference) {
    spend();if(from===to)return new Map();
    const source=types.get(from),target=types.get(to);check(source&&target,'type');
    if(source.kind==='union') {
      const result=new Map();
      for(const id of source.members) {
        const choice=logical(id,to,reference);if(choice===null)return null;merge(result,choice);
      }
      return result;
    }
    if(target.kind==='union') {
      if(target.members.includes(from))return new Map();
      for(const id of target.members){const choice=logical(from,id,reference);if(choice!==null)return choice;}
      return null;
    }
    if(source.kind==='value'||target.kind==='value'||source.kind==='scalar'||target.kind==='scalar')return null;
    if(container(source)&&container(target))return logical(source.elementType,target.elementType,reference);
    if(source.kind==='reference'&&target.kind==='reference')return reference(from,to)?selected(from,to):null;
    return to==='void'&&from==='undefined'?new Map():null;
  }
  return {assertion,logical,merge};
}
