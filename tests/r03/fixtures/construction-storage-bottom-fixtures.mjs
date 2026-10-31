// SPDX-License-Identifier: MIT
// Hand-authored never-normal/never-defined semantic expectations, not Source
// execution, accepted facts or a second general language evaluator. Not run by author.
import assert from 'node:assert/strict';
import {solveConstructionStorageClosure,validateConstructionStorageClosure} from '../../../compiler/construction-storage.mjs';
import {constructionStorageFixture} from './construction-storage-fixtures.mjs';
import {emptyStorageOracleObject,stepConstructionStorageOracle,observeConstructionStorageOracle,activeConstructionStorageOracleLayouts} from './construction-storage-oracle.mjs';
import {commonConstructionStorageProjection} from '../../../compiler/common-construction-storage-projection.mjs';
/** @typedef {import('../../../compiler/construction-storage.mjs').ConstructionStorageInput} Input */
/** @typedef {import('../../../compiler/construction-storage.mjs').FixedUpper} FixedUpper */
/** @typedef {import('../../../compiler/construction-storage.mjs').Charge} Charge */
/** @typedef {import('./construction-storage-oracle.mjs').OracleState} OracleState */
/** @typedef {import('./construction-storage-oracle.mjs').OracleResult} OracleResult */
/** @typedef {import('../../../compiler/common-construction-storage-projection.mjs').ProjectionClosure} ProjectionClosure */

/** @param {readonly string[]} actualTypes @returns {FixedUpper} */
const fixed=actualTypes=>({complete:true,unknown:false,proof:'fixture:fixed-whole-closure-bottom-authority',actualTypes});
/** @param {OracleResult} result @returns {OracleState} */
function accepted(result){assert.ok(result.status==='ok');return result.state;}

/**
 * Language witness: Base has one successful own definition, then its body leaks
 * this and throws on every path. `new Derived()` never completes Base normally,
 * but the fresh dynamic Derived object and committed Base field can escape.
 * @returns {Input}
 */
export function neverNormalBaseFixture() {
  const input=constructionStorageFixture();
  return {...input,results:input.results.map(row=>({...row,resultUpper:fixed([])}))};
}

/**
 * Language witness: B returns existing U. D binds it, defines its own fields,
 * leaks that U and always throws from its body. E extends D. D has no normal
 * result, so E never binds/initializes, while D's earlier work on U persists.
 * @returns {Input}
 */
export function neverNormalDerivedFixture() {
  const input=constructionStorageFixture();
  return {...input,classes:[...input.classes,{id:'E',base:'D',runtimeKey:'runtime:E',fields:['e.h'],construction:'E.ctor'}],
    fields:[...input.fields,{id:'e.h',owner:'E',propertyIdentity:'property:h',readonly:false,upper:fixed(['i32'])}],
    properties:[...input.properties,{id:'property:h',key:'verified-string-key:h'}],
    constructions:[...input.constructions,{id:'E.ctor',owner:'E',initializationFields:['e.h']}],newTargets:['E'],
    results:[{construction:'B.ctor',newTarget:'E',resultUpper:fixed(['U'])},{construction:'D.ctor',newTarget:'E',resultUpper:fixed([])},{construction:'E.ctor',newTarget:'E',resultUpper:fixed([])}]};
}

/**
 * Language witness: U.ready initializes, then the initializer for U.never
 * always throws before defining its property. U has no normal result. The
 * fixed field bound permits NO defined payload for never, including undefined.
 * @returns {Input}
 */
export function neverDefinedFieldFixture() {
  const input=constructionStorageFixture();
  return {...input,classes:[{id:'U',base:null,runtimeKey:'runtime:U',fields:['u.ready','u.never'],construction:'U.ctor'}],
    fields:[{id:'u.ready',owner:'U',propertyIdentity:'property:ready',readonly:false,upper:fixed(['i32'])},
      {id:'u.never',owner:'U',propertyIdentity:'property:never',readonly:true,upper:fixed([])}],
    properties:[{id:'property:ready',key:'verified-string-key:ready'},{id:'property:never',key:'verified-string-key:never'}],
    constructions:[{id:'U.ctor',owner:'U',initializationFields:['u.ready','u.never']}],newTargets:['U'],
    results:[{construction:'U.ctor',newTarget:'U',resultUpper:fixed([])}],views:[],selectedWitnesses:[],
    payloads:input.payloads.filter(row=>row.id==='i32'||row.id==='undefined')};
}

