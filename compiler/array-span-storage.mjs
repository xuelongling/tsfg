// SPDX-License-Identifier: MIT
// Typed member provenance, not payload evaluation. The existing owner trace
// supplies actual Source-order completions and the selected callable graph.
import {arrayAnalysisTypes,hasConditionalArrayRhs} from './array-analysis-types.mjs';
/** @typedef {{kind:'unknown'}|{kind:'owner',owner:any,span:boolean,sources:any[]}|StoredPlane|
 * {kind:'choice',values:StoredValue[]}|{kind:'inputField',index:number,property:string}|
 * {kind:'loaded',value:StoredValue,tokens:any[]}} StoredValue */
/** @typedef {{kind:'aggregate',id:number,type:string,slot:number|null,fallback:number|null,
 * invalidated:boolean,fields:Map<string,StoredValue>}} StoredPlane */
export function createSpanStorage(hir,tools,charge,authority){
  const type=arrayAnalysisTypes(hir),summaries=new Map();
  const key=tools.pathKey,unknown=Object.freeze({kind:'unknown'});
  const parents=new Map(),contains=new Set(),work=[],typeIndices=new Map();
  for(const [index,row]of hir.types.entries()){
    typeIndices.set(row.id,index);
    charge();if(row.kind==='readSpan'){contains.add(row.id);work.push(row.id);}
    const parent=child=>{charge();if(!parents.has(child))parents.set(child,new Set());parents.get(child).add(row.id);};
    for(const child of row.members??[])parent(child);
    for(const child of row.fields??[])parent(child.type);
    if(row.base)parent(row.base);
    if(row.elementType)parent(row.elementType);
  }
  for(let index=0;index<work.length;++index)for(const parent of parents.get(work[index])??[]){charge();if(!contains.has(parent)){contains.add(parent);work.push(parent);}}
  const enabled=hir.types.some(row=>{charge();return ['reference','value'].includes(row.kind)&&contains.has(row.id);});
  let serial=0,loopSerial=0;
  const choice=rows=>{
    const values=new Set(),work=[];for(const row of rows){charge();work.push(row??unknown);}
    while(work.length){charge();const row=work.pop();if(row.kind==='choice')for(const child of row.values){charge();work.push(child);}else values.add(row);}
    return values.size===1?[...values][0]:{kind:'choice',values:[...values]};
  };
  const leaves=value=>{const result=[],work=[value??unknown];while(work.length){charge();const row=work.pop();
    if(row.kind==='loaded')work.push(row.value);
    else if(row.kind==='choice')for(const child of row.values){charge();work.push(child);}else result.push(row);}return result;};
  const transform=(value,map)=>{
    charge();if(value?.kind==='loaded')return {kind:'loaded',value:transform(value.value,map),tokens:value.tokens};
    return value?.kind==='choice'?choice(value.values.map(row=>transform(row,map))):map(value??unknown);
  };
  const inherit=(value,from)=>{
    const tokens=[],work=[from];while(work.length){charge();const row=work.pop();
      if(row?.kind==='loaded'){for(const token of row.tokens){charge();tokens.push(token);}work.push(row.value);}
      else if(row?.kind==='choice')for(const child of row.values){charge();work.push(child);}}
    return tokens.length?{kind:'loaded',value,tokens}:value;
  };
  /** @returns {StoredPlane} */
  const aggregate=(actual,slot=null)=>({kind:'aggregate',id:++serial,type:actual,slot,
    fallback:slot===null?null:slot,invalidated:false,fields:new Map()});
  const copy=value=>{
    const copied=new Map(),work=[];
    const one=row=>{
      charge();if(row?.kind==='loaded')return {kind:'loaded',value:one(row.value),tokens:row.tokens};
      if(row?.kind==='choice')return choice(row.values.map(one));
      if(row?.kind!=='aggregate'||type.types.get(row.type)?.kind!=='value')return row??unknown;
      if(copied.has(row))return copied.get(row);const target=aggregate(row.type);target.fallback=row.fallback;
      target.invalidated=row.invalidated;copied.set(row,target);work.push([row,target]);return target;
    };
    const result=one(value);
    while(work.length){charge();const [from,to]=work.pop();for(const [field,payload]of from.fields){charge();to.fields.set(field,one(payload));}}
    return result;
  };
  const field=(object,property)=>{
    let current=type.types.get(object.type);
    while(current){charge();for(const item of current.fields??[]){charge();if(item.id===property)return item.id;}current=type.types.get(current.base);}
    for(const view of authority().views.values())if(view.actualType===object.type)
      for(const pair of view.fields){charge();if(pair.target===property)return pair.source;}
    return null;
  };
  const read=(receiver,property)=>transform(receiver,object=>{
    charge();if(object.kind!=='aggregate')return unknown;const member=field(object,property);if(!member)return unknown;
    if(object.fields.has(member))return object.fields.get(member);
    return object.fallback===null||object.invalidated?unknown:{kind:'inputField',index:object.fallback,property:member};
  });
  const write=(receiver,property,payload,changed)=>{
    const objects=leaves(receiver);
    for(const object of objects){charge();if(object.kind!=='aggregate')continue;const member=field(object,property);if(!member)continue;
      const previous=object.fields.get(member)??(object.fallback!==null&&!object.invalidated
        ?{kind:'inputField',index:object.fallback,property:member}:unknown);
      changed(object,member);object.fields.set(member,objects.length!==1?choice([previous,payload]):payload);
    }
  };
  const origins=value=>{
    const result=new Map(),inputs=[];let pending=false;
    for(const row of leaves(value)){charge();if(row.kind==='inputField'){inputs.push(row);continue;}
      if(row.kind!=='owner'||!row.span){pending=true;continue;}
      for(const source of row.sources){charge();result.set(source.id,source);}}
    return {sources:[...result.values()],pending:pending||inputs.length>0,inputs,unknown:pending};
  };
  const effectOwner=value=>{
    const owners=[];for(const row of leaves(value)){charge();owners.push(row.kind==='owner'?row.owner:{kind:'unknown'});}
    return tools.merge(owners);
  };
  const aggregateBoundary=id=>{
    const work=[id],seen=new Set();while(work.length){
      charge();const next=work.pop();if(seen.has(next))continue;seen.add(next);const row=type.types.get(next);
      if(contains.has(next)&&['reference','value'].includes(row?.kind))return true;
      if(row?.kind==='union')for(const member of row.members){charge();work.push(member);}
    }
    return false;
  };
  function begin(fn){
    if(!enabled)return {model:undefined,record:(value,path,owner,call)=>owner,
      bind:(id,value)=>{},initialize:statement=>{},get:path=>null,returned:(value,path)=>{},finish:()=>{},
      state:()=>null,restore:state=>{},join:states=>{},enterLoop:state=>{},leaveLoop:(entry,exit)=>{}};
    const values=new Map(),bindings=new Map(),captures=new Map(),reads=new Map(),returnReads=new Map(),returns=[],parameters=[],exits=[];
    const requirements=[],demands=[],dependencies=[],deferred=new Map(),callEvents=new Map(),projectedEvents=[],callLoops=[];
    let terminated=false;const mutations=[],bindingWrites=[],observations=[];
    const model={values,reads,captures,returnReads,parameters,demands,dependencies,deferred,callEvents,callLoops};
    for(const [index,p]of fn.parameters.entries()){
      charge();const t=type.types.get(p.type);
      /** @type {StoredValue} */
      let value=unknown;
      if(type.isOwner(p.type)){
        const owner={kind:'parameter',functionId:fn.id,index};value={kind:'owner',owner,span:type.isView(p.type),sources:[]};
        if(value.span)value.sources.push({id:'parameter/'+fn.id+'/'+index,functionId:fn.id,parameter:index,owner});
      }else if(['reference','value'].includes(t?.kind))value=aggregate(p.type,index);
      parameters.push(value);bindings.set(p.id,value);
    }
    const get=path=>values.get(key(path))??unknown;
    const invalidate=object=>{
      charge();mutations.push([object,null]);for(const member of object.fields.keys()){charge();object.fields.delete(member);}object.invalidated=true;
    };
    const changed=(object,member)=>{charge();mutations.push([object,member]);};
    const store=(receiver,property,payload)=>{
      // Distinct formal references have no noalias privilege. An update may
      // invalidate another formal's incoming field, even before its first read.
      for(const object of leaves(receiver))if(object.kind==='aggregate'&&object.slot!==null&&type.types.get(object.type)?.kind==='reference')
        for(const parameter of parameters)if(parameter!==object&&parameter.kind==='aggregate'&&type.types.get(parameter.type)?.kind==='reference'){
          invalidate(parameter);
        }
      write(receiver,property,payload,changed);
    };
    const snapshot=(roots,extra=[])=>{
      const state=new Map(),work=[];for(const rows of [roots,extra])for(const root of rows){charge();work.push(root);}
      while(work.length){charge();const row=work.pop();
        if(row?.kind==='loaded'){work.push(row.value);continue;}
        if(row?.kind==='choice'){for(const value of row.values){charge();work.push(value);}continue;}
        if(row?.kind!=='aggregate'||state.has(row))continue;
        const fields=new Map();for(const [member,value]of row.fields){charge();fields.set(member,value);work.push(value);}
        state.set(row,{fields,invalidated:row.invalidated});
      }
      return state;
    };
    const cloneSnapshot=state=>{
      const clones=new Map();
      for(const [object,item]of state){charge();const clone=aggregate(object.type,object.slot);clone.fallback=object.fallback;
        clone.invalidated=item.invalidated;clones.set(object,clone);}
      const remap=row=>{charge();if(row?.kind==='loaded')return {kind:'loaded',value:remap(row.value),tokens:row.tokens};
        return row?.kind==='choice'?choice(row.values.map(remap)):clones.get(row)??row;};
      for(const [object,clone]of clones)for(const [member,payload]of state.get(object).fields){charge();clone.fields.set(member,remap(payload));}
      return {clones,remap};
    };
    const restore=state=>{for(const [object,stored]of state){charge();for(const member of object.fields.keys()){charge();object.fields.delete(member);}
      for(const [member,value]of stored.fields){charge();object.fields.set(member,value);}object.invalidated=stored.invalidated;}};
    const bind=(id,value)=>{
      if(terminated)return;
      charge();bindingWrites.push(id);bindings.set(id,copy(value));
    };
    const state=()=>{
      const names=new Map();for(const [id,value]of bindings){charge();names.set(id,value);}
      return {bindings:names,planes:snapshot(bindings.values(),parameters),terminated,
        mutations:mutations.length,writes:bindingWrites.length,observations:observations.length,
        requirements:requirements.length,projected:projectedEvents.length};
    };
    const restoreState=before=>{
      restore(before.planes);for(const id of bindings.keys()){charge();bindings.delete(id);}
      for(const [id,value]of before.bindings){charge();bindings.set(id,value);}terminated=before.terminated;
    };
    const join=alternatives=>{
      const states=[];for(const row of alternatives){charge();if(!row.terminated)states.push(row);}
      if(!states.length){terminated=true;return;}if(states.length===1){restoreState(states[0]);return;}
      const objects=new Set(),names=new Set();
      for(const row of states){charge();for(const object of row.planes.keys()){charge();objects.add(object);}
        for(const name of row.bindings.keys()){charge();names.add(name);}}
      for(const object of objects){charge();const members=new Set();
        for(const row of states){charge();for(const member of row.planes.get(object)?.fields.keys()??[]){charge();members.add(member);}}
        for(const member of object.fields.keys()){charge();object.fields.delete(member);}object.invalidated=false;
        for(const member of members){charge();const payloads=[];
          for(const row of states){charge();const plane=row.planes.get(object);if(!plane)continue;
            payloads.push(plane.fields.get(member)??(object.fallback!==null&&!plane.invalidated
              ?{kind:'inputField',index:object.fallback,property:member}:unknown));}
          object.fields.set(member,choice(payloads));}
        for(const row of states){charge();object.invalidated||=row.planes.get(object)?.invalidated??false;}
      }
      for(const id of bindings.keys()){charge();bindings.delete(id);}
      for(const name of names){charge();const payloads=[];for(const row of states){charge();payloads.push(row.bindings.get(name)??unknown);}
        bindings.set(name,choice(payloads));}terminated=false;
    };
    const enterLoop=before=>{
      const id=++loopSerial;before.loop=id;
      // Symbolic entry labels expose only loop-carried dependencies. Strong
      // writes kill these labels; unchanged slots retain their exact payload.
      for(const [name,value]of bindings){charge();bindings.set(name,{kind:'loaded',value,tokens:[{loop:id,binding:name}]});}
      for(const [object,plane]of before.planes)for(const [member,value]of plane.fields){
        charge();object.fields.set(member,{kind:'loaded',value,tokens:[{loop:id,object,member}]});}
    };
    const leaveLoop=(before,conditionExit)=>{
      // Even zero iterations evaluate the condition. Preserve its successful
      // effects rather than restoring the state from before that evaluation.
      if(terminated){restoreState(conditionExit);return;}
      const slots=new Map(),names=new Set();
      for(let i=before.mutations;i<mutations.length;++i){charge();const [object,member]=mutations[i];
        if(!slots.has(object))slots.set(object,new Set());slots.get(object).add(member);}
      for(let i=before.writes;i<bindingWrites.length;++i){charge();names.add(bindingWrites[i]);}
      const settled=new Map(),pending=[];
      const settle=value=>{
        charge();if(value?.kind==='loaded'){
          const keep=[];for(const token of value.tokens){charge();if(token.loop!==before.loop){keep.push(token);continue;}
            if(token.binding!==undefined?names.has(token.binding):slots.get(token.object)?.has(null)||slots.get(token.object)?.has(token.member))return unknown;}
          const payload=settle(value.value);return keep.length?{kind:'loaded',value:payload,tokens:keep}:payload;
        }
        if(value?.kind==='choice')return choice(value.values.map(settle));
        if(value?.kind==='aggregate'&&!settled.has(value)){settled.set(value,value);pending.push(value);}return value??unknown;
      };
      const drain=()=>{while(pending.length){charge();const object=pending.pop();
        for(const [member,value]of object.fields){charge();object.fields.set(member,settle(value));}}};
      for(const [name,value]of bindings){charge();bindings.set(name,settle(value));}
      for(const parameter of parameters)settle(parameter);drain();
      // Observe only the affected versions. Return snapshots are separate
      // graphs, so a later iteration cannot rewrite an earlier normal exit.
      for(let i=before.observations;i<observations.length;++i){charge();const row=observations[i];
        row.value=settle(row.value);drain();Object.assign(row.evidence,row.aggregate?returnOrigins(row.value):origins(row.value));}
      for(let i=before.requirements;i<requirements.length;++i){charge();const row=requirements[i];
        if(row.kind!=='dependency'){row.value=settle(row.value);drain();}}
      for(let i=before.projected;i<projectedEvents.length;++i){charge();const row=projectedEvents[i];
        row.value=settle(row.value);drain();if(row.kind==='use')row.evidence=origins(row.value);else row.owner=effectOwner(row.value);}
      for(let i=0;i<returns.length;++i){charge();returns[i]=settle(returns[i]);}
      for(const exit of exits)for(let i=0;i<exit.length;++i){charge();exit[i]=settle(exit[i]);}drain();
      const after=state();join([conditionExit,after]);
    };
    const invoke=(summary,actuals,call,path,range)=>{
      if(!summary)return unknown;
      const memo=new Map(),pending=[];
      // Input fields, including nested reference planes, are read at call
      // entry. Later selected-target writes must not mutate that snapshot.
      const incoming=cloneSnapshot(snapshot(actuals));
      const original=actuals.map(value=>incoming.remap(value));
      const project=value=>{
        charge();if(!value)return unknown;
        if(value.kind==='loaded')return {kind:'loaded',value:project(value.value),tokens:value.tokens};
        if(value.kind==='choice')return choice(value.values.map(project));
        if(value.kind==='inputField')return read(original[value.index],value.property);
        if(value.kind==='owner'){
          if(value.parameter!==undefined)return actuals[value.parameter]??unknown;
          if(value.span&&value.sources.length===1&&value.sources[0].parameter!==undefined)return actuals[value.sources[0].parameter]??unknown;
          const owner=tools.map(value.owner,call,fn.id,()=>{throw new TypeError('r03-d-readspan-storage: invalid owner substitution');});
          const sources=[];
          for(const source of value.sources){charge();const id=fn.id+'@'+key(path)+'@'+source.id;
            const at=[];for(const part of path){charge();at.push(part);}
            const mapped={id,functionId:fn.id,path:at,owner,storedOrigin:{functionId:source.functionId,path:source.path??null}};
            captures.set(id,{...mapped,range,callPath:at});sources.push(mapped);}
          let result={kind:'owner',owner,span:value.span,sources};
          for(const root of tools.leaves(value.owner))if(root.kind==='parameter'&&root.functionId===call.target)
            result=inherit(result,actuals[root.index]);
          return result;
        }
        if(value.kind!=='aggregate')return unknown;
        if(value.slot!==null)return actuals[value.slot]??unknown;
        if(memo.has(value))return memo.get(value);const result=aggregate(value.type);
        if(value.fallback!==null){
          let current=type.types.get(value.type);
          while(current){charge();for(const member of current.fields??[]){charge();result.fields.set(member.id,copy(read(original[value.fallback],member.id)));}
            current=type.types.get(current.base);}
        }
        result.invalidated=value.invalidated;memo.set(value,result);pending.push([value,result]);return result;
      };
      // These are read-time field requirements, not definition-level owner
      // seeds. Every actual activation must discharge its own entry snapshot.
      {
        const mappedPath=tail=>{
          const at=[];for(const parts of [path,['callee',call.target],tail])for(const part of parts){charge();at.push(part);}return at;
        };
        for(const loop of summary.loops){charge();callLoops.push(mappedPath(loop));}
        const events=[];
        for(const row of summary.requirements){
          charge();if(row.kind==='dependency'){
            const dependency={...row,path:mappedPath(row.path)};dependencies.push(dependency);requirements.push(dependency);continue;
          }
          charge();const value=project(row.value),evidence=origins(value);
          const mapped={...row,value,path:mappedPath(row.path)};
          if(row.kind==='use'){
            const demand={contexts:0,failed:false,formal:evidence.inputs.length>0,range:row.range};demands.push(demand);
            const checks=[demand];for(const check of row.checks){charge();checks.push(check);}
            if(evidence.unknown)for(const check of checks){charge();check.failed=true;}
            else if(evidence.inputs.length)requirements.push({...mapped,checks});
            else{
              for(const check of checks){charge();check.contexts++;}
              events.push({...mapped,evidence});
            }
          }else{
            requirements.push(mapped);events.push({...mapped,owner:effectOwner(value)});
          }
        }
        if(events.length){
          const id=key(path);if(!callEvents.has(id))callEvents.set(id,[]);
          for(const event of events){charge();callEvents.get(id).push(event);projectedEvents.push(event);}
        }
      }
      // Parameter field outputs are actual successful body/initialization
      // snapshots. A value argument is an independent plane, except this.
      for(const [index,parameter]of summary.parameters.entries()){
        charge();if(parameter.kind!=='aggregate'||!(summary.receiver&&index===0)&&type.types.get(parameter.type)?.kind==='value')continue;
        if(parameter.invalidated)for(const target of leaves(actuals[index]))if(target.kind==='aggregate')invalidate(target);
        for(const [member,payload]of parameter.fields){charge();store(actuals[index],member,project(payload));}
      }
      const result=project(summary.returned);
      while(pending.length){charge();const [from,to]=pending.pop();
        for(const [member,payload]of from.fields){charge();to.fields.set(member,project(payload));}}
      return result;
    };
    const requireInput=(value,path,range)=>{
      const evidence=origins(value);
      if(!evidence.inputs.length||evidence.unknown)return;
      const demand={contexts:0,failed:false,formal:true,range};demands.push(demand);deferred.set(key(path),demand);
      requirements.push({kind:'use',value,path,range,sourcePath:fn.sourcePath,checks:[demand]});
    };
    const record=(value,path,owner,call,effect)=>{
      if(terminated)return owner;
      charge();
      /** @type {StoredValue} */
      let result=unknown;
      const child=name=>get([...path,name]);
      if(value.kind==='reference')result=bindings.get(value.binding)??unknown;
      else if(['group','assertType','nonNull'].includes(value.kind))result=child('operand');
      else if(value.kind==='arrayCreate')result={kind:'owner',owner,span:false,sources:[]};
      else if(value.kind==='fieldAccess')result=read(child('receiver'),value.property);
      else if(value.kind==='fieldAssignment'){
        result=child('value');store(get([...path,'target','receiver']),value.target.property,copy(result));
      }else if(value.kind==='assignment'){result=child('value');bind(value.target.binding,result);result=bindings.get(value.target.binding);}
      else if(hasConditionalArrayRhs(value))result=choice([child('left'),child('right')]);
      else if(['call','construct','superConstruct'].includes(value.kind)){
        const arguments_=value.arguments.map((_,i)=>{charge();return get([...path,'arguments',i]);});
        if(value.target===hir.intrinsics.readSpan.id){
          result=inherit({kind:'owner',owner,span:true,sources:[{id:fn.id+'@'+key(path),functionId:fn.id,path:[...path],owner}]},arguments_[0]);
        }else if(call){
          const constructor=value.kind!=='call',receiver=constructor
            ?value.kind==='superConstruct'?bindings.get(value.receiverBinding):aggregate(value.type):child('receiver');
          const actuals=constructor?[receiver,...arguments_]:value.receiver?[receiver,...arguments_]:arguments_;
          const results=[];
          // A call executes on this structured arm. The enclosing branch
          // joins its skip path; selected targets alone share this prestate.
          const before=snapshot(bindings.values(),actuals),branches=[];
          for(const target of call.targets){
            charge();restore(before);const selected={...call,target:target.target},summary=summaries.get(target.target);
            const inputs=actuals.map((value,index)=>{charge();return summary?.receiver&&index===0?value:copy(value);});
            if(!summary){
              // A returning arm must not erase its unresolved activation.
              // Only this storage family needs this dependency; unrelated
              // scalar/ordinary Span recursion keeps its existing analysis.
              const needs=aggregateBoundary(value.type)||value.receiver&&aggregateBoundary(value.receiver.type)
                ||value.arguments.some(argument=>{charge();return aggregateBoundary(argument.type);});
              if(needs){const dependency={kind:'dependency',target:target.target,path,range:value.range,sourcePath:fn.sourcePath};
                dependencies.push(dependency);requirements.push(dependency);}
              for(const [object]of before)invalidate(object);
            }
            const result=invoke(summary,inputs,selected,path,value.range);results.push(result);branches.push(snapshot(before.keys(),[result]));
          }
          restore(before);
          for(const [object,prior]of before){
            const states=[];
            for(const state of branches){charge();states.push(state);}
            charge();const members=new Set();for(const member of prior.fields.keys()){charge();members.add(member);}
            for(const state of states){charge();for(const member of state.get(object)?.fields.keys()??[]){charge();members.add(member);}}
            for(const member of members){charge();const alternatives=[];for(const state of states){charge();const item=state.get(object);
              alternatives.push(item?.fields.get(member)??(object.fallback!==null&&!item?.invalidated?{kind:'inputField',index:object.fallback,property:member}:unknown));}
              object.fields.set(member,choice(alternatives));}
            object.invalidated=states.some(state=>{charge();return state.get(object)?.invalidated??true;});
          }
          result=constructor?receiver:choice(results);
        }
      }else if(type.isOwner(value.type)&&owner)result={kind:'owner',owner,span:type.isView(value.type),sources:[]};
      values.set(key(path),result);
      if(['arrayReadChecked','readSpanLength'].includes(value.kind)&&type.isView(value.receiver.type)){
        const at=[...path,'receiver'];requireInput(get(at),at,value.range);
      }else if(['arrayResizeChecked','arrayStoreDenseChecked','arrayCompoundAssignment','arrayUpdate'].includes(value.kind)){
        requirements.push({kind:'effect',value:get([...path,'target','receiver']),path,range:value.range,
          sourcePath:fn.sourcePath,structural:!effect?.nonStructural});
      }
      if(['call','construct','superConstruct'].includes(value.kind))for(const [index,argument]of value.arguments.entries()){
        charge();if(type.isView(argument.type)){const at=[...path,'arguments',index];requireInput(get(at),at,argument.range);}
      }
      if(type.isView(value.type)){const evidence=origins(result);reads.set(key(path),evidence);
        charge();observations.push({value:result,evidence,aggregate:false});}
      const payloadOwners=[];for(const payload of leaves(result))if(payload.kind==='owner'){charge();payloadOwners.push(payload.owner);}
      return payloadOwners.length?tools.merge(payloadOwners):owner;
    };
    const initialize=statement=>{
      if(terminated)return;
      const receiver=bindings.get(statement.receiverBinding),owner=type.types.get(statement.ownerType);
      for(const [ordinal,step]of owner.construction.initialization.entries()){
        charge();if(step.kind==='parameterFieldInitialize')store(receiver,step.field,copy(bindings.get(step.binding)??unknown));
        else if(step.value){const index=typeIndices.get(owner.id);
          store(receiver,step.field,copy(get(['types',index,'construction','initialization',ordinal,'value'])));}
        else store(receiver,step.field,unknown);
      }
    };
    const returnOrigins=value=>{
      const work=[{value,borrowed:contains.has(fn.returnType.id)}],seen=new Set(),sources=new Map();let pending=false;
      while(work.length){charge();const {value:row,borrowed}=work.pop();
        if(row?.kind==='loaded')work.push({value:row.value,borrowed});
        else if(row?.kind==='choice')for(const child of row.values){charge();work.push({value:child,borrowed});}
        else if(row?.kind==='aggregate'&&!seen.has(row)){
          seen.add(row);let current=type.types.get(row.type);
          while(current){charge();for(const member of current.fields??[]){charge();if(contains.has(member.type))
            work.push({value:row.fields.get(member.id)??unknown,borrowed:true});}current=type.types.get(current.base);}
        }else if(row?.kind==='owner'&&row.span)for(const source of row.sources){charge();sources.set(source.id,source);}
        else if(borrowed&&row?.kind!=='aggregate')pending=true;
      }
      return {sources:[...sources.values()],pending};
    };
    return {model,record,initialize,bind,get,state,restore:restoreState,join,enterLoop,leaveLoop,
      returned:(value,path)=>{
        if(terminated)return;
        charge();const copied=copy(value),state=cloneSnapshot(snapshot(parameters,[copied]));
        const frozen=state.remap(copied),evidence=returnOrigins(frozen);returnReads.set(key(path),evidence);
        observations.push({value:frozen,evidence,aggregate:true});
        returns.push(frozen);exits.push(parameters.map(parameter=>state.remap(parameter)));terminated=true;
      },
      finish:(loops=[])=>{
        // Only normal-return field snapshots reach a caller. A conditional
        // return also retains the possible fallthrough state; a later store
        // cannot rewrite the snapshot of an earlier return.
        if(!terminated){const state=cloneSnapshot(snapshot(parameters));exits.push(parameters.map(parameter=>state.remap(parameter)));}
        const outputs=parameters.map((parameter,index)=>{
          charge();if(parameter.kind!=='aggregate')return parameter;
          const result=aggregate(parameter.type,index),members=new Set();
          for(const exit of exits){charge();for(const member of exit[index].fields.keys()){charge();members.add(member);}
            result.invalidated||=exit[index].invalidated;}
          for(const member of members){charge();const payloads=[];for(const exit of exits){charge();payloads.push(read(exit[index],member));}
            result.fields.set(member,choice(payloads));}
          return result;
        });
        const scopes=[];for(const rows of [loops,callLoops])for(const scope of rows){charge();scopes.push(scope);}
        summaries.set(fn.id,{parameters:outputs,receiver:!!fn.ownerType,returned:returns.length?choice(returns):unknown,requirements,loops:scopes});
      }};
  }
  return {begin};
}
