// SPDX-License-Identifier: MIT
// Current private4 tuple storage, with independently closed nominal bodies.
// Source/HIR admission owns the complete catalogue and selected M12 closure.
// This boundary proves that no structural/replacement alias can add a slot;
// it then checks the actual carrier directory and reconstructs every byte.
import {commonCheck as check,commonRecord as record} from './common-program-common.mjs';
import {scalarName} from './identity.mjs';

const scalarWidths={bool:1,i8:1,u8:1,i16:2,u16:2,i32:4,u32:4,f32:4,i64:8,u64:8,isize:8,usize:8,f64:8};
const scalarCodes={i32:1,bool:2,i8:3,i16:4,i64:5,u8:6,u16:7,u32:8,u64:9,isize:10,usize:11,f32:12,f64:13};

// Internal typed dependency analysis, used by the real admission below. It
// grants no storage by itself. Full owning HIR/selected-witness validation is
// the caller's precondition; Source provenance IDs are joined only here.
export function commonFixedStorageIsolation(hir,spend) {
  spend(hir.types.length*3+hir.functions.length+hir.environments.length+1);
  const types=new Map(hir.types.map(type=>[type.id,type])),sourceTypes=new Map(hir.types.map(type=>[type.sourceType,type.id])),
    functions=new Map(hir.functions.map(fn=>[fn.id,fn])),environments=new Map(hir.environments.map(env=>[env.id,env])),
    members=new Map(),bindings=new Map(),edges=new Map(),seeds=new Set();let uncertain=false;
  const native=new Set(['scalar','null','undefined','void']);
  for(const type of hir.types){spend();edges.set(type.id,new Set());for(const field of type.fields??[]){spend();members.set(field.sourceBinding,type.id);}}
  for(const fn of hir.functions){spend(fn.parameters.length+fn.bindings.length+1);if(fn.ownerType)members.set(fn.sourceBinding,fn.ownerType);
    for(const binding of [...fn.parameters,...fn.bindings])bindings.set(binding.id,binding.type);}
  spend(hir.globals.length);for(const global of hir.globals)bindings.set(global.sourceBinding,global.type);
  const identity=id=>{spend();const type=types.get(id);if(!type){uncertain=true;return false;}return !native.has(type.kind);};
  const connect=(left,right)=>{spend();if(identity(left)&&identity(right)){edges.get(left).add(right);edges.get(right).add(left);}};
  const source=id=>{spend();const mapped=sourceTypes.get(id);if(mapped===undefined)uncertain=true;return mapped;};
  const selected=(left,right)=>{const from=source(left),to=source(right);if(from!==undefined&&to!==undefined){connect(from,to);seeds.add(from);seeds.add(to);}};
  for(const type of hir.types){spend();
    for(const id of type.members??[]){spend();connect(type.id,id);}
    for(const field of type.fields??[]){spend();connect(type.id,field.type);}
    if(type.elementType)connect(type.id,type.elementType);
    if(type.base){connect(type.id,type.base);seeds.add(type.id);seeds.add(type.base);}
    if(type.kind==='function'){spend(type.parameters.length+1);for(const id of type.parameters)connect(type.id,id);connect(type.id,type.returnType);}
    for(const id of type.construction?.signature.parameters??[]){spend();connect(type.id,id);}
    if(type.construction&&type.construction.kind!=='implicit-base')seeds.add(type.id);
  }
  // Read every owned expression, not just signatures or reached observations.
  // Unknown views cannot prove native payloads. Only literal/binding leaves,
  // with a narrowly closed catch source, can discharge a native erasure chain.
  const nativePayload=(initial,catches)=>{let value=initial;
    while(['as','parentheses','nonNull'].includes(value.kind)){spend();const target=types.get(value.type);
      if(!target||!native.has(target.kind)&&target.kind!=='unknown')return false;value=value.expression;}
    spend();if(['bindingReference','globalReference'].includes(value.kind)){
      const type=bindings.get(value.binding);if(type===undefined){uncertain=true;return false;}
      return native.has(types.get(type)?.kind)||catches.has(value.binding);}
    return ['numericLiteral','booleanLiteral','nullLiteral','undefinedLiteral'].includes(value.kind)&&native.has(types.get(value.type)?.kind);
  };
  const body=(initial,signature)=>{const rows=[],pending=[initial],writes=new Set();
    while(pending.length){spend();const row=pending.pop();if(row===null||typeof row!=='object')continue;
      if(Array.isArray(row)){spend(row.length);for(const child of row)pending.push(child);continue;}rows.push(row);
      if(row.type!==undefined){spend();signature.push(row.type);if(row.declaredType!==undefined)signature.push(row.declaredType);}
      if(row.argumentType!==undefined){spend();signature.push(row.argumentType);}
      if(row.signature){spend(row.signature.parameters.length+1);signature.push(...row.signature.parameters,row.signature.returnType);}
      if(['bindingTarget','globalTarget'].includes(row.kind)){spend();writes.add(row.binding);}
      for(const key in row){spend(Math.ceil(key.length/8)+1);if(key!=='sourceSignature'&&row[key]!==null&&typeof row[key]==='object')pending.push(row[key]);}
    }
    // The complete protected region must be exactly a pure throw. A call,
    // access, allocation, nested control region or a catch write cannot borrow
    // this proof from the currently observed exception set.
    const catches=new Set();spend(rows.length);
    for(const row of rows)if(row.kind==='try'&&row.catchClause?.binding){spend();const caught=row.catchClause.binding.id,protectedRows=row.tryBlock.body;
      if(!writes.has(caught)&&protectedRows.length===1&&protectedRows[0].kind==='throw'&&nativePayload(protectedRows[0].value,new Set()))catches.add(caught);}
    spend(rows.length);
    for(const row of rows)if(['as','parentheses','nonNull'].includes(row.kind)){spend();const target=types.get(row.type),from=types.get(row.expression.type);
      if(!target||!from){uncertain=true;continue;}
      if((target.kind==='unknown'||from.kind==='unknown')&&
        (!native.has(target.kind)&&target.kind!=='unknown'||!nativePayload(row.expression,catches)))uncertain=true;
    }
    spend(signature.length);const relevant=signature.filter(id=>{const type=types.get(id);if(!type){uncertain=true;return false;}return type.kind!=='unknown'&&identity(id);});
    for(let index=1;index<relevant.length;index++)connect(relevant[0],relevant[index]);
  };
  // All callable bindings/bodies and lexical layout chains participate. A
  // shared scalar/absence leaf is deliberately not an object-alias edge.
  for(const fn of hir.functions){spend(fn.parameters.length+2);const signature=[...(fn.ownerType?[fn.ownerType]:[]),fn.returnType,...fn.parameters.map(parameter=>parameter.type)];
    spend(2);for(const initial of [fn.lexicalEnvironment,fn.activationEnvironment]){let environment=initial;const visited=new Set();
      while(environment){spend();if(visited.has(environment)){uncertain=true;break;}visited.add(environment);const layout=environments.get(environment);
        if(!layout){uncertain=true;break;}spend(layout.slots.length);for(const slot of layout.slots)signature.push(slot.type);environment=layout.parent;}}
    spend(fn.bindings.length);for(const binding of fn.bindings)signature.push(binding.type);body(fn,signature);
  }
  for(const type of hir.types){spend();for(const field of type.fields??[]){spend();if(field.initializer)body(field.initializer,[type.id,field.type]);}
    if(type.construction)body(type.construction.parameters,[type.id]);}
  for(const module of hir.modules){spend();body(module.initialization,[]);}
  const payload=hir.snapshot.payload;spend(payload.compatibilityWitnesses.length+payload.entryCompatibilityRoots.length);
  for(const record of payload.compatibilityWitnesses){const proof=record.compatibility;spend(record.dependencies.length+proof.members.length+1);
    selected(proof.sourceType,proof.targetType);
    for(const dependency of record.dependencies)selected(dependency.sourceType,dependency.targetType);
    for(const pair of proof.members){spend();const from=members.get(pair.source),to=members.get(pair.target);
      if(from===undefined||to===undefined){uncertain=true;continue;}connect(from,to);seeds.add(from);seeds.add(to);}
  }
  for(const entry of payload.entryCompatibilityRoots){spend(entry.roots.length);for(const root of entry.roots)if(root.sourceType!==root.targetType){selected(root.sourceType,root.targetType);const view=source(entry.viewType);if(view!==undefined)seeds.add(view);}}
  // A value return may hide a replacement behind assertions/calls/fields. Do
  // not narrow that source-level uncertainty from observed constructor arms.
  for(const type of hir.types)if(type.construction?.kind==='explicit'){
    spend();const fn=functions.get(type.construction.functionId);
    if(!fn||fn.ownerType!==type.id){uncertain=true;continue;}const pending=[fn.body];
    while(pending.length){spend();const row=pending.pop();if(row===null||typeof row!=='object')continue;
      if(Array.isArray(row)){spend(row.length);for(const child of row)pending.push(child);continue;}
      if(row.kind==='return'&&row.value!==undefined)uncertain=true;
      for(const key in row){spend(Math.ceil(key.length/8)+1);if(row[key]!==null&&typeof row[key]==='object')pending.push(row[key]);}
    }
  }
  spend(seeds.size);const pending=Array.from(seeds),affected=new Set();
  while(pending.length){spend();const id=pending.pop();if(affected.has(id))continue;affected.add(id);if(types.get(id)?.kind==='unknown')uncertain=true;
    const related=edges.get(id);if(!related){uncertain=true;continue;}spend(related.size);for(const next of related)pending.push(next);}
  if(uncertain){spend(hir.types.length);for(const type of hir.types)if(type.kind==='reference'||type.kind==='value')affected.add(type.id);}
  return {affected,uncertain};
}

