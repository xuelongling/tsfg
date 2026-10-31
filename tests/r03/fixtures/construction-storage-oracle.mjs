// SPDX-License-Identifier: MIT
// Minimal pure-data oracle for the new storage seam; not a language evaluator.
/** @typedef {import('../../../compiler/construction-storage.mjs').StorageClosure} StorageClosure */
/** @typedef {import('../../../compiler/construction-storage.mjs').Charge} Charge */
/** @typedef {{actualType:string,layoutIdentity:string,bits:string,roots:readonly string[]}} OraclePayload */
/** @typedef {{present:boolean,defined:boolean,value:OraclePayload|null}} OracleSlot */
/** @typedef {{id:string,actualType:string,runtimeKey:string,slots:readonly OracleSlot[]}} OracleObject */
/** @typedef {{id:string,object:string,projection:number,cursor:number}} OracleActivation */
/** @typedef {{objects:readonly OracleObject[],activations:readonly OracleActivation[]}} OracleState */
/** @typedef {{kind:'begin',id:string,object:string,projection:number}|{kind:'define',activation:string,field:string,value:OraclePayload}|{kind:'end',activation:string}|{kind:'abrupt',activation:string}|{kind:'write',object:string,route:number,sourceAssignmentProof:string,value:OraclePayload}} OracleEvent */
/** @typedef {{status:'ok',state:OracleState}|{status:'rejected',reason:string}} OracleResult */

/**
 * Starts an empty newly allocated object. External/existing objects must carry
 * their REAL presence/defined state across the adopting heap seam; never reset
 * them to nominal declarations or assume reserved slots already exist.
 * @param {StorageClosure} closure @param {string} actualType @param {string} id @param {Charge} charge
 * @returns {OracleObject|null}
 */
export function emptyStorageOracleObject(closure,actualType,id,charge) {
  charge(closure.bodies.length);const body=closure.bodies.find(row=>row.actualType===actualType);
  if(!body)return null;charge(body.slots.length);
  return {id,actualType,runtimeKey:body.runtimeKey,slots:body.slots.map(()=>({present:false,defined:false,value:null}))};
}

/**
 * Activation/frame authenticity and Source assignment proofs are independently
 * checked caller inputs. IDs here model fresh activation identities; this pure
 * oracle does not create rights from source ranges or reconstruct constructor CFG.
 * Rejected events leave the input untouched. Abrupt completion discards only
 * the cursor, keeping the already defined prefix and object identity.
 * @param {StorageClosure} closure @param {OracleState} state @param {OracleEvent} event @param {Charge} charge
 * @returns {OracleResult}
 */
export function stepConstructionStorageOracle(closure,state,event,charge) {
  charge(state.objects.length+state.activations.length+closure.bodies.length+1);
  if(new Set(state.objects.map(row=>row.id)).size!==state.objects.length||new Set(state.activations.map(row=>row.id)).size!==state.activations.length)
    return {status:'rejected',reason:'duplicate object/activation identity'};
  const activation='activation' in event?state.activations.find(row=>row.id===event.activation):undefined;
  const objectId='object' in event?event.object:activation?.object;
  const object=state.objects.find(row=>row.id===objectId),body=closure.bodies.find(row=>row.actualType===object?.actualType);
  if(!object||!body||object.runtimeKey!==body.runtimeKey||object.slots.length!==body.slots.length)return {status:'rejected',reason:'object/actual layout mismatch'};
  charge(object.slots.length);
  if(object.slots.some(slot=>slot.defined&&(!slot.present||slot.value===null)||!slot.defined&&slot.value!==null))return {status:'rejected',reason:'invalid slot state'};
  if(event.kind==='begin'){
    const projection=closure.projections[event.projection];
    if(!projection||projection.actualType!==object.actualType||state.activations.some(row=>row.id===event.id)||!event.id)
      return {status:'rejected',reason:'invalid or duplicate activation'};
    return {status:'ok',state:{objects:state.objects,activations:[...state.activations,{id:event.id,object:object.id,projection:event.projection,cursor:0}]}};
  }
  if(event.kind==='abrupt'){
    if(!activation)return {status:'rejected',reason:'unknown activation'};
    return {status:'ok',state:{objects:state.objects,activations:state.activations.filter(row=>row.id!==activation.id)}};
  }
  if(event.kind==='end'){
    const projection=activation&&closure.projections[activation.projection];
    if(!activation||!projection||activation.cursor!==projection.fields.length)return {status:'rejected',reason:'incomplete initialization'};
    return {status:'ok',state:{objects:state.objects,activations:state.activations.filter(row=>row.id!==activation.id)}};
  }
  /** @type {number|undefined} */ let index;
  if(event.kind==='define'){
    const projection=activation&&closure.projections[activation.projection],next=projection?.fields[activation?.cursor??-1];
    if(!activation||!next||next.field!==event.field||projection?.actualType!==object.actualType)return {status:'rejected',reason:'not the current own-field definition right'};
    index=next.slot;
  }else{
    const route=body.routes[event.route];
    if(!route||!event.sourceAssignmentProof||route.slot===null)return {status:'rejected',reason:'missing admitted source write route'};
    index=route.slot;
    // Ordinary writes do not define absent properties in this bounded seam.
    // Broader Source property-definition operations need a separate authority.
    if(!object.slots[index]?.present||!object.slots[index]?.defined)return {status:'rejected',reason:'ordinary write requires an existing defined property'};
  }
  const slot=body.slots[index];if(!slot)return {status:'rejected',reason:'unknown fixed slot'};
  charge(slot.alternatives.length+event.value.roots.length+1);
  const alternative=slot.alternatives.find(row=>row.actualType===event.value.actualType);
  if(!alternative||alternative.layoutIdentity!==event.value.layoutIdentity||event.value.roots.length>alternative.referenceCount)
    return {status:'rejected',reason:'payload not admitted by fixed slot bound'};
  // Bits are opaque logical bytes here. Full concrete validation/copy/active
  // root scanning belongs to the independently pinned layout consumer.
  const copied={...event.value,roots:[...event.value.roots]};
  const updated={...object,slots:object.slots.map((value,i)=>i===index?{present:true,defined:true,value:copied}:value)};
  return {status:'ok',state:{objects:state.objects.map(row=>row.id===object.id?updated:row),activations:state.activations.map(row=>event.kind==='define'&&row.id===event.activation?{...row,cursor:row.cursor+1}:row)}};
}

