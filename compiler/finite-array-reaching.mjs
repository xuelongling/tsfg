// SPDX-License-Identifier: MIT
// Ordered version constraints over checked owned HIR, not payload evaluation.
// Unknown aliases/callees retain pending; capacity bounds remain independent.
import {canonical,i32TypeId,own} from './identity.mjs';
import {finiteCallables} from './finite-callables.mjs';
import {finitePresence,isArrayNullishAssignment,isFieldNullishAssignment,isLocalNullishAssignment} from './finite-presence.mjs';
import {createArrayCallContexts} from './finite-array-call-contexts.mjs';
import {booleanLiteral} from './finite-field-effects.mjs';
import {finiteBranchEffects,finiteNumericUse} from './finite-numeric-use.mjs';

// The production state-copy seam also admits bounded component budget checks;
// its version tokens are proof identities, never synthetic Source expressions.
export function copyArrayReachingState(state,charge) {
  const result=new Map();
  for(const [id,row] of state) {
    charge();const slots=new Map();
    for(const [key,versions] of row.slots) {
      charge();const copied=new Set();
      for(const version of versions){charge();copied.add(version);}
      slots.set(key,copied);
    }
    result.set(id,{...row,slots});
  }return result;
}

export function propagateArrayWrites(effects,charge) {
  const callers=new Map(),pending=[];
  for(const [id,effect] of effects) {
    charge();
    if(!effect.writes)for(const callee of effect.callees) {
      charge();
      if(!effects.has(callee)){effect.writes=true;break;}
      if(!callers.has(callee))callers.set(callee,[]);
      callers.get(callee).push(id);
    }
    if(effect.writes)pending.push(id);
  }
  // Each write-capable function publishes to its callers once, including cycles.
  for(let index=0;index<pending.length;index++) {
    charge();
    for(const caller of callers.get(pending[index])??[]) {
      charge();const effect=effects.get(caller);
      if(effect.writes)continue;
      effect.writes=true;pending.push(caller);
    }
  }
}

