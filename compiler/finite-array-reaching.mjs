// SPDX-License-Identifier: MIT
// Ordered version constraints over checked owned HIR, not payload evaluation.
// Unknown aliases/callees retain pending; capacity bounds remain independent.
import {canonical,own} from './identity.mjs';
import {finiteCallables} from './finite-callables.mjs';
import {finitePresence} from './finite-presence.mjs';

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

export function buildFiniteArrayReaching(hir,plan,charge) {
  const functions=finiteCallables(hir),byFunction=new Map(functions.map(fn=>[fn.id,fn])),types=new Map(hir.types.map(row=>[row.id,row])),
    calls=new Map(plan.calls.map(row=>[row.id,row])),
    aliases=new Map((plan.fieldReaching?.returnAliases??[]).map(row=>[row.functionId,row.parameter])),
    effects=new Map(functions.map(fn=>[fn.id,{writes:false,callees:new Set()}])),writes=new Map(),reads=new Map(),contexts=new Map(),
    presence=finitePresence(plan,types,charge),carriers=new Map();
  for(const row of plan.carrierNodes??plan.nodes){charge();carriers.set(row.id,row.domainId);}
  let contextWrites=new Map();
  function arrayCarrier(id) {
    const stack=[id],seen=new Set();while(stack.length) {
      charge();const current=stack.pop();if(seen.has(current))continue;seen.add(current);const type=types.get(current);
      if(type.kind==='array'||type.kind==='readSpan')return true;if(type.kind==='union')stack.push(...type.members);
    }return false;
  }
  for(const fn of functions) {
    const stack=[{value:fn.body,path:fn.id+'/body'}],effect=effects.get(fn.id);
    if(fn.role==='construction-body')for(const row of types.get(fn.ownerType).construction.initialization)
      if(row.value)stack.push({value:row.value,path:'construction/'+fn.construction+'/initialization/'+row.field});
    while(stack.length) {
      charge();const {value,path}=stack.pop();if(!value||typeof value!=='object')continue;
      if(['arrayStoreDenseChecked','arrayResizeChecked','arrayCompoundAssignment','arrayUpdate'].includes(value.kind))effect.writes=true;
      if(value.kind==='call')for(const id of value.receiver?(calls.get(path)?.targets??[]).map(row=>row.functionId):[value.target]) {
        if(id!==hir.intrinsics.readSpan.id){effect.callees.add(id);contexts.set(path+'\0'+id,{target:id,possible:true,state:new Map(),constants:new Map()});}
      }
      if(value.kind==='construct'||value.kind==='superConstruct')effect.writes=true;
      for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')stack.push({value:child,path:path+'/'+key});
    }
  }
  let changed=true;
  while(changed) {changed=false;for(const row of effects.values())if(!row.writes)for(const id of row.callees) {
    charge();if(!effects.has(id)||effects.get(id).writes){row.writes=true;changed=true;break;}
  }}
  const clone=state=>copyArrayReachingState(state,charge);
  function copyBindings(bindings) {
    const result=new Map();for(const [id,value] of bindings){charge();result.set(id,value);}return result;
  }
  function meetBindings(target,left,right,leftLive=true,rightLive=true) {
    const keys=new Set(),result=new Map();
    for(const side of [left,right])for(const id of side.keys()){charge();keys.add(id);}
    for(const id of keys) {
      charge();const a=left.get(id),b=right.get(id),same=a&&b&&
        ['owner','constant','symbol','offset','limit','truth'].every(key=>a[key]===b[key]);
      result.set(id,!leftLive?b:!rightLive?a:same?a:{});
    }
    target.clear();for(const [id,value] of result){charge();target.set(id,value);}
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
  function parameters(fn,incoming=[]) {
    const env=new Map();for(const parameter of fn.parameters) {
      let constant;for(const [index,row] of incoming.entries()) {
        charge();const candidate=row.constants.get(parameter.id);if(index===0)constant=candidate;else if(constant!==candidate)constant=undefined;
      }
      charge();env.set(parameter.id,{symbol:fn.id+'/parameter/'+parameter.id,
        ...(arrayCarrier(parameter.type)?{owner:fn.id+'/parameter/'+parameter.id}:{}),...(constant!==undefined?{constant}:{})});
    }return env;
  }
  function predicateTruth(value,path) {
    charge();if(value.kind==='boolean')return value.value;
    if(value.kind!=='binary'||!['===','!=='].includes(value.operator))return undefined;
    let classified;
    if(['undefined','null'].includes(value.right.kind))classified=presence(path+'/left',value.right.kind);
    else if(['undefined','null'].includes(value.left.kind))classified=presence(path+'/right',value.left.kind);
    return classified&&classified.present!==classified.absent?(value.operator==='==='?classified.absent:classified.present):undefined;
  }
  function analyze(fn,initial,env,active,applyCalls,recordReads=true,collectAll=false) {
    const exits=[];
    const origin=value=>({source:fn.sourcePath,...value.range});
    const key=index=>index?.constant!==undefined?'c:'+index.constant:index?.symbol?'s:'+index.symbol:null;
    function version(path,value,node,owner,index,kind) {
      const id=path+'/array-version';charge();
      // Canonical source bindings are collected independently in the first
      // pass. Contextual application never rewrites that version's identity.
      if(!writes.has(id))writes.set(id,{id,node,owner,index,kind,origin:origin(value)});return id;
    }
    function invalidate(state) {for(const row of state.values()){charge();row.slots.clear();row.length=null;}}
    function load(value,path,state,receiver,index) {
      const memory=state.get(receiver?.owner),slot=key(index),missing=memory?.length!==null&&memory?.length!==undefined&&
        index?.constant!==undefined&&index.constant>=memory.length,
        bounds=receiver?.limit!==undefined&&index?.constant!==undefined&&index.constant>=receiver.limit;
      let versions=slot?memory?.slots.get(slot):null;
      if(receiver?.offset) {
        versions=index?.constant!==undefined?memory?.slots.get('c:'+(index.constant+receiver.offset)):null;
      }
      const status=missing||bounds?'missing':versions?.size?'proven':'pending';
      if(recordReads)reads.set(path,{node:path,owner:receiver?.owner??null,index:slot,status,
        versions:status==='proven'?[...versions].sort():[],sources:status==='proven'?[...new Set([...versions].map(id=>writes.get(id).node))].sort():[],origin:origin(value)});
      return {symbol:path};
    }
    function store(value,path,node,state,receiver,index) {
      const id=version(path,value,node,receiver?.owner??null,key(index),'store');
      if(!receiver?.owner){invalidate(state);return;}
      if(!state.has(receiver.owner))state.set(receiver.owner,{length:null,slots:new Map()});
      const memory=state.get(receiver.owner),slot=key(index);
      if(!slot){invalidate(state);return;}
      // Distinct parameters are not noalias evidence. A fresh allocation is
      // distinct until it is exposed to an unknown modifying call.
      if(receiver.owner.includes('/parameter/'))for(const [owner,row] of state)
        if(owner!==receiver.owner&&owner.includes('/parameter/')){charge();row.slots.clear();row.length=null;}
      if(index.constant!==undefined&&memory.length!==null) {
        if(index.constant>memory.length){memory.slots.clear();memory.length=null;return;}
        if(index.constant===memory.length)memory.length++;
      }
      // A symbolic index can alias any constant/other symbolic slot. Keep the
      // definitely just-written index; discard unsupported separation facts.
      if(index.constant===undefined)memory.slots.clear();
      else for(const other of memory.slots.keys())if(other.startsWith('s:'))memory.slots.delete(other);
      memory.slots.set(slot,new Set([id]));
    }
    function expression(value,path,state,bindings) {
      if(!value)return {};charge();const child=name=>expression(value[name],path+'/'+name,state,bindings);
      if(value.kind==='reference')return adapt(bindings.get(value.binding)??{symbol:fn.id+'/parameter/'+value.binding},fn.id+'/binding/'+value.binding,path);
      if(['group','nonNull','assertType'].includes(value.kind)) {const {truth,...result}=child('operand');return result;}
      if(value.kind==='boolean')return {truth:value.value,symbol:path};
      if(value.kind==='constant') {
        const number=Number(value.decimal);return Number.isInteger(number)&&number>=0&&number<=4294967295?{constant:number,symbol:path}:{symbol:path};
      }
      if(value.kind==='arrayCreate') {
        const slots=new Map();for(const [index,item] of value.elements.entries()) {
          expression(item,path+'/elements/'+index,state,bindings);
          slots.set('c:'+index,new Set([version(path+'/initial/'+index,item,path+'/elements/'+index,path,'c:'+index,'initial')]));
        }
        state.set(path,{length:value.elements.length,slots});return {owner:path,symbol:path};
      }
      if(value.kind==='arrayReadChecked') {
        const receiver=child('receiver'),index=child('index');return load(value,path,state,receiver,index);
      }
      if(['arrayStoreDenseChecked','arrayCompoundAssignment','arrayUpdate','arrayResizeChecked'].includes(value.kind)) {
        const receiver=expression(value.target.receiver,path+'/target/receiver',state,bindings),
          index=value.target.index?expression(value.target.index,path+'/target/index',state,bindings):null;
        if(value.kind==='arrayCompoundAssignment'||value.kind==='arrayUpdate')load({...value,range:value.target.range},path+'/old-value',state,receiver,index);
        const rhs=value.value?child('value'):{symbol:path};
        if(value.kind==='arrayResizeChecked') {
          const memory=state.get(receiver.owner);
          if(!memory){invalidate(state);return rhs;}
          if(rhs.constant!==undefined&&memory.length!==null&&rhs.constant<=memory.length) {
            memory.length=rhs.constant;for(const slot of memory.slots.keys())if(!slot.startsWith('c:')||Number(slot.slice(2))>=rhs.constant)memory.slots.delete(slot);
          }else {memory.slots.clear();memory.length=null;}
          return rhs;
        }
        store(value,path,value.kind==='arrayStoreDenseChecked'?path+'/value':path,state,receiver,index);
        return value.kind==='arrayStoreDenseChecked'?rhs:{symbol:path};
      }
      if(value.kind==='assignment') {const rhs=child('value');bindings.set(value.target.binding,adapt(rhs,path+'/value',fn.id+'/binding/'+value.target.binding));return rhs;}
      if(value.kind==='arrayLength'||value.kind==='readSpanLength') {
        const receiver=child('receiver'),length=receiver.limit??state.get(receiver.owner)?.length;
        return length!==undefined&&length!==null?{constant:length,symbol:path}:{symbol:path};
      }
      if(value.kind==='call') {
        const receiver=value.receiver?child('receiver'):null,args=(value.arguments??[]).map((item,index)=>expression(item,path+'/arguments/'+index,state,bindings));
        if(value.target===hir.intrinsics.readSpan.id) {
          const [owner,start,length]=args;
          const available=owner?.limit??state.get(owner?.owner)?.length;
          return owner?.owner&&start?.constant!==undefined&&length?.constant!==undefined&&
            available!==undefined&&available!==null&&start.constant+length.constant<=available?
            {owner:owner.owner,offset:(owner.offset??0)+start.constant,limit:length.constant,symbol:path}:{};
        }
        const targets=[];let unknown=false,modifies=false,recursive=false,ordinal,consistent=true;
        if(receiver)for(const target of calls.get(path)?.targets??[]){charge();targets.push(target.functionId);}
        else {charge();targets.push(value.target);}
        for(const [index,id] of targets.entries()) {
          charge();unknown||=!effects.has(id);modifies||=effects.get(id)?.writes??false;recursive||=active.has(id);
          const returned=aliases.get(id);if(index===0)ordinal=returned;else consistent&&=ordinal===returned;
        }
        const actual=[];if(receiver){charge();actual.push(receiver);}for(const arg of args){charge();actual.push(arg);}
        // A definition's read obligations meet every real caller's incoming
        // state. This is distinct from applying a callee's return transfer to
        // this caller; contextual visits cannot overwrite canonical contexts.
        if(recordReads&&!collectAll)for(const id of targets) {
          charge();const callee=byFunction.get(id);if(!callee)continue;
          const incoming=new Map(),constants=new Map();
          for(const [index,parameter] of callee.parameters.entries()) {
            charge();const argument=actual[index];if(argument?.constant!==undefined)constants.set(parameter.id,argument.constant);
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
          contextWrites.set(path+'\0'+id,{target:id,possible:true,state:incoming,constants});
        }
        if(!targets.length||unknown)invalidate(state);
        else if(modifies) {
          if(!applyCalls||recursive)invalidate(state);
          else {
            let merged;
            for(const id of targets) {
              charge();const callee=byFunction.get(id),local=new Map(),nextActive=new Set();
              for(const parent of active){charge();nextActive.add(parent);}nextActive.add(id);
              for(const [index,parameter] of callee.parameters.entries()) {
                charge();local.set(parameter.id,actual[index]??{});
              }
              const result=analyze(callee,clone(state),local,nextActive,true,false);
              merged=merged?join(merged,result):result;
            }
            state.clear();for(const [id,row] of merged){charge();state.set(id,row);}
          }
        }
        return ordinal!==null&&ordinal!==undefined&&consistent?actual[ordinal]??{}:{symbol:path};
      }
      if(value.kind==='shortCircuit'||value.kind==='binary'&&['&&','||','??'].includes(value.operator)) {
        const left=child('left'),possibilities=collectAll?{present:true,absent:true}:value.operator==='??'?presence(path+'/left'):
          {present:left.truth===undefined||left.truth===(value.operator==='||'),absent:left.truth===undefined||left.truth===(value.operator==='&&')};
        const resultValue=result=>{if(value.operator!=='??')forgetAssignedTruth(value.right,bindings);
          return value.operator==='??'?adapt(result,result.symbol,path):{symbol:path};};
        if(!possibilities.absent)return resultValue(left);
        if(!possibilities.present)return resultValue(child('right'));
        const right=clone(state),branchBindings=copyBindings(bindings),
          result=expression(value.right,path+'/right',right,branchBindings);
        const merged=join(state,right);state.clear();for(const [id,row] of merged){charge();state.set(id,row);}
        meetBindings(bindings,bindings,branchBindings);
        return resultValue(value.operator==='??'&&left.owner&&['owner','offset','limit'].every(key=>left[key]===result[key])?left:{symbol:path});
      }
      if(value.kind==='binary'&&['===','!=='].includes(value.operator)) {
        child('left');child('right');return {symbol:path,truth:predicateTruth(value,path)};
      }
      // Unmodeled aliases never acquire an owner identity. Still traverse all
      // real evaluation children and conservatively discard mutating effects.
      if(value.target)for(const name of ['receiver','index'])if(value.target[name])expression(value.target[name],path+'/target/'+name,state,bindings);
      for(const name of ['receiver','operand','left','right','index','value'])if(value[name])child(name);
      for(const [index,item] of (value.arguments??[]).entries())expression(item,path+'/arguments/'+index,state,bindings);
      if(['construct','superConstruct','fieldAssignment','fieldUpdate','update'].includes(value.kind))invalidate(state);
      return {symbol:path};
    }
    // A representation-changing adaptation emits domain.view, which is not
    // Boolean value authority for ControlPaths. Never infer truth from type.
    function adapt(value,from,to) {
      charge();if(value.truth!==undefined&&carriers.get(from)!==carriers.get(to)){const {truth,...rest}=value;return rest;}return value;
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
    function statements(body,path,state,bindings) {
      for(const [index,row] of body.entries()) {
        charge();const p=path+'/'+index;
        if(row.kind==='local')bindings.set(row.binding.id,adapt(expression(row.initializer,p+'/initializer',state,bindings),p+'/initializer',fn.id+'/binding/'+row.binding.id));
        else if(row.kind==='expression')expression(row.expression,p+'/expression',state,bindings);
        else if(row.kind==='return'||row.kind==='constructorReturn') {
          if(row.value)expression(row.value,p+'/value',state,bindings);exits.push(clone(state));return null;
        }
        else if(row.kind==='block') {state=statements(row.body,p+'/body',state,bindings);if(!state)return null;}
        else if(row.kind==='if') {
          const condition=expression(row.condition,p+'/condition',state,bindings),a=copyBindings(bindings),b=copyBindings(bindings),
            left=!collectAll&&condition.truth===false?null:statements(row.then,p+'/then',clone(state),a),
            right=!collectAll&&condition.truth===true?null:statements(row.else??[],p+'/else',clone(state),b);
          state=join(left,right);if(!state)return null;
          meetBindings(bindings,a,b,!!left,!!right);forgetTruth(bindings);
        }else if(row.kind==='while') {
          // Header phis are not a pre-loop binding's literal value. A direct
          // literal or independently solved actual presence can cut the body;
          // pending/empty evidence keeps the original conservative loop.
          forgetTruth(bindings);
          const truth=collectAll?undefined:predicateTruth(row.condition,p+'/condition');
          if(truth===false) {
            expression(row.condition,p+'/condition',state,bindings);continue;
          }
          invalidate(state);for(const id of bindings.keys()){charge();bindings.set(id,{});}
          expression(row.condition,p+'/condition',state,bindings);statements(row.body,p+'/body',clone(state),copyBindings(bindings));invalidate(state);
          if(truth===true)return null;
        }else if(row.kind==='initializeOwnFields') {
          for(const init of types.get(row.ownerType).construction.initialization)if(init.value)
            expression(init.value,'construction/'+row.construction+'/initialization/'+init.field,state,bindings);
        }else if(row.kind==='forwardBaseConstruction')invalidate(state);
      }return state;
    }
    const fallthrough=statements(fn.body,fn.id+'/body',initial,env);if(fallthrough)exits.push(fallthrough);
    let result=null;for(const exit of exits){charge();result=result?join(result,exit):exit;}
    // A nonproductive recursive/divergent path is not an initialized-state
    // witness. The active-call guard above retains pending rather than an
    // unbounded HIR walk or a made-up normal return.
    if(!result){invalidate(initial);return initial;}return result;
  }
  // Canonical Source versions stay isolated from contextual return transfers.
  // Begin every real incoming site unknown; meet all sites before importing a
  // function's memory or literal index facts. Host/method entries stay unknown.
  for(const fn of functions)analyze(fn,new Map(),parameters(fn),new Set([fn.id]),false,true,true);
  const canonicalReads=new Map();for(const [id,row] of reads){charge();canonicalReads.set(id,{...row,status:'pending',versions:[],sources:[]});}
  const exported=new Set(hir.exports.map(row=>row.functionId));
  function ledger() {
    const snapshot=[];for(const [site,row] of contexts) {
      charge();const state=[];for(const [owner,memory] of row.state) {
        charge();const slots=[];for(const [key,versions] of memory.slots) {
          charge();const values=[];for(const version of versions){charge();values.push(version);}values.sort((a,b)=>{charge();return a<b?-1:a>b?1:0;});slots.push([key,values]);
        }slots.sort(([a],[b])=>{charge();return a<b?-1:a>b?1:0;});state.push([owner,memory.length,slots]);
      }state.sort(([a],[b])=>{charge();return a<b?-1:a>b?1:0;});
      const constants=[];for(const pair of row.constants){charge();constants.push(pair);}constants.sort(([a],[b])=>{charge();return a<b?-1:a>b?1:0;});
      snapshot.push([site,row.target,row.possible,state,constants]);
    }return canonical(snapshot);
  }
  let before;
  do {
    charge();before=ledger();reads.clear();contextWrites=new Map();
    for(const [id,row] of canonicalReads){charge();reads.set(id,row);}
    for(const fn of functions) {
      const incoming=[];for(const row of contexts.values()){charge();if(row.target===fn.id&&row.possible)incoming.push(row);}
      if(exported.has(fn.id)||fn.ownerType||!incoming.length)incoming.push({state:new Map(),constants:new Map()});
      let state;for(const row of incoming){charge();state=state?join(state,row.state):clone(row.state);}
      analyze(fn,state,parameters(fn,incoming),new Set([fn.id]),true);
    }
    for(const [site,row] of contexts){charge();contexts.set(site,contextWrites.get(site)??{target:row.target,possible:false,state:new Map(),constants:new Map()});}
  }while(before!==ledger());
  return own({reads:[...reads.values()].sort((a,b)=>a.node<b.node?-1:1),writes:[...writes.values()].sort((a,b)=>a.id<b.id?-1:1),
    qualification:'ordered successful version sources; unresolved indices/aliases/callee effects remain pending; no independent runtime guard or borrow admission'});
}
