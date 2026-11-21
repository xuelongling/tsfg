// SPDX-License-Identifier: MIT
import {boolTypeId,i32TypeId} from './identity.mjs';
import {booleanOperand,literalBooleanRhs,literalIfArm,literalLoopCondition} from './finite-field-effects.mjs';

const orderedComparison=new Set(['<','<=','>','>=']);
const numericBinary=new Set(['+','-','*','/','%','<<','>>','>>>','&','|','^',...orderedComparison]);
/** The accepted first numeric-use domain is exactly same-i32 plus undefined. */
export function finiteNumericUse(value) {
  const operands=value.kind==='binary'?[value.left,value.right]:value.kind==='unary'?[value.operand]:[];
  const approved=value.kind==='binary'?numericBinary.has(value.operator):value.kind==='unary'&&['+','-','~'].includes(value.operator);
  return approved&&operands.every(operand=>(operand.semanticType??operand.type)===i32TypeId)?operands:null;
}

/** Register both lexical operands and require completion of the selected path. */
export function finiteNormalLogical(value,flow,incoming,emit,charge) {
  const left=flow.normal(emit('left',incoming,true));
  const takesRight=literalBooleanRhs(value,charge);
  const right=flow.normal(emit('right',takesRight===false?flow.never:left,takesRight!==false));
  return takesRight===true?[left,right]:[left];
}

export function finiteNormalCoalesce(flow,incoming,emit,absent) {
  const left=emit('left',incoming,true),normal=flow.normal(left);
  const missing=flow.all([normal,flow.actualWhere(left,absent)]);
  const right=emit('right',missing,false);
  const present=flow.actualWhere(left,type=>!absent(type));
  return {left,right,dependencies:[normal,flow.any([present,flow.normal(right)])]};
}

/** Positive normal-completion constraints share the enclosing domain worklist.
 * Carrier bounds disable these constraints; they remain conditional ABI capacity.
 * This graph carries only completion facts, never Source values or truthiness. */
export function finiteNormalFlow(enabled,charge,nodes) {
  const rules=new Map(),watchers=new Map(),nodeWatchers=new Map(),ready=new Set(['always']),queue=[];
  const pendingPublications=[];let sealed=false,draining=false,serial=0;
  const watch=(map,key,id)=>{charge();if(!map.has(key))map.set(key,new Set());map.get(key).add(id);};
  const drain=()=>{
    if(!sealed||draining)return;draining=true;
    try {for(let cursor=0;cursor<queue.length;cursor++) {
      charge();const id=queue[cursor],rule=rules.get(id);if(ready.has(id)||!rule)continue;
      const values=rule.conditions.map(condition=>{
        charge();if(typeof condition==='string')return ready.has(condition);
        const node=nodes.get(condition.node);
        if(condition.match) {
          for(const type of node?.actual??[]){charge();if(condition.match(type))return true;}
          return Boolean(node?.pending.size);
        }
        return condition.type?Boolean(node?.actual.has(condition.type)||condition.possible&&node?.pending.size)
          :Boolean(node?.actual.size||node?.pending.size);
      });
      if(!(rule.any?values.some(Boolean):values.every(Boolean)))continue;
      ready.add(id);for(const action of rule.actions){charge();action();}
      for(const dependent of watchers.get(id)??[])queue.push(dependent);
    }queue.length=0;}finally{draining=false;}
  };
  const define=(id,conditions,any=false)=>{
    if(!enabled)return 'always';charge();conditions=[...conditions];
    if(rules.has(id))throw new TypeError('r03-finite-domain: duplicate normal-flow definition');
    rules.set(id,{conditions,any,actions:[]});
    for(const condition of conditions)typeof condition==='string'?watch(watchers,condition,id):watch(nodeWatchers,condition.node,id);
    queue.push(id);drain();return id;
  };
  const all=conditions=>define('normal/all/'+serial++,conditions);
  const when=(gate,action)=>{
    if(!enabled||sealed&&ready.has(gate)){action();return;}
    const id=all([gate]);rules.get(id).actions.push(action);if(sealed)queue.push(id);drain();
  };
  const entries=new Map(),publications=new Map();
  return {
    always:'always',never:define('normal/never',[],true),all,
    any:conditions=>define('normal/any/'+serial++,conditions,true),
    actualWhere:(id,match)=>all([{node:id,match}]),
    normal:id=>enabled?'normal/value/'+id:'always',
    returned:id=>enabled?'normal/return/'+id:'always',
    entry(id,gate){entries.set(id,gate);},
    incoming:id=>entries.get(id)??'always',
    finish(id,dependencies,requirements=[]){
      const publish=all([entries.get(id)??'always',...dependencies,...requirements]);publications.set(id,publish);
      define('normal/value/'+id,[publish,{node:id}]);
    },
    returns(id,gates){define('normal/return/'+id,gates,true);},
    publish(id,action){if(!enabled||!entries.has(id)){action();return;}
      if(!sealed)pendingPublications.push({id,action});else when(publications.get(id)??entries.get(id),action);},
    changed(id){for(const rule of nodeWatchers.get(id)??[])queue.push(rule);drain();},
    seal(){for(const {id,action} of pendingPublications)when(publications.get(id)??entries.get(id),action);sealed=true;drain();},when,
  };
}

