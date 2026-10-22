// SPDX-License-Identifier: MIT
// Ordered version constraints over checked owned HIR, not payload evaluation.
// Unknown aliases/callees retain pending; capacity bounds remain independent.
import {own} from './identity.mjs';
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
  const functions=finiteCallables(hir),types=new Map(hir.types.map(row=>[row.id,row])),
    calls=new Map(plan.calls.map(row=>[row.id,row])),
    aliases=new Map((plan.fieldReaching?.returnAliases??[]).map(row=>[row.functionId,row.parameter])),
    effects=new Map(functions.map(fn=>[fn.id,{writes:false,callees:new Set()}])),writes=new Map(),reads=new Map(),
    presence=finitePresence(plan,types,charge);
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
        if(id!==hir.intrinsics.readSpan.id)effect.callees.add(id);
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
        ['owner','constant','symbol','offset','limit'].every(key=>a[key]===b[key]);
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
  for(const fn of functions) {
    const initial=new Map(),env=new Map(fn.parameters.map(parameter=>[parameter.id,{symbol:fn.id+'/parameter/'+parameter.id,
      ...(arrayCarrier(parameter.type)?{owner:fn.id+'/parameter/'+parameter.id}:{})}]));
    const origin=value=>({source:fn.sourcePath,...value.range});
    const key=index=>index?.constant!==undefined?'c:'+index.constant:index?.symbol?'s:'+index.symbol:null;
    function version(path,value,node,owner,index,kind) {
      const id=path+'/array-version';charge();writes.set(id,{id,node,owner,index,kind,origin:origin(value)});return id;
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
      reads.set(path,{node:path,owner:receiver?.owner??null,index:slot,status,
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
      if(value.kind==='reference')return bindings.get(value.binding)??{symbol:fn.id+'/parameter/'+value.binding};
      if(['group','nonNull','assertType'].includes(value.kind))return child('operand');
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
      if(value.kind==='assignment') {const rhs=child('value');bindings.set(value.target.binding,rhs);return rhs;}
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
        const targets=value.receiver?(calls.get(path)?.targets??[]).map(row=>row.functionId):[value.target];
        if(!targets.length||targets.some(id=>!effects.has(id)||effects.get(id).writes))invalidate(state);
        const ordinals=targets.map(id=>aliases.get(id)),ordinal=ordinals[0],actual=receiver?[receiver,...args]:args;
        return ordinal!==null&&ordinal!==undefined&&ordinals.every(index=>index===ordinal)?actual[ordinal]??{}:{symbol:path};
      }
      if(value.kind==='shortCircuit'||value.kind==='binary'&&['&&','||','??'].includes(value.operator)) {
        const left=child('left'),possibilities=value.operator==='??'?presence(path+'/left'):{present:true,absent:true};
        if(!possibilities.absent)return left;
        if(!possibilities.present)return child('right');
        const right=clone(state),branchBindings=copyBindings(bindings),
          result=expression(value.right,path+'/right',right,branchBindings);
        const merged=join(state,right);state.clear();for(const [id,row] of merged){charge();state.set(id,row);}
        meetBindings(bindings,bindings,branchBindings);
        return value.operator==='??'&&left.owner&&['owner','offset','limit'].every(key=>left[key]===result[key])?left:{symbol:path};
      }
      // Unmodeled aliases never acquire an owner identity. Still traverse all
      // real evaluation children and conservatively discard mutating effects.
      if(value.target)for(const name of ['receiver','index'])if(value.target[name])expression(value.target[name],path+'/target/'+name,state,bindings);
      for(const name of ['receiver','operand','left','right','index','value'])if(value[name])child(name);
      for(const [index,item] of (value.arguments??[]).entries())expression(item,path+'/arguments/'+index,state,bindings);
      if(['construct','superConstruct','fieldAssignment','fieldUpdate','update'].includes(value.kind))invalidate(state);
      return {symbol:path};
    }
    function statements(body,path,state,bindings) {
      for(const [index,row] of body.entries()) {
        charge();const p=path+'/'+index;
        if(row.kind==='local')bindings.set(row.binding.id,expression(row.initializer,p+'/initializer',state,bindings));
        else if(row.kind==='expression')expression(row.expression,p+'/expression',state,bindings);
        else if(row.kind==='return'||row.kind==='constructorReturn') {if(row.value)expression(row.value,p+'/value',state,bindings);return null;}
        else if(row.kind==='block') {state=statements(row.body,p+'/body',state,bindings);if(!state)return null;}
        else if(row.kind==='if') {
          expression(row.condition,p+'/condition',state,bindings);const a=copyBindings(bindings),b=copyBindings(bindings),
            left=statements(row.then,p+'/then',clone(state),a),right=statements(row.else??[],p+'/else',clone(state),b);
          state=join(left,right);if(!state)return null;
          meetBindings(bindings,a,b,!!left,!!right);
        }else if(row.kind==='while') {
          invalidate(state);for(const id of bindings.keys()){charge();bindings.set(id,{});}
          expression(row.condition,p+'/condition',state,bindings);statements(row.body,p+'/body',clone(state),copyBindings(bindings));invalidate(state);
        }else if(row.kind==='initializeOwnFields') {
          for(const init of types.get(row.ownerType).construction.initialization)if(init.value)
            expression(init.value,'construction/'+row.construction+'/initialization/'+init.field,state,bindings);
        }else if(row.kind==='forwardBaseConstruction')invalidate(state);
      }return state;
    }
    statements(fn.body,fn.id+'/body',initial,env);
  }
  return own({reads:[...reads.values()].sort((a,b)=>a.node<b.node?-1:1),writes:[...writes.values()].sort((a,b)=>a.id<b.id?-1:1),
    qualification:'ordered successful version sources; unresolved indices/aliases/callee effects remain pending; no independent runtime guard or borrow admission'});
}
