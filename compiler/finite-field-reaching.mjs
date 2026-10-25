// SPDX-License-Identifier: MIT
// Memory-version constraints, not value evaluation. A successful strong write
// through a definite receiver alias can qualify a later read; unknown alias or
// call effects retain the conservative whole-field domain.
import {canonical,own} from './identity.mjs';
import {finiteCallables} from './finite-callables.mjs';
import {finiteFieldPhases} from './finite-field-phases.mjs';
import {finitePresence} from './finite-presence.mjs';
import {createFieldReturnGraphs} from './finite-field-return-graphs.mjs';
import {finiteFieldEffects} from './finite-field-effects.mjs';

// These are the production proof-state snapshots, not Source-value copies.
function versionCopy(values,charge) {
  const result=new Set();for(const value of values){charge();result.add(value);}return result;
}
export function copyFieldReachingState(state,charge) {
  const result=new Map();
  for(const [key,value] of state){charge();result.set(key,versionCopy(value,charge));}return result;
}
export function copyFieldReachingAliases(env,charge) {
  const result=new Map();for(const [id,token] of env){charge();result.set(id,token);}return result;
}

export function buildFiniteFieldReaching(hir,plan,charge) {
  const selections=new Map(plan.fields.map(row=>[row.id,row]));
  const calls=new Map(plan.calls.map(row=>[row.id,row]));
  const types=new Map(hir.types.map(type=>[type.id,type])),valueDomains=new Map();
  const presence=finitePresence(plan,types,charge);
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
  const writes=new Map(),reads=new Map(),phaseWrites=new Map(),allocationEntries=new Map(),completions=new Map(),contexts=new Map(),returnAliases=new Map(),outputs=new Map();
  const storedTokens=new Map(),returnedFields=new Map();
  const projectedOutputs=new Map(),returnValueParameters=new Map(),returnGraphs=createFieldReturnGraphs(charge);
  const constructors=new Map();for(const fn of callables){charge();if(fn.role==='construction-body')constructors.set(fn.construction,fn);}
  const {effects,sites,recursive,cyclicFunctions}=finiteFieldEffects(hir,plan,callables,phases,charge);
  for(const [site,target]of sites){charge();contexts.set(site,{target,fields:new Map()});}
  const clone=state=>copyFieldReachingState(state,charge);
  function join(left,right) {
    if(!left)return right;if(!right)return left;
    const result=new Map();
    for(const [key,value] of left) {
      charge();if(!right.has(key))continue;const versions=versionCopy(value,charge);
      for(const version of right.get(key)){charge();versions.add(version);}result.set(key,versions);
    }
    return result;
  }
  function meetAliases(env,left,right,leftLive=true,rightLive=true) {
    const keys=new Set(),result=new Map();
    for(const side of [left,right])for(const id of side.keys()){charge();keys.add(id);}
    for(const id of keys){charge();result.set(id,!leftLive?right.get(id):!rightLive?left.get(id):left.get(id)===right.get(id)?left.get(id):null);}
    env.clear();for(const [id,token] of result){charge();env.set(id,token);}
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
      completions:[...completions],returnAliases:[...returnAliases],outputs:[...outputs],returnedFields:[...returnedFields],
      projectedOutputs:[...projectedOutputs],returnValueParameters:[...returnValueParameters],returnGraphs:returnGraphs.ledger()};
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
    // Each value parameter owns its field plane. Mixed carriers retain the
    // reference branch's identity independently from their copied value plane.
    const aliases=new Map(fn.parameters.map(parameter=>[parameter.id,fn.id+'/parameter/'+parameter.id]));
    const referenceOrigins=new Map(),copyOrigins=new Map(),returnStates=[],returnValueRoots=[],referenceProjections=new Map();
    const freshTokens=new Set(),fieldChildren=new Map(),referenceReturns=[];
    const originOf=(origins,token)=>origins.has(token)?origins.get(token):token;
    const physicalToken=(token,actual)=>types.get(actual)?.kind==='value'?token:referenceOrigins.has(token)?referenceOrigins.get(token):token;
    const key=(token,target)=>{const physical=physicalToken(token,target.actualType);return physical?physical+'\0'+target.actualType+'\0'+target.fieldId:null;};
    function copyToken(token,destination,state) {
      charge();
      referenceOrigins.set(destination,originOf(referenceOrigins,token));
      copyOrigins.set(destination,originOf(copyOrigins,token));
      const pending=[];
      if(token)for(const [location,versions] of state) {
        charge();const [source,actual,field]=location.split('\0');
        if(source===token&&types.get(actual)?.kind==='value')pending.push([destination+'\0'+actual+'\0'+field,versionCopy(versions,charge)]);
      }
      for(const row of pending){charge();state.set(...row);}
      return destination;
    }
    function retainValues(state) {
      for(const location of state.keys()){charge();if(types.get(location.split('\0')[1])?.kind!=='value')state.delete(location);}
    }
    function projectedToken(root,version,source,fresh=false) {
      charge();const token='#frame/'+canonical([root,version,source]);
      referenceProjections.set(token,{root,version,source,fresh});return token;
    }
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
    function contextFields(callee,tokens,state){
      const fields=new Map();for(const [index,parameter]of callee.parameters.entries()){
        charge();if(!tokens[index])continue;const destination=callee.id+'/parameter/'+parameter.id;
        for(const [location,versions]of state){charge();const [stored,actual,field]=location.split('\0');
          if(stored===physicalToken(tokens[index],actual))fields.set(destination+'\0'+actual+'\0'+field,versionCopy(versions,charge));}
      }return fields;
    }
    function completed(construction,token,state,actualTypes=receiverTypes,tokens=null,path=null) {
      const callee=constructors.get(construction),continuation=new Map();
      if(callee&&tokens){
        contexts.set(path+'\0'+callee.id,{target:callee.id,fields:contextFields(callee,tokens,state)});
        for(const output of outputs.get(callee.id)??[]){charge();if(!output.parameter||!tokens[output.parameter])continue;
          const location=key(tokens[output.parameter],{actualType:output.actualType,fieldId:output.field});
          if(location)continuation.set(location,versionCopy(output.versions,charge));}
      }
      // A physical FieldId outside the complete write closure cannot change,
      // even through an unknown alias. Preserve its existing caller evidence;
      // universal constructor parameter entries remain unknown below.
      const effect=callee&&effects.get(callee.id);
      for(const location of state.keys()) {
        charge();const [,actual,field]=location.split('\0');
        if(types.get(actual)?.kind!=='value'&&(!effect||effect.unknown||effect.fields.has(field)))state.delete(location);
      }
      for(const row of continuation){charge();state.set(...row);}if(!token)return;
      for(const row of completions.get(construction)??[])if(actualTypes.some(actual=>{charge();return actual===row.actualType;}))
        {charge();state.set(key(token,{actualType:row.actualType,fieldId:row.field}),versionCopy(row.versions,charge));
          if(callee&&tokens)for(const version of row.versions){charge();const source=storedTokens.get(version);
            const index=callee.parameters.findIndex(parameter=>{charge();return callee.id+'/parameter/'+parameter.id===source?.token;});
            if(source?.function===callee.id&&index>=0)fieldChildren.set(token+'\0'+version,tokens[index]??null);}}
    }
    function initialize(statement,state,env) {
      const owner=types.get(statement.ownerType),phase=phases.get(statement.construction);
      if(!phase)return;
      for(const event of phase.events) {
        charge();const output=event.output;
        if(event.kind==='initializerWrite') {
          const init=owner.construction.initialization.find(row=>row.field===output.field&&row.value);
          storedTokens.set(output.id,{function:fn.id,token:expression(init.value,output.valueNode,state,env),fresh:init.value.kind==='construct'});
        }
        if(event.kind==='parameterWrite'){charge();storedTokens.set(output.id,{function:fn.id,token:env.get(output.parameterBinding)??null,parameter:true,fresh:false});}
        const node=event.kind==='nativeDefine'?null:event.kind==='parameterWrite'
          ?fn.id+'/binding/'+output.parameterBinding:output.valueNode;
        const version={id:output.id,field:output.field,node,state:output.state,actualTypes:[...receiverTypes],origin:output.origin};
        phaseWrites.set(output.id,version);
        if(receiver)for(const actualType of receiverTypes)
          state.set(key(receiver,{actualType,fieldId:output.field}),new Set([output.id]));
      }
    }
    function access(value,path,state,token,kind,source=null,payload=null) {
      const selection=selections.get(path);if(!selection)return;
      if(kind==='store') {
        for(const target of selection.targets) {
          charge();const id=path+'/field-version/'+target.actualType+'/'+target.fieldId;
          writes.set(id,{id,node:source,actualType:target.actualType,field:target.fieldId,origin:{source:fn.sourcePath,...value.range}});
          storedTokens.set(id,{function:fn.id,token:payload,fresh:value.value?.kind==='construct'});
        }
        if(!token){
          if(selection.targets.every(target=>types.get(target.actualType)?.kind==='reference')){
            for(const location of state.keys()){charge();const [,actual,field]=location.split('\0');
              if(types.get(actual)?.kind!=='value'&&selection.targets.some(target=>{charge();return target.fieldId===field;}))state.delete(location);}
          }else state.clear();
          return;
        }
        // Separate host parameters do not establish noalias. A write through
        // another parameter may replace any previously remembered field of an
        // aliased parameter; fresh allocations remain distinct in this frame.
        const referenceTokens=new Set();
        for(const target of selection.targets){charge();if(types.get(target.actualType)?.kind==='reference')referenceTokens.add(physicalToken(token,target.actualType));}
        if([...referenceTokens].some(token=>token?.includes('/parameter/')||referenceProjections.has(token)&&!referenceProjections.get(token).fresh))
          for(const stored of state.keys()) {
            charge();const [other,actual,field]=stored.split('\0');
            if(!referenceTokens.has(other)&&types.get(actual)?.kind!=='value'&&
                selection.targets.some(target=>{charge();return target.fieldId===field;}))state.delete(stored);
          }
        for(const target of selection.targets) {
          charge();const id=path+'/field-version/'+target.actualType+'/'+target.fieldId;
          const location=key(token,target);
          if(location)state.set(location,new Set([id]));else retainValues(state);
        }
      }else {
        const reaching=[];
        for(const target of selection.targets) {
          if(target.missing)continue; // Structural absence has no storage/version.
          charge();const versions=token?state.get(key(token,target)):null;
          if(versions) {
            const values=[...versions].map(id=>writes.get(id)??phaseWrites.get(id)??allocationEntries.get(id));
            reaching.push({actualType:target.actualType,field:target.fieldId,versions:[...versions].sort(),
              sources:[...new Set(values.map(row=>row.node).filter(Boolean))].sort(),
              ...(values.some(row=>['not-defined','defined-native-undefined'].includes(row.state))?{intrinsics:['undefined']}:{})});
          }
        }
        reads.set(path,{node:path,reaching});
        const tokens=[];
        for(const row of reaching)for(const version of row.versions) {
          charge();const source=storedTokens.get(version);
          if(fieldChildren.has(token+'\0'+version))tokens.push(fieldChildren.get(token+'\0'+version));
          else if(source?.function===fn.id)tokens.push(source.token);
          else {
            // Qualify a constructor's fresh child by the owning value's
            // original plane, not the callee's lexical allocation alone.
            const physical=physicalToken(token,row.actualType),root=originOf(copyOrigins,physical);
            // A parameter-property continuation denotes this independently selected
            // field version, not the constructor formal as a caller instance.
            // Such a reference stays potentially aliased when it is written.
            tokens.push((source?.fresh||source?.parameter)&&source.token&&root&&!cyclicFunctions.has(source.function)&&!cyclicFunctions.has(fn.id)
              ?projectedToken(root,version,source.token,source.fresh):null);
          }
        }
        return tokens.length&&tokens.every(token=>token&&token===tokens[0])?tokens[0]:null;
      }
    }
    function expression(value,path,state,env) {
      charge();if(!value)return null;
      const child=key=>expression(value[key],path+'/'+key,state,env);
      if(value.kind==='reference')return env.get(value.binding)??null;
      if(['group','nonNull','assertType'].includes(value.kind))return child('operand');
      if(value.kind==='assignment') {
        const token=child('value'),alias=copiesValue(value.target.type)?copyToken(token,path+'/copy',state):token;
        env.set(value.target.binding,alias);return alias;
      }
      if(value.kind==='fieldAccess') {
        const token=child('receiver'),payload=access(value,path,state,token,'read');
        return copiesValue(value.type)?copyToken(payload,path+'/copy',state):payload;
      }
      if(value.kind==='fieldAssignment') {
        const token=expression(value.target.receiver,path+'/target/receiver',state,env);
        const rhs=child('value'),payload=copiesValue(value.value.type)?copyToken(rhs,path+'/stored-copy',state):rhs;
        access(value,path,state,token,'store',path+'/value',payload);return rhs;
      }
      if(value.kind==='shortCircuit'||value.kind==='binary'&&['&&','||','??'].includes(value.operator)) {
        const left=child('left'),possibilities=value.operator==='??'?presence(path+'/left'):{present:true,absent:true};
        if(!possibilities.absent)return left;
        if(!possibilities.present)return child('right');
        const right=clone(state),rightEnv=copyFieldReachingAliases(env,charge),
          result=expression(value.right,path+'/right',right,rightEnv);
        const merged=join(state,right);state.clear();for(const pair of merged){charge();state.set(...pair);}
        meetAliases(env,env,rightEnv);return value.operator==='??'&&left&&left===result?left:null;
      }
      if(value.kind==='superConstruct') {
        for(const [index,argument] of value.arguments.entries())expression(argument,path+'/arguments/'+index,state,env);
        completed(value.construction,env.get(value.receiverBinding),state);
        initialize(value.afterSuccess,state,env);return null;
      }
      if(value.kind==='call') {
        const tokens=[...(value.receiver?[child('receiver')]:[]),
          ...value.arguments.map((argument,index)=>{
            const token=expression(argument,path+'/arguments/'+index,state,env);
            return copiesValue(argument.type)?copyToken(token,path+'/arguments/'+index+'/copy',state):token;
          })];
        const targets=value.receiver?(calls.get(path)?.targets??[]).map(row=>row.functionId):[value.target];
        const returned=[],continuations=[],valueReturns=[];
        for(const target of targets) {
          const callee=functions.get(target);if(!callee){returned.push(null);continuations.push(new Map());continue;}
          const fields=contextFields(callee,tokens,state);
          contexts.set(path+'\0'+target,{target,fields});
          const returnedState=new Map();
          for(const row of returnedFields.get(target)??[]) {
            charge();returnedState.set(row.location,versionCopy(row.versions,charge));
          }
          valueReturns.push(returnedState);
          const ordinal=returnAliases.get(target),graph=returnGraphs.instantiate(target,path,tokens);
          returned.push(Number.isInteger(ordinal)?tokens[ordinal]:graph?.root??null);
          const continuation=new Map();
          for(const output of outputs.get(target)??[])if(tokens[output.parameter]&&
              (output.parameter===0&&callee.ownerType||types.get(output.actualType)?.kind!=='value')) {
            charge();const location=key(tokens[output.parameter],{actualType:output.actualType,fieldId:output.field}),
              versions=continuation.get(location)??new Set();
            for(const version of output.versions){charge();versions.add(version);}if(location)continuation.set(location,versions);
          }
          for(const output of projectedOutputs.get(target)??[])if(tokens[output.parameter]) {
            charge();const root=originOf(copyOrigins,tokens[output.parameter]);if(!root)continue;
            const child=root+'\0'+output.origin.version,origin=fieldChildren.has(child)?fieldChildren.get(child)
              :projectedToken(root,output.origin.version,output.origin.source,output.origin.fresh);
            const location=key(origin,{actualType:output.actualType,fieldId:output.field});
            if(location)continuation.set(location,versionCopy(output.versions,charge));
          }
          if(graph){for(const token of graph.tokens){charge();freshTokens.add(token);}
            for(const row of graph.fields){charge();continuation.set(...row);}
            for(const row of graph.children){charge();fieldChildren.set(row.receiver+'\0'+row.version,row.child);}}
          continuations.push(continuation);
        }
        if(targets.some(id=>id!==hir.intrinsics.readSpan.id&&(!effects.has(id)||effects.get(id).writes))) {
          retainValues(state);const continuation=continuations.length?continuations.reduce((left,right)=>join(left,right)):new Map();
          // Explicit method receivers borrow their own value plane; ordinary
          // value arguments are copies. An unproved receiver write invalidates
          // only that borrowed plane before publishing successful outputs.
          if(value.receiver&&tokens[0])for(const location of state.keys()) {
            charge();if(location.startsWith(tokens[0]+'\0'))state.delete(location);
          }
          for(const pair of continuation){charge();state.set(...pair);}
        }
        if(copiesValue(value.type)) {
          const result=path+'/returned-copy',fields=valueReturns.length?valueReturns.reduce((a,b)=>join(a,b)):new Map();
          for(const [location,versions] of fields){charge();state.set(result+'\0'+location,versionCopy(versions,charge));}
          const roots=[],references=[];
          for(const target of targets){charge();const index=returnValueParameters.get(target),token=Number.isInteger(index)?tokens[index]:null;
            roots.push(token?originOf(copyOrigins,token):null);references.push(token?originOf(referenceOrigins,token):null);}
          if(roots.length&&roots.every(root=>root&&root===roots[0])){charge();copyOrigins.set(result,roots[0]);}
          if(references.length&&references.every(root=>root&&root===references[0])){charge();referenceOrigins.set(result,references[0]);}
          return result;
        }
        return returned.length&&returned.every(token=>token&&token===returned[0])?returned[0]:null;
      }
      // A fresh allocation has a definite alias identity within this frame.
      // Loop boundaries discard its versions before observing another turn.
      if(value.kind==='construct'){
        const tokens=[path];for(const [index,arg]of value.arguments.entries()){
          const token=expression(arg,path+'/arguments/'+index,state,env);
          tokens.push(copiesValue(arg.type)?copyToken(token,path+'/arguments/'+index+'/copy',state):token);}
        completed(value.construction,path,state,[value.type],tokens,path);freshTokens.add(path);return path;
      }
      // Receiver and target/index evaluation precede RHS, matching owned HIR.
      for(const name of ['receiver','left','operand'])if(value[name])child(name);
      if(value.target&&typeof value.target==='object')for(const name of ['receiver','index'])if(value.target[name])
        expression(value.target[name],path+'/target/'+name,state,env);
      for(const name of ['index','right','value'])if(value[name])child(name);
      for(const name of ['arguments','elements'])for(const [index,child] of (value[name]??[]).entries())
        expression(child,path+'/'+name+'/'+index,state,env);
      if(value.kind==='fieldUpdate')state.clear();
      return null;
    }
    function statements(values,path,state,env) {
      for(const [index,value] of values.entries()) {
        charge();const p=path+'/'+index;
        if(value.kind==='local') {
          const token=expression(value.initializer,p+'/initializer',state,env);
          env.set(value.binding.id,copiesValue(value.binding.type)?copyToken(token,p+'/copy',state):token);
        }
        else if(value.kind==='expression')expression(value.expression,p+'/expression',state,env);
        else if(value.kind==='return'||value.kind==='constructorReturn') {
          const token=value.value?expression(value.value,p+'/value',state,env):null;
          if(value.value&&copiesValue(value.value.type)) {
            returnValueRoots.push(originOf(copyOrigins,token));
            const fields=new Map();
            if(token)for(const [location,versions] of state)if(location.startsWith(token+'\0')) {
              charge();fields.set(location.slice(token.length+1),versionCopy(versions,charge));
            }
            returnStates.push(fields);
          }
          returnedTokens.push(value.value&&!copiesValue(value.value.type)?token:null);
          referenceReturns.push({token:value.value&&!copiesValue(value.value.type)?token:null,state:clone(state)});
          // Replacement-object completion requires its own actual receiver
          // proof; it cannot inherit the original this-field versions.
          exits.push(value.value&&value.kind==='constructorReturn'?new Map():clone(state));return null;
        }else if(value.kind==='if') {
          expression(value.condition,p+'/condition',state,env);
          const leftEnv=copyFieldReachingAliases(env,charge),rightEnv=copyFieldReachingAliases(env,charge),
            left=statements(value.then,p+'/then',clone(state),leftEnv),
            right=statements(value.else??[],p+'/else',clone(state),rightEnv),merged=join(left,right);
          if(!merged)return null;state=merged;
          meetAliases(env,leftEnv,rightEnv,!!left,!!right);
        }else if(value.kind==='while') {
          // A loop-carried write or alias is not a proof for its first turn.
          state.clear();for(const id of env.keys()){charge();env.set(id,null);}
          expression(value.condition,p+'/condition',state,env);
          statements(value.body,p+'/body',new Map(),copyFieldReachingAliases(env,charge));state.clear();
        }else if(value.kind==='block')state=statements(value.body,p+'/body',state,env);
        else if(value.kind==='initializeOwnFields')initialize(value,state,env);
        else if(value.kind==='forwardBaseConstruction')completed(value.construction,env.get(value.receiverBinding),state);
        if(!state)return null;
      }
      return state;
    }
    const incoming=[...contexts.values()].filter(row=>row.target===fn.id).map(row=>row.fields);
    if(exports.has(fn.id)||receiver||!incoming.length)incoming.push(new Map());
    const initial=incoming.reduce((left,right)=>join(left,right));
    if(receiver)for(const row of fresh){charge();initial.set(...row);}
    const fallthrough=statements(fn.body,fn.id+'/body',clone(initial),aliases);
    if(fallthrough){exits.push(fallthrough);returnedTokens.push(null);referenceReturns.push({token:null,state:fallthrough});}
    returnGraphs.update(fn.id,fn.parameters.map(parameter=>{charge();return fn.id+'/parameter/'+parameter.id;}),referenceReturns,freshTokens,
      (token,version)=>fieldChildren.has(token+'\0'+version)?fieldChildren.get(token+'\0'+version):storedTokens.get(version)?.function===fn.id?storedTokens.get(version).token:null,recursive.has(fn.id));
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
    const projected=[];
    if(exits.length)for(const [location,versions] of exits.reduce((a,b)=>join(a,b))) {
      charge();const [token,actualType,field]=location.split('\0'),origin=referenceProjections.get(token);
      if(!origin)continue;const parameter=fn.parameters.findIndex(parameter=>fn.id+'/parameter/'+parameter.id===origin.root);
      if(parameter>=0)projected.push({parameter,origin,actualType,field,versions:[...versions].sort()});
    }
    projectedOutputs.set(fn.id,projected.sort((a,b)=>canonical(a)<canonical(b)?-1:1));
    const returnedParameter=returnValueRoots.length&&returnValueRoots.every(root=>root&&root===returnValueRoots[0])
      ?fn.parameters.findIndex(parameter=>fn.id+'/parameter/'+parameter.id===returnValueRoots[0]):-1;
    // A field-writing helper may return a new child from each activation.
    // Only pure forwarding preserves a parameter's reference-origin root.
    returnValueParameters.set(fn.id,returnedParameter>=0&&!effects.get(fn.id).writes?returnedParameter:null);
    const valueReturn=returnStates.length?returnStates.reduce((a,b)=>join(a,b)):new Map();
    returnedFields.set(fn.id,[...valueReturn].sort(([a],[b])=>a<b?-1:1).map(([location,versions])=>({location,versions:[...versions].sort()})));
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
