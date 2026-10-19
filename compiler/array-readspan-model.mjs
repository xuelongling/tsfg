// SPDX-License-Identifier: MIT
// Complete local view provenance and last-use plan, derived only from verified owned HIR.
import { canonical, own, sha256, readSpanTypeId } from './identity.mjs';

/** @param {any} diagnostic @returns {never} */
function failure(diagnostic) {
  const checked = own(diagnostic);
  throw Object.freeze(Object.assign(new TypeError(checked.message),checked));
}
function limit() {
  failure({code:'r03-d-readspan-limit',ruleId:'r01-input-boundary',phase:'hir',
    message:'ReadSpan analysis exceeds work limit'});
}
export function deriveReadSpanPlan(hir, prepared) {
  let work = 0;
  const charge = () => { if (++work > 1024) limit(); };
  const calls = prepared.flow.calls;
  const callIndices = new Map(calls.map((call,index) => [
    canonical([call.functionId,call.expressionPath]),index,
  ]));
  const functions = hir.functions.map(fn => {
    const model = prepared.ownerModel.functions.get(fn.id);
    const families = new Map(), views = [], events = [];
    const event = (statementIndex,expressionPath,kind,range,fields) => {
      const sequence = events.length;
      events.push({sequence,statementIndex,expressionPath,kind,range:{...range},...fields});
      return sequence;
    };
    const use = (binding,kind,index,path,range,fields = {}) => {
      charge();
      const view = families.get(binding);
      const sequence = event(index,path,kind,range,{viewId:view.viewId,binding,...fields});
      view.useEvents.push(sequence); view.lastUseEvent = sequence;
      return sequence;
    };
    const read = (value,index,path) => {
      if (value?.kind === 'readSpanReadChecked')
        use(value.receiver.binding,'view-read-complete',index,path,value.range);
      else if (value?.kind === 'readSpanLength')
        use(value.receiver.binding,'view-length-complete',index,path,value.range);
    };
    for (const [index,stmt] of fn.body.entries()) {
      if (stmt.kind === 'local' && stmt.binding.type === readSpanTypeId) {
        charge();
        const init = stmt.initializer, path = ['body',index,'initializer'];
        if (init.kind === 'readSpanCreateChecked') {
          const viewId = sha256('tsfg.readspan.view.v1\0' + canonical({
            functionId:fn.id,bindingId:stmt.binding.id,createRange:init.range,
          }));
          const createEvent = event(index,path,'view-create-complete',init.range,
            {viewId,binding:stmt.binding.id});
          const view = {viewId,binding:stmt.binding.id,owner:model.bindings.get(stmt.binding.id),
            createEvent,aliases:[],useEvents:[],lastUseEvent:createEvent};
          views.push(view); families.set(stmt.binding.id,view);
        } else {
          const view = families.get(init.binding);
          families.set(stmt.binding.id,view);
          const sequence = use(stmt.binding.id,'view-alias-copy-complete',index,path,init.range,
            {initializerBinding:init.binding});
          view.aliases.push({binding:stmt.binding.id,initializerBinding:init.binding,event:sequence});
        }
      } else if (stmt.kind === 'arrayStoreDenseChecked') {
        read(stmt.value,index,['body',index,'value']);
        event(index,['body',index],'array-store-effect',stmt.expressionRange,model.proofs.get(index));
      } else if (stmt.kind === 'arrayResizeChecked') {
        event(index,['body',index],'array-resize-effect',stmt.expressionRange,model.proofs.get(index));
      } else if (stmt.kind === 'expression' || stmt.kind === 'return') {
        const field = stmt.kind === 'expression' ? 'expression' : 'value', value = stmt[field];
        const path = ['body',index,field];
        if (value.kind === 'arrayDirectCall') event(index,path,'array-call-effect',value.range,
          {callIndex:callIndices.get(canonical([fn.id,path]))});
        else read(value,index,path);
      }
    }
    return {functionId:fn.id,views,events};
  });
  return {plan:{version:1,publication:{scopeDigest:prepared.scopeDigest,
    publishedDigest:prepared.publishedDigest},calls,functions},work};
}

function mayAlias(left, right) {
  if (canonical(left) === canonical(right)) return true;
  return left.kind === 'parameter' && right.kind === 'parameter'
    && left.functionId === right.functionId;
}
function conflict(fn, state, event, view, owner, sourceKind, fixed = {}) {
  const at = (kind,range) => ({kind,sourceId:fn.sourcePath,...range});
  const last = state.events[view.lastUseEvent];
  const aliases = new Map(view.aliases.map(alias => [alias.binding,alias]));
  const chain = [];
  let binding = last.binding;
  while (binding !== view.binding) {
    const alias = aliases.get(binding);
    chain.push(alias); binding = alias.initializerBinding;
  }
  const related = [at('borrow-origin',state.events[view.createEvent].range)];
  for (const alias of chain.reverse()) {
    const sourceEvent = state.events[alias.event];
    related.push(at('borrow-alias',fn.body[sourceEvent.statementIndex].range));
  }
  related.push(at('borrow-last-use',last.range));
  failure({code:'r03-d-readspan-structural-conflict',ruleId:'r01-span',phase:'hir',
    message:'active ReadSpan may overlap a structural Array operation',
    primary:{sourceId:fn.sourcePath,...event.range},related,
    conflict:{functionId:fn.id,operationPath:event.expressionPath,sequence:event.sequence,
      viewId:view.viewId,viewOwner:view.owner,structuralOwner:owner,
      lastUsePath:last.expressionPath,sourceKind,...fixed}});
}
/** Called only after the complete supplied HIR/plan has matched the trusted reconstruction. */
export function consumeReadSpanPlan(hir, prepared, registrationAndUseWork) {
  let work = registrationAndUseWork;
  const plan = hir.readSpanPlan;
  for (const [index,state] of plan.functions.entries()) {
    const fn = hir.functions[index];
    const compare = (event,owner,sourceKind,fixed = {}) => {
      for (const view of state.views) {
        if (!(view.createEvent < event.sequence && event.sequence < view.lastUseEvent)) continue;
        // Global registration/use fees are already complete. Duplicated slots still charge.
        if (++work > 1024) limit();
        if (mayAlias(view.owner,owner)) conflict(fn,state,event,view,owner,sourceKind,fixed);
      }
    };
    for (const event of state.events) {
      if (event.kind === 'array-call-effect') {
        const call = plan.calls[event.callIndex], upper = prepared.records.get(call.target).upper;
        for (const parameter of upper.parameters) {
          if (!parameter.structural) continue;
          const actual = call.arguments.find(argument => argument.index === parameter.index);
          compare(event,actual.owner,'fixedCall',{target:call.target,parameterIndex:parameter.index,
            consumedDigest:call.consumedDigest,scopeDigest:plan.publication.scopeDigest,
            publishedDigest:plan.publication.publishedDigest});
        }
      } else if (event.kind === 'array-store-effect' && !event.nonStructural)
        compare(event,event.owner,'directStore');
      else if (event.kind === 'array-resize-effect' && !event.nonStructural)
        compare(event,event.owner,'directResize');
    }
  }
}
