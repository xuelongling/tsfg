// SPDX-License-Identifier: MIT
// Fixed upper consumption and ordinary control completions share one owned
// Program. Language throws are routed structurally; request traps never enter EH.
import {commonCheck as check,canonical,sha256} from './common-program-common.mjs';
import {commonCollections,commonSortedSubset} from './common-program-budget.mjs';
import {commonTargets} from './common-program-targets.mjs';
import {commonHostResources} from './common-program-hosts.mjs';
import {commonMethods} from './common-program-methods.mjs';
export const commonFacets=Object.freeze(['allocation','managedReference','ehControl','mayThrow','await','lock','escape','unknownHost']);
// One containment boundary shared by admitted publication verification and
// typed effect-domain regressions. This is the former analysis.covers body.
export function commonEffectsCover(upper,body,spend) {
  const flags=['read','write','structural'];
  spend(commonFacets.length+body.parameters.length*flags.length);
  spend(upper.captures.length+body.captures.length*flags.length);const captures=new Map(upper.captures.map(row=>[row.slot,row]));
  return body.captures.every(row=>captures.has(row.slot)&&flags.every(flag=>!row[flag]||captures.get(row.slot)[flag]))&&commonSortedSubset(body.globals.reads,upper.globals.reads,spend)&&commonSortedSubset(body.globals.writes,upper.globals.writes,spend)
    &&commonSortedSubset(body.hostResources.reads,upper.hostResources.reads,spend)&&commonSortedSubset(body.hostResources.writes,upper.hostResources.writes,spend)
    &&commonFacets.every(flag=>!body.facets[flag]||upper.facets[flag])
    &&body.parameters.every((row,index)=>flags.every(flag=>!row[flag]||upper.parameters[index][flag]));
}
export function commonEffects(hir,spend,physical=null) {
  const collections=commonCollections(spend);
  spend(hir.types.length+hir.functions.length+hir.globals.length);
  const types=new Map(hir.types.map(row=>[row.id,row])),functions=new Map(hir.functions.map(row=>[row.id,row]));
  const globals=new Map(hir.globals.map(row=>[row.id,row])),referenceMemo=new Map(),methods=commonMethods(hir,spend),callables=physical?.model.callables??commonTargets(hir,spend),slots=new Map();
  // Internal Source summaries are not Published contracts. Pre-register every
  // implicit construction before traversing any initializer, then use the
  // existing finite effect transfer and its one shared meter for their SCCs.
  const constructors=new Map(),internal=new Map(),voidId=sha256('tsfg.type\0void');
  for(const type of hir.types){spend();const ctor=type.construction;
    if(!ctor||!['reference','value'].includes(type.kind)||ctor.kind==='explicit')continue;
    spend(ctor.id.length+ctor.parameters.length+128);const id='analysis-construction:'+ctor.id;
    const parameters=ctor.parameters.map((parameter,index)=>{spend(id.length+32);return {id:id+'/parameter/'+index,type:parameter.type,range:parameter.origin};}),
      range={start:ctor.origin.start,end:ctor.origin.end},body=[];
    if(type.base){if(!types.has(voidId)){spend();types.set(voidId,{id:voidId,kind:'void',name:'void'});}
      spend(parameters.length);body.push({kind:'expression',range,value:{kind:'superConstruct',type:voidId,callee:type.base,
      construction:types.get(type.base).construction.id,range,arguments:parameters.map(parameter=>({kind:'bindingReference',binding:parameter.id,type:parameter.type,range}))}});}
    const owner={id,kind:'construction-body',analysisOnly:true,ownerType:type.id,receiverBinding:'analysis-receiver:'+id,parameters,
      bindings:[],captures:[],body,returnType:type.id,sourcePath:ctor.origin.source,range};
    check(!functions.has(id),'identity','internal construction effect identity collides with public function');
    constructors.set(type.id,owner);internal.set(id,owner);functions.set(id,owner);
  }
  for(const env of hir.environments)for(const slot of env.slots){spend();slots.set(slot.binding,slot);}
  function reference(id,active=new Set()) {
    if(id===null||id==='void')return false;
    spend();if(referenceMemo.has(id))return referenceMemo.get(id);check(!active.has(id),'type');active.add(id);
    const t=types.get(id);check(t,'type');const result=['unknown','reference','array','readSpan','string'].includes(t.kind)
      ||t.kind==='union'&&t.members.some(id=>reference(id,collections.set(active)))
      ||t.kind==='value'&&t.fields.some(field=>reference(field.type,collections.set(active)));
    referenceMemo.set(id,result);return result;
  }
  const ownerParameters=fn=>{spend(fn.parameters.length+1);return [...(fn.ownerType?[{id:fn.receiverBinding,type:fn.ownerType}]:[]),...fn.parameters];};
  const hostResources=commonHostResources(hir.hostContext),hosts=new Map(hir.hostImports.map(row=>[row.id,row]));
  const blank=fn=>({captures:[],globals:{reads:[],writes:[]},hostResources:{reads:[],writes:[]},parameters:ownerParameters(fn).map((_,index)=>({index,read:false,write:false,structural:false})),
    facets:Object.fromEntries(commonFacets.map(flag=>[flag,false]))});
  function deriveBody(fn,records,diagnostics=false,internalEvidence=new Map()) {
    const result=blank(fn),read=new Set(),write=new Set(),hostRead=new Set(),hostWrite=new Set(),hostCalls=[],params=ownerParameters(fn),origins=new Map(),calls=[],captures=new Map();
    const local=diagnostics?new Map():null,activeConstructions=new Set();let operationSource=fn.sourcePath,currentReceiver=null;
    if(fn.analysisOnly)activeConstructions.add(fn.ownerType);
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
    for(const row of fn.captures??[]){spend();const slot=slots.get(row.binding);capture(slot.key,{read:row.read,write:row.write,structural:false},{kind:'function',operation:'capture',range:fn.range});
      origins.set(row.binding,new Set(['c:'+slot.key]));}
    if(fn.activationEnvironment){facet('allocation','function','activationEnvironment',fn.range);facet('managedReference','function','activationEnvironment',fn.range);}
    if(fn.lexicalEnvironment)facet('managedReference','function','lexicalEnvironment',fn.range);
    if(!diagnostics){result.facets.managedReference ||= physical?.references.get(fn.id)??false;result.facets.escape=physical?.escaping.get(fn.id)??false;}
    params.forEach((p,index)=>{spend();
      // Source views do not establish a primitive payload. Ordinary logical
      // parameters always keep their owner roots. A constructor's hidden
      // control receiver is never an input object/permission root: a base
      // allocates fresh data, while derived this starts unbound.
      const frame=fn.kind==='construction-body'&&p.id===fn.receiverBinding;
      if(frame){const type=types.get(fn.ownerType),roots=new Set();
        if(!type.base){spend(type.construction.id.length+6);roots.add('local:'+type.construction.id);}origins.set(p.id,roots);
      }else origins.set(p.id,new Set(['p:'+index]));
    });
    if(reference(fn.returnType)||params.some(p=>reference(p.type)))facet('managedReference','function','signature',fn.range);
    const mergeFacets=facets=>{for(const key of commonFacets)if(key!=='mayThrow')result.facets[key] ||= facets[key];};
    const mark=(set,flag,value=null)=>{for(const origin of set){spend();if(origin.startsWith('g:'))(flag==='read'?read:write).add(origin.slice(2));
      if(origin.startsWith('p:'))result.parameters[Number(origin.slice(2))][flag]=true;
      if(origin.startsWith('c:'))capture(origin.slice(2),{[flag]:true},value&&{kind:'operation',operation:value.kind,range:value.range});}};
    const union=sets=>{const result=new Set();for(const values of sets)for(const value of values){spend();result.add(value);}return result;};
    const mergeOrigins=(a,b)=>{for(const [id,values]of b){spend();a.set(id,union([a.get(id)??new Set(),values]));}};
    function expression(value,environment=origins) {
      spend();let throwing=false,owner=new Set();
      const visit=child=>{const result=expression(child,environment);throwing ||= result.throwing;return result.owner;};
      const touch=()=>{if(reference(value.type))facet('managedReference','operation',value.kind,value.range);};touch();
      if(['bindingReference','bindingTarget','thisReference'].includes(value.kind))owner=value.kind==='thisReference'&&currentReceiver!==null?currentReceiver:environment.get(value.kind==='thisReference'?fn.receiverBinding:value.binding)??new Set();
      else if(['globalReference','globalTarget'].includes(value.kind)){
        check(globals.has(value.global),'identity');owner=new Set(['g:'+value.global]);if(value.kind==='globalReference')read.add(value.global);
      }else if(['parentheses','as','nonNull'].includes(value.kind))owner=visit(value.expression);
      else if(value.kind==='arrayLiteral'){
        value.elements.forEach(visit);facet('allocation','operation',value.kind,value.range);facet('managedReference','operation',value.kind,value.range);owner=new Set(['local:'+value.allocationSite]);
      }else if(['fieldAccess','fieldTarget','checkedElementAccess','elementTarget','arrayLength','readSpanLength','lengthTarget'].includes(value.kind)){
        owner=visit(value.receiver);if(value.index)visit(value.index);
        if(['fieldAccess','checkedElementAccess','arrayLength','readSpanLength'].includes(value.kind))mark(owner,'read',value);
      }else if(['bindingAssignment','elementAssignment','elementCompoundAssignment','lengthAssignment','fieldAssignment','bindingUpdate','elementUpdate','fieldUpdate'].includes(value.kind)) {
        const selected=visit(value.target);if(value.operator!=='=')mark(selected,'read',value);
        const assigned=value.value?visit(value.value):new Set();mark(selected,'write',value);
        if(value.kind==='lengthAssignment'||value.kind.startsWith('element'))mark(selected,'structural',value);
        if(value.target.binding&&!value.target.global&&value.operator==='=')environment.set(value.target.binding,assigned);owner=assigned;
      }else if(value.kind==='new'||value.kind==='superConstruct') {
        const arguments_=value.arguments.map(visit),type=types.get(value.kind==='new'?value.type:value.callee);check(type,'type');
        if(type.kind==='reference'){facet('allocation','operation',value.kind,value.range);facet('managedReference','operation',value.kind,value.range);}
        owner=new Set(['local:'+(value.allocationSite??value.construction)]);
        spend(arguments_.length+1);const supplied=[owner,...arguments_];
        // A complete Construct can select an explicit replacement. Its fixed
        // upper bounds every external root the current implementation may
        // return, even when the present body returns only the fresh receiver.
        // This conservative Source-owner union is not an actual tag/object.
        const selectedFrom=(input,upper)=>{
          // Views/assertions preserve payload owners. The v2 permission
          // contract supplies no independent primitive-result proof with
          // which to discard an argument, global or capture owner here.
          spend(input.length+upper.globals.reads.length+upper.captures.length+1);const roots=new Set();
          for(const id of upper.globals.reads){spend(id.length+2);roots.add('g:'+id);}
          for(const row of upper.captures){spend(row.slot.length+2);roots.add('c:'+row.slot);}
          return union([...input,roots]);
        };
        // Mirror the actual construct chain: an explicit derived body owns its
        // super call; an implicit hop forwards the already-evaluated arguments.
        const construct=current=>{
          spend();const explicit=current.construction.functionId;
          if(explicit){
            // A base's own initializer may construct that same explicit base.
            // Close this inline backedge while still consuming its fixed public
            // contract below; the current constructor body cannot narrow it.
            if(!current.base&&!activeConstructions.has(current.id)){
              activeConstructions.add(current.id);throwing=initialize(current,supplied,environment)||throwing;activeConstructions.delete(current.id);
            }
            const called=consume(explicit,supplied,value);throwing ||= called.facets.mayThrow;return selectedFrom(supplied,called);
          }
          if(activeConstructions.has(current.id)){
            const target=constructors.get(current.id)?.id;check(target,'construction');
            const called=consume(target,supplied,value);throwing ||= called.facets.mayThrow;return selectedFrom(supplied,called);
          }
          activeConstructions.add(current.id);const selected=current.base?construct(types.get(current.base)):supplied[0];
          spend(arguments_.length+1);throwing=initialize(current,[selected,...arguments_],environment)||throwing;activeConstructions.delete(current.id);return selected;
        };
        owner=construct(type);
        if(value.kind==='superConstruct'){
          environment.set(fn.receiverBinding,owner);
          spend(fn.parameters.length+1);
          throwing=initialize(types.get(fn.ownerType),[owner,...fn.parameters.map(parameter=>environment.get(parameter.id)??new Set())],environment)||throwing;
        }
      }else if(value.kind==='indirectCall'){
        visit(value.expression);const arguments_=value.arguments.map(visit),targets=callables.site(fn.id,value.range);
        if(targets.top||!targets.functions.length){facet('unknownHost','operation',value.kind,value.range);throwing=true;}
        for(const target of targets.functions){spend();const record=consume(target,arguments_,value);throwing ||= record.facets.mayThrow;}
        if(reference(value.type)){for(const target of targets.functions){spend();owner.add('unknown:'+target);}if(targets.top||!targets.functions.length)owner.add('unknown:indirect');}
      }else if(value.kind==='hostCall'){
        value.arguments.forEach(visit);check(hosts.has(value.callee)&&hir.hostContext,'host-context');
        for(const resource of hostResources){spend();hostRead.add(resource);hostWrite.add(resource);for(const access of ['read','write'])witness({kind:'host-resource',resource,access},'operation',value.kind,value.range);}
        hostCalls.push({functionId:fn.id,hostId:value.callee,sourcePath:operationSource,range:value.range});
      }else if(value.kind==='call') {
        const arguments_=[...(value.receiver?[visit(value.receiver)]:[]),...value.arguments.map(visit)];
        if(value.callee==='intrinsic:readSpan')owner=arguments_[0];
        else {const callee=functions.get(value.callee),targets=callee?.kind==='method'?methods.dispatch(callee.id,value.receiver.type):[{target:value.callee}];
          const consumed=new Set();for(const {target}of targets){spend();if(consumed.has(target))continue;consumed.add(target);
            const record=consume(target,arguments_,value);throwing ||= record.facets.mayThrow;}
          if(reference(value.type))owner=new Set(['unknown:'+value.callee]);}
      }else {
        for(const key of ['expression','left','right','receiver','index','value'])if(value[key])visit(value[key]);
        if(value.kind==='stringConcat'){facet('allocation','operation',value.kind,value.range);facet('managedReference','operation',value.kind,value.range);}
      }
      return {owner,throwing};
    }
    function consume(id,args,value) {
      spend();const callee=functions.get(id),upper=records.get(id);check(callee&&upper,'publication','missing complete function contract');
      if(internal.has(id)){
        const evidence=internalEvidence.get(id);check(evidence,'construction');spend(evidence.calls.length+evidence.hostCalls.length);
        for(const call of evidence.calls)calls.push({...call,functionId:fn.id});for(const host of evidence.hostCalls)hostCalls.push({...host,functionId:fn.id});
      }else calls.push({functionId:fn.id,target:id,range:value.range,kind:value.kind,sourcePath:operationSource});
      mergeFacets(upper.facets);for(const row of upper.captures){spend();capture(row.slot,row);}
      upper.hostResources.reads.forEach(id=>{spend();hostRead.add(id);});upper.hostResources.writes.forEach(id=>{spend();hostWrite.add(id);});
      upper.globals.reads.forEach(id=>{spend();read.add(id);});upper.globals.writes.forEach(id=>{spend();write.add(id);});
      for(const p of upper.parameters)for(const flag of ['read','write','structural'])if(p[flag])mark(args[p.index]??new Set(),flag);
      return upper;
    }
    function body(rows,environment=origins,escapingThrows=null) {
      let completions=new Set(['normal']);
      for(const row of rows) {
        spend();if(!completions.has('normal'))break;completions.delete('normal');let current=new Set(['normal']);const rowThrows=local?new Map():null;
        const inspect=value=>expression(value,environment),possibleThrow=result=>{if(result.throwing)current.add('throw');return result.owner;};
        if(['constDeclaration','letDeclaration','initialize'].includes(row.kind)) {
          const assigned=possibleThrow(inspect(row.initializer));environment.set(row.binding,assigned);if(row.global)write.add(row.global);
        }else if(row.kind==='expression')possibleThrow(inspect(row.value));
        else if(row.kind==='return') {
          if(row.value){const assigned=possibleThrow(inspect(row.value));if(reference(fn.returnType))facet('escape','operation',row.kind,row.range);if(types.get(fn.returnType)?.kind==='readSpan')
            check(!collections.array(assigned).some(owner=>owner.startsWith('local:')||owner.startsWith('unknown:')),'readspan-return-escape',undefined,{primary:{sourceId:fn.sourcePath,...row.range}});}
          current.delete('normal');current.add('return');
        }else if(row.kind==='throw') {
          possibleThrow(inspect(row.value));facet('ehControl','operation',row.kind,row.range);current=new Set(['throw']);
          if(rowThrows){const origin={kind:'operation',functionId:fn.id,source:{sourceId:operationSource,...row.range},operation:row.kind};rowThrows.set(canonical(origin),origin);}
        }else if(row.kind==='block')current=body(row.body,collections.map(environment),rowThrows);
        else if(row.kind==='if') {
          const condition=inspect(row.condition);const yes=collections.map(environment),no=collections.map(environment);
          current=union([body(row.then,yes,rowThrows),body(row.else,no,rowThrows)]);mergeOrigins(environment,yes);mergeOrigins(environment,no);if(condition.throwing)current.add('throw');
        }else if(row.kind==='while') {
          const condition=inspect(row.condition),loop=collections.map(environment),loopCompletions=body(row.body,loop,rowThrows);mergeOrigins(environment,loop);
          current=union([new Set(['normal']),new Set([...loopCompletions].filter(c=>c!=='normal'))]);if(condition.throwing)current.add('throw');
        }else if(row.kind==='try') {
          facet('ehControl','operation',row.kind,row.range);const attempted=collections.map(environment);current=body(row.tryBlock.body,attempted,rowThrows);mergeOrigins(environment,attempted);
          if(row.catchClause&&current.delete('throw')) {
            const caught=collections.map(environment);if(row.catchClause.binding)caught.set(row.catchClause.binding.id,new Set(['unknown:catch']));
            rowThrows?.clear();current=union([current,body(row.catchClause.block.body,caught,rowThrows)]);mergeOrigins(environment,caught);
          }
          if(row.finallyBlock) {
            const final=collections.map(environment),finalThrows=local?new Map():null,completed=body(row.finallyBlock.body,final,finalThrows);mergeOrigins(environment,final);
            if(!completed.has('normal'))rowThrows?.clear();if(rowThrows)for(const [key,origin]of finalThrows)rowThrows.set(key,origin);
            current=union([completed.has('normal')?current:new Set(),new Set([...completed].filter(c=>c!=='normal'))]);
          }
        }
        completions=union([completions,current]);
        if(escapingThrows&&current.has('throw'))for(const [key,origin]of rowThrows)escapingThrows.set(key,origin);
      }
      return completions;
    }
    function initialize(current,supplied,environment){
      spend(current.fields.length+current.construction.parameters.length+environment.size);const fields=new Map(current.fields.map(field=>[field.id,field])),selected=new Map(environment);
      for(const [index,parameter]of current.construction.parameters.entries()){spend();selected.set(parameter.symbol,supplied[index+1]??new Set());}
      const previousReceiver=currentReceiver,previousSource=operationSource;currentReceiver=supplied[0];let throwing=false;
      for(const id of current.construction.initializationFields){spend();const field=fields.get(id);check(field,'identity');
        operationSource=field.origin.source;
        if(field.initializer){const evaluated=expression(field.initializer,selected);throwing=evaluated.throwing||throwing;}
        // Every own field is defined, including parameter properties and
        // default undefined. Initializer expression effects cannot account
        // for this separate write to a possibly pre-existing replacement.
        mark(supplied[0]??new Set(),'write',{kind:'initialize_field',range:field.origin});}
      currentReceiver=previousReceiver;operationSource=previousSource;return throwing;
    }
    const throws=local?new Map():null,entryThrow=fn.analysisOnly&&!types.get(fn.ownerType).base
      ?initialize(types.get(fn.ownerType),params.map(parameter=>origins.get(parameter.id)??new Set()),origins):false,
      completions=body(fn.body,origins,throws);if(entryThrow)completions.add('throw');result.facets.mayThrow=completions.has('throw');
    if(local&&result.facets.mayThrow)for(const origin of throws.values())retain({kind:'facet',facet:'mayThrow'},origin);
    result.captures=collections.sorted(captures.values(),(a,b)=>a.slot<b.slot?-1:a.slot>b.slot?1:0);
    result.globals={reads:collections.sorted(read),writes:collections.sorted(write)};result.hostResources={reads:collections.sorted(hostRead),writes:collections.sorted(hostWrite)};return {upper:result,calls,hostCalls,completions:collections.sorted(completions),local};
  }
  const equalText=(a,b)=>{spend(a.length+b.length+1);return a===b;};
  const equalIds=(a,b)=>{
    spend();if(a.length!==b.length)return false;
    for(let index=0;index<a.length;index++)if(!equalText(a[index],b[index]))return false;return true;
  };
  function equalUpper(a,b){
    // These are typed upper rows. Compare their actual fields, without JSON
    // text expansion, escaped-string estimates, key sorting or allocation.
    spend(commonFacets.length);if(commonFacets.some(flag=>a.facets[flag]!==b.facets[flag]))return false;
    for(const part of ['globals','hostResources'])for(const access of ['reads','writes'])if(!equalIds(a[part][access],b[part][access]))return false;
    spend(2);if(a.parameters.length!==b.parameters.length||a.captures.length!==b.captures.length)return false;
    for(let index=0;index<a.parameters.length;index++){spend(5);const x=a.parameters[index],y=b.parameters[index];
      if(x.index!==y.index||x.read!==y.read||x.write!==y.write||x.structural!==y.structural)return false;}
    for(let index=0;index<a.captures.length;index++){spend(4);const x=a.captures[index],y=b.captures[index];
      if(!equalText(x.slot,y.slot)||x.read!==y.read||x.write!==y.write||x.structural!==y.structural)return false;}
    return true;
  }
  function equalEvidence(a,b){
    for(const part of ['calls','hostCalls']){spend();if(a[part].length!==b[part].length)return false;
      for(let index=0;index<a[part].length;index++){spend(3);const x=a[part][index],y=b[part][index];
        if(!equalText(x.functionId,y.functionId)||!equalText(x.target??x.hostId,y.target??y.hostId)
          ||!equalText(x.kind??'',y.kind??'')||!equalText(x.sourcePath,y.sourcePath)
          ||x.range.start!==y.range.start||x.range.end!==y.range.end)return false;}}
    return true;
  }
  function copyUpper(upper){
    // Snapshot/freeze visits typed fields and array entries; strings are
    // immutable references here, not serialized/copied/escaped text.
    spend(8+commonFacets.length*2+upper.parameters.length*5+upper.captures.length*5);
    const ids=values=>{spend(values.length*2+1);return Object.freeze([...values]);};
    return Object.freeze({globals:Object.freeze({reads:ids(upper.globals.reads),writes:ids(upper.globals.writes)}),
      hostResources:Object.freeze({reads:ids(upper.hostResources.reads),writes:ids(upper.hostResources.writes)}),
      parameters:Object.freeze(upper.parameters.map(row=>Object.freeze({index:row.index,read:row.read,write:row.write,structural:row.structural}))),
      captures:Object.freeze(upper.captures.map(row=>Object.freeze({slot:row.slot,read:row.read,write:row.write,structural:row.structural}))),
      facets:Object.freeze(Object.fromEntries(commonFacets.map(flag=>[flag,upper.facets[flag]])))});
  }
  function solve(records,publicOwners=[]){
    spend(records.size+internal.size*2);const rows=new Map(records),evidence=new Map();
    for(const [id,owner]of internal){rows.set(id,blank(owner));evidence.set(id,{calls:[],hostCalls:[]});}
    const distinct=values=>{
      spend(values.length);const selected=new Map();for(const value of values){
        spend(256);for(const text of [value.functionId,value.target??value.hostId,value.kind??'',value.sourcePath])spend(text.length*32+64);
        const key=canonical(value);if(!selected.has(key))selected.set(key,value);
      }
      return collections.sorted(selected,([a],[b])=>{spend(a.length+b.length+1);return a<b?-1:a>b?1:0;}).map(([,value])=>value);
    };
    // Authoring includes public and generated owners in the same finite domain.
    // Fixed consumption leaves every supplied public row unchanged and visits
    // only generated owners. Neither mode restarts them for each public body.
    spend(internal.size+publicOwners.length);const owners=[...internal.values(),...publicOwners];
    let changed;do{changed=false;for(const owner of owners){spend();const id=owner.id,next=deriveBody(owner,rows,false,evidence);
      const different=!equalUpper(rows.get(id),next.upper);
      if(internal.has(id)){
        const detail={calls:distinct(next.calls),hostCalls:distinct(next.hostCalls)};
        if(different||!equalEvidence(evidence.get(id),detail)){rows.set(id,next.upper);evidence.set(id,detail);changed=true;}
      }else if(different){rows.set(id,next.upper);changed=true;}
    }}while(changed);
    return {uppers:rows,evidence};
  }
  function fixed(records){
    // The batch owns a value snapshot, not a cache keyed by mutable Map identity.
    // A caller must create a new batch after replacing any fixed contract.
    spend(records.size);const snapshot=new Map();
    for(const [id,upper]of records){spend(id.length+1);snapshot.set(id,copyUpper(upper));}
    const closed=solve(snapshot);
    return Object.freeze({derive:(fn,diagnostics=false)=>deriveBody(fn,closed.uppers,diagnostics,closed.evidence)});
  }
  function derive(fn,records,diagnostics=false){return fixed(records).derive(fn,diagnostics);}
  function derived() {
    spend(hir.functions.length);const rows=new Map(hir.functions.map(fn=>[fn.id,blank(fn)])),closed=solve(rows,hir.functions);
    spend(hir.functions.length);return new Map(hir.functions.map(fn=>[fn.id,closed.uppers.get(fn.id)]));
  }
  return {reference,ownerParameters,blank,fixed,derive,derived,types,functions,globals};
}
