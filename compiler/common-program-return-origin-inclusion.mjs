// SPDX-License-Identifier: MIT
// A structural certificate for the ordinary v3 equation language. Failure to
// find this certificate is OPEN, not a claim that a Source body is invalid.
// Inputs are typed graphs from ONE admitted, immutable contract table. The
// reader must already have checked scope/schema/group identities and complete
// callee references; FnId here never reinterprets an older caller reference.
// Code/Env and receiver-frame equations are not part of this language yet.

/** @typedef {'normal'|'language'} Completion */
/** @typedef {{kind:'parameter',type:string,index:number}|{kind:'global'|'capture',type:string,id:string}|{kind:'local'|'nonowning',type:string}|{kind:'unknown',type:null}|{kind:'join',type:string|null,inputs:number[]}|{kind:'gate',type:string|null,inputs:number[],control:number}|{kind:'projection',type:string,bases:number[],selector:string,view:string,heap:number,control:number}|{kind:'copy',type:string,bases:number[],site:string,heap:number,control:number}|{kind:'call',type:string|null,call:number,completion:Completion}} Value */
/** @typedef {{kind:'entry'}|{kind:'join',inputs:number[]}|{kind:'store',previous:number,bases:number[],selector:string,view:string,values:number[],control:number,initialize:boolean}|{kind:'copy',previous:number,value:number}|{kind:'call',call:number,completion:Completion}} Heap */
/** @typedef {{kind:'entry'}|{kind:'join',inputs:number[]}|{kind:'call',call:number,completion:Completion}} Control */
/** @typedef {{functionId:string,arguments:number[][],heap:number,control:number,site:string}} Call */
/** @typedef {{heap:number,control:number}} State */
/** @typedef {{nodes:Value[],heaps:Heap[],controls:Control[],calls:Call[],normal:number[],language:number[],exits:{normal:State[],language:State[]},accesses:{values:number[],flag:string,control:number}[]}} Graph */
/** @typedef {{kind:'values',left:number[],right:number[]}|{kind:'node',left:number,right:number}|{kind:'valueChoice',left:number,right:number[]}|{kind:'heapChoice',left:number,right:number[]}|{kind:'heapAlternatives',left:number,right:number[]}|{kind:'callChoice',left:number,right:number[]}|{kind:'heap'|'call',left:number,right:number}} Obligation */
/** @typedef {{pending:Obligation[],seen:Set<string>,copies:Map<string,string>,locals:Map<number,number>,calls:Map<number,number>}} Certificate */

/**
 * This proves a sufficient simulation. It does not unfold a different call
 * into its body or identify distinct field views without an admitted adapter.
 * Native/nonowning values carry no owning data; completion and effects remain
 * separate obligations. Data heap Bottom is an empty relation, not dead code.
 * @param {Graph} body
 * @param {Graph} upper
 * @param {Map<string,{graph:Graph}>} contracts
 * @param {(units?:number)=>void} spend
 */
