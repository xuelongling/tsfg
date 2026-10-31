// SPDX-License-Identifier: MIT
// Symbolic admitted-data projections, never verified Source/layout certificates.
import assert from 'node:assert/strict';
import {commonConstructionStorageProjection} from '../../../compiler/common-construction-storage-projection.mjs';
/** @typedef {import('../../../compiler/common-construction-storage-projection.mjs').ProjectionHir} ProjectionHir */
/** @typedef {import('../../../compiler/common-construction-storage-projection.mjs').ProjectionClosure} ProjectionClosure */
/** @typedef {import('../../../compiler/common-construction-storage-projection.mjs').ProjectionCharge} Charge */

/** @returns {{hir:ProjectionHir,storage:{status:'complete',closure:ProjectionClosure}}} */
export function constructionStorageProjectionFixture() {
  return {hir:{types:[{id:'U',kind:'value',runtimeKey:'runtime:U',fields:[{id:'u.f'}]},
    {id:'D',kind:'reference',runtimeKey:'runtime:D',fields:[{id:'d.g'}]},
    {id:'X',kind:'reference',runtimeKey:'runtime:X',fields:[{id:'x.g'}]},
    {id:'Missing',kind:'reference',runtimeKey:'runtime:Missing',fields:[{id:'missing.z'}]},
    {id:'Ref',kind:'reference',runtimeKey:'runtime:Ref',fields:[{id:'ref.h'}]},
    {id:'i32',kind:'scalar'},{id:'array',kind:'array'},{id:'span',kind:'readSpan'},{id:'text',kind:'string'},
    {id:'fn',kind:'function'},{id:'undefined',kind:'undefined'},{id:'null',kind:'null'},{id:'void',kind:'void'},
    {id:'unknown',kind:'unknown'},{id:'union',kind:'union'}]},
    storage:{status:'complete',closure:{authorities:{catalogue:'fixture:catalogue',propertyKeys:'fixture:property-keys',publication:'fixture:fixed-publication',layouts:'fixture:full-active-layouts',m12:'fixture:selected-real-pairs'},
      bodies:[{actualType:'U',runtimeKey:'runtime:U',slots:[
        {propertyIdentity:'property:f',fields:['u.f'],alternatives:[{actualType:'i32',layoutIdentity:'layout:i32'}]},
        {propertyIdentity:'property:g',fields:['d.g','x.g'],alternatives:[{actualType:'Ref',layoutIdentity:'layout:managed-Ref-full-root-map'}]}],
        // Alias X route comes first; representative choice is deterministic.
        routes:[{viewType:'X',field:'x.g',slot:1},{viewType:'U',field:'u.f',slot:0},{viewType:'D',field:'d.g',slot:1},{viewType:'Missing',field:'missing.z',slot:null}]}]}}};
}

