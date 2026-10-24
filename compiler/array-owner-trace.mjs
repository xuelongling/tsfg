// SPDX-License-Identifier: MIT
// Source-order ownership from the unified typed HIR. Effects and publication stay separate.
import {canonical} from './identity.mjs';
import {arrayAnalysisTypes,arrayExpressionChildren,arrayReferenceBinding,hasConditionalArrayRhs} from './array-analysis-types.mjs';
import {finiteCallables} from './finite-callables.mjs';
import {typedReferenceAuthority} from './typed-reference-authority.mjs';
import {createSpanStorage} from './array-span-storage.mjs';
import {createSpanContexts} from './array-span-contexts.mjs';

export const unknownArrayOwner=Object.freeze({kind:'unknown'});
export const parameterArrayOwner=(fn,index)=>({kind:'parameter',functionId:fn.id,index});
function boundedOwnerCharge() {
  let work=0;return ()=>{if(++work>16384)throw Object.assign(new TypeError('Array owner work limit'),{code:'r03-d-array-call-effects-limit'});};
}
// Helpers share the caller's inclusive meter. Preflight precedes expansion,
// canonical serialization, path copying and comparisons; failures escape intact.
export function createArrayOwnerTools(charge=boundedOwnerCharge()) {
  const keys=new WeakMap();
  const string=text=>{for(let i=0;i<text.length;i+=256)charge();};
  const key=value=>{
    charge();if(value&&typeof value==='object'&&keys.has(value))return keys.get(value);
    const pending=[value];
    while(pending.length) {
      charge();const item=pending.pop();
      if(typeof item==='string')string(item);
      else if(item&&typeof item==='object')for(const name of Object.keys(item)) {
        charge();string(name);pending.push(item[name]);
      }
    }
    const result=canonical(value);if(value&&typeof value==='object')keys.set(value,result);return result;
  };
  const compare=(a,b)=>{charge();string(a);string(b);return a<b?-1:a>b?1:0;};
  const pathKey=value=>{for(let i=0;i<value.length;i+=8)charge();return canonical(value);};
  const leaves=owner=>{
    const result=[],pending=[];if(owner){charge();pending.push(owner);}
    while(pending.length) {
      charge();const item=pending.pop();
      if(item.kind==='aliases')for(let i=item.owners.length-1;i>=0;i--){charge();pending.push(item.owners[i]);}
      else {charge();result.push(item);}
    }
    return result;
  };
  const merge=owners=>{
    const unique=new Map();for(const owner of owners)for(const row of leaves(owner)){charge();unique.set(key(row),row);}
    const sorted=[...unique.entries()];sorted.sort(([a],[b])=>compare(a,b));
    const rows=[];for(const [,owner]of sorted){charge();rows.push(owner);}
    return rows.length===0?null:rows.length===1?rows[0]:{kind:'aliases',owners:rows};
  };
  const path=value=>{const result=[];for(const part of value){charge();result.push(part);}return result;};
  const mappedCalls=new WeakMap(),argumentsByCall=new WeakMap();
  const map=(owner,call,caller,fail)=>{
    charge();let memo=mappedCalls.get(call);if(!memo){memo=new WeakMap();mappedCalls.set(call,memo);}
    if(memo.has(owner))return memo.get(owner);
    const one=row=>{
    charge();if(row.kind==='unknown')return row;
    if(row.kind==='parameter') {
      let actual=argumentsByCall.get(call);
      if(!actual){actual=new Map();for(const argument of call.arguments){charge();actual.set(argument.index,argument.owner);}argumentsByCall.set(call,actual);}
      if(row.functionId!==call.target||!actual.has(row.index))fail('identity');return actual.get(row.index);
    }
    if(row.kind!=='allocation')fail('identity');
    // Forget recursive disjointness instead of growing activation paths forever.
    if(row.functionId===caller)return unknownArrayOwner;
    const frames=[];for(const frame of row.callPath){charge();if(frame.functionId===caller)return unknownArrayOwner;
      frames.push({functionId:frame.functionId,expressionPath:path(frame.expressionPath)});}
    return {...row,callPath:[{functionId:caller,expressionPath:path(call.expressionPath)},...frames]};
    };
    const result=owner.kind==='aliases'?merge(leaves(owner).map(one)):one(owner);
    memo.set(owner,result);return result;
  };
  const mayAlias=(left,right)=>{
    const a=leaves(left),b=leaves(right);
    for(const x of a)for(const y of b){charge();if(x.kind==='unknown'||y.kind==='unknown'
      ||compare(key(x),key(y))===0||x.kind==='parameter'&&y.kind==='parameter')return true;}
    return false;
  };
  return {key,pathKey,compare,leaves,merge,map,mayAlias,charge};
}
export const mergeArrayOwners=(owners,charge=undefined)=>createArrayOwnerTools(charge).merge(owners);
export const mapArrayOwner=(owner,call,caller,fail,charge=undefined)=>createArrayOwnerTools(charge).map(owner,call,caller,fail);

