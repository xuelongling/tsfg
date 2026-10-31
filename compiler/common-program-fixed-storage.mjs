// SPDX-License-Identifier: MIT
// Current private4 tuple storage, with independently closed nominal bodies.
// Source/HIR admission owns the complete catalogue and selected M12 closure.
// This boundary proves that no structural/replacement alias can add a slot;
// it then checks the actual carrier directory and reconstructs every byte.
import {commonCheck as check,commonRecord as record} from './common-program-common.mjs';
import {scalarName} from './identity.mjs';

const scalarWidths={bool:1,i8:1,u8:1,i16:2,u16:2,i32:4,u32:4,f32:4,i64:8,u64:8,isize:8,usize:8,f64:8};
const scalarCodes={i32:1,bool:2,i8:3,i16:4,i64:5,u8:6,u16:7,u32:8,u64:9,isize:10,usize:11,f32:12,f64:13};

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
  const payload=hir.snapshot.payload;
  // The already admitted witness worklist proves full selected closure and
  // consumes every record. Zero records plus no nonnominal entry/base edge is
  // an exhaustive absence proof, not a search of observed actual objects.
  spend(payload.compatibilityWitnesses.length+payload.entryCompatibilityRoots.length+1);
  if(payload.compatibilityWitnesses.length)return unavailable('selected structural M12 storage aliases are not admitted by this tuple subset');
  for(const entry of payload.entryCompatibilityRoots)for(const root of entry.roots){spend();if(root.sourceType!==root.targetType)return unavailable('entry M12 actual/view storage alias is outside the nominal tuple subset');}
  const nominal=[],bodyIssues=new Map();
  for(const type of hir.types){spend();if(type.kind!=='reference'&&type.kind!=='value')continue;
    const ctor=type.construction;
    if(type.base!==undefined||!ctor||ctor.kind!=='implicit-base'||ctor.functionId!==null||ctor.implicitForward!==null)
      return unavailable('base or replacement construction needs a complete nonnominal physical projection');
    spend(type.fields.length+ctor.initializationFields.length+1);
    const issues=[];bodyIssues.set(type.id,issues);
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
  const fields=[],results=[],bodies=new Map(),fieldBounds=new Map(),resultBounds=new Map();
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
    // Every implicit constructor/newTarget pair must actually occur in the
    // existing complete analysis directory. This cross-check is not the source
    // of completeness: the implicit-base protocol above proves its sole result.
    spend(3);const result=physical.values.capacity.storageObservations.results.get(type.construction.id+'/'+type.id);spend(result?.actualTypes.size??0);
    const knownResult=Boolean(result&&!result.unknown&&result.actualTypes.size===1&&result.actualTypes.has(type.id));
    const row={construction:type.construction.id,newTarget:type.id,actualTypes:knownResult?[type.id]:[],unknown:!knownResult};results.push(row);
    spend(3);const bound=resultBounds.get(type.construction.id+'/'+type.id);
    if(fixed!==null){check(bound,'storage-identity');if(!bound.unknown)check(!row.unknown&&bound.actualTypes[0]===type.id,'storage-identity','actual construction result exceeds the fixed complete nominal upper');}
    if(!knownResult||bound?.unknown)issues.push('construction result has no admitted complete nominal upper');
    if(issues.length===0)bodies.set(type.id,Object.freeze({actualType:type.id,kind:type.kind,byteSize,alignment,referenceCount:0,slots:Object.freeze(slots),routes}));
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
