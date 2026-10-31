// SPDX-License-Identifier: MIT
// Finite fixed-summary equations only. This consumes no AST, Program, opcode,
// Actual object, Code/Env instance or Borrow proof. Heap contents and control
// existence are separate lattices. Every call resumes its own saved context.
import {canonical,commonCheck as check} from './common-program-common.mjs';

export function solveReturnOriginContexts(root,fixed,{projectField,mayAlias,actualType},spend) {
  const locations=[],locationIds=new Map(),addresses=[],addressIds=new Map(),contexts=[],contextIds=new Map();
  let changed=false;
  const key=value=>{const pending=[value];while(pending.length){spend();const item=pending.pop();
    if(typeof item==='string')spend(Math.ceil(item.length/8)+1);
    else if(Array.isArray(item)){spend(item.length);for(const child of item)pending.push(child);}
    else if(item!==null&&typeof item==='object')for(const name in item){spend(Math.ceil(name.length/8)+1);pending.push(item[name]);}}
    return canonical(value);
  };
  const add=(target,source)=>{for(const value of source){spend();if(!target.has(value)){target.add(value);changed=true;}}};
  const ordered=values=>{spend(values.size+1);const result=[...values];result.sort((a,b)=>{spend();return a-b;});return result;};
  const heapKey=heap=>{spend(heap.size+1);const rows=[];for(const [address,values]of heap){spend();rows.push([address,ordered(values)]);}rows.sort((a,b)=>{spend();return a[0]-b[0];});return rows;};
  const mergeHeap=(target,source)=>{for(const [address,values]of source){spend();let selected=target.get(address);if(!selected){spend();selected=new Set();target.set(address,selected);changed=true;}add(selected,values);}};
  const location=(identity,node,owner)=>{const encoded=key(identity);let id=locationIds.get(encoded);if(id!==undefined)return id;
    spend();check(locations.length<65536,'limit');id=locations.length;locationIds.set(encoded,id);locations.push({node,owner});changed=true;return id;};
  const address=(base,selector,view)=>{const encoded=key([base,selector,view]);let id=addressIds.get(encoded);if(id!==undefined)return id;
    spend();check(addresses.length<65536,'limit');id=addresses.length;addressIds.set(encoded,id);addresses.push({base,selector,view});changed=true;return id;};
  const put=(heap,base,selector,view,values)=>{if(!values.size)return;const id=address(base,selector,view);let stored=heap.get(id);
    if(!stored){spend();stored=new Set();heap.set(id,stored);changed=true;}add(stored,values);};
  const inline=id=>{const node=locations[id].node;return node.kind==='copied-value'||node.kind==='local'&&actualType(node.type)?.kind==='value';};
  const aliases=(a,b)=>{spend();const x=locations[a].node,y=locations[b].node;if(x.kind==='nonowning'||y.kind==='nonowning')return false;
    if(a!==b&&inline(a)&&inline(b)&&(x.kind==='copied-value'||y.kind==='copied-value'))return false;
    return mayAlias({id:a,node:x},{id:b,node:y});};
  const sameField=(base,selector,view,stored)=>{spend();if(selector==='element'||stored.selector==='element')return selector===stored.selector;
    if(view===stored.view)return selector===stored.selector;if(selector===stored.selector)return true;const node=locations[base].node;
    if(node.kind==='local'||node.kind==='copied-value'){const a=projectField(node.type,view,selector),b=projectField(node.type,stored.view,stored.selector);if(a!==null&&b!==null)return a===b;}return true;};
  const read=(heap,base,selector,view,origin)=>{
    spend();const result=new Set(),selected=locations[base],kind=selected.node.kind;
    if(!['local','copied-value','nonowning'].includes(kind)){
      const id=location(['entry-projection',origin,selected.owner],{kind:'entry-projection',type:null},selected.owner);result.add(id);
    }
    for(const [id,values]of heap){spend();const stored=addresses[id];if(aliases(base,stored.base)&&sameField(base,selector,view,stored))for(const value of values){spend();result.add(value);}}
    return result;
  };
  const resolved=(context,refs)=>{const result=new Set();for(const ref of refs){spend();for(const id of context.values[ref]){spend();result.add(id);}}return result;};
  const effect=(context,flag,owner)=>{let selected=context.effects.get(flag);if(!selected){spend();selected=new Set();context.effects.set(flag,selected);changed=true;}add(selected,[owner]);};
  const valueEffects=(context,flag,values)=>{for(const id of values){spend();const owner=locations[id].owner;if(owner!==null)effect(context,flag,owner);}};
  const inherit=(context,called)=>{
    for(const [flag,owners]of called.effects){spend();for(const owner of owners)effect(context,flag,owner);}
    add(context.facets,called.facets);add(context.calls,called.calls);add(context.calls,[called.id]);
    const upper=called.upper;if(!upper)return;
    for(const [index,parameter]of upper.parameters.entries())for(const flag of ['read','write','structural']){spend();if(parameter[flag])valueEffects(context,flag,called.arguments[index]);}
    for(const access of upper.captures)for(const flag of ['read','write','structural']){spend();if(access[flag])effect(context,flag,'c:'+access.slot);}
    for(const field of ['reads','writes'])for(const id of upper.globals[field]){spend();effect(context,field==='reads'?'read':'write','g:'+id);}
    for(const field of ['reads','writes'])for(const id of upper.hostResources[field]){spend();effect(context,field==='reads'?'read':'write','h:'+id);}
    for(const flag in upper.facets){spend();if(flag!=='mayThrow'&&upper.facets[flag])add(context.facets,[flag]);}
  };
  const ensure=(id,arguments_,input,scope)=>{
    spend(arguments_.length+1);const signature=key([id,scope,arguments_.map(ordered),heapKey(input)]);let index=contextIds.get(signature);if(index!==undefined)return contexts[index];
    const record=id===null?{graph:root,upper:null}:fixed.get(id);check(record,'return-origins','fixed call member is absent');const graph=record.graph;
    spend(graph.nodes.length*2+graph.heaps.length+graph.controls.length+graph.calls.length+arguments_.length+1);check(contexts.length<65536,'limit');
    const heap=new Map();mergeHeap(heap,input);const copiedArguments=arguments_.map(values=>{spend(values.size+1);return new Set(values);});
    const context={index:contexts.length,id,scope,graph,upper:record.upper,arguments:copiedArguments,input:heap,values:graph.nodes.map(()=>new Set()),heaps:graph.heaps.map(()=>new Map()),
      controls:graph.controls.map(()=>false),targets:graph.calls.map(()=>new Set()),normal:new Set(),language:new Set(),normalHeap:new Map(),languageHeap:new Map(),normalLive:false,languageLive:false,
      effects:new Map(),facets:new Set(),calls:new Set()};
    index=contexts.length;contexts.push(context);contextIds.set(signature,index);changed=true;return context;
  };
  const rootArguments=[];for(const node of root.nodes){spend();if(node.kind==='parameter'){
    const id=location(['parameter',node.index,node.type],node,'p:'+node.index);rootArguments[node.index]=new Set([id]);}}
  spend(rootArguments.length);for(let i=0;i<rootArguments.length;i++)rootArguments[i]??=new Set();const initial=ensure(null,rootArguments,new Map(),'root');
  changed=true;
  while(changed){changed=false;
    // New contexts append to this same worklist. Returned values/heaps/effects
    // only wake their recorded callers, never every call of the same FnId.
    for(const context of contexts){spend();const graph=context.graph;
      for(let index=0;index<graph.calls.length;index++){spend();const call=graph.calls[index];if(!context.controls[call.control])continue;
        // An empty alias set can be an ordinary native/undefined value. Only
        // the independent continuation control can rule out this invocation.
        spend(call.arguments.length);const args=call.arguments.map(refs=>resolved(context,refs));
        const scope=key([context.id,call.site,index]),called=ensure(call.functionId,args,context.heaps[call.heap],scope);add(context.targets[index],[called.index]);
      }
      for(let index=0;index<graph.controls.length;index++){spend();const control=graph.controls[index];let live=false;
        if(control.kind==='entry')live=true;else if(control.kind==='join')live=control.inputs.some(input=>{spend();return context.controls[input];});
        else if(control.kind==='call')for(const target of context.targets[control.call]){spend();live ||= contexts[target][control.completion+'Live'];}
        else check(false,'return-origins','unknown fixed control equation');if(live&&!context.controls[index]){context.controls[index]=true;changed=true;}
      }
      for(let index=0;index<graph.nodes.length;index++){spend();const node=graph.nodes[index],output=context.values[index];
        if(node.kind==='parameter'){if(context.id===null)add(output,rootArguments[node.index]);else add(output,context.arguments[node.index]);}
        else if(node.kind==='join')add(output,resolved(context,node.inputs));
        else if(node.kind==='gate'){if(context.controls[node.control])add(output,resolved(context,node.inputs));}
        else if(node.kind==='projection'){
          if(!context.controls[node.control])continue;for(const base of resolved(context,node.bases))add(output,read(context.heaps[node.heap],base,node.selector,node.view,[context.id,index]));
        }else if(node.kind==='copy'){
          if(!context.controls[node.control])continue;for(const source of resolved(context,node.bases)){
            const original=locations[source].node;if(!inline(source))add(output,[source]);else{
              const site=key([context.scope,context.id,node.site]),id=location(['copy',site,original.type],{kind:'copied-value',type:original.type,site},'local:return-origin');add(output,[id]);}
          }
        }else if(node.kind==='call')for(const target of context.targets[node.call]){spend();const called=contexts[target];if(called[node.completion+'Live']){
          add(output,called[node.completion]);if(node.completion==='normal'&&!called.normal.size&&(node.type==='void'||actualType(node.type)?.kind==='void'))add(output,[location(['nonowning',node.type],{kind:'nonowning',type:node.type},null)]);}}
        else{
          const owner=node.kind==='global'?'g:'+node.id:node.kind==='capture'?'c:'+node.id:node.kind==='unknown'?'unknown:return-origin':node.kind==='local'?'local:return-origin':null;
          const identity=node.kind==='local'?['local',context.id,context.scope,index,node.type]:[node.kind,node.type,node.id??null];add(output,[location(identity,node,owner)]);
        }
      }
      for(let index=0;index<graph.heaps.length;index++){spend();const heap=graph.heaps[index],output=context.heaps[index];
        if(heap.kind==='entry')mergeHeap(output,context.input);
        else if(heap.kind==='join')for(const parent of heap.inputs){spend();mergeHeap(output,context.heaps[parent]);}
        else if(heap.kind==='store'){
          mergeHeap(output,context.heaps[heap.previous]);if(context.controls[heap.control])for(const base of resolved(context,heap.bases))put(output,base,heap.selector,heap.view,resolved(context,heap.values));
        }else if(heap.kind==='copy'){
          const operation=graph.nodes[heap.value];mergeHeap(output,context.heaps[heap.previous]);if(!context.controls[operation.control])continue;
          const site=key([context.scope,context.id,operation.site]),roots=resolved(context,operation.bases);spend(roots.size+1);const pending=[...roots],seen=new Set(),source=context.heaps[operation.heap];
          const copied=id=>{if(!inline(id))return id;const type=locations[id].node.type;return location(['copy',site,type],{kind:'copied-value',type,site},'local:return-origin');};
          while(pending.length){spend();const original=pending.pop();if(seen.has(original)||!inline(original))continue;seen.add(original);
            const target=copied(original),type=locations[original].node.type,shape=actualType(type);check(shape?.kind==='value','return-origins');
            for(const field of shape.fields){spend();const view=field.view??type,values=read(source,original,'field:'+field.id,view,[context.id,heap.value,field.id,view]),children=new Set();
              for(const child of values){spend();children.add(copied(child));if(inline(child))pending.push(child);}put(output,target,'field:'+field.id,view,children);}
          }
        }else if(heap.kind==='call')for(const target of context.targets[heap.call]){spend();mergeHeap(output,contexts[target][heap.completion+'Heap']);}
        else check(false,'return-origins','unknown fixed heap equation');
      }
      for(const completion of ['normal','language']){
        for(const exit of graph.exits[completion]){spend();if(context.controls[exit.control]){
          if(!context[completion+'Live']){context[completion+'Live']=true;changed=true;}mergeHeap(context[completion+'Heap'],context.heaps[exit.heap]);}}
        if(context[completion+'Live'])add(context[completion],resolved(context,graph[completion]));
      }
      for(const access of graph.accesses){spend();if(context.controls[access.control])valueEffects(context,access.flag,resolved(context,access.values));}
      for(const targets of context.targets)for(const target of targets){spend();inherit(context,contexts[target]);}
    }
  }
  const owners=refs=>{const result=new Set();for(const ref of refs)for(const id of initial.values[ref]){spend();const owner=locations[id].owner;if(owner!==null)result.add(owner);}return result;};
  return {owners,effects:initial.effects,facets:initial.facets,calls:initial.calls,normal:initial.normalLive,language:initial.languageLive,live:control=>initial.controls[control]};
}
