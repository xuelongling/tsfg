// SPDX-License-Identifier: MIT
// Complete formal/local view provenance and call completion, derived from verified owned HIR.
import { canonical, own, sha256, arrayTypeId, readSpanTypeId } from './identity.mjs';

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
  /** @type {Map<string,any>} */
  const targets = new Map(hir.functions.map(fn => [fn.id,fn]));
  const callIndices = new Map(calls.map((call,index) => [
    canonical([call.functionId,call.expressionPath]),index,
  ]));
  const functions = hir.functions.map(fn => {
    const model = prepared.ownerModel.functions.get(fn.id);
    const families = new Map(), views = [], events = [];
    // Input views already exist at entry. They are registered even when unused,
    // but entry itself is neither a body event nor an owner read/allocation.
    fn.parameters.forEach((parameter,index) => {
      if (parameter.type !== readSpanTypeId) return;
      charge();
      const viewId = sha256('tsfg.readspan.parameter-view.v1\0' + canonical({
        functionId:fn.id,bindingId:parameter.id,index,parameterRange:parameter.range,
      }));
      const view = {viewId,binding:parameter.id,owner:model.bindings.get(parameter.id),
        origin:{kind:'parameter',index,range:{...parameter.range}},
        aliases:[],useEvents:[],lastUseEvent:null};
      views.push(view); families.set(parameter.id,view);
    });
    const event = (statementIndex,expressionPath,kind,range,fields) => {
      if (events.length >= 100) limit();
      const sequence = events.length;
      events.push({sequence,statementIndex,expressionPath,kind,range:{...range},...fields});
      return sequence;
    };
    const completeUse = (view, sequence) => {
      if (view.useEvents.at(-1) !== sequence) {
        if (view.useEvents.length >= 50) limit();
        view.useEvents.push(sequence);
      }
      view.lastUseEvent = sequence;
    };
    const useFamily = (view,binding,kind,index,path,range,fields = {}) => {
      charge();
      const sequence = event(index,path,kind,range,{viewId:view.viewId,binding,...fields});
      completeUse(view,sequence);
      return sequence;
    };
    const use = (binding,kind,index,path,range,fields = {}) =>
      useFamily(families.get(binding),binding,kind,index,path,range,fields);
    const read = (value,index,path) => {
      if (value?.kind === 'readSpanReadChecked')
        use(value.receiver.binding,'view-read-complete',index,path,value.range);
      else if (value?.kind === 'readSpanLength')
        use(value.receiver.binding,'view-length-complete',index,path,value.range);
    };
    const callInfo = (value,path) => {
      const callIndex = callIndices.get(canonical([fn.id,path]));
      const returnedView = calls[callIndex].returnedView;
      // Only the trusted original target slot selects new versus existing family.
      const arrayOrigin = returnedView !== null
        && targets.get(value.target).parameters[returnedView.index].type === arrayTypeId;
      return {callIndex,returnedView,arrayOrigin};
    };
    const ordinaryCall = (value,index,path) => {
      const info = callInfo(value,path), {callIndex} = info;
      event(index,path,'array-call-effect',value.range,{callIndex});
      const uses = value.arguments.flatMap((argument,slot) => {
        if (argument.type !== readSpanTypeId) return [];
        // Each original reference pays, including repeated references to one family.
        charge();
        const view = families.get(argument.binding);
        return [{index:slot,binding:argument.binding,viewId:view.viewId,range:{...argument.range}}];
      });
      if (uses.length) {
        const sequence = event(index,path,'view-call-complete',value.range,{callIndex,uses});
        for (const occurrence of uses) completeUse(families.get(occurrence.binding),sequence);
      }
      return info;
    };
    const createCallResult = (call,binding,index,path,range) => {
      // Even an unused/discarded result registers after whole argument completion.
      charge();
      const {callIndex,returnedView} = call, parameterIndex = returnedView.index;
      const viewId = sha256('tsfg.readspan.call-result-view.v1\0' + canonical({
        functionId:fn.id,expressionPath:path,callRange:range,parameterIndex,
      }));
      const createEvent = event(index,path,'view-call-result-create-complete',range,
        {viewId,binding,callIndex,parameterIndex});
      const view = {viewId,binding,owner:returnedView.owner,origin:{kind:'callResult',createEvent},
        aliases:[],useEvents:[],lastUseEvent:createEvent};
      views.push(view);
      if (binding !== null) families.set(binding,view);
      return view;
    };
    for (const [index,stmt] of fn.body.entries()) {
      if (stmt.kind === 'local' && stmt.binding.type === readSpanTypeId) {
        const init = stmt.initializer, path = ['body',index,'initializer'];
        // Preserve old alias registration before the call; new roots register after it.
        if (init.kind !== 'arrayDirectCall' || !callInfo(init,path).arrayOrigin) charge();
        if (init.kind === 'readSpanCreateChecked') {
          const viewId = sha256('tsfg.readspan.view.v1\0' + canonical({
            functionId:fn.id,bindingId:stmt.binding.id,createRange:init.range,
          }));
          const createEvent = event(index,path,'view-create-complete',init.range,
            {viewId,binding:stmt.binding.id});
          const view = {viewId,binding:stmt.binding.id,owner:model.bindings.get(stmt.binding.id),
            origin:{kind:'local',createEvent},aliases:[],useEvents:[],lastUseEvent:createEvent};
          views.push(view); families.set(stmt.binding.id,view);
        } else if (init.kind === 'arrayDirectCall') {
          const call = ordinaryCall(init,index,path);
          if (call.arrayOrigin) createCallResult(call,stmt.binding.id,index,path,init.range);
          else {
            const {callIndex,returnedView} = call, view = families.get(returnedView.binding);
            families.set(stmt.binding.id,view);
            const sequence = use(stmt.binding.id,'view-call-result-alias-complete',index,path,init.range,
              {initializerBinding:returnedView.binding,callIndex,parameterIndex:returnedView.index});
            view.aliases.push({binding:stmt.binding.id,initializerBinding:returnedView.binding,event:sequence});
          }
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
        if (value.kind === 'arrayDirectCall') {
          const call = ordinaryCall(value,index,path), {callIndex,returnedView} = call;
          if (call.arrayOrigin) {
            const view = createCallResult(call,null,index,path,value.range);
            if (stmt.kind === 'return') useFamily(view,null,'view-return-complete',index,path,value.range,
              {callIndex,parameterIndex:returnedView.index});
          } else if (stmt.kind === 'return' && value.type === readSpanTypeId)
            use(returnedView.binding,'view-return-complete',index,path,value.range,
              {callIndex,parameterIndex:returnedView.index});
        } else if (stmt.kind === 'return' && value.type === readSpanTypeId)
          use(value.binding,'view-return-complete',index,path,value.range,{callIndex:null,parameterIndex:null});
        else read(value,index,path);
      }
    }
    return {functionId:fn.id,views,events};
  });
  return {plan:{version:4,publication:{scopeDigest:prepared.scopeDigest,
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
  // Trusted group rows retain original slot order; the first family match is the lowest slot.
  let binding = last.kind === 'view-call-complete'
    ? last.uses.find(use => use.viewId === view.viewId).binding : last.binding;
  while (binding !== view.binding) {
    const alias = aliases.get(binding);
    chain.push(alias); binding = alias.initializerBinding;
  }
  const originRange = view.origin.kind === 'parameter'
    ? view.origin.range : state.events[view.origin.createEvent].range;
  const related = [at('borrow-origin',originRange)];
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
        // Unused formals have no live interval; never coerce their null last use to event zero.
        if (view.lastUseEvent === null) continue;
        if (view.origin.kind !== 'parameter' && !(view.origin.createEvent < event.sequence)) continue;
        if (!(event.sequence < view.lastUseEvent)) continue;
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
