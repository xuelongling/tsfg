// SPDX-License-Identifier: MIT
// Fixed upper consumption and ordinary control completions share one owned
// Program. Language throws are routed structurally; request traps never enter EH.
import {commonCheck as check,canonical} from './common-program-common.mjs';
import {commonCollections,commonSortedSubset} from './common-program-budget.mjs';
import {commonTargets} from './common-program-targets.mjs';
import {commonMethods} from './common-program-methods.mjs';
import {commonReturnOrigins,commonReturnOriginFormat} from './common-program-return-origins.mjs';
import {commonReturnOriginsInclusion} from './common-program-return-origin-inclusion.mjs';
import {commonFacets} from './common-program-effects.mjs';
/** @param {((id:string)=>string|null)|null} [fixedTypeKind] */
export function commonReturnOriginSource(hir,spend,physical=null,storageProjection=null,fixedTypeKind=null,fixedRecords=null,selectedFunctions=null) {
  check(storageProjection===null||storageProjection.status==='complete'||storageProjection.status==='partial','return-origin-storage-open','verified storage directory is unresolved');
  const collections=commonCollections(spend);
  const fixedUppers=fixedRecords===null?null:new Map(),owners=selectedFunctions===null?hir.functions:hir.functions.filter(fn=>{spend();return selectedFunctions.has(fn.id);});
  if(fixedRecords!==null){spend(fixedRecords.size*2+1);for(const [id,row]of fixedRecords)if(row.returnOrigins!==null)fixedUppers.set(id,{...row.upper,returnOrigins:row.returnOrigins});}
  spend(hir.types.length+hir.functions.length+hir.globals.length+hir.environments.length);
  const types=new Map(hir.types.map(row=>[row.id,row])),functions=new Map(hir.functions.map(row=>[row.id,row]));
  // Only explicit authoring may infer a callee's code-return transfer from its
  // body. A consumer's admitted fixed rows also override a physical model's
  // current-body callable observations; physical capacity is not a code grant.
  const globals=new Map(hir.globals.map(row=>[row.id,row])),referenceMemo=new Map(),methods=commonMethods(hir,spend),
    callables=fixedRecords===null?(physical?.model.callables??commonTargets(hir,spend)):commonTargets(hir,spend,fixedRecords),
    actualTypes=new Map(),slots=new Map(),environments=new Map(hir.environments.map(row=>[row.id,row])),projectField=storageProjection?.projectField??(()=>null);
  const actualType=id=>{
    spend();if(actualTypes.has(id))return actualTypes.get(id);
    // A published local/copy tag can survive removal of the implementation
    // that originally introduced its private composite type. Prefer its fixed
    // interpretation; current-HIR extras only classify new body-local tags.
    const kind=fixedTypeKind?.(id)??types.get(id)?.kind;
    if(kind==='value'){
      check(storageProjection,'return-origin-storage-open','actual value copy requires the verified complete physical-slot projection');
      const shape=storageProjection.actualType(id);actualTypes.set(id,shape);return shape;
    }
    check(kind&&!['value','unknown','union'].includes(kind),'return-origin-storage-open','actual value storage requires the verified complete physical-slot projection');
    const shape={kind,fields:[]};actualTypes.set(id,shape);return shape;
  };
  for(const env of hir.environments)for(const slot of env.slots){spend(8);slots.set(slot.binding,{...slot,layout:env.id});}
  function reference(id,active=new Set()) {
    if(id===null||id==='void')return false;
    spend();if(referenceMemo.has(id))return referenceMemo.get(id);check(!active.has(id),'type');active.add(id);
    const t=types.get(id);check(t,'type');const result=['unknown','reference','array','readSpan','string'].includes(t.kind)
      ||t.kind==='union'&&t.members.some(id=>reference(id,collections.set(active)))
      ||t.kind==='value'&&t.fields.some(field=>reference(field.type,collections.set(active)));
    referenceMemo.set(id,result);return result;
  }
  const ownerParameters=fn=>{spend(fn.parameters.length+1);return [...(fn.ownerType?[{id:fn.receiverBinding,type:fn.ownerType}]:[]),...fn.parameters];};
  const blank=fn=>({captures:[],globals:{reads:[],writes:[]},hostResources:{reads:[],writes:[]},parameters:ownerParameters(fn).map((_,index)=>({index,read:false,write:false,structural:false})),
    facets:Object.fromEntries(commonFacets.map(flag=>[flag,false])),returnOrigins:{format:commonReturnOriginFormat,normal:[],language:[],nodes:[],heaps:[{kind:'entry'}],controls:[{kind:'entry'}],calls:[],exits:{normal:[{heap:0,control:0}],language:[]},accesses:[]}});
  function derive(fn,records,diagnostics=false) {
    records=fixedUppers??records;
    check(fn.kind!=='construction-body','return-origin-construction-open','receiver frame/result equations are not connected to this Source producer');
    const result=blank(fn),read=new Set(),write=new Set(),hostRead=new Set(),hostWrite=new Set(),hostCalls=[],params=ownerParameters(fn),origins=new Map(),calls=[],captures=new Map();
    const local=diagnostics?new Map():null;let operationSource=fn.sourcePath;
    const bindings=new Map();for(const binding of fn.bindings??[]){spend();bindings.set(binding.id,binding);}
    const protocol=owner=>({lexicalEnvironment:owner.lexicalEnvironment??null,activationEnvironment:owner.activationEnvironment??null});
    // Code formation requires every admitted signature/Env protocol, even when
    // that function's return graph is unavailable. A null graph never supplies
    // a call summary; actual invocation still requires a complete fixed row.
    spend(functions.size+1);const contracts=new Map();for(const [id,owner]of functions){spend();const upper=records.get(id);
      contracts.set(id,{graph:upper?.returnOrigins??null,upper:upper??fixedRecords?.get(id)?.upper??null,protocol:protocol(owner)});}
    // A local equation carries its concrete allocation tag, not a Source
    // projection view. Different concrete tags cannot be one actual object;
    // equal tags and all formal/unknown sources remain conservatively aliasing.
    const mayAlias=(a,b)=>a.node.kind!=='local'||b.node.kind!=='local'||a.node.type===b.node.type;
    const graph=commonReturnOrigins(spend,{projectField,mayAlias,actualType,contracts,environments,rootProtocol:protocol(fn)}),normalReturns=new Set(),normalExits=new Set(),languageExits=new Set(),marks=[];
    const environmentRefs=new Map();if(fn.lexicalEnvironment)environmentRefs.set(fn.lexicalEnvironment,graph.environmentInput(fn.lexicalEnvironment));
    const environmentFor=id=>{
      if(environmentRefs.has(id))return environmentRefs.get(id);
      let layout=fn.lexicalEnvironment;
      while(layout!==null){spend();const row=environments.get(layout);check(row,'return-origin-environment-open','missing owned lexical layout');
        if(row.parent===id){const selected=graph.environmentParent(environmentRefs.get(layout),id);environmentRefs.set(id,selected);return selected;}
        if(row.parent!==null&&!environmentRefs.has(row.parent))environmentRefs.set(row.parent,graph.environmentParent(environmentRefs.get(layout),row.parent));layout=row.parent;
      }
      check(false,'return-origin-environment-open','required environment is outside the actual lexical chain');
    };
    spend((fn.captures??[]).length);const foreignCaptures=new Set((fn.captures??[]).map(row=>row.binding));
    const join=(target,source)=>{for(const id of source){spend();target.add(id);}};
    const appendStates=(target,source)=>{spend(source.length);for(const state of source)target.push(state);};
    const nonowning=type=>type==='void'?new Set():graph.root('nonowning',type);
    const site=(id,range,role)=>{spend(Math.ceil((id.length+role.length)/8)+12);return canonical([id,range.start,range.end,role]);};
    if(fn.activationEnvironment){const layout=environments.get(fn.activationEnvironment);check(layout,'return-origin-environment-open','missing activation layout');
      const parent=layout.parent===null?null:environmentFor(layout.parent);environmentRefs.set(layout.id,graph.environmentCreate(layout.id,parent,site(fn.id,fn.range,'activation')));}
    const copied=(refs,type,range,role)=>graph.copy(refs,type,site(fn.id,range,role));
    const retain=(reason,origin)=>{
      spend();const key=canonical(reason),before=local.get(key);
      const order=value=>[value.source.sourceId,value.source.start,value.source.end,value.kind,value.operation];
      const a=order(origin),b=before&&order(before);let comparison=0;
      if(b)for(let i=0;i<a.length&&!comparison;i++)comparison=a[i]<b[i]?-1:a[i]>b[i]?1:0;
      if(!before||comparison<0)local.set(key,origin);
    };
    const witness=(reason,kind,operation,range)=>{
      if(local)retain(reason,{kind,functionId:fn.id,source:{sourceId:kind==='operation'?operationSource:fn.sourcePath,...range},operation});
    };
    const facet=(name,kind,operation,range)=>{result.facets[name]=true;witness({kind:'facet',facet:name},kind,operation,range);};
    const capture=(slot,flags,location=null)=>{const before=captures.get(slot)??{slot,read:false,write:false,structural:false};for(const flag of ['read','write','structural']){
      before[flag] ||= flags[flag]===true;if(location&&flags[flag])witness({kind:'capture',slot,access:flag},location.kind,location.operation,location.range);
    }captures.set(slot,before);};
    for(const row of fn.captures??[]){spend();const slot=slots.get(row.binding);check(slot,'return-origin-environment-open','missing capture slot');capture(slot.key,{read:row.read,write:row.write,structural:false},{kind:'function',operation:'capture',range:fn.range});}
    if(fn.activationEnvironment){facet('allocation','function','activationEnvironment',fn.range);facet('managedReference','function','activationEnvironment',fn.range);}
    if(fn.lexicalEnvironment)facet('managedReference','function','lexicalEnvironment',fn.range);
    if(!diagnostics){result.facets.managedReference ||= physical?.references.get(fn.id)??false;result.facets.escape=physical?.escaping.get(fn.id)??false;}
    // A Source scalar view can carry a managed actual payload through assert,
    // storage and calls. Formal roots are conditional owners; their existence
    // grants neither an actual tag nor a managed-reference capability.
    params.forEach((p,index)=>{spend();const selected=graph.root('parameter',p.type,index);origins.set(p.id,selected);const slot=slots.get(p.id);
      if(slot&&slot.layout===fn.activationEnvironment)graph.write(environmentFor(slot.layout),'capture:'+slot.key,selected,{view:'env:'+slot.layout,initialize:true});});
    if(reference(fn.returnType)||params.some(p=>reference(p.type)))facet('managedReference','function','signature',fn.range);
    const mergeFacets=facets=>{for(const key of commonFacets)if(key!=='mayThrow')result.facets[key] ||= facets[key];};
    const project=(owners,flag,value)=>{for(const origin of owners){spend();
      check(!origin.startsWith('unknown:'),'return-origin-unknown','unresolved managed origin cannot silently discharge an access');
      if(origin.startsWith('g:'))(flag==='read'?read:write).add(origin.slice(2));
      if(origin.startsWith('p:'))result.parameters[Number(origin.slice(2))][flag]=true;
      if(origin.startsWith('c:'))capture(origin.slice(2),{[flag]:true},value&&{kind:'operation',operation:value.kind,range:value.range});
      if(origin.startsWith('h:'))(flag==='read'?hostRead:hostWrite).add(origin.slice(2));
    }};
    const mark=(set,flag,value=null)=>{const selected=graph.gate(set);graph.access(selected,flag);marks.push({set:selected,flag,value});};
    const union=sets=>{const result=new Set();for(const values of sets)for(const value of values){spend();result.add(value);}return result;};
    const mergeOrigins=(a,b)=>{for(const [id,values]of b){spend();a.set(id,union([a.get(id)??new Set(),values]));}};
    const replaceOrigins=(target,states)=>{for(const id of target.keys()){spend(states.length+1);target.set(id,union(states.map(state=>state.get(id)??new Set())));}};
    const normalOrigins=environment=>collections.map(environment,values=>graph.gate(values));
    function expression(value,environment=origins) {
      spend();let throwing=false,owner=reference(value.type)?new Set():nonowning(value.type),thrown=new Set(),throwHeaps=new Set(),throwStates=[];
      const visit=child=>{const result=expression(child,environment);throwing ||= result.throwing;join(thrown,result.thrown);join(throwHeaps,result.throwHeaps);appendStates(throwStates,result.throwStates);return result.owner;};
      const touch=()=>{if(reference(value.type))facet('managedReference','operation',value.kind,value.range);};touch();
      if(['bindingReference','bindingTarget','thisReference'].includes(value.kind)){
        const binding=value.kind==='thisReference'?fn.receiverBinding:value.binding,slot=slots.get(binding);
        if(slot){owner=graph.capture(environmentRefs.has(slot.layout)?environmentRefs.get(slot.layout):environmentFor(slot.layout),slot.layout,slot.key,slot.type);
          if(value.kind!=='bindingTarget'&&foreignCaptures.has(binding))capture(slot.key,{read:true},{kind:'operation',operation:value.kind,range:value.range});}
        else owner=environment.get(binding)??new Set();
      }else if(value.kind==='functionReference'){
        const target=functions.get(value.functionId);check(target,'identity');owner=graph.code(target.id,target.lexicalEnvironment?environmentFor(target.lexicalEnvironment):null,value.type);
        if(target.lexicalEnvironment)facet('managedReference','operation',value.kind,value.range);
      }
      else if(['globalReference','globalTarget'].includes(value.kind)){
        check(globals.has(value.global),'identity');owner=graph.root('global',globals.get(value.global).type,value.global);if(value.kind==='globalReference')read.add(value.global);
      }else if(['parentheses','as','nonNull'].includes(value.kind))owner=visit(value.expression);
      else if(value.kind==='binary'&&['&&','||','??'].includes(value.operator)){
        const left=visit(value.left),shortHeap=graph.checkpoint(),shortEnvironment=normalOrigins(environment),right=visit(value.right),rightEnvironment=normalOrigins(environment);owner=union([left,right]);
        replaceOrigins(environment,[shortEnvironment,rightEnvironment]);
        graph.restore(graph.mergeStates([shortHeap,graph.checkpoint()]));
      }else if(value.kind==='stringLiteral')owner=nonowning(value.type);
      else if(value.kind==='arrayLiteral'){
        spend(value.elements.length);const elements=value.elements.map((child,index)=>copied(visit(child),child.type,child.range,'array-element:'+index));facet('allocation','operation',value.kind,value.range);facet('managedReference','operation',value.kind,value.range);
        owner=graph.root('local',value.type,null,value.allocationSite);graph.write(owner,'element',union(elements),{view:value.type,initialize:true});
      }else if(['fieldAccess','fieldTarget','checkedElementAccess','elementTarget','arrayLength','readSpanLength','lengthTarget'].includes(value.kind)){
        const receiver=visit(value.receiver);if(value.index)visit(value.index);
        if(['fieldAccess','checkedElementAccess','arrayLength','readSpanLength'].includes(value.kind))mark(receiver,'read',value);
        owner=['fieldAccess','fieldTarget'].includes(value.kind)?graph.select(receiver,'field:'+value.property,value.type,value.receiver.type):
          ['checkedElementAccess','elementTarget'].includes(value.kind)?graph.select(receiver,'element',value.type,value.receiver.type):nonowning(value.type);
      }else if(['bindingAssignment','elementAssignment','elementCompoundAssignment','lengthAssignment','fieldAssignment','bindingUpdate','elementUpdate','fieldUpdate'].includes(value.kind)) {
        // A field store touches its container, while a later field load follows
        // the stored payload. Do not confuse the selected reference with that
        // container or evaluate a side-effecting receiver twice.
        let target=value.target;while(target.kind==='parentheses'){spend();target=target.expression;}
        const container=target.receiver?visit(target.receiver):null;
        if(target.index)visit(target.index);
        const slot=target.binding?slots.get(target.binding):null,selected=container??(slot&&value.operator==='='?new Set():visit(target)),external=container!==null||target.kind==='globalTarget'||foreignCaptures.has(target.binding);
        if(external&&value.operator!=='='&&!slot)mark(selected,'read',value);
        if(slot&&foreignCaptures.has(target.binding))capture(slot.key,{read:value.operator!=='=',write:true},{kind:'operation',operation:value.kind,range:value.range});
        const logical=['&&=','||=','??='].includes(value.operator),previous=logical&&container&&['fieldTarget','elementTarget'].includes(target.kind)?
          graph.select(container,target.kind==='fieldTarget'?'field:'+target.property:'element',target.type,target.receiver.type):selected;
        const shortHeap=graph.checkpoint(),shortEnvironment=logical?normalOrigins(environment):null,evaluated=value.value?visit(value.value):nonowning(value.type),assigned=value.operator==='='||logical?evaluated:nonowning(value.type);if(external&&!slot)mark(selected,'write',value);
        const stored=copied(assigned,target.type,value.range,'assignment-store');
        if(container&&['fieldTarget','elementTarget'].includes(target.kind))graph.write(container,target.kind==='fieldTarget'?'field:'+target.property:'element',stored,{view:target.receiver.type});
        if(value.kind==='lengthAssignment'||value.kind.startsWith('element'))mark(selected,'structural',value);
        owner=logical?union([previous,assigned]):assigned;
        if(slot)graph.write(environmentFor(slot.layout),'capture:'+slot.key,stored,{view:'env:'+slot.layout});
        if(target.binding&&!target.global)environment.set(target.binding,stored);
        if(logical){const rightEnvironment=normalOrigins(environment);replaceOrigins(environment,[shortEnvironment,rightEnvironment]);graph.restore(graph.mergeStates([shortHeap,graph.checkpoint()]));}
      }else if(value.kind==='new'||value.kind==='superConstruct') {
        check(false,'return-origin-construction-open','construct must consume the receiver-frame result protocol and fixed dynamic-newTarget bounds');
      }else if(value.kind==='indirectCall'){
        const selectedCode=visit(value.expression);spend(value.arguments.length);const arguments_=value.arguments.map((child,index)=>copied(visit(child),value.signature.parameters[index],child.range,'indirect-argument:'+index)),targets=callables.site(fn.id,value.range);
        check(!targets.top&&targets.functions.length>0,'return-origin-call-open','unresolved permitted code targets require their fixed return/environment boundary');
        const before=graph.checkpoint(),normalHeaps=[];owner=new Set();for(const target of targets.functions){spend();graph.restore(before);const record=consume(target,arguments_,value,environment,selectedCode);throwing ||= record.upper.facets.mayThrow;join(owner,record.normal);join(thrown,record.language);normalHeaps.push(record.normalHeap);if(record.upper.facets.mayThrow){throwHeaps.add(record.languageHeap);appendStates(throwStates,record.throwStates);}}
        graph.restore(graph.mergeStates(normalHeaps));
      }else if(value.kind==='hostCall'){
        check(false,'return-origin-host-open','Host payload provenance requires a fixed admitted boundary; a Source scalar view is insufficient');
      }else if(value.kind==='call') {
        spend(value.arguments.length+1);const arguments_=[...(value.receiver?[visit(value.receiver)]:[]),...value.arguments.map((child,index)=>copied(visit(child),value.signature.parameters[index],child.range,'direct-argument:'+index))];
        if(value.callee==='intrinsic:readSpan')owner=arguments_[0];
        else {const callee=functions.get(value.callee),targets=callee?.kind==='method'?methods.dispatch(callee.id,value.receiver.type):[{target:value.callee}];
          const before=graph.checkpoint(),normalHeaps=[];owner=new Set();const consumed=new Set();for(const {target}of targets){spend();if(consumed.has(target))continue;consumed.add(target);graph.restore(before);
            const record=consume(target,arguments_,value,environment);throwing ||= record.upper.facets.mayThrow;join(owner,record.normal);join(thrown,record.language);normalHeaps.push(record.normalHeap);if(record.upper.facets.mayThrow){throwHeaps.add(record.languageHeap);appendStates(throwStates,record.throwStates);}}
          graph.restore(graph.mergeStates(normalHeaps));}
      }else {
        for(const key of ['expression','left','right','receiver','index','value'])if(value[key])visit(value[key]);
        if(value.kind==='stringConcat'){facet('allocation','operation',value.kind,value.range);facet('managedReference','operation',value.kind,value.range);owner=nonowning(value.type);}
      }
      return {owner:graph.gate(owner,value.type),throwing,thrown,throwHeaps,throwStates};
    }
    function consume(id,args,value,environment,selectedCode=null) {
      spend();const callee=functions.get(id),upper=records.get(id);check(callee,'publication','missing complete function signature');
      check(upper,'return-origin-call-open','fixed callee return graph is unavailable');
      check(callee.kind!=='construction-body','return-origin-construction-open','a constructor frame is not an ordinary object argument');
      const arity=upper.parameters.length;check(args.length>=arity,'return-origin-call-open','missing logical arguments require the owned default-parameter protocol');
      spend(arity+1);const supplied=args.slice(0,arity);
      calls.push({functionId:fn.id,target:id,range:value.range,kind:value.kind,sourcePath:operationSource});mergeFacets(upper.facets);
      upper.hostResources.reads.forEach(id=>{spend();hostRead.add(id);});upper.hostResources.writes.forEach(id=>{spend();hostWrite.add(id);});
      upper.globals.reads.forEach(id=>{spend();read.add(id);});upper.globals.writes.forEach(id=>{spend();write.add(id);});
      for(const p of upper.parameters)for(const flag of ['read','write','structural'])if(p[flag])mark(supplied[p.index],flag);
      const incoming=callee.lexicalEnvironment?(selectedCode===null?environmentFor(callee.lexicalEnvironment):graph.environmentComponent(selectedCode,id,callee.lexicalEnvironment)):null;
      const called=graph.call(id,supplied,callee.returnType,site(id,value.range,value.kind),{callee:selectedCode,environment:incoming});
      const applied={...called,normalHeap:called.normalState,languageHeap:called.languageState};
      // Shared slots live in the saved Env heap. The fixed callee graph and
      // fixed capture upper both transfer through that exact environment;
      // replacing a binding cannot erase the old weak-store alternative.
      graph.restore(applied.normalHeap);
      return {upper,...applied,throwStates:upper.facets.mayThrow?[collections.map(environment)]:[]};
    }
    function body(rows,environment=origins,escapingThrows=null,escapingValues=new Set(),returnValues=new Set(),escapingHeaps=new Set(),returnHeaps=new Set(),escapingStates=[],returnStates=[]) {
      let completions=new Set(['normal']);
      for(const row of rows) {
        spend();if(!completions.has('normal'))break;completions.delete('normal');let current=new Set(['normal']);const rowThrows=local?new Map():null;
        const rowValues=new Set(),rowReturns=new Set(),rowThrowHeaps=new Set(),rowReturnHeaps=new Set(),rowThrowStates=[],rowReturnStates=[];
        const inspect=value=>expression(value,environment),possibleThrow=result=>{if(result.throwing){current.add('throw');join(rowValues,result.thrown);join(rowThrowHeaps,result.throwHeaps);appendStates(rowThrowStates,result.throwStates);}return result.owner;};
        if(['constDeclaration','letDeclaration','initialize'].includes(row.kind)) {
          const assigned=possibleThrow(inspect(row.initializer)),binding=globals.get(row.global)??bindings.get(row.binding);
          environment.set(row.binding,copied(assigned,binding?.type??row.initializer.type,row.range,'declaration-store'));if(row.global)write.add(row.global);
          const slot=slots.get(row.binding);if(slot)graph.write(environmentFor(slot.layout),'capture:'+slot.key,environment.get(row.binding),{view:'env:'+slot.layout,initialize:true});
        }else if(row.kind==='expression')possibleThrow(inspect(row.value));
        else if(row.kind==='return') {
          if(row.value){const evaluated=possibleThrow(inspect(row.value)),assigned=fn.returnType==='void'||types.get(fn.returnType)?.kind==='void'?new Set():copied(evaluated,fn.returnType,row.range,'return');join(rowReturns,assigned);if(reference(fn.returnType))facet('escape','operation',row.kind,row.range);
            if(types.get(fn.returnType)?.kind==='function'&&(graph.owners(assigned).size||graph.holdsEnvironment(assigned))){facet('managedReference','operation',row.kind,row.range);facet('escape','operation',row.kind,row.range);}
            if(types.get(fn.returnType)?.kind==='readSpan')check(!collections.array(graph.owners(assigned)).some(owner=>owner.startsWith('local:')||owner.startsWith('unknown:')),'readspan-return-escape',undefined,{primary:{sourceId:fn.sourcePath,...row.range}});}
          current.delete('normal');current.add('return');
          rowReturnHeaps.add(graph.checkpoint());
          rowReturnStates.push(collections.map(environment));
        }else if(row.kind==='throw') {
          join(rowValues,possibleThrow(inspect(row.value)));facet('ehControl','operation',row.kind,row.range);current=new Set(['throw']);
          rowThrowHeaps.add(graph.checkpoint());
          rowThrowStates.push(collections.map(environment));
          if(rowThrows){const origin={kind:'operation',functionId:fn.id,source:{sourceId:operationSource,...row.range},operation:row.kind};rowThrows.set(canonical(origin),origin);}
        }else if(row.kind==='block'){const child=collections.map(environment);current=body(row.body,child,rowThrows,rowValues,rowReturns,rowThrowHeaps,rowReturnHeaps,rowThrowStates,rowReturnStates);if(current.has('normal'))replaceOrigins(environment,[child]);}
        else if(row.kind==='if') {
          const condition=inspect(row.condition),entry=graph.checkpoint(),yes=collections.map(environment),no=collections.map(environment);
          const yesCompletions=body(row.then,yes,rowThrows,rowValues,rowReturns,rowThrowHeaps,rowReturnHeaps,rowThrowStates,rowReturnStates),yesHeap=graph.checkpoint();graph.restore(entry);
          const noCompletions=body(row.else,no,rowThrows,rowValues,rowReturns,rowThrowHeaps,rowReturnHeaps,rowThrowStates,rowReturnStates),noHeap=graph.checkpoint();
          current=union([yesCompletions,noCompletions]);replaceOrigins(environment,[...(yesCompletions.has('normal')?[yes]:[]),...(noCompletions.has('normal')?[no]:[])]);
          graph.restore(graph.mergeStates([...(yesCompletions.has('normal')?[yesHeap]:[]),...(noCompletions.has('normal')?[noHeap]:[])]));
          if(condition.throwing){current.add('throw');join(rowValues,condition.thrown);join(rowThrowHeaps,condition.throwHeaps);appendStates(rowThrowStates,condition.throwStates);}
        }else if(row.kind==='while') {
          const loopSite=site(fn.id,row.range,'while');spend(Math.ceil(loopSite.length/8)+1);const heapSite=loopSite+'/heap',entry=graph.checkpoint(),header=graph.mergeStates([entry],heapSite),bindingTypes=new Map();
          const phiSite=binding=>{spend(Math.ceil((loopSite.length+binding.length)/8)+1);return loopSite+'/'+binding;};
          for(const rows of [params,fn.bindings??[]])for(const binding of rows){spend();bindingTypes.set(binding.id,binding.type);}
          for(const global of hir.globals){spend();bindingTypes.set(global.sourceBinding,global.type);}
          for(const capture of fn.captures??[]){spend();bindingTypes.set(capture.binding,slots.get(capture.binding).type);}
          for(const [binding,refs]of environment){spend();const type=bindingTypes.get(binding);if(type)environment.set(binding,graph.phi(type,refs,phiSite(binding)));}
          graph.restore(header);const condition=inspect(row.condition),exitHeap=graph.checkpoint(),loop=collections.map(environment);
          const loopCompletions=body(row.body,loop,rowThrows,rowValues,rowReturns,rowThrowHeaps,rowReturnHeaps,rowThrowStates,rowReturnStates);
          if(loopCompletions.has('normal')){
            graph.mergeStates([graph.checkpoint()],heapSite);
            for(const [binding,refs]of loop){spend();const type=bindingTypes.get(binding);if(type)environment.set(binding,graph.phi(type,refs,phiSite(binding)));}
          }
          graph.restore(exitHeap);current=collections.set(collections.array(loopCompletions).filter(c=>c!=='normal'));
          if(!(row.condition.kind==='booleanLiteral'&&row.condition.token==='true'))current.add('normal');
          if(condition.throwing){current.add('throw');join(rowValues,condition.thrown);join(rowThrowHeaps,condition.throwHeaps);appendStates(rowThrowStates,condition.throwStates);}
        }else if(row.kind==='try') {
          facet('ehControl','operation',row.kind,row.range);const attempted=collections.map(environment),attemptValues=new Set(),attemptHeaps=new Set(),attemptStates=[];current=body(row.tryBlock.body,attempted,rowThrows,attemptValues,rowReturns,attemptHeaps,rowReturnHeaps,attemptStates,rowReturnStates);
          if(current.has('normal'))replaceOrigins(environment,[attempted]);
          if(row.catchClause&&current.delete('throw')) {
            const caught=collections.map(environment);replaceOrigins(caught,attemptStates);if(row.catchClause.binding)caught.set(row.catchClause.binding.id,attemptValues);
            const normalHeap=graph.checkpoint(),hadNormal=current.has('normal');graph.restore(graph.mergeStates(collections.array(attemptHeaps)));
            rowThrows?.clear();const caughtCompletions=body(row.catchClause.block.body,caught,rowThrows,rowValues,rowReturns,rowThrowHeaps,rowReturnHeaps,rowThrowStates,rowReturnStates);
            const caughtHeap=graph.checkpoint(),normalEnvironments=[...(hadNormal?[attempted]:[]),...(caughtCompletions.has('normal')?[caught]:[])];current=union([current,caughtCompletions]);replaceOrigins(environment,normalEnvironments);
            graph.restore(graph.mergeStates([...(hadNormal?[normalHeap]:[]),...(caughtCompletions.has('normal')?[caughtHeap]:[])]));
          }else{join(rowValues,attemptValues);join(rowThrowHeaps,attemptHeaps);appendStates(rowThrowStates,attemptStates);}
          if(row.finallyBlock) {
            spend(rowThrowHeaps.size+rowReturnHeaps.size+1);const allHeaps=[...(current.has('normal')?[graph.checkpoint()]:[]),...rowThrowHeaps,...rowReturnHeaps];graph.restore(graph.mergeStates(allHeaps));
            const final=collections.map(environment);spend(rowThrowStates.length+rowReturnStates.length+1);replaceOrigins(final,[...(current.has('normal')?[environment]:[]),...rowThrowStates,...rowReturnStates]);
            const finalThrows=local?new Map():null,finalValues=new Set(),finalReturns=new Set(),finalThrowHeaps=new Set(),finalReturnHeaps=new Set(),finalThrowStates=[],finalReturnStates=[],completed=body(row.finallyBlock.body,final,finalThrows,finalValues,finalReturns,finalThrowHeaps,finalReturnHeaps,finalThrowStates,finalReturnStates);if(completed.has('normal'))replaceOrigins(environment,[final]);
            if(!completed.has('normal'))rowThrows?.clear();if(rowThrows)for(const [key,origin]of finalThrows)rowThrows.set(key,origin);
            if(!completed.has('normal')){rowValues.clear();rowReturns.clear();rowThrowHeaps.clear();rowReturnHeaps.clear();rowThrowStates.length=0;rowReturnStates.length=0;}
            else{if(rowThrowHeaps.size){rowThrowHeaps.clear();rowThrowHeaps.add(graph.checkpoint());rowThrowStates.length=0;rowThrowStates.push(collections.map(final));}if(rowReturnHeaps.size){rowReturnHeaps.clear();rowReturnHeaps.add(graph.checkpoint());rowReturnStates.length=0;rowReturnStates.push(collections.map(final));}}
            join(rowValues,finalValues);join(rowReturns,finalReturns);join(rowThrowHeaps,finalThrowHeaps);join(rowReturnHeaps,finalReturnHeaps);
            appendStates(rowThrowStates,finalThrowStates);appendStates(rowReturnStates,finalReturnStates);
            current=union([completed.has('normal')?current:new Set(),collections.set(collections.array(completed).filter(c=>c!=='normal'))]);
          }
        }
        completions=union([completions,current]);
        if(escapingThrows&&current.has('throw'))for(const [key,origin]of rowThrows)escapingThrows.set(key,origin);
        if(current.has('throw'))join(escapingValues,rowValues);
        if(current.has('return'))join(returnValues,rowReturns);
        if(current.has('throw'))join(escapingHeaps,rowThrowHeaps);
        if(current.has('return'))join(returnHeaps,rowReturnHeaps);
        if(current.has('throw'))appendStates(escapingStates,rowThrowStates);
        if(current.has('return'))appendStates(returnStates,rowReturnStates);
      }
      return completions;
    }
    const throws=local?new Map():null,languageReturns=new Set(),completions=body(fn.body,origins,throws,languageReturns,normalReturns,languageExits,normalExits);
    if(completions.has('normal'))normalExits.add(graph.checkpoint());
    // Phi equations are complete now. Reproject every recorded access rather
    // than freezing permissions from only the first visit to a loop header.
    for(const {set,flag,value}of marks){spend();project(graph.owners(set),flag,value);}
    const solved=graph.effects();for(const [flag,owners]of solved.accesses){spend();project(owners,flag,null);}
    result.facets.mayThrow=false;for(const state of languageExits){spend();result.facets.mayThrow ||= graph.live(state);}
    if(local&&result.facets.mayThrow)for(const origin of throws.values())retain({kind:'facet',facet:'mayThrow'},origin);
    result.captures=collections.sorted(captures.values(),(a,b)=>a.slot<b.slot?-1:a.slot>b.slot?1:0);
    result.returnOrigins=graph.snapshot(normalReturns,languageReturns,{normal:collections.array(normalExits),language:collections.array(languageExits)});
    result.globals={reads:collections.sorted(read),writes:collections.sorted(write)};result.hostResources={reads:collections.sorted(hostRead),writes:collections.sorted(hostWrite)};return {upper:result,calls,hostCalls,completions:collections.sorted(completions),local};
  }
  function derived(dependencies=null) {
    check(fixedRecords===null,'publication-mode','a fixed consumer cannot replace its admitted uppers with current-body derivation');
    // Availability has excluded recursive/unavailable call components. Author
    // each complete fixed target before its caller, once, without inventing
    // provisional Bottom contracts or re-solving unchanged public functions.
    const calls=dependencies??commonReturnOriginAvailability(hir,callables,methods,spend,storageProjection).dependencies,
      selected=new Map(owners.map(fn=>[fn.id,fn])),rows=new Map(),active=new Set();
    const visit=id=>{spend();if(rows.has(id))return;const owner=selected.get(id);
      check(owner&&!active.has(id),'return-origin-call-open','authoring requires a complete nonrecursive fixed call component');active.add(id);
      const targets=calls.get(id);check(targets,'return-origin-call-open','authoring call membership is missing');
      for(const target of targets){spend();visit(target);}
      rows.set(id,derive(owner,rows).upper);active.delete(id);
    };for(const owner of owners){spend();visit(owner.id);}return rows;
  }
  function covers(upper,body,records) {
    records=fixedUppers??records;
    const flags=['read','write','structural'];spend(upper.captures.length+records.size+1);const captures=new Map(upper.captures.map(row=>[row.slot,row]));
    for(const row of body.captures){spend();const allowed=captures.get(row.slot);if(!allowed)return false;for(const flag of flags){spend();if(row[flag]&&!allowed[flag])return false;}}
    for(const group of ['globals','hostResources'])for(const flag of ['reads','writes'])if(!commonSortedSubset(body[group][flag],upper[group][flag],spend))return false;
    for(const flag of commonFacets){spend();if(body.facets[flag]&&!upper.facets[flag])return false;}
    for(const [index,row]of body.parameters.entries())for(const flag of flags){spend();if(row[flag]&&!upper.parameters[index][flag])return false;}
    const contracts=new Map();for(const [id,value]of records){spend();contracts.set(id,{graph:value.returnOrigins});}
    return commonReturnOriginsInclusion(body.returnOrigins,upper.returnOrigins,contracts,spend).status==='covered';
  }
  return {reference,ownerParameters,blank,derive,derived,covers,types,functions,globals};
}