/** @param {Charge} charge @returns {{status:'passed'}} */
export function checkNeverNormalBase(charge) {
  const input=neverNormalBaseFixture(),solved=solveConstructionStorageClosure(input,charge);
  assert.ok(solved.status==='complete','proved never-normal base upper is closed Bottom, not unknown/OPEN');
  const closure=solved.closure,base=closure.projections.findIndex(row=>row.owner==='B'&&row.actualType==='D');
  assert.ok(base>=0,'base still allocates/initializes the dynamic newTarget D');
  assert.ok(!closure.projections.some(row=>row.owner==='D'),'no normal base output can bind a Derived receiver');
  const object=emptyStorageOracleObject(closure,'D','leaked-from-throwing-base',charge);assert.ok(object);
  /** @type {OracleState} */ let state={objects:[object],activations:[]};
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'begin',id:'base-activation',object:object.id,projection:base},charge));
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'base-activation',field:'b.x',value:{actualType:'i32',layoutIdentity:'layout:i32',bits:'07000000',roots:[]}},charge));
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'end',activation:'base-activation'},charge));
  const body=closure.bodies.find(row=>row.actualType==='D');assert.ok(body);
  const prefix=body.routes.findIndex(row=>row.viewType==='B'&&row.field==='b.x'),derived=body.routes.findIndex(row=>row.viewType==='D'&&row.field==='d.y');
  const committed=observeConstructionStorageOracle(closure,state.objects[0],prefix,charge);
  assert.ok(committed.kind==='value'&&committed.value.bits==='07000000','escaped Base prefix is not rolled back by later body throw');
  assert.deepEqual(observeConstructionStorageOracle(closure,state.objects[0],derived,charge),{kind:'missing',present:false},'unexecuted Derived definition is not present');
  assert.equal(state.objects[0].id,'leaked-from-throwing-base');assert.equal(state.objects[0].actualType,'D');
  assert.equal(validateConstructionStorageClosure(input,closure,charge).status,'complete');
  return {status:'passed'};
}

/** @param {Charge} charge @returns {{status:'passed'}} */
export function checkNeverNormalDerived(charge) {
  const input=neverNormalDerivedFixture(),solved=solveConstructionStorageClosure(input,charge);
  assert.ok(solved.status==='complete','proved never-normal Derived result is closed Bottom');
  const closure=solved.closure,derived=closure.projections.findIndex(row=>row.owner==='D'&&row.actualType==='U');
  assert.ok(closure.projections.some(row=>row.owner==='B'&&row.actualType==='E'),'base allocation retains outer newTarget E');
  assert.ok(derived>=0,'D binding/own initialization precedes its always-throwing body');
  assert.ok(!closure.projections.some(row=>row.owner==='E'),'E gets no bind/owninit from D Bottom');
  const body=closure.bodies.find(row=>row.actualType==='U');assert.ok(body);
  assert.ok(!body.slots.some(slot=>slot.propertyIdentity==='property:h'),'never-selected E does not add its slot to replacement U');
  const object=emptyStorageOracleObject(closure,'U','existing-replacement-U',charge);assert.ok(object);
  /** @type {OracleState} */ let state={objects:[object],activations:[]};
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'begin',id:'D-before-throw',object:object.id,projection:derived},charge));
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'D-before-throw',field:'d.x',value:{actualType:'ref:U',layoutIdentity:'layout:ref-U',bits:'',roots:['referenced-object']}},charge));
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'D-before-throw',field:'d.y',value:{actualType:'undefined',layoutIdentity:'layout:undefined',bits:'',roots:[]}},charge));
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'end',activation:'D-before-throw'},charge));
  const y=body.routes.findIndex(row=>row.viewType==='D'&&row.field==='d.y'),observed=observeConstructionStorageOracle(closure,state.objects[0],y,charge);
  assert.ok(observed.kind==='value'&&observed.present&&observed.value.actualType==='undefined','D effects persist despite no normal result');
  assert.equal(state.objects[0].id,'existing-replacement-U');assert.equal(state.objects[0].actualType,'U');
  return {status:'passed'};
}

