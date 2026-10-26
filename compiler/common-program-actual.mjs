// SPDX-License-Identifier: MIT
// Calls are instantiated by actual arguments and reachable memory. Conditional
// definition/field capacities never become a particular call's actual arguments.
import {i32TypeId,boolTypeId,sha256,canonical} from './identity.mjs';
import {finiteNumericUse} from './finite-numeric-use.mjs';
import {classifyArrayCallGraph} from './array-call-graph.mjs';
import {commonAbstract} from './common-program-abstract.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonEntryReferences} from './common-program-entry.mjs';
import {commonMethods} from './common-program-methods.mjs';
import {commonBorrowObservations} from './common-program-borrow-observations.mjs';
const undefinedId=sha256('tsfg.type\0undefined');
export function analyzeCommonGraphs({model,plans},records=null) {
  const {spend,types}=model,elementSeeds=new Map(),a=commonAbstract({...model,elementSeeds}),byId=new Map(plans.map(plan=>[plan.owner.id,plan])),entryReferences=commonEntryReferences(model.hir,spend),methods=commonMethods(model.hir,spend);
  const edges=[],callSites=[],incoming=new Map(),cyclicBlocks=new Set();
  for(const plan of plans) {
    const blockEdges=[];
    for(const block of plan.graph.blocks)for(const op of block.instructions){spend();for(const target of op.successors)blockEdges.push({caller:block.name,target});
      if(['tsfg_program.invoke','tsfg_program.invoke_method','tsfg_program.invoke_indirect'].includes(op.name)){
        if(op.name==='tsfg_program.invoke_indirect')spend(op.properties.targets.functions.length);
        const rows=op.name==='tsfg_program.invoke_indirect'?op.properties.targets.functions.map(row=>({target:row.function_id})):op.name==='tsfg_program.invoke_method'?methods.verify(op.properties,plan.graph.registers.get(op.operands[0]).view):[{target:op.properties.function_id}],targets=new Set();
        for(const {target}of rows){spend();if(targets.has(target))continue;targets.add(target);edges.push({caller:plan.owner.id,target});callSites.push({caller:plan.owner.id,target,block:block.name});incoming.set(target,(incoming.get(target)??0)+1);}}}
    spend(plan.graph.blocks.length+blockEdges.length);
    for(const c of classifyArrayCallGraph(plan.graph.blocks.map(block=>block.name),blockEdges).components)if(c.cyclic)
      for(const name of c.members)cyclicBlocks.add(plan.owner.id+'/'+name);
  }
  const cyclicFunctions=new Set();spend(plans.length+edges.length);
  for(const c of classifyArrayCallGraph(plans.map(plan=>plan.owner.id),edges).components)if(c.cyclic)for(const id of c.members)cyclicFunctions.add(id);
  for(const root of model.hir.closure.roots)if(root.kind!=='module-initialization')incoming.set(root.target,(incoming.get(root.target)??0)+1);
  // One static allocation site can represent several live objects when any
  // caller repeats. Multiplicity propagates through wrappers, loops and SCCs.
  const repeated=new Set(cyclicFunctions);
  for(const [id,count]of incoming)if(count>1)repeated.add(id);
  for(const site of callSites)if(cyclicBlocks.has(site.caller+'/'+site.block))repeated.add(site.target);
  let propagated;do{propagated=false;for(const edge of edges){spend();if(repeated.has(edge.caller)&&!repeated.has(edge.target)){repeated.add(edge.target);propagated=true;}}}while(propagated);
  const fieldSeeds=new Map(),globalSeeds=new Map();
  const tagsOnly=value=>({...a.empty(),tags:new Set(value.tags),unknown:value.unknown,truth:value.truth});
  const seed=(map,id,value)=>{if(!map.has(id))map.set(id,tagsOnly(value));else a.merge(map.get(id),tagsOnly(value));};
  const literal=(type,truth=0,number=null)=>a.literal(type,truth,number);
  const read=(state,name)=>state.values.get(name)??a.empty();
  const fieldBySource=new Map([...model.fields.values()].map(field=>[field.sourceBinding,field]));
  const fieldAliases=new Map(),rawTypes=new Map(model.hir.types.map(type=>[type.sourceType,type.id]));
  for(const row of model.hir.snapshot.payload.compatibilityWitnesses) {
    const proof=row.compatibility,key=rawTypes.get(proof.sourceType)+'/'+rawTypes.get(proof.targetType),map=fieldAliases.get(key)??new Map();
    for(const pair of proof.members){spend();const from=fieldBySource.get(pair.source),to=fieldBySource.get(pair.target);if(from&&to)map.set(to.id,from.id);}fieldAliases.set(key,map);
  }
  const fieldFor=(actual,view,field)=>{
    if(a.fields(actual).some(row=>row.id===field))return field;
    const mapped=fieldAliases.get(actual+'/'+view)?.get(field);check(mapped,'capability','actual field has no original verified member mapping');return mapped;
  };
  const dummyHeap=new Map(),dummyObjects=new Map();
  for(const [id,binding]of model.bindings)if(binding.role==='field')seed(fieldSeeds,id,a.declared(binding.type,dummyHeap,'conditional',new Map(),dummyObjects));
  for(const type of types.values())if(type.kind==='array')seed(elementSeeds,'element:'+type.id,a.declared(type.elementType,dummyHeap,'conditional',fieldSeeds,dummyObjects));
  for(const global of model.hir.globals)seed(globalSeeds,global.sourceBinding,a.declared(global.type,dummyHeap,'conditional',fieldSeeds,dummyObjects));
  function solve(bounded) {
    const contexts=new Map(),observed=new Map(),objects=new Map(),operations=new Map(),callTargets=new Map();let changed=false;
    const entryValue=(plan,parameter,heap)=>{
      const authority=entryReferences(plan.owner.id,parameter.id),entry=authority?{...authority,observe(kind,id,value){
        if(!bounded)return;const seeds=kind==='field'?fieldSeeds:elementSeeds,before=a.key(seeds.get(id)??a.empty());
        seed(seeds,id,value);changed ||= before!==a.key(seeds.get(id));
      }}:undefined;
      if(parameter.hidden)return environmentEntry(parameter.type.slice(4),heap,'entry/'+plan.owner.id);
      if(types.get(parameter.type)?.kind==='function'){const result=a.literal(parameter.type),index=plan.owner.parameters.findIndex(p=>p.id===parameter.id),upper=model.callables.summaries.get(plan.owner.id).parameters.get(index);result.unknown=upper.top;
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
    function context(target,args,heap=new Map(),root=false,activation='entry/'+target) {
      const plan=byId.get(target);check(plan&&args.length===plan.parameters.length,'ssa');
      const entryHeap=a.reachable(args,heap);spend(entryHeap.size+args.length);const memory=[...entryHeap].sort(([a],[b])=>{spend();return a<b?-1:a>b?1:0;}).map(([id,v])=>[id,a.key(v)]);
      const key=target+'/'+sha256(canonical({args:args.map(a.key),memory,activation}));
      if(!contexts.has(key)){spend();check(contexts.size<4096,'limit');contexts.set(key,{id:key,activation,plan,args:args.map(a.copy),entryHeap,root,
        returned:a.empty(),thrown:a.empty(),normal:false,language:false,normalHeap:new Map(),languageHeap:new Map()});changed=true;}
      return contexts.get(key);
    }
    for(const plan of plans) {
      if(plan.owner.lexicalParent)continue;
      const heap=new Map();currentGlobals(heap);const args=plan.parameters.map(parameter=>entryValue(plan,parameter,heap));
      context(plan.owner.id,args,heap,true);
    }
    function execute(c,observer=null) {
        spend();const plan=c.plan,fn=plan.owner.id,entry=a.state();entry.heap=a.snapshot(c.entryHeap);
        if(c.root){entry.heap=new Map();currentGlobals(entry.heap);
          c.args=plan.parameters.map(parameter=>entryValue(plan,parameter,entry.heap));c.entryHeap=a.snapshot(entry.heap);}
        for(const [index,p]of plan.entry.parameters.entries())entry.values.set(p.name,a.copy(c.args[index]));
        observer?.begin(c,entry.heap);let point=null;
        const blocks=new Map(plan.graph.blocks.map(block=>[block.name,block])),states=new Map([[plan.entry.name,entry]]),queue=[plan.entry.name],queued=new Set(queue);
        const edge=(name,from,args=[],callReturn=false)=>{
          if(observer&&!callReturn)observer.edge(point,observer.block(c,name));
          spend(args.length+1);const block=blocks.get(name);check(block&&block.parameters.length===args.length,'ssa');const next=a.clone(from);
          for(const [i,p]of block.parameters.entries())next.values.set(p.name,a.copy(args[i]));
          if(!states.has(name)){states.set(name,next);if(!queued.has(name)){queue.push(name);queued.add(name);}}
          else if(a.join(states.get(name),next)&&!queued.has(name)){queue.push(name);queued.add(name);}
        };
        for(let index=0;index<queue.length;index++) {
          spend();const block=blocks.get(queue[index]),state=a.clone(states.get(block.name));queued.delete(block.name);
          let previous=observer?.block(c,block.name);
          for(const p of block.parameters)observe(fn+'/'+p.name,read(state,p.name));
          for(const [instruction,op]of block.instructions.entries()) {
            spend(op.operands.length+1);const args=op.operands.map(name=>read(state,name)),p=op.properties,name=op.name.replace('tsfg_program.','');let value=a.empty(),continues=true;
            if(observer){point=c.id+'/'+block.name+'/'+instruction;observer.edge(previous,point);observer.before(c,op,state,args,point);previous=point;}
            const weakSlot=key=>{
              for(const marker of ['/field/','/element/','/length','/owner','/start','/slot/','/parent']){spend();const at=key.lastIndexOf(marker);if(at>=0&&objects.has(key.slice(0,at)))return objects.get(key.slice(0,at)).weak;}
              return false;
            };
            const update=(heap,key,value,strong=!weakSlot(key))=>{if(strong||!heap.has(key))heap.set(key,a.copy(value));else a.merge(heap.get(key),value);};
            const put=(key,value,strong=undefined)=>update(state.heap,key,value,strong);
            const mergeSlots=keys=>{const result=a.empty();for(const key of keys){spend();a.merge(result,state.heap.get(key)??a.empty());}return result;};
            if(name==='env_alloc'){const ref=c.activation+'/environment/'+op.result;value=literal('env:'+p.layout);value.refs.add(ref);objects.set(ref,{type:'env:'+p.layout,weak:repeated.has(fn)||cyclicBlocks.has(fn+'/'+block.name)});if(args.length)put(ref+'/parent',args[0]);}
            else if(name==='env_parent'){for(const ref of args[0].refs){spend();a.merge(value,state.heap.get(ref+'/parent')??a.empty());}}
            else if(name==='env_load'||name==='env_init'||name==='env_store'){for(const ref of args[0].refs){spend();const key=ref+'/slot/'+p.key;check(objects.get(ref)?.type==='env:'+p.layout,'environment');
              if(name==='env_load'){check(state.heap.has(key),'environment-initialization');a.merge(value,state.heap.get(key));}else {put(key,args[1],args[0].refs.size===1&&!objects.get(ref).weak);observe('binding/'+p.binding,args[1]);}}}
            else if(name==='make_closure'){value=literal(op.view);const environments=p.environment_layout?args[0].refs:new Set([null]);for(const ref of environments){spend();if(ref){check(objects.get(ref)?.type==='env:'+p.environment_layout,'environment');for(const slot of model.environments.get(p.environment_layout).slots){spend();check(state.heap.has(ref+'/slot/'+slot.key),'environment-initialization');}value.refs.add(ref);}value.pairs.set(p.function_id+'\0'+(ref??''),{functionId:p.function_id,environment:ref});}}
            else if(name==='constant')value=literal(op.view,0,Number(p.decimal));
            else if(name==='floating')value=literal(op.view);
            else if(name==='boolean')value=literal(boolTypeId,p.value?2:1);
            else if(name==='undefined'||name==='null'||name==='string')value=literal(op.view);
            else if(name==='cell'||name==='catch_bind') {
              const id=c.id+'/cell/'+op.result;value.cells.add(id);state.heap.set(id,name==='catch_bind'?a.copy(args[0]):a.empty());
              if(name==='catch_bind')observe('binding/'+p.binding,args[0]);
            }else if(name==='load')value=mergeSlots(args[0].cells);
            else if(name==='store'){
              for(const cell of args[0].cells)put(cell,args[1]);observe('binding/'+p.binding,args[1]);
            }else if(name==='global_load')value=a.copy(state.heap.get('global:'+p.global)??a.empty());
            else if(name==='global_store') {
              put('global:'+p.global,args[0]);const raw=model.globals.get(p.global).sourceBinding;observe('binding/'+raw,args[0]);
              if(bounded){const before=a.key(globalSeeds.get(raw));seed(globalSeeds,raw,args[0]);changed ||= before!==a.key(globalSeeds.get(raw));}
            }else if(['view','assert','pack','carrier_cast'].includes(name))value=a.copy(args[0]);
            else if(name==='value_copy') {
              const copyValue=(source,path,active=new Map())=>{
                spend();const result=a.copy(source);result.refs.clear();
                for(const ref of source.refs){spend();const object=objects.get(ref);check(object,'ssa');
                  if(types.get(object.type)?.kind!=='value'){result.refs.add(ref);continue;}
                  const copied=active.get(ref)??fn+'/copy/'+op.result+'/'+path+'/'+object.type;result.refs.add(copied);if(active.has(ref))continue;
                  spend(active.size);const nested=new Map(active);nested.set(ref,copied);const weak=objects.get(copied)?.weak||object.weak||repeated.has(fn)||cyclicBlocks.has(fn+'/'+block.name)||source.refs.size>1;
                  objects.set(copied,{...object,weak});
                  for(const field of a.fields(object.type)){spend();const stored=state.heap.get(ref+'/field/'+field.id);if(stored)put(copied+'/field/'+field.id,copyValue(stored,path+'/'+field.id,nested),!weak);}
                }return result;
              };value=copyValue(args[0],'root');
            }else if(name==='construct_value'||name==='allocate_reference'||name==='array_create') {
              value=literal(op.view);const ref=fn+'/object/'+op.result;value.refs.add(ref);
              const weak=repeated.has(fn)||cyclicBlocks.has(fn+'/'+block.name);objects.set(ref,{type:op.view,weak});
              if(name==='array_create'){args.forEach((v,i)=>{put(ref+'/element/'+i,v);if(bounded){const key='element:'+op.view,before=a.key(elementSeeds.get(key));seed(elementSeeds,key,v);changed ||= before!==a.key(elementSeeds.get(key));}});put(ref+'/length',literal(sha256('tsfg.type\0u32'),0,args.length));}
            }else if(name==='field_load'||name==='field_store') {
              for(const ref of args[0].refs){spend();const object=objects.get(ref);check(object,'ssa');const field=fieldFor(object.type,plan.graph.registers.get(op.operands[0]).view,p.field),row=model.fields.get(field),slot=ref+'/field/'+field;
                if(name==='field_load')a.merge(value,state.heap.get(slot)??a.empty());else {put(slot,args[1],!object.weak&&args[0].refs.size===1);observe('binding/'+row.sourceBinding,args[1]);
                  if(bounded){const before=a.key(fieldSeeds.get(row.sourceBinding));seed(fieldSeeds,row.sourceBinding,args[1]);changed ||= before!==a.key(fieldSeeds.get(row.sourceBinding));}}}
              if(args[0].unknown)value.unknown=true;
            }else if(name==='array_length'||name==='readspan_length')value=literal(op.view);
            else if(name==='readspan') {
              // Distinct activations retain distinct descriptors. Recursive
              // summaries use the stable SCC activation to keep keys finite.
              value=literal(op.view);const ref=(cyclicFunctions.has(fn)?c.activation:c.id)+'/span/'+op.result;objects.set(ref,{type:op.view,weak:repeated.has(fn)||cyclicBlocks.has(fn+'/'+block.name)});value.refs.add(ref);put(ref+'/owner',args[0]);put(ref+'/start',args[1]);put(ref+'/length',args[2]);
            }else if(name==='array_read'||name==='array_store'||name==='array_resize') {
              const owners=a.empty();for(const ref of args[0].refs){spend();const object=objects.get(ref);check(object,'ssa');
                if(types.get(object.type)?.kind==='readSpan')a.merge(owners,state.heap.get(ref+'/owner')??a.empty());else owners.refs.add(ref);}
              for(const ref of owners.refs){spend();const object=objects.get(ref),index=args[1]?.number;
                if(name==='array_resize'){put(ref+'/length',args[1],!object.weak);continue;}
                if(name==='array_store'){put(ref+'/element/'+(index===null?'*':index),args[2],!object.weak&&index!==null);if(bounded){const key='element:'+object.type,before=a.key(elementSeeds.get(key));seed(elementSeeds,key,args[2]);changed ||= before!==a.key(elementSeeds.get(key));}continue;}
                for(const [slot,stored]of state.heap){spend();if(slot.startsWith(ref+'/element/'))a.merge(value,stored);}
                value.tags.add(undefinedId);
              }
              if(args[0].unknown)value.unknown=true;
            }else if(name==='strict_equal') {
              value=literal(boolTypeId,3);if(!args.some(v=>v.unknown)) {
                const sameAbsence=args.every(v=>v.tags.size===1)&&[...args[0].tags].every(tag=>args[1].tags.has(tag)&&['undefined','null'].includes(types.get(tag)?.kind));
                const disjoint=![...args[0].tags].some(tag=>args[1].tags.has(tag));if(sameAbsence||disjoint)value.truth=(sameAbsence===(p.operator==='==='))?2:1;
              }
            }else if(name==='binary'||name==='unary') {
              const views=op.operands.map(name=>plan.graph.registers.get(name).view),shape=name==='unary'?{kind:name,operator:p.operator,operand:{type:views[0]}}
                :{kind:name,operator:p.operator,left:{type:views[0]},right:{type:views[1]}};
              const approved=Boolean(finiteNumericUse(shape)),normal=args.every(v=>v.tags.size||v.unknown);let reaches=normal,trap=false;
              if(approved)for(const [index,v]of args.entries()){
                check(!v.unknown&&[...v.tags].every(tag=>tag===i32TypeId||tag===undefinedId),'capability','unsupported actual numeric consumption',
                  {functionId:fn,primary:{sourceId:plan.owner.sourcePath,...op.range},operand:index,actualTypes:[...v.tags].sort()});
                reaches &&= v.tags.has(i32TypeId);trap ||= v.tags.has(undefinedId);
              }
              else check(args.every((v,i)=>!v.unknown&&[...v.tags].every(tag=>tag===views[i])),'capability','actual scalar tag differs from its consuming view');
              if(bounded||reaches)value=literal(op.view,op.view===boolTypeId?3:0);
              const key=fn+'/'+op.result;if(!operations.has(key))operations.set(key,{normal:false,requestTrap:false,approved});const record=operations.get(key);record.normal ||= reaches;record.requestTrap ||= trap;
              if(!bounded&&!reaches)continues=false;
            }else if(name==='invoke'||name==='invoke_method'||name==='invoke_indirect') {
              const method=name==='invoke_method',indirect=name==='invoke_indirect',details={functionId:fn,primary:{sourceId:plan.owner.sourcePath,...op.range}};
              check(indirect||method||model.functions.get(p.function_id)?.kind!=='method','capability','method call requires explicit finite dispatch',details);
              if(method){check(!args[0].unknown,'capability','method receiver has no proved actual nominal type',details);
                for(const tag of args[0].tags){spend();check(p.dispatch.some(row=>{spend();return row.receiver_type===tag;}),'capability','actual receiver has no verified method target',{...details,actualType:tag});}}
              const complete=(target,value,heap)=>{const after=a.clone(state);for(const [slot,v]of heap)update(after.heap,slot,v);edge(target,after,blocks.get(target).parameters.length?[value]:[],true);};
              if(indirect)spend(args[0].pairs.size);const alternatives=indirect?[...args[0].pairs.values()].map(pair=>({target:pair.functionId,environment:pair.environment})):method?p.dispatch:[{target:p.function_id}];
              if(indirect){for(const tag of args[0].tags){spend();check(types.get(tag)?.kind==='function','capability','actual indirect operand is not callable',details);}
                check(!args[0].unknown||p.targets.top,'callable-contract','actual unknown callee exceeds finite upper',details);
                if(p.targets.top){const normalBlock=blocks.get(op.successors[0]),unknown=normalBlock.parameters.length?literal(normalBlock.parameters[0].type):a.empty();unknown.unknown=true;edge(op.successors[0],state,normalBlock.parameters.length?[unknown]:[]);const thrown=a.empty();thrown.unknown=true;edge(op.successors[1],state,[thrown]);}
                for(const row of alternatives){spend();check(p.targets.top||p.targets.functions.some(bound=>{spend();return bound.function_id===row.target;}),'callable-contract');check(model.functions.get(row.target)?.signatureHash===p.signature_hash,'capability','actual indirect signature differs from the saved callable view',details);}}
              const selected=[];for(const row of alternatives){spend();if(!method||args[0].tags.has(row.receiver_type))selected.push(row);}
              if(observer){spend(selected.length);observer.prepareCall(point,c,op,args,state,selected.map(row=>{spend();return row.target;}));}
              for(const row of selected){
                spend();let passed=args;if(indirect){spend(args.length);passed=args.slice(1);}
                if(indirect&&model.functions.get(row.target).lexicalEnvironment){const env=a.literal('env:'+model.functions.get(row.target).lexicalEnvironment);check(row.environment,'environment');env.refs.add(row.environment);passed.unshift(env);}
                if(method){spend(args.length);passed=args.slice(0,byId.get(row.target).parameters.length);const receiver=a.copy(args[0]);receiver.tags.clear();receiver.tags.add(row.receiver_type);
                  for(const ref of receiver.refs){spend();if(objects.get(ref)?.type!==row.receiver_type)receiver.refs.delete(ref);}passed[0]=receiver;}
                const activation=cyclicFunctions.has(row.target)?'recursive/'+row.target:c.activation+'/'+fn+':'+op.range.start+':'+op.range.end;check(activation.length<=32768,'limit');
                const call=context(row.target,passed,state.heap,false,activation),key=fn+'/'+op.range.start+':'+op.range.end,targets=callTargets.get(key)??new Set();targets.add(row.target);callTargets.set(key,targets);
                observer?.call(point,call,c,op.successors);
                if(call.normal)complete(op.successors[0],call.returned,call.normalHeap);if(call.language)complete(op.successors[1],call.thrown,call.languageHeap);
              }continues=false;
            }else if(name==='cf.br'||name==='route'){edge(op.successors[0],state,args);continues=false;}
            else if(name==='cf.cond_br') {
              check(!args[0].unknown&&[...args[0].tags].every(tag=>tag===boolTypeId),'capability','condition has no proved boolean actual value');
              const truth=args[0].truth||3;op.successors.forEach((target,index)=>{if(truth&(index===0?2:1))edge(target,state);});continues=false;
            }else if(name==='func.return'||name==='return_throw') {
              const normal=name==='func.return',field=normal?'returned':'thrown',heap=normal?'normalHeap':'languageHeap';
              if(!c[normal?'normal':'language']){c[normal?'normal':'language']=true;changed=true;}if(args.length)changed=a.merge(c[field],args[0])||changed;
              changed=a.joinHeap(c[heap],a.reachable([...c.args,...(args.length?[args[0]]:[])],state.heap))||changed;continues=false;
            }else if(name==='unreachable')continues=false;
            else check(['fuel','enter_handler','finally_enter'].includes(name),'ssa','unmodelled common logical operation '+name);
            if(op.result){state.values.set(op.result,value);observe(fn+'/'+op.result,value);}observer?.after(c,op,state,value,point);if(!continues)break;
          }
        }
    }
    do{changed=false;for(const c of contexts.values())execute(c);}while(changed);
    let borrows=null;
    if(!bounded&&records){const observer=commonBorrowObservations({model,records,objects});
      for(const c of contexts.values())execute(c,observer);check(!changed,'ssa','final actual observation changed the fixed point');borrows=observer.finish();}
    return {contexts,observed,objects,operations,callTargets,borrows};
  }
  const capacity=solve(true),actual=solve(false);
  return {capacity,actual,fieldSeeds,globalSeeds,elementSeeds,abstract:a};
}
