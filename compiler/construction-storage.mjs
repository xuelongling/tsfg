// SPDX-License-Identifier: MIT
// Candidate fixed-construction storage seam. No Source, compiler or heap execution.
// Inputs are projections of independently admitted authorities, not raw JSON.

/** @typedef {(units:number)=>void} Charge */
/** @typedef {{complete:boolean,unknown:boolean,proof:string,actualTypes:readonly string[]}} FixedUpper */
/** @typedef {{id:string,base:string|null,runtimeKey:string,fields:readonly string[],construction:string}} StorageClass */
/** @typedef {{id:string,owner:string,propertyIdentity:string,readonly:boolean,upper:FixedUpper}} StorageField */
/** @typedef {{id:string,key:string}} PropertyIdentity */
/** @typedef {{id:string,owner:string,initializationFields:readonly string[]}} Construction */
/** @typedef {{construction:string,newTarget:string,resultUpper:FixedUpper}} ConstructionResult */
/** @typedef {{actualType:string,targetType:string,fields:readonly ({source:string,target:string}|{missing:true,target:string})[]}} MemberView */
/** @typedef {{id:string,sourceType:string,targetType:string,fields:readonly ({source:string,target:string}|{missing:true,target:string})[]}} SelectedFieldWitness */
/**
 * Concrete layout identity resolves to the FULL independently validated element
 * layout (variants, scalar fields, references, nested tags/children and copy
 * rules), not merely a root-count hash. This module never fabricates that plan.
 * @typedef {{id:string,kind:'reference'|'inline'|'absence',byteSize:number,alignment:number,referenceCount:number,layoutIdentity:string}} ConcretePayload
 */
/**
 * Each authority identity is pinned by the adopting caller. `propertyKeys` is a
 * new data obligation: it independently proves field -> runtime property key
 * identity; a matching display name is not a member-access permission.
 * `publication` proves COMPLETE fixed closure results and field payload bounds,
 * including mutable aliases/initializer undefined, independently of body flow.
 * @typedef {{authorities:{catalogue:string,propertyKeys:string,publication:string,layouts:string,m12:string},unresolved:readonly string[],classes:readonly StorageClass[],fields:readonly StorageField[],properties:readonly PropertyIdentity[],constructions:readonly Construction[],newTargets:readonly string[],results:readonly ConstructionResult[],views:readonly MemberView[],selectedWitnesses:readonly SelectedFieldWitness[],payloads:readonly ConcretePayload[]}} ConstructionStorageInput
 */
/** @typedef {{actualType:string,layoutIdentity:string,tag:number,byteOffset:number,referenceOffset:number,referenceCount:number}} SlotAlternative */
/** @typedef {{propertyIdentity:string,fields:string[],offset:number,payloadOffset:number,byteSize:number,alignment:number,referenceOffset:number,referenceCount:number,stateBit:number,alternatives:SlotAlternative[]}} StorageSlot */
/** @typedef {{viewType:string,field:string,sourceField:string|null,slot:number|null,authority:'nominal'|'m12'|'construction',viaWitnesses:string[],read:'requires-source-permission',write:'requires-source-assignment'}} StorageRoute */
/** @typedef {{actualType:string,runtimeKey:string,byteSize:number,alignment:number,referenceCount:number,stateBytes:number,slots:StorageSlot[],routes:StorageRoute[]}} StorageBody */
/** @typedef {{construction:string,owner:string,newTarget:string,actualType:string,rights:'per-activation-ordered-definition',fields:{field:string,slot:number,ordinal:number,declarationReadonly:boolean}[]}} ConstructionProjection */
/** @typedef {{family:'tsfg.construction-storage-candidate',version:2,authorities:ConstructionStorageInput['authorities'],bodies:StorageBody[],projections:ConstructionProjection[]}} StorageClosure */
/** @typedef {{status:'complete',closure:StorageClosure}|{status:'open'|'rejected',issues:string[]}} StorageResult */

/**
 * Derive closed storage from fixed upper contracts. Charge uses the caller's
 * existing cumulative work meter; this function creates no fresh work budget.
 * It owns catalogue joins/layout arithmetic, NOT Source assignability, M12 proof
 * construction, raw-input decoding, GC layout admission or constructor CFG rights.
 * @param {ConstructionStorageInput} input @param {Charge} charge
 * @returns {StorageResult}
 */