export function buildFiniteArrayReaching(hir,plan,charge,canTerminateArrayRead) {
  const functions=finiteCallables(hir),byFunction=new Map(functions.map(fn=>[fn.id,fn])),
    types=new Map([...hir.types,...(plan.intrinsics??[])].map(row=>[row.id,row])),
    calls=new Map(plan.calls.map(row=>[row.id,row])),
    aliases=new Map((plan.fieldReaching?.returnAliases??[]).map(row=>[row.functionId,row.parameter])),
    effects=new Map(functions.map(fn=>[fn.id,{writes:false,callees:new Set(),localSlots:!fn.ownerType}])),
    writes=new Map(),reads=new Map(),normalReadSources=new Map(),contextsByTarget=new Map(),checkedLoopConditions=new Set(),
    presence=finitePresence(plan,types,charge),carriers=new Map();
  for(const row of plan.carrierNodes??plan.nodes){charge();carriers.set(row.id,row.domainId);}
  const failedInitializers=new Map(),failedConstructions=new Set(),failedSuperArguments=new Map(),
    terminalNumericUses=new Set(),terminalNumericConstructions=new Set(),localNumericSources=new Map();
  const constructors=[],ordinary=[];
  let contextWrites=new Map(),terminalReads=null;
  function arrayCarrier(id) {
    const stack=[id],seen=new Set();while(stack.length) {
      charge();const current=stack.pop();if(seen.has(current))continue;seen.add(current);const type=types.get(current);
      if(type.kind==='array'||type.kind==='readSpan')return true;if(type.kind==='union')stack.push(...type.members);
    }return false;
  }
  function hasCheckedRead(root) {
    const stack=[root];while(stack.length) {
      charge();const value=stack.pop();
      if(['arrayReadChecked','arrayCompoundAssignment','arrayUpdate'].includes(value.kind))return true;
      for(const child of Object.values(value)){charge();if(child&&typeof child==='object')stack.push(child);}
    }
    return false;
  }
  for(const fn of functions) {
    const stack=[{value:fn.body,path:fn.id+'/body'}],effect=effects.get(fn.id);
    if(fn.role==='construction-body'){
      const owner=types.get(fn.ownerType);
      let depth=0,type=owner;
      while(type.base){charge();depth++;type=types.get(type.base);}
      constructors.push({fn,depth});
      for(const row of owner.construction.initialization)if(row.value)
        stack.push({value:row.value,path:'construction/'+fn.construction+'/initialization/'+row.field});
    }else ordinary.push(fn);
    while(stack.length) {
      charge();const {value,path}=stack.pop();if(!value||typeof value!=='object')continue;
      if(['arrayStoreDenseChecked','arrayResizeChecked','arrayCompoundAssignment','arrayUpdate'].includes(value.kind))effect.writes=true;
      if(value.kind==='while'||value.kind==='construct'||value.kind==='superConstruct'||
        value.kind==='call'&&value.target!==hir.intrinsics.readSpan.id)effect.localSlots=false;
      if(value.kind==='while'&&hasCheckedRead(value.condition))checkedLoopConditions.add(value.condition);
      if(value.kind==='call')for(const id of value.receiver?(calls.get(path)?.targets??[]).map(row=>row.functionId):[value.target]) {
        if(id===hir.intrinsics.readSpan.id)continue;
        effect.callees.add(id);
        let sites=contextsByTarget.get(id);
        if(!sites)contextsByTarget.set(id,sites=new Map());
        sites.set(path+'\0'+id,{possible:true,state:new Map(),constants:new Map(),truths:new Map()});
      }
      if(value.kind==='construct'||value.kind==='superConstruct')effect.writes=true;
      for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')stack.push({value:child,path:path+'/'+key});
    }
  }
  // Base construction is always analyzed before its derived continuation.
  constructors.sort((a,b)=>{charge();return a.depth-b.depth;});
  const ordered=[...constructors.map(row=>row.fn),...ordinary];
  propagateArrayWrites(effects,charge);
  const clone=state=>copyArrayReachingState(state,charge);
  const transfers=createArrayCallContexts(charge,clone,(fn,state,bindings)=>analyze(fn,state,bindings,true,false));
  function copyBindings(bindings) {
    const result=new Map();for(const [id,value] of bindings){charge();result.set(id,value);}return result;
  }
  function meetBindings(target,left,right,leftLive=true,rightLive=true) {
    const keys=new Set(),result=new Map();
    for(const side of [left,right])for(const id of side.keys()){charge();keys.add(id);}
    for(const id of keys) {
      charge();const a=left.get(id),b=right.get(id),same=a&&b&&
        ['owner','constant','symbol','offset','limit','truth'].every(key=>a[key]===b[key]);
      const shared=same?(a.valueNode===b.valueNode?a:{...a,valueNode:undefined}):{};
      result.set(id,!leftLive?b:!rightLive?a:shared);
    }
    // A branch that returned may be the sole owner of a lexical binding.
    target.clear();for(const [id,value] of result){charge();if(value!==undefined)target.set(id,value);}
  }
  function join(left,right) {
    if(!left)return right;if(!right)return left;const out=new Map();
    for(const [owner,a] of left) {
      charge();if(!right.has(owner))continue;const b=right.get(owner),slots=new Map();
      for(const [key,versions] of a.slots) {
        charge();if(!b.slots.has(key))continue;const merged=new Set();
        for(const source of [versions,b.slots.get(key)])for(const version of source){charge();merged.add(version);}
        slots.set(key,merged);
      }
      out.set(owner,{length:a.length===b.length?a.length:null,slots});
    }return out;
  }
  function returnsBeforeBackedge(body) {
    charge();
    return body.some(row=>{
      charge();
      if(row.kind==='return'||row.kind==='constructorReturn')return true;
      if(row.kind==='block')return returnsBeforeBackedge(row.body);
      return row.kind==='if'&&returnsBeforeBackedge(row.then)&&returnsBeforeBackedge(row.else??[]);
    });
  }
  function parameters(fn,incoming=[]) {
    const env=new Map();for(const parameter of fn.parameters) {
      let constant,truth;for(const [index,row] of incoming.entries()) {
        charge();const candidate=row.constants.get(parameter.id),boolean=row.truths?.get(parameter.id);
        if(index===0){constant=candidate;truth=boolean;}else{if(constant!==candidate)constant=undefined;if(truth!==boolean)truth=undefined;}
      }
      charge();env.set(parameter.id,{symbol:fn.id+'/parameter/'+parameter.id,
        ...(arrayCarrier(parameter.type)?{owner:fn.id+'/parameter/'+parameter.id}:{}),...(constant!==undefined?{constant}:{}),...(truth!==undefined?{truth}:{})});
    }return env;
  }
  function predicateTruth(value,path) {
    charge();const literal=booleanLiteral(value,charge);if(literal!==null)return literal.value;
    if(value.kind!=='binary'||!['===','!=='].includes(value.operator))return undefined;
    let classified;
    if(['undefined','null'].includes(value.right.kind))classified=presence(path+'/left',value.right.kind);
    else if(['undefined','null'].includes(value.left.kind))classified=presence(path+'/right',value.left.kind);
    return classified&&classified.present!==classified.absent?(value.operator==='==='?classified.absent:classified.present):undefined;
  }
  function analyze(fn,initial,env,applyCalls,recordReads=true,collectAll=false,firstCondition=null) {
    const exits=[],mutated=new Set();let complete=true,invalidateAll=false,numericFailure=false;
    const initializerReads=new Set();let inInitializer=false;
    // One visit per source occurrence gives a local version one stored value.
    // The lexical pass uses Array identities to name stores through aliases.
    const trackLocalSlots=recordReads&&effects.get(fn.id).localSlots;
    let slotValues;
    const origin=value=>({source:fn.sourcePath,...value.range});
    const key=index=>index?.constant!==undefined?'c:'+index.constant:index?.symbol?'s:'+index.symbol:null;
    function version(path,value,node,owner,index,kind) {
      const id=path+'/array-version';charge();
      // Canonical source bindings are collected independently in the first
      // pass. Contextual application never rewrites that version's identity.
      if(!firstCondition&&!writes.has(id))writes.set(id,{id,node,owner,index,kind,origin:origin(value)});return id;
    }
    function invalidate(state) {invalidateAll=true;for(const row of state.values()){charge();row.slots.clear();row.length=null;}}
    function invalidateOtherParameters(state,owner) {
      // Distinct parameter identities can still refer to the same backing Array.
      if(!owner.includes('/parameter/'))return;
      for(const [other,row] of state) {
        charge();
        if(other!==owner&&other.includes('/parameter/')){row.slots.clear();row.length=null;}
      }
    }
    function rememberSlotValue(id,value,stored) {
      if(!trackLocalSlots||id===undefined||!stored.owner||stored.owner.includes('/parameter/'))return;
      const view=stored.limit!==undefined,kind=view?'readSpan':'array';
      if(types.get(value.type)?.kind!==kind||view&&collectAll)return;
      charge();(slotValues??=new Map()).set(id,{owner:stored.owner,offset:stored.offset,limit:stored.limit});
    }
    function checkedSources(memory,receiver) {
      const start=receiver.offset??0,length=receiver.limit??memory.length;
      if(length===null||length===0||memory.length===null||start+length>memory.length||length>memory.slots.size)return null;
      const sources=new Set();
      for(let index=start;index<start+length;index++){
        charge();
        const versions=memory.slots.get('c:'+index);
        if(!versions?.size)return null;
        for(const version of versions){
          charge();
          const source=writes.get(version).node;
          if(!source.startsWith(fn.id+'/'))return null;
          sources.add(source);
        }
      }
      return [...sources].sort((a,b)=>{charge();return a<b?-1:a>b?1:0;});
    }
    function load(value,path,state,receiver,index,projectKind=undefined) {
      const memory=state.get(receiver?.owner),slot=key(index),missing=memory?.length!==null&&memory?.length!==undefined&&
        index?.constant!==undefined&&index.constant>=memory.length,
        bounds=receiver?.limit!==undefined&&index?.constant!==undefined&&index.constant>=receiver.limit;
      let versions=slot?memory?.slots.get(slot):null;
      if(receiver?.offset) {
        versions=index?.constant!==undefined?memory?.slots.get('c:'+(index.constant+receiver.offset)):null;
      }
      const status=missing||bounds?'missing':versions?.size?'proven':'pending';
      const repeated=inInitializer&&initializerReads.has(path);
      if(recordReads) {
        const prior=repeated?reads.get(path):null,owner=receiver?.owner??null;
        const compatible=!prior||prior.owner===owner&&prior.index===slot;
        const mergedStatus=compatible&&(!prior||prior.status===status)?status:'pending';
        const selected=new Set(),sources=new Set();
        if(mergedStatus==='proven') {
          for(const id of versions){if(repeated)charge();selected.add(id);}
          for(const id of prior?.versions??[]){charge();selected.add(id);}
          for(const id of selected){if(repeated)charge();sources.add(writes.get(id).node);}
        }
        const order=repeated?(a,b)=>{charge();return a<b?-1:a>b?1:0;}:undefined;
        reads.set(path,{node:path,owner:compatible?owner:null,index:compatible?slot:null,status:mergedStatus,
          versions:[...selected].sort(order),sources:[...sources].sort(order),origin:origin(value)});
        if(inInitializer){charge();initializerReads.add(path);}
      }
      // A successful checked dynamic read selects one initialized cell. This
      // feeds payload analysis only, preserving the explicit bounds check.
      if(recordReads&&repeated)normalReadSources.delete(path);
      else if(recordReads&&!collectAll&&status==='pending'&&memory&&index?.constant===undefined){
        const sources=checkedSources(memory,receiver);
        if(sources)normalReadSources.set(path,sources);
      }
      if(!slotValues||(projectKind!=='array'&&projectKind!=='readSpan')||status!=='proven'||versions.size!==1||
        index?.constant===undefined||receiver.owner.includes('/parameter/'))return {status};
      charge();const stored=slotValues.get(versions.values().next().value);
      if(!stored||projectKind!==(stored.limit===undefined?'array':'readSpan')||!state.has(stored.owner))return {status};
      return {status,stored};
    }
    function store(value,path,node,state,receiver,index,overwrite) {
      if(receiver?.owner){charge();mutated.add(receiver.owner);}
      const id=version(path,value,node,receiver?.owner??null,key(index),'store');
      if(!receiver?.owner){invalidate(state);return;}
      if(!state.has(receiver.owner))state.set(receiver.owner,{length:null,slots:new Map()});
      const memory=state.get(receiver.owner),slot=key(index);
      if(!slot){invalidate(state);return;}
      invalidateOtherParameters(state,receiver.owner);
      if(index.constant!==undefined&&memory.length!==null) {
        if(index.constant>memory.length){memory.slots.clear();memory.length=null;return;}
        if(index.constant===memory.length){if(overwrite)return;memory.length++;}
      }
      // A symbolic store can overwrite or append at the current endpoint.
      // Only the definitely just-written index keeps its version.
      if(index.constant===undefined){memory.slots.clear();if(!overwrite)memory.length=null;}
      else for(const other of memory.slots.keys())if(other.startsWith('s:'))memory.slots.delete(other);
      memory.slots.set(slot,new Set([id]));
      return id;
    }
    function terminalNumericUse(path,hasRhs=true) {
      if(collectAll||presence(path+'/old-value','undefined').present&&
        (!hasRhs||presence(path+'/value','undefined').present))return null;
      if(recordReads){charge();terminalNumericUses.add(path);}
      numericFailure=true;
      return {terminal:true,trap:path,numeric:true};
    }
    /** @param {boolean|'initializer'|'superArgument'} [root] */
    function expression(value,path,state,bindings,root=false,directStatement=false) {
      if(!value)return {};charge();
      const constructionEvaluation=root==='initializer'||root==='superArgument';
      const terminalRoot=root===true||root==='superArgument';
      const child=(name,mode=root)=>expression(value[name],path+'/'+name,state,bindings,mode);
      if(value.kind==='reference')return adapt(bindings.get(value.binding)??{symbol:fn.id+'/parameter/'+value.binding},fn.id+'/binding/'+value.binding,path);
      if(['group','nonNull','assertType'].includes(value.kind)) {
        const {truth,...result}=expression(value.operand,path+'/operand',state,bindings,root);return result;
      }
      if(value.kind==='boolean')return {truth:value.value,symbol:path};
      if(value.kind==='constant') {
        const number=Number(value.decimal);return Number.isInteger(number)&&number>=0&&number<=4294967295?{constant:number,symbol:path}:{symbol:path};
      }
      if(value.kind==='arrayCreate') {
        const slots=new Map();for(const [index,item] of value.elements.entries()) {
          const element=expression(item,path+'/elements/'+index,state,bindings,root);
          if(element.terminal)return element;
          const id=version(path+'/initial/'+index,item,path+'/elements/'+index,path,'c:'+index,'initial');
          rememberSlotValue(id,item,element);
          slots.set('c:'+index,new Set([id]));
        }
        state.set(path,{length:value.elements.length,slots});return {owner:path,symbol:path};
      }
      if(value.kind==='arrayReadChecked') {
        const receiver=child('receiver');if(receiver.terminal)return receiver;
        const index=child('index');if(index.terminal)return index;
        const projectKind=slotValues&&types.get(value.receiver.type)?.kind==='array'?types.get(value.type)?.kind:undefined,
          {status,stored}=load(value,path,state,receiver,index,projectKind);
        if(!collectAll&&status==='missing'&&
          (constructionEvaluation||terminalRoot&&canTerminateArrayRead(false)))return {terminal:true,trap:path};
        return stored?{...stored,symbol:path}:{symbol:path};
      }
      if(['arrayStoreDenseChecked','arrayCompoundAssignment','arrayUpdate','arrayResizeChecked'].includes(value.kind)) {
        const receiver=expression(value.target.receiver,path+'/target/receiver',state,bindings,root);
        if(receiver.terminal)return receiver;
        const index=value.target.index?expression(value.target.index,path+'/target/index',state,bindings,root):null;
        if(index?.terminal)return index;
        let oldLength=null,oldStatus;
        const writeBack=(memory,node)=>{
          const length=memory.get(receiver.owner)?.length,overwrite=oldLength!==null&&length!=null&&length>=oldLength;
          return store(value,path,node,memory,receiver,index,overwrite);
        };
        if(value.kind==='arrayCompoundAssignment'||value.kind==='arrayUpdate') {
          const old=path+'/old-value',{status}=load({...value,range:value.target.range},old,state,receiver,index);
          oldStatus=status;
          oldLength=state.get(receiver.owner)?.length??null;
          // The lexical pass retains every original occurrence. Ordered
          // transfer stops only at a definite old-read trap on the current evaluation path.
          if(!collectAll&&status==='missing') {
            const terminal=terminalRoot&&canTerminateArrayRead(directStatement&&!fn.ownerType);
            if(terminal&&recordReads){charge();(terminalReads??=new Set()).add(old);}
            if(constructionEvaluation||terminal)return {terminal:true,trap:old};
          }
          if(isArrayNullishAssignment(value)) {
            if(!collectAll&&status==='missing')return {symbol:path};
            const {present,absent}=collectAll?{present:true,absent:true}:presence(old);
            if(!absent)return {symbol:path};
            const memory=present?clone(state):state,locals=present?copyBindings(bindings):bindings;
            const rhs=expression(value.value,path+'/value',memory,locals,present?false:root);
            if(rhs.terminal)return present?{symbol:path}:rhs;
            writeBack(memory,path+'/value');
            if(!present)return rhs;
            const merged=join(state,memory);state.clear();for(const [id,row]of merged){charge();state.set(id,row);}
            meetBindings(bindings,bindings,locals);
            return {symbol:path};
          }
        }
        const rhs=value.value?child('value'):{symbol:path};
        if(rhs.terminal)return rhs;
        if(oldStatus!=='missing'&&value.kind==='arrayCompoundAssignment'&&finiteNumericUse(value)){
          const stop=terminalNumericUse(path);if(stop)return stop;
        }
        if(value.kind==='arrayResizeChecked') {
          if(receiver?.owner){charge();mutated.add(receiver.owner);}
          const memory=state.get(receiver.owner);
          if(!memory){invalidate(state);return rhs;}
          if(rhs.constant!==memory.length)invalidateOtherParameters(state,receiver.owner);
          if(rhs.constant!==undefined&&(memory.length===null||rhs.constant<=memory.length)) {
            memory.length=rhs.constant;for(const slot of memory.slots.keys())if(!slot.startsWith('c:')||Number(slot.slice(2))>=rhs.constant)memory.slots.delete(slot);
          }else {memory.slots.clear();memory.length=null;}
          return rhs;
        }
        // The old-read check makes an append impossible if the RHS kept or grew the backing.
        const id=writeBack(state,value.kind==='arrayStoreDenseChecked'?path+'/value':path);
        if(value.kind==='arrayStoreDenseChecked'){rememberSlotValue(id,value.value,rhs);return rhs;}
        return {symbol:path};
      }
      const coalescingAssignment=isLocalNullishAssignment(value);
      if(!coalescingAssignment&&(value.kind==='assignment'||value.kind==='update')) {
        const binding=value.target.binding,old=bindings.get(binding),checked=plan.localNumericInputs?.has(path),
          update=value.kind==='update';
        if(!collectAll&&recordReads&&checked&&old?.valueNode){
          charge();localNumericSources.set(path,old.valueNode);
        }
        if(!update) {
          const rhs=child('value');if(rhs.terminal)return rhs;
          if(!value.operator||value.operator==='=') {
            bindings.set(binding,bindingValue(rhs,path+'/value',binding,value.target.type));return rhs;
          }
        }
        if(checked){const stop=terminalNumericUse(path,!update);if(stop)return stop;}
        const result={symbol:path,...(checked&&update?{valueNode:path+'/writeback/value'}:plan.localNumericInputs?.size&&!update&&
          value.target.type===i32TypeId?{valueNode:path}:{})};
        bindings.set(binding,result);
        if(!update||value.prefix)return result;
        const previous=old??{symbol:path+'/old-value'};
        return checked?{...previous,valueNode:path}:previous;
      }
      if(value.kind==='arrayLength'||value.kind==='readSpanLength') {
        const receiver=child('receiver');if(receiver.terminal)return receiver;
        const length=receiver.limit??state.get(receiver.owner)?.length;
        return length!==undefined&&length!==null?{constant:length,symbol:path}:{symbol:path};
      }
      if(value.kind==='call') {
        const receiver=value.receiver?child('receiver'):null,args=[];
        if(receiver?.terminal)return receiver;
        for(const [index,item] of (value.arguments??[]).entries()) {
          const argument=expression(item,path+'/arguments/'+index,state,bindings,root);
          if(argument.terminal)return argument;
          args.push(argument);
        }
        if(value.target===hir.intrinsics.readSpan.id) {
          const [owner,start,length]=args;
          const available=owner?.limit??state.get(owner?.owner)?.length;
          return owner?.owner&&start?.constant!==undefined&&length?.constant!==undefined&&
            available!==undefined&&available!==null&&start.constant+length.constant<=available?
            {owner:owner.owner,offset:(owner.offset??0)+start.constant,limit:length.constant,symbol:path}:{};
        }
        // An entry-only probe proves local effects without opening a call
        // context. Arguments still have their original evaluation order.
        if(firstCondition){complete=false;return {symbol:path};}
        const targets=[];let unknown=false,modifies=false,ordinal,consistent=true;
        if(receiver)for(const target of calls.get(path)?.targets??[]){charge();targets.push(target.functionId);}
        else {charge();targets.push(value.target);}
        for(const [index,id] of targets.entries()) {
          charge();unknown||=!effects.has(id);modifies||=effects.get(id)?.writes??false;
          const returned=aliases.get(id);if(index===0)ordinal=returned;else consistent&&=ordinal===returned;
        }
        const actual=[];if(receiver){charge();actual.push(receiver);}for(const arg of args){charge();actual.push(arg);}
        // A definition's read obligations meet every real caller's incoming
        // state. This is distinct from applying a callee's return transfer to
        // this caller; contextual visits cannot overwrite canonical contexts.
        if(recordReads&&!collectAll)for(const id of targets) {
          charge();const callee=byFunction.get(id);if(!callee)continue;
          const incoming=new Map(),constants=new Map(),truths=new Map();
          for(const [index,parameter] of callee.parameters.entries()) {
            charge();const argument=actual[index];if(argument?.constant!==undefined)constants.set(parameter.id,argument.constant);
            if(typeof argument?.truth==='boolean')truths.set(parameter.id,argument.truth);
            const memory=state.get(argument?.owner);
            // A span's rebased indices need their own incoming view mapping;
            // copying the backing owner's absolute slots would invent a read.
            if(!memory||argument.offset||argument.limit!==undefined)continue;
            const slots=new Map();for(const [slot,versions] of memory.slots) {
              charge();let mapped=slot;
              if(slot.startsWith('s:')) {
                mapped=null;for(const [ordinal,value] of actual.entries()) {
                  charge();if(value.symbol&&slot==='s:'+value.symbol&&callee.parameters[ordinal])
                    mapped='s:'+id+'/parameter/'+callee.parameters[ordinal].id;
                }
              }
              if(mapped){const copied=new Set();for(const version of versions){charge();copied.add(version);}slots.set(mapped,copied);}
            }
            incoming.set(id+'/parameter/'+parameter.id,{length:memory.length,slots});
          }
          contextWrites.set(path+'\0'+id,{possible:true,state:incoming,constants,truths});
        }
        if(!targets.length||unknown){complete=false;invalidate(state);}
        // Even a read-only recursive target needs a real normal continuation;
        // its absence of writes cannot supply a productive call witness.
        else if(applyCalls||modifies) {
          if(!applyCalls)invalidate(state);
          else {
            let merged,pending=false;
            for(const id of targets) {
              charge();const result=transfers.resolve(byFunction.get(id),actual,state);
              if(!result){pending=true;continue;}
              invalidateAll||=result.invalidateAll;
              for(const owner of result.mutated){charge();mutated.add(owner);}
              merged=merged?join(merged,result.state):result.state;
            }
            if(pending){complete=false;invalidate(state);}
            else {state.clear();for(const [id,row]of merged){charge();state.set(id,row);}}
          }
        }
        return ordinal!==null&&ordinal!==undefined&&consistent?actual[ordinal]??{}:{symbol:path};
      }
      if(coalescingAssignment||value.kind==='shortCircuit'||value.kind==='binary'&&['&&','||','??'].includes(value.operator)) {
        const binding=coalescingAssignment?value.target.binding:null,
          leftNode=path+(coalescingAssignment?'/old-value':'/left'),rightKey=coalescingAssignment?'value':'right',
          left=binding===null?child('left'):(bindings.get(binding)??{symbol:leftNode});
        if(left.terminal)return left;
        const nullish=coalescingAssignment||value.operator==='??',
          literal=nullish?null:booleanLiteral(value.left,charge),truth=literal?.value??left.truth;
        const possibilities=collectAll?{present:true,absent:true}:nullish?presence(leftNode):
          {present:truth===undefined||truth===(value.operator==='||'),absent:truth===undefined||truth===(value.operator==='&&')};
        const evaluateRight=(memory,locals,mode)=>{
          const from=path+'/'+rightKey,result=expression(value[rightKey],from,memory,locals,mode);
          if(binding!==null&&!result.terminal)locals.set(binding,bindingValue(result,from,binding,value.target.type));
          return result;
        };
        const resultValue=result=>{if(possibilities.absent&&!nullish)forgetAssignedTruth(value.right,bindings);
          return nullish?adapt(result,result.symbol,path):{symbol:path};};
        if(!possibilities.absent)return resultValue(left);
        if(!possibilities.present) {
          const result=evaluateRight(state,bindings,nullish||literal!==null?root:false);
          return result.terminal?result:resultValue(result);
        }
        const right=clone(state),branchBindings=copyBindings(bindings),
          result=evaluateRight(right,branchBindings,false);
        if(result.terminal)return resultValue(left);
        const merged=join(state,right);state.clear();for(const [id,row] of merged){charge();state.set(id,row);}
        meetBindings(bindings,bindings,branchBindings);
        return resultValue(nullish&&left.owner&&['owner','offset','limit'].every(key=>left[key]===result[key])?left:{symbol:path});
      }
      if(value.kind==='binary'||value.kind==='stringConcat') {
        // Strict binary operations require normal completion in operand order.
        const left=child('left');if(left.terminal)return left;
        const right=child('right');if(right.terminal)return right;
        return ['===','!=='].includes(value.operator)?{symbol:path,truth:predicateTruth(value,path)}:{symbol:path};
      }
      if(['unary','fieldAccess','stringLength','stringIndex','stringSlice'].includes(value.kind)) {
        const operand=child(value.kind==='unary'?'operand':'receiver');
        if(operand.terminal)return operand;
        if(value.kind==='stringIndex') {
          const index=child('index');
          if(index.terminal)return index;
        }else if(value.kind==='stringSlice') {
          for(const [index,item] of value.arguments.entries()) {
            const argument=expression(item,path+'/arguments/'+index,state,bindings,root);
            if(argument.terminal)return argument;
          }
        }
        return {symbol:path};
      }
      if(value.kind==='fieldAssignment'||value.kind==='fieldUpdate') {
        const receiver=expression(value.target.receiver,path+'/target/receiver',state,bindings,root);
        if(receiver.terminal)return receiver;
        if(value.kind==='fieldUpdate')return {symbol:path};
        if(isFieldNullishAssignment(value)){
          const {present,absent}=collectAll?{present:true,absent:true}:presence(path+'/old-value');
          if(!absent)return {symbol:path};
          if(!present)return child('value');
          const memory=clone(state),locals=copyBindings(bindings);
          const rhs=expression(value.value,path+'/value',memory,locals);
          if(rhs.terminal)return {symbol:path};
          const merged=join(state,memory);state.clear();for(const [id,row]of merged){charge();state.set(id,row);}
          meetBindings(bindings,bindings,locals);
          return {symbol:path};
        }
        const rhs=child('value');
        if(rhs.terminal)return rhs;
        if(finiteNumericUse(value)){const stop=terminalNumericUse(path);if(stop)return stop;}
        // The successful assignment yields the RHS Array or view without writing an Array slot.
        return {owner:rhs.owner,offset:rhs.offset,limit:rhs.limit,symbol:path};
      }
      if(value.kind==='construct'||value.kind==='superConstruct') {
        const superCall=value.kind==='superConstruct';
        for(const [index,item] of (value.arguments??[]).entries()) {
          const argument=expression(item,path+'/arguments/'+index,state,bindings,superCall?'superArgument':root);
          if(argument.terminal){
            if(superCall&&recordReads){charge();failedSuperArguments.set(path,{index,trap:argument.trap});}
            return argument;
          }
        }
        if(!collectAll&&terminalNumericConstructions.has(value.construction)){
          numericFailure=true;
          return {terminal:true,trap:path,numeric:true};
        }
        invalidate(state);
        if(superCall){
          if(!collectAll&&failedConstructions.has(value.construction))return {terminal:true,trap:path};
          const failure=initialize(value.afterSuccess,path,state,bindings);
          if(failure)return failure;
        }
        return {symbol:path};
      }
      // Unmodeled aliases never acquire an owner identity. Still traverse all
      // real evaluation children and conservatively discard mutating effects.
      if(value.target)for(const name of ['receiver','index'])if(value.target[name]){
        const result=expression(value.target[name],path+'/target/'+name,state,bindings);
        if(result.numeric)return result;
      }
      for(const name of ['receiver','operand','left','right','index','value'])if(value[name]){
        const result=child(name,false);
        if(result.numeric)return result;
      }
      for(const [index,item] of (value.arguments??[]).entries()){
        const result=expression(item,path+'/arguments/'+index,state,bindings);
        if(result.numeric)return result;
      }
      return {symbol:path};
    }
    // A representation-changing adaptation emits domain.view, which is not
    // Boolean value authority for ControlPaths. Never infer truth from type.
    function adapt(value,from,to) {
      charge();if(value.truth!==undefined&&carriers.get(from)!==carriers.get(to)){const {truth,...rest}=value;return rest;}return value;
    }
    function bindingValue(value,from,binding,type) {
      const adapted=adapt(value,from,fn.id+'/binding/'+binding);
      return plan.localNumericInputs?.size&&type===i32TypeId?{...adapted,valueNode:value.valueNode??from}:adapted;
    }
    function forgetTruth(bindings) {
      for(const [id,value] of bindings){charge();const {truth,...rest}=value;bindings.set(id,rest);}
    }
    function forgetAssignedTruth(root,bindings) {
      const stack=[root];while(stack.length) {
        charge();const value=stack.pop();if(!value||typeof value!=='object')continue;
        if(value.kind==='assignment'&&bindings.has(value.target.binding)) {
          const {truth,...rest}=bindings.get(value.target.binding);bindings.set(value.target.binding,rest);
        }
        for(const child of Object.values(value)){charge();if(child&&typeof child==='object')stack.push(child);}
      }
    }
    function conditionEffects(value,path,state,bindings,terminalRoot) {
      if(collectAll)return;
      let numericTerminal=false;
      const branches=finiteBranchEffects(value,path,{state,bindings},(value,path,entry)=>{
        const state=clone(entry.state),bindings=copyBindings(entry.bindings);
        const result=expression(value,path,state,bindings,terminalRoot);
        numericTerminal||=Boolean(result.numeric);
        if(result.terminal)return {yes:null,no:null};
        // The emitter preserves both outcomes in a call-bearing condition.
        const exit={state,bindings};
        return {yes:exit,no:exit};
      },(left,right)=>{
        if(!left)return right;if(!right)return left;
        const bindings=new Map();meetBindings(bindings,left.bindings,right.bindings);
        return {state:join(left.state,right.state),bindings};
      },charge);
      return branches&&{...branches,numericTerminal:numericTerminal&&!branches.yes&&!branches.no};
    }
    function initialize(statement,site,state,bindings) {
      inInitializer=true;
      let failure=null;
      for(const init of types.get(statement.ownerType).construction.initialization)if(init.value) {
        const initializer='construction/'+statement.construction+'/initialization/'+init.field;
        const result=expression(init.value,initializer,state,bindings,'initializer');
        if(!result.terminal)continue;
        if(recordReads){charge();failedInitializers.set(site,{node:initializer,trap:result.trap});}
        failure=result;break;
      }
      inInitializer=false;
      return failure;
    }
    function statements(body,path,state,bindings) {
      for(const [index,row] of body.entries()) {
        charge();const p=path+'/'+index;
        if(row.kind==='local') {
          const value=expression(row.initializer,p+'/initializer',state,bindings,true);
          if(value.terminal)return null;
          bindings.set(row.binding.id,bindingValue(value,p+'/initializer',row.binding.id,row.binding.type));
        }else if(row.kind==='expression') {
          if(expression(row.expression,p+'/expression',state,bindings,true,true).terminal)return null;
        }
        else if(row.kind==='return'||row.kind==='constructorReturn') {
          if(row.value&&expression(row.value,p+'/value',state,bindings,row.kind==='return').terminal)return null;
          exits.push(clone(state));return null;
        }
        else if(row.kind==='block') {state=statements(row.body,p+'/body',state,bindings);if(!state)return null;}
        else if(row.kind==='if') {
          let branches=conditionEffects(row.condition,p+'/condition',state,bindings,true);
          if(!branches) {
            const condition=expression(row.condition,p+'/condition',state,bindings,true);
            if(condition.terminal)return null;
            const truth=collectAll?undefined:condition.truth??booleanLiteral(row.condition,charge)?.value;
            const entry={state,bindings};
            branches={yes:truth===false?null:entry,no:truth===true?null:entry,numericTerminal:false};
          }
          const {yes,no}=branches;
          const a=yes?copyBindings(yes.bindings):bindings,b=no?copyBindings(no.bindings):bindings;
          const left=yes?statements(row.then,p+'/then',clone(yes.state),a):null,
            right=no?statements(row.else??[],p+'/else',clone(no.state),b):null;
          state=join(left,right);if(!state)return null;
          meetBindings(bindings,a,b,!!left,!!right);forgetTruth(bindings);
        }else if(row.kind==='while') {
          // Header phis are not a pre-loop binding's literal value. A direct
          // literal or independently solved actual presence can cut the body;
          // pending/empty evidence keeps the original conservative loop.
          forgetTruth(bindings);
          const truth=collectAll?undefined:predicateTruth(row.condition,p+'/condition');
          const condition=p+'/condition';
          if(truth===false) {
            if(expression(row.condition,condition,state,bindings,true).terminal)return null;
            continue;
          }
          if(returnsBeforeBackedge(row.body)) {
            // The checked statements have no break or continue. The body may
            // contribute a function exit, but only the skipped edge reaches
            // the next statement and it keeps the condition's effects.
            const branches=conditionEffects(row.condition,condition,state,bindings,true);
            if(branches) {
              if(branches.yes)statements(row.body,p+'/body',clone(branches.yes.state),copyBindings(branches.yes.bindings));
              if(!branches.no)return null;
              state=branches.no.state;meetBindings(bindings,branches.no.bindings,branches.no.bindings);
              continue;
            }
            if(expression(row.condition,condition,state,bindings,true).terminal)return null;
            statements(row.body,p+'/body',clone(state),copyBindings(bindings));
            if(truth===true)return null;
            continue;
          }
          if(!collectAll&&checkedLoopConditions.has(row.condition)) {
            // A failed first entry prevents backedges altogether. A successful
            // probe publishes nothing to the recurring header or to callees.
            const entry=analyze(fn,clone(state),copyBindings(bindings),false,false,false,{value:row.condition,path:condition});
            if(entry.complete&&!entry.productive&&expression(row.condition,condition,state,bindings,true).terminal)return null;
          }
          invalidate(state);for(const id of bindings.keys()){charge();bindings.set(id,{});}
          const branches=conditionEffects(row.condition,condition,state,bindings,false);
          if(branches) {
            if(branches.numericTerminal)return null;
            if(branches.yes)statements(row.body,p+'/body',clone(branches.yes.state),copyBindings(branches.yes.bindings));
          }else {
            if(expression(row.condition,condition,state,bindings).numeric)return null;
            statements(row.body,p+'/body',clone(state),copyBindings(bindings));
          }
          invalidate(state);
          if(truth===true)return null;
        }else if(row.kind==='initializeOwnFields') {
          if(initialize(row,p,state,bindings))return null;
        }else if(row.kind==='forwardBaseConstruction'){
          if(!collectAll&&failedConstructions.has(row.construction)){
            numericFailure||=terminalNumericConstructions.has(row.construction);
            return null;
          }
          invalidate(state);
        }
      }return state;
    }
    if(firstCondition) {
      const productive=!expression(firstCondition.value,firstCondition.path,initial,env,true).terminal;
      return {state:initial,complete,productive,invalidateAll,mutated};
    }
    const fallthrough=statements(fn.body,fn.id+'/body',initial,env);if(fallthrough)exits.push(fallthrough);
    let result=null;for(const exit of exits){charge();result=result?join(result,exit):exit;}
    // A nonproductive recursive/divergent path is not an initialized-state
    // witness. Unresolved contextual dependencies retain pending rather than an
    // unbounded HIR walk or a made-up normal return.
    if(!result){invalidate(initial);return {state:initial,complete,productive:false,invalidateAll,mutated,numericFailure};}
    return {state:result,complete,productive:true,invalidateAll,mutated};
  }
  // Canonical Source versions stay isolated from contextual return transfers.
  // Begin every real incoming site unknown; meet all sites before importing a
  // function's memory or literal index facts. Host/method entries stay unknown.
  for(const fn of functions)analyze(fn,new Map(),parameters(fn),false,true,true);
  const canonicalReads=new Map();for(const [id,row] of reads){charge();canonicalReads.set(id,{...row,status:'pending',versions:[],sources:[]});}
  const exported=new Set(hir.exports.map(row=>row.functionId));
  function ledger() {
    const snapshot=[];for(const [target,sites] of contextsByTarget)for(const [site,row] of sites) {
      charge();const state=[];for(const [owner,memory] of row.state) {
        charge();const slots=[];for(const [key,versions] of memory.slots) {
          charge();const values=[];for(const version of versions){charge();values.push(version);}values.sort((a,b)=>{charge();return a<b?-1:a>b?1:0;});slots.push([key,values]);
        }slots.sort(([a],[b])=>{charge();return a<b?-1:a>b?1:0;});state.push([owner,memory.length,slots]);
      }state.sort(([a],[b])=>{charge();return a<b?-1:a>b?1:0;});
      const constants=[];for(const pair of row.constants){charge();constants.push(pair);}constants.sort(([a],[b])=>{charge();return a<b?-1:a>b?1:0;});
      const truths=[];for(const pair of row.truths??[]){charge();truths.push(pair);}truths.sort(([a],[b])=>{charge();return a<b?-1:a>b?1:0;});
      snapshot.push([site,target,row.possible,state,constants,truths]);
    }return canonical(snapshot);
  }
  let before;
  do {
    charge();before=ledger();reads.clear();normalReadSources.clear();failedInitializers.clear();failedConstructions.clear();failedSuperArguments.clear();
    terminalNumericUses.clear();terminalNumericConstructions.clear();localNumericSources.clear();
    contextWrites=new Map();terminalReads=null;
    for(const [id,row] of canonicalReads){charge();reads.set(id,row);}
    for(const fn of ordered) {
      const incoming=[];
      for(const row of contextsByTarget.get(fn.id)?.values()??[]){charge();if(row.possible)incoming.push(row);}
      if(exported.has(fn.id)||fn.ownerType||!incoming.length)incoming.push({state:new Map(),constants:new Map()});
      let state;for(const row of incoming){charge();state=state?join(state,row.state):clone(row.state);}
      const outcome=analyze(fn,state,parameters(fn,incoming),true);
      if(fn.role==='construction-body'&&outcome.complete&&!outcome.productive){
        charge();failedConstructions.add(fn.construction);
        if(outcome.numericFailure)terminalNumericConstructions.add(fn.construction);
      }
    }
    for(const sites of contextsByTarget.values())for(const site of sites.keys()){
      charge();sites.set(site,contextWrites.get(site)??{possible:false,state:new Map(),constants:new Map(),truths:new Map()});
    }
  }while(before!==ledger());
  const reaching=own({reads:[...reads.values()].sort((a,b)=>a.node<b.node?-1:1),writes:[...writes.values()].sort((a,b)=>a.id<b.id?-1:1),
    qualification:'ordered successful version sources; unresolved indices/aliases/callee effects remain pending; no independent runtime guard or borrow admission'});
  return {reaching,terminalReads,normalReadSources,failedInitializers,failedConstructions,failedSuperArguments,
    terminalNumericUses,terminalNumericConstructions,localNumericSources};
}