export function commonReturnOriginsInclusion(body,upper,contracts,spend) {
  const symbolEqual=(a,b)=>{spend(Math.ceil((a.length+b.length)/8)+1);return a===b;};
  spend(contracts.size+3);
  const graphs=new Set([body,upper]);
  for(const row of contracts.values()){spend();graphs.add(row.graph);}
  // Unknown is an unresolved boundary, not an implicit permission to discard
  // returned owning data. Its future host semantics must be admitted separately.
  for(const graph of graphs)for(const row of graph.nodes){spend();if(row.kind==='unknown')return {status:'open',reason:'unknown-data-origin'};}
  /** @type {Map<Graph,boolean[]>} */
  const controls=new Map();
  for(const graph of graphs){spend(graph.controls.length+1);controls.set(graph,new Array(graph.controls.length).fill(false));}
  const live=(graph,id)=>controls.get(graph)[id];
  const completes=(graph,completion)=>{for(const state of graph.exits[completion]){spend();if(live(graph,state.control))return true;}return false;};
  for(const graph of graphs)for(const row of graph.calls){spend(Math.ceil(row.functionId.length/8)+1);if(!contracts.has(row.functionId))return {status:'open',reason:'missing-fixed-call'};}
  // Continuation equations are positive booleans. Solve their LEAST fixed
  // point first; greatest simulation must not manufacture a recursive exit.
  let changed=true;
  while(changed){changed=false;
    for(const graph of graphs){const bits=controls.get(graph);
      for(let id=0;id<graph.controls.length;id++){spend();if(bits[id])continue;const row=graph.controls[id];let value=row.kind==='entry';
        if(row.kind==='join')for(const parent of row.inputs){spend();if(bits[parent]){value=true;break;}}
        if(row.kind==='call'){const call=graph.calls[row.call];value=live(graph,call.control)&&completes(contracts.get(call.functionId).graph,row.completion);}
        if(value){bits[id]=true;changed=true;}
      }
    }
  }
  const valueLive=(graph,row)=>{
    spend();if(row.kind==='gate'||row.kind==='copy'||row.kind==='projection')return live(graph,row.control);
    if(row.kind==='call'){const call=graph.calls[row.call];return live(graph,call.control)&&completes(contracts.get(call.functionId).graph,row.completion);}return true;
  };
  // Epsilon unions are LEAST unions. A seedless join cycle has no atoms.
  const atoms=(graph,refs)=>{
    spend(refs.length*2+1);const pending=[...refs],seen=new Set(),result=[];
    while(pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);const row=graph.nodes[id];
      if(!valueLive(graph,row)||row.kind==='nonowning')continue;
      if(row.kind==='join'||row.kind==='gate'){spend(row.inputs.length);for(const input of row.inputs)pending.push(input);}else result.push(id);
    }return result;
  };
  // An upper weak store/copy includes its predecessor. Collect those optional
  // alternatives without coinductively accepting an epsilon-only cycle.
  const heapAtoms=(graph,refs,optional)=>{
    spend(refs.length*2+1);const pending=[...refs],seen=new Set(),result=[];
    while(pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);const row=graph.heaps[id];
      if(row.kind==='join'){spend(row.inputs.length);for(const input of row.inputs)pending.push(input);continue;}
      if(row.kind==='store'){
        const inactive=!live(graph,row.control)||atoms(graph,row.values).length===0;
        if(inactive||optional)pending.push(row.previous);if(inactive)continue;
      }
      if(row.kind==='copy'){
        const inactive=atoms(graph,[row.value]).length===0;
        if(inactive||optional)pending.push(row.previous);if(inactive)continue;
      }result.push(id);
    }return result;
  };
  /** @type {Obligation[]} */
  const pending=[];
  for(const completion of /** @type {Completion[]} */ (['normal','language'])){
    spend(upper.exits[completion].length+1);const right=upper.exits[completion].filter(state=>{spend();return live(upper,state.control);}).map(state=>{spend();return state.heap;});
    let reachable=false;
    for(const state of body.exits[completion]){spend();if(live(body,state.control)){reachable=true;pending.push({kind:'heapChoice',left:state.heap,right});}}
    if(reachable&&!right.length)return {status:'open',reason:'unmatched-completion'};
    if(reachable)pending.push({kind:'values',left:body[completion],right:upper[completion]});
  }
  for(const access of body.accesses){spend();if(!live(body,access.control))continue;const right=[];
    for(const allowed of upper.accesses){spend();if(symbolEqual(access.flag,allowed.flag)&&live(upper,allowed.control)){spend(allowed.values.length);for(const value of allowed.values)right.push(value);}}
    pending.push({kind:'values',left:access.values,right});
  }
  // Even a discarded result or a nonterminating call may have prefix effects.
  for(let left=0;left<body.calls.length;left++){spend();const row=body.calls[left];if(!live(body,row.control))continue;const right=[];
    for(let id=0;id<upper.calls.length;id++){spend();if(live(upper,upper.calls[id].control)&&symbolEqual(row.functionId,upper.calls[id].functionId))right.push(id);}
    if(!right.length)return {status:'open',reason:'unmatched-live-call'};
    pending.push({kind:'callChoice',left,right});
  }
  /** @type {Certificate[]} */
  const search=[{pending,seen:new Set(),copies:new Map(),locals:new Map(),calls:new Map()}];
  const fork=(state,tasks)=>{
    spend(state.pending.length+tasks.length+state.seen.size+state.copies.size*2+state.locals.size*2+state.calls.size*2+1);
    search.push({pending:[...state.pending,...tasks],seen:new Set(state.seen),copies:new Map(state.copies),locals:new Map(state.locals),calls:new Map(state.calls)});
  };
  while(search.length){spend();const state=search.pop();let failed=false;
    while(state.pending.length&&!failed){spend();const task=state.pending.pop();
      if(task.kind==='values'){
        const right=atoms(upper,task.right);for(const left of atoms(body,task.left)){spend();state.pending.push({kind:'valueChoice',left,right});}continue;
      }
      if(task.kind==='valueChoice'||task.kind==='heapAlternatives'||task.kind==='callChoice'){
        if(!task.right.length){failed=true;continue;}
        const kind=task.kind==='valueChoice'?'node':task.kind==='heapAlternatives'?'heap':'call';
        for(const right of task.right){spend();fork(state,[{kind,left:task.left,right}]);}failed=true;continue;
      }
      if(task.kind==='heapChoice'){
        const right=heapAtoms(upper,task.right,true);
        for(const left of heapAtoms(body,[task.left],false)){spend();
          // All body union atoms must be covered, with one allocation map.
          state.pending.push({kind:'heapAlternatives',left,right});
        }continue;
      }
      const key=task.kind+':'+task.left+':'+task.right;
      if(task.kind==='call'){
        const a=body.calls[task.left],b=upper.calls[task.right],mapped=state.calls.get(task.left);
        if(mapped!==undefined&&mapped!==task.right||!symbolEqual(a.functionId,b.functionId)||a.arguments.length!==b.arguments.length){failed=true;continue;}
        state.calls.set(task.left,task.right);if(state.seen.has(key))continue;state.seen.add(key);
        if(live(body,a.control)&&!live(upper,b.control)){failed=true;continue;}
        spend(a.arguments.length+1);for(let index=0;index<a.arguments.length;index++)state.pending.push({kind:'values',left:a.arguments[index],right:b.arguments[index]});
        state.pending.push({kind:'heapChoice',left:a.heap,right:[b.heap]});continue;
      }
      if(task.kind==='node'){
        const a=body.nodes[task.left],b=upper.nodes[task.right];if(a.kind!==b.kind){failed=true;continue;}
        if(a.kind==='parameter'&&b.kind==='parameter'){if(a.index!==b.index)failed=true;continue;}
        if((a.kind==='global'||a.kind==='capture')&&(b.kind==='global'||b.kind==='capture')){if(!symbolEqual(a.id,b.id))failed=true;continue;}
        if(a.kind==='unknown')continue;
        if(a.kind==='local'&&b.kind==='local'){
          const mapped=state.locals.get(task.left);if(!symbolEqual(a.type,b.type)||mapped!==undefined&&mapped!==task.right){failed=true;continue;}
          state.locals.set(task.left,task.right);continue;
        }
        if(a.kind==='copy'&&b.kind==='copy'){
          spend(Math.ceil((a.site.length+b.site.length)/8)+1);const mapped=state.copies.get(a.site);
          if(mapped!==undefined&&!symbolEqual(mapped,b.site)){failed=true;continue;}state.copies.set(a.site,b.site);
        }
        if(state.seen.has(key))continue;state.seen.add(key);
        if(a.kind==='projection'&&b.kind==='projection'){
          if(!symbolEqual(a.selector,b.selector)||!symbolEqual(a.view,b.view)){failed=true;continue;}
          state.pending.push({kind:'values',left:a.bases,right:b.bases},{kind:'heapChoice',left:a.heap,right:[b.heap]});
        }else if(a.kind==='copy'&&b.kind==='copy'){
          state.pending.push({kind:'values',left:a.bases,right:b.bases},{kind:'heapChoice',left:a.heap,right:[b.heap]});
        }else if(a.kind==='call'&&b.kind==='call'){
          if(a.completion!==b.completion){failed=true;continue;}state.pending.push({kind:'call',left:a.call,right:b.call});
        }else failed=true;
        continue;
      }
      const a=body.heaps[task.left],b=upper.heaps[task.right];if(a.kind!==b.kind){failed=true;continue;}
      if(state.seen.has(key))continue;state.seen.add(key);
      if(a.kind==='entry')continue;
      if(a.kind==='store'&&b.kind==='store'){
        if(!symbolEqual(a.selector,b.selector)||!symbolEqual(a.view,b.view)){failed=true;continue;}
        state.pending.push({kind:'values',left:a.bases,right:b.bases},{kind:'values',left:a.values,right:b.values},{kind:'heapChoice',left:a.previous,right:[b.previous]});
      }else if(a.kind==='copy'&&b.kind==='copy'){
        state.pending.push({kind:'node',left:a.value,right:b.value},{kind:'heapChoice',left:a.previous,right:[b.previous]});
      }else if(a.kind==='call'&&b.kind==='call'){
        if(a.completion!==b.completion){failed=true;continue;}state.pending.push({kind:'call',left:a.call,right:b.call});
      }else failed=true;
    }
    if(!failed)return {status:'covered',reason:null};
  }
  return {status:'open',reason:'no-structural-certificate'};
}

