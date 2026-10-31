// SPDX-License-Identifier: MIT
// Constructor control metadata for the existing actual solver. No AST, heap
// interpreter, entry object, fixed upper, layout or independent work budget.
import {commonCheck as check} from './common-program-common.mjs';

// ValueOps own copying/joins. Exact entry comparisons use the shared typed
// payload/Value callbacks, never a second value interpretation or encoding.
export function commonReceiverActual({spend,types,objects},a) {
  const frames=new Map(),cursors=new Map();
  const text=value=>spend(Math.ceil(value.length/8)+1);
  const data=value=>value.unknown||value.tags.size>0||value.refs.size>0||value.pairs.size>0;
  const ordinary=value=>{check(!value.frames.size&&!value.cursors.size&&!value.cells.size,'receiver-actual','control/Cell value is not a selected language receiver');
    for(const tag of value.tags){text(tag);check(!tag.startsWith('env:'),'receiver-actual','an environment carrier is not a language receiver');}};
  const frame=id=>{spend();const info=frames.get(id);check(info,'receiver-actual','unknown frame identity');return info;};
  const cursor=id=>{spend();const info=cursors.get(id);check(info,'receiver-actual','unknown cursor identity');return info;};
  const state=(world,id)=>{spend();const value=world.get(id);check(value,'receiver-actual','frame is absent from this completion');return value;};
  // Birth defaults are temporary contributions of this construction, not
  // actual stores. Keep the historical/real lattice separately so a definite
  // definition can remove only this birth's default, including on weak sites.
  // Values here are analysis data, never a fresh-object or GC permission.
  const copyReal=value=>{const copied=a.copy(value);spend(value.region.roots.size+4);
    copied.region={...value.region,roots:new Set(value.region.roots)};return copied;};
  const copyBirth=row=>{spend(3);return {...row,real:copyReal(row.real)};};
  const copyBinding=value=>{spend(value.births.size+9);const births=new Map();
    for(const [slot,row]of value.births)births.set(slot,copyBirth(row));return {...value,bound:a.copy(value.bound),births};};
  const shared=new WeakSet();
  const store=()=>new Map();
  const clone=world=>{spend(world.size);const result=store();for(const [id,value]of world)result.set(id,copyBinding(value));return result;};
  // Solver-only forks share read-only rows. Mark both sides by row identity;
  // every owner mutation detaches its destination, including a later parent write.
  const fork=world=>{spend(world.size*3+1);const result=store();for(const [id,value]of world){shared.add(value);result.set(id,value);}return result;};
  const edit=(world,id)=>{const value=state(world,id);spend();if(!shared.has(value))return value;
    const owned=copyBinding(value);spend();world.set(id,owned);return owned;};
  function join(into,from) {
    if(into===from)return false;
    spend(from.size);let changed=false;
    for(const [id,incoming]of from){
      spend();const previous=into.get(id);
      if(!previous){const copied=copyBinding(incoming);into.set(id,copied);changed=true;continue;}
      const value=edit(into,id);changed=a.merge(value.bound,incoming.bound)||changed;
      spend(incoming.births.size);
      for(const [slot,row]of incoming.births){const old=value.births.get(slot);
        if(!old){value.births.set(slot,copyBirth(row));changed=true;}
        else {changed=a.merge(old.real,row.real)||changed;if(row.pending&&!old.pending){old.pending=true;changed=true;}}}
      const unbound=value.unbound||incoming.unbound,weak=value.weak||incoming.weak,pending=value.pending||incoming.pending,
        initializing=value.initializing||incoming.initializing,aborted=value.aborted||incoming.aborted,
        prefixMin=Math.min(value.prefixMin,incoming.prefixMin),prefixMax=Math.max(value.prefixMax,incoming.prefixMax);
      changed ||= unbound!==value.unbound||weak!==value.weak||pending!==value.pending||initializing!==value.initializing||aborted!==value.aborted
        ||prefixMin!==value.prefixMin||prefixMax!==value.prefixMax;
      Object.assign(value,{unbound,weak,pending,initializing,aborted,prefixMin,prefixMax});
    }
    return changed;
  }
  const overlay=(into,from)=>{if(into===from)return;spend(from.size);for(const [id,value]of from){const copied=copyBinding(value);into.set(id,copied);}};
  const same=(left,right,identity)=>{
    spend(left.size+right.size+1);if(left.size!==right.size)return false;
    for(const [id,value]of left){text(id);const other=right.get(id);if(!other)return false;
      spend(7+value.births.size+other.births.size);
      if(value.unbound!==other.unbound||value.weak!==other.weak||value.pending!==other.pending||value.initializing!==other.initializing||value.aborted!==other.aborted||value.prefixMin!==other.prefixMin||value.prefixMax!==other.prefixMax||value.births.size!==other.births.size)return false;
      // Bound regions are deliberately outside the former control payload key.
      // The ordered retained Value projection compares those regions separately.
      if(!identity.samePayload(value.bound,other.bound))return false;
      for(const [slot,row]of value.births){text(slot);const prior=other.births.get(slot);if(!prior)return false;
        text(row.ref);text(prior.ref);spend(2);
        if(row.ref!==prior.ref||row.pending!==prior.pending||!identity.sameValue(row.real,prior.real))return false;}
    }return true;
  };
  function selectedIds(world,values,heap) {
    spend(values.length);const selected=new Set(),pending=[];
    for(const value of values){spend(value.frames.size+value.cursors.size);
      for(const id of value.frames)pending.push(id);for(const id of value.cursors)pending.push(cursor(id).frame);}
    for(let index=0;index<pending.length;index++){
      spend();const id=pending[index];if(selected.has(id))continue;state(world,id);selected.add(id);
      const parent=frame(id).parent;if(parent!==null)pending.push(parent);
    }
    // An ordinary helper may receive the allocated object without its Frame.
    // Keep provenance for reachable births too; no new language/data identity
    // is made. Use the existing paid reachability, including nested objects.
    spend(world.size);let births=false;for(const value of world.values())births ||= value.births.size>0;
    if(births){const refs=heap?a.reachableRefs(values,heap):new Set();
      if(!heap){spend(values.length);for(const value of values){spend(value.refs.size);for(const ref of value.refs)refs.add(ref);}}
      spend(world.size);for(const [id,value]of world){spend(value.births.size);for(const row of value.births.values())if(refs.has(row.ref)){selected.add(id);break;}}
    }
    spend(selected.size);for(const id of selected){let parent=frame(id).parent;
      while(parent!==null&&!selected.has(parent)){state(world,parent);selected.add(parent);parent=frame(parent).parent;}}
    return selected;
  }
  const copySelected=(world,selected)=>{const result=store();for(const id of selected){const copied=copyBinding(state(world,id));result.set(id,copied);}return result;};
  const select=(world,values,heap)=>copySelected(world,selectedIds(world,values,heap));
  // API order: bound payloads follow stable codepoint FrameId order, including
  // selected parents. Callers may attach region keys by this position.
  const retainedSelected=(world,selected)=>{
    spend(selected.size*2+1);
    const ids=[...selected];ids.sort((left,right)=>{text(left);text(right);return left<right?-1:left>right?1:0;});
    const result=[];for(const id of ids){const value=state(world,id);if(data(value.bound))result.push(a.copy(value.bound));
      spend(value.births.size*2);const slots=[...value.births.keys()];slots.sort((left,right)=>{text(left);text(right);return left<right?-1:left>right?1:0;});
      for(const slot of slots)result.push(copyReal(value.births.get(slot).real));}return result;
  };
  const retained=(world,values,heap)=>retainedSelected(world,selectedIds(world,values,heap));
  // Selection is the shared deep boundary. Both outputs own their payloads;
  // no caller heap is reused or kept alive across a later mutation.
  const snapshot=(world,values,heap)=>{const selected=selectedIds(world,values,heap);return {frames:copySelected(world,selected),retained:retainedSelected(world,selected)};};
  // The trusted relation-plane callback visits owned bound Values, not
  // retained copies. Include non-live bindings so a later GetThis cannot
  // restore an old relation. The callback preserves payload/control facts.
  const feedback=(world,visitBound)=>{
    spend(world.size);for(const id of world.keys()){const value=edit(world,id);visitBound(value.bound);spend(value.births.size);for(const row of value.births.values())visitBound(row.real);}
  };

  const birth=(world,id,ref,fields,heap,repeated)=>{
    text(ref);spend(fields.length);const rows=[];
    for(const field of fields){text(field);const slot=ref+'/field/'+field;
      rows.push([slot,{ref,real:repeated&&heap.has(slot)?copyReal(heap.get(slot)):a.empty(),pending:true}]);}
    for(let current=id;current!==null;current=frame(current).parent){const value=edit(world,current);spend(rows.length);
      for(const [slot,row]of rows)value.births.set(slot,copyBirth(row));}
  };
  // All real logical writes, including helper stores of undefined, feed this
  // lattice. Synthetic allocation/begin defaults must not use this boundary.
  const write=(world,slot,input,strong=false)=>{spend(world.size);for(const [id,binding]of world){
    if(binding.births.has(slot)){const row=edit(world,id).births.get(slot);if(strong){row.real=copyReal(input);row.pending=false;}else a.merge(row.real,input);}}};
  const define=(world,ids,selected,field)=>{
    // A union receiver may leave another current birth uninitialized. Only
    // the exact selected birth loses its own temporary default.
    if(selected.unknown||selected.refs.size!==1||ids.size!==1)return;
    const id=ids.values().next().value,ref=selected.refs.values().next().value;const value=state(world,cursor(id).frame);
    text(ref);text(field);const slot=ref+'/field/'+field;if(!value.births.has(slot))return;
    spend(world.size);for(const [id,binding]of world)if(binding.births.has(slot))edit(world,id).births.get(slot).pending=false;
  };
  const reconcile=(world,heap,missing)=>{
    spend(world.size);const rows=new Map();
    for(const value of world.values()){spend(value.births.size);for(const [slot,row]of value.births){const old=rows.get(slot);
      if(!old)rows.set(slot,copyBirth(row));else {a.merge(old.real,row.real);old.pending ||= row.pending;}}}
    for(const [slot,row]of rows){if(row.pending)a.merge(row.real,missing);heap.set(slot,row.real);}
  };

  function create(world,{activation,site,owner,construction,newTarget,derived,fields,repeated=false,parent=null}) {
    for(const value of [activation,site,owner,construction,newTarget,parent??''])text(value);
    const id='receiver:'+a.id([activation,site,owner,construction,newTarget,parent]);
    if(!frames.has(id)){
      spend(fields.length+8);for(const field of fields)text(field);
      const info=Object.freeze({owner,construction,newTarget,parent,derived,fields:Object.freeze([...fields])});frames.set(id,info);
    }
    const old=world.get(id);
    if(old&&repeated){const value=edit(world,id);value.weak=true;value.unbound=true;value.prefixMin=0;}
    else {spend(9);world.set(id,{unbound:true,weak:repeated,pending:false,bound:a.empty(),initializing:false,aborted:false,prefixMin:0,prefixMax:0,births:new Map()});}
    return id;
  }
  const child=(world,parents,definition)=>{
    spend(parents.size);const result=new Set();
    for(const parent of parents){const info=frame(parent),value=state(world,parent);
      result.add(create(world,{...definition,newTarget:info.newTarget,parent,repeated:definition.repeated||value.weak}));}
    return result;
  };
  const allocate=(world,ids,makeObject)=>{
    const result=a.empty();spend(ids.size);
    for(const id of ids){const info=frame(id);check(!info.derived,'receiver-actual','only a base frame allocates');
      const value=makeObject(info.newTarget,id,state(world,id).weak);ordinary(value);a.merge(result,value);}
    return result;
  };
  const category=tag=>{
    spend();const kind=types.get(tag)?.kind;
    if(['reference','value','array','function'].includes(kind))return 'object';
    if(kind==='undefined'||kind==='void')return 'undefined';
    if(['scalar','string','null'].includes(kind))return 'primitive';
    return 'pending'; // ReadSpan remains a borrowed-view classification OPEN.
  };
  function split(input) {
    ordinary(input);const object=a.copy(input);object.tags.clear();object.refs.clear();object.pairs.clear();
    let undefinedValue=input.unknown,primitive=input.unknown,pending=input.unknown,callable=false;
    for(const tag of input.tags){const kind=category(tag);
      if(kind==='undefined')undefinedValue=true;else if(kind==='primitive')primitive=true;
      else {object.tags.add(tag);pending ||= kind==='pending';callable ||= types.get(tag)?.kind==='function';}}
    for(const ref of input.refs){spend();const tag=objects.get(ref)?.type;
      if(callable&&input.pairs.size){object.refs.add(ref);continue;}
      if(tag!==undefined){const kind=category(tag);if(kind==='object'||kind==='pending'){object.refs.add(ref);pending ||= kind==='pending';}}
      else {object.refs.add(ref);pending=true;}
    }
    if(callable||input.unknown){spend(input.pairs.size);for(const [id,pair]of input.pairs)object.pairs.set(id,pair);}
    // An unresolved object category has both object and non-undefined
    // primitive possibilities. It never manufactures a new actual tag.
    primitive ||= pending;
    return {object:data(object)?object:a.empty(),undefinedValue,primitive,pending};
  }
  const output=()=>({normal:null,language:null,pending:false});
  const normal=(out,world,value)=>{
    if(!out.normal)out.normal={frames:world,value:a.copy(value)};
    else {join(out.normal.frames,world);a.merge(out.normal.value,value);}
  };
  const language=(out,world,reason)=>{
    if(!out.language)out.language={frames:world,reasons:new Set([reason])};
    else {join(out.language.frames,world);out.language.reasons.add(reason);}
  };
  function bind(world,ids,selected) {
    const out=output(),parts=split(selected);out.pending=parts.pending;
    check(!parts.undefinedValue&&!parts.primitive||parts.pending,'receiver-actual','completed Construct must select an object');
    if(!data(parts.object))return out;
    spend(ids.size);
    for(const id of ids){const before=state(world,id);
      if(before.unbound){const after=clone(world),value=edit(after,id);
        if(value.weak){a.merge(value.bound,parts.object);value.prefixMin=0;value.pending ||= parts.pending;}
        else {value.bound=a.copy(parts.object);value.unbound=false;value.pending=parts.pending;value.initializing=false;value.aborted=false;value.prefixMin=0;value.prefixMax=0;}
        normal(out,after,parts.object);
      }
      if(data(before.bound)){const after=clone(world);if(!before.weak)edit(after,id).unbound=false;language(out,after,'duplicate-bind');}
    }
    return out;
  }
  function get(world,ids) {
    const out=output();spend(ids.size);
    for(const id of ids){const before=state(world,id);
      if(data(before.bound)){const after=clone(world);if(!before.weak)edit(after,id).unbound=false;normal(out,after,before.bound);out.pending ||= before.pending||before.bound.unknown;}
      if(before.unbound){const after=clone(world);if(!before.weak){const value=edit(after,id);value.bound=a.empty();value.initializing=false;value.prefixMin=0;value.prefixMax=0;}
        language(out,after,'unbound-this');}
    }
    return out;
  }
  function result(world,ids,returned=undefined) {
    const out=output(),parts=returned===undefined?{object:a.empty(),undefinedValue:true,primitive:false,pending:false}:split(returned);
    out.pending=parts.pending;spend(ids.size);
    for(const id of ids){
      const info=frame(id);state(world,id);
      if(data(parts.object))normal(out,clone(world),parts.object);
      if(parts.undefinedValue||parts.primitive&&!info.derived){
        spend();const one=new Set([id]),selected=get(world,one);out.pending ||= selected.pending;
        if(selected.normal)normal(out,selected.normal.frames,selected.normal.value);
        if(selected.language)for(const reason of selected.language.reasons)language(out,selected.language.frames,reason);
      }
      if(parts.primitive&&info.derived)language(out,clone(world),'derived-primitive-return');
    }
    return out;
  }
  const token=(id,position)=>{
    text(id);spend();const key='initialization:'+a.id([id,position]);
    if(!cursors.has(key))cursors.set(key,Object.freeze({frame:id,position}));return key;
  };
  const begin=(world,ids)=>{
    spend(ids.size);const result=new Set();for(const id of ids){check(data(state(world,id).bound),'receiver-actual','initialization requires selected bound this');const value=edit(world,id);
      value.initializing=true;if(value.weak)value.prefixMin=0;else {value.aborted=false;value.prefixMin=0;value.prefixMax=0;}result.add(token(id,0));}return result;
  };
  const advance=(world,ids,field)=>{
    spend(ids.size);const result=new Set();for(const id of ids){const current=cursor(id),info=frame(current.frame);
      check(state(world,current.frame).initializing&&info.fields[current.position]===field,'receiver-actual','initializer must advance its exact field prefix');
      const value=edit(world,current.frame),next=current.position+1;if(value.weak)value.prefixMax=Math.max(value.prefixMax,next);else value.prefixMin=value.prefixMax=next;result.add(token(current.frame,next));}return result;
  };
  const end=(world,ids)=>{
    spend(ids.size);for(const id of ids){const current=cursor(id),info=frame(current.frame),value=state(world,current.frame);
      check(value.initializing&&current.position===info.fields.length,'receiver-actual','initializer must end its complete prefix');if(!value.weak)edit(world,current.frame).initializing=false;}
  };
  const abort=(world,ids=null)=>{
    if(ids===null){spend(world.size);for(const [id,binding]of world)if(binding.initializing){const value=edit(world,id);if(!value.weak)value.initializing=false;value.aborted=true;}return;}
    spend(ids.size);for(const id of ids){const frameId=cursor(id).frame;if(state(world,frameId).initializing){const value=edit(world,frameId);if(!value.weak)value.initializing=false;value.aborted=true;}}
  };
  return {store,clone,fork,join,overlay,same,select,retained,snapshot,feedback,birth,write,define,reconcile,frame,cursor,create,child,allocate,bind,get,result,begin,advance,end,abort};
}
