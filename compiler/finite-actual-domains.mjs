// SPDX-License-Identifier: MIT
// Monotone Source-flow closure. This module computes representation bounds;
// it never evaluates source expressions or invents runtime values.
import {verifyHir} from './module-hir.mjs';
import {buildTypedLayouts} from './typed-layouts.mjs';
import {buildTypedReferenceViews} from './typed-reference-views.mjs';
import {buildFiniteFieldReaching} from './finite-field-reaching.mjs';
import {finiteFieldStorePath} from './finite-field-effects.mjs';
import {buildFiniteArrayReaching} from './finite-array-reaching.mjs';
import {finiteCallables} from './finite-callables.mjs';
import {canonical,own,sha256,i32TypeId} from './identity.mjs';
import {finiteNumericUse,finiteNormalFlow,finiteNormalBody,finiteNormalLogical,finiteNormalCoalesce} from './finite-numeric-use.mjs';
import {isArrayNullishAssignment,isFiniteAbsence,isLocalNullishAssignment} from './finite-presence.mjs';
import {actualFieldResolver,fieldReceiverView} from './member-presence.mjs';
import {selectReferenceMethod} from './reference-methods.mjs';

function fail(message) {throw Object.assign(new TypeError('r03-finite-domain: '+message),
  {code:'r03-finite-domain',ruleId:'r01-input-boundary',phase:'lowering'});}

function boundId(parameters,result) {
  return sha256('tsfg.finite-abi.v1\0'+canonical({parameters,result}));
}

function publishedId(value) {
  return sha256('tsfg.published-call.v1\0'+canonical(value));
}

function domainId(alternatives) {
  return sha256('tsfg.actual-domain.v1\0'+canonical(alternatives));
}

function representationDomain(id,alternatives,types,physical) {
  const selected=alternatives.map(id=>types.get(id)),native=selected.length===1&&selected[0].kind==='scalar';
  const reference=selected.length>0&&selected.every(type=>type.kind==='reference');
  const alignment=Math.max(1,...alternatives.map(id=>physical.get(id).alignment));
  const bytes=Math.max(0,...alternatives.map(id=>physical.get(id).byteSize));
  const union=alternatives.length>1&&!reference;
  return {id,actualTypes:alternatives,representation:alternatives.length===0?'bottom':native?'native':reference?'reference':selected.length===1
    ?['undefined','null','void'].includes(selected[0].kind)?'absence':'inline':'finite-union',
    nativeType:native?selected[0].name:null,alignment:union?Math.max(2,alignment):alignment,
    tagBytes:union?2:0,byteSize:union?Math.ceil((Math.ceil(2/alignment)*alignment+bytes)/Math.max(2,alignment))*Math.max(2,alignment):bytes,
    referenceCount:Math.max(0,...alternatives.map(id=>physical.get(id).referenceCount))};
}

// The original checked read and calls remain in Core. Only the lexical
// return chain needs a native SSA type. Neither successful values nor Array
// element capacities are added to the ordered domain analysis.
export function addFiniteTerminalReturnCarriers(hir,plan,layouts,charge) {
  if(!plan.arrayReaching.reads.length)return plan;
  const bottom=domainId([]),eligible=new Set();
  for(const row of plan.abi){charge();if(row.result===bottom)eligible.add(row.functionId);}
  if(!eligible.size)return plan;
  const missing=new Set();
  for(const read of plan.arrayReaching.reads) {
    charge();if(read.status==='missing')missing.add(read.node);
  }
  if(!missing.size)return plan;
  const indexById=rows=>new Map(rows.map(row=>{charge();return [row.id,row];}));
  const types=indexById(hir.types),maximum=indexById(plan.carrierNodes),normal=indexById(plan.nodes);
  const tails=new Map();
  for(const fn of hir.functions) {
    charge();if(!eligible.has(fn.id)||fn.ownerType)continue;
    const index=fn.body.length-1,statement=fn.body[index],value=statement?.value;
    const expression=fn.id+'/body/'+index+'/value',returned=fn.id+'/return',type=types.get(fn.returnType.id);
    if(statement?.kind!=='return'||value?.type!==fn.returnType.id||type?.kind!=='scalar')continue;
    const target=value.kind==='call'&&!value.receiver?value.target:null;
    if(!target&&(value.kind!=='arrayReadChecked'||!missing.has(expression)))continue;
    let direct=true;
    for(let i=0;i<index;++i){charge();if(fn.body[i].kind!=='local'){direct=false;break;}}
    if(!direct)continue;
    const rows=[maximum.get(expression),maximum.get(returned),normal.get(expression),normal.get(returned)];
    if(!rows.every(row=>row?.domainId===bottom&&!row.pending.length))continue;
    tails.set(fn.id,{expression,returned,type:type.id,target});
  }
  const sites=new Set(),callers=new Map();
  for(const [id,tail] of tails) {
    charge();if(!tail.target||tails.get(tail.target)?.type!==tail.type)continue;
    sites.add(tail.expression+'\0'+tail.target);
    if(!callers.has(tail.target))callers.set(tail.target,[]);
    callers.get(tail.target).push(id);
  }
  // The field inventory includes every lexical call, including dead paths.
  // Keep the previous bottom ABI whenever a call site would still use it.
  const blocked=new Set(),blockedWork=[];
  for(const call of plan.fieldReaching.callContexts) {
    charge();if(tails.has(call.target)&&!sites.has(call.site)&&!blocked.has(call.target)){
      blocked.add(call.target);blockedWork.push(call.target);
    }
  }
  for(let i=0;i<blockedWork.length;++i) {
    charge();const id=blockedWork[i],target=tails.get(id).target;
    if(tails.has(target)&&!blocked.has(target)){blocked.add(target);blockedWork.push(target);}
  }
  const terminal=[];
  for(const [id,tail] of tails){charge();if(!tail.target&&!blocked.has(id))terminal.push(id);}
  if(!terminal.length)return plan;
  const domains=indexById(plan.domains),carriers=new Map(),results=new Map();
  const physical=new Map(layouts.entries.map(row=>{charge();return [row.typeId,row.layout];}));
  for(let i=0;i<terminal.length;++i) {
    charge();const id=terminal[i],tail=tails.get(id),alternatives=[tail.type],domain=domainId(alternatives);
    const carrier=domains.get(domain)??representationDomain(domain,alternatives,types,physical);
    domains.set(domain,carrier);carriers.set(tail.expression,domain);carriers.set(tail.returned,domain);results.set(id,domain);
    for(const caller of callers.get(id)??[]){charge();if(!blocked.has(caller))terminal.push(caller);}
  }
  if(!results.size)return plan;
  const changedAbis=new Map();
  const abi=plan.abi.map(row=>{
    charge();const result=results.get(row.functionId);
    if(!result)return row;
    const id=boundId(row.parameters,result);
    changedAbis.set(row.functionId,id);
    return {...row,result,id};
  });
  const published=plan.published.map(row=>{
    charge();const result=results.get(row.functionId);
    if(!result)return row;
    const value={functionId:row.functionId,sourceSignature:row.sourceSignature,closureIdentity:row.closureIdentity,
      parameterBounds:row.parameterBounds,resultBound:result,abi:changedAbis.get(row.functionId)};
    return {...value,id:publishedId(value)};
  });
  const domainRows=Array.from(domains.values(),row=>{charge();return row;});
  domainRows.sort((a,b)=>{charge();return a.id<b.id?-1:1;});
  return {...plan,abi,published,domains:domainRows,carrierNodes:plan.carrierNodes.map(row=>{
    charge();const domainId=carriers.get(row.id);return domainId?{...row,domainId}:row;
  })};
}

