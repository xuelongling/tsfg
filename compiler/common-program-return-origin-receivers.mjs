// SPDX-License-Identifier: MIT
// Symbolic receiver activation state only. Initializer order/rights are owned
// by the admitted normalized CFG; no Source, token cursor or Actual tag proof.
import {commonCheck as check} from './common-program-common.mjs';
import {scalarTypeIds} from './identity.mjs';

const scalarIds=new Set(Object.values(scalarTypeIds));
const isScalarOrigin=node=>scalarIds.has(node.type)&&(node.kind==='nonowning'||node.kind==='literal'&&node.category==='other');
const localValues=new Set(['parameter','literal','nonowning','join','gate','copy','receiverValue']);
const factoryValues=new Set([...localValues,'environmentInput','environmentCreate','capture','projection','receiverFrame','code','call']);
const constructorValues=new Set([...localValues,'receiverInput','receiverFrame','call']);

function everyOriginLeaf(graph,roots,accept,spend) {
  if(!roots.length)return false;
  spend(roots.length);
  const pending=[...roots],seen=new Set();
  let foundLeaf=false;
  while(pending.length){
    spend();
    const id=pending.pop();
    if(seen.has(id))continue;
    seen.add(id);
    const node=graph.nodes[id];
    const inputs=node.kind==='gate'||node.kind==='join'?node.inputs:node.kind==='copy'?node.bases:null;
    if(inputs===null){
      if(!accept(node))return false;
      foundLeaf=true;
      continue;
    }
    if(!inputs.length)return false;
    for(const input of inputs){
      spend();
      pending.push(input);
    }
  }
  return foundLeaf;
}