// Fixed metadata admission only. The full nonempty directory is owned by this
// publication, not refreshed from the current body's observations. Acceptance
// here does not grant a copy projection; physical/source checks below do that.
export function commonValidateFixedStorage(hir,storage,spend) {
  record(storage,['fields','results']);check(Array.isArray(storage.fields)&&Array.isArray(storage.results),'publication-storage');
  spend(storage.fields.length+storage.results.length+hir.types.length+1);
  if(storage.fields.length===0&&storage.results.length===0)return;
  const types=new Map(hir.types.map(type=>[type.id,type])),fields=new Map(),pairs=new Map();
  for(const type of hir.types){spend();for(const field of type.fields??[]){spend();fields.set(field.id,field);}
    if(type.kind!=='reference'&&type.kind!=='value')continue;
    let owner=type;
    while(owner){spend();check(owner.construction,'publication-storage');pairs.set(owner.construction.id+'/'+type.id,{construction:owner.construction.id,newTarget:type.id});owner=types.get(owner.base);}
  }
  check(storage.fields.length===fields.size&&storage.results.length===pairs.size,'publication-storage-coverage');
  let previous=null;
  for(const row of storage.fields){spend();record(row,['fieldId','actualTypes','unknown']);const field=fields.get(row.fieldId);
    check(field&&(!previous||previous<row.fieldId)&&typeof row.unknown==='boolean'&&Array.isArray(row.actualTypes),'publication-storage');
    spend(row.fieldId.length+1);
    if(row.unknown)check(row.actualTypes.length===0,'publication-storage','unresolved storage is explicit TOP, never a sampled finite bound');
    else {check(row.actualTypes.length===1&&typeof row.actualTypes[0]==='string','publication-storage');spend(row.actualTypes[0].length);
      check(types.get(field.type)?.kind==='scalar'&&row.actualTypes[0]===field.type,'publication-storage','this storage profile admits only complete scalar field bounds');}
    previous=row.fieldId;
  }
  previous=null;
  for(const row of storage.results){spend();record(row,['construction','newTarget','actualTypes','unknown']);check(typeof row.construction==='string'&&typeof row.newTarget==='string','publication-storage');spend(row.construction.length+row.newTarget.length+1);const key=row.construction+'/'+row.newTarget;
    spend(key.length+1);check(pairs.has(key)&&(!previous||previous<key)&&typeof row.unknown==='boolean'&&Array.isArray(row.actualTypes)&&
      (row.unknown?row.actualTypes.length===0:row.actualTypes.length===1&&row.actualTypes[0]===row.newTarget),'publication-storage');previous=key;
  }
}