function ungroup(value,charge) {
  while(value?.kind==='group') {
    charge();value=value.operand;
  }
  return value;
}
function copyGuards(guards,charge,excluded=undefined) {
  const result=new Map();
  for(const [binding,guard] of guards) {
    charge();if(!excluded?.has(binding))result.set(binding,guard);
  }
  return result;
}
function presenceComparison(condition,inverted,charge) {
  if(condition.kind!=='binary'||!['===','!=='].includes(condition.operator))return null;
  const a=ungroup(condition.left,charge),b=ungroup(condition.right,charge);
  const binding=a?.kind==='reference'?a:b,absence=binding===a?b:a;
  return binding?.kind==='reference'&&['undefined','null'].includes(absence?.kind)
    ?{condition,inverted,binding:binding.binding,type:absence.semanticType??absence.type,operand:binding===a?0:1}:null;
}
export function finitePresenceTest(condition,charge) {
  const {operand,inverted}=booleanOperand(condition,charge);
  return presenceComparison(operand,inverted,charge);
}
export function finitePresenceShortCircuit(condition,charge) {
  let rootPath='';
  while(condition.kind==='group'){charge();condition=condition.operand;rootPath+='/operand';}
  if(!['binary','shortCircuit'].includes(condition.kind)||!['&&','||'].includes(condition.operator))return null;
  const root={},pending=[{expression:condition,node:root,path:rootPath}];let leaves=0,hasPresenceTest=false,hasCall=false;
  while(pending.length) {
    charge();const {expression,node,path}=pending.pop();
    let value=expression,innerPath=path;
    while(value.kind==='group'){charge();value=value.operand;innerPath+='/operand';}
    node.firstLeaf=leaves;
    // Classify through Boolean negation while keeping the original operand
    // for lowering, including its operations and source locations.
    const {operand:flag,inverted}=booleanOperand(value,charge);
    const test=presenceComparison(flag,inverted,charge);
    const semanticType=value.semanticType??value.type;
    const flagType=flag.semanticType??flag.type;
    const booleanBinding=semanticType===boolTypeId&&flag.kind==='reference'&&
      flagType===boolTypeId&&(flag.declaredType??flagType)===boolTypeId;
    // Local scalar operands can use a preceding presence proof without
    // modifying the binding or introducing branch-specific memory effects.
    const scalarOrder=semanticType===boolTypeId&&flag.kind==='binary'&&orderedComparison.has(flag.operator)&&
      finiteNumericUse(flag)?.every(value=>{
        let operand=ungroup(value,charge);
        while(operand.kind==='assertType') {
          charge();operand=ungroup(operand.operand,charge);
        }
        return operand.kind==='reference'||operand.kind==='constant';
      });
    const callWithoutRebinding=value.kind==='call'&&semanticType===boolTypeId
      &&finiteBindingWrites(value.receiver?[value.receiver,value.arguments]:value.arguments,charge).size===0;
    if(test||booleanBinding||scalarOrder||callWithoutRebinding) {
      node.test=test;node.booleanBinding=booleanBinding;node.expression=expression;node.path=path;leaves++;
      hasPresenceTest||=Boolean(test);
      hasCall||=callWithoutRebinding;
    }else {
      if(!['binary','shortCircuit'].includes(value.kind)||!['&&','||'].includes(value.operator))return null;
      Object.assign(node,{condition:value,when:value.operator==='&&',left:{},right:{}});
      pending.push({expression:value.right,node:node.right,path:innerPath+'/right'},
        {expression:value.left,node:node.left,path:innerPath+'/left'});
    }
  }
  return hasPresenceTest?{tree:root,leaves,hasCall}:null;
}
function branchGuard(test,truth,guards,charge) {
  if(!test)return guards;
  const {condition,inverted,binding,type}=test,prior=guards.get(binding);
  // A positive absence test fixes the value. The only remaining distinct
  // narrowing after one exclusion is a test for the other absence type.
  if(prior?.equal||prior?.previous||prior?.type===type)return guards;
  return copyGuards(guards,charge).set(binding,{type,equal:(condition.operator==='===')===(truth!==inverted),
    range:{...condition.range},previous:prior});
}
function commonGuards(left,right,charge) {
  const common=new Map();
  for(const [binding,guard] of left) {
    charge();const other=right.get(binding);
    if(!other)continue;
    // Two distinct tests may extend the same original dominating edge.
    const shared=guard===other||guard===other.previous?guard
      :guard.previous===other||guard.previous===other.previous?guard.previous:undefined;
    if(shared)common.set(binding,shared);
  }
  return common;
}
function shortCircuitEdges(tree,entry,visit,merge,charge,rightEntry=undefined) {
  const pending=[{node:tree,entry}];
  let exits={yes:entry,no:entry};
  while(pending.length) {
    charge();const frame=pending.at(-1),{node,entry}=frame;
    if(node.expression) {
      exits=entry===null?{yes:null,no:null}:visit(node,entry);
    }else if(!frame.started) {
      frame.started=true;pending.push({node:node.left,entry});continue;
    }else if(!frame.left) {
      frame.left=exits;
      const entry=node.when?exits.yes:exits.no;
      rightEntry?.(node.condition.right,entry);
      pending.push({node:node.right,entry});continue;
    }else {
      exits=node.when?{yes:exits.yes,no:merge(frame.left.no,exits.no)}
        :{yes:merge(frame.left.yes,exits.yes),no:exits.no};
    }
    pending.pop();
  }
  return exits;
}
function shortCircuitGuards(tree,entry,charge) {
  const operands=new Map();
  const exits=shortCircuitEdges(tree,entry,(node,guards)=>({
    yes:branchGuard(node.test,true,guards,charge),no:branchGuard(node.test,false,guards,charge),
  }),(left,right)=>commonGuards(left,right,charge),charge,(value,guards)=>operands.set(value,guards));
  return {...exits,operands};
}

