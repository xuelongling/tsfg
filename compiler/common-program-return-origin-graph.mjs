// SPDX-License-Identifier: MIT
// Typed boundary for generic-JSON Graph5 Code/Env/receiver equation DTOs, not a Source,
// Actual/Borrow permission, fixed-table identity or containment validator.
// This module imports no factory, solver, AST, Program, schema or Runtime.
import {commonReceiverActivations} from './common-program-return-origin-receivers.mjs';

/** @typedef {{kind:string}} TypeRow */
/** @typedef {{id:string,owner:string,base:string|null,receiverIndex:0}} ConstructionProtocol */
/** @typedef {{id:string,owner:string,base:string|null,kind:string,functionId:string|null}} ConstructionRow */
/** @typedef {{kind:string,parameterTypes:string[],returnType:string,lexicalEnvironment?:string|null,activationEnvironment?:string|null,construction?:ConstructionProtocol|null}} FunctionRow */
/** @typedef {{parent:string|null,slots:{key:string,type:string,writable:boolean}[]}} EnvironmentRow */
/** @typedef {{functionId:string,types:Map<string,TypeRow>,functions:Map<string,FunctionRow>,globals:Map<string,string>,fields:Set<string>,environments:Map<string,EnvironmentRow>,constructions:Map<string,ConstructionRow>}} Directory */
/** @typedef {{kind:'literal',type:string|null,category:'undefined'|'other'}|{kind:'receiverInput',type:null}|{kind:'receiverFrame',type:null,construction:string,newTarget:string|null,parent:number[]|null,site:string,control:number}|{kind:'receiverValue',type:string|null,action:number}} ReceiverValue */
/** @typedef {'normal'|'language'} Completion */
/** @typedef {ReceiverValue|{kind:'parameter',type:string,index:number}|{kind:'global',type:string,id:string}|{kind:'capture',type:string,id:string,layout:string,environment:number[],heap:number,control:number}|{kind:'environmentInput',type:null,layout:string}|{kind:'environmentCreate',type:null,layout:string,parent:number[]|null,site:string,control:number}|{kind:'environmentParent',type:null,layout:string,bases:number[],control:number}|{kind:'environmentComponent',type:null,layout:string,functionId:string,callee:number[],control:number}|{kind:'code',type:string,functionId:string,environment:number[]|null,control:number}|{kind:'local',type:string}|{kind:'nonowning',type:string}|{kind:'unknown',type:null}|{kind:'join',type:string|null,inputs:number[]}|{kind:'gate',type:string|null,inputs:number[],control:number}|{kind:'projection',type:string,bases:number[],selector:string,view:string,heap:number,control:number}|{kind:'copy',type:string,bases:number[],site:string,heap:number,control:number}|{kind:'call',type:string|null,call:number,completion:Completion}} Value */
/** @typedef {{kind:'receiverAction',previous:number,control:number,frames:number[],action:'allocate'|'get'|'bind'|'result',operands:number[],completion:Completion}} ReceiverAction */
/** @typedef {ReceiverAction|{kind:'entry'}|{kind:'join',inputs:number[]}|{kind:'store',previous:number,bases:number[],selector:string,view:string,values:number[],control:number,initialize:boolean}|{kind:'copy',previous:number,value:number}|{kind:'call',call:number,completion:Completion}} Heap */
/** @typedef {{kind:'receiverCompletion',action:number}|{kind:'entry'}|{kind:'join',inputs:number[]}|{kind:'call',call:number,completion:Completion}} Control */
/** @typedef {{functionId:string,arguments:number[][],environment:number[]|null,callee:number[]|null,receiver:number[]|null,heap:number,control:number,site:string}} Call */
/** @typedef {{heap:number,control:number}} State */
/** @typedef {{values:number[],flag:'read'|'write'|'structural',control:number}} Access */
/** @typedef {{format:{family:'tsfg.return-origin-graph-candidate',version:5},nodes:Value[],heaps:Heap[],controls:Control[],calls:Call[],normal:number[],language:number[],exits:{normal:State[],language:State[]},accesses:Access[]}} Graph */