/** @param {any} input @param {any} context
 * @param {{work?:number,cancelled?:()=>boolean,publicationContext?:any}} [options] */
export function buildFiniteActualDomains(input,context,options={}) {
  return buildPlans(input,context,options,false).reached;
}

// Definition slots are universally quantified representation bounds. They
// never publish an allocation, invocation or reached-instance observation.
export function buildFiniteCoreDomains(input,context,options={}) {
  return buildPlans(input,context,options,true);
}


function buildPlans(input,context,options,definitions) {
  let remaining=options.work??100000;
  if(!Number.isInteger(remaining)||remaining<1||remaining>100000)fail('invalid work limit');
  const charge=()=>{if(options.cancelled?.())fail('cancelled');if(remaining--<=0)fail('work limit');};
  let verified,layouts,views;
  const projection={
    hir:()=>verified??=verifyHir(input,context,options.publicationContext),
    layouts:hir=>layouts??=buildTypedLayouts(hir,context,{publicationContext:options.publicationContext}),
    views:hir=>views??=buildTypedReferenceViews(hir,context,{publicationContext:options.publicationContext})
  };
  function build(mode) {
    let allowCompoundTermination;
    const solve=(field=null,array=null,terminalReads=null)=>
      solveFiniteActualDomains(projection,charge,field,mode,array,terminalReads);
    const initial=solve(),hir=projection.hir();
    // Field short-circuit control also must not consume capacity-based Array
    // reads. This is the same conservative solver role as the ordered start.
    const controlInitial=solve(null,{reads:[]});
    let fieldReaching=buildFiniteFieldReaching(hir,{...controlInitial,carrierFields:initial.fields},charge);
    const carrierFieldReaching=fieldReaching.reads.some(row=>row.reaching.length)?fieldReaching:null;
    let result=carrierFieldReaching?solve(carrierFieldReaching):initial;
    const canTerminateArrayRead=directStatement=>{
      allowCompoundTermination??=!result.fields.length&&!result.calls.length&&
        !fieldReaching.effects.some(row=>{charge();return row.writesFields;});
      // Mixed field state has a matching cut at this direct statement root.
      // Method receiver selection retains its existing transfer boundary.
      return allowCompoundTermination||directStatement&&!result.calls.length;
    };
    // The first control query must not inherit Array read alternatives from
    // the carrier/capacity solution. A non-null empty reaching directory makes
    // every unproved read pending in this same solver, before any edge is cut.
    let arrayReaching,terminalReads,ordered=solve(fieldReaching,{reads:[]}),previous;
    // Memory-dependent presence may remove an incoming call edge only after
    // its actual read sources are proved. Iterate the same solver, sharing the
    // original budget; representation maxima never become memory witnesses.
    for(;;) {
      const array=buildFiniteArrayReaching(hir,{...ordered,carrierNodes:result.nodes,fieldReaching},charge,canTerminateArrayRead);
      arrayReaching=array.reaching;terminalReads=array.terminalReads;
      if(!arrayReaching.reads.length)break;
      // Even skipped stores need lexical versions from the carrier. The
      // ordered field selections continue to govern successful reads.
      const fieldPlan={...ordered,arrayReaching,carrierFields:result.fields,
        failedInitializers:array.failedInitializers,failedConstructions:array.failedConstructions,failedSuperArguments:array.failedSuperArguments};
      fieldReaching=buildFiniteFieldReaching(hir,fieldPlan,charge,allowCompoundTermination?null:terminalReads);
      const rows=[];for(const read of arrayReaching.reads){charge();const versions=[];
        for(const id of read.versions){charge();versions.push(id);}
        const normalSources=array.normalReadSources.get(read.node)??[];
        for(let index=0;index<normalSources.length;index++)charge();
        rows.push([read.node,read.status,versions,normalSources]);}
      const fields=[];for(const read of fieldReaching.reads){charge();const targets=[];
        for(const target of read.reaching){charge();const versions=[],sources=[],intrinsics=[];
          for(const id of target.versions){charge();versions.push(id);}for(const id of target.sources){charge();sources.push(id);}
          for(const id of target.intrinsics??[]){charge();intrinsics.push(id);}targets.push([target.actualType,target.field,versions,sources,intrinsics]);}
        fields.push([read.node,targets]);}
      const aliases=[];for(const row of fieldReaching.returnAliases){charge();aliases.push([row.functionId,row.parameter]);}
      // Field identities selected from Array versions can in turn refine a
      // later Array owner. Close both existing constraints with one budget;
      // neither carrier maxima nor successful bounds become alias witnesses.
      const terminal=[];for(const id of terminalReads??[]){charge();terminal.push(id);}
      terminal.sort((a,b)=>{charge();return a<b?-1:a>b?1:0;});
      const failedInitializers=[];for(const [site,node] of array.failedInitializers??[]){charge();failedInitializers.push([site,node]);}
      failedInitializers.sort(([a],[b])=>{charge();return a<b?-1:a>b?1:0;});
      const failedConstructions=[];for(const id of array.failedConstructions??[]){charge();failedConstructions.push(id);}
      failedConstructions.sort((a,b)=>{charge();return a<b?-1:a>b?1:0;});
      const failedSuperArguments=[];for(const pair of array.failedSuperArguments??[]){charge();failedSuperArguments.push(pair);}
      failedSuperArguments.sort(([a],[b])=>{charge();return a<b?-1:a>b?1:0;});
      const current=canonical([rows,fields,aliases,terminal,failedInitializers,failedConstructions,failedSuperArguments]);
      if(current===previous)break;previous=current;
      ordered=solve(fieldReaching,{...arrayReaching,normalReadSources:array.normalReadSources},terminalReads);
    }
    // Refined payloads do not silently republish a narrower ABI. Representation
    // maxima retain their original finite role, separately from ordered data.
    if(terminalReads)result=solve(carrierFieldReaching,null,terminalReads);
    const domains=new Map([...result.domains,...ordered.domains].map(row=>[row.id,row]));
    const calls=ordered.calls.map(call=>({...call,targets:call.targets.map(target=>({...target,
      abi:result.abi.find(row=>row.functionId===target.functionId).id}))}));
    return {...result,nodes:ordered.nodes,carrierNodes:result.nodes,calls,fields:ordered.fields,
      carrierCalls:result.calls,carrierFields:result.fields,
      domains:[...domains.values()].sort((a,b)=>a.id<b.id?-1:1),fieldReaching,arrayReaching};
  }
  const reached=build('reached'),definition=definitions?build('definition'):null;
  return own({reached:{...reached,work:(options.work??100000)-remaining},
    ...(definition?{definition:{...definition,work:(options.work??100000)-remaining}}:{})});
}

