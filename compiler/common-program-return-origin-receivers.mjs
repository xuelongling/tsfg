// SPDX-License-Identifier: MIT
// Symbolic receiver activation state only. Initializer order/rights are owned
// by the admitted normalized CFG; no Source, token cursor or Actual tag proof.
import {commonCheck as check} from './common-program-common.mjs';

export function commonReturnOriginReceivers({spend,constructions,location,locations}) {
  const frames=new Map(),liveWorlds=new WeakSet();
  const add=(into,from)=>{spend(from.size??from.length);for(const value of from)into.add(value);};
  const world=ids=>{const result=new Map();spend(ids.size+1);for(const id of ids)result.set(id,{unbound:true,bound:new Set()});liveWorlds.add(result);return result;};
  const copy=world=>{spend(world.size);const result=new Map();for(const [id,row]of world){spend(row.bound.size+1);result.set(id,{unbound:row.unbound,bound:new Set(row.bound)});}if(liveWorlds.has(world))liveWorlds.add(result);return result;};
  const merge=(into,from)=>{if(!liveWorlds.has(from))return false;let changed=!liveWorlds.has(into);const wasLive=!changed;liveWorlds.add(into);
    spend(into.size);if(wasLive)for(const [id,row]of into){if(!from.has(id)&&!row.unbound){row.unbound=true;changed=true;}}
    spend(from.size);for(const [id,row]of from){let before=into.get(id);
    if(!before){spend(row.bound.size+1);into.set(id,{unbound:wasLive||row.unbound,bound:new Set(row.bound)});changed=true;continue;}
    if(row.unbound&&!before.unbound){before.unbound=true;changed=true;}
    const size=before.bound.size;add(before.bound,row.bound);changed ||= size!==before.bound.size;
  }return changed;};
  const snapshot=world=>{spend(world.size+1);const rows=[];for(const [id,row]of world){spend(row.bound.size+1);rows.push([id,row.unbound,[...row.bound].sort((a,b)=>{spend();return a-b;})]);}rows.sort((a,b)=>{spend();return a[0]-b[0];});return [liveWorlds.has(world),rows];};
  const definition=id=>{spend();const row=frames.get(id);check(row,'return-origin-receiver','unowned frame');return row;};
  const construction=id=>{spend();const row=constructions.get(id);check(row,'return-origin-receiver','unowned construction role');return row;};
  const derives=(target,owner)=>{let row;for(const candidate of constructions.values()){spend();if(candidate.owner===target){row=candidate;break;}}
    while(row){spend();if(row.owner===owner)return true;const base=row.base;row=null;if(base!==null)for(const candidate of constructions.values()){spend();if(candidate.owner===base){row=candidate;break;}}}return false;};
  const create=(context,node,index,parents)=>{
    const role=construction(node.construction),result=new Set();spend(parents.size+1);
    const parentRows=node.parent===null?[null]:[...parents];
    for(const parent of parentRows){spend();const newTarget=parent===null?node.newTarget:definition(parent).newTarget;
      check(derives(newTarget,role.owner),'return-origin-receiver','newTarget does not own the construction ancestry');
      if(parent!==null)check(construction(definition(parent).construction).base===role.owner,'return-origin-receiver','child is not the original immediate base');
      const id=location(['receiver-frame',context.index,context.id,context.scope,index,node.site,node.construction,newTarget,parent],{kind:'receiver-frame',type:null},null);
      if(!frames.has(id)){spend();frames.set(id,{construction:role.id,newTarget,parent,rootRole:parent!==null&&definition(parent).rootRole});}
      result.add(id);
    }return result;
  };
  const entry=protocol=>{
    if(protocol.construction===null||protocol.construction===undefined)return new Set();
    const role=construction(protocol.construction.id),result=new Set();
    for(const candidate of constructions.values()){spend();if(!derives(candidate.owner,role.owner))continue;
      const id=location(['receiver-entry',role.id,candidate.owner],{kind:'receiver-frame',type:null},null);
      frames.set(id,{construction:role.id,newTarget:candidate.owner,parent:null,rootRole:true});result.add(id);
    }return result;
  };
  const category=id=>{const row=locations[id].node;spend();
    if(row.kind==='literal')return row.category==='undefined'?2:4;
    if(row.kind==='local'||row.kind==='copied-value'||row.kind==='code'||row.kind==='receiver-object'||row.kind==='receiver-selected'||row.kind==='receiver-error')return 1;
    return 7;
  };
  const object=value=>{if(category(value)===1)return value;const selected=locations[value];return location(['receiver-selected',value],{kind:'receiver-selected',type:selected.node.type,source:value},selected.owner);};
  const state=(world,id)=>world.get(id)??{unbound:true,bound:new Set()};
  const apply=(context,operation,ids,values,input)=>{
    const world=copy(input),result=new Set(),bound=new Set();let live=false;spend(ids.size+values.size+1);
    if(!liveWorlds.has(input))return {world,result,bound,live};
    for(const id of ids){const info=definition(id),role=construction(info.construction),before=state(input,id),normal=operation.completion==='normal';
      const complete=(selected,unbound=before.unbound)=>{live=true;add(result,selected);spend(before.bound.size+1);world.set(id,{unbound,bound:new Set(before.bound)});};
      if(operation.action==='allocate'){
        check(role.base===null,'return-origin-receiver','only a base frame allocates');
        if(normal){const allocated=location(['receiver-object',id],{kind:'receiver-object',type:info.newTarget},info.rootRole?'p:0':'local:return-origin');result.add(allocated);live=true;}
      }else if(operation.action==='bind'){
        const objects=new Set();for(const value of values){spend();if(category(value)&1)objects.add(object(value));}
        if(normal&&before.unbound&&objects.size){live=true;add(result,objects);world.set(id,{unbound:false,bound:objects});}
        if(!normal&&before.bound.size)complete(new Set([location(['receiver-error','duplicate-bind'],{kind:'receiver-error',type:null},'local:return-origin')]));
      }else if(operation.action==='get'){
        if(normal&&before.bound.size)complete(before.bound,false);
        if(!normal&&before.unbound)complete(new Set([location(['receiver-error','unbound-this'],{kind:'receiver-error',type:null},'local:return-origin')]));
      }else{
        check(operation.action==='result','return-origin-receiver','unknown receiver action');
        let absent=values.size===0,other=false;const objects=new Set();
        for(const value of values){spend();const mask=category(value);if(mask&1)objects.add(object(value));absent ||= Boolean(mask&2);other ||= Boolean(mask&4);}
        if(normal){if(objects.size)complete(objects);if((absent||other&&role.base===null)&&before.bound.size)complete(before.bound,false);}
        else if(other&&role.base!==null||(absent||other&&role.base===null)&&before.unbound)complete(new Set([location(['receiver-error','constructor-result'],{kind:'receiver-error',type:null},'local:return-origin')]));
      }
      const after=world.get(id)??before;add(bound,after.bound);
    }
    return {world,result,bound,live};
  };
  const bound=(world,ids)=>{const result=new Set();spend(ids.size);for(const id of ids)add(result,state(world,id).bound);return result;};
  return {world,copy,merge,snapshot,create,entry,apply,bound,definition,construction,derives};
}

// A static create site cannot summarize repeated activations with the same
// bind-once cell. Ordinary cyclic uses of receiverInput create no fresh cell.
export function commonReceiverActivations(graph,spend) {
  const roots=new Set(),states=new Map();spend(graph.nodes.length);
  for(const row of graph.nodes)if(row.kind==='receiverFrame')roots.add(row.control);
  for(const root of roots){const pending=[{id:root,exit:false}];
    while(pending.length){spend();const {id,exit}=pending.pop();if(exit){states.set(id,2);continue;}
      const state=states.get(id);if(state===1)return false;if(state===2)continue;states.set(id,1);
      const row=graph.controls[id],parents=row.kind==='join'?row.inputs:row.kind==='call'?[graph.calls[row.call].control]:row.kind==='receiverCompletion'?[graph.heaps[row.action].control]:[];
      spend(parents.length+1);pending.push({id,exit:true});for(let index=parents.length-1;index>=0;index--)pending.push({id:parents[index],exit:false});
    }
  }
  return true;
}