/**
 * directory is an admitted HIR/fixed-signature projection, independent of the
 * current body or physical capacity. parameterTypes is the ordered logical
 * vector INCLUDING public receiver role0. Admitted constructor frames are
 * separate carriers; missing construction metadata or repeated creation stays
 * Open. Recursive fresh activation is also checked by the owning consumer.
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
    if(prototype!==Object.prototype&&prototype!==null)fail('JSON record required');const expected=new Set(keys);let count=0;
    // No Object.keys/Reflect array is allocated before the shared meter can
    // observe a large unexpected record. Generic JSON has enumerable own keys.
    // The prepaid expected-field work builds one set, avoiding a scan per key.
    for(const name in row){spend(Math.ceil(name.length/8)+2);if(!Object.hasOwn(row,name)||!expected.has(name))fail('unexpected field');count++;}
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
  /** @param {unknown} value @returns {string} */
  const ownedLayout=value=>{const id=text(value);spend();if(!directory.environments.has(id))fail('unowned environment layout');return id;};
  /** @param {string} layout @param {string} key */
  const captureSlot=(layout,key)=>{const row=directory.environments.get(layout),slot=row.slots.find(slot=>{spend();return equal(slot.key,key);});if(!slot)fail('unowned capture slot');return slot;};
  /** @param {FunctionRow} fn @returns {string|null} */
  const protocol=fn=>{spend();if(fn.kind==='construction-body'){
    const role=fn.construction;if(!role)return 'construction-metadata-open';const row=directory.constructions.get(role.id);
    if(!row||role.receiverIndex!==0||row.owner!==role.owner||row.base!==role.base||fn.parameterTypes[0]!==role.owner)fail('constructor protocol differs from its owned role');
  }
    if(fn.lexicalEnvironment===undefined||fn.activationEnvironment===undefined)return 'code-environment-metadata-open';
    if(fn.kind!=='source'&&fn.kind!=='method'&&fn.kind!=='construction-body')return 'function-protocol-open';return null;};
  const current=functionRow(directory.functionId),currentProtocol=protocol(current);
  if(currentProtocol!==null)return {status:'open',reason:currentProtocol};
  // The signature comes from the admitted directory, not graph parameter use.
  spend(current.parameterTypes.length+1);for(const type of current.parameterTypes)ownedType(type);ownedType(current.returnType);
  const row=record(raw,['format','nodes','heaps','controls','calls','normal','language','exits','accesses']);
  const format=record(row.format,['family','version']);if(!equal(text(format.family),'tsfg.return-origin-graph-candidate')||format.version!==5)fail('draft5 graph format required');
  const rawNodes=array(row.nodes),rawHeaps=array(row.heaps),rawControls=array(row.controls),rawCalls=array(row.calls),rawAccesses=array(row.accesses);
  const counts={nodes:rawNodes.length,heaps:rawHeaps.length,controls:rawControls.length,calls:rawCalls.length};
  /** @type {Call[]} */
  const calls=[];
  /** @type {FunctionRow[]} */
  const callees=[];
  for(const rawCall of rawCalls){spend();const call=record(rawCall,['functionId','arguments','environment','callee','receiver','heap','control','site']),functionId=text(call.functionId),fn=functionRow(functionId),unsupported=protocol(fn);
    if(unsupported!==null)return {status:'open',reason:unsupported};
    const rawArguments=array(call.arguments);if(rawArguments.length!==fn.parameterTypes.length-(fn.construction?1:0))fail('logical call arity');
    spend(fn.parameterTypes.length+1);for(const type of fn.parameterTypes)ownedType(type);ownedType(fn.returnType);
    const arguments_=[];for(const argument of rawArguments){spend();arguments_.push(refs(argument,counts.nodes));}
    const environment=call.environment===null?null:refs(call.environment,counts.nodes),callee=call.callee===null?null:refs(call.callee,counts.nodes);
    if(callee!==null&&(fn.lexicalEnvironment==null?environment!==null:environment===null))fail('indirect Code environment component differs');
    if(callee===null&&(fn.lexicalEnvironment==null?environment!==null:environment===null))fail('direct environment protocol differs');
    const receiver=call.receiver===null?null:refs(call.receiver,counts.nodes);if(Boolean(fn.construction)!==(receiver!==null))fail('constructor frame component differs');
    calls.push({functionId,arguments:arguments_,environment,callee,receiver,heap:ref(call.heap,counts.heaps),control:ref(call.control,counts.controls),site:text(call.site)});callees.push(fn);
  }
  /** @param {unknown} rawNode @returns {Value} */
  const readNode=rawNode=>{
    // Discriminator alone is observed before selecting the owning exact row.
    spend();if(rawNode===null||typeof rawNode!=='object'||Array.isArray(rawNode))fail('node record');
    const kind=text(/** @type {Record<string,unknown>} */(rawNode).kind);
    if(kind==='parameter'){const value=record(rawNode,['kind','type','index']),index=ref(value.index,current.parameterTypes.length),type=ownedType(value.type);
      if(current.construction&&index===0)fail('receiver role is not an ordinary parameter');
      if(!equal(type,current.parameterTypes[index]))fail('parameter Source view differs');return {kind,type,index};}
    if(kind==='literal'){const value=record(rawNode,['kind','type','category']),category=text(value.category);if(category!=='undefined'&&category!=='other')fail('literal category');return {kind,type:nullableType(value.type),category};}
    if(kind==='receiverInput'){const value=record(rawNode,['kind','type']);if(value.type!==null||!current.construction)fail('frame input outside constructor');return {kind,type:null};}
    if(kind==='receiverFrame'){const value=record(rawNode,['kind','type','construction','newTarget','parent','site','control']),construction=text(value.construction),newTarget=nullableType(value.newTarget),parent=value.parent===null?null:refs(value.parent,counts.nodes);
      if(value.type!==null||!directory.constructions.has(construction)||(newTarget===null)!==(parent!==null))fail('frame role/newTarget');
      return {kind,type:null,construction,newTarget,parent,site:text(value.site),control:ref(value.control,counts.controls)};}
    if(kind==='receiverValue'){const value=record(rawNode,['kind','type','action']);return {kind,type:nullableType(value.type),action:ref(value.action,counts.heaps)};}
    if(kind==='global'){const value=record(rawNode,['kind','type','id']),type=ownedType(value.type),id=text(value.id),directory_ =directory.globals;spend();
      const declared=directory_.get(id);if(declared===undefined||!equal(type,declared))fail('unowned root or differing Source view');return {kind,type,id};}
    if(kind==='capture'){const value=record(rawNode,['kind','type','id','layout','environment','heap','control']),type=ownedType(value.type),id=text(value.id),layout=ownedLayout(value.layout),slot=captureSlot(layout,id);
      if(!equal(type,slot.type))fail('capture Source view differs');return {kind,type,id,layout,environment:refs(value.environment,counts.nodes),heap:ref(value.heap,counts.heaps),control:ref(value.control,counts.controls)};}
    if(kind==='environmentInput'){const value=record(rawNode,['kind','type','layout']),layout=ownedLayout(value.layout);if(value.type!==null||layout!==current.lexicalEnvironment)fail('entry environment protocol differs');return {kind,type:null,layout};}
    if(kind==='environmentCreate'){const value=record(rawNode,['kind','type','layout','parent','site','control']),layout=ownedLayout(value.layout),parent=value.parent===null?null:refs(value.parent,counts.nodes);
      if(value.type!==null||layout!==current.activationEnvironment||(directory.environments.get(layout).parent===null)!==(parent===null))fail('activation environment protocol differs');
      return {kind,type:null,layout,parent,site:text(value.site),control:ref(value.control,counts.controls)};}
    if(kind==='environmentParent'){const value=record(rawNode,['kind','type','layout','bases','control']),layout=ownedLayout(value.layout);if(value.type!==null)fail('environment control carrier has no Source type');return {kind,type:null,layout,bases:refs(value.bases,counts.nodes),control:ref(value.control,counts.controls)};}
    if(kind==='environmentComponent'){const value=record(rawNode,['kind','type','layout','functionId','callee','control']),layout=ownedLayout(value.layout),functionId=text(value.functionId),fn=functionRow(functionId);
      if(value.type!==null||fn.kind!=='source'||fn.lexicalEnvironment!==layout)fail('conditional Code component function/layout differs');
      return {kind,type:null,layout,functionId,callee:refs(value.callee,counts.nodes),control:ref(value.control,counts.controls)};}
    if(kind==='code'){const value=record(rawNode,['kind','type','functionId','environment','control']),type=ownedType(value.type),functionId=text(value.functionId),fn=functionRow(functionId),environment=value.environment===null?null:refs(value.environment,counts.nodes);
      if(fn.kind!=='source'||directory.types.get(type).kind!=='function')fail('ordinary Code function/view required');if((fn.lexicalEnvironment==null)!==(environment===null))fail('Code environment protocol differs');
      return {kind,type,functionId,environment,control:ref(value.control,counts.controls)};}
    if(kind==='local'||kind==='nonowning'){const value=record(rawNode,['kind','type']),type=ownedType(value.type);
      if(kind==='local'){spend();const shape=/** @type {TypeRow} */(directory.types.get(type));if(shape.kind==='unknown'||shape.kind==='union'||shape.kind==='void')fail('local requires an actual tag');}
      return {kind,type};}
    if(kind==='unknown'){const value=record(rawNode,['kind','type']);if(value.type!==null)fail('unknown type must be null');return {kind,type:null};}
    if(kind==='join'){const value=record(rawNode,['kind','type','inputs']);return {kind,type:nullableType(value.type),inputs:refs(value.inputs,counts.nodes)};}
    if(kind==='gate'){const value=record(rawNode,['kind','type','inputs','control']);return {kind,type:nullableType(value.type),inputs:refs(value.inputs,counts.nodes),control:ref(value.control,counts.controls)};}
    if(kind==='projection'){const value=record(rawNode,['kind','type','bases','selector','view','heap','control']);return {kind,type:ownedType(value.type),bases:refs(value.bases,counts.nodes),selector:selector(value.selector),view:ownedType(value.view),heap:ref(value.heap,counts.heaps),control:ref(value.control,counts.controls)};}
    if(kind==='copy'){const value=record(rawNode,['kind','type','bases','site','heap','control']);return {kind,type:ownedType(value.type),bases:refs(value.bases,counts.nodes),site:text(value.site),heap:ref(value.heap,counts.heaps),control:ref(value.control,counts.controls)};}
    if(kind==='call'){const value=record(rawNode,['kind','type','call','completion']),call=ref(value.call,counts.calls),channel=completion(value.completion),type=nullableType(value.type);
      if(channel==='language'?type!==null:type===null||!equal(type,callees[call].construction?.owner??callees[call].returnType))fail('call result Source view differs');return {kind,type,call,completion:channel};}
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
      const rawSelector=text(value.selector),rawView=text(value.view);let selected,view;
      if(rawSelector.startsWith('capture:')){if(!rawView.startsWith('env:'))fail('capture store view');view='env:'+ownedLayout(rawView.slice(4));captureSlot(rawView.slice(4),rawSelector.slice(8));selected=rawSelector;}
      else{selected=selector(rawSelector);view=ownedType(rawView);}
      heaps.push({kind,previous:ref(value.previous,counts.heaps),bases:refs(value.bases,counts.nodes),selector:selected,view,values:refs(value.values,counts.nodes),control:ref(value.control,counts.controls),initialize:value.initialize});}
    else if(kind==='copy'){const value=record(rawHeap,['kind','previous','value']),id=ref(value.value,counts.nodes);if(nodes[id].kind!=='copy')fail('clone heap requires copy node');heaps.push({kind,previous:ref(value.previous,counts.heaps),value:id});}
    else if(kind==='call'){const value=record(rawHeap,['kind','call','completion']);heaps.push({kind,call:ref(value.call,counts.calls),completion:completion(value.completion)});}
    else if(kind==='receiverAction'){const value=record(rawHeap,['kind','previous','control','frames','action','operands','completion']),action=text(value.action);
      if(action!=='allocate'&&action!=='get'&&action!=='bind'&&action!=='result')fail('receiver action');
      const operands=refs(value.operands,counts.nodes);if((action==='allocate'||action==='get')&&operands.length||action==='bind'&&operands.length===0)fail('receiver operands');
      heaps.push({kind,previous:ref(value.previous,counts.heaps),control:ref(value.control,counts.controls),frames:refs(value.frames,counts.nodes),action,operands,completion:completion(value.completion)});}
    else fail('unsupported ordinary heap kind');
  }
  /** @type {Control[]} */
  const controls=[];
  for(const rawControl of rawControls){spend();if(rawControl===null||typeof rawControl!=='object'||Array.isArray(rawControl))fail('control record');const kind=text(/** @type {Record<string,unknown>} */(rawControl).kind);
    if(kind==='entry'){record(rawControl,['kind']);controls.push({kind});}
    else if(kind==='join'){const value=record(rawControl,['kind','inputs']);controls.push({kind,inputs:refs(value.inputs,counts.controls)});}
    else if(kind==='call'){const value=record(rawControl,['kind','call','completion']);controls.push({kind,call:ref(value.call,counts.calls),completion:completion(value.completion)});}
    else if(kind==='receiverCompletion'){const value=record(rawControl,['kind','action']),action=ref(value.action,counts.heaps);if(heaps[action].kind!=='receiverAction')fail('receiver completion action');controls.push({kind,action});}
    else fail('unsupported ordinary control kind');
  }
  /** @param {number[]} values */
  const carriers=values=>{
    spend(values.length);const pending=[...values],seen=new Set(),layouts=new Set(),frames=new Set();let ordinary=false;
    while(pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);const node=nodes[id];
      if(node.kind==='join'||node.kind==='gate'){spend(node.inputs.length);for(const input of node.inputs)pending.push(input);}
      else if(node.kind==='environmentInput'||node.kind==='environmentCreate'||node.kind==='environmentParent'||node.kind==='environmentComponent')layouts.add(node.layout);
      else if(node.kind==='receiverInput')frames.add(current.construction.id);
      else if(node.kind==='receiverFrame')frames.add(node.construction);
      else ordinary=true;
    }return {layouts,frames,ordinary};
  };
  /** @param {number[]} values @param {string} layout */
  const environmentRefs=(values,layout)=>{const selected=carriers(values);if(selected.ordinary||selected.frames.size)fail('data/frame payload used as an environment');for(const id of selected.layouts){spend();if(!equal(id,layout))fail('environment layout identity differs');}};
  /** @param {number[]} values */
  const ordinaryRefs=values=>{const selected=carriers(values);if(selected.layouts.size||selected.frames.size)fail('control carrier used as an ordinary value');};
  const frameRefs=values=>{const selected=carriers(values);if(selected.layouts.size||selected.ordinary)fail('data/environment used as a frame');return selected.frames;};
  for(const node of nodes){spend();
    if(node.kind==='environmentCreate'&&node.parent!==null)environmentRefs(node.parent,directory.environments.get(node.layout).parent);
    else if(node.kind==='environmentParent'){
      const selected=carriers(node.bases);if(selected.ordinary)fail('ordinary parent environment');
      for(const layout of selected.layouts){spend();if(directory.environments.get(layout).parent!==node.layout)fail('actual parent layout identity differs');}
    }else if(node.kind==='capture')environmentRefs(node.environment,node.layout);
    else if(node.kind==='environmentComponent')ordinaryRefs(node.callee);
    else if(node.kind==='code'&&node.environment!==null)environmentRefs(node.environment,functionRow(node.functionId).lexicalEnvironment);
    else if(node.kind==='projection'||node.kind==='copy')ordinaryRefs(node.bases);
    else if(node.kind==='receiverFrame'&&node.parent!==null)frameRefs(node.parent);
    else if(node.kind==='receiverValue'){const action=heaps[node.action];if(action.kind!=='receiverAction'||action.completion==='language'&&node.type!==null||action.completion==='normal'&&node.type===null)fail('receiver result completion/view');
      for(const frame of frameRefs(action.frames)){spend();if(action.completion==='normal'&&directory.constructions.get(frame).owner!==node.type)fail('receiver result owner view');}}
  }
  for(const heap of heaps){spend();if(heap.kind==='store'){
    if(heap.selector.startsWith('capture:'))environmentRefs(heap.bases,heap.view.slice(4));else ordinaryRefs(heap.bases);ordinaryRefs(heap.values);
  }else if(heap.kind==='receiverAction'){frameRefs(heap.frames);ordinaryRefs(heap.operands);}}
  for(const [index,call]of calls.entries()){spend();for(const argument of call.arguments)ordinaryRefs(argument);
    if(call.receiver!==null)for(const construction of frameRefs(call.receiver)){spend();if(construction!==callees[index].construction.id)fail('call frame construction role');}
    if(call.callee!==null){ordinaryRefs(call.callee);if(call.environment!==null){
      environmentRefs(call.environment,callees[index].lexicalEnvironment);spend(call.environment.length);const pending=[...call.environment],seen=new Set();
      while(pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);const node=nodes[id];
        if(node.kind==='join'||node.kind==='gate'){spend(node.inputs.length);for(const input of node.inputs)pending.push(input);continue;}
        if(node.kind!=='environmentComponent'||node.functionId!==call.functionId||node.callee.length!==call.callee.length||!node.callee.every((id,index)=>{spend();return id===call.callee[index];}))fail('call environment is not bound to this exact Code selection');
      }
    }}else if(call.environment!==null)environmentRefs(call.environment,callees[index].lexicalEnvironment);
  }
  /** @param {unknown} rawStates @returns {State[]} */
  const states=rawStates=>{const result=[];let heap=-1,control=-1;
    for(const rawState of array(rawStates)){spend();const state=record(rawState,['heap','control']),nextHeap=ref(state.heap,counts.heaps),nextControl=ref(state.control,counts.controls);
      if(nextHeap<heap||nextHeap===heap&&nextControl<=control)fail('states must be sorted unique');heap=nextHeap;control=nextControl;result.push({heap,control});}return result;};
  const exits=record(row.exits,['normal','language']),normal=refs(row.normal,counts.nodes),language=refs(row.language,counts.nodes),normalExits=states(exits.normal),languageExits=states(exits.language);
  ordinaryRefs(normal);ordinaryRefs(language);
  /** @type {Access[]} */
  const accesses=[];let previous='';
  for(const rawAccess of rawAccesses){spend();const value=record(rawAccess,['values','flag','control']),flag=text(value.flag);if(flag!=='read'&&flag!=='write'&&flag!=='structural')fail('access flag');
    const values=refs(value.values,counts.nodes),control=ref(value.control,counts.controls);
    ordinaryRefs(values);
    // This exact ordinary row's canonical key is control,flag,values. Charge
    // before JSON allocation/comparison; no ref-list sort or host varargs.
    spend(values.length*3+32);const order=JSON.stringify({control,flag,values});spend(Math.ceil((previous.length+order.length)/8)+1);
    if(previous!==''&&previous>=order)fail('accesses must be canonical sorted unique');previous=order;accesses.push({values,flag,control});
  }
  /** @type {Graph} */
  const graph={format:{family:'tsfg.return-origin-graph-candidate',version:5},nodes,heaps,controls,calls,normal,language,exits:{normal:normalExits,language:languageExits},accesses};
  if(!commonReceiverActivations(graph,spend))return {status:'open',reason:'repeated-receiver-frame-activation'};
  return {status:'typed',graph};
}