/** @param {Charge} charge @returns {{status:'passed'}} */
export function checkConstructionStorageProjectionPureData(charge) {
  const fixture=constructionStorageProjectionFixture(),projected=commonConstructionStorageProjection(fixture.hir,fixture.storage,charge);
  assert.equal(projected.status,'complete');assert.ok(projected.status==='complete');
  const value=projected.actualType('U');
  assert.equal(value.kind,'value');assert.deepEqual(value.fields,[{id:'u.f',view:'U'},{id:'d.g',view:'D'}]);
  assert.equal(value.fields.length,2,'complete fixed physical closure includes D-added G, beyond U semantic own fields');
  assert.ok(!value.fields.some(field=>field.id==='u.g'),'do not fabricate a U semantic FieldId');
  assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.fields)&&value.fields.every(Object.isFrozen));
  const added=projected.projectField('U','D','field:d.g'),alias=projected.projectField('U','X','field:x.g');
  assert.equal(added,'storage-slot:U:property:g');assert.equal(alias,added,'overlapping aliases use the same physical slot');
  const own=projected.projectField('U','U','field:u.f');assert.notEqual(own,added,'distinct physical properties stay distinct');
  assert.deepEqual(projected.resolveField('U','Missing','field:missing.z'),{status:'missing'});
  assert.equal(projected.projectField('U','Missing','field:missing.z'),null,'only admitted missing routes return null');
  assert.throws(()=>projected.projectField('U','U','field:d.g'),{code:'r03-construction-storage-open'},'no identity-project fallback for unadmitted U.g view');
  assert.throws(()=>projected.projectField('Ref','Ref','field:ref.h'),{code:'r03-construction-storage-open'},'known reference kind does not manufacture missing field layout');
  assert.throws(()=>projected.projectField('U','U','fabricated:u.f'),{code:'r03-construction-storage-open'});
  assert.throws(()=>projected.actualType('unknown'),{code:'r03-construction-storage-open'});
  assert.throws(()=>projected.actualType('union'),{code:'r03-construction-storage-open'});
  assert.throws(()=>projected.actualType('not-owned'),{code:'r03-construction-storage-open'});
  for(const [id,kind] of [['Ref','reference'],['i32','scalar'],['array','array'],['span','readSpan'],['text','string'],['fn','function'],['undefined','undefined'],['null','null'],['void','void']]){
    charge(1);assert.deepEqual(projected.actualType(id),{kind,fields:[]},'non-value shapes preserve their real kind and do not inline-copy references');
  }
  assert.equal(projected.projectField('array','span','element'),'element');
  assert.throws(()=>projected.projectField('text','text','element'),{code:'r03-construction-storage-open'});
  const noBody={...fixture.storage,closure:{...fixture.storage.closure,bodies:[]}};
  assert.equal(commonConstructionStorageProjection(fixture.hir,noBody,charge).status,'open','value without fixed complete body cannot degrade to reference copy');
  const noRoutes={...fixture.storage,closure:{...fixture.storage.closure,bodies:fixture.storage.closure.bodies.map(body=>({...body,routes:body.routes.filter(route=>route.field!=='d.g'&&route.field!=='x.g')}))}};
  assert.equal(commonConstructionStorageProjection(fixture.hir,noRoutes,charge).status,'open','every physical value slot needs a real copy representative');
  const noLayout={...fixture.storage,closure:{...fixture.storage.closure,bodies:fixture.storage.closure.bodies.map(body=>({...body,slots:body.slots.map(slot=>({...slot,alternatives:slot.alternatives.map(alternative=>({...alternative,layoutIdentity:''}))}))}))}};
  assert.equal(commonConstructionStorageProjection(fixture.hir,noLayout,charge).status,'open');
  const noAuthority={...fixture.storage,closure:{...fixture.storage.closure,authorities:{...fixture.storage.closure.authorities,layouts:''}}};
  assert.equal(commonConstructionStorageProjection(fixture.hir,noAuthority,charge).status,'open');
  const forged={...fixture.storage,closure:{...fixture.storage.closure,bodies:fixture.storage.closure.bodies.map(body=>({...body,routes:body.routes.map(route=>route.field==='d.g'?{...route,viewType:'U'}:route)}))}};
  assert.equal(commonConstructionStorageProjection(fixture.hir,forged,charge).status,'rejected','copy privilege does not fabricate U.d.g source membership');
  assert.equal(commonConstructionStorageProjection(fixture.hir,null,charge).status,'open','no closure is not semantic-field or identity-copy fallback');
  assert.deepEqual(commonConstructionStorageProjection(fixture.hir,{status:'open',issues:['fixed payload upper unknown']},charge),{status:'open',issues:['fixed payload upper unknown']});
  // Snapshot callback tables before a caller later changes its mutable inputs.
  const isolated=constructionStorageProjectionFixture(),snapshot=commonConstructionStorageProjection(isolated.hir,isolated.storage,charge);
  assert.ok(snapshot.status==='complete');const sourceType=isolated.hir.types.find(type=>type.id==='U');assert.ok(sourceType);sourceType.kind='reference';
  const sourceRoute=isolated.storage.closure.bodies[0].routes.find(route=>route.field==='d.g');assert.ok(sourceRoute);sourceRoute.slot=null;
  assert.equal(snapshot.actualType('U').kind,'value');assert.equal(snapshot.projectField('U','D','field:d.g'),'storage-slot:U:property:g');
  return {status:'passed'};
}
