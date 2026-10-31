// SPDX-License-Identifier: MIT
// Finite abstract values are private analysis state, never Runtime objects.
// Actual payload tags and object/Cell identities remain distinct from views.
import {canonical,sha256} from './identity.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
import {commonRegions,emptyRegionValue} from './common-program-regions.mjs';
// A source view alone is not an actual managed Array receiver. All finite tags
// and references must describe the same complete set of known Array objects.
export function commonActualArrayReceiver(value,types,objects,spend){
  spend(value.tags.size+value.refs.size+1);
  if(value.unknown||value.cells.size||value.pairs.size||!value.tags.size||!value.refs.size)return false;
  const actual=new Set();for(const ref of value.refs){spend(1);const type=objects.get(ref)?.type;if(types.get(type)?.kind!=='array')return false;actual.add(type);}
  for(const tag of value.tags){spend(1);if(!actual.has(tag))return false;}
  return actual.size===value.tags.size;
}
// A same-call raw-prefix index only. Entries retain the original heap order
// and reference its Values read-only; callers own walking/copying semantics.
// The caller must rebuild after any heap mutation, never cache by Map identity.
/** @template Value @param {Map<string,Value>} heap @param {(units:number)=>void} spend */
export function commonActualHeapPrefixes(heap,spend){
  // The range path is the original paid d51 key-order index. Only the
  // consumer that needs heap order constructs ordinal rows and sorts matches.
  spend(heap.size+1);const rows=[...heap];rows.sort(([left],[right])=>{spend(1);return left<right?-1:left>right?1:0;});
  /** @type {Map<string,number>|null} */ let ordinals=null;
  /** @param {string} ref */
  function* range(ref){
    spend(Math.ceil(ref.length/64)+1);const prefix=ref+'/';let low=0,high=rows.length;
    while(low<high){spend(1);const middle=low+Math.floor((high-low)/2);if(rows[middle][0]<prefix)low=middle+1;else high=middle;}
    for(let at=low;at<rows.length;at++){spend(2);const entry=rows[at];if(!entry[0].startsWith(prefix))break;yield entry;}
  }
  /** @param {string} ref */
  const inHeapOrder=ref=>{
    if(ordinals===null){spend(heap.size+1);ordinals=new Map();let order=0;for(const id of heap.keys())ordinals.set(id,order++);}
    /** @type {{entry:[string,Value],order:number}[]} */ const matches=[];
    for(const entry of range(ref)){spend(3);matches.push({entry,order:ordinals.get(entry[0])});}
    matches.sort((left,right)=>{spend(1);return left.order-right.order;});spend(matches.length+1);return matches.map(row=>row.entry);
  };
  return {range,inHeapOrder};
}