// A closed factory can use only private values and environments, including
// those passed to a direct helper. Its graph cannot obtain an ambient data root.
export function commonClosedReceiverFactory(fixed,environments,spend) {
  const checked=new Map();
  const hasPrivateStorage=(record,allowed,ownsCapture=null)=>{
    const {graph,upper}=record;
    if(!graph||!upper||ownsCapture===null&&upper.captures.length||upper.globals.reads.length||upper.globals.writes.length||
      upper.hostResources.reads.length||upper.hostResources.writes.length||upper.facets.unknownHost)return false;
    for(const row of graph.nodes){
      spend();
      if(!allowed.has(row.kind))return false;
    }
    for(const row of graph.heaps){
      spend();
      if(row.kind!=='store')continue;
      if(row.selector.startsWith('capture:')){
        if(!ownsCapture?.(row))return false;
      }else{
        const isReceiverValue=node=>node.kind==='receiverValue'&&graph.heaps[node.action].completion==='normal';
        if(!row.selector.startsWith('field:')||!everyOriginLeaf(graph,row.bases,isReceiverValue,spend))return false;
      }
    }
    return true;
  };
  const callsWithFrame=(graph,call,role,isFrame)=>call.callee===null&&call.environment===null&&call.receiver!==null&&
    everyOriginLeaf(graph,call.receiver,node=>node.kind==='receiverFrame'&&node.construction===role.id&&isFrame(node),spend);
  const constructorShape=record=>{
    const {graph,protocol:{construction,lexicalEnvironment,activationEnvironment}}=record;
    if(lexicalEnvironment!==null||activationEnvironment!==null||!hasPrivateStorage(record,constructorValues))return null;
    const isBaseFrame=node=>node.newTarget===null&&node.parent!==null&&
      everyOriginLeaf(graph,node.parent,input=>input.kind==='receiverInput',spend);
    const calls=[];
    for(const call of graph.calls){
      spend();
      const child=fixed.get(call.functionId),role=child?.protocol.construction;
      if(!role||role.owner!==construction.base||!callsWithFrame(graph,call,role,isBaseFrame))return null;
      calls.push({child,environment:null});
    }
    return {calls,returnedEnvironment:null};
  };
  const readOnlyReturnedCode=child=>everyOriginLeaf(child.graph,child.graph.normal,node=>{
    if(node.kind!=='code'||node.environment===null)return false;
    const target=fixed.get(node.functionId),upper=target?.upper;
    if(!target?.graph||!upper||!scalarIds.has(target.protocol.returnType)||upper.parameters.length||upper.globals.reads.length||upper.globals.writes.length||
      upper.hostResources.reads.length||upper.hostResources.writes.length||upper.facets.mayThrow!==false)return false;
    for(const capture of upper.captures){spend();if(capture.write||capture.structural)return false;}
    for(const flag in upper.facets){spend();if(flag!=='managedReference'&&upper.facets[flag])return false;}
    return everyOriginLeaf(target.graph,target.graph.normal,value=>value.type===target.protocol.returnType,spend);
  },spend);
  const ordinaryShape=record=>{
    const {graph,upper,protocol:{lexicalEnvironment,activationEnvironment}}=record;
    if(!graph||upper?.facets.mayThrow!==false)return null;
    let activation=null;
    const isIncoming=node=>lexicalEnvironment!==null&&node.kind==='environmentInput'&&node.layout===lexicalEnvironment;
    for(const node of graph.nodes){
      spend();
      if(node.kind!=='environmentCreate')continue;
      const layout=environments.get(node.layout);
      if(activation!==null||node.layout!==activationEnvironment||graph.controls[node.control].kind!=='entry'||
        layout?.parent!==lexicalEnvironment||(node.parent===null)!==(lexicalEnvironment===null)||
        node.parent!==null&&!everyOriginLeaf(graph,node.parent,isIncoming,spend))return null;
      activation=node;
    }
    if((activation===null)!==(activationEnvironment===null))return null;
    const environmentRole=(refs,layout)=>{
      let role=null;
      const owned=everyOriginLeaf(graph,refs,node=>{
        const selected=node===activation?'activation':isIncoming(node)?'incoming':null;
        if(node.layout!==layout||selected===null||role!==null&&role!==selected)return false;
        role=selected;
        return true;
      },spend);
      return owned?role:null;
    };
    const ownsSlot=(layout,key)=>{
      const slots=environments.get(layout)?.slots??[];
      return slots.some(slot=>{spend();return slot.key===key;});
    };
    const ownsCapture=store=>{
      const layout=store.view.slice(4),key=store.selector.slice(8);
      return store.view.startsWith('env:')&&ownsSlot(layout,key)&&environmentRole(store.bases,layout)!==null;
    };
    if(!hasPrivateStorage(record,factoryValues,ownsCapture))return null;
    for(const capture of upper.captures){
      spend();
      if(!ownsSlot(activationEnvironment,capture.slot)&&!ownsSlot(lexicalEnvironment,capture.slot))return null;
    }
    const isPrivateValue=node=>node.kind==='parameter'||node.kind==='literal'||node.kind==='nonowning'||
      node.kind==='receiverValue'||node.kind==='capture'||node.kind==='projection'||node.kind==='call'&&node.completion==='normal';
    for(const node of graph.nodes){
      spend();
      if(node.kind==='environmentInput'&&!isIncoming(node))return null;
      if(node.kind==='capture'&&(!ownsSlot(node.layout,node.id)||environmentRole(node.environment,node.layout)===null))return null;
      if(node.kind==='projection'&&(!node.selector.startsWith('field:')||!everyOriginLeaf(graph,node.bases,isPrivateValue,spend)))return null;
    }
    const calls=[];
    for(const call of graph.calls){
      spend();
      const child=fixed.get(call.functionId);
      if(!child||call.callee!==null)return null;
      const {construction:role,lexicalEnvironment:incoming}=child.protocol;
      if(role){
        if(!callsWithFrame(graph,call,role,node=>node.parent===null))return null;
        calls.push({child,environment:null});
        continue;
      }
      if(call.receiver!==null||(call.environment===null)!==(incoming===null))return null;
      const environment=call.environment===null?null:environmentRole(call.environment,incoming);
      if(incoming!==null&&environment===null)return null;
      for(const roots of call.arguments){
        spend();
        if(!everyOriginLeaf(graph,roots,isPrivateValue,spend))return null;
      }
      calls.push({child,environment});
    }
    const returnedEnvironment=()=>{
      let role=null,delegatedCall=null,scopedCall=null;
      const ownReceiver=node=>{
        if(node.kind!=='call'||node.completion!=='normal')return false;
        const child=calls[node.call].child,construction=child.protocol.construction;
        return construction!==null&&callsWithFrame(graph,graph.calls[node.call],construction,frame=>frame.parent===null)&&
          everyOriginLeaf(child.graph,child.graph.normal,value=>{
            if(value.kind!=='receiverValue')return false;
            const result=child.graph.heaps[value.action];
            return result.action==='result'&&result.completion==='normal'&&result.operands.length===0&&
              everyOriginLeaf(child.graph,result.frames,frame=>frame.kind==='receiverInput',spend);
          },spend);
      };
      const exact=everyOriginLeaf(graph,graph.normal,node=>{
        let selected=null;
        if(node.kind==='call'&&node.completion==='normal'){
          const call=calls[node.call];
          const childResult=checked.get(call.child).environment;
          if(childResult==='incoming')selected=call.environment;
          if(childResult==='activation'&&node.type===record.protocol.returnType&&node.type===call.child.protocol.returnType&&
            lexicalEnvironment===null&&activation===null&&call.environment===null&&
            (delegatedCall===null||delegatedCall===node.call)){
            const arguments_=graph.calls[node.call].arguments;
            const scoped=arguments_.length===0&&call.child.upper.parameters.length===0;
            // A fresh receiver carries the wrapper identity in the arguments.
            // A closed nullary helper needs the exact parent scope explicitly.
            if((scoped||arguments_.some(roots=>{spend();return everyOriginLeaf(graph,roots,ownReceiver,spend);}))&&readOnlyReturnedCode(call.child)){
              delegatedCall=node.call;scopedCall=scoped?node.call:null;selected='delegated';
            }
          }
        }else if(node.kind==='code'&&node.environment!==null){
          selected=environmentRole(node.environment,fixed.get(node.functionId)?.protocol.lexicalEnvironment);
        }
        if(selected===null||role!==null&&role!==selected)return false;
        role=selected;
        return true;
      },spend);
      return exact?{environment:role,scopedCall}:null;
    };
    return {calls,returnedEnvironment};
  };
  const privateRoutine=record=>{
    const pending=[{record,shape:null}];
    while(pending.length){
      spend();
      const {record,shape}=pending.pop();
      if(shape){
        const valid=shape.calls.every(({child})=>{spend();return Boolean(checked.get(child));});
        if(!valid)continue;
        const {environment,scopedCall}=shape.returnedEnvironment?.()??{environment:null,scopedCall:null};
        let parameters=null;
        if(environment==='delegated'){
          spend(record.upper.parameters.length+1);
          parameters=Array(record.upper.parameters.length).fill(null);
          for(const node of record.graph.nodes){spend();if(node.kind==='parameter'&&node.index<parameters.length)parameters[node.index]=node.type;}
        }
        checked.set(record,{environment,parameters,scopedCall});
        continue;
      }
      if(checked.has(record))continue;
      // A backedge sees the pending null and keeps its cycle unproven.
      checked.set(record,null);
      const candidate=record.protocol.construction?constructorShape(record):ordinaryShape(record);
      if(!candidate)continue;
      pending.push({record,shape:candidate});
      for(const {child} of candidate.calls){
        spend();
        if(!checked.has(child))pending.push({record:child,shape:null});
      }
    }
    return checked.get(record);
  };
  return (graph,call,args,locations)=>{
    if(call.callee!==null||call.environment!==null||call.receiver!==null)return null;
    const record=fixed.get(call.functionId);
    if(record.protocol.lexicalEnvironment!==null||!record.graph?.calls.length||
      record.protocol.activationEnvironment===null&&record.graph.calls.length<2)return null;
    const result=privateRoutine(record);
    if(result?.environment!=='activation'&&result?.environment!=='delegated')return null;
    const {parameters}=result;
    if(parameters&&(parameters.length!==args.length||call.arguments.length!==args.length))return null;
    for(const [index,values]of args.entries()){
      spend();
      const type=parameters?.[index];
      if(!values.size||!everyOriginLeaf(graph,call.arguments[index],node=>isScalarOrigin(node)&&(!parameters||node.type===type),spend))return null;
      for(const value of values){
        spend();
        const {node,owner}=locations[value];
        if(owner!==null||!isScalarOrigin(node)||parameters&&node.type!==type)return null;
      }
    }
    return result;
  };
}

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