/** A selected call may change memory. Reuse the emitter's lexical short-circuit
 * tree so a consumer sees its effects only on edges that passed through it. */
export function finiteBranchEffects(condition,path,entry,evaluate,combine,charge) {
  const logical=finitePresenceShortCircuit(condition,charge);
  if(!logical?.hasCall)return undefined;
  return shortCircuitEdges(logical.tree,entry,(node,entry)=>evaluate(node.expression,path+node.path,entry),combine,charge);
}
export function finiteBindingWrites(body,charge) {
  const written=new Set(),stack=[body];
  while(stack.length) {
    charge();const value=stack.pop();if(!value||typeof value!=='object')continue;
    const binding=value.kind==='assignment'?value.target.binding:
      value.kind==='update'?value.operand?.binding??value.target?.binding:undefined;
    if(binding)written.add(binding);
    for(const child of Object.values(value))if(child&&typeof child==='object')stack.push(child);
  }return written;
}
function stableGuards(guards,body,charge) {
  return copyGuards(guards,charge,finiteBindingWrites(body,charge));
}

/** The domain solver's single statement traversal. Normal continuation gates
 * preserve lexical nodes while excluding assignments and returns on dead paths. */
export function finiteNormalBody(statements,path,fn,{flow,expression,binding,copy,charge,voidResult,requirements=[]}) {
  const returns=[],root={body:statements,path,guards:new Map(),gate:flow.always,continues:true,index:0},stack=[root];
  while(stack.length) {
    charge();const frame=stack[stack.length-1];
    if(frame.index===frame.body.length) {
      stack.pop();
      if(frame.complete) {
        if(frame.locals?.size&&frame.guards.size)frame.guards=copyGuards(frame.guards,charge,frame.locals);
        frame.complete(frame);
      }
      continue;
    }
    const s=frame.body[frame.index],p=frame.path+'/'+frame.index++;
    const emit=(value,suffix,logical=undefined)=>{
      if(frame.guards.size)frame.guards=stableGuards(frame.guards,value,charge);
      return expression(value,p+suffix,fn,frame.guards,frame.gate,logical);
    };
    if(s.kind==='local') {
      (frame.locals??=new Set()).add(s.binding.id);
      const id=emit(s.initializer,'/initializer');copy(id,binding(fn,s.binding.id,s.binding.type));frame.gate=flow.normal(id);
    }else if(s.kind==='return'||s.kind==='constructorReturn') {
      if(s.value){const id=emit(s.value,'/value');copy(id,fn.id+'/return');returns.push(flow.normal(id));}
      else returns.push(frame.gate);
      frame.gate=flow.never;frame.continues=false;
    }else if(s.kind==='expression') {
      frame.gate=flow.normal(emit(s.expression,'/expression'));
    }else if(s.kind==='initializeOwnFields') {
      frame.gate=flow.all([frame.gate,...requirements]);
    }else if(s.kind==='block') {
      // Each expression invalidates its own writes. Earlier statements in a
      // nested body still read the value established on the incoming edge.
      stack.push({body:s.body,path:p+'/body',guards:frame.guards,gate:frame.gate,continues:true,index:0,
        complete:exit=>{frame.gate=exit.gate;frame.continues&&=exit.continues;frame.guards=exit.guards;}});
    }else if(s.kind==='if'||s.kind==='while') {
      // Only the condition and body can replace a local value on the backedge.
      // The same filtered entry proofs also hold on the zero-iteration exit.
      if(s.kind==='while'&&frame.guards.size)frame.guards=stableGuards(frame.guards,s,charge);
      const logical=finitePresenceShortCircuit(s.condition,charge);
      const edges=logical?shortCircuitGuards(logical.tree,frame.guards,charge):null;
      const condition=emit(s.condition,'/condition',edges?.operands),
        incoming=flow.normal(condition),test=logical?null:finitePresenceTest(s.condition,charge);
      if(s.kind==='while') {
        const literal=literalLoopCondition(s,charge),entryGuards=frame.guards;
        const bodyGuards=edges?.yes??branchGuard(test,true,entryGuards,charge);
        frame.guards=edges?.no??branchGuard(test,false,entryGuards,charge);
        frame.gate=literal===true?flow.never:incoming;
        stack.push({body:s.body,path:p+'/body',guards:bodyGuards,
          gate:literal===false?flow.never:incoming,continues:true,index:0});
      }else {
        const arm=literalIfArm(s,charge);
        const exits=[];let remaining=2;
        const complete=exit=>{
          exits.push(exit);if(--remaining!==0)return;
          frame.gate=flow.any(exits.map(row=>row.gate));
          const continuing=exits.filter(row=>row.continues);
          frame.continues&&=continuing.length!==0;
          // A lexically present edge still participates in the SSA merge even
          // when the normal-flow solver knows its condition is false.
          const [first,second]=continuing;
          frame.guards=second?commonGuards(first.guards,second.guards,charge):first?.guards??new Map();
        };
        // Suspend this sequence until both arms have registered their exits.
        for(const key of ['else','then']) {
          const truth=key==='then';
          const guards=edges?(truth?edges.yes:edges.no):branchGuard(test,truth,frame.guards,charge);
          stack.push({body:s[key],path:p+'/'+key,guards,
            gate:arm===null||arm===key?incoming:flow.never,continues:true,index:0,complete});
        }
      }
    }
  }
  if(voidResult)returns.push(root.gate);flow.returns(fn.id,returns.map(gate=>flow.all([gate,...requirements])));
}
