// SPDX-License-Identifier: MIT
// Code-target flow and fixed transfers are independent runs. Environment
// instances are deliberately absent here: code membership is no GC authority.
import {callableTargetDomain,fixedCallableTransfer} from './callable-target-domain.mjs';
import {commonMethods} from './common-program-methods.mjs';
import {signatureId} from './module-callable-common.mjs';
import {commonCheck as check,commonFailure,commonSame as same,commonRecord as record} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
export function commonCallableType(id,types,spend) {
  const type=types.get(id);if(type?.kind==='function')return type;
  if(type?.kind!=='union'||type.members.length<2||type.members.length>3)return null;
  let payload=null;
  for(const id of type.members){spend();const member=types.get(id);if(['null','undefined'].includes(member?.kind))continue;
    if(member?.kind!=='function'||payload)return null;payload=member;}
  return payload;
}
export function commonTargets(hir,spend,records=null) {
  const collections=commonCollections(spend);spend(hir.functions.length+hir.types.length);
  const functions=new Map(hir.functions.map(fn=>[fn.id,fn])),types=new Map(hir.types.map(t=>[t.id,t]));
  const methods=commonMethods(hir,spend);
  const domain=callableTargetDomain(functions,spend,message=>commonFailure('callable',message),(a,b)=>a<b?-1:a>b?1:0);
  const callable=id=>commonCallableType(id,types,spend)!==null,summaries=new Map(),sites=new Map(),observations=new Map();let changed=false;
  const mayCallable=(id,seen=new Set())=>{spend();if(seen.has(id))return false;seen.add(id);const type=types.get(id);
    return type?.kind==='function'||type?.kind==='union'&&type.members.some(member=>mayCallable(member,seen));};
  const merge=(map,key,value)=>{const before=map.get(key)??domain.bottom(),next=domain.join(before,value);if(!map.has(key)||!domain.equal(before,next)){map.set(key,next);changed=true;}};
  // A slot upper covers every verified writer and every instance, independently
  // of the selected receiver. Verified structural field pairs only widen this
  // storage graph; equal callable signatures never create an edge.
  const fields=new Map(),rawFields=new Map(),parents=new Map(),fieldValues=new Map(),fieldCaptures=new Map(),exposed=new Set(),exposedFields=new Set(),callableSlots=new Set(),bindingTypes=new Map(),arrayFieldAliases=[];
  for(const fn of functions.values())for(const group of [fn.parameters,fn.bindings??[]])for(const binding of group){spend();bindingTypes.set(binding.id,binding.type);}
  // A captured incoming callable shares the original parameter's code upper.
  // It is not a child parameter, a new local, or an environment-instance proof.
  const parameterOwners=new Map(),capturedParameters=new Map(),localBindings=new Set(),capturedLocals=new Map();
  for(const fn of functions.values()){spend();for(const [index,binding]of fn.parameters.entries()){spend();if(callable(binding.type))parameterOwners.set(binding.id,{owner:fn.id,index});}}
  for(const fn of functions.values())for(const binding of fn.bindings??[]){spend();if(callable(binding.type))localBindings.add(binding.id);}
  for(const fn of functions.values()){spend();for(const capture of fn.captures??[]){spend();const parameter=parameterOwners.get(capture.binding);if(parameter)capturedParameters.set(capture.binding,parameter);
      else if(localBindings.has(capture.binding))capturedLocals.set(capture.binding,domain.bottom());}}
  for(const global of hir.globals??[]){spend();bindingTypes.set(global.sourceBinding,global.type);}
  for(const type of types.values())for(const field of type.fields??[]){spend();fields.set(field.id,field);rawFields.set(field.sourceBinding,field.id);parents.set(field.id,field.id);}
  const slot=id=>{spend();const parent=parents.get(id);check(parent,'callable');return parent===id?id:slot(parent);};
  for(const row of hir.snapshot.payload.compatibilityWitnesses)for(const pair of row.compatibility.members){spend();const from=rawFields.get(pair.source),to=rawFields.get(pair.target);
    if(from&&to){const a=slot(from),b=slot(to);if(a!==b)parents.set(a,b);arrayFieldAliases.push([fields.get(from).type,fields.get(to).type]);}}
  for(const field of fields.values()){spend();if(callable(field.type))callableSlots.add(slot(field.id));}
  const write=(id,value)=>{const key=slot(id);if(callableSlots.has(key))merge(fieldValues,key,value??domain.top());
    const captured=value??(mayCallable(fields.get(id).type)?domain.top():null);if(captured){merge(fieldCaptures,key,captured);if(exposedFields.has(key))exposeClosures(captured);}};
  // Array families are storage aliases, not signature or instance equality.
  // May-code and the minimum initialized literal prefix are separate facts.
  // Capture writers also include nullable callable storage. Boundary/missing
  // TOP values are not writes and cannot expose unrelated closure captures.
  const arrayParents=new Map(),arrayMinimum=new Map(),arrayUnsafe=new Set(),exposedArrays=new Set(),elementValues=new Map(),elementCaptures=new Map();
  for(const type of types.values()){spend();if(['array','readSpan'].includes(type.kind))arrayParents.set(type.id,type.id);}
  const arrayRoot=id=>{spend();const parent=arrayParents.get(id);check(parent,'callable');return parent===id?id:arrayRoot(parent);};
  function arrays(id,seen=new Set()){
    spend();if(seen.has(id))return [];seen.add(id);const type=types.get(id);
    if(arrayParents.has(id))return [id];const result=[];
    if(type?.kind==='union')for(const member of type.members){spend();const children=arrays(member,seen);spend(children.length);result.push(...children);}return result;
  }
  const linkArrays=(from,to)=>{
    const left=arrays(from),right=arrays(to);for(const a of left)for(const b of right){spend();const x=arrayRoot(a),y=arrayRoot(b);if(x===y)continue;
      const exposedX=exposedArrays.has(x),exposedY=exposedArrays.has(y),valueX=elementValues.get(x),capturesX=elementCaptures.get(x),capturesY=elementCaptures.get(y);
      arrayParents.set(x,y);arrayMinimum.set(y,Math.min(arrayMinimum.get(x)??Infinity,arrayMinimum.get(y)??Infinity));
      if(arrayUnsafe.has(x))arrayUnsafe.add(y);
      if(exposedX||exposedY){exposedArrays.add(y);if(!exposedX)exposeClosures(capturesX);if(!exposedY)exposeClosures(capturesY);}
      if(valueX)merge(elementValues,y,valueX);if(capturesX)merge(elementCaptures,y,capturesX);changed=true;}
  };
  const arrayWrite=(id,value)=>{for(const type of arrays(id)){spend();const key=arrayRoot(type),elementType=types.get(type).elementType;
      if(callable(elementType))merge(elementValues,key,value??domain.top());
      const captured=value??(mayCallable(elementType)?domain.top():null);if(captured){merge(elementCaptures,key,captured);if(exposedArrays.has(key))exposeClosures(captured);}}};
  const cancelArray=id=>{for(const type of arrays(id)){spend();arrayUnsafe.add(arrayRoot(type));}};
  const arrayRead=id=>{let result=domain.bottom();const owners=arrays(id);if(!owners.length)return domain.top();
    for(const type of owners){spend();result=domain.join(result,elementValues.get(arrayRoot(type))??domain.bottom());}return result;};
  for(const [from,to]of arrayFieldAliases){spend();linkArrays(from,to);}
  const visible=id=>{const result=[],seen=new Set();let type=types.get(id);while(type){spend();check(!seen.has(type.id),'callable');seen.add(type.id);spend(type.fields?.length??0);result.push(...type.fields??[]);type=types.get(type.base);}return result;};
  function expose(id){
    spend();if(exposed.has(id))return;exposed.add(id);const type=types.get(id);if(!type)return;
    if(type.kind==='union')for(const member of type.members){spend();expose(member);}
    if(['array','readSpan'].includes(type.kind)){
      cancelArray(id);for(const member of arrays(id)){spend();const key=arrayRoot(member);
        if(!exposedArrays.has(key)){exposedArrays.add(key);exposeClosures(elementCaptures.get(key));}
        // This TOP is boundary poisoning, not a newly observed closure writer.
        merge(elementValues,key,domain.top());}expose(type.elementType);
    }
    if(type.kind==='function'){for(const parameter of type.parameters){spend();expose(parameter);}expose(type.returnType);}
    if(['reference','value'].includes(type.kind)){
      for(const field of visible(id)){spend();if(mayCallable(field.type)){const key=slot(field.id);
          if(!exposedFields.has(key)){exposedFields.add(key);exposeClosures(fieldCaptures.get(key)??domain.top());}
          if(callableSlots.has(key))merge(fieldValues,key,domain.top());}expose(field.type);}
      // External objects may have any nominal descendant. Explicit field
      // aliases already share the poisoned slot, including nested field types.
      for(const candidate of types.values()){spend();if(candidate.base===id)expose(candidate.id);}
    }
  }
  // Erasing a reference into unknown loses the verified alias path. Poison its
  // storage at that boundary, before later unknown references hide its type.
  const erase=(expected,actual,targets=null)=>{if(types.get(expected)?.kind==='unknown'){expose(actual);exposeClosures(targets);}
    else if(arrays(expected).length&&arrays(actual).length){if(verifiedView(actual,expected,[]))linkArrays(actual,expected);else{expose(actual);expose(expected);}}};
  const verifiedView=(from,to,roots,seen=new Set())=>{
    spend();if(from===to)return true;const key=from+'\0'+to;if(seen.has(key))return false;
    const source=types.get(from),target=types.get(to);if(!source||!target)return false;
    seen.add(key);let accepted;
    if(source.kind==='union')accepted=source.members.every(id=>{spend();return ['null','undefined'].includes(types.get(id)?.kind)||verifiedView(id,to,roots,seen);});
    else if(target.kind==='union')accepted=target.members.some(id=>{spend();return verifiedView(from,id,roots,seen);});
    else if(['array','readSpan'].includes(source.kind)&&['array','readSpan'].includes(target.kind))accepted=verifiedView(source.elementType,target.elementType,roots,seen);
    else accepted=roots.some(row=>{spend();return row.sourceType===from&&row.targetType===to;});seen.delete(key);return accepted;
  };
  function exposeClosures(targets){const pending=[],seen=new Set();const add=id=>{spend();if(!seen.has(id)){seen.add(id);pending.push(id);}};
    if(targets?.top)for(const id of functions.keys())add(id);else for(const id of targets?.ids??[])add(id);
    while(pending.length){spend();const fn=functions.get(pending.pop());for(const capture of fn?.captures??[]){spend();const type=bindingTypes.get(capture.binding);expose(type);
        if(callable(type))for(const id of functions.keys())add(id);}}
  }
  const unknownCall=(value,args,called=domain.bottom())=>{exposeClosures(called);for(const [index,arg]of (value.arguments??[]).entries()){spend();expose(arg.type);exposeClosures(args[index]);}
    if(value.receiver)expose(value.receiver.type);expose(value.type);};
  const reach=id=>{const row=summaries.get(id);check(row,'callable');if(!row.reached){row.reached=true;changed=true;}return row;};
  const observe=(id,index,value)=>merge(observations,id+'/'+index,value);
  for(const fn of hir.functions){spend();const parameters=new Map();for(const [index,p]of fn.parameters.entries()){spend();if(callable(p.type))parameters.set(index,records?domain.from(records.get(fn.id).callables.parameters.find(row=>row.index===index).allowed):domain.bottom());}
    summaries.set(fn.id,{fn,reached:true,parameters,returns:callable(fn.returnType)?domain.bottom():null});}
  const siteKey=(fn,range)=>fn+'/'+range.start+':'+range.end;
  function expression(summary,state,value) {
    spend();if(value.kind==='functionReference')return domain.single(value.functionId);
    if(['nullLiteral','undefinedLiteral'].includes(value.kind))return domain.bottom();
    if(value.kind==='bindingReference'){
      if(!callable(value.type))return null;const captured=capturedParameters.get(value.binding);
      return domain.copy(captured?summaries.get(captured.owner).parameters.get(captured.index):capturedLocals.get(value.binding)??state.get(value.binding)??domain.bottom());
    }
    if(['parentheses','as','nonNull'].includes(value.kind)){const actual=expression(summary,state,value.expression);if(value.kind==='as'){erase(value.type,value.expression.type,actual);if(!verifiedView(value.expression.type,value.type,value.compatibilityRoots??[])){expose(value.expression.type);expose(value.type);exposeClosures(actual);}else linkArrays(value.expression.type,value.type);}return actual??(callable(value.type)?domain.top():null);}
    if(value.kind==='bindingAssignment') {const result=expression(summary,state,value.value);erase(value.target.type??bindingTypes.get(value.target.binding),value.value.type,result);
      if(value.target.kind==='globalTarget'){expose(value.value.type);exposeClosures(result);}else if(result){state.set(value.target.binding,domain.copy(result));const captured=capturedParameters.get(value.target.binding);
        if(captured){if(records)observe(captured.owner,captured.index,result);else merge(summaries.get(captured.owner).parameters,captured.index,result);}
        else if(capturedLocals.has(value.target.binding))merge(capturedLocals,value.target.binding,result);}
      return result;}
    if(value.kind==='fieldAccess'){expression(summary,state,value.receiver);return callable(value.type)?domain.copy(fieldValues.get(slot(value.property))??domain.bottom()):null;}
    if(value.kind==='fieldAssignment'){
      let target=value.target;while(target.kind==='parentheses'){spend();target=target.expression;}
      expression(summary,state,target.receiver);const result=expression(summary,state,value.value);erase(target.type,value.value.type,result);write(target.property,result);return result??(callable(value.type)?domain.top():null);
    }
    if(value.kind==='arrayLiteral'){for(const child of value.elements){spend();const result=expression(summary,state,child);erase(types.get(value.type)?.elementType,child.type,result);arrayWrite(value.type,result);}return null;}
    if(value.kind==='elementAssignment'){
      let target=value.target;while(target.kind==='parentheses'){spend();target=target.expression;}
      expression(summary,state,target.receiver);expression(summary,state,target.index);const result=expression(summary,state,value.value);erase(target.type,value.value.type,result);arrayWrite(target.receiver.type,result);return result??(callable(value.type)?domain.top():null);
    }
    if(value.kind==='checkedElementAccess'){expression(summary,state,value.receiver);expression(summary,state,value.index);if(!callable(value.type))expose(value.type);return callable(value.type)?domain.copy(arrayRead(value.receiver.type)):null;}
    if(value.kind==='globalReference')expose(value.type);
    if(value.kind==='call'||value.kind==='indirectCall'){
      let saved=value.kind==='indirectCall'?domain.copy(expression(summary,state,value.expression)??domain.top()):value.callee==='intrinsic:readSpan'?null:domain.single(value.callee);
      if(value.receiver){expression(summary,state,value.receiver);if(functions.get(value.callee)?.kind==='method'){saved=domain.bottom();for(const row of methods.dispatch(value.callee,value.receiver.type)){spend();saved=domain.join(saved,domain.single(row.target));}}}
      spend(value.arguments.length);const args=value.arguments.map(arg=>expression(summary,state,arg));if(!saved)return null;
      if(value.kind==='indirectCall'&&summary)merge(sites,siteKey(summary.fn.id,value.range),saved);
      let result=callable(value.type)?domain.bottom():null;
      for(const id of saved.ids){spend();const callee=reach(id);check(value.kind!=='indirectCall'||callee.fn.signatureHash===signatureId({parameters:value.signature.parameters,returns:value.signature.returnType}),'callable-signature');
        for(const [index,p]of callee.fn.parameters.entries()){spend();erase(p.type,value.arguments[index]?.type,args[index]);}
        if(records){const returned=fixedCallableTransfer(records.get(id).callables,args,domain,(index,targets)=>observe(id,index,targets),spend,message=>commonFailure('callable',message));if(result)result=domain.join(result,returned);if(records.get(id).upper?.facets.unknownHost)unknownCall(value,args,domain.single(id));}
        else {for(const [index,p]of callee.fn.parameters.entries()){spend();if(callable(p.type)){check(args[index],'callable');merge(callee.parameters,index,args[index]);}}if(result)result=domain.join(result,callee.returns);}
      }
      if(saved.top){unknownCall(value,args,saved);if(result)result=domain.top();}return result;
    }
    for(const key of ['expression','left','right','receiver','index','value','target'])if(value[key])expression(summary,state,value[key]);
    for(const child of value.elements??[]){expression(summary,state,child);erase(types.get(value.type)?.elementType,child.type);}
    if(value.kind==='new'||value.kind==='superConstruct'){spend(value.arguments.length);const args=value.arguments.map(arg=>expression(summary,state,arg));let owner=types.get(value.kind==='new'?value.type:value.callee);
      for(const [index,p]of (owner.construction?.parameters??[]).entries()){spend();erase(p.type,value.arguments[index]?.type,args[index]);}
      const initialize=type=>{spend();if(type.base&&!type.construction?.functionId)initialize(types.get(type.base));for(const id of type.construction?.initializationFields??[]){spend();const field=fields.get(id);check(field,'callable');let initial;
        if(field.parameterBinding){const index=type.construction.parameters.findIndex(p=>{spend();return p.symbol===field.parameterBinding;});check(index>=0,'callable');
          const fn=type.construction.functionId;initial=fn?summaries.get(fn).parameters.get(index):args[index];}
        else if(field.initializer){initial=expression(summary,state,field.initializer);erase(field.type,field.initializer.type,initial);}write(id,initial);}};
      initialize(owner);
      while(owner&&!owner.construction?.functionId){spend();owner=types.get(owner.base);}if(owner?.construction?.functionId){const callee=reach(owner.construction.functionId);
        if(records){fixedCallableTransfer(records.get(callee.fn.id).callables,args,domain,(index,targets)=>observe(callee.fn.id,index,targets),spend,message=>commonFailure('callable',message));
          if(records.get(callee.fn.id).upper?.facets.unknownHost){unknownCall(value,args);if(value.kind==='superConstruct'){check(summary,'callable');expose(summary.fn.ownerType);}}}
        else for(const [index,p]of callee.fn.parameters.entries()){spend();if(callable(p.type)){check(args[index],'callable');merge(callee.parameters,index,args[index]);}}}}
    else for(const arg of value.arguments??[])expression(summary,state,arg);return callable(value.type)?domain.top():null;
  }
  const clone=state=>collections.map(state,domain.copy);
  const stateKey=state=>{spend(state.size);return [...state].map(([id,value])=>[id,domain.wire(value)]);};
  const join=(into,from)=>{for(const [id,value]of from){spend();into.set(id,domain.join(into.get(id)??domain.bottom(),value));}return into;};
  const externalFunctions=new Set(),globalIds=new Set();for(const global of hir.globals??[]){spend();globalIds.add(global.id);}
  function body(summary,state,rows){let live=true;for(const row of rows){spend();if(!live)break;
    if(['constDeclaration','letDeclaration','initialize'].includes(row.kind)){const value=expression(summary,state,row.initializer);erase(bindingTypes.get(row.binding),row.initializer.type,value);if(globalIds.has(row.binding)){expose(row.initializer.type);exposeClosures(value);}else if(value){state.set(row.binding,domain.copy(value));if(capturedLocals.has(row.binding))merge(capturedLocals,row.binding,value);}}
    else if(['expression','throw','return'].includes(row.kind)){const value=row.value?expression(summary,state,row.value):null;if(row.kind==='throw'&&row.value){expose(row.value.type);exposeClosures(value);}if(row.kind==='return'){if(row.value)erase(summary.fn.returnType,row.value.type,value);if(externalFunctions.has(summary.fn.id))exposeClosures(value);if(summary.returns){check(value,'callable');const next=domain.join(summary.returns,value);if(!domain.equal(next,summary.returns)){summary.returns=next;changed=true;}}}if(row.kind!=='expression')live=false;}
    else if(row.kind==='block')live=body(summary,state,row.body);
    else if(row.kind==='if'){expression(summary,state,row.condition);const yes=clone(state),no=clone(state),a=body(summary,yes,row.then),b=body(summary,no,row.else);state.clear();if(a)join(state,yes);if(b)join(state,no);live=a||b;}
    else if(row.kind==='while'){let previous;do{spend();previous=stateKey(state);expression(summary,state,row.condition);const next=clone(state);body(summary,next,row.body);join(state,next);}while(!same(previous,stateKey(state)));}
    else if(row.kind==='try'){const attempted=clone(state);body(summary,attempted,row.tryBlock.body);join(state,attempted);if(row.catchClause){const caught=clone(state);body(summary,caught,row.catchClause.block.body);join(state,caught);}if(row.finallyBlock)live=body(summary,state,row.finallyBlock.body);}
    else check(row.kind==='functionDeclaration','callable');
  }return live;}
  // Scan every verified birth, including untaken branches and class defaults.
  // Parameters/globals and unsupported Array origins have no closed birth set
  // in this type-family abstraction; they conservatively poison the family.
  const defaultLiterals=[];
  function scan(value,defaults=false){
    if(!value||typeof value!=='object')return;spend();if(Array.isArray(value)){spend(value.length);for(const child of value)scan(child,defaults);return;}
    const type=types.get(value.type);
    if(value.kind==='arrayLiteral'){
      if(type?.kind!=='array'||!Array.isArray(value.elements))expose(value.type);
      else {const id=arrayRoot(type.id);arrayMinimum.set(id,Math.min(arrayMinimum.get(id)??Infinity,value.elements.length));if(defaults)defaultLiterals.push(value);}
    }else if(value.kind==='as'){
      if(verifiedView(value.expression.type,value.type,value.compatibilityRoots??[]))linkArrays(value.expression.type,value.type);
      else {expose(value.expression.type);expose(value.type);}erase(value.type,value.expression.type);
    }else if(value.kind==='call'&&value.callee==='intrinsic:readSpan')linkArrays(value.arguments[0].type,value.type);
    else if(type&&['array','readSpan'].includes(type.kind)&&!['bindingReference','parentheses','nonNull','bindingAssignment','fieldAssignment','elementAssignment'].includes(value.kind))expose(value.type);
    if(value.kind==='lengthAssignment')cancelArray(value.target.receiver.type);
    for(const key in value){spend();if(Object.hasOwn(value,key)&&!['range','signature','sourceSignature','compatibilityRoots'].includes(key))scan(value[key],defaults);}
  }
  function unknownArrayOrigin(id,seen=new Set()){
    spend();if(seen.has(id))return;seen.add(id);const type=types.get(id);if(!type)return;
    if(arrayParents.has(id))expose(id);
    else if(type.kind==='union')for(const member of type.members){spend();unknownArrayOrigin(member,seen);}
    else if(['reference','value'].includes(type.kind))for(const field of visible(id)){spend();unknownArrayOrigin(field.type,seen);}
  }
  for(const type of types.values()){spend();if(type.kind==='union')for(const member of type.members){spend();linkArrays(type.id,member);}
    for(const field of type.fields??[]){spend();if(field.initializer)scan(field.initializer,true);}}
  for(const fn of functions.values()){spend();for(const parameter of fn.parameters){spend();unknownArrayOrigin(parameter.type);}scan(fn.body);}
  for(const global of hir.globals??[]){spend();unknownArrayOrigin(global.type);}
  for(const module of hir.modules??[]){spend();scan(module.initialization);}
  for(const root of hir.closure.roots)if(root.kind!=='module-initialization'){externalFunctions.add(root.target);const row=reach(root.target);expose(row.fn.returnType);for(const [index,p]of row.fn.parameters.entries()){spend();expose(p.type);if(callable(p.type)){if(records)observe(row.fn.id,index,domain.top());else merge(row.parameters,index,domain.top());}}}
  for(const module of hir.modules??[])for(const exported of module.exports??[]){spend();const global=hir.globals?.find(row=>{spend();return row.id===exported.target;});if(global)expose(global.type);}
  let missing;do{
    do{changed=false;
      if(defaultLiterals.length){const state=new Map();spend(bindingTypes.size);for(const [id,type]of bindingTypes)if(callable(type))state.set(id,domain.top());
        // These are storage writer observations, not invented callsite arms.
        for(const literal of defaultLiterals){spend();expression(null,state,literal);}}
      for(const module of hir.modules??[]){spend();body({fn:{id:module.initializer}},new Map(),module.initialization??[]);}
      for(const summary of summaries.values())if(summary.reached){spend();const state=new Map();for(const [i,value]of summary.parameters)state.set(summary.fn.parameters[i].id,domain.copy(value));body(summary,state,summary.fn.body);}}while(changed);
    missing=false;for(const field of fields.values())if(callable(field.type)){spend();const id=slot(field.id),value=fieldValues.get(id);if(!value||!value.top&&!value.ids.size){merge(fieldValues,id,domain.top());missing=true;}}
    for(const type of types.values())if(arrayParents.has(type.id)&&callable(type.elementType)){spend();const id=arrayRoot(type.id),value=elementValues.get(id);if(!value||!value.top&&!value.ids.size){merge(elementValues,id,domain.top());missing=true;}}
  }while(missing);
  const contracts=new Map();for(const summary of summaries.values()){spend();const parameters=[];for(const [index,value]of summary.parameters)parameters.push({index,allowed:domain.wire(value)});
    contracts.set(summary.fn.id,{parameters,returns:summary.returns?domain.wire(summary.returns):null,slotWrites:[]});}
  if(records){for(const [key,value]of observations){spend();const at=key.lastIndexOf('/'),record=records.get(key.slice(0,at)).callables.parameters.find(row=>row.index===Number(key.slice(at+1))),upper=domain.from(record.allowed);
      check(upper.top||!value.top&&[...value.ids].every(id=>{spend();return upper.ids.has(id);}),'callable-contract','argument exceeds fixed callable upper');}
    for(const summary of summaries.values())if(summary.returns){const upper=domain.from(records.get(summary.fn.id).callables.returns);check(upper.top||!summary.returns.top&&[...summary.returns.ids].every(id=>{spend();return upper.ids.has(id);}),'callable-contract','return exceeds fixed callable upper');}}
  return {contracts,sites,domain,callable,summaries,siteKey,signature:signature=>signatureId({parameters:signature.parameters,returns:signature.returnType}),
    arrayElementInitialized(typeId,index){spend();if(types.get(typeId)?.kind!=='array'||!Number.isSafeInteger(index)||index<0)return false;
      const id=arrayRoot(typeId),minimum=arrayMinimum.get(id);return !arrayUnsafe.has(id)&&Number.isFinite(minimum)&&index<minimum;},
    site(fn,range){return domain.wire(sites.get(siteKey(fn,range))??domain.top());}};
}