function solveFiniteActualDomains(projection,charge,fieldReaching,mode,arrayReaching=null,terminalReads=null) {
  const refinements=new Map((fieldReaching?.reads??[]).map(row=>[row.node,row.reaching]));
  const arrayReads=new Map((arrayReaching?.reads??[]).filter(row=>row.status!=='pending').map(row=>[row.node,row]));
  charge();const hir=projection.hir();
  const types=new Map(hir.types.map(type=>[type.id,type]));
  const physical=new Map(projection.layouts(hir).entries.map(row=>[row.typeId,row.layout]));
  const undefinedId=sha256('tsfg.type\0undefined'),intrinsics=[];
  if(!types.has(undefinedId)&&hir.types.some(type=>type.construction)) {
    charge();if(types.size>=4096)fail('formal type limit including intrinsic undefined');
    const value={id:undefinedId,kind:'undefined',name:'undefined'};types.set(undefinedId,value);intrinsics.push(value);
    physical.set(undefinedId,{alignment:1,byteSize:0,referenceCount:0});
  }
  const nodes=new Map(),edges=new Map(),owners=new Map(),queue=[],queued=new Set(),expressions=[],gates=new Map(),presenceCarriers=[],
    representationOnly=!arrayReaching&&terminalReads?new Map():null;
  const reads=[],stores=[],fieldReads=[],fieldStores=[],presenceTests=[],entryOwners=[],methodCalls=[],allocations=[],definitionSeeds=[];
  const views=projection.views(hir);
  const methodViews=new Map(),fieldViews=new Map(),fieldOwners=new Map();
  for(const type of hir.types)for(const field of type.fields??[]) {
    charge();fieldOwners.set(field.id,{owner:type.id,field});
  }
  for(const view of views.views) {
    for(const pair of view.methods) {
      charge();methodViews.set(view.actualType+'\0'+view.targetType+'\0'+pair.target,pair.source);
    }
    for(const pair of view.fields) {
      charge();fieldViews.set(view.actualType+'\0'+view.targetType+'\0'+pair.target,pair.missing?{missing:true,type:undefinedId}:pair.source);
    }
  }
  const callables=finiteCallables(hir),functions=new Map(callables.map(fn=>[fn.id,fn]));
  function node(id,viewType) {
    if(nodes.has(id))return nodes.get(id);charge();
    const result={id,viewType,actual:new Set(),owners:new Set(),pending:new Set()};
    nodes.set(id,result);edges.set(id,new Map());return result;
  }
  const enqueue=id=>{if(!queued.has(id)){charge();queued.add(id);queue.push(id);}};
  function insert(id,key,value) {
    const publish=()=>{const selected=nodes.get(id)[key];if(selected.has(value))return;charge();
      if(key==='actual'&&selected.size>=256)fail('variant limit');selected.add(value);enqueue(id);flow.changed(id);};
    if(key==='pending')publish();else flow.publish(id,publish);
  }
  function copy(from,to,predicate=null) {
    const targets=edges.get(from),key=to+'\0'+canonical(predicate);if(targets.has(key))return;charge();
    if(predicate?.gate){charge();if(!gates.has(predicate.gate))gates.set(predicate.gate,[]);gates.get(predicate.gate).push({from,to,predicate});}
    targets.set(key,{to,predicate});propagate(from,to,predicate);
  }
  const absent=id=>{charge();return isFiniteAbsence(types.get(id)?.kind);};
  function propagate(from,to,predicate) {
    if(predicate?.gate){const gate=nodes.get(predicate.gate);for(const reason of gate.pending){charge();insert(to,'pending',reason);}
      let enabled=false;for(const type of gate.actual){charge();if(absent(type))enabled=true;}if(!enabled)return;}
    for(const key of ['actual','owners','pending'])for(const value of nodes.get(from)[key]) {
      charge();if(predicate?.presentOnly&&key==='actual'&&absent(value))continue;
      if(predicate?.ownerOnly&&key!=='owners'||predicate?.pendingOnly&&key!=='pending')continue;
      if(predicate&&key==='actual'&&(value===predicate.previous?.type||(predicate.equal?value!==predicate.type:value===predicate.type)))continue;
      if((predicate?.equal||predicate?.payloadOnly)&&key==='owners')continue;
      insert(to,key,value);
    }
  }
  const flow=finiteNormalFlow(arrayReaching!==null,charge,nodes);
  function leaves(id) {
    const result=[],seen=new Set(),stack=[id];
    while(stack.length){charge();const current=stack.pop();if(seen.has(current))continue;seen.add(current);
      const type=types.get(current);if(!type)fail('missing owned type');
      if(type.kind==='union')stack.push(...type.members);else result.push(current);}
    return result.sort();
  }
  const binding=(fn,id,type)=>node(fn.id+'/binding/'+id,type).id;
  const returned=fn=>node(fn.id+'/return',fn.returnType.id).id;
  function owner(id,elementType) {
    if(owners.has(id))return owners.get(id);charge();
    const result=node(id+'/elements',elementType).id;owners.set(id,result);return result;
  }
  function entry(id,typeId,authority) {
    const stack=[{id,typeId}];
    while(stack.length) {
      const current=stack.pop();charge();
      for(const actual of leaves(current.typeId)) {
      insert(current.id,'actual',actual);const type=types.get(actual);
      if(type.kind==='reference')for(const candidate of entryReferences(actual,authority))insert(current.id,'actual',candidate);
      if(['array','readSpan'].includes(type.kind)) {
        const allocation=current.id+'/entry-owner/'+actual,element=owner(allocation,type.elementType);
        entryOwners.push({owner:allocation,element,type:type.elementType});
        insert(current.id,'owners',allocation);stack.push({id:element,typeId:type.elementType});
      }
      }
    }
  }
  const exports=new Set(hir.exports.map(row=>row.functionId));
  // Published entry bounds are derived once from the complete selected Source
  // closure. A reference signature includes verified nominal descendants and
  // actual checker-proven structural sources, not every module type. Concrete
  // internal call edges can further enlarge the fixed contract before hashing.
  const referenceBounds=new Map();
  function entryReferences(target,authority=undefined) {
    if(!authority&&referenceBounds.has(target))return referenceBounds.get(target);
    const selected=new Set([target]);
    for(const candidate of hir.types)if(candidate.kind==='reference') {
      charge();let current=candidate;const seen=new Set();
      while(current) {
        charge();if(seen.has(current.id))fail('inheritance cycle');seen.add(current.id);
        if(current.id===target){selected.add(candidate.id);break;}
        current=current.base?types.get(current.base):null;
      }
    }
    for(const record of authority?[authority]:hir.entryCompatibilityRoots)for(const proof of record.roots) {
      charge();
      if(proof.targetType===target)selected.add(proof.sourceType);
    }
    const result=[...selected].sort();if(!authority)referenceBounds.set(target,result);return result;
  }
  for(const fn of callables) {
    returned(fn);
    for(const parameter of fn.parameters) {
      const id=binding(fn,parameter.id,parameter.type);
      if(exports.has(fn.id)) {
        const authority=hir.entryCompatibilityRoots.find(row=>row.functionId===fn.id&&row.parameterBinding===parameter.id);
        if(!authority)fail('missing verified entry authority');entry(id,parameter.type,authority);
      }else if(mode==='definition') {
        const receiver=fn.ownerType&&parameter===fn.parameters[0];
        definitionSeeds.push({functionId:fn.id,binding:parameter.id,viewType:parameter.type,
          authority:receiver?'owned-receiver-definition-bound':'owned-parameter-definition-bound'});
        if(receiver) {
          for(const candidate of hir.types)if(candidate.id===fn.ownerType||candidate.kind==='reference') {
            charge();let current=candidate;
            while(current) {
              charge();if(current.id===fn.ownerType){insert(id,'actual',candidate.id);break;}
              current=current.base?types.get(current.base):null;
            }
          }
        }else entry(id,parameter.type);
      }
    }
  }
  // Host-callable resources persist across calls and exports. Distinct entry
  // parameters have no noalias authority. Propagate writes through every
  // source-compatible possible shared owner, without merging unrelated native
  // representations merely because both also permit absence.
  const aliases=[],aliasMemo=new Map();
  function shareable(left,right,depth=0) {
    charge();if(depth>32)fail('published resource depth limit');
    const key=left+'\0'+right;if(aliasMemo.has(key))return aliasMemo.get(key);
    const a=leaves(left),b=leaves(right),present=ids=>ids.filter(id=>!['undefined','null'].includes(types.get(id).kind));
    const aPresent=present(a),bPresent=present(b);
    let yes=aPresent.some(id=>bPresent.includes(id));
    if(!yes&&(!aPresent.length||!bPresent.length))yes=a.some(id=>b.includes(id));
    for(const x of aPresent)for(const y of bPresent)if(!yes) {
      charge();const at=types.get(x),bt=types.get(y);
      if(at.kind==='reference'&&bt.kind==='reference')
        yes=entryReferences(x).some(id=>entryReferences(y).includes(id));
      else if(['array','readSpan'].includes(at.kind)&&['array','readSpan'].includes(bt.kind))
        yes=shareable(at.elementType,bt.elementType,depth+1);
    }
    aliasMemo.set(key,yes);aliasMemo.set(right+'\0'+left,yes);return yes;
  }
  for(let a=0;a<entryOwners.length;a++)for(let b=a+1;b<entryOwners.length;b++) {
    charge();const left=entryOwners[a],right=entryOwners[b];if(!shareable(left.type,right.type))continue;
    copy(left.element,right.element);copy(right.element,left.element);
    aliases.push({left:left.owner,right:right.owner,authority:'complete-published-resource-boundary',
      elementTypes:[left.type,right.type]});
  }
  const tasks=[];
  function expression(value,path,fn,guards=new Map(),incoming=flow.always,logical=undefined) {
    flow.entry(path,incoming);
    const proof=value.kind==='reference'?guards.get(value.binding):undefined;
    const result=node(path,value.type).id;expressions.push({id:result,kind:value.kind,range:{...value.range},functionId:fn.id,
      ...(proof?{presenceProof:{type:proof.type,equal:proof.equal,range:proof.range}}:{})});
    tasks.push({value,path,fn,guards,logical});return result;
  }
  function constructionFrame(type) {
    return functions.get(type.constructor??type.construction.id);
  }
  const constructionNormal=new Map(),constructionEntries=new Map();
  for(const type of hir.types)if(type.construction) {
    constructionEntries.set(type.construction.id,[]);
    const requirements=type.construction.initialization.filter(init=>init.value)
      .map(init=>flow.normal('construction/'+type.construction.id+'/initialization/'+init.field));
    if(type.construction.implicitForward)requirements.push(flow.returned(constructionFrame(types.get(type.base)).id));
    constructionNormal.set(constructionFrame(type).id,requirements);
  }
  for(const fn of hir.functions)finiteNormalBody(fn.body,fn.id+'/body',fn,{flow,expression,binding,copy,charge,
    voidResult:fn.role==='construction-body'||types.get(fn.returnType.id).kind==='void',requirements:constructionNormal.get(fn.id)??[]});
  for(const fn of callables)if(!hir.functions.includes(fn))flow.returns(fn.id,[flow.all(constructionNormal.get(fn.id)??[])]);
  for(const type of hir.types)if(type.construction) {
    const frame=constructionFrame(type),receiver=binding(frame,frame.parameters[0].id,type.id);
    frame.parameters.forEach(parameter=>binding(frame,parameter.id,parameter.type));
    if(type.construction.implicitForward) {
      const base=constructionFrame(types.get(type.base));
      copy(receiver,binding(base,base.parameters[0].id,base.parameters[0].type));
      type.construction.implicitForward.parameters.forEach(pair=>{
        const source=frame.parameters.find(parameter=>parameter.id===pair.source),target=base.parameters.find(parameter=>parameter.id===pair.target);
        copy(binding(frame,source.id,source.type),binding(base,target.id,target.type));
      });
    }
  }

  // Ordinary bodies register every real super site before the shared lexical
  // own phase is attached. Its entry waits only for the base and operands;
  // the super expression itself also waits for that own phase to complete.
  for(let cursor=0,initialized=false;;cursor++) {
    if(cursor===tasks.length) {
      if(initialized)break;initialized=true;
      for(const type of hir.types)if(type.construction) {
        charge();const construction=type.construction,frame=constructionFrame(type),
          receiver=binding(frame,frame.parameters[0].id,type.id),requirements=[];
        const entry=!type.base?flow.always:construction.implicitForward
          ?flow.returned(constructionFrame(types.get(type.base)).id):flow.any(constructionEntries.get(construction.id));
        for(const init of construction.initialization) {
          charge();const gate=flow.all([entry,...requirements]);
          if(init.value) {
            const value=expression(init.value,'construction/'+construction.id+'/initialization/'+init.field,frame,new Map(),gate);
            fieldStores.push({receiver,field:init.field,value});requirements.push(flow.normal(value));
          }else if(init.binding)fieldStores.push({receiver,field:init.field,gate,
            value:binding(frame,init.binding,type.fields.find(field=>field.id===init.field).type)});
        }
      }
      if(cursor===tasks.length)break;
    }
    charge();const {value:v,path:p,fn,guards,logical}=tasks[cursor],id=p;
    let continuation=flow.incoming(p);const dependencies=[],requirements=[];
    const operand=(value,path,gate,propagatePending)=>{
      const id=expression(value,path,fn,logical?.get(value)??guards,gate,logical);
      if(propagatePending||arrayReaching===null)copy(id,p,{pendingOnly:true});
      return id;
    };
    const at=(value,path)=>{const id=operand(value,path,continuation,true);
      continuation=flow.normal(id);dependencies.push(continuation);return id;};
    const child=key=>at(v[key],p+'/'+key);
    const children=key=>(v[key]??[]).map((value,index)=>at(value,p+'/'+key+'/'+index));
    const invoke=action=>flow.when(flow.all([flow.incoming(id),...dependencies]),action);
    if(['constant','floating','boolean','undefined','null','stringLiteral'].includes(v.kind))insert(id,'actual',v.type);
    else if(v.kind==='reference')copy(binding(fn,v.binding,v.type),id,guards.get(v.binding));
    else if(['group','nonNull','assertType'].includes(v.kind))copy(child('operand'),id);
    else if(v.kind==='arrayCreate') {
      insert(id,'actual',v.type);insert(id,'owners',id);const element=owner(id,types.get(v.type).elementType);
      for(const elementValue of children('elements'))copy(elementValue,element);
    }else if(v.kind==='arrayReadChecked')reads.push({receiver:child('receiver'),index:child('index'),result:id});
    else if(v.kind==='arrayStoreDenseChecked') {
      const receiver=at(v.target.receiver,p+'/target/receiver');
      at(v.target.index,p+'/target/index');const value=child('value');
      stores.push({receiver,value});copy(value,id);
    }else if(isLocalNullishAssignment(v)) {
      const target=binding(fn,v.target.binding,v.target.type),old=node(p+'/old-value',v.target.type).id;
      const selected=finiteNormalCoalesce(flow,continuation,(key,gate,pending)=>{
        if(key==='right')return operand(v.value,p+'/value',gate,pending);
        flow.entry(old,gate);flow.finish(old,[]);copy(target,old);return old;
      },absent);
      presenceCarriers.push(old);dependencies.push(...selected.dependencies);
      copy(old,id,{presentOnly:true});
      copy(selected.right,id,{gate:old});copy(selected.right,target,{gate:old});
    }else if(v.kind==='assignment') {
      const value=child('value'),target=binding(fn,v.target.binding,v.target.type);
      if(v.operator&&v.operator!=='=') {
        for(const type of leaves(v.type))insert(id,'actual',type);
        copy(id,target);
      }else {copy(value,target);copy(value,id);}
    }
    else if(v.kind==='call') {
      const target=functions.get(v.target),receiver=v.receiver?child('receiver'):null;
      const arguments_=children('arguments');
      if(v.target===hir.intrinsics.readSpan.id) {
        insert(id,'actual',v.type);copy(arguments_[0],id,{ownerOnly:true});flow.finish(id,dependencies);continue;
      }
      if(!target){insert(id,'pending','unresolved-call:'+id);flow.finish(id,dependencies);continue;}
      if(receiver) {
        methodCalls.push({id,receiver,arguments:arguments_,member:v.target,
          viewType:types.get(v.receiver.type).kind==='reference'?v.receiver.type:target.ownerType,targets:new Map(),receivers:new Set()});
        flow.finish(id,dependencies);continue;
      }
      // Publish arguments at invocation, independently of the callee's return.
      invoke(()=>{
        arguments_.forEach((argument,index)=>copy(argument,binding(target,target.parameters[index].id,target.parameters[index].type)));
      });
      requirements.push(flow.returned(target.id));
      if(types.get(target.returnType.id).kind==='void')insert(id,'actual',target.returnType.id);else copy(returned(target),id);
    }else if(v.kind==='construct') {
      insert(id,'actual',v.type);const actual=types.get(v.type),target=constructionFrame(actual),arguments_=children('arguments');
      if(actual.kind==='reference')allocations.push({node:id,actualType:actual.id,state:'not-defined'});
      if(target) {
        // Allocation supplies the internal receiver before constructor completion;
        // only the public result waits for that successful completion.
        invoke(()=>{
          insert(binding(target,target.parameters[0].id,target.parameters[0].type),'actual',v.type);
          arguments_.forEach((argument,index)=>copy(argument,binding(target,target.parameters[index+1].id,target.parameters[index+1].type)));
        });
        requirements.push(flow.returned(target.id));
      }
    }else if(v.kind==='superConstruct') {
      const base=hir.types.find(type=>type.construction?.id===v.construction),target=constructionFrame(base);
      const arguments_=children('arguments');
      invoke(()=>{
        copy(binding(fn,v.receiverBinding,fn.ownerType),binding(target,target.parameters[0].id,target.parameters[0].type));
        arguments_.forEach((argument,index)=>copy(argument,binding(target,target.parameters[index+1].id,target.parameters[index+1].type)));
      });
      const baseReturned=flow.returned(target.id);
      constructionEntries.get(v.afterSuccess.construction).push(flow.all([flow.incoming(id),...dependencies,baseReturned]));
      requirements.push(baseReturned,...constructionNormal.get(fn.id));insert(id,'actual',v.type);
    }else if(v.kind==='propertyPresenceTest') {
      child('left');const receiver=child('right');insert(id,'actual',v.type);
      presenceTests.push({id,receiver,field:v.property,viewType:fieldReceiverView(types,fieldOwners,v.right.type,v.property),targets:new Map()});
    }else if(v.kind==='fieldAccess')fieldReads.push({id,receiver:child('receiver'),field:v.property,result:id,
      viewType:fieldReceiverView(types,fieldOwners,v.receiver.type,v.property),targets:new Map()});
    else if(v.kind==='fieldAssignment'||v.kind==='fieldUpdate') {
      const receiver=at(v.target.receiver,p+'/target/receiver'),store=finiteFieldStorePath(id,v),
        field=v.target.property,viewType=fieldReceiverView(types,fieldOwners,v.target.receiver.type,field);
      let value,result;
      if(store===id)value=result=child('value');
      else {
        const old=node(p+'/old-value',v.target.type).id;
        fieldReads.push({id:old,receiver,field,result:old,viewType,targets:new Map()});
        flow.entry(old,continuation);flow.finish(old,[]);
        continuation=flow.normal(old);dependencies.push(continuation);
        if(v.kind==='fieldAssignment')child('value');
        value=node(store+'/value',v.type).id;
        flow.entry(value,continuation);flow.finish(value,[]);
        for(const type of leaves(v.type))insert(value,'actual',type);
        result=v.kind==='fieldUpdate'&&!v.prefix?old:value;
      }
      fieldStores.push({id:store,receiver,field,value,viewType,targets:new Map()});copy(result,id);
    }else if(['binary','shortCircuit'].includes(v.kind)&&v.operator==='??') {
      const selected=finiteNormalCoalesce(flow,continuation,(key,gate,pending)=>operand(v[key],p+'/'+key,gate,pending),absent);
      presenceCarriers.push(selected.left);dependencies.push(...selected.dependencies);
      copy(selected.left,id,{presentOnly:true});copy(selected.right,id,{gate:selected.left});
    }else if(v.kind==='arrayCompoundAssignment'||v.kind==='arrayUpdate') {
      const receiver=at(v.target.receiver,p+'/target/receiver');
      at(v.target.index,p+'/target/index');
      const old=node(p+'/old-value',v.target.type).id,coalescing=isArrayNullishAssignment(v);
      reads.push({receiver,result:old});
      let stored=id,whenAbsent=null;
      if(coalescing) {
        const selected=finiteNormalCoalesce(flow,continuation,(key,gate,pending)=>{
          if(key==='right')return operand(v.value,p+'/value',gate,pending);
          flow.entry(old,gate);flow.finish(old,[]);return old;
        },absent);
        presenceCarriers.push(old);dependencies.push(...selected.dependencies);
        copy(old,id,{presentOnly:true});copy(selected.right,id,{gate:old});
        stored=selected.right;whenAbsent=old;
      }else{
        if(arrayReaching&&terminalReads?.has(old)) {
          flow.entry(old,continuation);flow.finish(old,[]);
          continuation=flow.normal(old);dependencies.push(continuation);
        }
        if(v.kind==='arrayCompoundAssignment')child('value');
        for(const type of leaves(v.type))insert(id,'actual',type);
      }
      if(representationOnly&&terminalReads.has(old)&&types.get(v.target.type)?.kind==='scalar'){
        // Keep the dead read's declared SSA carrier outside the value/owner
        // worklist. Its impossible writeback contributes no backing capacity.
        charge();representationOnly.set(old,v.target.type);
        if(coalescing){charge();representationOnly.set(id,v.type);}
      }else stores.push({receiver,value:stored,whenAbsent});
    }else if(v.kind==='arrayResizeChecked') {
      at(v.target.receiver,p+'/target/receiver');
      child('value');
      for(const type of leaves(v.type))insert(id,'actual',type);
    }else if(['binary','unary','shortCircuit','arrayLength','readSpanLength',
      'update','stringConcat','stringLength','stringSlice','stringIndex'].includes(v.kind)) {
      // Carrier capacity stays declared. Ordered numeric success requires each
      // operand's real i32 alternative, independently from its static view.
      if(v.kind==='shortCircuit'||v.kind==='binary'&&['&&','||'].includes(v.operator))
        dependencies.push(...finiteNormalLogical(v,flow,continuation,(key,gate,pending)=>operand(v[key],p+'/'+key,gate,pending),charge));
      else for(const key of ['left','right','operand','receiver','index','value'])if(v[key])child(key);
      if(v.target)for(const key of ['receiver','index'])if(v.target[key])at(v.target[key],p+'/target/'+key);
      const arguments_=children('arguments');
      if(v.kind==='stringSlice')presenceCarriers.push(...arguments_);
      if(v.kind==='stringIndex')presenceCarriers.push(id);
      if(finiteNumericUse(v))for(const key of v.kind==='binary'?['left','right']:['operand'])
        requirements.push({node:p+'/'+key,type:i32TypeId,possible:true});
      for(const type of leaves(v.type))insert(id,'actual',type);
    }else insert(id,'pending','unsupported-expression:'+v.kind+':'+id);
    flow.finish(id,dependencies,requirements);
  }
  flow.seal();
  // Actual fields are addressed by owned member identities. No name based
  // structural layout reconstruction is permitted at this seam.
  const fieldNode=(actual,field)=>node('field/'+actual+'/'+field.id,field.type).id;
  const actualField=actualFieldResolver(types,fieldViews,fieldOwners,charge);
  function actualMethod(actual,call) {
    return selectReferenceMethod(types,functions,actual,call.member,methodViews.get(actual+'\0'+call.viewType+'\0'+call.member),charge,fail);
  }
  // These are storage representation alternatives, not definedness events.
  // Only actual phase events publish defined-native-undefined. A quantified
  // definition frame is not an allocated or observed runtime instance.
  const storageTypes=new Set(allocations.map(row=>row.actualType));
  if(mode==='definition')for(const fn of callables)if(fn.role==='construction-body')
    for(const actual of nodes.get(binding(fn,fn.parameters[0].id,fn.parameters[0].type)).actual)storageTypes.add(actual);
  for(const actual of storageTypes) {
    let type=types.get(actual);
    while(type) {
      charge();for(const field of type.fields??[])insert(fieldNode(actual,field),'actual',undefinedId);
      type=type.base?types.get(type.base):null;
    }
  }
  for(const version of fieldReaching?.phaseWrites??[])for(const actual of version.actualTypes) {
    const field=fieldOwners.get(version.field).field,target=fieldNode(actual,field);
    if(version.state==='defined-native-undefined')insert(target,'actual',undefinedId);
    else if(version.node)copy(version.node,target);
  }
  let cursor=0;
  while(cursor<queue.length) {
    charge();const current=queue[cursor++];queued.delete(current);
    for(const {to,predicate} of edges.get(current).values())propagate(current,to,predicate);
    for(const edge of gates.get(current)??[]){charge();propagate(edge.from,edge.to,edge.predicate);}
    for(const call of methodCalls)if(call.receiver===current)for(const actual of nodes.get(current).actual) {
      charge();if(call.receivers.has(actual))continue;
      call.receivers.add(actual);
      // Receiver facts precede argument evaluation. Dispatch requires normal
      // completion of all operands, including ignored extra arguments.
      flow.publish(call.id,()=>{
        const target=actualMethod(actual,call);
        if(!target){insert(call.id,'pending','unresolved-actual-method:'+actual+':'+call.member);return;}
        call.targets.set(actual,target.id);
        // Each dispatch arm receives only its selected actual receiver.
        insert(binding(target,target.parameters[0].id,target.parameters[0].type),'actual',actual);
        target.parameters.slice(1).forEach((parameter,index)=>{
          if(index<call.arguments.length)copy(call.arguments[index],binding(target,parameter.id,parameter.type));
          else insert(call.id,'pending','method-argument-default-domain:'+target.id+':'+index);
        });
        if(types.get(target.returnType.id).kind==='void')flow.when(flow.returned(target.id),()=>insert(call.id,'actual',target.returnType.id));
        else copy(returned(target),call.id);
      });
    }
    for(const read of reads)if(read.receiver===current) {
      if(!arrayReaching)for(const allocation of nodes.get(current).owners)copy(owners.get(allocation),read.result);
      else {
        const ordered=arrayReads.get(read.result);
        const proven=ordered?.status==='proven';
        const sources=proven?ordered.sources:arrayReaching.normalReadSources?.get(read.result);
        if(sources)for(const source of sources)copy(source,read.result,proven?null:{payloadOnly:true});
        // A definite bounds failure has no normal payload or unresolved source.
        else if(ordered?.status!=='missing')insert(read.result,'pending','unproved-ordered-array-read:'+read.result);
      }
    }
    for(const store of stores)if(store.receiver===current)for(const allocation of nodes.get(current).owners)
      copy(store.value,owners.get(allocation),store.whenAbsent?{gate:store.whenAbsent}:null);
    for(const read of fieldReads)if(read.receiver===current)for(const actual of nodes.get(current).actual) {
      const field=actualField(actual,read.field,read.viewType);
      if(field?.missing){read.targets.set(actual,field);insert(read.result,'actual',undefinedId);}
      else if(field){read.targets.set(actual,field);
        const reaching=refinements.get(read.id)?.find(row=>row.actualType===actual&&row.field===field.id);
        if(reaching) {
          for(const source of reaching.sources)copy(source,read.result);
          if(reaching.intrinsics?.includes('undefined'))insert(read.result,'actual',undefinedId);
        }
        else copy(fieldNode(actual,field),read.result);}
      else insert(read.result,'pending','unresolved-actual-field:'+actual+':'+read.field);
    }
    for(const store of fieldStores)if(store.receiver===current)for(const actual of nodes.get(current).actual) {
      const field=actualField(actual,store.field,store.viewType);
      if(field&&!field.missing){store.targets?.set(actual,field);
        const commit=()=>copy(store.value,fieldNode(actual,field));
        if(store.gate)flow.when(store.gate,commit);else commit();}
      else insert(store.value,'pending','unresolved-actual-field:'+actual+':'+store.field);
    }
    for(const test of presenceTests)if(test.receiver===current)for(const actual of nodes.get(current).actual) {
      const field=actualField(actual,test.field,test.viewType);
      if(field)test.targets.set(actual,field);else insert(test.id,'pending','unresolved-actual-field:'+actual+':'+test.field);
    }
  }
  const domains=new Map();
  function domain(actual) {
    const alternatives=[...actual].sort(),id=domainId(alternatives);
    if(!domains.has(id))domains.set(id,representationDomain(id,alternatives,types,physical));
    return id;
  }
  const resultNodes=[...nodes.values()].map(row=>{
    const carrier=representationOnly?.get(row.id);
    return {id:row.id,viewType:row.viewType,domainId:domain(carrier&&!row.actual.size?new Set([carrier]):row.actual),
      arrayOwners:[...row.owners].sort(),pending:[...row.pending].sort()};
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  // These canonical intermediate carriers serve compiler-derived presence
  // tests/refinements, not new actual seeds or fabricated Source literals.
  for(const input of presenceCarriers){let remaining=[...nodes.get(input).actual].sort();
    for(const type of remaining.filter(absent)){charge();domain(new Set([type]));remaining=remaining.filter(id=>id!==type);domain(new Set(remaining));}}
  const byId=new Map(resultNodes.map(row=>[row.id,row]));
  const abi=callables.map(fn=>{
    const parameters=fn.parameters.map(parameter=>byId.get(binding(fn,parameter.id,parameter.type)).domainId);
    const result=fn.role==='construction-body'||types.get(fn.returnType.id).kind==='void'?null:byId.get(returned(fn)).domainId;
    return {functionId:fn.id,parameters,result,id:boundId(parameters,result)};
  });
  const published=hir.exports.map(row=>{
    const fn=functions.get(row.functionId),contract=abi.find(value=>value.functionId===fn.id);
    const value={functionId:fn.id,sourceSignature:fn.signatureHash,closureIdentity:hir.inputIdentity,
      parameterBounds:contract.parameters,resultBound:contract.result,abi:contract.id};
    return {...value,id:publishedId(value)};
  });
  const calls=methodCalls.map(call=>({id:call.id,member:call.member,viewType:call.viewType,
    targets:[...call.targets].sort(([a],[b])=>a<b?-1:1).map(([actualType,functionId])=>({actualType,functionId,
      signatureHash:functions.get(functionId).signatureHash,abi:abi.find(row=>row.functionId===functionId).id}))}));
  const fields=[...fieldReads.map(row=>({...row,kind:'read'})),...fieldStores.filter(row=>row.id).map(row=>({...row,kind:'store'})),
    ...presenceTests.map(row=>({...row,kind:'presence'}))]
    .map(row=>({id:row.id,kind:row.kind,member:row.field,viewType:row.viewType,
      targets:[...row.targets].sort(([a],[b])=>a<b?-1:1).map(([actualType,field])=>field.missing
        ?{actualType,missing:true,fieldType:undefinedId}:{actualType,fieldId:field.id,fieldType:field.type})}));
  return own({family:mode==='definition'?'tsfg.finite-definition-bounds-development':'tsfg.finite-actual-domains-development',version:1,
    inputIdentity:hir.inputIdentity,...(mode==='definition'?{definitionSeeds}:{}),published,aliases,calls,fields,allocations,intrinsics,
    domains:[...domains.values()].sort((a,b)=>a.id<b.id?-1:1),nodes:resultNodes,expressions,abi});
}
