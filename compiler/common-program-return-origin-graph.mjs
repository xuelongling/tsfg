// SPDX-License-Identifier: MIT
// Typed boundary for generic-JSON ordinary v3 equation DTOs, not a Source,
// Actual/Borrow permission, fixed-table identity or containment validator.
// This module imports no factory, solver, AST, Program, schema or Runtime.

/** @typedef {{kind:string}} TypeRow */
/** @typedef {{kind:string,parameterTypes:string[],returnType:string,lexicalEnvironment?:string|null,activationEnvironment?:string|null}} FunctionRow */
/** @typedef {{functionId:string,types:Map<string,TypeRow>,functions:Map<string,FunctionRow>,globals:Map<string,string>,captures:Map<string,string>,fields:Set<string>}} Directory */
/** @typedef {'normal'|'language'} Completion */
/** @typedef {{kind:'parameter',type:string,index:number}|{kind:'global',type:string,id:string}|{kind:'capture',type:string,id:string}|{kind:'local',type:string}|{kind:'nonowning',type:string}|{kind:'unknown',type:null}|{kind:'join',type:string|null,inputs:number[]}|{kind:'gate',type:string|null,inputs:number[],control:number}|{kind:'projection',type:string,bases:number[],selector:string,view:string,heap:number,control:number}|{kind:'copy',type:string,bases:number[],site:string,heap:number,control:number}|{kind:'call',type:string|null,call:number,completion:Completion}} Value */
/** @typedef {{kind:'entry'}|{kind:'join',inputs:number[]}|{kind:'store',previous:number,bases:number[],selector:string,view:string,values:number[],control:number,initialize:boolean}|{kind:'copy',previous:number,value:number}|{kind:'call',call:number,completion:Completion}} Heap */
/** @typedef {{kind:'entry'}|{kind:'join',inputs:number[]}|{kind:'call',call:number,completion:Completion}} Control */
/** @typedef {{functionId:string,arguments:number[][],heap:number,control:number,site:string}} Call */
/** @typedef {{heap:number,control:number}} State */
/** @typedef {{values:number[],flag:'read'|'write'|'structural',control:number}} Access */
/** @typedef {{format:{family:'tsfg.return-origin-graph-candidate',version:3},nodes:Value[],heaps:Heap[],controls:Control[],calls:Call[],normal:number[],language:number[],exits:{normal:State[],language:State[]},accesses:Access[]}} Graph */

/**
 * directory is an admitted HIR/fixed-signature projection, independent of the
 * current body or physical capacity. parameterTypes is the ordered logical
 * vector INCLUDING an ordinary method receiver; constructor frames are OPEN.
 * raw is generic JSON data already separated from host objects/byte parsing.
 * The returned graph is an owned copy. Failure is a DTO boundary error, never
 * proof that a Source implementation is illegal or that an upper is covered.
 * @param {unknown} raw
 * @param {Directory} directory
 * @param {(units?:number)=>void} spend
 * @returns {{status:'typed',graph:Graph}|{status:'open',reason:string}}
 */
