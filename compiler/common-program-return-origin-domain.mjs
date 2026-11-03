// SPDX-License-Identifier: MIT
// Finite fixed-summary equations only. This consumes no AST, Program, opcode,
// Actual object, Code/Env instance or Borrow proof. Heap contents and control
// existence are separate lattices. Every call resumes its own saved context.
import {canonical,commonCheck as check} from './common-program-common.mjs';
import {commonReturnOriginReceivers,commonReceiverActivations} from './common-program-return-origin-receivers.mjs';

export function solveReturnOriginContexts(root,fixed,{projectField,mayAlias,actualType,environments,constructions=new Map(),rootProtocol},spend) {
  const format=graph=>check(graph.format?.family==='tsfg.return-origin-graph-candidate'&&graph.format.version===5,'return-origins','one draft5 graph family is required');
  format(root);
  // Source excludes recursive publication components before projection. Pure
  // graph consumers need the same fresh-cell precondition where recursion can
  // reach a create site; ordinary Code/Env recursion needs no receiver guard.
  const callGraphs=new Map(),pendingGraphs=[root],freshGraphs=new Set();
  while(pendingGraphs.length){spend();const graph=pendingGraphs.pop();if(callGraphs.has(graph))continue;
    const targets=new Set();callGraphs.set(graph,targets);spend(graph.nodes.length+graph.calls.length);
    for(const row of graph.nodes)if(row.kind==='receiverFrame')freshGraphs.add(graph);
    for(const call of graph.calls){spend();const target=fixed.get(call.functionId)?.graph;if(target){targets.add(target);if(!callGraphs.has(target))pendingGraphs.push(target);}}
  }
  let freshChanged=true;while(freshChanged){freshChanged=false;for(const [graph,targets]of callGraphs){spend();if(freshGraphs.has(graph))continue;
    for(const target of targets){spend();if(freshGraphs.has(target)){freshGraphs.add(graph);freshChanged=true;break;}}}}
  const callStates=new Map(),callWork=[{graph:root,exit:false}];
  while(callWork.length){spend();const {graph,exit}=callWork.pop();if(exit){callStates.set(graph,2);continue;}
    const state=callStates.get(graph);if(state===2)continue;if(state===1){check(!freshGraphs.has(graph),'return-origin-recursive-frame-open','recursive receiver activation requires a fresh-cell model');continue;}
    callStates.set(graph,1);const targets=callGraphs.get(graph);spend(targets.size+1);callWork.push({graph,exit:true});for(const target of targets)callWork.push({graph:target,exit:false});
  }
  const locations=[],locationIds=new Map(),addresses=[],addressIds=new Map(),contexts=[],contextIds=new Map(),receiverGraphs=new Set();
  const environmentParents=new Map(),slotDirectory=new Map();
  for(const [id,row]of environments)for(const slot of row.slots){spend();slotDirectory.set(slot.key,{id,slot});}
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
  const receivers=commonReturnOriginReceivers({spend,constructions,location,locations});
  const address=(base,selector,view)=>{const encoded=key([base,selector,view]);let id=addressIds.get(encoded);if(id!==undefined)return id;
    spend();check(addresses.length<65536,'limit');id=addresses.length;addressIds.set(encoded,id);addresses.push({base,selector,view});changed=true;return id;};
  const put=(heap,base,selector,view,values)=>{if(!values.size)return;const id=address(base,selector,view);let stored=heap.get(id);
    if(!stored){spend();stored=new Set();heap.set(id,stored);changed=true;}add(stored,values);};
  const inline=id=>{const node=locations[id].node;return node.kind==='copied-value'||(node.kind==='local'||node.kind==='receiver-object')&&actualType(node.type)?.kind==='value';};
  const aliases=(a,b)=>{spend();const x=locations[a].node,y=locations[b].node;if(x.kind==='nonowning'||y.kind==='nonowning')return false;
    const envX=x.kind.startsWith('environment-'),envY=y.kind.startsWith('environment-');
    if(envX||envY)return envX&&envY&&a===b;
    if(a!==b&&inline(a)&&inline(b)&&(x.kind==='copied-value'||y.kind==='copied-value'))return false;
    return mayAlias({id:a,node:x},{id:b,node:y});};
  const sameField=(base,selector,view,stored)=>{spend();if(selector==='element'||stored.selector==='element')return selector===stored.selector;
    if(view===stored.view)return selector===stored.selector;if(selector===stored.selector)return true;const node=locations[base].node;
    if(node.kind==='local'||node.kind==='copied-value'||node.kind==='receiver-object'){const a=projectField(node.type,view,selector),b=projectField(node.type,stored.view,stored.selector);if(a!==null&&b!==null)return a===b;}return true;};
  const read=(heap,base,selector,view,origin)=>{
    spend();const result=new Set(),selected=locations[base],kind=selected.node.kind;
    if(!['local','copied-value','nonowning','receiver-object'].includes(kind)){
      const id=location(['entry-projection',origin,selected.owner],{kind:'entry-projection',type:null},selected.owner);result.add(id);
    }
    for(const [id,values]of heap){spend();const stored=addresses[id];if(aliases(base,stored.base)&&sameField(base,selector,view,stored))for(const value of values){spend();result.add(value);}}
    return result;
  };
  const resolved=(context,refs)=>{const result=new Set();for(const ref of refs){spend();for(const id of context.values[ref]){spend();result.add(id);}}return result;};
  const readyRefs=(context,refs)=>{spend(refs.length??refs.size);for(const id of refs){spend();if(!context.ready[id])return false;}return true;};
  const ready=(flags,index,value)=>{if(value&&!flags[index]){flags[index]=true;changed=true;}};
  const layout=id=>{spend();const result=environments.get(id);check(result,'return-origin-environment-open','missing admitted environment layout');return result;};
  const environmentAlias=(left,right)=>{spend();if(left===right)return true;const a=locations[left].node,b=locations[right].node;
    if(!a.kind.startsWith('environment-')||!b.kind.startsWith('environment-')||a.layout!==b.layout)return false;
    // Different known activations remain distinct. Conditional/entry Env
    // components may alias; their identities and Code pairing still do not.
    return a.kind!=='environment-local'||b.kind!=='environment-local';
  };
  const slotLayout=(start,key)=>{let id=start;while(id!==null){spend();const row=layout(id);for(const slot of row.slots){spend();if(slot.key===key)return {id,slot};}id=row.parent;}
    check(false,'return-origin-environment-open','capture slot is absent from the fixed lexical chain');};
  const entryEnvironment=id=>{
    const row=layout(id),selected=location(['entry-environment',id],{kind:'environment-entry',layout:id,type:null},null);
    let parents=environmentParents.get(selected);if(!parents){spend();parents=new Set();environmentParents.set(selected,parents);}
    if(row.parent!==null)add(parents,[entryEnvironment(row.parent)]);return selected;
  };
  // A component is a conditional projection of THIS formal Code value under
  // THIS selected Fn/layout, never an allocated Env or an Actual/GC fact.
  const componentEnvironment=(source,functionId,id)=>{
    const selected=location(['environment-component',source,functionId,id],{kind:'environment-component',type:null,layout:id,source,functionId},locations[source].owner),row=layout(id);
    let parents=environmentParents.get(selected);if(!parents){spend();parents=new Set();environmentParents.set(selected,parents);}
    if(row.parent!==null)add(parents,[componentEnvironment(source,functionId,row.parent)]);return selected;
  };
  const selectEnvironments=(bases,target)=>{
    spend(bases.size);const pending=[...bases],seen=new Set(),result=new Set();
    while(pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);const node=locations[id].node;
      check(node.kind==='environment-entry'||node.kind==='environment-local'||node.kind==='environment-component','return-origin-environment-open','an environment source is unresolved');
      if(node.layout===target){result.add(id);continue;}const row=layout(node.layout);
      check(row.parent!==null,'return-origin-environment-open','environment parent layout differs');
      for(const parent of environmentParents.get(id)??[]){spend();check(locations[parent].node.layout===row.parent,'return-origin-environment-open','environment parent identity differs');pending.push(parent);}
    }return result;
  };
  const captureValues=(heap,bases,layoutId,key)=>{
    const row=layout(layoutId),slot=row.slots.find(slot=>{spend();return slot.key===key;});check(slot,'return-origin-environment-open','missing fixed capture slot');
    const result=new Set();
    for(const base of selectEnvironments(bases,layoutId)){spend();
      if(locations[base].node.kind==='environment-entry')result.add(location(['entry-capture',base,key],{kind:'capture-entry',type:slot.type,id:key},'c:'+key));
      if(locations[base].node.kind==='environment-component')result.add(location(['component-capture',base,key],{kind:'entry-projection',type:slot.type,id:key},locations[base].owner));
      for(const [id,values]of heap){spend();const stored=addresses[id];if(stored.selector==='capture:'+key&&stored.view==='env:'+layoutId&&environmentAlias(base,stored.base))for(const value of values){spend();result.add(value);}}
    }return result;
  };
  const effect=(context,flag,owner)=>{let selected=context.effects.get(flag);if(!selected){spend();selected=new Set();context.effects.set(flag,selected);changed=true;}add(selected,[owner]);};
  const valueEffects=(context,flag,values)=>{for(const id of values){spend();const owner=locations[id].owner;if(owner!==null)effect(context,flag,owner);}};
  // Published capture keys summarize the entire fixed call closure. Resolve
  // each key in its actual saved incoming/activation environments; it is not
  // necessarily a member of the immediate callee's lexical signature.
  const captureSources=(called,key)=>{
    spend();const selected=slotDirectory.get(key);check(selected,'return-origin-environment-open','fixed capture slot is not owned');
    const pending=[called.index],seen=new Set(),result=[];
    while(pending.length){spend();const index=pending.pop();if(seen.has(index))continue;seen.add(index);const current=contexts[index];
      let lexical=current.protocol.lexicalEnvironment;
      while(lexical!==null){spend();if(lexical===selected.id){result.push({context:current,heap:null,bases:current.environment});break;}lexical=layout(lexical).parent;}
      if(current.protocol.activationEnvironment===selected.id)for(let value=0;value<current.graph.nodes.length;value++){spend();const node=current.graph.nodes[value];
        if(node.kind!=='environmentCreate'||node.layout!==selected.id||!current.controls[node.control])continue;
        for(const completion of ['normal','language'])for(const state of current.graph.exits[completion]){spend();if(current.controls[state.control])
          result.push({context:current,heap:state.heap,bases:current.values[value]});}
      }
      for(const targets of current.targets)for(const target of targets){spend();pending.push(target);}
    }return {selected,sources:result};
  };
  const inherit=(context,called)=>{
    for(const [flag,owners]of called.effects){spend();for(const owner of owners)effect(context,flag,owner);}
    add(context.facets,called.facets);add(context.calls,called.calls);add(context.calls,[called.id]);
    const upper=called.upper;if(!upper)return;
    for(const [index,parameter]of upper.parameters.entries())for(const flag of ['read','write','structural']){spend();if(parameter[flag])valueEffects(context,flag,index===0&&called.protocol.construction?called.boundReceivers:called.arguments[index]);}
    for(const access of upper.captures){spend();if(!access.read&&!access.write&&!access.structural)continue;const {selected,sources}=captureSources(called,access.slot);
      for(const source of sources){spend();const values=captureValues(source.heap===null?source.context.input:source.context.heaps[source.heap],source.bases,selected.id,access.slot);
        for(const flag of ['read','write','structural']){spend();if(access[flag])valueEffects(context,flag,values);}}}
    for(const field of ['reads','writes'])for(const id of upper.globals[field]){spend();effect(context,field==='reads'?'read':'write','g:'+id);}
    for(const field of ['reads','writes'])for(const id of upper.hostResources[field]){spend();effect(context,field==='reads'?'read':'write','h:'+id);}
    for(const flag in upper.facets){spend();if(flag!=='mayThrow'&&upper.facets[flag])add(context.facets,[flag]);}
  };
  const ensure=(id,arguments_,environment,input,scope,source=null,receiver=new Set(),frameWorld=new Map())=>{
    const remember=context=>{if(source!==null){const id=key([source.context.index,source.heap]);if(!context.entrySources.has(id)){context.entrySources.set(id,source);changed=true;}}return context;};
    spend(arguments_.length+1);const signature=key([id,scope,arguments_.map(ordered),ordered(environment),heapKey(input),ordered(receiver),receivers.snapshot(frameWorld)]);let index=contextIds.get(signature);if(index!==undefined)return remember(contexts[index]);
    const record=id===null?{graph:root,upper:null,protocol:rootProtocol}:fixed.get(id);check(record,'return-origins','fixed call member is absent');const graph=record.graph;check(graph,'return-origin-call-open','fixed callee return graph is unavailable');format(graph);
    if(!receiverGraphs.has(graph)){check(commonReceiverActivations(graph,spend),'return-origin-repeat-frame-open','repeated receiver-frame activation requires a fresh-cell model');receiverGraphs.add(graph);}
    check(record.protocol,'return-origin-environment-open','fixed function environment protocol is missing');
    spend(graph.nodes.length*3+graph.heaps.length*5+graph.controls.length+graph.calls.length+arguments_.length+environment.size+receiver.size+1);check(contexts.length<65536,'limit');
    const heap=new Map();mergeHeap(heap,input);const copiedArguments=arguments_.map(values=>{spend(values.size+1);return new Set(values);});
    const context={index:contexts.length,id,scope,graph,protocol:record.protocol,environment:new Set(environment),upper:record.upper,arguments:copiedArguments,input:heap,values:graph.nodes.map(()=>new Set()),heaps:graph.heaps.map(()=>new Map()),
      controls:graph.controls.map(()=>false),ready:graph.nodes.map(()=>false),heapReady:graph.heaps.map(()=>false),targets:graph.calls.map(()=>new Set()),normal:new Set(),language:new Set(),normalHeap:new Map(),languageHeap:new Map(),normalLive:false,languageLive:false,normalReady:false,languageReady:false,
      effects:new Map(),facets:new Set(),calls:new Set(),entrySources:new Map(),receiver:new Set(receiver),inputReceivers:receivers.copy(frameWorld),receiverHeaps:graph.heaps.map(()=>new Map()),receiverValues:graph.heaps.map(()=>new Set()),receiverLive:graph.heaps.map(()=>false),normalReceivers:new Map(),languageReceivers:new Map(),boundReceivers:new Set()};
    index=contexts.length;contexts.push(context);contextIds.set(signature,index);changed=true;return remember(context);
  };
  const rootArguments=[];for(const node of root.nodes){spend();if(node.kind==='parameter'){
    const id=location(['parameter',node.index,node.type],node,'p:'+node.index);rootArguments[node.index]=new Set([id]);}}
  check(rootProtocol,'return-origin-environment-open','root function environment protocol is missing');
  const rootEnvironment=rootProtocol.lexicalEnvironment===null?new Set():new Set([entryEnvironment(rootProtocol.lexicalEnvironment)]);
  spend(rootArguments.length);for(let i=0;i<rootArguments.length;i++)rootArguments[i]??=new Set();const rootReceivers=receivers.entry(rootProtocol),initial=ensure(null,rootArguments,rootEnvironment,new Map(),'root',null,rootReceivers,receivers.world(rootReceivers));
  changed=true;
  while(changed){changed=false;
    // New contexts append to this same worklist. Returned values/heaps/effects
    // only wake their recorded callers, never every call of the same FnId.
    for(const context of contexts){spend();const graph=context.graph;
      for(let index=0;index<graph.calls.length;index++){spend();const call=graph.calls[index];if(!context.controls[call.control])continue;
        if(!context.heapReady[call.heap]||call.arguments.some(refs=>!readyRefs(context,refs))||call.callee!==null&&!readyRefs(context,call.callee)||call.environment!==null&&!readyRefs(context,call.environment)||call.receiver!==null&&!readyRefs(context,call.receiver))continue;
        // An empty alias set can be an ordinary native/undefined value. Only
        // the independent continuation control can rule out this invocation.
        spend(call.arguments.length);const args=call.arguments.map(refs=>resolved(context,refs));
        const record=fixed.get(call.functionId);check(record?.protocol,'return-origin-environment-open','fixed callee environment protocol is missing');
        const receiver=call.receiver===null?new Set():resolved(context,call.receiver);
        if(record.protocol.construction){check(call.receiver!==null,'return-origin-receiver','constructor frame is missing');args.unshift(new Set());}
        else check(call.receiver===null,'return-origin-receiver','ordinary call cannot receive a frame');
        const expected=record.protocol.lexicalEnvironment,scope=key([context.id,call.site,index]),selected=[];
        if(call.callee!==null){
          for(const id of resolved(context,call.callee)){spend();const node=locations[id].node;
            if(node.kind==='code'){
              if(node.functionId!==call.functionId)continue;
              check(expected===null?node.environment===null:node.environment!==null,'return-origin-environment-open','Code/environment protocol differs');
              if(expected===null){check(call.environment===null,'return-origin-environment-open','unexpected noncapturing component');selected.push(new Set());}
              else{check(call.environment!==null,'return-origin-environment-open','selected Code component is missing');for(const env of resolved(context,call.environment)){spend();if(env===node.environment)selected.push(new Set([env]));}}
            }else{
              check(['parameter','global','capture-entry','entry-projection'].includes(node.kind)&&locations[id].owner!==null&&!locations[id].owner.startsWith('unknown:'),'return-origin-environment-open','Code source is unknown or nonowning');
              if(expected===null){check(call.environment===null,'return-origin-environment-open','unexpected Code component');selected.push(new Set());}
              else{check(call.environment!==null,'return-origin-environment-open','formal Code component is missing');for(const env of resolved(context,call.environment)){spend();const component=locations[env].node;
                if(component.kind==='environment-component'&&component.source===id&&component.functionId===call.functionId&&component.layout===expected)selected.push(new Set([env]));}}
            }
          }
        }else if(expected===null){check(call.environment===null,'return-origin-environment-open','unexpected direct environment');selected.push(new Set());}
        else{check(call.environment!==null,'return-origin-environment-open','direct environment is missing');const values=selectEnvironments(resolved(context,call.environment),expected);if(values.size)selected.push(values);}
        for(const environment of selected){spend();const called=ensure(call.functionId,args,environment,context.heaps[call.heap],scope,{context,heap:call.heap},receiver,context.receiverHeaps[call.heap]);add(context.targets[index],[called.index]);}
      }
      for(let index=0;index<graph.controls.length;index++){spend();const control=graph.controls[index];let live=false;
        if(control.kind==='entry')live=true;else if(control.kind==='join')live=control.inputs.some(input=>{spend();return context.controls[input];});
        else if(control.kind==='call')for(const target of context.targets[control.call]){spend();live ||= contexts[target][control.completion+'Live'];}
        else if(control.kind==='receiverCompletion')live=context.receiverLive[control.action];
        else check(false,'return-origins','unknown fixed control equation');if(live&&!context.controls[index]){context.controls[index]=true;changed=true;}
      }
      for(let index=0;index<graph.nodes.length;index++){spend();const node=graph.nodes[index],output=context.values[index];
        if(node.kind==='parameter'){if(context.id===null)add(output,rootArguments[node.index]);else{
          const values=context.arguments[node.index];add(output,values);if(!values.size)add(output,[location(['nonowning',node.type],{kind:'nonowning',type:node.type},null)]);}}
        else if(node.kind==='receiverInput')add(output,context.receiver);
        else if(node.kind==='receiverFrame'){if(context.controls[node.control])add(output,receivers.create(context,node,index,node.parent===null?new Set():resolved(context,node.parent)));}
        else if(node.kind==='receiverValue'){if(context.receiverLive[node.action])add(output,context.receiverValues[node.action]);}
        else if(node.kind==='environmentInput'){check(node.layout===context.protocol.lexicalEnvironment,'return-origin-environment-open','entry environment layout differs');add(output,context.environment);}
        else if(node.kind==='environmentCreate'){
          if(!context.controls[node.control])continue;check(node.layout===context.protocol.activationEnvironment,'return-origin-environment-open','activation environment layout differs');
          const row=layout(node.layout),id=location(['environment',context.id,context.scope,ordered(context.environment),context.arguments.map(ordered),index,node.site,node.layout],{kind:'environment-local',layout:node.layout,type:null,creator:context.index},'local:return-origin');
          let parents=environmentParents.get(id);if(!parents){spend();parents=new Set();environmentParents.set(id,parents);}
          if(row.parent===null)check(node.parent===null,'return-origin-environment-open','unexpected activation parent');
          else{check(node.parent!==null,'return-origin-environment-open','activation parent is missing');add(parents,selectEnvironments(resolved(context,node.parent),row.parent));}
          add(output,[id]);
        }else if(node.kind==='environmentParent'){
          if(context.controls[node.control])add(output,selectEnvironments(resolved(context,node.bases),node.layout));
        }else if(node.kind==='environmentComponent'){
          if(!context.controls[node.control]||!readyRefs(context,node.callee))continue;
          const record=fixed.get(node.functionId);check(record?.protocol?.lexicalEnvironment===node.layout,'return-origin-environment-open','conditional component Fn/layout differs');layout(node.layout);
          for(const source of resolved(context,node.callee)){spend();const selected=locations[source].node;
            if(selected.kind==='code'){if(selected.functionId!==node.functionId)continue;check(selected.environment!==null&&locations[selected.environment].node.layout===node.layout,'return-origin-environment-open','selected Code Env is null or has a wrong layout');add(output,[selected.environment]);}
            else{check(['parameter','global','capture-entry','entry-projection'].includes(selected.kind)&&locations[source].owner!==null&&!locations[source].owner.startsWith('unknown:'),'return-origin-environment-open','a conditional Env needs an owning formal Code source');add(output,[componentEnvironment(source,node.functionId,node.layout)]);}
          }
        }else if(node.kind==='capture'){
          if(context.controls[node.control])add(output,captureValues(context.heaps[node.heap],resolved(context,node.environment),node.layout,node.id));
        }else if(node.kind==='code'){
          if(!context.controls[node.control])continue;const record=fixed.get(node.functionId);check(record?.protocol,'return-origin-environment-open','Code target protocol is missing');const expected=record.protocol.lexicalEnvironment;
          if(expected===null){check(node.environment===null,'return-origin-environment-open','noncapturing Code has an environment');add(output,[location(['code',node.functionId,null,node.type],{kind:'code',type:node.type,functionId:node.functionId,environment:null},null)]);}
          else{check(node.environment!==null,'return-origin-environment-open','capturing Code lacks an environment');for(const env of selectEnvironments(resolved(context,node.environment),expected)){
            const id=location(['code',node.functionId,env,node.type],{kind:'code',type:node.type,functionId:node.functionId,environment:env},locations[env].owner);add(output,[id]);}}
        }
        else if(node.kind==='join')add(output,resolved(context,node.inputs));
        else if(node.kind==='gate'){if(context.controls[node.control])add(output,resolved(context,node.inputs));}
        else if(node.kind==='projection'){
          if(!context.controls[node.control])continue;for(const base of resolved(context,node.bases))add(output,read(context.heaps[node.heap],base,node.selector,node.view,[context.id,index]));
        }else if(node.kind==='copy'){
          if(!context.controls[node.control])continue;for(const source of resolved(context,node.bases)){
            const original=locations[source].node;if(!inline(source))add(output,[source]);else{
              const site=key([context.scope,context.id,node.site]),id=location(['copy',site,original.type],{kind:'copied-value',type:original.type,site},'local:return-origin');add(output,[id]);}
          }
          if(!output.size&&context.heapReady[node.heap]&&readyRefs(context,node.bases))add(output,[location(['nonowning',node.type],{kind:'nonowning',type:node.type},null)]);
        }else if(node.kind==='call')for(const target of context.targets[node.call]){spend();const called=contexts[target];if(called[node.completion+'Live']){
          add(output,called[node.completion]);if(node.completion==='normal'&&!called.normal.size&&(node.type==='void'||actualType(node.type)?.kind==='void'))add(output,[location(['nonowning',node.type],{kind:'nonowning',type:node.type},null)]);}}
        else{
          const owner=node.kind==='global'?'g:'+node.id:node.kind==='capture'?'c:'+node.id:node.kind==='unknown'?'unknown:return-origin':node.kind==='local'?'local:return-origin':null;
          const identity=node.kind==='local'?['local',context.id,context.scope,index,node.type]:node.kind==='literal'?[node.kind,node.type,node.category]:[node.kind,node.type,node.id??null];add(output,[location(identity,node,owner)]);
        }
        let defined=true;
        if(node.kind==='join')defined=node.inputs.length===0||node.inputs.some(id=>{spend();return context.ready[id];});
        else if(node.kind==='gate')defined=context.controls[node.control]&&readyRefs(context,node.inputs);
        else if(node.kind==='capture')defined=context.controls[node.control]&&context.heapReady[node.heap]&&readyRefs(context,node.environment);
        else if(node.kind==='copy'||node.kind==='projection')defined=context.controls[node.control]&&context.heapReady[node.heap]&&readyRefs(context,node.bases);
        else if(node.kind==='environmentCreate')defined=context.controls[node.control]&&(node.parent===null||readyRefs(context,node.parent));
        else if(node.kind==='environmentParent')defined=context.controls[node.control]&&readyRefs(context,node.bases);
        else if(node.kind==='environmentComponent')defined=context.controls[node.control]&&readyRefs(context,node.callee);
        else if(node.kind==='code')defined=context.controls[node.control]&&(node.environment===null||readyRefs(context,node.environment));
        else if(node.kind==='call'){defined=false;for(const target of context.targets[node.call]){spend();const called=contexts[target],completion=node.completion;
          defined ||= called[completion+'Ready']&&(called.graph[completion].length>0&&readyRefs(called,called.graph[completion])||completion==='normal'&&(node.type==='void'||actualType(node.type)?.kind==='void'));}}
        else if(node.kind==='receiverFrame')defined=context.controls[node.control]&&(node.parent===null||readyRefs(context,node.parent));
        else if(node.kind==='receiverValue')defined=context.receiverLive[node.action]&&context.heapReady[node.action];
        ready(context.ready,index,defined);
      }
      for(let index=0;index<graph.heaps.length;index++){spend();const heap=graph.heaps[index],output=context.heaps[index];
        if(heap.kind==='entry'){mergeHeap(output,context.input);changed=receivers.merge(context.receiverHeaps[index],context.inputReceivers)||changed;}
        else if(heap.kind==='join')for(const parent of heap.inputs){spend();mergeHeap(output,context.heaps[parent]);if(context.heapReady[parent])changed=receivers.merge(context.receiverHeaps[index],context.receiverHeaps[parent])||changed;}
        else if(heap.kind==='store'){
          mergeHeap(output,context.heaps[heap.previous]);if(context.controls[heap.control])for(const base of resolved(context,heap.bases)){
            if(heap.selector.startsWith('capture:')){const layoutId=heap.view.slice(4);check(heap.view.startsWith('env:')&&locations[base].node.layout===layoutId,'return-origin-environment-open','capture store environment layout differs');slotLayout(layoutId,heap.selector.slice(8));}
            put(output,base,heap.selector,heap.view,resolved(context,heap.values));}
        }else if(heap.kind==='copy'){
          const operation=graph.nodes[heap.value];mergeHeap(output,context.heaps[heap.previous]);if(!context.controls[operation.control])continue;
          const site=key([context.scope,context.id,operation.site]),roots=resolved(context,operation.bases);spend(roots.size+1);const pending=[...roots],seen=new Set(),source=context.heaps[operation.heap];
          const copied=id=>{if(!inline(id))return id;const type=locations[id].node.type;return location(['copy',site,type],{kind:'copied-value',type,site},'local:return-origin');};
          while(pending.length){spend();const original=pending.pop();if(seen.has(original)||!inline(original))continue;seen.add(original);
            const target=copied(original),type=locations[original].node.type,shape=actualType(type);check(shape?.kind==='value','return-origins');
            for(const field of shape.fields){spend();const view=field.view??type,values=read(source,original,'field:'+field.id,view,[context.id,heap.value,field.id,view]),children=new Set();
              for(const child of values){spend();children.add(copied(child));if(inline(child))pending.push(child);}put(output,target,'field:'+field.id,view,children);}
          }
        }else if(heap.kind==='receiverAction'){
          if(context.controls[heap.control]&&context.heapReady[heap.previous]&&readyRefs(context,heap.frames)&&readyRefs(context,heap.operands)){
            const action=receivers.apply(context,heap,resolved(context,heap.frames),resolved(context,heap.operands),context.receiverHeaps[heap.previous]);
            if(action.live){if(!context.receiverLive[index]){context.receiverLive[index]=true;changed=true;}mergeHeap(output,context.heaps[heap.previous]);
              add(context.receiverValues[index],action.result);add(context.boundReceivers,receivers.bound(action.world,context.receiver));changed=receivers.merge(context.receiverHeaps[index],action.world)||changed;}
          }
        }else if(heap.kind==='call')for(const target of context.targets[heap.call]){spend();mergeHeap(output,contexts[target][heap.completion+'Heap']);if(contexts[target][heap.completion+'Ready'])changed=receivers.merge(context.receiverHeaps[index],contexts[target][heap.completion+'Receivers'])||changed;}
        else check(false,'return-origins','unknown fixed heap equation');
        let defined=false;
        if(heap.kind==='entry')defined=true;
        else if(heap.kind==='join')defined=heap.inputs.some(id=>{spend();return context.heapReady[id];});
        else if(heap.kind==='store'){defined=context.controls[heap.control]&&context.heapReady[heap.previous]&&readyRefs(context,heap.bases)&&readyRefs(context,heap.values);if(defined)changed=receivers.merge(context.receiverHeaps[index],context.receiverHeaps[heap.previous])||changed;}
        else if(heap.kind==='copy'){defined=context.heapReady[heap.previous]&&context.ready[heap.value];if(defined)changed=receivers.merge(context.receiverHeaps[index],context.receiverHeaps[heap.previous])||changed;}
        else if(heap.kind==='receiverAction')defined=context.receiverLive[index];
        else for(const target of context.targets[heap.call]){spend();defined ||= contexts[target][heap.completion+'Ready'];}
        ready(context.heapReady,index,defined);
      }
      for(const completion of ['normal','language']){
        for(const exit of graph.exits[completion]){spend();if(context.controls[exit.control]){
          if(!context[completion+'Live']){context[completion+'Live']=true;changed=true;}
          if(context.heapReady[exit.heap]&&!context[completion+'Ready']){context[completion+'Ready']=true;changed=true;}mergeHeap(context[completion+'Heap'],context.heaps[exit.heap]);if(context.heapReady[exit.heap])changed=receivers.merge(context[completion+'Receivers'],context.receiverHeaps[exit.heap])||changed;add(context.boundReceivers,receivers.bound(context.receiverHeaps[exit.heap],context.receiver));}}
        if(context[completion+'Live'])add(context[completion],resolved(context,graph[completion]));
      }
      for(const access of graph.accesses){spend();if(context.controls[access.control])valueEffects(context,access.flag,resolved(context,access.values));}
      for(const targets of context.targets)for(const target of targets){spend();inherit(context,contexts[target]);}
    }
  }
  const forkActive=active=>{spend(active.size+1);return new Set(active);};
  const possibleHeap=(context,id,active=new Set())=>{
    spend();const encoded=key([context.index,id]);if(active.has(encoded))return false;active.add(encoded);const heap=context.graph.heaps[id];let live=false;
    if(heap.kind==='entry')live=true;
    else if(heap.kind==='join')live=heap.inputs.some(parent=>possibleHeap(context,parent,forkActive(active)));
    else if(heap.kind==='store')live=context.controls[heap.control]&&possibleHeap(context,heap.previous,active);
    else if(heap.kind==='copy')live=context.controls[context.graph.nodes[heap.value].control]&&possibleHeap(context,heap.previous,active);
    else if(heap.kind==='receiverAction')live=context.receiverLive[id]&&possibleHeap(context,heap.previous,active);
    else for(const target of context.targets[heap.call]){spend();live ||= contexts[target][heap.completion+'Live'];}
    return live;
  };
  // After the data fixed point, MUST definition is a finite backward reachability
  // query. A creator entry is present/undefined; an unrelated entry is absent.
  // Visit each saved context/heap once, preserving every live alternative.
  const definitionMemo=new Map();
  const captureDefinition=(context,heap,environment,slotKey)=>{
    const signature=key([context.index,heap,environment,slotKey]);spend();if(definitionMemo.has(signature))return definitionMemo.get(signature);
    const node=locations[environment].node;if(node.kind==='environment-entry'||node.kind==='environment-component'){definitionMemo.set(signature,true);return true;}
    const pending=[{context,heap}],seen=new Set();let defined=null;
    while(pending.length){spend();const current=pending.pop(),selected=key([current.context.index,current.heap]);if(seen.has(selected))continue;seen.add(selected);
      const row=current.heap===null?null:current.context.graph.heaps[current.heap];
      if(row===null||row.kind==='entry'){
        if(node.creator===current.context.index){defined=false;break;}
        for(const source of current.context.entrySources.values()){spend();pending.push(source);}continue;
      }
      if(row.kind==='join'){for(const parent of row.inputs){spend();if(possibleHeap(current.context,parent))pending.push({context:current.context,heap:parent});}continue;}
      if(row.kind==='store'){
        if(current.context.controls[row.control]&&row.selector==='capture:'+slotKey){const bases=resolved(current.context,row.bases);
          if(bases.size===1&&bases.has(environment)&&resolved(current.context,row.values).size){defined=true;continue;}}
        pending.push({context:current.context,heap:row.previous});continue;
      }
      if(row.kind==='copy'||row.kind==='receiverAction'){pending.push({context:current.context,heap:row.previous});continue;}
      for(const target of current.context.targets[row.call]){spend();const called=contexts[target];
        for(const state of called.graph.exits[row.completion]){spend();if(called.controls[state.control])pending.push({context:called,heap:state.heap});}}
    }definitionMemo.set(signature,defined);return defined;
  };
  const completeCapture=(context,heap,bases,layoutId,slotKey)=>{
    const selected=selectEnvironments(bases,layoutId);check(selected.size>0,'return-origin-environment-open','capture environment is unresolved');
    for(const environment of selected){spend();const defined=captureDefinition(context,heap,environment,slotKey),values=heap===null?context.input:context.heaps[heap];
      check(defined&&captureValues(values,new Set([environment]),layoutId,slotKey).size>0,'return-origin-environment-open','capture payload is unresolved on a reachable heap path');}
  };
  const returnedEnvironments=(context,values,heap)=>{
    for(const value of values){spend();const node=locations[value].node;if(node.kind!=='code'||node.environment===null)continue;
      let selected=locations[node.environment].node.layout;
      while(selected!==null){const row=layout(selected);for(const slot of row.slots){spend();
        completeCapture(context,heap,new Set([node.environment]),selected,slot.key);}selected=row.parent;}
    }
  };
  // Missing worklist data is not absence. Only after the least fixed point may
  // an actually reached capture/parent/callee with no source be declared OPEN.
  let potentialLanguage=false;
  for(const context of contexts){const graph=context.graph;
    for(const completion of ['normal','language'])for(const state of graph.exits[completion]){spend();if(context.controls[state.control])returnedEnvironments(context,resolved(context,graph[completion]),state.heap);}
    for(let index=0;index<graph.nodes.length;index++){spend();const node=graph.nodes[index];if(!context.controls[node.control])continue;
      if(node.kind==='capture')completeCapture(context,node.heap,resolved(context,node.environment),node.layout,node.id);
      if(node.kind==='environmentParent')check(context.values[index].size>0,'return-origin-environment-open','actual parent environment is unresolved');
      if(node.kind==='environmentCreate'&&layout(node.layout).parent!==null)for(const env of context.values[index])check((environmentParents.get(env)?.size??0)>0,'return-origin-environment-open','actual activation parent is unresolved');
    }
    for(let index=0;index<graph.calls.length;index++){spend();const call=graph.calls[index];if(!context.controls[call.control])continue;
      if(call.callee!==null){const codes=resolved(context,call.callee),expected=fixed.get(call.functionId).protocol.lexicalEnvironment;
        for(const id of codes){spend();const node=locations[id].node;if(node.kind==='code'&&node.functionId!==call.functionId)continue;
          if(expected!==null){check(call.environment!==null,'return-origin-environment-open','Code environment component is missing');let matched=false;
            for(const env of resolved(context,call.environment)){spend();const component=locations[env].node;
              matched ||= node.kind==='code'?env===node.environment:component.kind==='environment-component'&&component.source===id&&component.functionId===call.functionId&&component.layout===expected;}
            check(matched,'return-origin-environment-open','selected Code/environment pair is unresolved');}
        }
      }
      // A fixed function's formal Code may be supplied as one exact Fn by its
      // caller. Exclude only that proven noncapturing data alternative; inherit
      // still carries the complete fixed upper, including every permission.
      if(context.targets[index].size===0&&context.id!==null&&call.callee!==null&&fixed.get(call.functionId).protocol.lexicalEnvironment===null){
        const codes=resolved(context,call.callee),pending=[...call.callee],seen=new Set();let formal=codes.size>0,parameter=false;
        for(const id of codes){spend();const node=locations[id].node;formal &&= node.kind==='code'&&node.functionId!==call.functionId;}
        while(formal&&pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);const node=graph.nodes[id];
          if(node.kind==='parameter')parameter=true;
          else if(node.kind==='join'||node.kind==='gate'){formal &&= node.inputs.length>0;for(const input of node.inputs){spend();pending.push(input);}}
          else if(node.kind==='copy'){formal &&= node.bases.length>0;for(const base of node.bases){spend();pending.push(base);}}
          else formal=false;
        }
        if(formal&&parameter)continue;
      }
      // Local Code production, unknown ownership, and unresolved capturing
      // pairs cannot narrow a fixed capability merely to the observed payload.
      check(context.targets[index].size>0,'return-origin-environment-open','permitted Code/environment pair is unresolved');
      for(const target of context.targets[index]){const called=contexts[target];potentialLanguage ||= Boolean(called.upper?.facets.mayThrow&&!called.languageLive);for(const access of called.upper?.captures??[]){spend();if(!access.read&&!access.write&&!access.structural)continue;
        const {selected,sources}=captureSources(called,access.slot);check(sources.length>0,'return-origin-environment-open','fixed capture has no matching saved environment in its complete call closure');
        for(const source of sources){spend();completeCapture(source.context,source.heap,source.bases,selected.id,access.slot);}}}
    }
  }
  const owners=refs=>{const result=new Set();for(const ref of refs)for(const id of initial.values[ref]){spend();const owner=locations[id].owner;if(owner!==null)result.add(owner);}return result;};
  const holdsEnvironment=refs=>{for(const ref of refs)for(const id of initial.values[ref]){spend();const node=locations[id].node;if(node.kind==='code'&&node.environment!==null)return true;}return false;};
  const validateReturns=(normal,language,exits)=>{for(const completion of ['normal','language']){
    const values=resolved(initial,completion==='normal'?normal:language);for(const state of exits[completion]){spend();if(initial.controls[state.control])returnedEnvironments(initial,values,state.heap);}
  }};
  return {owners,holdsEnvironment,validateReturns,effects:initial.effects,facets:initial.facets,calls:initial.calls,potentialLanguage,normal:initial.normalLive,language:initial.languageLive,live:control=>initial.controls[control],populated:ref=>initial.values[ref].size>0,heapReady:ref=>initial.heapReady[ref]};
}
