// SPDX-License-Identifier: MIT
// A final replay of the actual solver supplies selected values at each point.
// Only compact identities/events leave that replay; point heaps are not kept.
import {commonBorrowGraph} from './common-program-borrows.mjs';
import {commonCheck as check} from './common-program-common.mjs';
export function commonBorrowObservations({model,records,objects,readEnvironmentSlot=null}) {
  const {spend,types}=model,graph=commonBorrowGraph(spend),returns=new Map(),calls=[],callReturns=new Map(),contexts=new Set(),components=new Map(),allocations=new Map(),creations=new Map();
  const slotLayouts=new Map();spend(model.environments?.size??0);
  for(const env of model.environments?.values()??[]){spend(env.slots.length);for(const slot of env.slots){check(!slotLayouts.has(slot.key)||slotLayouts.get(slot.key)===env.id,'environment');slotLayouts.set(slot.key,env.id);}}
  const entry=c=>c.id+'/entry',block=(c,name)=>c.id+'/block/'+name;
  const origin=(c,op)=>({functionId:c.plan.owner.id,primary:{sourceId:c.plan.owner.sourcePath,...op.range}});
  const kind=ref=>types.get(objects.get(ref)?.type)?.kind;
  const environment=ref=>{const tag=objects.get(ref)?.type;return typeof tag==='string'&&tag.startsWith('env:')?model.environments.get(tag.slice(4)):undefined;};
  const environmentSlot=(ref,slot)=>objects.get(ref)?.type.startsWith('env:')&&(slot.startsWith(ref+'/slot/')||slot===ref+'/parent');
  function collect(value,heap,mode) {
    const ids=new Set(),seen=new Set(),pending=[value];let unknown=false;
    for(let i=0;i<pending.length;i++){
      spend();const v=pending[i];unknown ||= v.unknown;
      for(const ref of v.refs){spend();if(seen.has(ref))continue;seen.add(ref);const type=kind(ref);
        if(type==='readSpan'){
          if(mode==='spans'||mode==='escape')ids.add(ref);
          if(mode==='structural'){const owner=heap.get(ref+'/owner');if(owner)pending.push(owner);else unknown=true;}
          continue;
        }
        if(type==='array'&&(mode==='structural'||mode==='owning'))ids.add(ref);
        for(const [slot,stored]of heap){spend();if(slot.startsWith(ref+'/field/')||slot.startsWith(ref+'/element/')||mode==='escape'&&environmentSlot(ref,slot))pending.push(stored);}
      }
    }
    check(ids.size<=4096,'limit');return {ids,pending:unknown};
  }
  // Environment storage is transport, not consumption. Only escape checks walk
  // the actual closure's selected slots/parent; never-called captures stay dead.
  const escapingSpans=(value,heap)=>collect(value,heap,'escape').ids;
  function owners(ref,heap){spend();const owner=heap.get(ref+'/owner'),ids=new Set();let pending=!owner||owner.unknown;
    for(const id of owner?.refs??[]){spend();if(kind(id)==='array')ids.add(id);else pending=true;}return {ids,pending:pending||ids.size===0};}
  function define(at,ref,heap,weak=false){graph.define(at,ref,owners(ref,heap),weak);}
  function use(at,value,heap,view=undefined,where={}){
    const selected=collect(value,heap,'spans');
    if(types.get(view)?.kind==='readSpan'){
      let actual=!selected.pending&&selected.ids.size>0;for(const id of value.tags){spend();actual &&= types.get(id)?.kind==='readSpan';}
      check(actual,'borrow-pending','ReadSpan use has no proved actual descriptor',where);
    }graph.use(at,selected.ids);
  }
  function effect(at,value,heap,where,eligible=null){const actual=collect(value,heap,'structural');if(actual.ids.size||actual.pending)graph.effect(at,actual,where,eligible);}
  function remember(map,ref,c,details){
    spend();let rows=map.get(ref);if(!rows){rows=new Map();map.set(ref,rows);}const before=rows.get(c.id);
    if(before){before.weak ||= details.weak;if(details.owner){before.owner.pending ||= details.owner.pending;for(const id of details.owner.ids){spend();before.owner.ids.add(id);}}}
    else rows.set(c.id,details);
  }
  function connectContexts(){
    const edges=new Map();for(const id of contexts){spend();edges.set(id,new Set());}
    for(const row of calls){spend();edges.get(row.caller).add(row.callee);edges.get(row.callee).add(row.caller);}
    for(const id of contexts){spend();if(components.has(id))continue;const queue=[id];components.set(id,id);
      for(let i=0;i<queue.length;i++){spend();for(const next of edges.get(queue[i])){spend();if(!components.has(next)){components.set(next,id);queue.push(next);}}}}
  }
  function unique(map,ref,context){
    let selected=null;
    for(const [id,row]of map.get(ref)??[]){spend();if(components.get(id)!==components.get(context))continue;if(selected||row.weak)return null;selected=row;}
    return selected;
  }
  function owningStorage(value,heap){
    // Keep compact selected storage edges, not a return-point heap. Allocation
    // uniqueness is checked after every actual context has supplied its origin.
    spend(value.refs.size);const pending=[...value.refs],nodes=new Map(),cached=new Map();
    function group(stored){
      spend();if(!stored||stored.unknown)return null;
      for(const tag of stored.tags){spend();if(!['reference','value','array','readSpan'].includes(types.get(tag)?.kind)
          &&!(tag.startsWith('env:')&&model.environments.has(tag.slice(4))))return null;}
      check(pending.length+stored.refs.size<=65536,'limit');spend(stored.refs.size);
      const refs=[...stored.refs];pending.push(...refs);return refs;
    }
    for(let i=0;i<pending.length;i++){
      spend();const ref=pending[i];if(nodes.has(ref))continue;
      const type=kind(ref),layout=environment(ref),weak=objects.get(ref)?.weak,node={type,layout:layout?.id,groups:[]};nodes.set(ref,node);
      if(weak)continue;
      if(layout){
        for(const slot of layout.slots){spend();node.groups.push(group(heap.get(ref+'/slot/'+slot.key)));}
        if(layout.parent){spend();node.groups.push(group(heap.get(ref+'/parent')));}
      }else if(['reference','value','array'].includes(type)){
        const length=heap.get(ref+'/length')?.number,elements=Number.isSafeInteger(length)&&length>=0&&!heap.has(ref+'/element/*');
        for(const [slot,stored]of heap){spend();let selected=slot.startsWith(ref+'/field/');
          if(type==='array'){const index=slot.startsWith(ref+'/element/')?slot.slice((ref+'/element/').length):'';
            selected=elements&&/^(0|[1-9]\d*)$/.test(index)&&Number(index)<length;}
          if(selected)node.groups.push(group(stored));}
      }
      // ReadSpan.owner is deliberately absent from this owning graph.
    }
    return (root,context)=>{
      if(!cached.has(context)){
        const owned=new Map();for(const ref of nodes.keys()){spend();owned.set(ref,new Set());}
        let changed;do{changed=false;for(const [ref,node]of nodes){
          spend();const next=new Set(),allowed=!node.layout||unique(allocations,ref,context)?.kind==='environment';
          if(node.type==='array'){spend();next.add(ref);}
          if(allowed)for(const refs of node.groups){
            spend();if(!refs?.length)continue;let common=null;
            for(const child of refs){spend();const childOwned=owned.get(child)??new Set();
              if(common===null){spend(childOwned.size);common=new Set(childOwned);}
              else for(const id of common){spend();if(!childOwned.has(id))common.delete(id);}}
            for(const id of common){spend();next.add(id);}
          }
          const prior=owned.get(ref);spend(prior.size+next.size);
          if(prior.size!==next.size||[...prior].some(id=>{spend();return !next.has(id);})){owned.set(ref,next);changed=true;}
        }}while(changed);cached.set(context,owned);
      }
      return cached.get(context).get(root)??new Set();
    };
  }
  // Capture only paths from this returned value to its selected Span slots.
  // Each alternative keeps its own owning arrays; another return alternative
  // cannot make a direct Span root retain its backing allocation.
  function returnPaths(value,heap){
    const paths=[],work=[],ownership=owningStorage(value,heap);
    for(const root of value.refs){spend(2);
      work.push({ref:root,storage:[],active:new Set(),known:!value.unknown,owningKnown:!value.unknown,owning:context=>ownership(root,context)});}
    for(let i=0;i<work.length;i++){
      spend();const item=work[i],ref=item.ref;if(item.active.has(ref))continue;
      if(kind(ref)==='readSpan'){check(paths.length<4096,'limit');paths.push({...item,span:ref});continue;}
      check(item.storage.length<128,'limit');spend(item.active.size+item.storage.length+1);
      const active=new Set(item.active),storage=[...item.storage,ref];active.add(ref);
      const known=item.known&&['reference','value','array'].includes(kind(ref));
      const owningKnown=item.owningKnown&&(['reference','value','array'].includes(kind(ref))||Boolean(environment(ref)));
      for(const [slot,stored]of heap){spend();if(!slot.startsWith(ref+'/field/')&&!slot.startsWith(ref+'/element/')&&!environmentSlot(ref,slot))continue;
        for(const child of stored.refs){spend();check(work.length<65536,'limit');work.push({ref:child,storage,active,known:known&&!stored.unknown,owningKnown:owningKnown&&!stored.unknown,owning:item.owning});}}
    }return paths;
  }
  function retained(path,owner,context){
    if(!path.known)return false;let managed=false;
    for(const ref of path.storage){spend();const storage=unique(allocations,ref,context);if(!storage)return false;managed ||= ['reference','array'].includes(storage.kind);}
    if(!managed)return false;
    const span=unique(creations,path.span,context),array=unique(allocations,owner,context);
    // The original readspan and original same-element Array creation must
    // independently close the GC retention edge, in a unique actual frame.
    return Boolean(span&&array&&array.kind==='array'&&span.element===array.element&&!span.owner.pending&&span.owner.ids.size===1&&span.owner.ids.has(owner));
  }
  function captureEffect(at,target,slot,args,heap,indirect,where,eligible){
    spend();const start=model.functions?.get(target)?.lexicalEnvironment,owner=slotLayouts.get(slot);
    if(!start||!owner||!readEnvironmentSlot){graph.effect(at,{ids:new Set(),pending:true},where,eligible);return;}
    let selected=args[0];
    if(indirect){
      const operand=args[0];spend((operand?.pairs?.size??0)+1);selected={refs:new Set(),tags:new Set(['env:'+start]),unknown:!operand||operand.unknown};let found=false;
      for(const pair of operand?.pairs?.values()??[]){spend();if(pair.functionId!==target)continue;found=true;if(pair.environment)selected.refs.add(pair.environment);else selected.unknown=true;}
      if(!found)selected.unknown=true;
    }
    if(!selected){graph.effect(at,{ids:new Set(),pending:true},where,eligible);return;}
    const result=readEnvironmentSlot(selected,start,owner,slot,heap);if(!result.complete)result.value.unknown=true;
    effect(at,result.value,heap,where,eligible);
  }
  function callEffects(at,c,op,args,state,eligible=null) {
    const name=op.name,p=op.properties,where=origin(c,op),indirect=name.endsWith('invoke_indirect');let targets;
    if(indirect){spend(p.targets.functions.length);targets=p.targets.functions.map(row=>row.function_id);}
    else if(name.endsWith('invoke_method')){spend(p.dispatch.length);targets=p.dispatch.map(row=>row.target);}
    else targets=[p.function_id];
    // This is the whole fixed table, independently of actual arm filtering.
    if(indirect&&p.targets.top)graph.effect(at,{ids:new Set(),pending:true},where,eligible);
    for(const id of targets){spend();const row=records.get(id);check(row,'publication');const upper=row.upper;
      const offset=indirect||name.endsWith('.invoke')&&model.functions.get(id)?.lexicalEnvironment?1:0;
      for(const parameter of upper.parameters){spend();if(parameter.structural){const value=args[parameter.index+offset];if(value)effect(at,value,state.heap,where,eligible);else graph.effect(at,{ids:new Set(),pending:true},where,eligible);}}
      for(const id of upper.globals.writes){spend();const value=state.heap.get('global:'+id);if(value)effect(at,value,state.heap,where,eligible);}
      if(upper.facets.unknownHost){graph.effect(at,{ids:new Set(),pending:true},where,eligible);
        for(const value of args)graph.escape(at,escapingSpans(value,state.heap),false,where);}
      for(const capture of upper.captures){spend();if(capture.structural)captureEffect(at,id,capture.slot,args,state.heap,indirect,where,eligible);}
    }
  }
  function prepareCall(at,c,op,args,state,connected) {
    const p=op.properties,indirect=op.name.endsWith('invoke_indirect'),method=op.name.endsWith('invoke_method');
    spend(connected.length);const actual=new Set(connected);
    if(indirect)spend(p.targets.functions.length);else if(method)spend(p.dispatch.length);
    const targets=indirect?p.targets.functions.map(row=>{spend();return row.function_id;}):method?p.dispatch.map(row=>{spend();return row.target;}):[p.function_id];
    let complete=!(indirect&&p.targets.top)&&actual.size>0;
    for(const id of targets){spend();complete &&= actual.has(id)&&records.has(id)&&!records.get(id).upper.facets.unknownHost;}
    if(!complete){for(const [index,value]of args.entries())use(at,value,state.heap,c.plan.graph.registers.get(op.operands[index]).view,origin(c,op));callEffects(at,c,op,args,state);return;}
    // Every permitted target is connected to the actual graph. Its internal
    // reads/effects establish order; the full fixed upper still protects every
    // pre-call descriptor live after either completion. Fresh returned Spans
    // must not be mistaken for descriptors that existed before the mutation.
    const eligible=new Set(),take=ref=>{spend();if(kind(ref)==='readSpan'){eligible.add(ref);check(eligible.size<=4096,'limit');}};
    for(const value of state.values.values()){spend();for(const ref of value.refs)take(ref);}
    for(const [slot,value]of state.heap){spend();for(const ref of value.refs)take(ref);if(slot.endsWith('/owner'))take(slot.slice(0,-6));}
    const routes={};for(const completion of ['normal','language']){spend();const barrier=at+'/fixed-return/'+completion;routes[completion]=barrier;
      graph.point(barrier);callEffects(barrier,c,op,args,state,eligible);}
    callReturns.set(at,routes);
  }
  function begin(c,heap) {
    spend();contexts.add(c.id);
    graph.point(entry(c));graph.edge(entry(c),block(c,c.plan.entry.name));
    if(c.root)for(const value of c.args)for(const ref of escapingSpans(value,heap)){spend();define(entry(c),ref,heap);}
  }
  function before(c,op,state,args,at) {
    const name=op.name.replace('tsfg_program.',''),where=origin(c,op);graph.point(at).origin=where;
    if(name==='array_read'||name==='readspan_length')use(at,args[0],state.heap,c.plan.graph.registers.get(op.operands[0]).view,where);
    if(name==='array_resize'){
      let unchanged=!args[0].unknown&&args[0].refs.size>0&&Number.isSafeInteger(args[1].number);
      for(const ref of args[0].refs){spend();unchanged &&= state.heap.get(ref+'/length')?.number===args[1].number;}
      if(!unchanged)effect(at,args[0],state.heap,where);
    }
    if(name==='array_store'){
      // Proved in-range overwrites preserve structure. No bound implies an
      // element origin, and unknown length/index never acquires that proof.
      let overwrite=!args[0].unknown&&args[0].refs.size>0;const index=args[1].number;
      for(const ref of args[0].refs){spend();const length=state.heap.get(ref+'/length')?.number;
        overwrite &&= kind(ref)==='array'&&Number.isSafeInteger(index)&&index>=0&&Number.isSafeInteger(length)&&index<length;}
      if(!overwrite)effect(at,args[0],state.heap,where);
    }
    if(['global_store','env_init','env_store','field_store','array_store'].includes(name)){
      const value=args[name==='global_store'?0:name==='array_store'?2:1],ids=escapingSpans(value,state.heap);
      if(ids.size){const local=new Set(),target=args[0];
        if(name==='field_store'&&c.root&&c.plan.owner.kind==='construction-body')for(const ref of c.args[0].refs){spend();local.add(ref);}
        let allowed;
        if(['field_store','array_store','env_init','env_store'].includes(name)){
          spend(target.refs.size);const targets=new Set(target.refs),known=!target.unknown&&targets.size>0;
          allowed=()=>{let result=known;for(const ref of targets){spend();result &&= graph.fresh.has(ref)||local.has(ref);}return result;};
        }else allowed=false;
        graph.escape(at,ids,allowed,where);
      }
    }
    if(name==='func.return'||name==='return_throw'){
      const row=returns.get(c.id)??{normal:new Set(),language:new Set()};row[name==='func.return'?'normal':'language'].add(at);returns.set(c.id,row);
      if(args.length){const value=args[0],ids=escapingSpans(value,state.heap);use(at,value,state.heap,c.plan.graph.registers.get(op.operands[0]).view,where);
        // Transferring a closure consumes its captured descriptors even when
        // the reader was never called. Owner survival proves lifetime only.
        graph.use(at,ids);
        // The verified construction receiver survives its normal return;
        // an exceptional payload has no such receiver guarantee.
        if(ids.size&&!(name==='func.return'&&c.plan.owner.kind==='construction-body')){
          const surviving=new Set(),paths=returnPaths(value,state.heap),held=new Map();
          for(const input of c.args){for(const id of collect(input,c.entryHeap,'owning').ids){spend();surviving.add(id);}
            for(const ref of escapingSpans(input,c.entryHeap))for(const id of owners(ref,c.entryHeap).ids){spend();surviving.add(id);}}
          for(const ref of ids){spend();held.set(ref,owners(ref,state.heap));}
          const allowed=()=>{
            let valid=true;for(const path of paths){spend();const owner=held.get(path.span);valid &&= !owner.pending&&owner.ids.size>0;
              for(const id of owner.ids){spend();valid &&= surviving.has(id)||path.owningKnown&&path.owning(c.id).has(id)&&Boolean(unique(allocations,id,c.id))||retained(path,id,c.id);}}
            return valid&&paths.length>0;
          };
          graph.escape(at,ids,allowed,where);
        }
      }
    }
  }
  function after(c,op,state,value,at){
    const name=op.name.replace('tsfg_program.','');
    if(name==='env_alloc')for(const ref of value.refs){spend();graph.fresh.add(ref);remember(allocations,ref,c,{kind:'environment',weak:objects.get(ref).weak});}
    if(['array_create','allocate_reference','construct_value','value_copy'].includes(name))for(const ref of value.refs){spend();if(name==='value_copy'&&kind(ref)!=='value')continue;
      graph.fresh.add(ref);remember(allocations,ref,c,{kind:kind(ref),element:types.get(objects.get(ref).type)?.elementType,weak:objects.get(ref).weak});}
    if(name==='readspan')for(const ref of value.refs){spend();define(at,ref,state.heap,objects.get(ref)?.weak);
      remember(creations,ref,c,{element:types.get(op.view).elementType,weak:objects.get(ref).weak,owner:owners(ref,state.heap)});}
  }
  function call(at,callee,caller,successors){spend();graph.edge(at,entry(callee));const routes=callReturns.get(at);
    calls.push({caller:caller.id,callee:callee.id,normal:routes?.normal??block(caller,successors[0]),language:routes?.language??block(caller,successors[1]),
      normalSuccessor:routes?block(caller,successors[0]):null,languageSuccessor:routes?block(caller,successors[1]):null});}
  function finish(){
    connectContexts();
    for(const row of calls){spend();const exits=returns.get(row.callee);if(exits)for(const completion of ['normal','language'])for(const at of exits[completion]){
      graph.edge(at,row[completion]);if(row[completion+'Successor'])graph.edge(row[completion],row[completion+'Successor']);}}
    return graph.verify();
  }
  return {begin,block,entry,before,after,prepareCall,call,edge:graph.edge,finish};
}
