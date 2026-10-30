// SPDX-License-Identifier: MIT
// Fixed upper consumption and ordinary control completions share one owned
// Program. Language throws are routed structurally; request traps never enter EH.
import {commonCheck as check,commonSame as same,canonical} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
import {commonTargets} from './common-program-targets.mjs';
import {commonHostResources} from './common-program-hosts.mjs';
import {commonMethods} from './common-program-methods.mjs';
export const commonFacets=Object.freeze(['allocation','managedReference','ehControl','mayThrow','await','lock','escape','unknownHost']);
export function commonEffects(hir,spend,physical=null) {
  const collections=commonCollections(spend);
  spend(hir.types.length+hir.functions.length+hir.globals.length);
  const types=new Map(hir.types.map(row=>[row.id,row])),functions=new Map(hir.functions.map(row=>[row.id,row]));
  const globals=new Map(hir.globals.map(row=>[row.id,row])),referenceMemo=new Map(),methods=commonMethods(hir,spend),callables=physical?.model.callables??commonTargets(hir,spend),slots=new Map();
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
  function derive(fn,records,diagnostics=false) {
    const result=blank(fn),read=new Set(),write=new Set(),hostRead=new Set(),hostWrite=new Set(),hostCalls=[],params=ownerParameters(fn),origins=new Map(),calls=[],captures=new Map();
    const local=diagnostics?new Map():null;let operationSource=fn.sourcePath;
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
      const type=types.get(slot.type),value=type?.kind==='value'||type?.kind==='union'&&type.members.some(id=>{spend();return types.get(id)?.kind==='value';});
      if(reference(slot.type)||value)origins.set(row.binding,new Set(['c:'+slot.key]));}
    if(fn.activationEnvironment){facet('allocation','function','activationEnvironment',fn.range);facet('managedReference','function','activationEnvironment',fn.range);}
    if(fn.lexicalEnvironment)facet('managedReference','function','lexicalEnvironment',fn.range);
    if(!diagnostics){result.facets.managedReference ||= physical?.references.get(fn.id)??false;result.facets.escape=physical?.escaping.get(fn.id)??false;}
    params.forEach((p,index)=>{spend();origins.set(p.id,reference(p.type)?new Set(['p:'+index]):new Set());});
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
      if(['bindingReference','bindingTarget','thisReference'].includes(value.kind))owner=environment.get(value.kind==='thisReference'?fn.receiverBinding:value.binding)??new Set();
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
        const initialize=current=>{
          spend(current.fields?.length??0);const fields=new Map((current.fields??[]).map(field=>[field.id,field]));
          for(const id of current.construction.initializationFields){spend();const field=fields.get(id);
            if(field.initializer){const previous=operationSource;operationSource=field.origin.source;visit(field.initializer);operationSource=previous;}}
        };
        // Mirror the actual construct chain: an explicit derived body owns its
        // super call; an implicit hop forwards the already-evaluated arguments.
        const construct=current=>{
          spend();if(current.construction.functionId){
            if(!current.base)initialize(current);
            const called=consume(current.construction.functionId,supplied,value);throwing ||= called.facets.mayThrow;
          }else{if(current.base)construct(types.get(current.base));initialize(current);}
        };
        construct(type);if(value.kind==='superConstruct')initialize(types.get(fn.ownerType));
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
      calls.push({functionId:fn.id,target:id,range:value.range,kind:value.kind,sourcePath:operationSource});mergeFacets(upper.facets);for(const row of upper.captures){spend();capture(row.slot,row);}
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
    const throws=local?new Map():null,completions=body(fn.body,origins,throws);result.facets.mayThrow=completions.has('throw');
    if(local&&result.facets.mayThrow)for(const origin of throws.values())retain({kind:'facet',facet:'mayThrow'},origin);
    result.captures=collections.sorted(captures.values(),(a,b)=>a.slot<b.slot?-1:a.slot>b.slot?1:0);
    result.globals={reads:collections.sorted(read),writes:collections.sorted(write)};result.hostResources={reads:collections.sorted(hostRead),writes:collections.sorted(hostWrite)};return {upper:result,calls,hostCalls,completions:collections.sorted(completions),local};
  }
  function derived() {
    const rows=new Map(hir.functions.map(fn=>[fn.id,blank(fn)]));let changed=true;
    while(changed){changed=false;for(const fn of hir.functions){spend();const next=derive(fn,rows).upper;
      if(!same(rows.get(fn.id),next)){rows.set(fn.id,next);changed=true;}}}return rows;
  }
  return {reference,ownerParameters,blank,derive,derived,types,functions,globals};
}
