// SPDX-License-Identifier: MIT
// Read-only internal copy/address projection from admitted fixed storage.
// This module owns no Source assignability, member, method or private permission.

/** @typedef {(units:number)=>void} ProjectionCharge */
/** @typedef {{id:string,kind:string,base?:string,runtimeKey?:string,fields?:readonly {id:string}[]}} ProjectionType */
/** @typedef {{types:readonly ProjectionType[]}} ProjectionHir */
/** @typedef {{propertyIdentity:string,fields:readonly string[],alternatives:readonly {actualType:string,layoutIdentity:string}[]}} ProjectionSlot */
/** @typedef {{viewType:string,field:string,slot:number|null}} ProjectionRoute */
/** @typedef {{actualType:string,runtimeKey:string,slots:readonly ProjectionSlot[],routes:readonly ProjectionRoute[]}} ProjectionBody */
/** @typedef {{authorities:{catalogue:string,propertyKeys:string,publication:string,layouts:string,m12:string},bodies:readonly ProjectionBody[]}} ProjectionClosure */
/** @typedef {{status:'complete',closure:ProjectionClosure}|{status:'open'|'rejected',issues:readonly string[]}} ProjectionStorage */
/** @typedef {{id:string,view:string}} CopyField */
/** @typedef {{kind:string,fields:readonly CopyField[]}} ActualCopyShape */
/** @typedef {{status:'present',key:string}|{status:'missing'}|{status:'open',issues:readonly string[]}} FieldResolution */
/** @typedef {{status:'complete',actualType:(type:string)=>ActualCopyShape,projectField:(actual:string,view:string,selector:string)=>string|null,resolveField:(actual:string,view:string,selector:string)=>FieldResolution}|{status:'open'|'rejected',issues:string[]}} ProjectionResult */
/** @typedef {{kind:string,base:string|undefined,runtimeKey:string|undefined,fields:Set<string>}} OwnedProjectionType */
/** @typedef {{routes:Map<string,FieldResolution>,representatives:readonly CopyField[]}} OwnedProjectionBody */

/**
 * Precondition: the caller independently admitted the complete owned HIR and
 * this solver closure against the SAME catalogue/publication/property/layout/
 * M12 authorities. `status:'complete'` is an internal typed solver result, not a
 * caller-asserted raw certificate. This adapter checks its joins and snapshots
 * only the data needed by return-origin copy/address callbacks.
 * A value copy enumerates physical slots, not semantic own fields. Its internal
 * representative is a REAL FieldId plus admitted view, never a made-up U field.
 * Missing value layout/route/authority returns OPEN before callbacks escape.
 * Unknown requests throw code r03-construction-storage-open; callers must not
 * catch that error and silently turn value-copy into identity/reference copy.
 * @param {ProjectionHir} hir @param {ProjectionStorage|null|undefined} storage @param {ProjectionCharge} charge
 * @returns {ProjectionResult}
 */
