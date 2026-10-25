// SPDX-License-Identifier: MIT
import {i32TypeId} from './identity.mjs';

const numericBinary=new Set(['+','-','*','/','%','<<','>>','>>>','&','|','^','<','<=','>','>=']);
/** The accepted first numeric-use domain is exactly same-i32 plus undefined. */
export function finiteNumericUse(value) {
  const operands=value.kind==='binary'?[value.left,value.right]:value.kind==='unary'?[value.operand]:[];
  const approved=value.kind==='binary'?numericBinary.has(value.operator):value.kind==='unary'&&['+','-','~'].includes(value.operator);
  return approved&&operands.every(operand=>(operand.semanticType??operand.type)===i32TypeId)?operands:null;
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
        const node=nodes.get(condition.node);return condition.type?Boolean(node?.actual.has(condition.type)||condition.possible&&node?.pending.size)
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

function branchGuard(condition,truth,guards) {
  const next=new Map(guards);let a=condition.left,b=condition.right;
  if(condition.kind!=='binary'||!['===','!=='].includes(condition.operator))return next;
  while(a?.kind==='group')a=a.operand;while(b?.kind==='group')b=b.operand;
  const binding=a?.kind==='reference'?a:b,absence=binding===a?b:a;
  if(binding?.kind==='reference'&&['undefined','null'].includes(absence?.kind))
    next.set(binding.binding,{type:absence.type,equal:(condition.operator==='===')===truth,range:{...condition.range}});
  return next;
}
function stableGuards(guards,body,charge) {
  const result=new Map(guards),stack=[body];
  while(stack.length) {
    charge();const value=stack.pop();if(!value||typeof value!=='object')continue;
    if(value.kind==='assignment')result.delete(value.target.binding);
    if(value.kind==='update')result.delete(value.operand?.binding??value.target?.binding);
    for(const child of Object.values(value))if(child&&typeof child==='object')stack.push(child);
  }return result;
}

/** The domain solver's single statement traversal. Normal continuation gates
 * prevent an earlier numeric trap from publishing later assignments/returns. */
export function finiteNormalBody(statements,path,fn,{flow,expression,binding,copy,charge,voidResult,requirements=[]}) {
  const returns=[],root={body:statements,path,guards:new Map(),gate:flow.always,index:0},stack=[root];
  while(stack.length) {
    charge();const frame=stack[stack.length-1];
    if(frame.index===frame.body.length) {
      stack.pop();if(frame.complete)frame.complete(frame.gate);continue;
    }
    const s=frame.body[frame.index],p=frame.path+'/'+frame.index++;
    const emit=(value,suffix)=>expression(value,p+suffix,fn,frame.guards,frame.gate);
    if(s.kind==='local') {
      const id=emit(s.initializer,'/initializer');copy(id,binding(fn,s.binding.id,s.binding.type));frame.gate=flow.normal(id);
    }else if(s.kind==='return'||s.kind==='constructorReturn') {
      if(s.value){const id=emit(s.value,'/value');copy(id,fn.id+'/return');returns.push(flow.normal(id));}
      else returns.push(frame.gate);frame.gate=flow.never;
    }else if(s.kind==='expression') {
      frame.gate=flow.normal(emit(s.expression,'/expression'));
    }else if(s.kind==='block') {
      stack.push({body:s.body,path:p+'/body',guards:stableGuards(frame.guards,s.body,charge),gate:frame.gate,index:0,
        complete:gate=>{frame.gate=gate;}});
    }else if(s.kind==='if'||s.kind==='while') {
      const condition=emit(s.condition,'/condition'),incoming=flow.normal(condition);
      if(s.kind==='while') {
        frame.gate=incoming;
        stack.push({body:s.body,path:p+'/body',guards:stableGuards(frame.guards,s.body,charge),gate:incoming,index:0});
      }else {
        const exits=[];let remaining=2;
        const complete=gate=>{exits.push(gate);if(--remaining===0)frame.gate=flow.any(exits);};
        // Suspend this sequence until both arms have registered their exits.
        for(const key of ['else','then'])stack.push({body:s[key],path:p+'/'+key,
          guards:stableGuards(branchGuard(s.condition,key==='then',frame.guards),s[key],charge),gate:incoming,index:0,complete});
      }
    }
  }
  if(voidResult)returns.push(root.gate);flow.returns(fn.id,returns.map(gate=>flow.all([gate,...requirements])));
}
