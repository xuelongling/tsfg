// SPDX-License-Identifier: MIT
// Finite current-invocation relations augment the actual interpreter. They
// carry no replacement payload values and never change raw object weakness.
import {canonical,sha256} from './identity.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {classifyArrayCallGraph} from './array-call-graph.mjs';
export const emptyRegionValue=()=>({roots:new Set(),opaque:false,empty:false,number:null});
export function commonRegions(spend){
  const nodes=new Map(),scopes=new Map(),layouts=new Map();
  const chargeString=s=>spend(Math.ceil(s.length/64)+1);
  const weight=value=>value.roots.size+1;
  function number(value){spend();return {...emptyRegionValue(),empty:true,number:value};}
  function copy(value){spend(weight(value));return {...value,roots:new Set(value.roots)};}
  function merge(into,from){
    spend(weight(into)+weight(from));let changed=false;const blank=into.roots.size===0&&!into.opaque&&!into.empty&&into.number===null;
    for(const id of from.roots){spend();if(!into.roots.has(id)){check(into.roots.size<256,'limit');into.roots.add(id);changed=true;}}
    if(from.opaque&&!into.opaque){into.opaque=true;changed=true;}
    if(from.empty&&!into.empty){into.empty=true;changed=true;}
    const number=blank?from.number:into.number===from.number?into.number:null;if(number!==into.number){into.number=number;changed=true;}
    return changed;
  }
  function key(value){
    spend(weight(value));const roots=[];for(const id of value.roots){chargeString(id);roots.push(id);}
    roots.sort((a,b)=>{spend();return a<b?-1:a>b?1:0;});
    spend(roots.length+1);return canonical({roots,opaque:value.opaque,empty:value.empty,number:value.number});
  }
  function heapCopy(heap){
    spend(heap.size);const result=new Map();for(const [receiver,slots]of heap){
      spend(slots.size+1);const next=new Map();for(const [slot,value]of slots)next.set(slot,copy(value));result.set(receiver,next);
    }return result;
  }
  function heapJoin(into,from,freshOrigins=new Set()){
    spend(from.size);let changed=false;for(const [receiver,slots]of from){
      spend(slots.size+1);if(freshOrigins.has(receiver)||!into.has(receiver)){
        check(!freshOrigins.has(receiver)||nodes.has(receiver),'ssa');
        const next=new Map();for(const [slot,value]of slots)next.set(slot,copy(value));into.set(receiver,next);changed=true;
      }else{
        const target=into.get(receiver);spend(target.size);
        for(const [slot,value]of target)if(!slots.has(slot)&&!value.opaque){value.opaque=true;changed=true;}
        for(const [slot,value]of slots){if(!target.has(slot)){const next=copy(value);next.opaque=true;target.set(slot,next);changed=true;}
          else changed=merge(target.get(slot),value)||changed;}
      }
    }return changed;
  }
  function heapKey(heap){
    spend(heap.size);const rows=[];for(const [receiver,slots]of heap){chargeString(receiver);spend(slots.size);const fields=[];
      for(const [slot,value]of slots){chargeString(slot);fields.push([slot,key(value)]);}
      fields.sort(([a],[b])=>{spend();return a<b?-1:a>b?1:0;});rows.push([receiver,fields]);
    }rows.sort(([a],[b])=>{spend();return a<b?-1:a>b?1:0;});return canonical(rows);
  }
  function scope(region,invocation){
    chargeString(region);chargeString(invocation);const id=sha256(canonical({region,invocation}));
    if(!scopes.has(id)){spend();check(scopes.size<4096,'limit');scopes.set(id,{region,invocation,blocked:false,hardBlocked:false,transportBlocked:false});}return id;
  }
  function allocate(selected,activation,reference,type,heap,alternative=''){
    const value=emptyRegionValue();if(!selected)return value;
    check(scopes.has(selected),'ssa');for(const part of [selected,activation,reference,type])chargeString(part);
    chargeString(alternative);const id=sha256(canonical({scope:selected,activation,reference,type,...(alternative?{alternative}:{})}));
    if(!nodes.has(id)){spend();check(nodes.size<4096,'limit');nodes.set(id,{scope:selected,reference,type});}
    value.roots.add(id);
    // This relation names this current receiver version. The raw weak heap
    // remains a union; old receiver values become opaque at a feedback cut.
    heap.set(id,new Map());return value;
  }
  function load(receiver,slot,heap){
    chargeString(slot);spend(weight(receiver));const result=emptyRegionValue();result.opaque=receiver.opaque||receiver.empty||receiver.roots.size===0;
    for(const id of receiver.roots){spend();const stored=heap.get(id)?.get(slot);if(stored)merge(result,stored);else result.opaque=true;}
    return result;
  }
  function store(receiver,slot,value,heap,witness=false,definite=true,coveredTransport=false){
    chargeString(slot);spend(weight(receiver)+weight(value));const single=definite&&!receiver.opaque&&!receiver.empty&&receiver.roots.size===1;
    for(const id of receiver.roots){spend();if(!nodes.has(id))continue;let slots=heap.get(id);if(!slots){slots=new Map();heap.set(id,slots);}
      // A discarded Array element cannot become an owning witness again when
      // a later resize grows the length. Unknown lengths discard all precise
      // element witnesses; the ordinary raw heap still keeps its weak union.
      if(slot==='length')for(const key of slots.keys()){spend();if(!key.startsWith('element/')||key==='element/*')continue;
        if(!Number.isSafeInteger(value.number)||value.number<0||Number(key.slice(8))>=value.number)slots.delete(key);}
      if(single)slots.set(slot,copy(value));
      else if(!slots.has(slot)){const next=copy(value);next.opaque=true;slots.set(slot,next);}
      else merge(slots.get(slot),value);
    }
    let outward=false;if(witness){outward=receiver.opaque||receiver.empty||receiver.roots.size===0||value.opaque;
      for(const id of receiver.roots){spend(value.roots.size+1);const scope=nodes.get(id)?.scope;
        for(const ref of value.roots)outward ||= !scope||nodes.get(ref)?.scope!==scope;}
      if(outward)escape(value,heap,coveredTransport);
    }return outward;
  }
  function reachable(values,heap){
    spend(values.length);const result=new Map(),queue=[],seen=new Set();
    for(const value of values){spend(weight(value));for(const id of value.roots)queue.push(id);}
    for(let index=0;index<queue.length;index++){
      spend();const id=queue[index];if(seen.has(id))continue;seen.add(id);const slots=heap.get(id);if(!slots)continue;
      spend(slots.size);const next=new Map();for(const [slot,value]of slots){next.set(slot,copy(value));spend(weight(value));for(const child of value.roots)queue.push(child);}
      result.set(id,next);check(queue.length<=65536,'limit');
    }return result;
  }
  function escape(value,heap,coveredTransport=false){
    const selected=reachable([value],heap);spend(weight(value)+selected.size);const all=new Set(value.roots);
    for(const id of selected.keys())all.add(id);
    for(const id of all){spend();const node=nodes.get(id);if(node){const scope=scopes.get(node.scope);scope.blocked=true;
      scope.hardBlocked ||= !coveredTransport;scope.transportBlocked ||= coveredTransport;}}
  }
  function hardRaw(references){
    spend(references.size+1);if(!references.size)return;
    spend(nodes.size);for(const node of nodes.values()){
      chargeString(node.reference);if(!references.has(node.reference))continue;
      const selected=scopes.get(node.scope);selected.blocked=true;selected.hardBlocked=true;
    }
  }
  function age(value,selected){
    spend(weight(value));let old=false;for(const id of value.roots){spend();if(nodes.get(id)?.scope===selected)old=true;}
    if(old)value.opaque=true;return old;
  }
  function closed(value,selected){
    spend(weight(value));if(value.opaque||value.empty||!value.roots.size||scopes.get(selected)?.blocked!==false)return false;
    for(const id of value.roots){spend();if(nodes.get(id)?.scope!==selected)return false;}return true;
  }
  function select(value,reference){
    spend(weight(value));const result=emptyRegionValue();result.opaque=value.opaque;result.empty=value.empty;
    for(const id of value.roots){spend();if(nodes.get(id)?.reference===reference)result.roots.add(id);}return result;
  }
  function elements(receiver,index,heap){
    spend(weight(receiver));const result=emptyRegionValue();result.opaque=receiver.opaque||receiver.empty||receiver.roots.size===0;
    for(const id of receiver.roots){spend();const slots=heap.get(id);if(!slots){result.opaque=true;continue;}
      let found=false;for(const [slot,value]of slots){spend();if(!slot.startsWith('element/'))continue;
        if(index!==null&&slot!=='element/'+index&&slot!=='element/*')continue;found=true;merge(result,value);}
      if(!found)result.opaque=true;
    }return result;
  }
  function holds(value,heap,span,owner,selected,types,coveredTransport=false){
    const scope=scopes.get(selected),allowed=scope&&(scope.blocked===false||coveredTransport&&scope.hardBlocked===false&&scope.transportBlocked===true);
    if(!selected||!allowed||value.opaque)return false;
    const graph=reachable([value],heap),owned=new Map(),groups=new Map();
    for(const [id,slots]of graph){
      spend();const node=nodes.get(id),kind=types.get(node?.type)?.kind,isEnv=node?.type.startsWith('env:'),fields=[];
      owned.set(id,new Set());groups.set(id,fields);if(node?.scope!==selected)continue;
      if(kind==='array')owned.get(id).add(id);
      if(kind==='readSpan')continue;
      if(!isEnv&&!['array','reference','value'].includes(kind))continue;
      const length=slots.get('length')?.number,indexed=!slots.get('length')?.opaque&&Number.isSafeInteger(length)&&length>=0&&!slots.has('element/*');
      for(const [slot,stored]of slots){spend();const index=slot.startsWith('element/')?slot.slice(8):'';
        if(slot.startsWith('slot/')||slot==='parent'||slot.startsWith('field/')||kind==='array'&&indexed&&/^(0|[1-9]\d*)$/.test(index)&&Number(index)<length)fields.push(stored);
      }
    }
    let changed;do{changed=false;for(const [id,fields]of groups){
      spend();const next=new Set(),node=nodes.get(id);if(node?.scope!==selected)continue;
      if(types.get(node.type)?.kind==='array')next.add(id);
      for(const field of fields){spend(weight(field));if(field.opaque||field.empty||!field.roots.size)continue;let common=null;
        for(const child of field.roots){spend();const childOwned=owned.get(child)??new Set();if(common===null){spend(childOwned.size);common=new Set(childOwned);}
          else for(const ref of common){spend();if(!childOwned.has(ref))common.delete(ref);}}
        for(const ref of common){spend();next.add(ref);}
      }
      const prior=owned.get(id);spend(prior.size+next.size);if(next.size!==prior.size||[...prior].some(ref=>!next.has(ref))){owned.set(id,next);changed=true;}
    }}while(changed);
    spend(value.roots.size);const pending=[...value.roots].map(id=>({id,storage:[],active:new Set()}));let found=false;
    for(let index=0;index<pending.length;index++){
      spend();const path=pending[index],node=nodes.get(path.id);if(!node||node.scope!==selected)return false;if(path.active.has(path.id))continue;
      if(types.get(node.type)?.kind==='readSpan'){
        if(node.reference!==span)continue;found=true;const backing=graph.get(path.id)?.get('owner');
        if(!backing||backing.opaque||backing.empty||!backing.roots.size)return false;
        for(const array of backing.roots){spend();const origin=nodes.get(array);if(origin?.scope!==selected||origin.reference!==owner||types.get(origin.type)?.kind!=='array')return false;
          let retained=false;for(const receiver of path.storage){spend();retained ||= owned.get(receiver)?.has(array)??false;}if(!retained)return false;}
        continue;
      }
      spend(path.active.size+path.storage.length+1);const active=new Set(path.active);active.add(path.id);const storage=[...path.storage,path.id];
      for(const field of groups.get(path.id)??[]){spend(weight(field));if(field.opaque)return false;
        for(const child of field.roots){spend(active.size+storage.length+1);check(pending.length<65536&&storage.length<128,'limit');pending.push({id:child,storage,active});}}
    }
    return found;
  }
  function ownedReturnHolds(value,heap,span,owner,selected,types,environments){
    // This is a return-point owning fact, not an older payload heap. It cannot
    // repair any opaque/missing field or identify two instances of a family.
    if(value.opaque||value.empty||!value.roots.size)return false;
    const graph=reachable([value],heap);
    for(const [id,slots]of graph){
      spend();const node=nodes.get(id);if(!node||node.scope!==selected)return false;
      if(node.type.startsWith('env:')){
        const layout=environments.get(node.type.slice(4));if(!layout)return false;
        for(const slot of layout.slots){spend();const current=slots.get('slot/'+slot.key);if(!current)return false;
          if(slot.writable!==false&&(slot.writable!==true||!['scalar','string'].includes(types.get(slot.type)?.kind)||current.opaque||current.roots.size||current.empty!==true))return false;}
        if(layout.parent&&!slots.has('parent'))return false;
      }else if(types.get(node.type)?.kind==='array'){
        if(types.get(types.get(node.type).elementType)?.kind!=='scalar')return false;
        for(const stored of slots.values()){spend(weight(stored));if(stored.opaque||stored.roots.size)return false;}
      }else if(types.get(node.type)?.kind!=='readSpan')return false;
      for(const stored of slots.values()){spend();if(stored.opaque)return false;}
    }
    return holds(value,heap,span,owner,selected,types,true);
  }
  function prepare(plans){
    for(const plan of plans){
      spend(plan.graph.blocks.length);const blocks=new Map(plan.graph.blocks.map(b=>[b.name,b])),predecessors=new Map(),dominators=new Map(),live=new Map(),edges=[],successors=new Map();
      for(const b of blocks.values()){spend();predecessors.set(b.name,new Set());live.set(b.name,new Set());successors.set(b.name,[]);}
      for(const b of blocks.values()){spend(b.instructions.length);
        for(const op of b.instructions)for(const target of op.successors){spend();predecessors.get(target).add(b.name);edges.push({caller:b.name,target});successors.get(b.name).push(target);}}
      spend(blocks.size+edges.length);const names=[...blocks.keys()],acyclic=!classifyArrayCallGraph(names,edges).components.some(c=>c.cyclic);
      if(acyclic){layouts.set(plan.owner.id,{blocks,predecessors,dominators,loops:new Map(),cuts:new Map(),live,demand:live,acyclic:true,covered:true});continue;}
      const reachableBlocks=new Set(),queue=[plan.entry.name];for(let index=0;index<queue.length;index++){
        spend();const id=queue[index];if(reachableBlocks.has(id))continue;reachableBlocks.add(id);
        for(const target of successors.get(id)){spend();queue.push(target);}
      }
      for(const id of reachableBlocks){spend(reachableBlocks.size+1);dominators.set(id,new Set(id===plan.entry.name?[id]:reachableBlocks));}
      let changed;do{changed=false;for(const id of reachableBlocks){
        spend();if(id===plan.entry.name)continue;let next=null;
        for(const from of predecessors.get(id)){spend();if(!dominators.has(from))continue;const prior=dominators.get(from);
          if(next===null){spend(prior.size);next=new Set(prior);}else for(const member of next){spend();if(!prior.has(member))next.delete(member);}}
        next??=new Set();next.add(id);const old=dominators.get(id);spend(next.size+old.size);
        if(next.size!==old.size||[...next].some(x=>!old.has(x))){dominators.set(id,next);changed=true;}
      }}while(changed);
      const loops=new Map(),cuts=new Map();
      const cut=(from,to,header)=>{spend();if(!cuts.has(from))cuts.set(from,new Map());const destinations=cuts.get(from);
        if(!destinations.has(to))destinations.set(to,new Set());destinations.get(to).add(header);};
      for(const {caller:from,target}of edges){
        spend();if(!dominators.get(from)?.has(target))continue;let loop=loops.get(target);
        if(!loop){loop={header:target,members:new Set([target])};loops.set(target,loop);}const pending=[from];
        for(let i=0;i<pending.length;i++){spend();const id=pending[i];if(loop.members.has(id))continue;loop.members.add(id);
          for(const from of predecessors.get(id)){spend();pending.push(from);}}
        cut(from,target,target);
      }
      for(const loop of loops.values())for(const from of loop.members)
        for(const to of successors.get(from)){spend();if(!loop.members.has(to))cut(from,to,loop.header);}
      spend(blocks.size+edges.length);const uncovered=edges.filter(edge=>!dominators.get(edge.caller)?.has(edge.target));
      const covered=!classifyArrayCallGraph(names,uncovered).components.some(c=>c.cyclic);
      const parameters=new Map();for(const b of blocks.values()){
        spend(b.parameters.length);parameters.set(b.name,new Map(b.parameters.map((p,index)=>[p.name,index])));
      }
      do{changed=false;for(const b of blocks.values()){
        spend(b.instructions.length+1);const next=new Set();
        for(let index=b.instructions.length-1;index>=0;index--){const op=b.instructions[index],transport=['cf.br','tsfg_program.route'].includes(op.name);
          for(const target of op.successors){spend(live.get(target).size);for(const id of live.get(target)){
            const parameter=parameters.get(target).get(id);if(parameter===undefined)next.add(id);
            else if(transport){check(parameter<op.operands.length,'ssa');next.add(op.operands[parameter]);}
          }}
          spend(op.operands.length);if(op.result)next.delete(op.result);if(!transport)for(const id of op.operands)next.add(id);
        }
        const prior=live.get(b.name);spend(prior.size+next.size);if(prior.size!==next.size||[...prior].some(id=>!next.has(id))){live.set(b.name,next);changed=true;}
      }}while(changed);
      layouts.set(plan.owner.id,{blocks,predecessors,dominators,loops,cuts,live,demand:live,acyclic:false,covered});
    }
  }
  function loopAt(fn,block){
    if(!layouts.get(fn)?.covered)return null;
    let selected=null;for(const loop of layouts.get(fn)?.loops.values()??[]){spend();if(loop.members.has(block)&&(!selected||loop.members.size<selected.members.size))selected=loop;}
    return selected;
  }
  function observe(value,heap){if(value.opaque&&value.roots.size)escape(value,heap,true);}
  function feedback(context,from,to,state,witness=false){
    const layout=layouts.get(context.plan.owner.id),headers=layout?.cuts.get(from)?.get(to);if(!headers)return;
    const selected=[];for(const [id,row]of scopes){spend();for(const header of headers){spend();if(row.region===context.id+'/'+header)selected.push(id);}}
    for(const selectedScope of selected){
      for(const name of layout.demand.get(to)){spend();const value=state.values.get(name);if(!value)continue;
        if(age(value.region,selectedScope)&&witness)escape(value.region,state.regions,true);
        for(const cell of value.cells){spend();const stored=state.heap.get(cell)?.region;if(stored&&age(stored,selectedScope)&&witness)escape(stored,state.regions,true);}}
      for(const value of state.values.values())age(value.region,selectedScope);
      for(const value of state.heap.values())age(value.region,selectedScope);
      spend(state.regions.size);
      for(const slots of state.regions.values())for(const value of slots.values())age(value,selectedScope);
    }
  }
  return {nodes,scopes,layouts,weight,copy,merge,key,heapCopy,heapJoin,heapKey,scope,allocate,load,store,reachable,escape,hardRaw,age,closed,number,
    prepare,loopAt,observe,feedback,select,elements,holds,ownedReturnHolds};
}