/** Internal typed operation: nonnull fixed has already passed the owning
 * publication scope's metadata admission against this same complete HIR.
 * @param {ReturnType<typeof import('./common-program-hir.mjs').verifyCommonProgramHir>} hir
 * @param {ReturnType<typeof import('./common-program-physical.mjs').commonProgramPhysical>} physical
 * @param {{fields:{fieldId:string,actualTypes:string[],unknown:boolean}[],results:{construction:string,newTarget:string,actualTypes:string[],unknown:boolean}[]}|null} [fixed]
 */
export function commonFixedStorageProjection(hir,physical,fixed=null) {
  const {spend}=physical.model;spend(hir.types.length+1);const types=new Map(hir.types.map(type=>[type.id,type]));
  const unavailable=message=>({status:/** @type {const} */('open'),issues:[message],storage:{fields:[],results:[]}});
  check(physical.model.hir.inputIdentity===hir.inputIdentity,'storage-identity');
  const isolation=commonFixedStorageIsolation(hir,spend);
  const nominal=[],bodyIssues=new Map();
  for(const type of hir.types){spend();if(type.kind!=='reference'&&type.kind!=='value')continue;
    const ctor=type.construction;
    if(!ctor)return unavailable('owned construction role catalogue is unavailable');
    spend(type.fields.length+ctor.initializationFields.length+1);
    const issues=[];bodyIssues.set(type.id,issues);
    if(isolation.affected.has(type.id)||type.base!==undefined||ctor.kind!=='implicit-base'||ctor.functionId!==null||ctor.implicitForward!==null)
      issues.push('complete owning dependency closure does not isolate this nominal storage');
    if(ctor.initializationFields.length!==type.fields.length)issues.push('incomplete nominal field initialization catalogue');
    const keys=new Set();
    for(const [index,field]of type.fields.entries()){spend(field.name.length+1);
      // Facts admission binds this identifier spelling to the original field
      // token and preserves declaration order/sourceBinding. Distinct names in
      // one no-base body are the actual tuple keys, never cross-type permission.
      if(keys.has(field.name)||ctor.initializationFields[index]!==field.id)issues.push('nominal property identity is not one complete ordered tuple');keys.add(field.name);
    }
    nominal.push(type);
  }
  // This proof excludes opaque foreign stores: their possible mutable input
  // aliases are not a scalar-field type invariant of the closed Source package.
  if(hir.hostImports.length)return unavailable('foreign mutable storage is outside the nominal tuple subset');
  const fields=[],results=[],bodies=new Map(),candidateBodies=new Map(),fieldBounds=new Map(),resultBounds=new Map();
  if(fixed!==null){
    if(fixed.fields.length===0&&fixed.results.length===0&&nominal.length)return unavailable('publication has no admitted fixed nominal storage table');
    spend(fixed.fields.length+fixed.results.length);
    for(const row of fixed.fields)fieldBounds.set(row.fieldId,row);
    for(const row of fixed.results){spend(3);resultBounds.set(row.construction+'/'+row.newTarget,row);}
  }
  for(const type of nominal){
    let byteSize=0,alignment=1;const slots=[],routes=new Map(),issues=bodyIssues.get(type.id),identityClosed=issues.length===0;
    for(const field of type.fields){spend();const carrier=physical.carriers.bindings.get(field.sourceBinding),name=scalarName(field.type),width=scalarWidths[name],code=scalarCodes[name];
      const initializer=field.initializer,known=identityClosed&&types.get(field.type)?.kind==='scalar'&&initializer&&['numericLiteral','booleanLiteral'].includes(initializer.kind)&&initializer.type===field.type&&carrier===field.type&&Boolean(width)&&Boolean(code);
      const row={fieldId:field.id,actualTypes:known?[carrier]:[],unknown:!known},bound=fieldBounds.get(field.id);fields.push(row);
      if(fixed!==null){check(bound,'storage-identity');if(!bound.unknown)check(!row.unknown&&bound.actualTypes[0]===carrier,'storage-identity','actual field carrier exceeds the fixed complete scalar upper');}
      if(!known||bound?.unknown){issues.push('field has no admitted complete scalar physical capacity');continue;}
      const concrete=physical.carriers.layout(carrier);spend(6);
      check(concrete.byteSize===width&&concrete.alignment===width&&concrete.referenceCount===0,'storage-layout','actual primitive layout differs');
      const offset=Math.ceil(byteSize/width)*width;byteSize=offset+width;alignment=Math.max(alignment,width);
      // Full primitive plan: one scalar byte range, no tags/references/children.
      // The actual tuple representation has no candidate-v2 state/tag planes.
      spend(type.id.length+field.id.length+field.name.length+4);
      const key='private4-tuple:'+type.id+':'+offset+':'+field.id;
      slots.push(Object.freeze({fieldId:field.id,sourceBinding:field.sourceBinding,propertyKey:field.name,carrier,offset,
        byteSize:width,alignment:width,referenceOffset:0,referenceCount:0,
        layout:Object.freeze({fields:Object.freeze([Object.freeze({offset:0,code})]),references:Object.freeze([]),children:Object.freeze([])}),key}));
      routes.set(field.id,key);
    }
    byteSize=Math.ceil(byteSize/alignment)*alignment;
    if(issues.length===0){const actual=type.kind==='value'?physical.carriers.layout(type.id):physical.carriers.bodies.get(type.id);spend(6);
      check(actual&&actual.byteSize===byteSize&&actual.alignment===alignment&&actual.referenceCount===0,'storage-layout','complete actual nominal tuple layout differs');}
    if(issues.length===0)candidateBodies.set(type.id,Object.freeze({actualType:type.id,kind:type.kind,byteSize,alignment,referenceCount:0,slots:Object.freeze(slots),routes}));
  }
  // Enumerate every ancestor constructor/newTarget role, not merely own pairs.
  // Conditional capacity discharges only an independently isolated protocol.
  for(const type of nominal){let owner=type;const issues=bodyIssues.get(type.id);
    while(owner){spend(3);const ctor=owner.construction,key=ctor.id+'/'+type.id;
      const result=physical.values.capacity.storageObservations.results.get(key);spend(result?.actualTypes.size??0);
      const protocol=owner.id===type.id&&!isolation.affected.has(type.id)&&!type.base&&ctor.kind==='implicit-base'&&ctor.functionId===null&&ctor.implicitForward===null;
      const knownResult=Boolean(protocol&&result&&!result.unknown&&result.actualTypes.size===1&&result.actualTypes.has(type.id));
      const row={construction:ctor.id,newTarget:type.id,actualTypes:knownResult?[type.id]:[],unknown:!knownResult},bound=resultBounds.get(key);results.push(row);
      if(fixed!==null){check(bound,'storage-identity');if(!bound.unknown)check(!row.unknown&&bound.actualTypes[0]===type.id,'storage-identity','actual construction result exceeds the fixed complete nominal upper');}
      if(!knownResult||bound?.unknown)issues.push('construction result has no admitted complete nominal upper');owner=types.get(owner.base);
    }
    const body=candidateBodies.get(type.id);if(issues.length===0&&body)bodies.set(type.id,body);
  }
  const compare=(a,b)=>{spend(a.length+b.length+1);return a<b?-1:a>b?1:0;};
  spend(fields.length+results.length);fields.sort((a,b)=>compare(a.fieldId,b.fieldId));results.sort((a,b)=>{
    spend(a.construction.length+a.newTarget.length+b.construction.length+b.newTarget.length+3);
    const left=a.construction+'/'+a.newTarget,right=b.construction+'/'+b.newTarget;return left<right?-1:left>right?1:0;
  });
  const storage={fields,results};
  if(fixed!==null){
    // Full role coverage stays fixed even for unresolved TOP rows. Known fixed
    // bounds were checked above; TOP never upgrades from current body samples.
    check(fixed.fields.length===fields.length&&fixed.results.length===results.length,'storage-identity');
    for(const [index,row]of fields.entries()){spend();check(fixed.fields[index].fieldId===row.fieldId,'storage-identity');}
    for(const [index,row]of results.entries()){spend();check(fixed.results[index].construction===row.construction&&fixed.results[index].newTarget===row.newTarget,'storage-identity');}
  }
  const shapes=new Map();spend(hir.types.length);
  for(const type of hir.types){spend();const body=bodies.get(type.id);
    if(type.kind==='value'){if(body){spend(body.slots.length);shapes.set(type.id,Object.freeze({kind:'value',fields:Object.freeze(body.slots.map(slot=>Object.freeze({id:slot.fieldId,view:type.id})))}));}}
    else if(!['unknown','union'].includes(type.kind))shapes.set(type.id,Object.freeze({kind:type.kind,fields:Object.freeze([])}));
  }
  const open=message=>{spend(message.length+1);throw Object.assign(new TypeError(message),{code:'r03-construction-storage-open',status:'open'});};
  const actualType=id=>{spend(id.length+1);const shape=shapes.get(id);if(!shape)open('unsupported fixed actual storage type');return shape;};
  const resolveField=(actual,view,selector)=>{spend(actual.length+view.length+selector.length+1);
    if(selector==='element'){
      const source=types.get(actual),target=types.get(view);
      if(['array','readSpan'].includes(source?.kind)&&['array','readSpan'].includes(target?.kind))return {status:/** @type {const} */('present'),key:'element'};
    }else if(actual===view&&selector.startsWith('field:')){
      spend(selector.length);const key=bodies.get(actual)?.routes.get(selector.slice(6));if(key!==undefined)return {status:/** @type {const} */('present'),key};
    }
    return {status:/** @type {const} */('open'),issues:['field route is outside the complete nominal tuple authority']};
  };
  const projectField=(actual,view,selector)=>{const result=resolveField(actual,view,selector);if(result.status==='open')open(result.issues[0]);return result.key;};
  spend(bodies.size);const layouts=Object.freeze(Array.from(bodies.values(),({routes,...layout})=>Object.freeze(layout)));
  spend(nominal.length);const capabilities=Object.freeze(nominal.map(type=>{const issues=bodyIssues.get(type.id);spend(issues.length);return Object.freeze({typeId:type.id,status:issues.length?'open':'complete',issues:Object.freeze([...issues])});}));
  const supportsValue=id=>{spend(id.length+1);return types.get(id)?.kind==='value'&&bodies.has(id);};
  return {status:bodies.size===nominal.length?/** @type {const} */('complete'):/** @type {const} */('partial'),storage:fixed??storage,actualType,projectField,resolveField,layouts,capabilities,supportsValue};
}