// Only these known unavailable language protocols produce a null archive row.
// Malformed data, exhausted work and broken invariants are never caught here.
export function commonReturnOriginAvailability(hir,callables,methods,spend,storageProjection=null) {
  spend(hir.types.length+hir.functions.length+hir.environments.length+1);
  const types=new Map(hir.types.map(row=>[row.id,row])),functions=new Map(hir.functions.map(fn=>[fn.id,fn])),
    slots=new Map(),reasons=new Map(),dependencies=new Map(),scalarLocal=new Map();
  for(const env of hir.environments)for(const slot of env.slots){spend();slots.set(slot.binding,slot);}
  for(const fn of hir.functions){
    spend(fn.parameters.length+(fn.bindings?.length??0)+(fn.captures?.length??0)+1);
    let scalar=fn.kind==='source'&&!fn.ownerType&&!fn.lexicalEnvironment&&!fn.activationEnvironment&&(fn.captures?.length??0)===0;
    const calls=new Set(),pending=[fn.body,...(fn.parameterInitialization?.steps??[])],views=[fn.returnType,...fn.parameters.map(row=>row.type),...(fn.bindings??[]).map(row=>row.type)];
    if(fn.ownerType)views.push(fn.ownerType);
    for(const capture of fn.captures??[]){spend();const slot=slots.get(capture.binding);check(slot,'return-origin-capture');views.push(slot.type);}
    if(fn.kind==='construction-body')reasons.set(fn.id,'construction-frame-open');
    while(pending.length){
      spend();const row=pending.pop();if(row===null||typeof row!=='object')continue;
      if(Array.isArray(row)){spend(row.length);for(const child of row)pending.push(child);continue;}
      if(typeof row.type==='string')views.push(row.type);
      if(typeof row.argumentType==='string')views.push(row.argumentType);
      if(['new','superConstruct','hostCall','functionReference','indirectCall','globalReference','globalTarget'].includes(row.kind))scalar=false;
      if(row.kind==='new'||row.kind==='superConstruct')reasons.set(fn.id,'construction-frame-open');
      if(row.kind==='hostCall')reasons.set(fn.id,'host-return-open');
      if(row.kind==='indirectCall'){
        const allowed=callables.site(fn.id,row.range);spend(allowed.functions.length+1);
        if(allowed.top||allowed.functions.length===0)reasons.set(fn.id,'permitted-target-open');
        for(const target of allowed.functions)calls.add(target);
      }else if(row.kind==='call'&&row.callee!=='intrinsic:readSpan'){
        const target=functions.get(row.callee);check(target,'return-origin-callee');
        if(target.kind==='method')for(const chosen of methods.dispatch(target.id,row.receiver.type)){spend();calls.add(chosen.target);}
        else calls.add(target.id);
      }
      for(const key in row){spend(Math.ceil(key.length/8)+1);const child=row[key];if(child!==null&&typeof child==='object')pending.push(child);}
    }
    spend(views.length);for(const view of views){spend();const type=types.get(view);if(view==='void')continue;check(type,'return-origin-type');
      if(['unknown','union'].includes(type.kind)||type.kind==='value'&&!storageProjection?.supportsValue(type.id))reasons.set(fn.id,'storage-projection-open');
      if(!['scalar','void','null','undefined'].includes(type.kind))scalar=false;}
    scalarLocal.set(fn.id,scalar);
    dependencies.set(fn.id,calls);
  }
  // An unresolved SCC remains Open, rather than treating provisional Bottom
  // as a published return or environment initialization guarantee.
  let ordinal=0;const indices=new Map(),low=new Map(),stack=[],active=new Set();
  const visit=id=>{
    spend();indices.set(id,ordinal);low.set(id,ordinal++);stack.push(id);active.add(id);
    for(const target of dependencies.get(id)){spend();check(functions.has(target),'return-origin-callee');
      if(!indices.has(target)){visit(target);low.set(id,Math.min(low.get(id),low.get(target)));}
      else if(active.has(target))low.set(id,Math.min(low.get(id),indices.get(target)));
    }
    if(low.get(id)!==indices.get(id))return;const component=[];let member;
    do{spend();member=stack.pop();active.delete(member);component.push(member);}while(member!==id);
    if(component.length>1||dependencies.get(id).has(id))for(const item of component){spend();reasons.set(item,'recursive-return-open');}
  };
  for(const fn of hir.functions){spend();if(!indices.has(fn.id))visit(fn.id);}
  const callers=new Map();for(const [id,targets]of dependencies)for(const target of targets){spend();if(!callers.has(target))callers.set(target,[]);callers.get(target).push(id);}
  spend(reasons.size);const pending=Array.from(reasons.keys());
  for(let index=0;index<pending.length;index++)for(const caller of callers.get(pending[index])??[]){spend();if(!reasons.has(caller)){reasons.set(caller,'fixed-callee-return-open');pending.push(caller);}}
  const selected=new Set();for(const fn of hir.functions){spend();if(!reasons.has(fn.id))selected.add(fn.id);}
  return {selected,reasons,dependencies,scalarLocal};
}