export function commonAbstract(model) {
  const {spend,types}=model,collections=commonCollections(spend),regions=commonRegions(spend),arrays=new Map();
  const noOrigin=Object.freeze(emptyRegionValue()),emptyOrigin=Object.freeze({...emptyRegionValue(),empty:true});
  for(const type of types.values()){spend(1);if(type.kind==='array')arrays.set(type.elementType,type);}
  const empty=()=>({tags:new Set(),refs:new Set(),cells:new Set(),pairs:new Map(),frames:new Set(),cursors:new Set(),truth:0,unknown:false,number:null,region:noOrigin});
  // Relation operations pay for their own copies/joins; do not charge that
  // work twice as part of the independent payload collections.
  const weight=v=>v.tags.size+v.refs.size+v.cells.size+v.pairs.size+v.frames.size+v.cursors.size+1;
  const key=v=>{
    check(v.tags.size<=256&&v.refs.size<=256&&v.cells.size<=256&&v.pairs.size<=256,'limit');
    spend(weight(v));
    const text=value=>spend(Math.ceil(value.length*6/8)+1);
    const compare=(left,right)=>{spend(Math.ceil(Math.min(left.length,right.length)/8)+1);return left<right?-1:left>right?1:0;};
    for(const name of ['tags','refs','cells','frames','cursors'])for(const id of v[name])text(id);
    for(const [id,pair]of v.pairs){text(id);text(pair.functionId);if(pair.environment!==null)text(pair.environment);}
    return canonical({tags:collections.sorted(v.tags,compare),refs:collections.sorted(v.refs,compare),cells:collections.sorted(v.cells,compare),
      pairs:collections.sorted(v.pairs,([left],[right])=>compare(left,right)),frames:collections.sorted(v.frames,compare),cursors:collections.sorted(v.cursors,compare),truth:v.truth,unknown:v.unknown,number:v.number});
  };
  // Absence is an immutable facet; only actual origin sets need snapshots.
  const copy=v=>{spend(weight(v));return {...v,tags:new Set(v.tags),refs:new Set(v.refs),cells:new Set(v.cells),pairs:new Map(v.pairs),frames:new Set(v.frames),cursors:new Set(v.cursors),
    region:!v.region.roots.size&&!v.region.opaque?v.region.empty?emptyOrigin:noOrigin:regions.copy(v.region)};};
  function merge(to,from) {
    spend(weight(to)+weight(from));let changed=false;const blank=to.tags.size===0&&!to.unknown;
    // Detect the finite lattice delta while visiting its collections once;
    // serializing and sorting the entire value twice is unnecessary here.
    for(const [key,pair]of from.pairs){const prior=to.pairs.get(key);if(!prior||prior.functionId!==pair.functionId||prior.environment!==pair.environment){to.pairs.set(key,pair);changed=true;}}
    for(const name of ['tags','refs','cells','frames','cursors'])for(const id of from[name])if(!to[name].has(id)){to[name].add(id);changed=true;}
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
    while(type){spend(1);check(!seen.has(type.id),'type');seen.add(type.id);layers.push(type.fields??[]);type=types.get(type.base);}
    for(let i=layers.length-1;i>=0;i--){spend(layers[i].length);for(const field of layers[i])result.push(field);}return result;};
  function entryStorage(source,view,heap,origin,fieldSeeds,objects,active,entry) {
    spend(1);const logical=types.get(view);check(logical,'type');const result=empty();
    if(logical.kind==='union'){
      for(const member of logical.members)merge(result,entryStorage(source,member,heap,origin,fieldSeeds,objects,collections.set(active),entry));return result;
    }
    if(['array','readSpan'].includes(logical.kind)){
      const pending=[source],seen=new Set(),containers=[];
      while(pending.length){spend(1);const id=pending.pop();if(seen.has(id))continue;seen.add(id);const type=types.get(id);check(type,'type');
        if(type.kind==='union'){spend(type.members.length);for(const member of type.members)pending.push(member);}
        else if(['array','readSpan'].includes(type.kind))containers.push(id);}
      if(!containers.length)containers.push(view);
      for(const id of containers)merge(result,declared(id,heap,origin,fieldSeeds,objects,collections.set(active),entry,true,view));return result;
    }
    return declared(view,heap,origin,fieldSeeds,objects,active,entry);
  }
  function declared(id,heap,origin,fieldSeeds,objects,active=new Set(),entry=undefined,selected=false,view=id) {
    spend(1);const type=types.get(id);check(type,'type');const value=empty();
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
  function reach(values,heap) {
    spend(values.length+heap.size);const result=new Map(),pending=[...values],visited=new Set();
    for(const [id,v]of heap)if(id.startsWith('global:')){result.set(id,v);pending.push(v);}
    const query=commonActualHeapPrefixes(heap,spend);
    for(let i=0;i<pending.length;i++)for(const ref of pending[i].refs){
      spend(1);if(visited.has(ref))continue;visited.add(ref);
      for(const [id,value]of query.range(ref)){spend(1);if(!result.has(id)){result.set(id,value);pending.push(value);}}
    }
    return {entries:result,refs:visited};
  }
  // References-only selection consumes the same walk without allocating
  // payload copies it will immediately discard. Neither API retains a
  // mutable source value: reachable returns owned copies; this returns IDs.
  const reachableRefs=(values,heap)=>reach(values,heap).refs;
  const reachable=(values,heap)=>{const {entries}=reach(values,heap);spend(entries.size);for(const [id,value]of entries)entries.set(id,copy(value));return entries;};
  function environmentSlot(selected,start,target,slotKey,heap,objects){
    spend(selected.refs.size+selected.tags.size+1);const pending=[],seen=new Set(),value=empty();
    let complete=!selected.unknown&&selected.refs.size>0,valid=!selected.unknown,hasSlot=false;
    const targetLayout=model.environments.get(target);
    for(const slot of targetLayout?.slots??[]){spend(1);hasSlot ||= slot.key===slotKey;}
    if(!hasSlot)return {value,complete:false,valid:false};
    for(const tag of selected.tags){spend(1);if(tag!=='env:'+start){valid=false;complete=false;}}
    for(const ref of selected.refs)pending.push({ref,layout:start});
    for(let i=0;i<pending.length;i++){
      spend(1);const row=pending[i],token=row.ref+'\0'+row.layout;if(seen.has(token))continue;seen.add(token);
      const layout=model.environments.get(row.layout);
      if(!layout||objects.get(row.ref)?.type!=='env:'+row.layout){valid=false;complete=false;continue;}
      if(row.layout===target){
        const stored=heap.get(row.ref+'/slot/'+slotKey);if(!stored){complete=false;continue;}merge(value,stored);continue;
      }
      const parent=heap.get(row.ref+'/parent');
      if(!layout.parent||!parent){complete=false;continue;}
      if(parent.unknown||!parent.refs.size)complete=false;
      for(const tag of parent.tags){spend(1);if(tag!=='env:'+layout.parent){valid=false;complete=false;}}
      check(pending.length+parent.refs.size<=65536,'limit');spend(parent.refs.size);
      for(const ref of parent.refs)pending.push({ref,layout:layout.parent});
    }
    return {value,complete,valid};
  }
  const state=()=>({values:new Map(),heap:new Map(),regions:new Map()});
  // Internal dataflow forks share read-only payload sets/maps. Each shell and
  // relation is owned; every destination write/join below detaches first,
  // including writes to the original parent after a fork.
  const forkValue=value=>{spend(1);return {...value,
    region:!value.region.roots.size&&!value.region.opaque?value.region.empty?emptyOrigin:noOrigin:regions.copy(value.region)};};
  const forkHeap=heap=>collections.map(heap,forkValue);
  const fork=s=>({values:collections.map(s.values,forkValue),heap:forkHeap(s.heap),regions:regions.heapCopy(s.regions)});
  function writeFork(heap,id,value,strong=false){
    spend(1);if(strong||!heap.has(id)){heap.set(id,copy(value));return true;}
    const before=heap.get(id);spend(2);
    // Fork shells retain the same immutable payload collections until a
    // destination changes. Prove a no-op before paying for a detached copy.
    if(before.tags===value.tags&&before.refs===value.refs&&before.cells===value.cells&&before.pairs===value.pairs&&before.frames===value.frames&&before.cursors===value.cursors&&before.truth===value.truth&&before.unknown===value.unknown&&before.number===value.number&&
      before.region.opaque===value.region.opaque&&before.region.empty===value.region.empty&&before.region.number===value.region.number&&before.region.roots.size===value.region.roots.size&&
      (before.region.roots.size||before.region.opaque||before.region.number===null)){
      spend(before.region.roots.size);let equal=true;for(const root of before.region.roots)if(!value.region.roots.has(root)){equal=false;break;}
      if(equal)return false;
    }
    const next=copy(before);
    // Detachment preserves the exact pre-join relation. The merge itself owns
    // the established execution-domain normalization, not an earlier copy.
    next.region=regions.copy(before.region);const changed=merge(next,value);heap.set(id,next);return changed;
  }
  const joinFork=(to,from)=>{
    let changed=false;for(const name of ['values','heap']){spend(from[name].size);
      for(const [id,value]of from[name])changed=writeFork(to[name],id,value)||changed;}
    return regions.heapJoin(to.regions,from.regions)||changed;
  };
  return {empty,key,copy,merge,literal,snapshot,joinHeap,fields,declared,reachable,reachableRefs,environmentSlot,state,fork,forkHeap,writeFork,joinFork,
    arrayType:element=>arrays.get(element),id:value=>sha256(canonical(value))};
}