export function solveConstructionStorageClosure(input,charge) {
  const counts=[input.classes.length,input.fields.length,input.properties.length,input.constructions.length,input.newTargets.length,input.results.length,input.views.length,input.selectedWitnesses.length,input.payloads.length];
  charge(counts.reduce((sum,n)=>sum+n,1));
  if(counts.some(n=>n>65536)||input.classes.length>4096||input.payloads.length>4096||input.views.length>4096||input.selectedWitnesses.length>4096||input.results.length>4096)
    return {status:'rejected',issues:['catalogue limit']};
  const classes=new Map(input.classes.map(row=>[row.id,row])),fields=new Map(input.fields.map(row=>[row.id,row])),
    properties=new Map(input.properties.map(row=>[row.id,row])),constructions=new Map(input.constructions.map(row=>[row.id,row])),
    payloads=new Map(input.payloads.map(row=>[row.id,row]));
  /** @type {string[]} */ const invalid=[];
  /** @type {string[]} */ const open=[];
  charge(input.unresolved.length+5);open.push(...input.unresolved);
  if(Object.values(input.authorities).some(id=>!id))open.push('missing independently pinned authority');
  if(classes.size!==input.classes.length||fields.size!==input.fields.length||properties.size!==input.properties.length||constructions.size!==input.constructions.length||payloads.size!==input.payloads.length||new Set(input.newTargets).size!==input.newTargets.length)
    invalid.push('duplicate catalogue identity');
  /** @type {Map<string,string>} */ const keys=new Map();
  for(const property of input.properties){charge(1);if(!property.id||keys.has(property.key))invalid.push('property authority splits one verified key');keys.set(property.key,property.id);}
  /** @param {number} n @param {number} valueMax */
  const integer=(n,valueMax)=>Number.isSafeInteger(n)&&n>=0&&n<=valueMax;
  for(const payload of input.payloads){charge(1);
    if(!payload.layoutIdentity)open.push('missing complete concrete layout: '+payload.id);
    if(!integer(payload.byteSize,65536)||!integer(payload.referenceCount,256)||![1,2,4,8].includes(payload.alignment)||payload.byteSize%payload.alignment!==0||
      (payload.kind==='reference'&&(payload.byteSize!==8||payload.alignment!==8||payload.referenceCount!==1))||
      (payload.kind==='absence'&&(payload.byteSize!==0||payload.referenceCount!==0)))invalid.push('invalid concrete layout summary: '+payload.id);
  }
  /** @param {FixedUpper} upper @param {string} label @param {boolean} objects */
  const upper=(upper,label,objects)=>{
    charge(upper.actualTypes.length+1);
    if(!upper.complete||upper.unknown||!upper.proof||upper.actualTypes.length===0)open.push('unproved fixed upper: '+label);
    if(upper.actualTypes.length>256||new Set(upper.actualTypes).size!==upper.actualTypes.length)invalid.push('invalid finite upper: '+label);
    for(const id of upper.actualTypes){charge(1);if(objects?!classes.has(id):!payloads.has(id))open.push('unknown concrete upper member: '+label+'/'+id);}
  };
  for(const field of input.fields){charge(1);
    if(!classes.has(field.owner)||!properties.has(field.propertyIdentity))invalid.push('unowned field/property identity: '+field.id);
    upper(field.upper,field.id,false);
  }
  /** @type {Set<string>} */ const claimed=new Set();
  for(const type of input.classes){charge(type.fields.length+1);
    if(type.fields.length>256||!type.runtimeKey||(type.base!==null&&!classes.has(type.base)))invalid.push('invalid class catalogue: '+type.id);
    const ctor=constructions.get(type.construction);
    if(!ctor||ctor.owner!==type.id)invalid.push('construction owner mismatch: '+type.id);
    for(const id of type.fields){charge(1);if(claimed.has(id)||fields.get(id)?.owner!==type.id)invalid.push('duplicate/foreign class field: '+id);claimed.add(id);}
  }
  if(claimed.size!==fields.size)invalid.push('incomplete class-field directory');
  for(const ctor of input.constructions){charge(ctor.initializationFields.length+1);
    const type=classes.get(ctor.owner);
    if(!type||type.construction!==ctor.id||new Set(ctor.initializationFields).size!==ctor.initializationFields.length||ctor.initializationFields.length!==type.fields.length||
      ctor.initializationFields.some(id=>fields.get(id)?.owner!==type.id))invalid.push('own initialization membership mismatch: '+ctor.id);
  }
  /** @type {Map<string,string[]>} */ const lineages=new Map();
  for(const type of input.classes){
    /** @type {Set<string>} */ const seen=new Set();
    /** @type {string[]} */ const lineage=[];let current=classes.get(type.id);
    while(current){charge(1);if(seen.has(current.id)){invalid.push('inheritance cycle: '+type.id);break;}seen.add(current.id);lineage.push(current.id);current=current.base===null?undefined:classes.get(current.base);}
    charge(lineage.length);lineage.reverse();lineages.set(type.id,lineage);
  }
  /** @type {Map<string,ConstructionResult>} */ const results=new Map();
  for(const row of input.results){charge(1);const key=row.newTarget+'\0'+row.construction;
    if(results.has(key)||!classes.has(row.newTarget)||!constructions.has(row.construction))invalid.push('duplicate/unowned construction result');
    results.set(key,row);upper(row.resultUpper,key,true);
  }
  /** @type {Set<string>} */ const required=new Set();
  for(const newTarget of input.newTargets){charge(1);const lineage=lineages.get(newTarget);
    if(!lineage){open.push('newTarget outside reference catalogue: '+newTarget);continue;}
    for(const owner of lineage){charge(1);const ctor=classes.get(owner)?.construction,key=newTarget+'\0'+ctor;required.add(key);if(!results.has(key))open.push('missing fixed construction result: '+key);}
  }
  for(const key of results.keys()){charge(1);if(!required.has(key))invalid.push('construction result outside fixed newTarget lineage');}
  if(invalid.length)return {status:'rejected',issues:invalid};
  if(open.length)return {status:'open',issues:open};

  /** @type {Map<string,Map<string,Set<string>>>} */ const aliases=new Map();
  /** @type {Map<string,Map<string,StorageRoute>>} */ const routes=new Map();
  /** @type {Map<string,Set<string>>} */ const nominal=new Map();
  // This is FIELD storage-view reachability, never a method dispatch witness.
  // Empty field catalogues need an explicit reachability seed as well.
  /** @type {Set<string>} */ const activeFieldViews=new Set();
  for(const type of input.classes){
    /** @type {Map<string,Set<string>>} */ const slots=new Map();aliases.set(type.id,slots);
    /** @type {Map<string,StorageRoute>} */ const access=new Map();routes.set(type.id,access);
    /** @type {Set<string>} */ const members=new Set();nominal.set(type.id,members);
    for(const owner of lineages.get(type.id)??[])for(const id of classes.get(owner)?.fields??[]){charge(1);const field=fields.get(id);if(!field)continue;
      /** @type {Set<string>} */ const group=slots.get(field.propertyIdentity)??new Set();group.add(id);slots.set(field.propertyIdentity,group);members.add(id);
    }
  }
  for(const type of input.classes)for(const viewType of lineages.get(type.id)??[]){charge(1);activeFieldViews.add(type.id+'\0'+viewType);
    for(const id of nominal.get(viewType)??[]){charge(1);
      routes.get(type.id)?.set(viewType+'\0'+id,{viewType,field:id,sourceField:id,slot:null,authority:'nominal',viaWitnesses:[],read:'requires-source-permission',write:'requires-source-assignment'});
    }
  }
  /** @type {ConstructionProjection[]} */ const projections=[];
  for(const newTarget of input.newTargets)for(const owner of lineages.get(newTarget)??[]){
    charge(1);const type=classes.get(owner);if(!type)continue;
    const ctor=constructions.get(type.construction);if(!ctor)continue;
    // Base binds its fresh newTarget object. Derived binds the COMPLETE base
    // Construct result upper, including replacement objects, not owner views.
    const base=type.base===null?undefined:classes.get(type.base);
    const actualTypes=base?results.get(newTarget+'\0'+base.construction)?.resultUpper.actualTypes??[]:[newTarget];
    for(const actualType of actualTypes){charge(ctor.initializationFields.length+1);
      const slots=aliases.get(actualType),access=routes.get(actualType);if(!slots||!access)continue;
      for(const id of ctor.initializationFields){charge(1);const field=fields.get(id);if(!field)continue;
        /** @type {Set<string>} */ const group=slots.get(field.propertyIdentity)??new Set();group.add(id);slots.set(field.propertyIdentity,group);
        // An own constructor definition is separate from an M12 compatibility
        // witness. It grants no permission to unrelated members or methods.
        if(!access.has(owner+'\0'+id))access.set(owner+'\0'+id,{viewType:owner,field:id,sourceField:id,slot:null,authority:'construction',viaWitnesses:[],read:'requires-source-permission',write:'requires-source-assignment'});
      }
      projections.push({construction:ctor.id,owner,newTarget,actualType,rights:'per-activation-ordered-definition',fields:ctor.initializationFields.map((field,ordinal)=>({field,slot:-1,ordinal,declarationReadonly:fields.get(field)?.readonly??false}))});
    }
  }
  /** @type {Set<string>} */ const seenViews=new Set();
  for(const view of input.views){charge(view.fields.length+1);const key=view.actualType+'\0'+view.targetType;
    if(seenViews.has(key)||!classes.has(view.actualType)||!classes.has(view.targetType)||view.fields.length>256){invalid.push('invalid M12 view catalogue');continue;}seenViews.add(key);
    const target=nominal.get(view.targetType),actual=nominal.get(view.actualType);
    /** @type {Set<string>} */ const covered=new Set();
    for(const pair of view.fields){charge(1);const field=fields.get(pair.target);
      if(!field||!target?.has(pair.target)||covered.has(pair.target)){invalid.push('unowned/duplicate M12 target');continue;}covered.add(pair.target);
      /** @type {string|null} */ let sourceField=null;
      if('source' in pair){const source=fields.get(pair.source);
        if(!source||!actual?.has(pair.source)||source.propertyIdentity!==field.propertyIdentity){invalid.push('M12 physical property identity mismatch');continue;}sourceField=pair.source;
      }else{
        // `missing` came from an explicit admitted M12 optional-absence proof.
        // Do not turn failure to find a slot into such a proof.
        const existing=aliases.get(view.actualType)?.get(field.propertyIdentity);
        let nominalPresent=false;
        if(existing){charge(existing.size);for(const id of existing)if(actual?.has(id)){nominalPresent=true;break;}}
        if(nominalPresent){invalid.push('M12 missing contradicts actual nominal property');continue;}
      }
      const group=aliases.get(view.actualType)?.get(field.propertyIdentity);
      if(group)group.add(pair.target);
      routes.get(view.actualType)?.set(view.targetType+'\0'+pair.target,{viewType:view.targetType,field:pair.target,sourceField,slot:null,authority:'m12',viaWitnesses:[],read:'requires-source-permission',write:'requires-source-assignment'});
    }
    if(covered.size!==target?.size)invalid.push('incomplete M12 field projection');
    activeFieldViews.add(key);
  }
  if(invalid.length)return {status:'rejected',issues:invalid};
  /** @type {Set<string>} */ const witnessIds=new Set();
  for(const witness of input.selectedWitnesses){charge(witness.fields.length+1);
    if(!witness.id||witnessIds.has(witness.id)||!classes.has(witness.sourceType)||!classes.has(witness.targetType)||witness.fields.length>256){invalid.push('unowned/duplicate selected field witness');continue;}
    witnessIds.add(witness.id);
    const source=nominal.get(witness.sourceType),target=nominal.get(witness.targetType);
    /** @type {Set<string>} */ const covered=new Set();
    for(const pair of witness.fields){charge(1);const to=fields.get(pair.target);
      if(!to||!target?.has(pair.target)||covered.has(pair.target)){invalid.push('unowned/duplicate selected witness target');continue;}covered.add(pair.target);
      if('source' in pair){const from=fields.get(pair.source);
        if(!from||!source?.has(pair.source)||from.propertyIdentity!==to.propertyIdentity)invalid.push('selected witness field/property identity mismatch');
      }
      // A missing target is an ADMITTED optional-absence member of this exact
      // selected source witness, not absence inferred from an actual object.
    }
    if(covered.size!==target?.size)invalid.push('incomplete selected field witness');
  }
  if(invalid.length)return {status:'rejected',issues:invalid};
  // Monotone finite closure over real selected witness edges. Newly acquired
  // construction FIELD views may traverse D -> X -> Y without retagging U or
  // manufacturing a U -> X Source witness. Every edge retains its real id.
  let changed=true;
  while(changed){
    changed=false;charge(activeFieldViews.size+projections.length+1);
    if(activeFieldViews.size>4096)return {status:'rejected',issues:['construction field-view closure limit']};
    // An acquired D FIELD view also carries its explicitly declared B base
    // fields. This is the real nominal base edge, not an invented M12 witness.
    for(const type of input.classes)for(const view of input.classes){charge(1);
      if(view.base===null||!activeFieldViews.has(type.id+'\0'+view.id)||activeFieldViews.has(type.id+'\0'+view.base))continue;
      const access=routes.get(type.id);if(!access)continue;
      for(const id of nominal.get(view.base)??[]){charge(1);const inherited=access.get(view.id+'\0'+id);
        if(!inherited){invalid.push('active descendant field view is incomplete');continue;}
        if(!access.has(view.base+'\0'+id)){charge(inherited.viaWitnesses.length);access.set(view.base+'\0'+id,{...inherited,viewType:view.base,viaWitnesses:[...inherited.viaWitnesses]});}
      }
      activeFieldViews.add(type.id+'\0'+view.base);changed=true;
    }
    for(const projection of projections){charge(1);const type=classes.get(projection.owner),access=routes.get(projection.actualType),key=projection.actualType+'\0'+projection.owner;
      if(!type||!access||activeFieldViews.has(key))continue;
      if(type.base!==null&&!activeFieldViews.has(projection.actualType+'\0'+type.base))continue;
      for(const id of type.base===null?[]:nominal.get(type.base)??[]){charge(1);const inherited=access.get(type.base+'\0'+id);
        if(!inherited){invalid.push('active base field view is incomplete');continue;}
        if(!access.has(projection.owner+'\0'+id)){charge(inherited.viaWitnesses.length);access.set(projection.owner+'\0'+id,{...inherited,viaWitnesses:[...inherited.viaWitnesses],viewType:projection.owner,authority:'construction'});}
      }
      activeFieldViews.add(key);changed=true;
    }
    for(const witness of input.selectedWitnesses)for(const type of input.classes){charge(1);
      const targetKey=type.id+'\0'+witness.targetType;
      if(!activeFieldViews.has(type.id+'\0'+witness.sourceType)||activeFieldViews.has(targetKey))continue;
      const access=routes.get(type.id),groups=aliases.get(type.id);if(!access||!groups)continue;
      for(const pair of witness.fields){charge(1);const field=fields.get(pair.target);if(!field)continue;
        const source='source' in pair?access.get(witness.sourceType+'\0'+pair.source):null;
        if('source' in pair&&!source){invalid.push('active source field view is incomplete');continue;}
        // Optional source absence does not erase an actual U property. A
        // verified property identity can select its existing/reserved slot;
        // the REAL selected witness supplies access authority. Its complete
        // alias payload upper is added before physical capacity selection.
        const group=groups.get(field.propertyIdentity);if(group)group.add(pair.target);
        const chain=source?.viaWitnesses??[];charge(chain.length+1);
        access.set(witness.targetType+'\0'+pair.target,{viewType:witness.targetType,field:pair.target,sourceField:source?.sourceField??null,slot:null,authority:'m12',viaWitnesses:[...chain,witness.id],read:'requires-source-permission',write:'requires-source-assignment'});
      }
      activeFieldViews.add(targetKey);changed=true;
    }
  }
  if(invalid.length)return {status:'rejected',issues:invalid};
  for(const projection of projections){charge(1);if(!activeFieldViews.has(projection.actualType+'\0'+projection.owner))open.push('missing selected-receiver base-view projection: '+projection.actualType+'/'+projection.owner);}
  if(open.length)return {status:'open',issues:open};

  /** @param {string} a @param {string} b */ const compare=(a,b)=>{charge(1);return a<b?-1:a>b?1:0;};
  /** @param {number} n @param {number} boundary */ const align=(n,boundary)=>Math.ceil(n/boundary)*boundary;
  /** @type {StorageBody[]} */ const bodies=[];
  /** @type {Map<string,Map<string,number>>} */ const bodyIndices=new Map();
  for(const type of input.classes){charge(1);const groups=aliases.get(type.id);if(!groups)continue;
    if(groups.size>256){invalid.push('construction property count exceeds body limit');continue;}
    charge(groups.size);const ordered=[...groups.keys()].sort(compare),stateBytes=Math.ceil(2*groups.size/8);
    let byteSize=stateBytes,alignment=1,referenceCount=0;
    /** @type {StorageSlot[]} */ const slots=[];
    /** @type {Map<string,number>} */ const indices=new Map();bodyIndices.set(type.id,indices);
    for(const propertyIdentity of ordered){charge(1);const group=groups.get(propertyIdentity);if(!group)continue;
      charge(group.size);const ids=[...group].sort(compare);
      /** @type {Set<string>} */ const members=new Set();
      for(const id of ids){const field=fields.get(id);if(field){charge(field.upper.actualTypes.length);field.upper.actualTypes.forEach(member=>members.add(member));}}
      if(members.size>256){invalid.push('construction slot alternative limit');continue;}
      charge(members.size);const actualTypes=[...members].sort(compare);
      let payloadBytes=0,slotAlignment=2,roots=0;
      for(const member of actualTypes){charge(1);const payload=payloads.get(member);if(!payload)continue;payloadBytes=Math.max(payloadBytes,payload.byteSize);slotAlignment=Math.max(slotAlignment,payload.alignment);roots=Math.max(roots,payload.referenceCount);}
      const offset=align(byteSize,slotAlignment),payloadOffset=align(offset+2,slotAlignment),index=slots.length;
      byteSize=align(payloadOffset+payloadBytes,slotAlignment);alignment=Math.max(alignment,slotAlignment);
      indices.set(propertyIdentity,index);
      slots.push({propertyIdentity,fields:ids,offset,payloadOffset,byteSize:byteSize-offset,alignment:slotAlignment,referenceOffset:referenceCount,referenceCount:roots,stateBit:2*index,
        alternatives:actualTypes.map((actualType,tag)=>({actualType,layoutIdentity:payloads.get(actualType)?.layoutIdentity??'',tag,byteOffset:payloadOffset,referenceOffset:referenceCount,referenceCount:payloads.get(actualType)?.referenceCount??0}))});
      referenceCount+=roots;
    }
    byteSize=align(byteSize,alignment);
    if(byteSize>65536||referenceCount>256){invalid.push('construction-expanded body limit: '+type.id);continue;}
    const access=routes.get(type.id);charge(access?.size??0);
    const selected=[...(access?.values()??[])].map(route=>({...route,slot:indices.get(fields.get(route.field)?.propertyIdentity??'')??null}));
    selected.sort((a,b)=>compare(a.viewType+'\0'+a.field,b.viewType+'\0'+b.field));
    bodies.push({actualType:type.id,runtimeKey:type.runtimeKey,byteSize,alignment,referenceCount,stateBytes,slots,routes:selected});
  }
  if(invalid.length)return {status:'rejected',issues:invalid};
  for(const projection of projections)for(const row of projection.fields){charge(1);row.slot=bodyIndices.get(projection.actualType)?.get(fields.get(row.field)?.propertyIdentity??'')??-1;if(row.slot<0)invalid.push('missing construction slot');}
  if(invalid.length)return {status:'rejected',issues:invalid};
  bodies.sort((a,b)=>compare(a.actualType,b.actualType));
  projections.sort((a,b)=>compare(a.newTarget+'\0'+a.construction+'\0'+a.actualType,b.newTarget+'\0'+b.construction+'\0'+b.actualType));
  return {status:'complete',closure:{family:'tsfg.construction-storage-candidate',version:2,authorities:{...input.authorities},bodies,projections}};
}

