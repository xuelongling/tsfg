// SPDX-License-Identifier: MIT
// Finite abstract values are private analysis state, never Runtime objects.
// Actual payload tags and object/Cell identities remain distinct from views.
import {canonical,sha256} from './identity.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
import {commonRegions,emptyRegionValue} from './common-program-regions.mjs';
export function commonAbstract(model) {
  const {spend,types}=model,collections=commonCollections(spend),regions=commonRegions(spend),arrays=new Map();
  const noOrigin=Object.freeze(emptyRegionValue()),emptyOrigin=Object.freeze({...emptyRegionValue(),empty:true});
  for(const type of types.values()){spend();if(type.kind==='array')arrays.set(type.elementType,type);}
  const empty=()=>({tags:new Set(),refs:new Set(),cells:new Set(),pairs:new Map(),truth:0,unknown:false,number:null,region:noOrigin});
  // Relation operations pay for their own copies/joins; do not charge that
  // work twice as part of the independent payload collections.
  const weight=v=>v.tags.size+v.refs.size+v.cells.size+v.pairs.size+1;
  const key=v=>{check(v.tags.size<=256&&v.refs.size<=256&&v.cells.size<=256&&v.pairs.size<=256,'limit');return canonical({tags:collections.sorted(v.tags),refs:collections.sorted(v.refs),cells:collections.sorted(v.cells),pairs:collections.sorted(v.pairs,([a],[b])=>a<b?-1:a>b?1:0),truth:v.truth,unknown:v.unknown,number:v.number});};
  // Absence is an immutable facet; only actual origin sets need snapshots.
  const copy=v=>{spend(weight(v));return {...v,tags:new Set(v.tags),refs:new Set(v.refs),cells:new Set(v.cells),pairs:new Map(v.pairs),
    region:!v.region.roots.size&&!v.region.opaque?v.region.empty?emptyOrigin:noOrigin:regions.copy(v.region)};};
  function merge(to,from) {
    spend(weight(to)+weight(from));let changed=false;const blank=to.tags.size===0&&!to.unknown;
    // Detect the finite lattice delta while visiting its collections once;
    // serializing and sorting the entire value twice is unnecessary here.
    for(const [key,pair]of from.pairs){const prior=to.pairs.get(key);if(!prior||prior.functionId!==pair.functionId||prior.environment!==pair.environment){to.pairs.set(key,pair);changed=true;}}
    for(const name of ['tags','refs','cells'])for(const id of from[name])if(!to[name].has(id)){to[name].add(id);changed=true;}
    check(to.tags.size<=256&&to.refs.size<=256&&to.cells.size<=256&&to.pairs.size<=256,'limit');
    const truth=to.truth|from.truth,unknown=to.unknown||from.unknown,number=blank?from.number:to.number===from.number?to.number:null;
    changed ||= truth!==to.truth||unknown!==to.unknown||number!==to.number;to.truth=truth;to.unknown=unknown;to.number=number;
    let relationChanged=false;
    if(!to.region.roots.size&&!to.region.opaque&&!from.region.roots.size&&!from.region.opaque){
      const next=to.region.empty||from.region.empty?emptyOrigin:noOrigin;relationChanged=next.empty!==to.region.empty;to.region=next;
    }else{if(to.region===noOrigin||to.region===emptyOrigin)to.region=regions.copy(to.region);relationChanged=regions.merge(to.region,from.region);}
    return changed||relationChanged;
  }
  const literal=(id,truth=0,number=null)=>{const v=empty();v.tags.add(id);v.truth=truth;v.number=number;v.region=emptyOrigin;return v;};
  const snapshot=heap=>collections.map(heap,copy);
  function joinHeap(into,from) {let changed=false;spend(from.size);for(const [id,v]of from){if(!into.has(id)){into.set(id,copy(v));changed=true;}else changed=merge(into.get(id),v)||changed;}return changed;}
  const fields=id=>{const result=[],layers=[],seen=new Set();let type=types.get(id);
    while(type){spend();check(!seen.has(type.id),'type');seen.add(type.id);layers.push(type.fields??[]);type=types.get(type.base);}
    for(let i=layers.length-1;i>=0;i--){spend(layers[i].length);for(const field of layers[i])result.push(field);}return result;};
  function entryStorage(source,view,heap,origin,fieldSeeds,objects,active,entry) {
    spend();const logical=types.get(view);check(logical,'type');const result=empty();
    if(logical.kind==='union'){
      for(const member of logical.members)merge(result,entryStorage(source,member,heap,origin,fieldSeeds,objects,collections.set(active),entry));return result;
    }
    if(['array','readSpan'].includes(logical.kind)){
      const pending=[source],seen=new Set(),containers=[];
      while(pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);const type=types.get(id);check(type,'type');
        if(type.kind==='union'){spend(type.members.length);for(const member of type.members)pending.push(member);}
        else if(['array','readSpan'].includes(type.kind))containers.push(id);}
      if(!containers.length)containers.push(view);
      for(const id of containers)merge(result,declared(id,heap,origin,fieldSeeds,objects,collections.set(active),entry,true,view));return result;
    }
    return declared(view,heap,origin,fieldSeeds,objects,active,entry);
  }
  function declared(id,heap,origin,fieldSeeds,objects,active=new Set(),entry=undefined,selected=false,view=id) {
    spend();const type=types.get(id);check(type,'type');const value=empty();
    if(type.kind==='unknown'){value.unknown=true;return value;}
    if(type.kind==='function'){value.tags.add(id);value.unknown=true;return value;}
    if(type.kind==='union'){for(const member of type.members)merge(value,declared(member,heap,origin,fieldSeeds,objects,collections.set(active),entry));return value;}
    if(type.kind==='reference'&&entry&&!selected){
      for(const actual of entry.sources(view))merge(value,declared(actual,heap,origin,fieldSeeds,objects,collections.set(active),entry,true,view));return value;
    }
    value.tags.add(id);if(type.name==='bool')value.truth=3;
    if(['reference','value','array','readSpan'].includes(type.kind)) {
      const ref=origin+'/'+id,role=entry?ref+'\0'+view:ref;value.refs.add(ref);if(active.has(role))return value;active.add(role);objects.set(ref,{type:id,weak:true});
      if(['value','reference'].includes(type.kind))for(const field of fields(id)) {
        const slot=ref+'/field/'+field.id;if(heap.has(slot)&&!entry)continue;
        // Reference cycles stop at an existing abstract object. Inline cycles
        // were independently rejected at the cold catalogue seam.
        const fieldView=entry?.field(id,view,field.id);
        const child=fieldView?entryStorage(field.type,fieldView,heap,origin,fieldSeeds,objects,collections.set(active),entry)
          :declared(field.type,heap,origin,fieldSeeds,objects,collections.set(active));
        if(fieldSeeds.has(field.sourceBinding)){
          const upper=fieldSeeds.get(field.sourceBinding);spend(upper.tags.size);child.unknown ||= upper.unknown;
          for(const tag of upper.tags)merge(child,declared(tag,heap,origin,fieldSeeds,objects,collections.set(active),entry));
        }if(entry&&heap.has(slot))merge(heap.get(slot),child);else heap.set(slot,child);
        entry?.observe('field',field.sourceBinding,child);
      }
      if(type.kind==='array'){
        const logical=types.get(view),child=entry?entryStorage(type.elementType,logical.elementType,heap,origin,fieldSeeds,objects,collections.set(active),entry)
          :declared(type.elementType,heap,origin,fieldSeeds,objects,collections.set(active)),upper=model.elementSeeds?.get('element:'+id);
        if(upper){child.unknown ||= upper.unknown;spend(upper.tags.size);for(const tag of upper.tags)merge(child,declared(tag,heap,origin,fieldSeeds,objects,collections.set(active),entry));}
        if(entry&&heap.has(ref+'/element/*'))merge(heap.get(ref+'/element/*'),child);else heap.set(ref+'/element/*',child);
        entry?.observe('element','element:'+id,child);
      }
      if(type.kind==='readSpan'){const array=arrays.get(type.elementType);
        if(array)heap.set(ref+'/owner',declared(array.id,heap,origin,fieldSeeds,objects,collections.set(active),entry,true,view));}
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
  function environmentSlot(selected,start,target,slotKey,heap,objects){
    spend(selected.refs.size+selected.tags.size+1);const pending=[],seen=new Set(),value=empty();
    let complete=!selected.unknown&&selected.refs.size>0,valid=!selected.unknown,hasSlot=false;
    const targetLayout=model.environments.get(target);
    for(const slot of targetLayout?.slots??[]){spend();hasSlot ||= slot.key===slotKey;}
    if(!hasSlot)return {value,complete:false,valid:false};
    for(const tag of selected.tags){spend();if(tag!=='env:'+start){valid=false;complete=false;}}
    for(const ref of selected.refs)pending.push({ref,layout:start});
    for(let i=0;i<pending.length;i++){
      spend();const row=pending[i],token=row.ref+'\0'+row.layout;if(seen.has(token))continue;seen.add(token);
      const layout=model.environments.get(row.layout);
      if(!layout||objects.get(row.ref)?.type!=='env:'+row.layout){valid=false;complete=false;continue;}
      if(row.layout===target){
        const stored=heap.get(row.ref+'/slot/'+slotKey);if(!stored){complete=false;continue;}merge(value,stored);continue;
      }
      const parent=heap.get(row.ref+'/parent');
      if(!layout.parent||!parent){complete=false;continue;}
      if(parent.unknown||!parent.refs.size)complete=false;
      for(const tag of parent.tags){spend();if(tag!=='env:'+layout.parent){valid=false;complete=false;}}
      check(pending.length+parent.refs.size<=65536,'limit');spend(parent.refs.size);
      for(const ref of parent.refs)pending.push({ref,layout:layout.parent});
    }
    return {value,complete,valid};
  }
  const state=()=>({values:new Map(),heap:new Map(),regions:new Map()});
  const clone=s=>({values:snapshot(s.values),heap:snapshot(s.heap),regions:regions.heapCopy(s.regions)});
  const join=(to,from)=>{const a=joinHeap(to.values,from.values),b=joinHeap(to.heap,from.heap),c=regions.heapJoin(to.regions,from.regions);return a||b||c;};
  return {empty,key,copy,merge,literal,snapshot,joinHeap,fields,declared,reachable,environmentSlot,state,clone,join,
    arrayType:element=>arrays.get(element),id:value=>sha256(canonical(value))};
}
