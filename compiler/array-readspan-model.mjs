// SPDX-License-Identifier: MIT
// Typed borrow families consume the exact Source-order owner trace and fixed table.
import {canonical,own,sha256} from './identity.mjs';
import {arrayAnalysisTypes,arrayReferenceBinding} from './array-analysis-types.mjs';
import {parameterArrayOwner} from './array-owner-trace.mjs';
import {finiteCallables} from './finite-callables.mjs';

function failure(diagnostic) {
  const checked=own(diagnostic);throw Object.freeze(Object.assign(new TypeError(checked.message),checked));
}
function limit() {
  failure({code:'r03-d-readspan-limit',ruleId:'r01-input-boundary',phase:'hir',message:'ReadSpan analysis exceeds work limit'});
}
export function deriveReadSpanPlan(hir,prepared) {
  let work=0;const charge=()=>{if(++work>1024)limit();},type=arrayAnalysisTypes(hir);
  const callables=finiteCallables(hir),calls=prepared.flow.calls,targets=new Map(callables.map(fn=>[fn.id,fn]));
  const exported=new Set(hir.exports.map(row=>{charge();return row.functionId;}));
  const indices=new Map(calls.map((call,index)=>[canonical([call.functionId,call.expressionPath]),index]));
  const functions=callables.map(fn=>{
    const model=prepared.ownerModel.functions.get(fn.id),families=new Map(),results=new Map(),storedFamilies=new Map(),views=[],events=[];
    for(const dependency of model.storage?.dependencies??[]){
      charge();failure({code:'r03-d-readspan-context-pending',ruleId:'r01-span',phase:'hir',functionId:fn.id,
        message:dependency.reason==='nested-writeback'?'Stored parameter context has unproved nested field writeback: '+dependency.target
          :'Stored parameter context depends on an incomplete recursive storage summary: '+dependency.target,
        primary:{sourceId:dependency.sourcePath,...dependency.range}});
    }
    for(const demand of model.storage?.demands??[]){
      charge();if(demand.failed||!demand.contexts||demand.formal&&exported.has(fn.id))
        failure({code:'r03-d-readspan-origin',ruleId:'r01-span',phase:'hir',message:'Stored parameter Span has no complete actual caller field context',
          primary:{sourceId:fn.sourcePath,...demand.range}});
    }
    const event=(operation,kind,fields)=>{
      if(events.length>=100)limit();const sequence=events.length;
      events.push({sequence,statementIndex:operation.statementIndex,expressionPath:[...operation.path],
        kind,range:{...operation.range},...fields});return sequence;
    };
    const use=(view,binding,operation,kind,fields={})=>{
      charge();if(!view)failure({code:'r03-d-readspan-origin',ruleId:'r01-span',phase:'hir',
        message:'ReadSpan use has no proven live family',primary:{sourceId:fn.sourcePath,...operation.range}});
      const sequence=event(operation,kind,{viewId:view.viewId,binding,...fields});
      if(view.useEvents.at(-1)!==sequence){if(view.useEvents.length>=50)limit();view.useEvents.push(sequence);}
      view.lastUseEvent=sequence;return sequence;
    };
    const family=(value,path)=>{
      const stored=model.storage?.reads.get(canonical(path));
      // An unresolved current field version cannot fall back to a stale
      // lexical alias family from before an unknown selected-target write.
      if(stored?.pending)return [];
      if(stored&&!stored.pending){const possible=[];
        for(const source of stored.sources){charge();const view=storedFamilies.get(source.id);if(view)possible.push(view);else return [];}
        if(possible.length)return [...new Set(possible)];}
      if(value.kind==='reference')return families.get(value.binding)??[];
      if(['group','assertType','nonNull'].includes(value.kind))return family(value.operand,[...path,'operand']);
      if(value.kind==='assignment')return family(value.value,[...path,'value']);
      return results.get(canonical(path))??[];
    };
    const returnedCall=(value,path)=>{
      while(['group','assertType','nonNull'].includes(value.kind)){value=value.operand;path=[...path,'operand'];}
      const callIndex=value.kind==='call'?indices.get(canonical([fn.id,path])):undefined;
      return {callIndex,returned:callIndex===undefined?null:calls[callIndex].returnedView};
    };
    const create=(operation,kind,owner,fields={})=>{
      charge();if(views.length>=40)limit();
      const viewId=sha256('tsfg.readspan.typed-family.v1\0'+canonical({functionId:fn.id,expressionPath:operation.path,range:operation.range,kind,...fields}));
      const createEvent=event(operation,kind==='callResult'?'view-call-result-create-complete':'view-create-complete',
        {viewId,binding:null,...fields});
      const view={viewId,binding:null,owner,origin:{kind,createEvent},aliases:[],useEvents:[],lastUseEvent:createEvent};
      views.push(view);results.set(canonical(operation.path),[view]);return view;
    };
    fn.parameters.forEach((parameter,index)=>{
      if(!type.isView(parameter.type))return;charge();
      const viewId=sha256('tsfg.readspan.parameter-view.v1\0'+canonical({functionId:fn.id,bindingId:parameter.id,index,parameterRange:parameter.range}));
      const view={viewId,binding:parameter.id,owner:parameterArrayOwner(fn,index),origin:{kind:'parameter',index,range:{...parameter.range}},
        aliases:[],useEvents:[],lastUseEvent:null};views.push(view);families.set(parameter.id,[view]);
      storedFamilies.set('parameter/'+fn.id+'/'+index,view);
    });
    for(const operation of model.operations) {
      if(operation.kind==='viewCreate'){
        const view=create(operation,'local',operation.owner);storedFamilies.set(fn.id+'@'+canonical(operation.path),view);
      }
      else if(operation.kind==='read') {
        const value=operation.value;
        if(type.isView(value.receiver.type)) {
          const possible=family(value.receiver,[...operation.path,'receiver']);
          if(!possible.length&&model.storage?.deferred.has(canonical([...operation.path,'receiver'])))continue;
          if(!possible.length)use(undefined,null,operation,'view-read-complete');
          for(const view of possible)use(view,arrayReferenceBinding(value.receiver),operation,
            value.kind==='readSpanLength'?'view-length-complete':'view-read-complete');
        }
      }else if(operation.kind==='call') {
        const {call}=operation,callIndex=indices.get(canonical([fn.id,operation.path]));
        const storedUses=[];
        for(const row of model.storage?.callEvents.get(canonical(operation.path))??[]){
          charge();const at={...operation,path:row.path,range:row.range};
          if(row.kind==='effect'){
            if(!row.structural)continue;
            event(at,'view-stored-call-structural',{owner:row.owner,sourcePath:row.sourcePath});
          }else{
            if(row.evidence.pending||!row.evidence.sources.length)use(undefined,null,at,'view-stored-call-use');
            for(const source of row.evidence.sources){
              charge();const view=storedFamilies.get(source.id);
              use(view,null,at,'view-stored-call-use',{sourcePath:row.sourcePath});storedUses.push({view,at,sourcePath:row.sourcePath});
            }
          }
        }
        event(operation,'array-call-effect',{callIndex});
        // Fixed Published effects remain an upper bound for the entire call;
        // precise body events do not shrink it or supply an instance seed.
        for(const row of storedUses)use(row.view,null,row.at,'view-stored-call-complete',{sourcePath:row.sourcePath});
        const callee=targets.get(call.target),value=operation.value;
        const actuals=callee.ownerType?[value.receiver,...value.arguments]:value.arguments;
        const actualPath=slot=>callee.ownerType&&slot===0?[...operation.path,'receiver']
          :[...operation.path,'arguments',slot-(callee.ownerType?1:0)];
        const uses=[];
        actuals.forEach((argument,slot)=>{
          if(!argument||!type.isView(argument.type))return;charge();const possible=family(argument,actualPath(slot));
          if(!possible.length&&model.storage?.deferred.has(canonical(actualPath(slot))))return;
          if(!possible.length)failure({code:'r03-d-readspan-origin',ruleId:'r01-span',phase:'hir',message:'ReadSpan argument has no proven live family',
            primary:{sourceId:fn.sourcePath,...argument.range}});
          for(const view of possible)uses.push({index:slot,binding:arrayReferenceBinding(argument),viewId:view.viewId,range:{...argument.range}});
        });
        if(uses.length) {
          const sequence=event(operation,'view-call-complete',{callIndex,uses});
          for(const occurrence of uses) {
            const view=views.find(row=>row.viewId===occurrence.viewId);
            if(view.useEvents.at(-1)!==sequence){if(view.useEvents.length>=50)limit();view.useEvents.push(sequence);}view.lastUseEvent=sequence;
          }
        }
        if(type.isView(value.type)) {
          const returned=call.returnedView;
          if(!returned)failure({code:'r03-d-readspan-origin',ruleId:'r01-span',phase:'hir',message:'Returned ReadSpan has no exact original parameter',
            primary:{sourceId:fn.sourcePath,...value.range}});
          const parameterIndex=returned.index;
          if(type.isArray(callee.parameters[parameterIndex].type))create(operation,'callResult',returned.owner,{callIndex,parameterIndex});
          else results.set(canonical(operation.path),family(actuals[parameterIndex],actualPath(parameterIndex)));
        }
        for(const source of model.storage?.captures.values()??[]){
          charge();if(canonical(source.callPath)!==canonical(operation.path))continue;
          const existing=type.isView(value.type)?results.get(canonical(operation.path))?.[0]:null;
          const view=existing??create(operation,'callResult',source.owner,{callIndex,storageOrigin:source.storedOrigin});
          storedFamilies.set(source.id,view);
        }
      }else if(operation.kind==='binding'&&type.isView(operation.type)) {
        const possible=family(operation.value,operation.path);if(!possible.length)continue;
        const prior=operation.conditional?families.get(operation.binding)??[]:[];
        families.set(operation.binding,[...new Set([...prior,...possible])]);
        for(const view of possible) {
          if(view.binding===null&&view.origin.kind!=='parameter') {
            view.binding=operation.binding;events[view.origin.createEvent].binding=operation.binding;
          }else {
            const {callIndex,returned}=returnedCall(operation.value,operation.path);
            const initializerBinding=arrayReferenceBinding(operation.value)??returned?.binding??view.binding;
            const fields=returned?{initializerBinding,callIndex,parameterIndex:returned.index}:{initializerBinding};
            charge();const sequence=use(view,operation.binding,operation,
              returned?'view-call-result-alias-complete':'view-alias-copy-complete',fields);
            view.aliases.push({binding:operation.binding,initializerBinding,event:sequence});
          }
        }
      }else if(operation.kind==='store'||operation.kind==='resize')event(operation,
        operation.kind==='store'?'array-store-effect':'array-resize-effect',operation.proof);
      else if(operation.kind==='return') {
        if(type.isView(operation.value.type)){
          const possible=family(operation.value,operation.path);
          if(!possible.length)use(undefined,null,operation,'view-return-complete');
          const {callIndex,returned}=returnedCall(operation.value,operation.path);
          for(const view of possible)use(view,arrayReferenceBinding(operation.value)??returned?.binding??null,
            operation,'view-return-complete',{callIndex:callIndex??null,parameterIndex:returned?.index??null});
        }else {
          const evidence=model.storage?.returnReads.get(canonical(operation.path));
          if(evidence?.pending)use(undefined,null,operation,'view-storage-return-complete');
          const retained=new Set();for(const id of evidence?.retainedSources??[]){charge();retained.add(id);}
          for(const source of evidence?.sources??[]){
          charge();const view=storedFamilies.get(source.id);
          if(!view)use(undefined,null,operation,'view-storage-return-complete');
          if(!retained.has(source.id)&&prepared.ownerTools.leaves(view.owner).some(owner=>{charge();return owner.kind!=='parameter'||owner.functionId!==fn.id;}))
            failure({code:'r03-d-readspan-return-escape',ruleId:'r01-span',phase:'hir',message:'Stored ReadSpan return has no caller-owned lifetime proof',
              primary:{sourceId:fn.sourcePath,...operation.range}});
          use(view,null,operation,'view-storage-return-complete');
          }
        }
      }
    }
    const loops=[];for(const scopes of [model.loops,model.storage?.callLoops??[]])for(const scope of scopes){charge();loops.push(scope);}
    return {functionId:fn.id,views,events,loops};
  });
  return {plan:{version:5,publication:{scopeDigest:prepared.scopeDigest,publishedDigest:prepared.publishedDigest},calls,functions},work};
}
function mutuallyExclusive(left,right) {
  const n=Math.min(left.length,right.length);
  for(let i=0;i<n;i++)if(left[i]!==right[i])return left[i]==='then'&&right[i]==='else'||left[i]==='else'&&right[i]==='then'
    ||left[i-1]==='callee'&&right[i-1]==='callee'; // Selected targets of this same actual call.
  return false;
}
const prefix=(path,base)=>base.every((key,index)=>path[index]===key);
function loopBackedge(event,last,view,state) {
  const loops=state.loops.filter(loop=>prefix(event.expressionPath,loop));
  const origin=view.origin.kind==='parameter'?null:state.events[view.origin.createEvent].expressionPath;
  return loops.some(loop=>prefix(last.expressionPath,loop)&&(!origin||!prefix(origin,loop)));
}
function conflict(fn,state,event,view,owner,sourceKind,fixed={}) {
  const at=(kind,range,sourceId=fn.sourcePath)=>({kind,sourceId,...range}),last=state.events[view.lastUseEvent];
  const origin=view.origin.kind==='parameter'?view.origin.range:state.events[view.origin.createEvent].range;
  const related=[at('borrow-origin',origin)];
  const chain=[],visited=new Set();
  let binding=last.kind==='view-call-complete'?last.uses.find(use=>use.viewId===view.viewId).binding:last.binding;
  while(binding!==null&&binding!==view.binding&&!visited.has(binding)) {
    visited.add(binding);
    const alias=view.aliases.findLast(row=>row.binding===binding&&row.event<=view.lastUseEvent);
    if(!alias)break;chain.push(alias);binding=alias.initializerBinding;
  }
  for(const alias of chain.reverse())related.push(at('borrow-alias',state.events[alias.event].range));
  related.push(at('borrow-last-use',last.range,last.sourcePath));
  failure({code:'r03-d-readspan-structural-conflict',ruleId:'r01-span',phase:'hir',
    message:'active ReadSpan may overlap a structural Array operation',primary:{sourceId:event.sourcePath??fn.sourcePath,...event.range},related,
    conflict:{functionId:fn.id,operationPath:event.expressionPath,sequence:event.sequence,viewId:view.viewId,
      viewOwner:view.owner,structuralOwner:owner,lastUsePath:last.expressionPath,sourceKind,...fixed}});
}
export function consumeReadSpanPlan(hir,prepared,registrationAndUseWork) {
  let work=registrationAndUseWork;const plan=hir.readSpanPlan,callables=finiteCallables(hir);
  for(const [index,state]of plan.functions.entries()) {
    const fn=callables[index];
    const compare=(event,owner,sourceKind,fixed={})=>{
      for(const view of state.views) {
        if(view.lastUseEvent===null)continue;
        if(view.origin.kind!=='parameter'&&!(view.origin.createEvent<event.sequence))continue;
        const last=state.events[view.lastUseEvent],backedge=loopBackedge(event,last,view,state);
        if(!(event.sequence<view.lastUseEvent)&&!backedge)continue;
        if(!backedge&&mutuallyExclusive(event.expressionPath,last.expressionPath))continue;
        if(++work>1024)limit();if(prepared.ownerTools.mayAlias(view.owner,owner))conflict(fn,state,event,view,owner,sourceKind,fixed);
      }
    };
    for(const event of state.events) {
      if(event.kind==='array-call-effect') {
        const site=plan.calls[event.callIndex];
        for(const arm of site.targets) {
        const call={...site,...arm},upper=prepared.records.get(call.target).upper;
        for(const parameter of upper.parameters)if(parameter.structural) {
          const actual=call.arguments.find(argument=>argument.index===parameter.index);
          compare(event,actual.owner,'fixedCall',{target:call.target,parameterIndex:parameter.index,
            consumedDigest:call.consumedDigest,scopeDigest:plan.publication.scopeDigest,publishedDigest:plan.publication.publishedDigest});
        }
        if(upper.local.structural)compare(event,{kind:'unknown'},'fixedCallLocal',{
          target:call.target,consumedDigest:call.consumedDigest,scopeDigest:plan.publication.scopeDigest,
          publishedDigest:plan.publication.publishedDigest});
        }
      }else if(event.kind==='array-store-effect'&&!event.nonStructural)compare(event,event.owner,'directStore');
      else if(event.kind==='array-resize-effect'&&!event.nonStructural)compare(event,event.owner,'directResize');
      else if(event.kind==='view-stored-call-structural')compare(event,event.owner,'storedCall');
    }
  }
}