export function commonConstructionStorageProjection(hir,storage,charge) {
  charge(1);if(!storage)return {status:'open',issues:['missing admitted fixed storage closure']};
  if(storage.status!=='complete'){charge(storage.issues.length+1);return {status:storage.status,issues:[...storage.issues]};}
  const closure=storage.closure;
  /** @type {string[]} */ const invalid=[];
  /** @type {string[]} */ const unavailable=[];
  /** @param {string} prefix @param {string} value */
  const issue=(prefix,value)=>{charge(prefix.length+value.length+1);return prefix+value;};
  /** @param {string} left @param {string} right */
  const same=(left,right)=>{charge(left.length+right.length+1);return left===right;};
  /** @param {string} left @param {string} right */
  const before=(left,right)=>{charge(left.length+right.length+1);return left<right;};
  /** @param {string} view @param {string} field */
  const routeKey=(view,field)=>{charge(view.length+field.length+1);return view+'/'+field;};
  /** @param {string} message @returns {never} */
  const open=message=>{
    charge(message.length+64);
    throw Object.assign(new TypeError('construction storage projection OPEN: '+message),{code:'r03-construction-storage-open',status:'open'});
  };
  charge(5);
  for(const identity of [closure.authorities.catalogue,closure.authorities.propertyKeys,closure.authorities.publication,closure.authorities.layouts,closure.authorities.m12]){
    charge(identity.length+1);if(!identity)unavailable.push('missing independently admitted storage authority');
  }
  /** @type {Map<string,OwnedProjectionType>} */ const types=new Map();
  /** @type {Set<string>} */ const fields=new Set();
  charge(hir.types.length);
  for(const type of hir.types){charge(type.id.length+type.kind.length+1);
    if(types.has(type.id))invalid.push(issue('duplicate owned type: ',type.id));
    /** @type {Set<string>} */ const ownFields=new Set();charge(type.fields?.length??0);
    for(const field of type.fields??[]){charge(field.id.length+1);if(fields.has(field.id))invalid.push(issue('duplicate owned field: ',field.id));fields.add(field.id);ownFields.add(field.id);}
    charge((type.base?.length??0)+(type.runtimeKey?.length??0)+1);
    types.set(type.id,{kind:type.kind,base:type.base,runtimeKey:type.runtimeKey,fields:ownFields});
  }
  /** @type {Map<string,Set<string>>} */ const viewFields=new Map();
  for(const [id] of types){charge(1);
    /** @type {Set<string>} */ const members=new Set();
    /** @type {Set<string>} */ const seen=new Set();let current=id;
    while(true){charge(current.length+1);const type=types.get(current);
      if(!type){invalid.push(issue('base outside owned catalogue: ',current));break;}
      if(seen.has(current)){invalid.push(issue('owned inheritance cycle: ',current));break;}seen.add(current);
      charge(type.fields.size);for(const field of type.fields)members.add(field);
      if(type.base===undefined)break;current=type.base;
    }
    viewFields.set(id,members);
  }
  /** @type {Map<string,OwnedProjectionBody>} */ const bodies=new Map();
  charge(closure.bodies.length);
  for(const body of closure.bodies){charge(body.actualType.length+body.runtimeKey.length+1);
    const actual=types.get(body.actualType);
    if(!actual){invalid.push(issue('body outside owned catalogue: ',body.actualType));continue;}
    if(actual.kind!=='reference'&&actual.kind!=='value'){invalid.push(issue('nominal body has nonnominal actual kind: ',body.actualType));continue;}
    if(bodies.has(body.actualType)){invalid.push(issue('duplicate actual storage body: ',body.actualType));continue;}
    if(!actual.runtimeKey||!body.runtimeKey){unavailable.push(issue('missing actual runtime identity: ',body.actualType));continue;}
    if(!same(actual.runtimeKey,body.runtimeKey)){invalid.push(issue('actual runtime identity mismatch: ',body.actualType));continue;}
    /** @type {Map<string,number>} */ const physicalFields=new Map();
    /** @type {Set<string>} */ const properties=new Set();
    /** @type {(CopyField|undefined)[]} */ const representatives=[];
    /** @type {string[]} */ const physicalKeys=[];
    charge(body.slots.length);
    for(const [index,slot] of body.slots.entries()){charge(slot.propertyIdentity.length+1);
      if(!slot.propertyIdentity)unavailable.push(issue('missing property identity in body: ',body.actualType));
      if(properties.has(slot.propertyIdentity))invalid.push(issue('split physical property identity in body: ',body.actualType));properties.add(slot.propertyIdentity);
      // The existing verified identity, not a new hash/member witness. Actual
      // TypeIds have their admitted complete fixed width; this key is opaque
      // and used ONLY for equality by the return-origin domain.
      charge(body.actualType.length+slot.propertyIdentity.length+14);
      physicalKeys.push('storage-slot:'+body.actualType+':'+slot.propertyIdentity);representatives.push(undefined);
      charge(slot.fields.length+slot.alternatives.length);
      for(const field of slot.fields){charge(field.length+1);
        if(!fields.has(field))invalid.push(issue('physical alias outside owned FieldIds: ',field));
        if(physicalFields.has(field)&&physicalFields.get(field)!==index)invalid.push(issue('FieldId split across physical slots: ',field));physicalFields.set(field,index);
      }
      // The admitted solver may prove Bottom: a reserved property/state slot
      // with no active payload alternatives. Its real field/view copy route
      // remains necessary. Missing authority is checked independently above.
      for(const alternative of slot.alternatives){charge(alternative.actualType.length+alternative.layoutIdentity.length+1);
        if(!types.has(alternative.actualType))invalid.push(issue('layout tag outside owned catalogue: ',alternative.actualType));
        if(!alternative.layoutIdentity)unavailable.push(issue('missing full concrete layout identity: ',alternative.actualType));
      }
    }
    /** @type {Map<string,FieldResolution>} */ const routes=new Map();charge(body.routes.length);
    for(const route of body.routes){charge(route.viewType.length+route.field.length+1);
      if(!types.has(route.viewType)||!viewFields.get(route.viewType)?.has(route.field)){invalid.push(issue('route is not an owned view/FieldId pair: ',route.field));continue;}
      const key=routeKey(route.viewType,route.field);
      if(routes.has(key)){invalid.push(issue('duplicate physical field route: ',route.field));continue;}
      if(route.slot===null){
        if(physicalFields.has(route.field))invalid.push(issue('missing route contradicts physical alias: ',route.field));
        routes.set(key,Object.freeze({status:'missing'}));continue;
      }
      if(!Number.isSafeInteger(route.slot)||route.slot<0||route.slot>=body.slots.length||physicalFields.get(route.field)!==route.slot){invalid.push(issue('route does not select its verified physical slot: ',route.field));continue;}
      routes.set(key,Object.freeze({status:'present',key:physicalKeys[route.slot]}));
      const previous=representatives[route.slot];
      if(!previous||before(route.viewType,previous.view)||(same(route.viewType,previous.view)&&before(route.field,previous.id))){
        charge(2);representatives[route.slot]=Object.freeze({id:route.field,view:route.viewType});
      }
    }
    /** @type {CopyField[]} */ const complete=[];charge(representatives.length);
    for(const representative of representatives){charge(1);
      if(!representative)unavailable.push(issue('physical slot lacks a real field/view copy representative: ',body.actualType));else complete.push(representative);
    }
    bodies.set(body.actualType,{routes,representatives:Object.freeze(complete)});
  }
  /** @type {Map<string,ActualCopyShape>} */ const shapes=new Map();
  charge(9);const leafKinds=new Set(['reference','array','string','function','readSpan','scalar','null','undefined','void']);
  for(const [id,type] of types){charge(id.length+type.kind.length+1);
    if(type.kind==='value'){
      const body=bodies.get(id);
      if(!body){unavailable.push(issue('value has no complete fixed storage body: ',id));continue;}
      shapes.set(id,Object.freeze({kind:type.kind,fields:body.representatives}));
    }else if(leafKinds.has(type.kind))shapes.set(id,Object.freeze({kind:type.kind,fields:Object.freeze([])}));
  }
  if(invalid.length){charge(invalid.length);return {status:'rejected',issues:[...invalid]};}
  if(unavailable.length){charge(unavailable.length);return {status:'open',issues:[...unavailable]};}
  /** @param {string} id @returns {ActualCopyShape} */
  const actualType=id=>{charge(id.length+1);const shape=shapes.get(id);if(!shape)open(issue('unknown, unsupported or nonconcrete actual kind: ',id));return shape;};
  /** @param {string} actual @param {string} view @param {string} selector @returns {FieldResolution} */
  const resolveField=(actual,view,selector)=>{
    charge(actual.length+view.length+selector.length+1);const type=types.get(actual),target=types.get(view);
    if(!type||!target)return {status:'open',issues:[issue('field request lacks an owned actual/view type: ',actual)]};
    if(selector==='element'){
      if((type.kind==='array'||type.kind==='readSpan')&&(target.kind==='array'||target.kind==='readSpan'))return {status:'present',key:'element'};
      return {status:'open',issues:[issue('element projection lacks admitted container representation: ',actual)]};
    }
    if(!selector.startsWith('field:'))return {status:'open',issues:['unsupported field selector format']};
    charge(selector.length);const field=selector.slice(6),body=bodies.get(actual);
    if(!body)return {status:'open',issues:[issue('field request has no complete fixed storage body: ',actual)]};
    const selected=body.routes.get(routeKey(view,field));
    return selected??{status:'open',issues:[issue('field request has no admitted physical route: ',field)]};
  };
  /** @param {string} actual @param {string} view @param {string} selector */
  const projectField=(actual,view,selector)=>{
    const result=resolveField(actual,view,selector);
    if(result.status==='open')open(result.issues[0]);
    return result.status==='present'?result.key:null;
  };
  return {status:'complete',actualType,projectField,resolveField};
}