// A finite return/content proof is required only where the complete fixed
// permission upper can confer data authority. An unrelated null row never
// poisons an otherwise closed scalar root.
export function commonReturnOriginAuthorityRequired(upper,spend) {
  spend(upper.parameters.length+upper.captures.length+1);
  return upper.globals.reads.length>0||upper.globals.writes.length>0||upper.hostResources.reads.length>0||upper.hostResources.writes.length>0
    ||upper.parameters.some(row=>row.read||row.write||row.structural)||upper.captures.some(row=>row.read||row.write||row.structural)
    ||upper.facets.managedReference||upper.facets.escape||upper.facets.unknownHost;
}

// The existing permission solver and the graph's real owner transfer both add
// obligations. Neither is allowed to erase obligations produced by the other.
export function commonJoinReturnOriginEffects(left,right,spend) {
  const combine=(a,b)=>{spend(a.length+b.length+1);const result=Array.from(new Set([...a,...b]));
    result.sort((a,b)=>{spend(Math.ceil((a.length+b.length)/8)+1);return a<b?-1:a>b?1:0;});return result;};
  spend(left.parameters.length+left.captures.length+right.captures.length+commonFacets.length+1);
  const captures=new Map(left.captures.map(row=>[row.slot,{...row}]));
  for(const row of right.captures){spend();const old=captures.get(row.slot);captures.set(row.slot,old?{slot:row.slot,read:old.read||row.read,write:old.write||row.write,structural:old.structural||row.structural}:{...row});}
  const captureRows=Array.from(captures.values());captureRows.sort((a,b)=>{spend(Math.ceil((a.slot.length+b.slot.length)/8)+1);return a.slot<b.slot?-1:a.slot>b.slot?1:0;});
  return {globals:{reads:combine(left.globals.reads,right.globals.reads),writes:combine(left.globals.writes,right.globals.writes)},
    hostResources:{reads:combine(left.hostResources.reads,right.hostResources.reads),writes:combine(left.hostResources.writes,right.hostResources.writes)},
    captures:captureRows,parameters:left.parameters.map((row,index)=>{spend();const other=right.parameters[index];check(other&&other.index===row.index,'return-origin-parameter');
      return {index:row.index,read:row.read||other.read,write:row.write||other.write,structural:row.structural||other.structural};}),
    facets:Object.fromEntries(commonFacets.map(flag=>[flag,left.facets[flag]||right.facets[flag]]))};
}

// The exception is a Source/type proof over the entire fixed target closure,
// not a claim that an untrusted low effect upper establishes a scalar payload.
export function commonReturnOriginScalarProof(functionId,availability,records,spend,covered) {
  const pending=[functionId],seen=new Set();while(pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);
    const row=records.get(id);check(row,'return-origin-function-context');
    // A supplied graph must pass actual body containment. The independent
    // scalar exception cannot turn an unverified nonnull member into null.
    if(row.returnOrigins!==null&&!covered.has(id))return false;
    if(!availability.scalarLocal.get(id)||commonReturnOriginAuthorityRequired(row.upper,spend))return false;
    for(const target of availability.dependencies.get(id)){spend();pending.push(target);}
  }return true;
}