/**
 * Cold projection validator: reconstruct all storage from the independently
 * admitted inputs. A candidate cannot assert extra routes, smaller capacities,
 * altered presence planes, tags, layouts or missing construction projections.
 * Raw/canonical wire decoding and authority digest checks remain the caller's
 * existing boundary; this is a typed module, not a replacement raw reader.
 * @param {ConstructionStorageInput} input @param {StorageClosure} candidate @param {Charge} charge
 * @returns {StorageResult}
 */
export function validateConstructionStorageClosure(input,candidate,charge) {
  const expected=solveConstructionStorageClosure(input,charge);
  if(expected.status!=='complete')return expected;
  // Compare the typed DTO directly: no whole-closure JSON strings, escaping or
  // canonical buffers. The existing caller owns raw exact-shape admission.
  // Charge BOTH string lengths before text comparison, including strings that
  // ultimately differ. Array visits are prepaid before traversing either side.
  /** @param {string|number|boolean|null|undefined} left @param {string|number|boolean|null|undefined} right */
  const scalar=(left,right)=>{
    charge(1+(typeof left==='string'?left.length:0)+(typeof right==='string'?right.length:0));
    return left===right;
  };
  /** @template T @param {readonly T[]} left @param {readonly T[]} right @param {(left:T,right:T)=>boolean} same */
  const array=(left,right,same)=>{
    charge(1);if(left.length!==right.length)return false;
    charge(left.length);return left.every((row,index)=>same(row,right[index]));
  };
  const wanted=expected.closure;
  charge(6);
  const equal=scalar(candidate.family,wanted.family)&&scalar(candidate.version,wanted.version)&&
    scalar(candidate.authorities.catalogue,wanted.authorities.catalogue)&&scalar(candidate.authorities.propertyKeys,wanted.authorities.propertyKeys)&&
    scalar(candidate.authorities.publication,wanted.authorities.publication)&&scalar(candidate.authorities.layouts,wanted.authorities.layouts)&&scalar(candidate.authorities.m12,wanted.authorities.m12)&&
    array(candidate.bodies,wanted.bodies,(body,other)=>{
      charge(8);
      return scalar(body.actualType,other.actualType)&&scalar(body.runtimeKey,other.runtimeKey)&&scalar(body.byteSize,other.byteSize)&&
        scalar(body.alignment,other.alignment)&&scalar(body.referenceCount,other.referenceCount)&&scalar(body.stateBytes,other.stateBytes)&&
        array(body.slots,other.slots,(slot,otherSlot)=>{
          charge(11);
          return scalar(slot.propertyIdentity,otherSlot.propertyIdentity)&&scalar(slot.offset,otherSlot.offset)&&scalar(slot.payloadOffset,otherSlot.payloadOffset)&&
            scalar(slot.byteSize,otherSlot.byteSize)&&scalar(slot.alignment,otherSlot.alignment)&&scalar(slot.referenceOffset,otherSlot.referenceOffset)&&
            scalar(slot.referenceCount,otherSlot.referenceCount)&&scalar(slot.stateBit,otherSlot.stateBit)&&array(slot.fields,otherSlot.fields,scalar)&&
            array(slot.alternatives,otherSlot.alternatives,(alternative,otherAlternative)=>{
              charge(6);
              return scalar(alternative.actualType,otherAlternative.actualType)&&scalar(alternative.layoutIdentity,otherAlternative.layoutIdentity)&&
                scalar(alternative.tag,otherAlternative.tag)&&scalar(alternative.byteOffset,otherAlternative.byteOffset)&&
                scalar(alternative.referenceOffset,otherAlternative.referenceOffset)&&scalar(alternative.referenceCount,otherAlternative.referenceCount);
            });
        })&&array(body.routes,other.routes,(route,otherRoute)=>{
          charge(8);
          return scalar(route.viewType,otherRoute.viewType)&&scalar(route.field,otherRoute.field)&&scalar(route.sourceField,otherRoute.sourceField)&&
            scalar(route.slot,otherRoute.slot)&&scalar(route.authority,otherRoute.authority)&&scalar(route.read,otherRoute.read)&&scalar(route.write,otherRoute.write)&&
            array(route.viaWitnesses,otherRoute.viaWitnesses,scalar);
        });
    })&&array(candidate.projections,wanted.projections,(projection,other)=>{
      charge(6);
      return scalar(projection.construction,other.construction)&&scalar(projection.owner,other.owner)&&scalar(projection.newTarget,other.newTarget)&&
        scalar(projection.actualType,other.actualType)&&scalar(projection.rights,other.rights)&&array(projection.fields,other.fields,(field,otherField)=>{
          charge(4);
          return scalar(field.field,otherField.field)&&scalar(field.slot,otherField.slot)&&scalar(field.ordinal,otherField.ordinal)&&scalar(field.declarationReadonly,otherField.declarationReadonly);
        });
    });
  if(!equal)return {status:'rejected',issues:['construction storage differs from independent fixed-closure reconstruction']};
  return expected;
}