/**
 * Presence never reads payload storage. A missing property yields independent
 * undefined; present-but-uninitialized native storage is never read. A defined
 * undefined value remains observably present. Source read permission is still
 * a caller obligation, separate from this storage observation.
 * @param {StorageClosure} closure @param {OracleObject} object @param {number} routeIndex @param {Charge} charge
 * @returns {{kind:'missing',present:false}|{kind:'uninitialized',present:true}|{kind:'value',present:true,value:OraclePayload}|{kind:'rejected'}}
 */
export function observeConstructionStorageOracle(closure,object,routeIndex,charge) {
  charge(closure.bodies.length+1);const body=closure.bodies.find(row=>row.actualType===object.actualType),route=body?.routes[routeIndex];
  if(!body||!route||object.runtimeKey!==body.runtimeKey||object.slots.length!==body.slots.length)return {kind:'rejected'};
  const slot=route.slot===null?null:object.slots[route.slot];
  if(!slot||!slot.present)return slot?.defined?{kind:'rejected'}:{kind:'missing',present:false};
  if(!slot.defined)return slot.value===null?{kind:'uninitialized',present:true}:{kind:'rejected'};
  if(slot.value===null)return {kind:'rejected'};
  charge(slot.value.roots.length+1);return {kind:'value',present:true,value:{...slot.value,roots:[...slot.value.roots]}};
}

/**
 * Only present, defined active alternatives supply layout scans. The complete
 * concrete layout consumer must still validate nested tags and select the exact
 * active child/reference map; these snapshots are not a replacement collector.
 * @param {StorageClosure} closure @param {OracleObject} object @param {Charge} charge
 * @returns {{slot:number,layoutIdentity:string,roots:string[]}[]|null}
 */
export function activeConstructionStorageOracleLayouts(closure,object,charge) {
  charge(closure.bodies.length+object.slots.length+1);
  const body=closure.bodies.find(row=>row.actualType===object.actualType);
  if(!body||body.runtimeKey!==object.runtimeKey||body.slots.length!==object.slots.length)return null;
  /** @type {{slot:number,layoutIdentity:string,roots:string[]}[]} */ const active=[];
  for(const [index,slot] of object.slots.entries()){
    charge(1);if(!slot.present||!slot.defined){if(slot.value!==null||slot.defined)return null;continue;}
    if(slot.value===null)return null;
    const value=slot.value,storage=body.slots[index];charge(storage.alternatives.length+value.roots.length+1);
    const selected=storage.alternatives.find(row=>row.actualType===value.actualType);
    if(!selected||selected.layoutIdentity!==value.layoutIdentity||value.roots.length>selected.referenceCount)return null;
    active.push({slot:index,layoutIdentity:value.layoutIdentity,roots:[...value.roots]});
  }
  return active;
}

// Independent semantic expectations for Root's later pure-data harness. No
// expected byte offset is copied from the solver into these language assertions.
export const constructionStorageOracleRequirements=Object.freeze([
  {id:'replacement-identity',given:'B returns existing U; D defines own d',expect:'U id/runtimeKey/tag unchanged; d is present only after its definition'},
  {id:'overlap-property',given:'U.x and D.x share verified property identity',expect:'one slot; D definition replaces the value observed through both admitted routes'},
  {id:'absence-not-undefined',given:'reserved D.x has not executed; later definition commits undefined',expect:'first presence false; later presence true and value undefined'},
  {id:'readonly-activation',given:'D readonly definition runs on already defined U.x',expect:'legal current constructor activation may replace it; no permanent slot freeze'},
  {id:'abrupt-prefix',given:'first D field definition succeeds; later initializer language-fails',expect:'first field and U identity persist; later field remains absent; rights terminate'},
  {id:'cursor-right',given:'wrong field, repeated field, stale cursor or incomplete normal end',expect:'reject; no partial event commit'},
  {id:'fixed-upper',given:'body currently returns U; fixed published base result also includes V',expect:'D storage projections for U and V; body does not shrink capacity'},
  {id:'root-and-copy',given:'slot alternatives include nested inline value and reference',expect:'retain each complete layout identity; copy value bits/roots separately, preserve referenced identities'},
  {id:'unproved-authority',given:'unknown result/field upper, missing property identity, or absent B view',expect:'OPEN or rejected; never invent a member witness from names'},
  {id:'gc-active-only',given:'reserved slot has inactive reference alternative',expect:'presence/defined and active concrete tag guard root scanning; inactive roots are not live'}
]);