export function readCommonReturnOriginGraph(raw,directory,spend) {
  /** @returns {never} */
  const fail=message=>{throw Object.assign(new TypeError('return-origin-graph: '+message),{code:'return-origin-graph-boundary'});};
  /** @param {unknown} value @returns {string} */
  const text=value=>{spend();if(typeof value!=='string')fail('string required');spend(Math.ceil(value.length/8)+1);return value;};
  const equal=(left,right)=>{spend(Math.ceil((left.length+right.length)/8)+1);return left===right;};
  /** @param {unknown} value @param {string[]} keys @returns {Record<string,unknown>} */
  const record=(value,keys)=>{
    spend(keys.length+1);if(value===null||typeof value!=='object'||Array.isArray(value))fail('record required');
    const row=/** @type {Record<string,unknown>} */(value),prototype=Object.getPrototypeOf(value);
    if(prototype!==Object.prototype&&prototype!==null)fail('JSON record required');let count=0;
    // No Object.keys/Reflect array is allocated before the shared meter can
    // observe a large unexpected record. Generic JSON has enumerable own keys.
    for(const name in row){spend(Math.ceil(name.length/8)+keys.length+1);if(!Object.hasOwn(row,name)||!keys.includes(name))fail('unexpected field');count++;}
    if(count!==keys.length)fail('missing field');for(const name of keys){spend();const descriptor=Object.getOwnPropertyDescriptor(row,name);if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))fail('JSON data field required');}
    return row;
  };
  /** @param {unknown} value @returns {unknown[]} */
  const array=value=>{spend();if(!Array.isArray(value))fail('array required');spend(value.length+1);return value;};
  /** @param {unknown} value @param {number} length @returns {number} */
  const ref=(value,length)=>{spend();if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>=length)fail('reference range');return value;};
  /** @param {unknown} value @param {number} length @returns {number[]} */
  const refs=(value,length)=>{const values=array(value),result=[];let previous=-1;
    for(const raw of values){spend();const id=ref(raw,length);if(id<=previous)fail('references must be sorted unique');previous=id;result.push(id);}return result;};
  /** @param {unknown} value @returns {string} */
  const ownedType=value=>{const id=text(value);spend();if(!directory.types.has(id))fail('unowned type');return id;};
  /** @param {unknown} value @returns {string|null} */
  const nullableType=value=>value===null?null:ownedType(value);
  /** @param {unknown} value @returns {Completion} */
  const completion=value=>{const result=text(value);if(result!=='normal'&&result!=='language')fail('completion');return result;};
  /** @param {unknown} value @returns {string} */
  const selector=value=>{const name=text(value);if(equal(name,'element'))return name;
    spend(Math.ceil(name.length/8)+1);if(!name.startsWith('field:')||!directory.fields.has(name.slice(6)))fail('unowned field selector');return name;};
  /** @param {string} id @returns {FunctionRow} */
  const functionRow=id=>{spend();const fn=directory.functions.get(id);if(fn===undefined)fail('unowned function');return fn;};
  /** @param {FunctionRow} fn @returns {string|null} */
  const protocol=fn=>{spend();if(fn.kind==='construction-body')return 'construction-frame-open';
    if(fn.lexicalEnvironment!=null||fn.activationEnvironment!=null)return 'code-environment-open';
    if(fn.kind!=='source'&&fn.kind!=='method')return 'function-protocol-open';return null;};
  const current=functionRow(directory.functionId),currentProtocol=protocol(current);
  if(currentProtocol!==null)return {status:'open',reason:currentProtocol};
  // The signature comes from the admitted directory, not graph parameter use.
  spend(current.parameterTypes.length+1);for(const type of current.parameterTypes)ownedType(type);ownedType(current.returnType);
  const row=record(raw,['format','nodes','heaps','controls','calls','normal','language','exits','accesses']);
  const format=record(row.format,['family','version']);if(!equal(text(format.family),'tsfg.return-origin-graph-candidate')||format.version!==3)fail('ordinary graph format v3 required');
  const rawNodes=array(row.nodes),rawHeaps=array(row.heaps),rawControls=array(row.controls),rawCalls=array(row.calls),rawAccesses=array(row.accesses);
  const counts={nodes:rawNodes.length,heaps:rawHeaps.length,controls:rawControls.length,calls:rawCalls.length};
  /** @type {Call[]} */
  const calls=[];
  /** @type {FunctionRow[]} */
  const callees=[];
  for(const rawCall of rawCalls){spend();const call=record(rawCall,['functionId','arguments','heap','control','site']),functionId=text(call.functionId),fn=functionRow(functionId),unsupported=protocol(fn);
    if(unsupported!==null)return {status:'open',reason:unsupported};
    const rawArguments=array(call.arguments);if(rawArguments.length!==fn.parameterTypes.length)fail('logical call arity');
    spend(fn.parameterTypes.length+1);for(const type of fn.parameterTypes)ownedType(type);ownedType(fn.returnType);
    const arguments_=[];for(const argument of rawArguments){spend();arguments_.push(refs(argument,counts.nodes));}
    calls.push({functionId,arguments:arguments_,heap:ref(call.heap,counts.heaps),control:ref(call.control,counts.controls),site:text(call.site)});callees.push(fn);
  }
  /** @param {unknown} rawNode @returns {Value} */
  const readNode=rawNode=>{
    // Discriminator alone is observed before selecting the owning exact row.
    spend();if(rawNode===null||typeof rawNode!=='object'||Array.isArray(rawNode))fail('node record');
    const kind=text(/** @type {Record<string,unknown>} */(rawNode).kind);
    if(kind==='parameter'){const value=record(rawNode,['kind','type','index']),index=ref(value.index,current.parameterTypes.length),type=ownedType(value.type);
      if(!equal(type,current.parameterTypes[index]))fail('parameter Source view differs');return {kind,type,index};}
    if(kind==='global'||kind==='capture'){const value=record(rawNode,['kind','type','id']),type=ownedType(value.type),id=text(value.id),directory_ =kind==='global'?directory.globals:directory.captures;spend();
      const declared=directory_.get(id);if(declared===undefined||!equal(type,declared))fail('unowned root or differing Source view');return {kind,type,id};}
    if(kind==='local'||kind==='nonowning'){const value=record(rawNode,['kind','type']),type=ownedType(value.type);
      if(kind==='local'){spend();const shape=/** @type {TypeRow} */(directory.types.get(type));if(shape.kind==='unknown'||shape.kind==='union'||shape.kind==='void')fail('local requires an actual tag');}
      return {kind,type};}
    if(kind==='unknown'){const value=record(rawNode,['kind','type']);if(value.type!==null)fail('unknown type must be null');return {kind,type:null};}
    if(kind==='join'){const value=record(rawNode,['kind','type','inputs']);return {kind,type:nullableType(value.type),inputs:refs(value.inputs,counts.nodes)};}
    if(kind==='gate'){const value=record(rawNode,['kind','type','inputs','control']);return {kind,type:nullableType(value.type),inputs:refs(value.inputs,counts.nodes),control:ref(value.control,counts.controls)};}
    if(kind==='projection'){const value=record(rawNode,['kind','type','bases','selector','view','heap','control']);return {kind,type:ownedType(value.type),bases:refs(value.bases,counts.nodes),selector:selector(value.selector),view:ownedType(value.view),heap:ref(value.heap,counts.heaps),control:ref(value.control,counts.controls)};}
    if(kind==='copy'){const value=record(rawNode,['kind','type','bases','site','heap','control']);return {kind,type:ownedType(value.type),bases:refs(value.bases,counts.nodes),site:text(value.site),heap:ref(value.heap,counts.heaps),control:ref(value.control,counts.controls)};}
    if(kind==='call'){const value=record(rawNode,['kind','type','call','completion']),call=ref(value.call,counts.calls),channel=completion(value.completion),type=nullableType(value.type);
      if(channel==='language'?type!==null:type===null||!equal(type,callees[call].returnType))fail('call result Source view differs');return {kind,type,call,completion:channel};}
    return fail('unsupported ordinary value kind');
  };
  /** @type {Value[]} */
  const nodes=[];for(const value of rawNodes){spend();nodes.push(readNode(value));}
  /** @type {Heap[]} */
  const heaps=[];
  for(const rawHeap of rawHeaps){spend();if(rawHeap===null||typeof rawHeap!=='object'||Array.isArray(rawHeap))fail('heap record');const kind=text(/** @type {Record<string,unknown>} */(rawHeap).kind);
    if(kind==='entry'){record(rawHeap,['kind']);heaps.push({kind});}
    else if(kind==='join'){const value=record(rawHeap,['kind','inputs']);heaps.push({kind,inputs:refs(value.inputs,counts.heaps)});}
    else if(kind==='store'){const value=record(rawHeap,['kind','previous','bases','selector','view','values','control','initialize']);if(typeof value.initialize!=='boolean')fail('initialize boolean');
      heaps.push({kind,previous:ref(value.previous,counts.heaps),bases:refs(value.bases,counts.nodes),selector:selector(value.selector),view:ownedType(value.view),values:refs(value.values,counts.nodes),control:ref(value.control,counts.controls),initialize:value.initialize});}
    else if(kind==='copy'){const value=record(rawHeap,['kind','previous','value']),id=ref(value.value,counts.nodes);if(nodes[id].kind!=='copy')fail('clone heap requires copy node');heaps.push({kind,previous:ref(value.previous,counts.heaps),value:id});}
    else if(kind==='call'){const value=record(rawHeap,['kind','call','completion']);heaps.push({kind,call:ref(value.call,counts.calls),completion:completion(value.completion)});}
    else fail('unsupported ordinary heap kind');
  }
  /** @type {Control[]} */
  const controls=[];
  for(const rawControl of rawControls){spend();if(rawControl===null||typeof rawControl!=='object'||Array.isArray(rawControl))fail('control record');const kind=text(/** @type {Record<string,unknown>} */(rawControl).kind);
    if(kind==='entry'){record(rawControl,['kind']);controls.push({kind});}
    else if(kind==='join'){const value=record(rawControl,['kind','inputs']);controls.push({kind,inputs:refs(value.inputs,counts.controls)});}
    else if(kind==='call'){const value=record(rawControl,['kind','call','completion']);controls.push({kind,call:ref(value.call,counts.calls),completion:completion(value.completion)});}
    else fail('unsupported ordinary control kind');
  }
  /** @param {unknown} rawStates @returns {State[]} */
  const states=rawStates=>{const result=[];let heap=-1,control=-1;
    for(const rawState of array(rawStates)){spend();const state=record(rawState,['heap','control']),nextHeap=ref(state.heap,counts.heaps),nextControl=ref(state.control,counts.controls);
      if(nextHeap<heap||nextHeap===heap&&nextControl<=control)fail('states must be sorted unique');heap=nextHeap;control=nextControl;result.push({heap,control});}return result;};
  const exits=record(row.exits,['normal','language']),normal=refs(row.normal,counts.nodes),language=refs(row.language,counts.nodes),normalExits=states(exits.normal),languageExits=states(exits.language);
  /** @type {Access[]} */
  const accesses=[];let previous='';
  for(const rawAccess of rawAccesses){spend();const value=record(rawAccess,['values','flag','control']),flag=text(value.flag);if(flag!=='read'&&flag!=='write'&&flag!=='structural')fail('access flag');
    const values=refs(value.values,counts.nodes),control=ref(value.control,counts.controls);
    // This exact ordinary row's canonical key is control,flag,values. Charge
    // before JSON allocation/comparison; no ref-list sort or host varargs.
    spend(values.length*3+32);const order=JSON.stringify({control,flag,values});spend(Math.ceil((previous.length+order.length)/8)+1);
    if(previous!==''&&previous>=order)fail('accesses must be canonical sorted unique');previous=order;accesses.push({values,flag,control});
  }
  return {status:'typed',graph:{format:{family:'tsfg.return-origin-graph-candidate',version:3},nodes,heaps,controls,calls,normal,language,exits:{normal:normalExits,language:languageExits},accesses}};
}
