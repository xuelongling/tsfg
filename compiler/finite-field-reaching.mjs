// SPDX-License-Identifier: MIT
// Memory-version constraints, not value evaluation. A successful strong write
// through a definite receiver alias can qualify a later read; unknown alias or
// call effects retain the conservative whole-field domain.
import {canonical,own} from './identity.mjs';
import {finiteCallables} from './finite-callables.mjs';
import {finiteFieldPhases} from './finite-field-phases.mjs';

export function buildFiniteFieldReaching(hir,plan,charge) {
  const selections=new Map(plan.fields.map(row=>[row.id,row]));
  const calls=new Map(plan.calls.map(row=>[row.id,row]));
  const types=new Map(hir.types.map(type=>[type.id,type])),valueDomains=new Map();
  function copiesValue(id) {
    if(valueDomains.has(id))return valueDomains.get(id);
    const stack=[id],seen=new Set();let result=false;
    while(stack.length) {
      charge();const current=stack.pop();if(seen.has(current))continue;seen.add(current);
      const type=types.get(current);if(type.kind==='value'){result=true;break;}
      if(type.kind==='union')stack.push(...type.members);
    }
    valueDomains.set(id,result);return result;
  }
  const callables=finiteCallables(hir),phases=new Map(finiteFieldPhases(hir,charge).map(row=>[row.constructionId,row]));
  const functions=new Map(callables.map(fn=>[fn.id,fn]));
  const nodes=new Map((plan.nodes??[]).map(row=>[row.id,row])),domains=new Map((plan.domains??[]).map(row=>[row.id,row]));
  const actuals=id=>domains.get(nodes.get(id)?.domainId)?.actualTypes??[];
  const effects=new Map(callables.map(fn=>[fn.id,{writes:false,callees:new Set()}]));
  const writes=new Map(),reads=new Map(),phaseWrites=new Map(),allocationEntries=new Map(),completions=new Map(),contexts=new Map(),returnAliases=new Map(),outputs=new Map();
  for(const fn of callables) {
    const stack=[{value:fn.body,path:fn.id+'/body'}],effect=effects.get(fn.id);
    while(stack.length) {
      charge();const {value,path}=stack.pop();if(!value||typeof value!=='object')continue;
      if(['fieldAssignment','fieldUpdate','initializeOwnFields','superConstruct','construct'].includes(value.kind))effect.writes=true;
      if(value.kind==='call') {
        const targets=value.receiver?(calls.get(path)?.targets??[]).map(row=>row.functionId):[value.target];
        for(const target of targets)if(target!==hir.intrinsics.readSpan.id) {
          effect.callees.add(target);contexts.set(path+'\0'+target,{target,fields:new Map()});
        }
      }
      for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')
        stack.push({value:child,path:path+'/'+key});
    }
  }
  // Propagate effects across the actual selected call graph, including cycles.
  let changed=true;
  while(changed) {
    changed=false;
    for(const effect of effects.values())if(!effect.writes)for(const target of effect.callees) {
      charge();if(!effects.has(target)||effects.get(target).writes){effect.writes=true;changed=true;break;}
    }
  }
  const clone=state=>new Map([...state].map(([key,value])=>{charge();return [key,new Set(value)];}));
  function join(left,right) {
    if(!left)return right;if(!right)return left;
    const result=new Map();
    for(const [key,value] of left){charge();if(right.has(key))result.set(key,new Set([...value,...right.get(key)]));}
    return result;
  }
  // Direct-base completions are proved before derived bodies. This is an
  // ancestry order, not a fabricated constructor invocation or allocation.
  const depth=fn=>{let n=0,type=types.get(fn.ownerType);while(type?.base){charge();n++;type=types.get(type.base);}return n;};
  const ordered=[...callables].sort((a,b)=>(a.role==='construction-body'?0:1)-(b.role==='construction-body'?0:1)
    ||depth(a)-depth(b)||(a.id<b.id?-1:1));
  const exports=new Set((hir.exports??[]).map(row=>row.functionId));
  function ledger() {
    const snapshot={contexts:[...contexts].map(([id,row])=>({id,target:row.target,
      fields:[...row.fields].sort(([a],[b])=>a<b?-1:1).map(([key,versions])=>[key,[...versions].sort()])})),
      completions:[...completions],returnAliases:[...returnAliases],outputs:[...outputs]};
    /** @type {unknown[]} */
    const stack=[snapshot];while(stack.length) {
      charge();const row=stack.pop();if(row&&typeof row==='object')stack.push(...Object.values(row));
    }
    return canonical(snapshot);
  }
  // Start unknown at every real call site and every host entry. The meet is
  // over all such sites, including not-yet-analysed and recursive callers, so
  // one known caller cannot manufacture a dominance proof for another.
  let previous;
  do {
  charge();previous=ledger();
  for(const fn of ordered) {
    // R01 value assignment/parameters copy payload. They cannot inherit the
    // reference alias token used below. Their field versions remain at the
    // conservative bound until inline value memory SSA owns that proof.
    const aliases=new Map(fn.parameters.map(parameter=>[parameter.id,
      copiesValue(parameter.type)?null:fn.id+'/parameter/'+parameter.id]));
    const key=(token,target)=>token+'\0'+target.actualType+'\0'+target.fieldId;
    const receiver=fn.role==='construction-body'?aliases.get(fn.parameters[0].id):null,exits=[],returnedTokens=[];
    const receiverTypes=receiver?actuals(fn.id+'/binding/'+fn.parameters[0].id):[];
    const fresh=new Map();
    // A constructor starts on fresh storage. These are not Source definitions
    // or initialized payloads, and never appear in the real phase event list.
    // Direct-base completion later carries their still-absent fields on the
    // same actual instance until the derived own phase actually reaches them.
    if(receiver)for(const actualType of receiverTypes) {
      let type=types.get(actualType);
      while(type) {
        charge();for(const field of type.fields??[]) {
          charge();const id=fn.construction+'/entry/not-defined/'+actualType+'/'+field.id;
          allocationEntries.set(id,{id,construction:fn.construction,actualType,field:field.id,state:'not-defined',
            node:null,origin:types.get(fn.ownerType).construction.origin});
          fresh.set(key(receiver,{actualType,fieldId:field.id}),new Set([id]));
        }
        type=type.base?types.get(type.base):null;
      }
    }
    function completed(construction,token,state,actualTypes=receiverTypes) {
      // A call may mutate any alias before it completes. Retain only the
      // versions actually established on every successful callee exit.
      state.clear();if(!token)return;
      for(const row of completions.get(construction)??[])if(actualTypes.includes(row.actualType))
        state.set(key(token,{actualType:row.actualType,fieldId:row.field}),new Set(row.versions));
    }
    function initialize(statement,state,env) {
      const owner=types.get(statement.ownerType),phase=phases.get(statement.construction);
      if(!phase)return;
      for(const event of phase.events) {
        charge();const output=event.output;
        if(event.kind==='initializerWrite') {
          const init=owner.construction.initialization.find(row=>row.field===output.field&&row.value);
          expression(init.value,output.valueNode,state,env);
        }
        const node=event.kind==='nativeDefine'?null:event.kind==='parameterWrite'
          ?fn.id+'/binding/'+output.parameterBinding:output.valueNode;
        const version={id:output.id,field:output.field,node,state:output.state,actualTypes:[...receiverTypes],origin:output.origin};
        phaseWrites.set(output.id,version);
        if(receiver)for(const actualType of receiverTypes)
          state.set(key(receiver,{actualType,fieldId:output.field}),new Set([output.id]));
      }
    }
    function access(value,path,state,token,kind,source=null) {
      const selection=selections.get(path);if(!selection)return;
      if(kind==='store') {
        for(const target of selection.targets) {
          charge();const id=path+'/field-version/'+target.actualType+'/'+target.fieldId;
          writes.set(id,{id,node:source,actualType:target.actualType,field:target.fieldId,origin:{source:fn.sourcePath,...value.range}});
        }
        if(!token){state.clear();return;}
        // Separate host parameters do not establish noalias. A write through
        // another parameter may replace any previously remembered field of an
        // aliased parameter; fresh allocations remain distinct in this frame.
        if(token.includes('/parameter/'))for(const stored of state.keys()) {
          const other=stored.slice(0,stored.indexOf('\0'));
          if(other!==token&&other.includes('/parameter/')){charge();state.delete(stored);}
        }
        for(const target of selection.targets) {
          charge();const id=path+'/field-version/'+target.actualType+'/'+target.fieldId;
          state.set(key(token,target),new Set([id]));
        }
      }else {
        const reaching=[];
        for(const target of selection.targets) {
          charge();const versions=token?state.get(key(token,target)):null;
          if(versions) {
            const values=[...versions].map(id=>writes.get(id)??phaseWrites.get(id)??allocationEntries.get(id));
            reaching.push({actualType:target.actualType,field:target.fieldId,versions:[...versions].sort(),
              sources:[...new Set(values.map(row=>row.node).filter(Boolean))].sort(),
              ...(values.some(row=>['not-defined','defined-native-undefined'].includes(row.state))?{intrinsics:['undefined']}:{})});
          }
        }
        reads.set(path,{node:path,reaching});
      }
    }
    function expression(value,path,state,env) {
      charge();if(!value)return null;
      const child=key=>expression(value[key],path+'/'+key,state,env);
      if(value.kind==='reference')return env.get(value.binding)??null;
      if(['group','nonNull','assertType'].includes(value.kind))return child('operand');
      if(value.kind==='assignment') {
        const token=child('value'),alias=copiesValue(value.target.type)?null:token;
        env.set(value.target.binding,alias);return alias;
      }
      if(value.kind==='fieldAccess') {
        const token=child('receiver');access(value,path,state,token,'read');return null;
      }
      if(value.kind==='fieldAssignment') {
        const token=expression(value.target.receiver,path+'/target/receiver',state,env);
        const rhs=child('value');access(value,path,state,token,'store',path+'/value');return rhs;
      }
      if(value.kind==='shortCircuit') {
        child('left');const right=clone(state),rightEnv=new Map(env);
        expression(value.right,path+'/right',right,rightEnv);
        const merged=join(state,right);state.clear();for(const pair of merged)state.set(...pair);
        for(const [id,token] of env)if(rightEnv.get(id)!==token)env.set(id,null);return null;
      }
      if(value.kind==='superConstruct') {
        for(const [index,argument] of value.arguments.entries())expression(argument,path+'/arguments/'+index,state,env);
        completed(value.construction,env.get(value.receiverBinding),state);
        initialize(value.afterSuccess,state,env);return null;
      }
      if(value.kind==='call') {
        const tokens=[...(value.receiver?[child('receiver')]:[]),
          ...value.arguments.map((argument,index)=>expression(argument,path+'/arguments/'+index,state,env))];
        const targets=value.receiver?(calls.get(path)?.targets??[]).map(row=>row.functionId):[value.target];
        const returned=[],continuations=[];
        for(const target of targets) {
          const callee=functions.get(target);if(!callee){returned.push(null);continuations.push(new Map());continue;}
          const fields=new Map();
          for(const [index,parameter] of callee.parameters.entries())if(tokens[index]) {
            const prefix=tokens[index]+'\0',destination=callee.id+'/parameter/'+parameter.id;
            for(const [location,versions] of state)if(location.startsWith(prefix)) {
              charge();fields.set(destination+location.slice(tokens[index].length),new Set(versions));
            }
          }
          contexts.set(path+'\0'+target,{target,fields});
          const ordinal=returnAliases.get(target);returned.push(Number.isInteger(ordinal)?tokens[ordinal]:null);
          const continuation=new Map();
          for(const output of outputs.get(target)??[])if(tokens[output.parameter]) {
            charge();const location=key(tokens[output.parameter],{actualType:output.actualType,fieldId:output.field}),
              versions=continuation.get(location)??new Set();
            for(const version of output.versions)versions.add(version);continuation.set(location,versions);
          }
          continuations.push(continuation);
        }
        if(targets.some(id=>id!==hir.intrinsics.readSpan.id&&(!effects.has(id)||effects.get(id).writes))) {
          state.clear();const continuation=continuations.length?continuations.reduce((left,right)=>join(left,right)):new Map();
          for(const pair of continuation)state.set(...pair);
        }
        return returned.length&&returned.every(token=>token&&token===returned[0])?returned[0]:null;
      }
      // Receiver and target/index evaluation precede RHS, matching owned HIR.
      for(const name of ['receiver','left','operand'])if(value[name])child(name);
      if(value.target&&typeof value.target==='object')for(const name of ['receiver','index'])if(value.target[name])
        expression(value.target[name],path+'/target/'+name,state,env);
      for(const name of ['index','right','value'])if(value[name])child(name);
      for(const name of ['arguments','elements'])for(const [index,child] of (value[name]??[]).entries())
        expression(child,path+'/'+name+'/'+index,state,env);
      if(value.kind==='construct')completed(value.construction,path,state,[value.type]);
      if(value.kind==='fieldUpdate')state.clear();
      // A fresh allocation has a definite alias identity within this frame.
      // Loop boundaries discard its versions before observing another turn.
      return value.kind==='construct'?path:null;
    }
    function statements(values,path,state,env) {
      for(const [index,value] of values.entries()) {
        charge();const p=path+'/'+index;
        if(value.kind==='local') {
          const token=expression(value.initializer,p+'/initializer',state,env);
          env.set(value.binding.id,copiesValue(value.binding.type)?null:token);
        }
        else if(value.kind==='expression')expression(value.expression,p+'/expression',state,env);
        else if(value.kind==='return'||value.kind==='constructorReturn') {
          const token=value.value?expression(value.value,p+'/value',state,env):null;
          returnedTokens.push(value.value&&!copiesValue(value.value.type)?token:null);
          // Replacement-object completion requires its own actual receiver
          // proof; it cannot inherit the original this-field versions.
          exits.push(value.value&&value.kind==='constructorReturn'?new Map():clone(state));return null;
        }else if(value.kind==='if') {
          expression(value.condition,p+'/condition',state,env);
          const leftEnv=new Map(env),rightEnv=new Map(env),
            left=statements(value.then,p+'/then',clone(state),leftEnv),
            right=statements(value.else??[],p+'/else',clone(state),rightEnv),merged=join(left,right);
          if(!merged)return null;state=merged;
          for(const id of new Set([...leftEnv.keys(),...rightEnv.keys()]))
            env.set(id,!left?rightEnv.get(id):!right?leftEnv.get(id):leftEnv.get(id)===rightEnv.get(id)?leftEnv.get(id):null);
        }else if(value.kind==='while') {
          // A loop-carried write or alias is not a proof for its first turn.
          state.clear();for(const id of env.keys())env.set(id,null);
          expression(value.condition,p+'/condition',state,env);
          statements(value.body,p+'/body',new Map(),new Map(env));state.clear();
        }else if(value.kind==='block')state=statements(value.body,p+'/body',state,env);
        else if(value.kind==='initializeOwnFields')initialize(value,state,env);
        else if(value.kind==='forwardBaseConstruction')completed(value.construction,env.get(value.receiverBinding),state);
        if(!state)return null;
      }
      return state;
    }
    const incoming=[...contexts.values()].filter(row=>row.target===fn.id).map(row=>row.fields);
    if(exports.has(fn.id)||receiver||!incoming.length)incoming.push(new Map());
    const initial=receiver?fresh:incoming.reduce((left,right)=>join(left,right));
    const fallthrough=statements(fn.body,fn.id+'/body',clone(initial),aliases);
    if(fallthrough){exits.push(fallthrough);returnedTokens.push(null);}
    const ordinal=returnedTokens.length&&returnedTokens.every(token=>token&&token===returnedTokens[0])
      ?fn.parameters.findIndex(parameter=>fn.id+'/parameter/'+parameter.id===returnedTokens[0]):-1;
    returnAliases.set(fn.id,ordinal>=0?ordinal:null);
    const outgoing=[];
    if(exits.length) {
      const state=exits.reduce((left,right)=>join(left,right));
      for(const [index,parameter] of fn.parameters.entries()) {
        const token=fn.id+'/parameter/'+parameter.id;
        for(const [location,versions] of state)if(location.startsWith(token+'\0')) {
          charge();const [,actualType,field]=location.split('\0');
          outgoing.push({parameter:index,actualType,field,versions:[...versions].sort()});
        }
      }
    }
    outputs.set(fn.id,outgoing.sort((a,b)=>a.parameter-b.parameter||(a.actualType+a.field<b.actualType+b.field?-1:1)));
    if(receiver&&exits.length) {
      const state=exits.reduce((left,right)=>join(left,right)),rows=[];
      for(const [location,versions] of state)if(location.startsWith(receiver+'\0')) {
        const [,actualType,field]=location.split('\0');rows.push({actualType,field,versions:[...versions].sort()});
      }
      completions.set(fn.construction,rows.sort((a,b)=>(a.actualType+a.field)<(b.actualType+b.field)?-1:1));
    }
  }
  }while(ledger()!==previous);
  return own({reads:[...reads.values()].sort((a,b)=>a.node<b.node?-1:1),
    writes:[...writes.values()].sort((a,b)=>a.id<b.id?-1:1),
    phaseWrites:[...phaseWrites.values()].sort((a,b)=>a.id<b.id?-1:1),
    allocationEntries:[...allocationEntries.values()].sort((a,b)=>a.id<b.id?-1:1),
    completions:[...completions].sort(([a],[b])=>a<b?-1:1).map(([construction,fields])=>({construction,fields})),
    callContexts:[...contexts].sort(([a],[b])=>a<b?-1:1).map(([site,row])=>({site,target:row.target,
      fields:[...row.fields].sort(([a],[b])=>a<b?-1:1).map(([location,versions])=>({location,versions:[...versions].sort()}))})),
    returnAliases:[...returnAliases].sort(([a],[b])=>a<b?-1:1).map(([functionId,parameter])=>({functionId,parameter})),
    callOutputs:[...outputs].sort(([a],[b])=>a<b?-1:1).map(([functionId,fields])=>({functionId,fields})),
    effects:[...effects].map(([functionId,row])=>({functionId,writesFields:row.writes})).sort((a,b)=>a.functionId<b.functionId?-1:1)});
}