/** @param {Charge} charge @returns {{status:'passed'}} */
export function checkNeverDefinedField(charge) {
  const input=neverDefinedFieldFixture(),solved=solveConstructionStorageClosure(input,charge);
  assert.ok(solved.status==='complete','proved no-defined-payload field still has a closed fixed property slot');
  const closure=solved.closure,body=closure.bodies.find(row=>row.actualType==='U');assert.ok(body);
  const slot=body.slots.findIndex(row=>row.propertyIdentity==='property:never');assert.ok(slot>=0);
  assert.deepEqual(body.slots[slot].alternatives,[],'do not synthesize undefined or declared-type payload');assert.equal(body.slots[slot].referenceCount,0);
  const neverRoute=body.routes.findIndex(row=>row.viewType==='U'&&row.field==='u.never'),readyRoute=body.routes.findIndex(row=>row.viewType==='U'&&row.field==='u.ready');
  assert.equal(body.routes[neverRoute].slot,slot,'reserved Bottom property is not structurally missing');
  const object=emptyStorageOracleObject(closure,'U','escaped-before-never-definition',charge);assert.ok(object);
  assert.equal(object.slots[slot].present,false);assert.equal(object.slots[slot].defined,false);
  const projection=closure.projections.findIndex(row=>row.owner==='U'&&row.actualType==='U');assert.ok(projection>=0);
  /** @type {OracleState} */ let state={objects:[object],activations:[]};
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'begin',id:'U-activation',object:object.id,projection},charge));
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'U-activation',field:'u.ready',value:{actualType:'i32',layoutIdentity:'layout:i32',bits:'09000000',roots:[]}},charge));
  for(const value of [{actualType:'i32',layoutIdentity:'layout:i32',bits:'01000000',roots:[]},{actualType:'undefined',layoutIdentity:'layout:undefined',bits:'',roots:[]}]){
    charge(1);assert.equal(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'U-activation',field:'u.never',value},charge).status,'rejected','Bottom field cannot commit any payload, including undefined');
  }
  assert.equal(stepConstructionStorageOracle(closure,state,{kind:'end',activation:'U-activation'},charge).status,'rejected','cannot invent successful normal initialization');
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'abrupt',activation:'U-activation'},charge));
  assert.deepEqual(observeConstructionStorageOracle(closure,state.objects[0],neverRoute,charge),{kind:'missing',present:false});
  const ready=observeConstructionStorageOracle(closure,state.objects[0],readyRoute,charge);assert.ok(ready.kind==='value'&&ready.value.bits==='09000000');
  const active=activeConstructionStorageOracleLayouts(closure,state.objects[0],charge);assert.ok(active&&!active.some(row=>row.slot===slot),'Bottom slot supplies no active layout/root');
  assert.equal(validateConstructionStorageClosure(input,closure,charge).status,'complete');
  return {status:'passed'};
}

/** @param {Charge} charge @returns {{status:'passed'}} */
export function checkBottomUnknownAndMissing(charge) {
  const base=neverNormalBaseFixture();
  const unknown={...base,results:base.results.map(row=>row.construction==='B.ctor'?{...row,resultUpper:{...row.resultUpper,unknown:true}}:row)};
  assert.equal(solveConstructionStorageClosure(unknown,charge).status,'open','opaque empty upper is not proved Bottom');
  assert.equal(solveConstructionStorageClosure({...base,results:base.results.filter(row=>row.construction!=='B.ctor')},charge).status,'open','missing fixed result is not Bottom');
  const field=neverDefinedFieldFixture();
  for(const upper of [{...fixed([]),complete:false},{...fixed([]),unknown:true},{...fixed([]),proof:''}]){
    charge(1);assert.equal(solveConstructionStorageClosure({...field,fields:field.fields.map(row=>row.id==='u.never'?{...row,upper}:row)},charge).status,'open');
  }
  return {status:'passed'};
}

/** @param {Charge} charge @returns {{status:'passed'}} */
export function checkBottomCopyProjection(charge) {
  // This is a hand-authored *admitted closure projection*, not a claim that the
  // current reference-only Source layout adapter already constructs value U.
  /** @type {ProjectionClosure} */ const closure={authorities:{catalogue:'fixture:catalogue',propertyKeys:'fixture:properties',publication:'fixture:proved-bottom',layouts:'fixture:full-layout-authority',m12:'fixture:selected'},
    bodies:[{actualType:'U',runtimeKey:'runtime:U',slots:[{propertyIdentity:'property:never',fields:['u.never'],alternatives:[]}],routes:[{viewType:'U',field:'u.never',slot:0}]}]};
  const hir={types:[{id:'U',kind:'value',runtimeKey:'runtime:U',fields:[{id:'u.never'}]}]},projected=commonConstructionStorageProjection(hir,{status:'complete',closure},charge);
  assert.ok(projected.status==='complete','proved Bottom physical slot is not missing layout authority');
  assert.deepEqual(projected.actualType('U'),{kind:'value',fields:[{id:'u.never',view:'U'}]},'copy must preserve reserved property/presence metadata');
  assert.equal(projected.projectField('U','U','field:u.never'),'storage-slot:U:property:never','Bottom property is not missing(null)');
  assert.equal(commonConstructionStorageProjection(hir,{status:'complete',closure:{...closure,authorities:{...closure.authorities,layouts:''}}},charge).status,'open','Bottom does not hide genuinely missing full authority');
  return {status:'passed'};
}
