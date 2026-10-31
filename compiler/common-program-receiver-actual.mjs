// SPDX-License-Identifier: MIT
// Constructor control metadata for the existing actual solver. No AST, heap
// interpreter, entry object, fixed upper, layout or independent work budget.
import {canonical,commonCheck as check} from './common-program-common.mjs';

// a is trusted, owned ValueOps: copy/merge precharge their own traversal and
// key precharges collection expansion, comparisons and worst-case escaped
// serialization BEFORE doing that work, using this same spend callback.
// The later text(bound) fee pays for embedding the completed key string in
// the outer frame key; it cannot pay retroactively for a.key's construction.
export function commonReceiverActual({spend,types,objects},a) {
  const frames=new Map(),cursors=new Map();
  const text=value=>spend(Math.ceil(value.length/8)+1);
  const data=value=>value.unknown||value.tags.size>0||value.refs.size>0||value.pairs.size>0;
  const ordinary=value=>{check(!value.frames.size&&!value.cursors.size&&!value.cells.size,'receiver-actual','control/Cell value is not a selected language receiver');
    for(const tag of value.tags){text(tag);check(!tag.startsWith('env:'),'receiver-actual','an environment carrier is not a language receiver');}};
  const frame=id=>{spend();const info=frames.get(id);check(info,'receiver-actual','unknown frame identity');return info;};
  const cursor=id=>{spend();const info=cursors.get(id);check(info,'receiver-actual','unknown cursor identity');return info;};
  const state=(world,id)=>{spend();const value=world.get(id);check(value,'receiver-actual','frame is absent from this completion');return value;};
  const copyBinding=value=>{spend(8);return {...value,bound:a.copy(value.bound)};};
  const store=()=>new Map();
  const clone=world=>{spend(world.size);const result=store();for(const [id,value]of world)result.set(id,copyBinding(value));return result;};
  function join(into,from) {
    if(into===from)return false;
    spend(from.size);let changed=false;
    for(const [id,incoming]of from){
      spend();const value=into.get(id);
      if(!value){const copied=copyBinding(incoming);into.set(id,copied);changed=true;continue;}
      changed=a.merge(value.bound,incoming.bound)||changed;
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
  const key=world=>{
    spend(world.size);const rows=[];
    for(const [id,value]of world){text(id);const bound=a.key(value.bound);text(bound);
      rows.push([id,value.unbound,value.weak,value.pending,value.initializing,value.aborted,value.prefixMin,value.prefixMax,bound]);}
    rows.sort((left,right)=>{text(left[0]);text(right[0]);return left[0]<right[0]?-1:left[0]>right[0]?1:0;});return canonical(rows);
  };
  function selectedIds(world,values) {
    spend(values.length);const selected=new Set(),pending=[];
    for(const value of values){spend(value.frames.size+value.cursors.size);
      for(const id of value.frames)pending.push(id);for(const id of value.cursors)pending.push(cursor(id).frame);}
    for(let index=0;index<pending.length;index++){
      spend();const id=pending[index];if(selected.has(id))continue;state(world,id);selected.add(id);
      const parent=frame(id).parent;if(parent!==null)pending.push(parent);
    }
    return selected;
  }
  const select=(world,values)=>{const result=store();for(const id of selectedIds(world,values)){const copied=copyBinding(state(world,id));result.set(id,copied);}return result;};
  // API order: bound payloads follow stable codepoint FrameId order, including
  // selected parents. Callers may attach region keys by this position.
  const retained=(world,values)=>{
    const selected=selectedIds(world,values);spend(selected.size*2+1);
    const ids=[...selected];ids.sort((left,right)=>{text(left);text(right);return left<right?-1:left>right?1:0;});
    const result=[];for(const id of ids){const value=state(world,id).bound;if(data(value))result.push(a.copy(value));}return result;
  };

  function create(world,{activation,site,owner,construction,newTarget,derived,fields,repeated=false,parent=null}) {
    for(const value of [activation,site,owner,construction,newTarget,parent??''])text(value);
    const id='receiver:'+a.id([activation,site,owner,construction,newTarget,parent]);
    if(!frames.has(id)){
      spend(fields.length+8);for(const field of fields)text(field);
      const info=Object.freeze({owner,construction,newTarget,parent,derived,fields:Object.freeze([...fields])});frames.set(id,info);
    }
    const old=world.get(id);
    if(old&&repeated){old.weak=true;old.unbound=true;old.prefixMin=0;}
    else {spend(8);world.set(id,{unbound:true,weak:repeated,pending:false,bound:a.empty(),initializing:false,aborted:false,prefixMin:0,prefixMax:0});}
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
      if(before.unbound){const after=clone(world),value=state(after,id);
        if(value.weak){a.merge(value.bound,parts.object);value.prefixMin=0;value.pending ||= parts.pending;}
        else {value.bound=a.copy(parts.object);value.unbound=false;value.pending=parts.pending;value.initializing=false;value.aborted=false;value.prefixMin=0;value.prefixMax=0;}
        normal(out,after,parts.object);
      }
      if(data(before.bound)){const after=clone(world);if(!before.weak)state(after,id).unbound=false;language(out,after,'duplicate-bind');}
    }
    return out;
  }
  function get(world,ids) {
    const out=output();spend(ids.size);
    for(const id of ids){const before=state(world,id);
      if(data(before.bound)){const after=clone(world);if(!before.weak)state(after,id).unbound=false;normal(out,after,before.bound);out.pending ||= before.pending||before.bound.unknown;}
      if(before.unbound){const after=clone(world);if(!before.weak){const value=state(after,id);value.bound=a.empty();value.initializing=false;value.prefixMin=0;value.prefixMax=0;}
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
    spend(ids.size);const result=new Set();for(const id of ids){const value=state(world,id);check(data(value.bound),'receiver-actual','initialization requires selected bound this');
      value.initializing=true;if(value.weak)value.prefixMin=0;else {value.aborted=false;value.prefixMin=0;value.prefixMax=0;}result.add(token(id,0));}return result;
  };
  const advance=(world,ids,field)=>{
    spend(ids.size);const result=new Set();for(const id of ids){const current=cursor(id),info=frame(current.frame),value=state(world,current.frame);
      check(value.initializing&&info.fields[current.position]===field,'receiver-actual','initializer must advance its exact field prefix');
      const next=current.position+1;if(value.weak)value.prefixMax=Math.max(value.prefixMax,next);else value.prefixMin=value.prefixMax=next;result.add(token(current.frame,next));}return result;
  };
  const end=(world,ids)=>{
    spend(ids.size);for(const id of ids){const current=cursor(id),info=frame(current.frame),value=state(world,current.frame);
      check(value.initializing&&current.position===info.fields.length,'receiver-actual','initializer must end its complete prefix');if(!value.weak)value.initializing=false;}
  };
  const abort=(world,ids=null)=>{
    if(ids===null){spend(world.size);for(const value of world.values())if(value.initializing){if(!value.weak)value.initializing=false;value.aborted=true;}return;}
    spend(ids.size);for(const id of ids){const value=state(world,cursor(id).frame);if(value.initializing){if(!value.weak)value.initializing=false;value.aborted=true;}}
  };
  return {store,clone,join,overlay,key,select,retained,frame,cursor,create,child,allocate,bind,get,result,begin,advance,end,abort};
}
