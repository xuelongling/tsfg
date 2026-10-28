// SPDX-License-Identifier: MIT
// Typed member provenance, not payload evaluation. The existing owner trace
// supplies actual Source-order completions and the selected callable graph.
import {arrayAnalysisTypes,hasConditionalArrayRhs} from './array-analysis-types.mjs';
import {createSpanPlanes} from './array-span-planes.mjs';
/** @typedef {import('./array-span-planes.mjs').StoredValue} StoredValue */
export function createSpanStorage(hir,tools,charge,authority,resolveContext=undefined,published=undefined){
  const type=arrayAnalysisTypes(hir),summaries=new Map();
  const key=tools.pathKey;
  const {unknown,choice,leaves,inherit,aggregate,copy,inputField,read,write,snapshot,cloneSnapshot,restore,index,array,truncate,elements,extent,substitute,applyWrites,entryAliases,resolveEntry}=createSpanPlanes(type,charge,authority);
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
  const enabled=hir.types.some(row=>{charge();return ['reference','value','array'].includes(row.kind)&&contains.has(row.id);});
  let loopSerial=0;
  const rootedOwner=owner=>{
    const roots=tools.leaves(owner);return roots.length>0&&roots.every(root=>{charge();return root.kind==='allocation';});
  };
  const origins=value=>{
    const result=new Map(),inputs=[];let pending=false;
    for(const row of leaves(value)){charge();if(row.kind==='inputField'){inputs.push(row);continue;}
      if(row.kind!=='owner'||!row.span){pending=true;continue;}
      for(const source of row.sources){charge();result.set(source.id,source);}}
    return {sources:[...result.values()],pending:pending||inputs.length>0,inputs,unknown:pending};
  };
  const effectOwner=value=>{
    const owners=[];for(const row of leaves(value)){charge();owners.push(row.kind==='owner'||row.kind==='aggregate'&&row.owner?row.owner:{kind:'unknown'});}
    return tools.merge(owners);
  };
  const aggregateBoundary=id=>{
    const work=[id],seen=new Set();while(work.length){
      charge();const next=work.pop();if(seen.has(next))continue;seen.add(next);const row=type.types.get(next);
      if(contains.has(next)&&['reference','value','array'].includes(row?.kind))return true;
      if(row?.kind==='union')for(const member of row.members){charge();work.push(member);}
    }
    return false;
  };
  function begin(fn,context=false,aliases={groups:[],nested:[]}){
    if(!enabled)return {model:undefined,record:(value,path,owner,call)=>owner,
      bind:(id,value)=>{},initialize:statement=>{},get:path=>null,returned:(value,path)=>{},finish:()=>{},
      state:()=>null,restore:state=>{},join:states=>{},enterLoop:state=>{},leaveLoop:(entry,exit)=>{}};
    const values=new Map(),bindings=new Map(),captures=new Map(),reads=new Map(),returnReads=new Map(),returns=[],parameters=[],exits=[];
    const requirements=[],demands=[],dependencies=[],deferred=new Map(),callEvents=new Map(),projectedEvents=[],callLoops=[];
    let terminated=false;const mutations=[],bindingWrites=[],observations=[],slotExits=[],activeLoops=[];
    const slots=new Map(),writtenSlots=new Set();
    const entry=slot=>{
      if(parameters[slot.input.index]?.invalidated)return unknown;
      const tokens=activeLoops.map(loop=>{charge();return {loop,binding:slot.key};});
      return tokens.length?{kind:'loaded',value:slot.input,tokens}:slot.input;
    };
    const slotFor=input=>{
      const id='#entry/'+key([input.index,input.properties]);let slot=slots.get(id);
      if(!slot){charge();slot={key:id,input,receiverType:null};
        slots.set(id,slot);}
      return slot;
    };
    const readStored=(receiver,property)=>substitute(resolveEntry(read(receiver,property),parameters,aliases.nested),value=>{
      if(value.kind!=='inputField')return value;const slot=slotFor(value);
      for(const id of writtenSlots){charge();const other=slots.get(id);
        if(id!==slot.key&&other.input.properties.at(-1)===value.properties.at(-1))return unknown;}
      if(!bindings.has(slot.key))bindings.set(slot.key,entry(slot));return bindings.get(slot.key);
    });
    const model={values,reads,captures,returnReads,parameters,demands,dependencies,deferred,callEvents,callLoops};
    for(const [index,p]of fn.parameters.entries()){
      charge();const t=type.types.get(p.type);
      /** @type {StoredValue} */
      let value=unknown;
      if(type.isOwner(p.type)){
        const owner={kind:'parameter',functionId:fn.id,index};
        if(type.isArray(p.type)&&contains.has(p.type))value=aliases.groups[index]<index?parameters[aliases.groups[index]]:aggregate(p.type,index,owner);
        else{value={kind:'owner',owner,span:type.isView(p.type),sources:[],type:p.type};
          if(value.span)value.sources.push({id:'parameter/'+fn.id+'/'+index,functionId:fn.id,parameter:index,owner});}
      }else if(['reference','value'].includes(t?.kind))value=t.kind==='reference'&&aliases.groups[index]<index
        ?parameters[aliases.groups[index]]:aggregate(p.type,index);
      parameters.push(value);bindings.set(p.id,value);
    }
    const get=path=>values.get(key(path))??unknown;
    const invalidate=object=>{
      charge();mutations.push([object,null]);for(const member of object.fields.keys()){charge();object.fields.delete(member);}
      object.invalidated=true;object.extent=null;object.extentChanged=true;
      // A saved entry-path reference can outlive the aggregate field cache.
      // Invalidate its current slot version under the very same alias event.
      for(const slot of slots.values()){charge();if(parameters[slot.input.index]!==object)continue;
        bindingWrites.push(slot.key);bindings.set(slot.key,unknown);}
    };
    const changed=(object,member)=>{charge();mutations.push([object,member]);};
    const store=(receiver,property,payload,receiverType=null)=>{
      for(const row of leaves(receiver))if(row.kind==='inputField'){
        charge();if(property===null||!['reference','array'].includes(type.types.get(receiverType)?.kind)){
          const dependency={kind:'dependency',reason:'nested-writeback',target:fn.id,path:[],range:fn.range,sourcePath:fn.sourcePath};
          dependencies.push(dependency);requirements.push(dependency);continue;}
        const input=inputField(row.index,property,row.properties),slot=slotFor(input);
        slot.receiverType=receiverType;bindingWrites.push(slot.key);
        const prior=bindings.get(slot.key)??entry(slot);
        bindings.set(slot.key,leaves(receiver).length===1?copy(payload):choice([prior,copy(payload)]));writtenSlots.add(slot.key);
        for(const [index,parameter]of parameters.entries()){charge();if(index!==row.index&&parameter.kind==='aggregate')invalidate(parameter);}
      }
      // Distinct formal references have no noalias privilege. An update may
      // invalidate another formal's incoming field, even before its first read.
      for(const object of leaves(receiver))if(object.kind==='aggregate'&&object.slot!==null&&
        !(fn.construction&&object===parameters[0])&&
        (type.isArray(object.type)||type.types.get(object.type)?.kind==='reference'))
        for(const parameter of parameters){charge();if(parameter!==object&&parameter.kind==='aggregate'&&
          (type.isArray(parameter.type)||type.types.get(parameter.type)?.kind==='reference'))invalidate(parameter);}
      if(property===null){for(const object of leaves(receiver))if(object.kind==='aggregate')invalidate(object);return;}
      write(receiver,property,payload,changed);
    };
    const bind=(id,value)=>{
      if(terminated)return;
      charge();bindingWrites.push(id);bindings.set(id,copy(value));
    };
    const state=()=>{
      const names=new Map();for(const [id,value]of bindings){charge();names.set(id,value);}
      const written=new Set();for(const id of writtenSlots){charge();written.add(id);}
      return {bindings:names,planes:snapshot(bindings.values(),parameters),written,terminated,
        mutations:mutations.length,writes:bindingWrites.length,observations:observations.length,
        requirements:requirements.length,projected:projectedEvents.length};
    };
    const restoreState=before=>{
      restore(before.planes);for(const id of bindings.keys()){charge();bindings.delete(id);}
      for(const [id,value]of before.bindings){charge();bindings.set(id,value);}writtenSlots.clear();for(const id of before.written){charge();writtenSlots.add(id);}terminated=before.terminated;
    };
    const join=alternatives=>{
      const states=[];for(const row of alternatives){charge();if(!row.terminated)states.push(row);}
      if(!states.length){terminated=true;return;}if(states.length===1){restoreState(states[0]);return;}
      const objects=new Set(),names=new Set();
      for(const row of states){charge();for(const object of row.planes.keys()){charge();objects.add(object);}
        for(const name of row.bindings.keys()){charge();names.add(name);}}
      for(const object of objects){charge();const members=new Set();
        for(const row of states){charge();for(const member of row.planes.get(object)?.fields.keys()??[]){charge();members.add(member);}}
        for(const member of object.fields.keys()){charge();object.fields.delete(member);}object.invalidated=false;object.extentChanged=false;object.extentTokens=[];
        for(const member of members){charge();const payloads=[];
          for(const row of states){charge();const plane=row.planes.get(object);if(!plane)continue;
            payloads.push(plane.fields.get(member)??(object.fallback!==null&&!plane.invalidated
              ?inputField(object.fallback,member):unknown));}
          object.fields.set(member,choice(payloads));}
        let extent;for(const row of states){charge();const plane=row.planes.get(object);if(!plane)continue;
          object.invalidated||=plane.invalidated;object.extentChanged||=plane.extentChanged;
          for(const token of plane.extentTokens){charge();object.extentTokens.push(token);}
          extent=extent===undefined?plane.extent:extent===plane.extent?extent:null;}object.extent=extent??null;
      }
      for(const id of bindings.keys()){charge();bindings.delete(id);}
      for(const name of names){charge();const payloads=[];for(const row of states){charge();payloads.push(row.bindings.get(name)??(slots.has(name)?entry(slots.get(name)):unknown));}
        bindings.set(name,choice(payloads));}writtenSlots.clear();
      for(const row of states)for(const id of row.written){charge();writtenSlots.add(id);}terminated=false;
    };
    const enterLoop=before=>{
      const id=++loopSerial;before.loop=id;activeLoops.push(id);
      // Symbolic entry labels expose only loop-carried dependencies. Strong
      // writes kill these labels; unchanged slots retain their exact payload.
      for(const [name,value]of bindings){charge();bindings.set(name,{kind:'loaded',value,tokens:[{loop:id,binding:name}]});}
      for(const [object,plane]of before.planes){
        charge();object.extentTokens.push({loop:id,object});
        for(const [member,value]of plane.fields){charge();object.fields.set(member,{kind:'loaded',value,tokens:[{loop:id,object,member}]});}}
    };
    const leaveLoop=(before,conditionExit,repeats=true,zero=true)=>{
      activeLoops.pop();
      // Even zero iterations evaluate the condition. Preserve its successful
      // effects rather than restoring the state from before that evaluation.
      if(terminated){if(zero)restoreState(conditionExit);return;}
      const slots=new Map(),names=new Set();
      for(let i=before.mutations;i<mutations.length;++i){charge();const [object,member]=mutations[i];
        if(!slots.has(object))slots.set(object,new Set());slots.get(object).add(member);}
      for(let i=before.writes;i<bindingWrites.length;++i){charge();names.add(bindingWrites[i]);}
      const settled=new Map(),pending=[];
      const settle=value=>{
        charge();if(value?.kind==='loaded'){
          const keep=[];for(const token of value.tokens){charge();if(token.loop!==before.loop){keep.push(token);continue;}
            if(repeats&&(token.binding!==undefined?names.has(token.binding):slots.get(token.object)?.has(null)||slots.get(token.object)?.has(token.member)))return unknown;}
          const payload=settle(value.value);return keep.length?{kind:'loaded',value:payload,tokens:keep}:payload;
        }
        if(value?.kind==='choice')return choice(value.values.map(settle));
        if(value?.kind==='aggregate'&&!settled.has(value)){settled.set(value,value);pending.push(value);}return value??unknown;
      };
      const drain=()=>{while(pending.length){charge();const object=pending.pop();
        const keep=[];for(const token of object.extentTokens){charge();if(token.loop!==before.loop)keep.push(token);
          else if(repeats&&(slots.get(token.object)?.has('extent')||slots.get(token.object)?.has(null)))object.extent=null;}
        object.extentTokens=keep;
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
        row.value=settle(row.value);drain();if(row.kind!=='effect')row.evidence=origins(row.value);else row.owner=effectOwner(row.value);}
      for(let i=0;i<returns.length;++i){charge();returns[i]=settle(returns[i]);}
      for(const exit of exits)for(let i=0;i<exit.length;++i){charge();exit[i]=settle(exit[i]);}
      for(const exit of slotExits)for(const [id,value]of exit){charge();exit.set(id,settle(value));}drain();
      if(zero){const after=state();join([conditionExit,after]);}
    };
    const invoke=(summary,actuals,call,path,range)=>{
      if(!summary)return unknown;
      const memo=new Map(),pending=[];
      // Input fields, including nested reference planes, are read at call
      // entry. Later selected-target writes must not mutate that snapshot.
      const incoming=cloneSnapshot(snapshot(actuals));
      const original=actuals.map(value=>incoming.remap(value)),live=new Map();
      for(const [actual,clone]of incoming.clones){charge();live.set(clone,actual);}
      const project=value=>{
        charge();if(!value)return unknown;
        if(value.kind==='loaded')return {kind:'loaded',value:project(value.value),tokens:value.tokens};
        if(value.kind==='choice')return choice(value.values.map(project));
        if(value.kind==='inputField'){
          let result=original[value.index];for(const member of value.properties){charge();result=read(result,member);}return result;
        }
        if(value.kind==='owner'){
          if(value.parameter!==undefined)return actuals[value.parameter]??unknown;
          if(value.span&&value.sources.length===1&&value.sources[0].parameter!==undefined)return actuals[value.sources[0].parameter]??unknown;
          if(!value.span&&type.isArray(value.type)&&value.owner?.kind==='parameter'&&value.owner.functionId===call.target)
            return actuals[value.owner.index]??unknown;
          const owner=tools.map(value.owner,call,fn.id,()=>{throw new TypeError('r03-d-readspan-storage: invalid owner substitution');});
          const sources=[];
          for(const source of value.sources){charge();const id=fn.id+'@'+key(path)+'@'+source.id;
            const at=[];for(const part of path){charge();at.push(part);}
            const mapped={id,functionId:fn.id,path:at,owner,ownerRooted:source.ownerRooted===true&&rootedOwner(owner),
              storedOrigin:{functionId:source.functionId,path:source.path??null}};
            captures.set(id,{...mapped,range,callPath:at});sources.push(mapped);}
          let result={kind:'owner',owner,span:value.span,sources,type:value.type};
          for(const root of tools.leaves(value.owner))if(root.kind==='parameter'&&root.functionId===call.target)
            result=inherit(result,actuals[root.index]);
          return result;
        }
        if(value.kind!=='aggregate')return unknown;
        if(value.slot!==null)return actuals[value.slot]??unknown;
        if(memo.has(value))return memo.get(value);const result=aggregate(value.type,null,value.owner
            ?tools.map(value.owner,call,fn.id,()=>{throw new TypeError('r03-d-readspan-storage: invalid array substitution');}):undefined);
        result.extent=value.extent;result.extentChanged=value.extentChanged;
        for(const token of value.extentTokens){charge();result.extentTokens.push(token);}
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
            requirements.push(mapped);events.push(row.kind==='create'?{...mapped,evidence}:{...mapped,owner:effectOwner(value)});
          }
        }
        if(events.length){
          const id=key(path);if(!callEvents.has(id))callEvents.set(id,[]);
          for(const event of events){charge();callEvents.get(id).push(event);projectedEvents.push(event);}
        }
      }
      // Snapshot reads preserve entry versions; reference outputs retain
      // the actual alias identity rather than publishing a snapshot clone.
      const publish=value=>substitute(project(value),row=>live.has(row)&&type.types.get(row.type)?.kind!=='value'?live.get(row):row);
      // Every nested output is relative to the immutable call entry. Reading
      // that snapshot selects the real receiver, not a replacement installed
      // by another output. All possibly aliased outputs join before writing.
      const outputs=[];
      for(const [index,parameter]of summary.parameters.entries()){
        charge();if(parameter.kind!=='aggregate'||!(summary.receiver&&index===0)&&type.types.get(parameter.type)?.kind==='value')continue;
        if(parameter.invalidated)for(const target of leaves(actuals[index]))if(target.kind==='aggregate')invalidate(target);
        if(type.isArray(parameter.type)&&parameter.extentChanged)extent(actuals[index],parameter.extent,changed,invalidate);
        for(const [member,payload]of parameter.fields){charge();outputs.push({receiver:actuals[index],property:member,value:publish(payload),type:parameter.type});}
      }
      for(const row of summary.nested){
        charge();let receiver=original[row.input.index];
        for(const member of row.input.properties.slice(0,-1)){charge();receiver=read(receiver,member);}
        outputs.push({receiver:substitute(receiver,value=>live.get(value)??value),property:row.input.properties.at(-1),value:publish(row.value),type:row.type});
      }
      const concrete=[];
      for(const row of outputs){charge();const candidates=leaves(row.receiver);
        for(const receiver of candidates){charge();const value=candidates.length===1?row.value:choice([readStored(receiver,row.property),row.value]);
          if(receiver.kind==='inputField')store(receiver,row.property,value,row.type);
          else concrete.push({...row,receiver,value});}}
      if(!applyWrites(concrete,changed)){
        const dependency={kind:'dependency',reason:'nested-writeback',target:call.target,path,range,sourcePath:fn.sourcePath};
        dependencies.push(dependency);requirements.push(dependency);
      }
      const result=publish(summary.returned);
      while(pending.length){charge();const [from,to]=pending.pop();
        for(const [member,payload]of from.fields){charge();to.fields.set(member,publish(payload));}}
      return result;
    };
    const requireInput=(value,path,range)=>{
      const evidence=origins(value);
      if(context&&evidence.unknown){const dependency={kind:'dependency',target:fn.id,path,range,sourcePath:fn.sourcePath};
        dependencies.push(dependency);requirements.push(dependency);}
      if(context&&evidence.unknown)return;
      if(!evidence.inputs.length&&!evidence.unknown){
        if(context)requirements.push({kind:'use',value,path,range,sourcePath:fn.sourcePath,checks:[]});return;
      }
      const demand={contexts:0,failed:false,formal:true,range};demands.push(demand);deferred.set(key(path),demand);
      requirements.push({kind:'use',value,path,range,sourcePath:fn.sourcePath,checks:[demand]});
    };
    const record=(value,path,owner,call,effect,facts=[])=>{
      if(terminated)return owner;
      charge();
      /** @type {StoredValue} */
      let result=unknown;
      const child=name=>get([...path,name]);
      if(value.kind==='reference')result=bindings.get(value.binding)??unknown;
      else if(['group','assertType','nonNull'].includes(value.kind))result=child('operand');
      else if(value.kind==='arrayCreate'){
        if(!contains.has(value.type))result={kind:'owner',owner,span:false,sources:[],type:value.type};
        else result=array(value.type,owner,value.elements.length,index=>get([...path,'elements',index]));
      }else if(value.kind==='arrayReadChecked'&&contains.has(value.receiver.type))result=readStored(child('receiver'),index(value.index));
      else if(value.kind==='arrayStoreDenseChecked'&&contains.has(value.target.receiver.type)){
        result=copy(child('value'));store(get([...path,'target','receiver']),index(value.target.index),result,value.target.receiver.type);
      }else if(value.kind==='arrayResizeChecked'&&contains.has(value.target.receiver.type)){
        truncate(get([...path,'target','receiver']),value.value,changed,invalidate);
      }
      else if(value.kind==='fieldAccess')result=readStored(child('receiver'),value.property);
      else if(value.kind==='fieldAssignment'){
        result=child('value');store(get([...path,'target','receiver']),value.target.property,copy(result),value.target.receiver.type);
      }else if(value.kind==='assignment'){result=child('value');bind(value.target.binding,result);result=bindings.get(value.target.binding);}
      else if(hasConditionalArrayRhs(value))result=choice([child('left'),child('right')]);
      else if(['call','construct','superConstruct'].includes(value.kind)){
        const arguments_=value.arguments.map((_,i)=>{charge();return get([...path,'arguments',i]);});
        if(value.target===hir.intrinsics.readSpan.id){
          // The descriptor carries the original typed Array reference. A
          // narrower static view or an unresolved owner cannot prove that edge.
          const span=type.types.get(value.type),arrays=leaves(arguments_[0]);
          const ownerRooted=arrays.length>0&&arrays.every(row=>{
            charge();const declared=type.types.get(row.type);
            return declared?.kind==='array'&&span?.kind==='readSpan'&&declared.elementType===span.elementType&&rootedOwner(row.owner);
          });
          result=inherit({kind:'owner',owner,span:true,type:value.type,sources:[{id:fn.id+'@'+key(path),
            functionId:fn.id,path:[...path],owner,ownerRooted}]},arguments_[0]);
          requirements.push({kind:'create',value:result,path,range:value.range,sourcePath:fn.sourcePath});
        }else if(call){
          const constructor=value.kind!=='call',receiver=constructor
            ?value.kind==='superConstruct'?bindings.get(value.receiverBinding):aggregate(value.type):child('receiver');
          const actuals=constructor?[receiver,...arguments_]:value.receiver?[receiver,...arguments_]:arguments_;
          const results=[];
          // A call executes on this structured arm. The enclosing branch
          // joins its skip path; selected targets alone share this prestate.
          const before=state(),branches=[];before.planes=snapshot(bindings.values(),actuals);
          for(const target of call.targets){
            charge();restoreState(before);const selected={...call,target:target.target};
            // The entry planes remain parameter-relative. Only actual scalar
            // evidence selects a recursive continuation of the same walker.
            const aliases=entryAliases(actuals);
            const summary=resolveContext?.(target.target,facts,aliases,summaries.get(target.target))??summaries.get(target.target);
            const inputs=actuals.map((value,index)=>{charge();return summary?.receiver&&index===0?value:copy(value);});
            // Keep the fixed entry interval independently of detailed effects;
            // report a real body mutation first when both establish a conflict.
            const upper=published?.(target.target),at=[...path,'callee',target.target],uppers=[];
            for(const slot of upper?.parameters??[]){charge();if(slot.structural)uppers.push({kind:'effect',fixedUpper:true,
              value:inputs[slot.index]??unknown,path:at,range:value.range,sourcePath:fn.sourcePath,structural:true});}
            if(upper?.local.structural)uppers.push({kind:'effect',fixedUpper:true,value:unknown,path:at,range:value.range,sourcePath:fn.sourcePath,structural:true});
            if(!summary){
              // A returning arm must not erase its unresolved activation.
              // Only this storage family needs this dependency; unrelated
              // scalar/ordinary Span recursion keeps its existing analysis.
              const needs=aggregateBoundary(value.type)||value.receiver&&aggregateBoundary(value.receiver.type)
                ||value.arguments.some(argument=>{charge();return aggregateBoundary(argument.type);});
              if(needs){const dependency={kind:'dependency',target:target.target,path,range:value.range,sourcePath:fn.sourcePath};
                dependencies.push(dependency);requirements.push(dependency);}
              for(const [object]of before.planes)invalidate(object);
            }
            const result=invoke(summary,inputs,selected,path,value.range);results.push(result);
            for(const row of uppers){charge();requirements.push(row);}
            const branch=state();branch.planes=snapshot(before.planes.keys(),[result]);branches.push(branch);
          }
          // Entry-slot versions and aggregate planes share the same target
          // fork. A sibling target must never observe an earlier output.
          if(branches.length)join(branches);else restoreState(before);
          result=constructor?receiver:choice(results);
        }
      }else if(type.isOwner(value.type)&&owner)result={kind:'owner',owner,span:type.isView(value.type),sources:[],type:value.type};
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
      const payloadOwners=[];for(const payload of leaves(result))if(payload.kind==='owner'||payload.kind==='aggregate'&&payload.owner){charge();payloadOwners.push(payload.owner);}
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
      // Only the current normal-return graph roots these sources. Merely
      // having stored a descriptor earlier does not keep an overwritten one.
      const work=[{value,borrowed:contains.has(fn.returnType.id),retaining:false}],seen=new Set(),sources=new Map(),retained=new Map();let pending=false;
      while(work.length){charge();const {value:row,borrowed,retaining}=work.pop();
        if(row?.kind==='loaded')work.push({value:row.value,borrowed,retaining});
        else if(row?.kind==='choice')for(const child of row.values){charge();work.push({value:child,borrowed,retaining});}
        else if(row?.kind==='aggregate'&&!seen.has(row)){
          seen.add(row);let current=type.types.get(row.type);
          const owned=['reference','value'].includes(current?.kind);
          if(type.isArray(row.type)){
            const slots=elements(row);
            if(slots===null){pending=true;for(const value of row.fields.values()){charge();work.push({value,borrowed:true,retaining:false});}}
            else for(const value of slots){charge();work.push({value,borrowed:true,retaining:true});}
          }
          while(current){charge();for(const member of current.fields??[]){charge();if(contains.has(member.type))
            work.push({value:row.fields.get(member.id)??unknown,borrowed:true,retaining:owned});}current=type.types.get(current.base);}
        }else if(row?.kind==='owner'&&row.span)for(const source of row.sources){
          charge();sources.set(source.id,source);const rooted=retaining&&source.ownerRooted===true;
          retained.set(source.id,rooted&&(retained.get(source.id)??true));}
        else if(borrowed&&row?.kind!=='aggregate')pending=true;
      }
      const retainedSources=[];for(const [id,rooted]of retained){charge();if(rooted)retainedSources.push(id);}
      return {sources:[...sources.values()],pending,retainedSources};
    };
    return {model,record,initialize,bind,get,state,restore:restoreState,join,enterLoop,leaveLoop,
      returned:(value,path)=>{
        if(terminated)return;
        charge();const copied=copy(value),roots=[copied];
        for(const binding of bindings.values()){charge();roots.push(binding);}
        const state=cloneSnapshot(snapshot(parameters,roots));
        const frozen=state.remap(copied),evidence=returnOrigins(frozen);returnReads.set(key(path),evidence);
        observations.push({value:frozen,evidence,aggregate:true});
        returns.push(frozen);exits.push(parameters.map(parameter=>state.remap(parameter)));
        const output=new Map();for(const id of writtenSlots){charge();output.set(id,state.remap(bindings.get(id)));}slotExits.push(output);terminated=true;
      },
      finish:(loops=[],fallsThrough=true)=>{
        // Only normal-return field snapshots reach a caller. A conditional
        // return also retains the possible fallthrough state; a later store
        // cannot rewrite the snapshot of an earlier return.
        if(!terminated&&fallsThrough){const state=cloneSnapshot(snapshot(parameters,bindings.values()));exits.push(parameters.map(parameter=>state.remap(parameter)));
          const output=new Map();for(const id of writtenSlots){charge();output.set(id,state.remap(bindings.get(id)));}slotExits.push(output); }
        const outputs=parameters.map((parameter,index)=>{
          charge();if(parameter.kind!=='aggregate')return parameter;
          const result=aggregate(parameter.type,index,parameter.owner),members=new Set();
          let extent;for(const exit of exits){charge();const plane=exit[index];
            extent=extent===undefined?plane.extent:extent===plane.extent?extent:null;
            for(const member of plane.fields.keys()){charge();members.add(member);}
            result.invalidated||=exit[index].invalidated;}
          for(const exit of exits){charge();result.extentChanged||=exit[index].extentChanged;
            for(const token of exit[index].extentTokens){charge();result.extentTokens.push(token);}}
          result.extent=extent??null;
          for(const member of members){charge();const payloads=[];for(const exit of exits){charge();payloads.push(read(exit[index],member));}
            result.fields.set(member,choice(payloads));}
          return result;
        });
        const scopes=[];for(const rows of [loops,callLoops])for(const scope of rows){charge();scopes.push(scope);}
        const nested=[];for(const slot of slots.values()){charge();if(!slotExits.some(exit=>{charge();return exit.has(slot.key);}))continue;
          const payloads=[];for(const exit of slotExits){charge();payloads.push(exit.get(slot.key)??slot.input);}
          nested.push({input:slot.input,type:slot.receiverType,value:choice(payloads)});}
        const summary={parameters:outputs,nested,receiver:!!fn.ownerType,returned:returns.length?choice(returns):unknown,
          requirements,loops:scopes,productive:exits.length>0};
        if(!context)summaries.set(fn.id,summary);return summary;
      }};
  }
  return {begin};
}
