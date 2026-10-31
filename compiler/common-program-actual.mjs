// SPDX-License-Identifier: MIT
// Calls are instantiated by actual arguments and reachable memory. Conditional
// definition/field capacities never become a particular call's actual arguments.
import {i32TypeId,boolTypeId,sha256,canonical} from './identity.mjs';
import {createHash} from 'node:crypto';
import {finiteNumericUse} from './finite-numeric-use.mjs';
import {classifyArrayCallGraph} from './array-call-graph.mjs';
import {commonAbstract,commonActualArrayReceiver} from './common-program-abstract.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonEntryReferences} from './common-program-entry.mjs';
import {commonMethods} from './common-program-methods.mjs';
import {commonCallableType} from './common-program-targets.mjs';
import {commonBorrowObservations,commonClosureHolding} from './common-program-borrow-observations.mjs';
import {commonRegions,emptyRegionValue} from './common-program-regions.mjs';
import {commonReceiverActual} from './common-program-receiver-actual.mjs';
import {commonActualContextSnapshot,commonActualContextSame,commonActualContextValues} from './common-program-actual-context.mjs';
import {commonPublicObservationContexts} from './common-program-observation-contexts.mjs';
const undefinedId=sha256('tsfg.type\0undefined');
export function analyzeCommonGraphs({model,plans},records=null,options=/** @type {{borrowProof?:boolean,storageAuthoring?:boolean}} */({borrowProof:false})) {
  const {spend,types}=model,elementSeeds=new Map(),a=commonAbstract({...model,elementSeeds}),byId=new Map(plans.map(plan=>[plan.owner.id,plan])),entryReferences=commonEntryReferences(model.hir,spend),methods=commonMethods(model.hir,spend);
  spend(model.hir.functions.length+plans.length);const publicFunctions=new Set(model.hir.functions.map(fn=>fn.id)),internalFunctions=new Set();
  for(const plan of plans)if(plan.owner.analysisOnly){
    const owner=plan.owner,type=types.get(owner.ownerType);spend();check(!publicFunctions.has(owner.id)&&model.functions.get(owner.id)===owner
      &&owner.kind==='construction-body'&&type?.construction?.functionId===owner.id,'construction');internalFunctions.add(owner.id);
  }
  const edges=[],cyclicBlocks=new Set(),uncertainFunctions=new Set();
  for(const plan of plans) {
    const blockEdges=[];
    for(const block of plan.graph.blocks)for(const op of block.instructions){spend();for(const target of op.successors)blockEdges.push({caller:block.name,target});
      if(['tsfg_program.invoke','tsfg_program.invoke_method','tsfg_program.invoke_indirect'].includes(op.name)){
        if(op.name==='tsfg_program.invoke_indirect')spend(op.properties.targets.functions.length);
        const rows=op.name==='tsfg_program.invoke_indirect'?op.properties.targets.functions.map(row=>({target:row.function_id})):op.name==='tsfg_program.invoke_method'?methods.verify(op.properties,plan.graph.registers.get(op.operands[0]).view):[{target:op.properties.function_id}],targets=new Set();
        if(op.name==='tsfg_program.invoke_indirect'&&op.properties.targets.top)uncertainFunctions.add(plan.owner.id);
        for(const {target}of rows){spend();if(targets.has(target))continue;targets.add(target);edges.push({caller:plan.owner.id,target});}}}
    if(records?.get(plan.owner.id)?.upper?.facets?.unknownHost)uncertainFunctions.add(plan.owner.id);
    spend(plan.graph.blocks.length+blockEdges.length);
    for(const c of classifyArrayCallGraph(plan.graph.blocks.map(block=>block.name),blockEdges).components)if(c.cyclic)
      for(const name of c.members)cyclicBlocks.add(plan.owner.id+'/'+name);
  }
  const cyclicFunctions=new Set();spend(plans.length+edges.length);
  for(const c of classifyArrayCallGraph(plans.map(plan=>plan.owner.id),edges).components)if(c.cyclic)for(const id of c.members)cyclicFunctions.add(id);
  // Unknown invocation can reenter an ancestor. Distinct verified acyclic call
  // sites alone do not repeat one physical activation or its allocations.
  let propagated;do{propagated=false;for(const edge of edges){spend();if(uncertainFunctions.has(edge.target)&&!uncertainFunctions.has(edge.caller)){uncertainFunctions.add(edge.caller);propagated=true;}}}while(propagated);
  const fieldSeeds=new Map(),globalSeeds=new Map();
  const tagsOnly=value=>{spend(value.tags.size+1);return {...a.empty(),tags:new Set(value.tags),unknown:value.unknown,truth:value.truth};};
  const seed=(map,id,value)=>{const selected=tagsOnly(value);
    if(map.has(id))return a.merge(map.get(id),selected);
    check(selected.tags.size<=256,'limit');map.set(id,selected);return selected.tags.size>0||selected.unknown||selected.truth!==0;
  };
  const literal=(type,truth=0,number=null)=>a.literal(type,truth,number);
  const read=(state,name)=>state.values.get(name)??a.empty();
  const fieldBySource=new Map([...model.fields.values()].map(field=>[field.sourceBinding,field]));
  const fieldAliases=new Map(),rawTypes=new Map(model.hir.types.map(type=>[type.sourceType,type.id]));
  for(const row of model.hir.snapshot.payload.compatibilityWitnesses) {
    const proof=row.compatibility,key=rawTypes.get(proof.sourceType)+'/'+rawTypes.get(proof.targetType),map=fieldAliases.get(key)??new Map();
    for(const pair of proof.members){spend();const from=fieldBySource.get(pair.source),to=fieldBySource.get(pair.target);if(from&&to)map.set(to.id,from.id);}fieldAliases.set(key,map);
  }
  const fieldRouteGaps=new Set();
  const fieldFor=(actual,view,field)=>{
    if(a.fields(actual).some(row=>row.id===field))return field;
    const mapped=fieldAliases.get(actual+'/'+view)?.get(field);
    if(!mapped&&options.storageAuthoring){fieldRouteGaps.add(actual+'/'+view+'/'+field);return field;}
    check(mapped,'capability','actual field has no original verified member mapping');return mapped;
  };
  const dummyHeap=new Map(),dummyObjects=new Map();
  for(const [id,binding]of model.bindings)if(binding.role==='field')seed(fieldSeeds,id,a.declared(binding.type,dummyHeap,'conditional',new Map(),dummyObjects));
  for(const type of types.values())if(type.kind==='array')seed(elementSeeds,'element:'+type.id,a.declared(type.elementType,dummyHeap,'conditional',fieldSeeds,dummyObjects));
  for(const global of model.hir.globals)seed(globalSeeds,global.sourceBinding,a.declared(global.type,dummyHeap,'conditional',fieldSeeds,dummyObjects));
  function solve(bounded) {
    const contexts=new Map(),contextBuckets=new Map(),observed=new Map(),objects=new Map(),operations=new Map(),callTargets=new Map(),regions=commonRegions(spend),pending=[],queued=new Set();
    const storageFields=new Map(),storageGaps=new Set();spend(model.fields.size);
    for(const field of model.fields.values())storageFields.set(field.id,{actualTypes:new Set(),unknown:false});
    const recordStorageField=(fieldId,input,selected)=>{
      const bound=storageFields.get(fieldId);check(bound,'identity');
      bound.unknown ||= input.unknown||selected.unknown||!selected.refs.size;
      spend(input.tags.size);
      for(const id of input.tags){
        const kind=types.get(id)?.kind;
        if(!kind||['union','unknown','void'].includes(kind))bound.unknown=true;
        else bound.actualTypes.add(id);
      }
    };
    const signatureClosed=id=>['scalar','string','undefined','null','void'].includes(types.get(id)?.kind);
    const receiver=commonReceiverActual({spend,types,objects},a);
    const world=()=>({...a.state(),frames:receiver.store()});
    const cloneWorld=state=>({...a.fork(state),frames:receiver.fork(state.frames)});
    const joinWorld=(into,from)=>{const values=a.joinFork(into,from),frames=receiver.join(into.frames,from.frames);return values||frames;};
    let changed=false,invalidateCapacity=false,invalidateWeak=false;
    const schedule=id=>{spend();if(!queued.has(id)){queued.add(id);pending.push(id);}};
    if(!bounded)regions.prepare(plans);
    const entryValue=(plan,parameter,heap)=>{
      const authority=entryReferences(plan.owner.id,parameter.id),entry=authority?{...authority,observe(kind,id,value){
        if(!bounded)return;const seeds=kind==='field'?fieldSeeds:elementSeeds;
        invalidateCapacity=seed(seeds,id,value)||invalidateCapacity;
      }}:undefined;
      if(parameter.hidden)return environmentEntry(parameter.type.slice(4),heap,'entry/'+plan.owner.id);
      if(commonCallableType(parameter.type,types,spend)){const result=types.get(parameter.type)?.kind==='function'?a.literal(parameter.type):a.declared(parameter.type,heap,'entry/'+plan.owner.id+'/'+parameter.id,fieldSeeds,objects),index=plan.owner.parameters.findIndex(p=>p.id===parameter.id),upper=model.callables.summaries.get(plan.owner.id).parameters.get(index);result.unknown=upper.top;
        for(const id of upper.ids){spend();const fn=model.functions.get(id),env=fn.lexicalEnvironment?environmentEntry(fn.lexicalEnvironment,heap,'callable-entry/'+plan.owner.id+'/'+parameter.id+'/'+id):null;
          const ref=env?[...env.refs][0]:null;result.pairs.set(id+'\0'+(ref??''),{functionId:id,environment:ref});if(ref)result.refs.add(ref);}return result;}
      return a.declared(parameter.type,heap,'entry/'+plan.owner.id+'/'+parameter.id,fieldSeeds,objects,new Set(),entry);
    };
    const observe=(id,value)=>{spend();if(!observed.has(id))observed.set(id,a.empty());a.merge(observed.get(id),value);};
    const currentGlobals=heap=>{
      for(const global of model.hir.globals){spend();const value=a.declared(global.type,heap,'global-entry/'+global.id,fieldSeeds,objects),upper=globalSeeds.get(global.sourceBinding);
        if(upper?.unknown)value.unknown=true;
        for(const tag of upper?.tags??[])a.merge(value,a.declared(tag,heap,'global-entry/'+global.id,fieldSeeds,objects));heap.set('global:'+global.id,value);}
    };
    function environmentEntry(layoutId,heap,origin){const layout=model.environments.get(layoutId);check(layout,'environment');const value=a.literal('env:'+layoutId),ref=origin+'/environment/'+layoutId;value.refs.add(ref);objects.set(ref,{type:'env:'+layoutId,weak:true});
      for(const slot of layout.slots){spend();heap.set(ref+'/slot/'+slot.key,a.declared(slot.type,heap,origin,fieldSeeds,objects));}if(layout.parent)heap.set(ref+'/parent',environmentEntry(layout.parent,heap,origin));return value;}
    const identity=commonActualContextValues(a,regions,spend);
    function context(target,args,heap=new Map(),root=false,activation='entry/'+target,repeated=false,activationSize=activation.length,regionScope='',regionHeap=new Map(),frameWorld=receiver.store()) {
      const plan=byId.get(target);check(plan&&args.length===plan.parameters.length,'ssa');
      repeated ||= !activation||cyclicFunctions.has(target)||uncertainFunctions.has(target);
      // Existing call contexts own immutable entry snapshots. Recheck the
      // current heap projection and every Value facet before reusing one;
      // mutable caller heaps and field/Env versions are never cache keys.
      const snapshot=commonActualContextSnapshot({target,args,heap,frameWorld,regionHeap,activation,repeated,regionScope},a,receiver,regions,spend);
      // This exact scalar partition only narrows candidates. Complete owned
      // equality below still decides reuse; mutable heap identity is not a key.
      spend(Math.ceil((2*(target.length+activation.length+regionScope.length)+128)/64)+10);
      const bucketKey=[target,activation,regionScope].map(value=>value.length+':'+value).join('|')+'|'+Number(repeated);
      const {entryHeap,entryFrames,entryRegions}=snapshot,entries=contextBuckets.get(bucketKey)??[];spend(entries.length);
      for(const current of entries){spend();if(!current.root&&commonActualContextSame(current.entrySnapshot,snapshot,identity,receiver,regions,spend))return current;}
      // Complete owned equality above is the invocation interner. The fresh
      // name is private to this solver, never an emitted source identity.
      spend(Math.ceil((6*target.length+32)/8)+5);const key=target+'/context:'+contexts.size;
      if(!contexts.has(key)){spend(args.length+1);check(contexts.size<4096,'limit');
        // Runtime-domain copying may normalize rootless numeric relations.
        // Identity owns the original relation independently of execution.
        contexts.set(key,{entrySnapshot:snapshot,id:key,activation,activationSize,repeated,regionScope,entryRegions,entryFrames,createdRegions:new Set(),callers:new Set(),plan,args:args.map(a.copy),entryHeap,root,
        returned:a.empty(),thrown:a.empty(),normal:false,language:false,normalHeap:new Map(),languageHeap:new Map(),normalRegions:new Map(),languageRegions:new Map(),normalFrames:receiver.store(),languageFrames:receiver.store()});spend(Math.ceil(bucketKey.length/64)+2);entries.push(contexts.get(key));contextBuckets.set(bucketKey,entries);changed=true;schedule(key);}
      return contexts.get(key);
    }
    function rootEntry(plan,newTarget=null) {
      const heap=new Map(),frames=receiver.store();currentGlobals(heap);
      const activation='entry/'+plan.owner.id+(newTarget?'/'+newTarget:'');
      spend(plan.parameters.length);const args=plan.parameters.map(parameter=>{
        if(!parameter.frame&&!signatureClosed(parameter.type))storageGaps.add('entry parameter actual domain is not closed: '+plan.owner.id+'/'+parameter.id);
        if(!parameter.frame)return entryValue(plan,parameter,heap);
        const owner=types.get(plan.owner.ownerType);check(owner?.construction&&newTarget,'identity');
        const value=a.empty(),id=receiver.create(frames,{activation,site:'constructor-root',owner:owner.id,construction:owner.construction.id,newTarget,
          derived:Boolean(owner.base),fields:owner.construction.initializationFields,repeated:false});
        value.frames.add(id);return value;
      });
      return {heap,frames,args,activation};
    }
    const constructionRoots=new Map(),constructionEntries=new Set(),missingConstructionPairs=[];spend(types.size);
    for(const target of types.values()){
      if(!target.construction||!['reference','value'].includes(target.kind))continue;
      let owner=target;
      while(owner){
        spend();
        if(owner.construction){
          const pair={constructionId:owner.construction.id,owner:owner.id,newTarget:target.id},plan=byId.get(owner.construction.functionId);
          if(!plan)missingConstructionPairs.push(pair);
          else {
            const entry=rootEntry(plan,target.id),current=context(plan.owner.id,entry.args,entry.heap,true,entry.activation,false,entry.activation.length,'',new Map(),entry.frames);
            current.constructionRoot=pair;constructionRoots.set(owner.construction.id+'/'+target.id,current);constructionEntries.add(plan.owner.id);
          }
        }
        owner=types.get(owner.base);
      }
    }
    for(const plan of plans) {
      if(plan.owner.lexicalParent||constructionEntries.has(plan.owner.id))continue;
      const entry=rootEntry(plan);context(plan.owner.id,entry.args,entry.heap,true,entry.activation,false,entry.activation.length,'',new Map(),entry.frames);
    }
    function closedTarget(target){
      spend();return !bounded&&regions.layouts.get(target)?.acyclic===true&&!cyclicFunctions.has(target)&&!uncertainFunctions.has(target);
    }
    const holdingPolicy=commonClosureHolding({model,objects,records,closedTarget});
    function holdingTransport(c,target,targets,selected){
      if(!closedTarget(target)||uncertainFunctions.has(c.plan.owner.id))return false;
      spend(selected.length);const actual=new Set(selected);
      for(const id of targets){spend();if(!actual.has(id)||!holdingPolicy.permitsCode(id))return false;}
      return true;
    }
    function callRegion(c,block,activation,target,passed,targets,selected){
      if(bounded||!regions.layouts.get(target)?.acyclic||cyclicFunctions.has(target)||uncertainFunctions.has(target)||uncertainFunctions.has(c.plan.owner.id))return '';
      spend(selected.length);const actual=new Set(selected);for(const id of targets){spend();if(!actual.has(id)||!records?.has(id)||records.get(id).upper.facets.unknownHost)return '';}
      if(c.regionScope)return c.regionScope;
      const incoming=new Set();let opaque=false,unprovedRaw=false;for(const value of passed){spend();opaque ||= value.region.opaque;unprovedRaw ||= value.unknown||value.refs.size>0||value.cells.size>0;
        for(const id of value.region.roots){spend();const scope=regions.nodes.get(id)?.scope;if(scope)incoming.add(scope);else opaque=true;}}
      if(incoming.size)return !opaque&&incoming.size===1?incoming.values().next().value:'';
      if(opaque||unprovedRaw)return '';
      const loop=regions.loopAt(c.plan.owner.id,block);if(!loop)return '';
      spend(Math.ceil((c.id.length+loop.header.length+1)/64));return regions.scope(c.id+'/'+loop.header,activation);
    }
    function execute(c,observer=null) {
        spend();const plan=c.plan,fn=plan.owner.id,entry=world();if(!c.root||!bounded)entry.heap=a.forkHeap(c.entryHeap);entry.regions=regions.heapCopy(c.entryRegions);entry.frames=receiver.fork(c.entryFrames);
        spend(Math.ceil((c.activation.length+fn.length+1)/64));const scope=c.activation+'/'+fn;
        const site=(kind,...parts)=>{
          spend(parts.length+41);const hash=createHash('sha256');
          for(const value of ['tsfg.actual-site.v1',c.activation,fn,kind,...parts]){
            spend(Math.ceil((2*value.length+32)/8)+2);hash.update(String(value.length)+':','ascii');hash.update(value,'utf16le');
          }
          return 'actual-site/sha256:'+hash.digest('hex');
        };
        // Actual-mode seed catalogues are fixed. Its owned initial root heap/args
        // were already projected when the context was created; clone them.
        // Capacity roots must still regenerate when shared seeds grow.
        if(c.root&&bounded){const initialized=rootEntry(plan,c.constructionRoot?.newTarget??null);entry.heap=initialized.heap;entry.frames=initialized.frames;c.args=initialized.args;c.entryHeap=a.snapshot(entry.heap);c.entryFrames=receiver.clone(entry.frames);}
        for(const [index,p]of plan.entry.parameters.entries())entry.values.set(p.name,a.copy(c.args[index]));
        observer?.begin(c,entry.heap);let point=null,currentBlock=plan.entry.name;
        const blocks=new Map(plan.graph.blocks.map(block=>[block.name,block])),states=new Map([[plan.entry.name,entry]]),queue=[plan.entry.name],queued=new Set(queue);
        const abandonInitializers=state=>{
          const cursors=new Set();spend(state.values.size);
          for(const value of state.values.values()){spend(value.cursors.size);for(const id of value.cursors)cursors.add(id);}
          receiver.abort(state.frames,cursors);
        };
        const edge=(name,from,args=[],callReturn=false,owned=callReturn)=>{
          if(observer&&!callReturn)observer.edge(point,observer.block(c,name));
          spend(args.length+1);const block=blocks.get(name);check(block&&block.parameters.length===args.length,'ssa');const next=owned?from:cloneWorld(from);
          for(const [i,p]of block.parameters.entries())next.values.set(p.name,a.copy(args[i]));
          if(!bounded)regions.feedback(c,currentBlock,name,next,Boolean(observer),receiver);
          if(!states.has(name)){states.set(name,next);if(!queued.has(name)){queue.push(name);queued.add(name);}}
          else if(joinWorld(states.get(name),next)&&!queued.has(name)){queue.push(name);queued.add(name);}
        };
        for(let index=0;index<queue.length;index++) {
          spend();const block=blocks.get(queue[index]),state=cloneWorld(states.get(block.name));currentBlock=block.name;queued.delete(block.name);
          let previous=observer?.block(c,block.name);
          for(const p of block.parameters)observe(fn+'/'+p.name,read(state,p.name));
          for(const [instruction,op]of block.instructions.entries()) {
            spend(op.operands.length+1);const args=op.operands.map(name=>read(state,name)),p=op.properties,name=op.name.replace('tsfg_program.','');let value=a.empty(),continues=true,storedArray=false;
            const hardEscape=input=>{regions.escape(input.region,state.regions);observer?.hardEscape(input,state.heap);};
            if(observer){if(name!=='cf.br'&&name!=='route')for(const arg of args){if(arg.unknown)hardEscape(arg);else regions.observe(arg.region,state.regions);}
              if((name==='func.return'&&!c.regionScope||name==='return_throw')&&args.length)hardEscape(args[0]);}
            if(observer){point=c.id+'/'+block.name+'/'+instruction;observer.edge(previous,point);storedArray=observer.before(c,op,state,args,point);previous=point;}
            const weakSlot=key=>{
              for(const marker of ['/field/','/element/','/length','/owner','/start','/slot/','/parent']){spend();const at=key.lastIndexOf(marker);if(at>=0&&objects.has(key.slice(0,at)))return objects.get(key.slice(0,at)).weak;}
              return false;
            };
            const update=(heap,key,value,strong=!weakSlot(key))=>a.writeFork(heap,key,value,strong);
            const put=(key,value,strong=undefined)=>update(state.heap,key,value,strong);
            const putRegion=(receiver,slot,input,definite=true,covered=false,relation=input.region)=>{
              const outward=regions.store(receiver,slot,relation,state.regions,Boolean(observer),definite,covered);
              if(observer&&outward&&!covered)observer.hardEscape(input,state.heap);
            };
            const mergeSlots=keys=>{const result=a.empty();for(const key of keys){spend();a.merge(result,state.heap.get(key)??a.empty());}return result;};
            const allocation=(ref,type,weak=false)=>{const before=objects.get(ref)?.weak;weak ||= before||c.repeated||cyclicBlocks.has(fn+'/'+block.name);
              if(before===false&&weak)invalidateWeak=true;objects.set(ref,{type,weak});return weak;};
            const version=(ref,type,alternative='')=>{const selected=regions.allocate(c.regionScope,c.activation,ref,type,state.regions,alternative);for(const id of selected.roots)c.createdRegions.add(id);return selected;};
            if(name==='receiver_create'){
              const owner=types.get(p.owner);check(owner?.construction,'identity');
              const id=receiver.create(state.frames,{activation:c.activation,site:block.name+'/'+instruction,owner:p.owner,construction:p.construction,newTarget:p.new_target,
                derived:Boolean(owner.base),fields:owner.construction.initializationFields,repeated:c.repeated||cyclicBlocks.has(fn+'/'+block.name)});
              value.frames.add(id);
            }else if(name==='receiver_child'){
              const owner=types.get(p.owner);check(owner?.construction,'identity');
              value.frames=receiver.child(state.frames,args[0].frames,{activation:c.activation,site:block.name+'/'+instruction,owner:p.owner,construction:owner.construction.id,
                derived:Boolean(owner.base),fields:owner.construction.initializationFields,repeated:c.repeated||cyclicBlocks.has(fn+'/'+block.name)});
            }else if(name==='receiver_allocate'){
              value=receiver.allocate(state.frames,args[0].frames,(newTarget,id,weak)=>{
                const allocated=literal(newTarget),created=site('construction',id,newTarget),ref=created;allocated.refs.add(ref);const repeated=allocation(created,newTarget,weak);allocated.region=version(ref,newTarget);
                const fields=a.fields(newTarget);spend(fields.length);receiver.birth(state.frames,id,ref,fields.map(field=>field.id),state.heap,repeated);
                // A logical missing property reads undefined before its own
                // definition. This is not a field write or physical slot claim.
                for(const field of fields){spend();const missing=literal(undefinedId);put(ref+'/field/'+field.id,missing,!repeated);putRegion(allocated.region,'field/'+field.id,missing,!repeated);}
                return allocated;
              });
            }else if(name==='receiver_bind'||name==='receiver_get'||name==='receiver_result'){
              const outcome=name==='receiver_bind'?receiver.bind(state.frames,args[0].frames,args[1]):name==='receiver_get'?receiver.get(state.frames,args[0].frames):receiver.result(state.frames,args[0].frames,args[1]);
              check(!outcome.pending,'capability','constructor result contains an unclassified actual payload');
              if(outcome.normal){const after=outcome.language?cloneWorld(state):state;receiver.overlay(after.frames,outcome.normal.frames);edge(op.successors[0],after,[outcome.normal.value],true);}
              if(outcome.language){const after=outcome.normal?cloneWorld(state):state;receiver.overlay(after.frames,outcome.language.frames);abandonInitializers(after);const thrown=a.empty();thrown.unknown=true;edge(op.successors[1],after,[thrown],true);}
              continues=false;
            }else if(name==='initialize_begin'){
              const owner=types.get(p.owner);check(owner?.construction,'identity');spend(args[1].refs.size);
              for(const ref of args[1].refs)for(const field of owner.construction.initializationFields){spend();const slot=ref+'/field/'+field;
                if(!state.heap.has(slot)){const missing=literal(undefinedId);put(slot,missing);putRegion(regions.select(args[1].region,ref),'field/'+field,missing);}}
              value.cursors=receiver.begin(state.frames,args[0].frames);
            }else if(name==='initialize_field'){
              const field=model.fields.get(p.field);check(field,'identity');recordStorageField(p.field,args[2],args[1]);
              const covered=Boolean(observer)&&holdingPolicy.wholeValue(args[2]);
              if(observer&&(args[1].unknown||!args[1].refs.size))hardEscape(args[2]);
              for(const ref of args[1].refs){
                spend();const object=objects.get(ref);check(object,'ssa');
                // Source authoring observes the logical property contribution
                // before a physical slot union has been inferred by M12.
                if(!a.fields(object.type).some(row=>row.id===field.id))fieldRouteGaps.add(object.type+'/'+p.owner+'/'+field.id);
                const slot=ref+'/field/'+field.id,selected=regions.select(args[1].region,ref);selected.opaque ||= args[1].unknown;
                receiver.write(state.frames,slot,args[2],!object.weak&&!args[1].unknown&&args[1].refs.size===1);
                put(slot,args[2],!object.weak&&args[1].refs.size===1);putRegion(selected,'field/'+field.id,args[2],args[1].refs.size===1&&!args[1].unknown,covered);observe('binding/'+field.sourceBinding,args[2]);
                if(bounded){invalidateCapacity=seed(fieldSeeds,field.sourceBinding,args[2])||invalidateCapacity;}
              }
              receiver.define(state.frames,args[0].cursors,args[1],field.id);receiver.reconcile(state.frames,state.heap,literal(undefinedId));
              value.cursors=receiver.advance(state.frames,args[0].cursors,p.field);
            }else if(name==='initialize_end'){
              receiver.end(state.frames,args[0].cursors);
            }else if(name==='env_alloc'){const created=site('environment',op.result),ref=created;value=literal('env:'+p.layout);value.refs.add(ref);allocation(created,'env:'+p.layout);value.region=version(ref,'env:'+p.layout);
              if(args.length){put(ref+'/parent',args[0]);putRegion(value.region,'parent',args[0]);}}
            else if(name==='env_parent'){for(const ref of args[0].refs){spend();a.merge(value,state.heap.get(ref+'/parent')??a.empty());}value.region=regions.load(args[0].region,'parent',state.regions);}
            else if(name==='env_load'){const selected=a.environmentSlot(args[0],p.layout,p.layout,p.key,state.heap,objects);
              check(selected.valid,'environment');check(selected.complete,'environment-initialization');value=selected.value;
              // Forward the same SSA address across an acyclic boolean guard
              // and empty bridges. Never narrow the shared weak heap.
              if(!bounded){
                spend();let pure=regions.layouts.get(fn)?.acyclic===true;
                for(let before=0;pure&&before<instruction;before++){spend();if(block.instructions[before].name!=='tsfg_program.fuel'){pure=false;break;}}
                let target=block.name;
                for(let hops=0;pure&&hops<blocks.size;hops++){
                  spend();const incoming=regions.layouts.get(fn)?.predecessors.get(target);if(incoming?.size!==1)break;
                  const previous=blocks.get(incoming.values().next().value),last=previous.instructions.at(-1);
                  if(!previous.parameters.length&&last?.name==='cf.br'&&!last.operands.length&&last.successors.length===1
                    &&last.successors[0]===target&&previous.instructions.every((before,i)=>{spend();return i===previous.instructions.length-1||before.name==='tsfg_program.fuel';})){
                    target=previous.name;continue;
                  }
                  const tail=previous.instructions.slice(-4);spend(tail.length);
                  if(tail.length===4){const [loaded,boolean,equal,branch]=tail,operator=equal.properties.operator,
                    saved=state.values.get(loaded.result),literal=state.values.get(boolean.result);
                    if(loaded.name==='tsfg_program.env_load'&&boolean.name==='tsfg_program.boolean'&&equal.name==='tsfg_program.strict_equal'
                      &&branch.name==='cf.cond_br'&&branch.operands[0]===equal.result&&branch.successors[0]!==branch.successors[1]
                      &&loaded.operands[0]===op.operands[0]&&loaded.properties.layout===p.layout&&loaded.properties.key===p.key
                      &&((equal.operands[0]===loaded.result&&equal.operands[1]===boolean.result)||(equal.operands[1]===loaded.result&&equal.operands[0]===boolean.result))
                      &&['===','!=='].includes(operator)&&literal?.tags.size===1&&literal.tags.has(boolTypeId)&&[1,2].includes(literal.truth)
                      &&saved&&!saved.unknown&&!saved.refs.size&&!saved.cells.size&&!saved.pairs.size
                      &&[...saved.tags].every(tag=>{spend();return types.get(tag)?.kind==='scalar';})){
                      value=a.copy(saved);const same=(operator==='===')===(branch.successors[0]===target),truth=(value.truth||3)&(same?literal.truth:3^literal.truth);
                      for(const tag of value.tags){spend();if(same&&tag!==boolTypeId||tag===boolTypeId&&!truth)value.tags.delete(tag);}
                      value.truth=value.tags.has(boolTypeId)?truth:0;if(same)value.number=null;if(!value.tags.size)continues=false;
                    }
                  }
                  break;
                }
              }
              value.region=regions.load(args[0].region,'slot/'+p.key,state.regions);}
            else if(name==='env_init'||name==='env_store'){for(const ref of args[0].refs){spend();const key=ref+'/slot/'+p.key;check(objects.get(ref)?.type==='env:'+p.layout,'environment');
              put(key,args[1],args[0].refs.size===1&&!objects.get(ref).weak);observe('binding/'+p.binding,args[1]);}putRegion(args[0].region,'slot/'+p.key,args[1]);}
            else if(name==='make_closure'){value=literal(op.view);const environments=p.environment_layout?args[0].refs:new Set([null]);if(p.environment_layout)value.region=regions.copy(args[0].region);
              for(const ref of environments){spend();if(ref){check(objects.get(ref)?.type==='env:'+p.environment_layout,'environment');for(const slot of model.environments.get(p.environment_layout).slots){spend();check(state.heap.has(ref+'/slot/'+slot.key),'environment-initialization');}value.refs.add(ref);}value.pairs.set(p.function_id+'\0'+(ref??''),{functionId:p.function_id,environment:ref});}}
            else if(name==='constant')value=literal(op.view,0,Number(p.decimal));
            else if(name==='floating')value=literal(op.view);
            else if(name==='host_call'){const host=model.hosts.get(p.host_id);
              check(host&&p.contract_hash===model.hir.hostContext.contract.digest&&p.signature_hash===host.signatureHash&&op.view===host.returnType&&args.length===host.parameterTypes.length,'host');
              for(const [i,arg]of args.entries()){spend(arg.tags.size+1);check(!arg.unknown&&!arg.refs.size&&!arg.cells.size&&!arg.pairs.size&&arg.tags.size===1&&arg.tags.has(host.parameterTypes[i]),'host-argument','Host argument lacks its actual native scalar tag',{functionId:fn,primary:{sourceId:plan.owner.sourcePath,...op.range}});}
              value=literal(op.view);
            }
            else if(name==='boolean')value=literal(boolTypeId,p.value?2:1);
            else if(name==='undefined'||name==='null'||name==='string')value=literal(op.view);
            else if(name==='cell'||name==='catch_bind') {
              // Source captures use environment slots; these private local
              // Cells keep ordinary assignment semantics and cannot escape.
              spend(Math.ceil((scope.length+op.result.length+6)/64)+3);const id=scope+'/cell/'+op.result;value.cells.add(id);state.heap.set(id,name==='catch_bind'?a.copy(args[0]):a.empty());
              if(name==='catch_bind')observe('binding/'+p.binding,args[0]);
            }else if(name==='load')value=mergeSlots(args[0].cells);
            else if(name==='store'){
              for(const cell of args[0].cells)put(cell,args[1]);observe('binding/'+p.binding,args[1]);
            }else if(name==='global_load')value=a.copy(state.heap.get('global:'+p.global)??a.empty());
            else if(name==='global_store') {
              put('global:'+p.global,args[0]);const raw=model.globals.get(p.global).sourceBinding;observe('binding/'+raw,args[0]);
              if(observer)hardEscape(args[0]);
              if(bounded){invalidateCapacity=seed(globalSeeds,raw,args[0])||invalidateCapacity;}
            }else if(['view','assert','pack','carrier_cast'].includes(name))value=a.copy(args[0]);
            else if(name==='value_copy') {
              const copyValue=(source,path,active=new Map())=>{
                spend(source.tags.size+source.cells.size+source.pairs.size+2);
                const result={...source,tags:new Set(source.tags),refs:new Set(),cells:new Set(source.cells),pairs:new Map(source.pairs),frames:new Set(source.frames),cursors:new Set(source.cursors),region:emptyRegionValue()};
                result.region.opaque=source.region.opaque||source.unknown;result.region.empty=source.region.empty;result.region.number=source.region.number;
                for(const ref of source.refs){spend();const object=objects.get(ref);check(object,'ssa');
                  const selected=regions.select(source.region,ref);
                  if(types.get(object.type)?.kind!=='value'){result.refs.add(ref);regions.merge(result.region,selected);continue;}
                  const prior=active.get(ref);if(prior){result.refs.add(prior.reference);regions.merge(result.region,prior.region);continue;}
                  const created=site('copy',op.result,path,object.type),copied=created;result.refs.add(copied);
                  // Alternatives of one physical copy keep their own field
                  // relations. The raw allocation identity/weakness is unchanged.
                  const current=version(copied,object.type,ref);regions.merge(result.region,current);
                  spend(active.size);const nested=new Map(active);nested.set(ref,{reference:copied,region:current});const weak=allocation(created,object.type,object.weak||source.refs.size>1);
                  for(const field of a.fields(object.type)){spend();const stored=state.heap.get(ref+'/field/'+field.id);if(stored){const input={...stored,region:regions.load(selected,'field/'+field.id,state.regions)};
                    const fieldValue=copyValue(input,path+'/'+field.id,nested);put(copied+'/field/'+field.id,fieldValue,!weak);putRegion(current,'field/'+field.id,fieldValue);}}
                }return result;
              };value=copyValue(args[0],'root');
            }else if(name==='construct_value'||name==='allocate_reference'||name==='array_create') {
              value=literal(op.view);const created=site('object',op.result),ref=created;value.refs.add(ref);allocation(created,op.view);value.region=version(ref,op.view);
              if(name==='array_create'){args.forEach((v,i)=>{const covered=Boolean(observer)&&holdingPolicy.wholeValue(v)&&commonActualArrayReceiver(value,types,objects,spend);
                  put(ref+'/element/'+i,v);putRegion(value.region,'element/'+i,v,true,covered);if(bounded){const key='element:'+op.view;invalidateCapacity=seed(elementSeeds,key,v)||invalidateCapacity;}});
                const length=literal(sha256('tsfg.type\0u32'),0,args.length);put(ref+'/length',length);putRegion(value.region,'length',length,true,false,regions.number(args.length));}
            }else if(name==='field_load'||name==='field_store') {
              const fieldRegion=emptyRegionValue(),covered=name==='field_store'&&Boolean(observer)&&holdingPolicy.wholeValue(args[1]);
              if(name==='field_store')recordStorageField(p.field,args[1],args[0]);
              if(observer&&name==='field_store'&&(args[0].unknown||!args[0].refs.size))hardEscape(args[1]);
              for(const ref of args[0].refs){spend();const object=objects.get(ref);check(object,'ssa');const field=fieldFor(object.type,plan.graph.registers.get(op.operands[0]).view,p.field),row=model.fields.get(field),slot=ref+'/field/'+field;
                const selected=regions.select(args[0].region,ref);selected.opaque ||= args[0].unknown;
                if(name==='field_load'){a.merge(value,state.heap.get(slot)??literal(undefinedId));regions.merge(fieldRegion,regions.load(selected,'field/'+field,state.regions));}else {receiver.write(state.frames,slot,args[1],!object.weak&&!args[0].unknown&&args[0].refs.size===1);put(slot,args[1],!object.weak&&args[0].refs.size===1);putRegion(selected,'field/'+field,args[1],args[0].refs.size===1&&!args[0].unknown,covered);observe('binding/'+row.sourceBinding,args[1]);
                  if(bounded){invalidateCapacity=seed(fieldSeeds,row.sourceBinding,args[1])||invalidateCapacity;}}}
              if(name==='field_load')value.region=fieldRegion;
              if(args[0].unknown)value.unknown=true;
            }else if(name==='array_length'||name==='readspan_length')value=literal(op.view);
            else if(name==='readspan') {
              // Distinct activations retain distinct descriptors. Recursive
              // summaries use the stable SCC activation to keep keys finite.
              value=literal(op.view);const created=site('span',op.result),ref=created;allocation(created,op.view);value.refs.add(ref);value.region=version(ref,op.view);put(ref+'/owner',args[0]);put(ref+'/start',args[1]);put(ref+'/length',args[2]);
              for(const [index,slot]of ['owner','start','length'].entries())putRegion(value.region,slot,args[index]);
            }else if(name==='array_read'||name==='array_store'||name==='array_resize') {
              const owners=a.empty();let spanOwner=false;for(const ref of args[0].refs){spend();const object=objects.get(ref);check(object,'ssa');
                if(types.get(object.type)?.kind==='readSpan'){spanOwner=true;a.merge(owners,state.heap.get(ref+'/owner')??a.empty());}else owners.refs.add(ref);}
              const ownerRegion=spanOwner?regions.load(args[0].region,'owner',state.regions):args[0].region;
              const needsArray=name==='array_read'&&types.get(op.view)?.kind==='function'||name==='array_store'&&Boolean(observer)&&args[2].pairs.size>0,
                actualArray=needsArray&&commonActualArrayReceiver(args[0],types,objects,spend),covered=name==='array_store'&&Boolean(observer)&&(storedArray||actualArray&&holdingPolicy.wholeValue(args[2]));
              if(observer&&name==='array_store'&&(args[0].unknown||!args[0].refs.size))hardEscape(args[2]);
              for(const ref of owners.refs){spend();const object=objects.get(ref),index=args[1]?.number,selected=regions.select(ownerRegion,ref);
                selected.opaque ||= args[0].unknown||owners.unknown;const definite=owners.refs.size===1&&!selected.opaque;
                if(name==='array_resize'){put(ref+'/length',args[1],!object.weak);putRegion(selected,'length',args[1],definite,false,regions.number(args[1].number));continue;}
                if(name==='array_store'){put(ref+'/element/'+(index===null?'*':index),args[2],!object.weak&&index!==null);putRegion(selected,'element/'+(index===null?'*':index),args[2],definite,covered);if(bounded){const key='element:'+object.type;invalidateCapacity=seed(elementSeeds,key,args[2])||invalidateCapacity;}continue;}
                for(const [slot,stored]of state.heap){spend();if(slot.startsWith(ref+'/element/'))a.merge(value,stored);}
                // Presence is a separate whole-family Source proof. It cannot
                // remove undefined already present in the actual stored value.
                const initialized=actualArray&&!spanOwner&&Number.isSafeInteger(index)&&index>=0&&types.get(op.view)?.kind==='function'&&model.callables.arrayElementInitialized(object.type,index);
                if(!initialized)value.tags.add(undefinedId);
              }
              if(name==='array_read')value.region=regions.elements(ownerRegion,args[1].number,state.regions);
              if(args[0].unknown)value.unknown=true;
            }else if(name==='strict_equal') {
              value=literal(boolTypeId,3);if(!args.some(v=>v.unknown)) {
                const sameAbsence=args.every(v=>v.tags.size===1)&&[...args[0].tags].every(tag=>args[1].tags.has(tag)&&['undefined','null'].includes(types.get(tag)?.kind));
                const disjoint=![...args[0].tags].some(tag=>args[1].tags.has(tag));if(sameAbsence||disjoint)value.truth=(sameAbsence===(p.operator==='==='))?2:1;
                else if(args.every(v=>v.tags.size===1&&v.tags.has(boolTypeId)&&[1,2].includes(v.truth)))value.truth=((args[0].truth===args[1].truth)===(p.operator==='==='))?2:1;
              }
            }else if(name==='binary'||name==='unary') {
              const views=op.operands.map(name=>plan.graph.registers.get(name).view),shape=name==='unary'?{kind:name,operator:p.operator,operand:{type:views[0]}}
                :{kind:name,operator:p.operator,left:{type:views[0]},right:{type:views[1]}};
              const approved=Boolean(finiteNumericUse(shape)),normal=args.every(v=>v.tags.size||v.unknown);let reaches=normal,trap=false;
              if(approved)for(const [index,v]of args.entries()){
                const admitted=!v.unknown&&[...v.tags].every(tag=>tag===i32TypeId||tag===undefinedId);
                check(bounded||admitted,'capability','unsupported actual numeric consumption',
                  {functionId:fn,primary:{sourceId:plan.owner.sourcePath,...op.range},operand:index,actualTypes:[...v.tags].sort()});
                reaches &&= v.tags.has(i32TypeId);trap ||= v.tags.has(undefinedId);
              }
              else {const admitted=args.every((v,i)=>!v.unknown&&[...v.tags].every(tag=>tag===views[i]));
                check(bounded||admitted,'capability','actual scalar tag differs from its consuming view');}
              if(bounded||reaches)value=literal(op.view,op.view===boolTypeId?3:0);
              const key=fn+'/'+op.result;if(!operations.has(key))operations.set(key,{normal:false,requestTrap:false,approved});const record=operations.get(key);record.normal ||= reaches;record.requestTrap ||= trap;
              if(!bounded&&!reaches)continues=false;
            }else if(name==='invoke'||name==='invoke_method'||name==='invoke_indirect') {
              const method=name==='invoke_method',indirect=name==='invoke_indirect',details={functionId:fn,primary:{sourceId:plan.owner.sourcePath,...op.range}};
              check(indirect||method||model.functions.get(p.function_id)?.kind!=='method','capability','method call requires explicit finite dispatch',details);
              if(method){check(!args[0].unknown,'capability','method receiver has no proved actual nominal type',details);
                for(const tag of args[0].tags){spend();check(p.dispatch.some(row=>{spend();return row.receiver_type===tag;}),'capability','actual receiver has no verified method target',{...details,actualType:tag});}}
              const complete=(target,value,heap,versionHeap,frameSnapshot,language=false)=>{
                const after=cloneWorld(state);receiver.overlay(after.frames,frameSnapshot);if(language)abandonInitializers(after);for(const [slot,v]of heap)update(after.heap,slot,v);
                receiver.reconcile(after.frames,after.heap,literal(undefinedId));
                // A completed call supplies an already joined exit snapshot.
                // Joining it again with the pre-call heap invents an opaque
                // predecessor for fields initialized by the callee.
                for(const [id,slots]of regions.heapCopy(versionHeap)){spend();after.regions.set(id,slots);}
                edge(target,after,blocks.get(target).parameters.length?[value]:[],true);
              };
              if(indirect)spend(args[0].pairs.size);const alternatives=indirect?[...args[0].pairs.values()].map(pair=>({target:pair.functionId,environment:pair.environment})):method?p.dispatch:[{target:p.function_id}];
              if(indirect){for(const tag of args[0].tags){spend();check(types.get(tag)?.kind==='function','capability','actual indirect operand is not callable',details);}
                check(!args[0].unknown||p.targets.top,'callable-contract','actual unknown callee exceeds finite upper',details);
                if(p.targets.top){storageGaps.add('opaque call: '+fn+'/'+block.name+'/'+instruction);const normalBlock=blocks.get(op.successors[0]),unknown=normalBlock.parameters.length?literal(normalBlock.parameters[0].type):a.empty();unknown.unknown=true;edge(op.successors[0],state,normalBlock.parameters.length?[unknown]:[]);const thrown=a.empty();thrown.unknown=true;const after=cloneWorld(state);abandonInitializers(after);edge(op.successors[1],after,[thrown],true);}
                for(const row of alternatives){spend();check(p.targets.top||p.targets.functions.some(bound=>{spend();return bound.function_id===row.target;}),'callable-contract');check(model.functions.get(row.target)?.signatureHash===p.signature_hash,'capability','actual indirect signature differs from the saved callable view',details);}}
              const selected=[];for(const row of alternatives){spend();if(!method||args[0].tags.has(row.receiver_type))selected.push(row);}
              if(observer){spend(selected.length);observer.prepareCall(point,c,op,args,state,selected.map(row=>{spend();return row.target;}));}
              for(const row of selected){
                spend();let passed=args;if(indirect){spend(args.length);passed=args.slice(1);}
                if(indirect&&model.functions.get(row.target).lexicalEnvironment){const env=a.literal('env:'+model.functions.get(row.target).lexicalEnvironment);check(row.environment,'environment');env.refs.add(row.environment);env.region=regions.select(args[0].region,row.environment);passed.unshift(env);}
                if(method){spend(args.length);passed=args.slice(0,byId.get(row.target).parameters.length);const receiver=a.copy(args[0]);receiver.tags.clear();receiver.tags.add(row.receiver_type);
                  for(const ref of receiver.refs){spend();if(objects.get(ref)?.type!==row.receiver_type)receiver.refs.delete(ref);}passed[0]=receiver;}
                const recursive=cyclicFunctions.has(row.target),activationSize=recursive?row.target.length+10:c.activationSize+fn.length+block.name.length+row.target.length+String(instruction).length+String(op.range.start).length+String(op.range.end).length+6;
                check(activationSize<=32768,'limit');spend(Math.ceil((c.activation.length+fn.length+block.name.length+row.target.length+64)/64));
                const activation=recursive?'recursive/'+row.target:'activation/'+sha256(canonical({parent:c.activation,caller:fn,block:block.name,instruction,range:op.range,target:row.target}));
                const repeated=c.repeated||cyclicBlocks.has(fn+'/'+block.name)||cyclicFunctions.has(row.target)||uncertainFunctions.has(row.target);
                spend(selected.length+(indirect?p.targets.functions.length:method?p.dispatch.length:1));
                const fixed=indirect?p.targets.functions.map(x=>x.function_id):method?p.dispatch.map(x=>x.target):[p.function_id],regionScope=callRegion(c,block.name,activation,row.target,passed,fixed,selected.map(x=>x.target));
                let entryVersions=state.regions;
                if(!regionScope){spend(passed.length);let carried=false;for(const input of passed)carried ||= input.region.roots.size>0;
                  if(carried||observer){spend(selected.length);const covered=holdingTransport(c,row.target,fixed,selected.map(x=>x.target));
                    if(observer&&!covered)for(const input of passed){spend();observer.hardEscape(input,state.heap);}
                    if(carried){passed=passed.map(a.copy);for(const input of passed){spend();if(input.region.roots.size){if(observer)regions.escape(input.region,state.regions,covered);input.region.opaque=true;}}entryVersions=new Map();}}}
                const call=context(row.target,passed,state.heap,false,activation,repeated,activationSize,regionScope,entryVersions,state.frames),key=fn+'/'+op.range.start+':'+op.range.end,targets=callTargets.get(key)??new Set();targets.add(row.target);callTargets.set(key,targets);
                spend();call.callers.add(c.id);
                spend(call.createdRegions.size);for(const id of call.createdRegions)c.createdRegions.add(id);
                observer?.call(point,call,c,op.successors);
                if(call.normal)complete(op.successors[0],call.returned,call.normalHeap,call.normalRegions,call.normalFrames);if(call.language)complete(op.successors[1],call.thrown,call.languageHeap,call.languageRegions,call.languageFrames,true);
              }continues=false;
            }else if(name==='cf.br'||name==='route'){edge(op.successors[0],state,args,false,true);continues=false;}
            else if(name==='cf.cond_br') {
              check(!args[0].unknown&&[...args[0].tags].every(tag=>tag===boolTypeId),'capability','condition has no proved boolean actual value');
              // The final selected edge owns this terminal state. Only a
              // coexisting branch needs a separate mutable snapshot.
              const truth=args[0].truth||3;if(truth&2)edge(op.successors[0],state,[],false,!(truth&1));if(truth&1)edge(op.successors[1],state,[],false,true);continues=false;
            }else if(name==='func.return'||name==='return_throw') {
              const normal=name==='func.return',field=normal?'returned':'thrown',heap=normal?'normalHeap':'languageHeap';if(!normal)abandonInitializers(state);
              if(!c[normal?'normal':'language']){c[normal?'normal':'language']=true;changed=true;}if(args.length)changed=a.merge(c[field],args[0])||changed;
              spend(c.args.length+(args.length?1:0));const frameRoots=[...c.args,...(args.length?[args[0]]:[])],selectedSnapshot=receiver.snapshot(state.frames,frameRoots,state.heap),retained=selectedSnapshot.retained;spend(frameRoots.length+retained.length);const returnRoots=[...frameRoots,...retained];
              changed=receiver.join(c[normal?'normalFrames':'languageFrames'],selectedSnapshot.frames)||changed;
              changed=a.joinHeap(c[heap],a.reachable(returnRoots,state.heap))||changed;continues=false;
              spend(returnRoots.length);const returnRegions=returnRoots.map(v=>v.region);
              changed=regions.heapJoin(c[normal?'normalRegions':'languageRegions'],regions.reachable(returnRegions,state.regions))||changed;
            }else if(name==='unreachable')continues=false;
            else check(['fuel','enter_handler','finally_enter'].includes(name),'ssa','unmodelled common logical operation '+name);
            if(op.result){state.values.set(op.result,value);observe(fn+'/'+op.result,value);}observer?.after(c,op,state,value,point);if(!continues)break;
          }
        }
    }
    // A changed callee invalidates its actual callers. Only capacity seeds
    // and monotone physical weakness are shared across declarations and
    // therefore invalidate every context when either grows.
    for(let index=0;index<pending.length;index++){
      spend();const c=contexts.get(pending[index]);queued.delete(c.id);changed=false;invalidateCapacity=false;invalidateWeak=false;execute(c);
      if(invalidateCapacity||invalidateWeak){spend(contexts.size);for(const id of contexts.keys())schedule(id);}
      else if(changed){spend(c.callers.size);for(const id of c.callers)schedule(id);}
    }
    changed=false;invalidateWeak=false;
    let borrows=null;
    if(!bounded&&records){const observationContexts=commonPublicObservationContexts(contexts,spend),observer=commonBorrowObservations({model,records,objects,regions,holdingPolicy,internalFunctions,borrowProof:options.borrowProof,cyclicFunctions,readEnvironmentSlot:(selected,start,target,key,heap)=>a.environmentSlot(selected,start,target,key,heap,objects)});
      for(const c of contexts.values())if(observationContexts.has(c.id))execute(c,observer);check(!changed&&!invalidateWeak,'ssa','final actual observation changed the fixed point');borrows=observer.finish();}
    spend(missingConstructionPairs.length+fieldRouteGaps.size+plans.length);
    for(const pair of missingConstructionPairs)storageGaps.add('implicit constructor pair is not analyzed: '+pair.constructionId+'/'+pair.newTarget);
    for(const route of fieldRouteGaps)storageGaps.add('logical property route is not closed: '+route);
    const reachedFunctions=new Set();spend(contexts.size);for(const context of contexts.values())reachedFunctions.add(context.plan.owner.id);
    for(const plan of plans)if(plan.owner.lexicalParent&&!reachedFunctions.has(plan.owner.id))storageGaps.add('owned lexical function has no analyzed entry: '+plan.owner.id);
    const results=new Map();spend(constructionRoots.size);for(const [key,context]of constructionRoots){spend(context.returned.tags.size);results.set(key,{actualTypes:new Set(context.returned.tags),unknown:context.returned.unknown});}
    spend(storageGaps.size);const storageObservations={fields:storageFields,results,coverage:{complete:storageGaps.size===0,issues:[...storageGaps]}};
    return {contexts,observed,objects,operations,callTargets,borrows,regions,storageObservations};
  }
  const capacity=solve(true),actual=solve(false);
  return {capacity,actual,fieldSeeds,globalSeeds,elementSeeds,abstract:a};
}