// Fixed rows are an external boundary; a well-shaped function type is not a
// grant to every function with that signature. Only explicitly listed IDs pass.
export function validateCommonCallableBounds(hir,fn,value,spend){
  record(value,['parameters','returns','slotWrites']);spend(hir.functions.length+hir.types.length);const functions=new Map(hir.functions.map(f=>[f.id,f])),types=new Map(hir.types.map(t=>[t.id,t]));
  const bound=(targets,type)=>{record(targets,['top','functions']);check(typeof targets.top==='boolean'&&Array.isArray(targets.functions)&&targets.functions.length<=256,'callable-contract');spend(targets.functions.length);let previous;
    for(const id of targets.functions){const target=functions.get(id);check(target&&!target.ownerType&&(!previous||previous<id)&&same(target.parameters.map(p=>p.type),type.parameters)&&target.returnType===type.returnType,'callable-contract');previous=id;}};
  const expected=[];for(const [index,p]of fn.parameters.entries()){spend();if(commonCallableType(p.type,types,spend))expected.push(index);}
  check(Array.isArray(value.parameters)&&value.parameters.length===expected.length,'callable-contract');for(const [i,row]of value.parameters.entries()){spend();record(row,['index','allowed']);check(row.index===expected[i],'callable-contract');bound(row.allowed,commonCallableType(fn.parameters[row.index].type,types,spend));}
  const returned=commonCallableType(fn.returnType,types,spend);if(returned)bound(value.returns,returned);else check(value.returns===null,'callable-contract');
  // Slot writes are not grants. Callable Array element membership is derived
  // from verified storage writers, independently of this fixed table.
  check(Array.isArray(value.slotWrites)&&value.slotWrites.length===0,'callable-contract');
}
