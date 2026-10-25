// SPDX-License-Identifier: MIT
// Finite abstract values are private analysis state, never Runtime objects.
// Actual payload tags and object/Cell identities remain distinct from views.
import {canonical,sha256} from './identity.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
export function commonAbstract(model) {
  const {spend,types}=model,collections=commonCollections(spend),arrays=new Map();
  for(const type of types.values()){spend();if(type.kind==='array')arrays.set(type.elementType,type);}
  const empty=()=>({tags:new Set(),refs:new Set(),cells:new Set(),truth:0,unknown:false,number:null});
  const weight=v=>v.tags.size+v.refs.size+v.cells.size+1;
  const key=v=>{check(v.tags.size<=256&&v.refs.size<=256&&v.cells.size<=256,'limit');return canonical({tags:collections.sorted(v.tags),refs:collections.sorted(v.refs),cells:collections.sorted(v.cells),truth:v.truth,unknown:v.unknown,number:v.number});};
  const copy=v=>{spend(weight(v));return {...v,tags:new Set(v.tags),refs:new Set(v.refs),cells:new Set(v.cells)};};
  function merge(to,from) {
    spend(weight(to)+weight(from));const before=key(to),blank=to.tags.size===0&&!to.unknown;
    for(const name of ['tags','refs','cells'])for(const id of from[name])to[name].add(id);
    check(to.tags.size<=256&&to.refs.size<=256&&to.cells.size<=256,'limit');
    to.truth|=from.truth;to.unknown ||= from.unknown;to.number=blank?from.number:to.number===from.number?to.number:null;return key(to)!==before;
  }
  const literal=(id,truth=0,number=null)=>{const v=empty();v.tags.add(id);v.truth=truth;v.number=number;return v;};
  const snapshot=heap=>collections.map(heap,copy);
  function joinHeap(into,from) {let changed=false;spend(from.size);for(const [id,v]of from){if(!into.has(id)){into.set(id,copy(v));changed=true;}else changed=merge(into.get(id),v)||changed;}return changed;}
  const fields=id=>{const result=[],layers=[],seen=new Set();let type=types.get(id);
    while(type){spend();check(!seen.has(type.id),'type');seen.add(type.id);layers.push(type.fields??[]);type=types.get(type.base);}
    for(let i=layers.length-1;i>=0;i--){spend(layers[i].length);for(const field of layers[i])result.push(field);}return result;};
  function declared(id,heap,origin,fieldSeeds,objects,active=new Set()) {
    spend();const type=types.get(id);check(type,'type');const value=empty();
    if(type.kind==='unknown'){value.unknown=true;return value;}
    if(type.kind==='union'){for(const member of type.members)merge(value,declared(member,heap,origin,fieldSeeds,objects,collections.set(active)));return value;}
    value.tags.add(id);if(type.name==='bool')value.truth=3;
    if(['reference','value','array','readSpan'].includes(type.kind)) {
      const ref=origin+'/'+id;value.refs.add(ref);if(active.has(ref))return value;active.add(ref);objects.set(ref,{type:id,weak:true});
      if(['value','reference'].includes(type.kind))for(const field of fields(id)) {
        const slot=ref+'/field/'+field.id;if(heap.has(slot))continue;
        // Reference cycles stop at an existing abstract object. Inline cycles
        // were independently rejected at the cold catalogue seam.
        const child=declared(field.type,heap,origin,fieldSeeds,objects,collections.set(active));
        if(fieldSeeds.has(field.sourceBinding)){
          const upper=fieldSeeds.get(field.sourceBinding);spend(upper.tags.size);child.unknown ||= upper.unknown;
          for(const tag of upper.tags)merge(child,declared(tag,heap,origin,fieldSeeds,objects,collections.set(active)));
        }heap.set(slot,child);
      }
      if(type.kind==='array'){
        const child=declared(type.elementType,heap,origin,fieldSeeds,objects,collections.set(active)),upper=model.elementSeeds?.get('element:'+id);
        if(upper){child.unknown ||= upper.unknown;spend(upper.tags.size);for(const tag of upper.tags)merge(child,declared(tag,heap,origin,fieldSeeds,objects,collections.set(active)));}
        heap.set(ref+'/element/*',child);
      }
      if(type.kind==='readSpan'){const array=arrays.get(type.elementType);
        if(array)heap.set(ref+'/owner',declared(array.id,heap,origin,fieldSeeds,objects,collections.set(active)));}
    }
    return value;
  }
  function reachable(values,heap) {
    spend(values.length+heap.size);const result=new Map(),pending=[...values],visited=new Set();
    for(const [id,v]of heap)if(id.startsWith('global:')){result.set(id,copy(v));pending.push(v);}
    for(let i=0;i<pending.length;i++)for(const ref of pending[i].refs) {
      spend();if(visited.has(ref))continue;visited.add(ref);
      for(const [id,v]of heap){spend();if(id.startsWith(ref+'/')){result.set(id,copy(v));pending.push(v);}}
    }
    return result;
  }
  const state=()=>({values:new Map(),heap:new Map()});
  const clone=s=>({values:snapshot(s.values),heap:snapshot(s.heap)});
  const join=(to,from)=>{const a=joinHeap(to.values,from.values),b=joinHeap(to.heap,from.heap);return a||b;};
  return {empty,key,copy,merge,literal,snapshot,joinHeap,fields,declared,reachable,state,clone,join,
    arrayType:element=>arrays.get(element),id:value=>sha256(canonical(value))};
}