/** One trace records actual call/operand completion; no old f64 HIR is materialized. */
export function traceArrayOwners(hir,contracts,fail,charge,insert,empty,tools=createArrayOwnerTools(charge),authority=undefined) {
  const {merge:mergeArrayOwners,map:mapArrayOwner}=tools;
  const canonical=value=>Array.isArray(value)?tools.pathKey(value):tools.key(value);
  const snapshot=source=>{const result=new Map();for(const [key,value]of source){charge();result.set(key,value);}return result;};
  const type=arrayAnalysisTypes(hir),callables=finiteCallables(hir),functions=new Map(callables.map(fn=>[fn.id,fn]));
  const ownerSlots=new Map(callables.map(fn=>[fn.id,fn.parameters.flatMap((p,index)=>{charge();return type.isOwner(p.type)?[index]:[];})]));
  const constructions=new Map(hir.types.filter(row=>row.construction).map(row=>[row.construction.id,row]));
  const target=id=>constructions.get(id)?.constructor??id;
  const selectedTargets=value=>{
    if(value.kind!=='call'||!value.receiver||!functions.get(value.target)?.ownerType
      ||functions.get(value.target).role==='construction-body')return [value.target];
    const owner=type.types.get(functions.get(value.target).ownerType);
    if(owner.kind!=='reference')return [value.target];
    authority??=typedReferenceAuthority(hir,charge);
    return authority.possibleMethods(value.receiver.type,value.target);
  };
  const bases=new Map(),callSites=new Map(),models=new Map(),origins=new Map(),active=new Set();
  const contexts=createSpanContexts(tools,charge);
  const storage=createSpanStorage(hir,tools,charge,()=>authority??=typedReferenceAuthority(hir,charge),
    (id,facts,aliases)=>contexts.resolve(functions.get(id),facts,aliases,(fn,context)=>trace(fn,context)));
  const trace=(fn,context=null)=>{
    if(!context&&models.has(fn.id))return;
    if(!context&&active.has(fn.id))return;
    if(!context)active.add(fn.id);
    const base=empty(),bindings=new Map(),calls=[],lengths=new Map(),contents=new Map(),expressions=new Map(),operations=[];
    let callCount=0,conditionalDepth=0;
    const truthBindings=new Map(),truthValues=new Map();
    const meetTruth=states=>{
      const names=new Set();for(const state of states)for(const name of state.keys()){charge();names.add(name);}
      truthBindings.clear();for(const name of names){charge();let value,first=true;
        for(const state of states){charge();const next=state.get(name)??null;if(first){value=next;first=false;}else if(value!==next)value=null;}
        truthBindings.set(name,value??null);}
    };
    // Reclassify only a side-effect-free boolean predicate at the backedge.
    // Calls, field/element payloads and carrier types supply no truth here.
    const predicate=value=>{
      charge();if(value.kind==='boolean')return value.value;
      if(value.kind==='reference')return truthBindings.get(value.binding)??null;
      if(['group','assertType','nonNull'].includes(value.kind))return predicate(value.operand);
      if(value.kind==='binary'&&['===','!=='].includes(value.operator)){
        const left=predicate(value.left),right=predicate(value.right);
        if(typeof left==='boolean'&&typeof right==='boolean')return value.operator==='==='?left===right:left!==right;
      }return null;
    };
    const stored=storage.begin(fn,!!context,context?.aliases),model={bindings,expressions,operations,loops:[],storage:stored.model};
    if(!context){models.set(fn.id,model);bases.set(fn.id,base);callSites.set(fn.id,calls);}
    fn.parameters.forEach((p,index)=>{
      charge();truthBindings.set(p.id,context?.facts[index]??null);
      if(!type.isOwner(p.type))return;
      const owner=parameterArrayOwner(fn,index);bindings.set(p.id,owner);insert(base.owners,owner);lengths.set(canonical(owner),null);
    });
    const own=(value,owner)=>type.isOwner(value.type)?owner??unknownArrayOwner:null;
    const read=owner=>{if(owner)insert(base.reads,owner);};
    const mutate=(value,path,owner,index,resize)=>{
      const key=canonical(owner),previous=lengths.get(key)??null;
      const operand=resize?value.value:value.target.index;
      const n=operand?.kind==='constant'?Number(operand.decimal):null;
      const fresh=owner?.kind==='allocation'&&owner.functionId===fn.id&&owner.callPath.length===0;
      const nonStructural=fresh&&previous!==null&&n!==null&&(resize?n===previous:n<previous);
      const proof={owner,exactLength:previous,[resize?'newLength':'index']:n,nonStructural};
      insert(base.structural,owner);if(!resize)insert(base.writes,owner);
      lengths.set(key,!fresh||n===null?null:resize?n:previous===null?null:Math.max(previous,n+1));
      operations.push({kind:resize?'resize':'store',path,range:value.range,proof,statementIndex:index});
    };
    const expression=(value,path,index)=>{
      if(!value)return null;
      charge();let owner=null,storageCall=null,facts=[];
      if(value.kind==='reference')owner=bindings.get(value.binding);
      else if(['group','assertType','nonNull'].includes(value.kind))owner=expression(value.operand,[...path,'operand'],index);
      else if(value.kind==='arrayCreate') {
        const children=value.elements.map((child,i)=>expression(child,[...path,'elements',i],index));
        owner={kind:'allocation',functionId:fn.id,allocationSite:value.allocationSite,callPath:[]};
        insert(base.owners,owner);lengths.set(canonical(owner),value.elements.length);
        contents.set(canonical(owner),mergeArrayOwners(children));
      }else if(['call','construct','superConstruct'].includes(value.kind)) {
        if(++callCount>32)fail('limit');
        const receiver=value.receiver?expression(value.receiver,[...path,'receiver'],index):null;
        const actuals=value.arguments.map((child,i)=>expression(child,[...path,'arguments',i],index));
        if(value.target===hir.intrinsics.readSpan.id) {
          owner=actuals[0];read(owner);
          operations.push({kind:'viewCreate',path,range:value.range,owner,statementIndex:index});
        }else {
          const targetId=value.kind==='call'?value.target:target(value.construction);
          const callee=functions.get(targetId),contract=contracts.get(targetId);
          if(!callee||!contract)fail('identity');
          const selected=value.kind==='call'?selectedTargets(value):[targetId];
          const targets=selected.map(id=>{charge();const fn=functions.get(id),record=contracts.get(id);
            if(!fn||!record)fail('identity');return {target:id,signatureHash:fn.signatureHash,consumedDigest:record.digest};});
          const values=callee.ownerType?[receiver,...actuals]:actuals,args=[];
          const slots=targets.length===1?ownerSlots.get(targets[0].target):[...new Set(targets.flatMap(arm=>
            ownerSlots.get(arm.target).map(slot=>{charge();return slot;})))].sort((a,b)=>{charge();return a-b;});
          for(const slot of slots) {
            charge();args.push({index:slot,binding:arrayReferenceBinding((callee.ownerType?[value.receiver,...value.arguments]:value.arguments)[slot]),
              owner:values[slot]??unknownArrayOwner});
          }
          if(!context)for(const arm of targets)trace(functions.get(arm.target));
          const scalarArguments=callee.ownerType?[value.receiver,...value.arguments]:value.arguments;
          for(const [i]of scalarArguments.entries()){charge();facts.push(truthValues.get(canonical(
            callee.ownerType&&i===0?[...path,'receiver']:[...path,'arguments',i-(callee.ownerType?1:0)]))??null);}
          const call={functionId:fn.id,expressionPath:path,range:{...value.range},target:targetId,
            signatureHash:callee.signatureHash,arguments:args,consumedDigest:contract.digest,targets,
            publishedLocal:targets.some(arm=>Object.values(contracts.get(arm.target).upper.local).some(Boolean))
              ?{kind:'callLocal',functionId:fn.id,expressionPath:path}:null,
            returnedView:null};
          if(type.isOwner(value.type)) {
            const returned=[];
            for(const arm of targets){charge();const origin=origins.get(arm.target);
              returned.push(origin?mapArrayOwner(origin,{...call,target:arm.target},fn.id,fail):unknownArrayOwner);}
            owner=mergeArrayOwners(returned);
            const slots=targets.map(arm=>origins.get(arm.target)).map(origin=>origin?.kind==='parameter'?origin.index:null);
            if(type.isView(value.type)&&slots[0]!==null&&slots.every(slot=>slot===slots[0]))
              call.returnedView=args.find(row=>row.index===slots[0])??null;
          }
          storageCall=call;calls.push(call);operations.push({kind:'call',path,range:value.range,call,value,statementIndex:index});
          for(const argument of args)lengths.set(canonical(argument.owner),null);
        }
      }else if(['arrayStoreDenseChecked','arrayResizeChecked','arrayCompoundAssignment','arrayUpdate'].includes(value.kind)) {
        const target=value.target,receiver=expression(target.receiver,[...path,'target','receiver'],index);
        if(target.index)expression(target.index,[...path,'target','index'],index);
        // Compound/update read precedes the RHS; the target receiver/index occur once.
        if(['arrayCompoundAssignment','arrayUpdate'].includes(value.kind))read(receiver);
        if(value.value)expression(value.value,[...path,'value'],index);
        mutate(value,path,receiver??unknownArrayOwner,index,value.kind==='arrayResizeChecked');
        if(value.kind==='arrayStoreDenseChecked'&&type.isOwner(value.value.type))contents.set(canonical(receiver),
          mergeArrayOwners([contents.get(canonical(receiver)),expressions.get(canonical([...path,'value']))]));
      }else if(hasConditionalArrayRhs(value)) {
        const left=expression(value.left,[...path,'left'],index),before=snapshot(bindings);
        const storageBefore=stored.state(),priorTruth=snapshot(truthBindings);
        const leftTruth=truthValues.get(canonical([...path,'left'])),op=value.operator;
        const executes=context&&typeof leftTruth==='boolean'?(op==='&&'?leftTruth:op==='||'?!leftTruth:op==='??'?false:null):null;
        let right=null;
        if(executes!==false){conditionalDepth++;right=expression(value.right,[...path,'right'],index);conditionalDepth--;}
        if(executes===null){
          stored.join([storageBefore,stored.state()]);
          for(const [id,prior]of before)bindings.set(id,mergeArrayOwners([prior,bindings.get(id)]));
          meetTruth([priorTruth,snapshot(truthBindings)]);
          for(const key of lengths.keys()){charge();lengths.set(key,null);}
        }
        owner=mergeArrayOwners([left,right]);
      }else if(value.kind==='assignment') {
        owner=expression(value.value,[...path,'value'],index);bindings.set(value.target.binding,owner);
        operations.push({kind:'binding',path:[...path,'value'],binding:value.target.binding,type:value.target.type,
          value:value.value,range:value.range,owner,statementIndex:index,conditional:conditionalDepth>0});
      }else {
        const children=arrayExpressionChildren(value,path).map(([child,childPath])=>expression(child,childPath,index));
        if(value.kind==='arrayReadChecked') {
          const receiver=children[0];read(receiver);
          if(type.isOwner(value.type))owner=contents.get(canonical(receiver))??mergeArrayOwners([receiver,unknownArrayOwner]);
          operations.push({kind:'read',path,range:value.range,value,statementIndex:index});
        }else if(value.kind==='readSpanLength'||value.kind==='arrayLength') {
          // Descriptor length extends a borrow but is not an element-buffer R effect.
          operations.push({kind:'read',path,range:value.range,value,statementIndex:index});
        }
        else if(type.isOwner(value.type))owner=mergeArrayOwners([...children,unknownArrayOwner]);
      }
      let truth=null;
      if(value.kind==='boolean')truth=value.value;
      else if(value.kind==='reference')truth=truthBindings.get(value.binding)??null;
      else if(['group','assertType','nonNull'].includes(value.kind))truth=truthValues.get(canonical([...path,'operand']))??null;
      else if(value.kind==='assignment'){truth=truthValues.get(canonical([...path,'value']))??null;truthBindings.set(value.target.binding,truth);}
      else if(value.kind==='binary'&&['===','!=='].includes(value.operator)){
        const left=truthValues.get(canonical([...path,'left'])),right=truthValues.get(canonical([...path,'right']));
        if(typeof left==='boolean'&&typeof right==='boolean')truth=value.operator==='==='?left===right:left!==right;
      }
      truthValues.set(canonical(path),truth);
      owner=stored.record(value,path,owner,storageCall,operations.at(-1)?.proof,facts);
      owner=own(value,owner);expressions.set(canonical(path),owner);return owner;
    };
    const returns=[];
    const body=(rows,path=['body'])=>{
      // Normal control flow is independent of whether aggregate provenance
      // is enabled. Still visit lexical facts after a terminated path.
      let fallthrough=true;
      for(const [index,row] of rows.entries()) {
        if(context&&!fallthrough)break;
        charge();const at=[...path,index],incoming=fallthrough;
        if(row.kind==='initializeOwnFields') {
          const owner=constructions.get(row.construction),typeIndex=hir.types.indexOf(owner);
          for(const [ordinal,step]of owner.construction.initialization.entries())if(step.value)
            expression(step.value,['types',typeIndex,'construction','initialization',ordinal,'value'],index);
          stored.initialize(row);
        }else if(row.kind==='forwardBaseConstruction') {
          const range={start:row.origin.start,end:row.origin.end};
          const reference=argument=>({kind:'reference',type:argument.type,binding:argument.binding,
            range:{start:argument.origin.start,end:argument.origin.end}});
          expression({kind:'call',target:target(row.construction),type:fn.returnType.id,range,
            receiver:{kind:'reference',type:fn.ownerType,binding:row.receiverBinding,range},arguments:row.arguments.map(reference)},at,index);
        }else if(row.kind==='local') {
          const owner=expression(row.initializer,[...at,'initializer'],index);
          stored.bind(row.binding.id,stored.get([...at,'initializer']));
          truthBindings.set(row.binding.id,truthValues.get(canonical([...at,'initializer']))??null);
          if(type.isOwner(row.binding.type))bindings.set(row.binding.id,owner);
          operations.push({kind:'binding',path:[...at,'initializer'],binding:row.binding.id,type:row.binding.type,value:row.initializer,
            range:row.range,owner,statementIndex:index,conditional:conditionalDepth>0});
        }else {
          // The condition is evaluated on every backedge, not only before
          // the first body. Its field inputs share the loop-entry labels.
          const loopEntry=row.kind==='while'?stored.state():null;
          if(row.kind==='while')stored.enterLoop(loopEntry);
          if(row.condition)expression(row.condition,[...at,'condition'],index);
          for(const key of ['expression','value'])if(row[key]) {
            const owner=expression(row[key],[...at,key],index);
            if(row.kind==='return'&&type.isOwner(fn.returnType.id))returns.push(owner);
            if(row.kind==='return')operations.push({kind:'return',path:[...at,key],value:row[key],range:row[key].range,owner,statementIndex:index});
            if(row.kind==='return')stored.returned(stored.get([...at,key]),[...at,key]);
          }
          if(row.kind==='return'&&!row.value)stored.returned(undefined,at);
          if(row.kind==='return')fallthrough=false;
          if(row.then||row.else) {
            const condition=context?truthValues.get(canonical([...at,'condition'])):null;
            if(typeof condition==='boolean'){
              fallthrough=incoming&&body(condition?row.then??[]:row.else??[],[...at,condition?'then':'else']);continue;
            }
            const before=snapshot(bindings),beforeLengths=snapshot(lengths);
            const priorTruth=snapshot(truthBindings);
            const storageBefore=stored.state();
            conditionalDepth++;const yesExit=body(row.then??[],[...at,'then']),yes=snapshot(bindings);
            const storageYes=stored.state();stored.restore(storageBefore);
            const yesTruth=snapshot(truthBindings);truthBindings.clear();for(const [id,value]of priorTruth){charge();truthBindings.set(id,value);}
            bindings.clear();for(const [id,owner]of before){charge();bindings.set(id,owner);}
            lengths.clear();for(const [key,length]of beforeLengths){charge();lengths.set(key,length);}
            const noExit=body(row.else??[],[...at,'else']);conditionalDepth--;
            fallthrough=incoming&&(yesExit||noExit);
            stored.join([storageYes,stored.state()]);
            meetTruth([...(yesExit?[yesTruth]:[]),...(noExit?[snapshot(truthBindings)]:[])]);
            for(const [id,owner]of yes)bindings.set(id,mergeArrayOwners([owner,bindings.get(id)]));
            for(const key of lengths.keys()){charge();lengths.set(key,null);}
          }
          if(row.body&&row.kind==='while') {
            if(context&&truthValues.get(canonical([...at,'condition']))===false){stored.leaveLoop(loopEntry,stored.state());continue;}
            const entryTruth=truthValues.get(canonical([...at,'condition'])),beforeTruth=snapshot(truthBindings);
            // A loop proof must hold on its backedge, not only on the first iteration.
            for(const key of lengths.keys()){charge();lengths.set(key,null);}
            for(const id of truthBindings.keys()){charge();truthBindings.set(id,null);}
            const before=snapshot(bindings),conditionExit=stored.state();conditionalDepth++;
            const bodyExit=body(row.body,[...at,'body']);conditionalDepth--;
            const backedgeTruth=predicate(row.condition),afterTruth=snapshot(truthBindings);
            // Only a normally completed body can repeat its condition. The
            // shared scope also distinguishes views freshly made each turn.
            const repeats=backedgeTruth!==false,zero=!(context&&entryTruth===true);
            if(incoming&&bodyExit&&repeats)model.loops.push(at);
            stored.leaveLoop(loopEntry,conditionExit,repeats,zero);
            // Entry true is not an invariant. A proved false backedge yields
            // an actual normal continuation; unresolved cycles do not.
            if(context&&entryTruth===true&&(repeats||!bodyExit))fallthrough=false;
            for(const [id,owner]of before)bindings.set(id,mergeArrayOwners([owner,bindings.get(id)]));
            if(!repeats)meetTruth([...(zero?[beforeTruth]:[]),...(bodyExit?[afterTruth]:[])]);
            else for(const id of truthBindings.keys()){charge();truthBindings.set(id,null);}
            for(const key of lengths.keys()){charge();lengths.set(key,null);}
          }else if(row.body){const nestedExit=body(row.body,[...at,'body']);fallthrough=incoming&&nestedExit;}
        }
      }
      return fallthrough;
    };
    const fallsThrough=body(fn.body);const summary=stored.finish(model.loops,fallsThrough);
    if(!context){origins.set(fn.id,mergeArrayOwners(returns));active.delete(fn.id);}return summary;
  };
  for(const fn of callables)trace(fn);
  return {bases,callSites,models,origins};
}
