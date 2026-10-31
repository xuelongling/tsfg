// SPDX-License-Identifier: MIT
// Hand-authored pure-data vectors. Symbolic identities are fixture identities,
// never fabricated Source packets or accepted M12 witnesses. Not author-run.
import {solveConstructionStorageClosure,validateConstructionStorageClosure} from '../../../compiler/construction-storage.mjs';
import {emptyStorageOracleObject,stepConstructionStorageOracle,observeConstructionStorageOracle,activeConstructionStorageOracleLayouts} from './construction-storage-oracle.mjs';
/** @typedef {import('../../../compiler/construction-storage.mjs').ConstructionStorageInput} Input */
/** @typedef {import('../../../compiler/construction-storage.mjs').FixedUpper} FixedUpper */
/** @typedef {import('../../../compiler/construction-storage.mjs').Charge} Charge */
/** @typedef {import('./construction-storage-oracle.mjs').OracleState} OracleState */
/** @typedef {import('./construction-storage-oracle.mjs').OraclePayload} OraclePayload */
/** @typedef {import('./construction-storage-oracle.mjs').OracleResult} OracleResult */
/** @param {readonly string[]} actualTypes @returns {FixedUpper} */
const upper=actualTypes=>({complete:true,unknown:false,proof:'fixture:independent-fixed-publication',actualTypes});

/** @returns {Input} */
export function constructionStorageFixture() {
  return {authorities:{catalogue:'fixture:catalogue',propertyKeys:'fixture:property-keys',publication:'fixture:publication',layouts:'fixture:concrete-layouts',m12:'fixture:selected-m12'},unresolved:[],
    classes:[{id:'B',base:null,runtimeKey:'runtime:B',fields:['b.x'],construction:'B.ctor'},
      {id:'D',base:'B',runtimeKey:'runtime:D',fields:['d.y','d.x'],construction:'D.ctor'},
      {id:'U',base:null,runtimeKey:'runtime:U',fields:['u.x'],construction:'U.ctor'},
      {id:'V',base:null,runtimeKey:'runtime:V',fields:['v.x'],construction:'V.ctor'}],
    fields:[{id:'b.x',owner:'B',propertyIdentity:'property:x',readonly:false,upper:upper(['i32'])},
      {id:'d.x',owner:'D',propertyIdentity:'property:x',readonly:true,upper:upper(['ref:U','inline:Pair'])},
      {id:'d.y',owner:'D',propertyIdentity:'property:y',readonly:true,upper:upper(['i32','undefined'])},
      {id:'u.x',owner:'U',propertyIdentity:'property:x',readonly:true,upper:upper(['i32'])},
      {id:'v.x',owner:'V',propertyIdentity:'property:x',readonly:false,upper:upper(['i32'])}],
    properties:[{id:'property:x',key:'verified-string-key:x'},{id:'property:y',key:'verified-string-key:y'}],
    constructions:[{id:'B.ctor',owner:'B',initializationFields:['b.x']},{id:'D.ctor',owner:'D',initializationFields:['d.x','d.y']},
      {id:'U.ctor',owner:'U',initializationFields:['u.x']},{id:'V.ctor',owner:'V',initializationFields:['v.x']}],
    newTargets:['D'],results:[{construction:'B.ctor',newTarget:'D',resultUpper:upper(['U','V'])},{construction:'D.ctor',newTarget:'D',resultUpper:upper(['U','V'])}],
    views:[{actualType:'U',targetType:'B',fields:[{source:'u.x',target:'b.x'}]},{actualType:'V',targetType:'B',fields:[{source:'v.x',target:'b.x'}]}],selectedWitnesses:[],
    payloads:[{id:'i32',kind:'inline',byteSize:4,alignment:4,referenceCount:0,layoutIdentity:'layout:i32'},
      {id:'undefined',kind:'absence',byteSize:0,alignment:1,referenceCount:0,layoutIdentity:'layout:undefined'},
      {id:'ref:U',kind:'reference',byteSize:8,alignment:8,referenceCount:1,layoutIdentity:'layout:ref-U'},
      {id:'inline:Pair',kind:'inline',byteSize:24,alignment:8,referenceCount:2,layoutIdentity:'layout:nested-Pair-full-variants-and-children'}]};
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function expect(condition,message){if(!condition)throw new TypeError('construction-storage-fixture: '+message);}
/** @param {OracleResult} result @returns {OracleState} */
function accepted(result){expect(result.status==='ok','unexpected storage event rejection');return result.state;}

/**
 * A future Root caller may run ONLY this pure-data harness under its separately
 * established authorization. It imports no Source/SUT/compiler/heap entrypoints.
 * `charge` is mandatory; this does not reset the real solver's work budget.
 * @param {Charge} charge @returns {{status:'passed'}}
 */
export function checkConstructionStoragePureData(charge) {
  const input=constructionStorageFixture(),solved=solveConstructionStorageClosure(input,charge);
  expect(solved.status==='complete','fixed fixture closure should be complete');const closure=solved.closure;
  const body=closure.bodies.find(row=>row.actualType==='U');expect(body,'U body');
  expect(body.slots.length===2,'one slot per property key, not per declaring FieldId');
  const x=body.slots.find(row=>row.propertyIdentity==='property:x');expect(x,'x slot');
  expect(x.fields.includes('u.x')&&x.fields.includes('d.x')&&x.fields.includes('b.x'),'overlapping nominal, constructor and M12 aliases');
  expect(x.referenceCount===2&&x.alternatives.some(row=>row.actualType==='inline:Pair'&&row.layoutIdentity==='layout:nested-Pair-full-variants-and-children'),'retain full nested layout identity/max roots');
  expect(closure.projections.some(row=>row.owner==='D'&&row.actualType==='V'),'fixed published V alternative retained');
  expect(closure.projections.some(row=>row.owner==='B'&&row.actualType==='D'),'base allocation uses newTarget D');
  const projection=closure.projections.findIndex(row=>row.owner==='D'&&row.actualType==='U');expect(projection>=0,'D initializes existing U');
  const ux=body.routes.findIndex(row=>row.viewType==='U'&&row.field==='u.x'),dx=body.routes.findIndex(row=>row.viewType==='D'&&row.field==='d.x'),dy=body.routes.findIndex(row=>row.viewType==='D'&&row.field==='d.y');
  expect(ux>=0&&dx>=0&&dy>=0,'read routes');
  expect(body.routes.some(row=>row.viewType==='D'&&row.field==='b.x'),'inherited access retains admitted B view');
  const empty=emptyStorageOracleObject(closure,'U','existing-U',charge);expect(empty,'new oracle object');
  expect(activeConstructionStorageOracleLayouts(closure,empty,charge)?.length===0,'reserved inactive reference slots supply no scan');
  const xIndex=body.routes[ux].slot;expect(xIndex!==null,'existing U.x slot');
  /** @type {OraclePayload} */ const old={actualType:'i32',layoutIdentity:'layout:i32',bits:'07000000',roots:[]};
  const existing={...empty,slots:empty.slots.map((slot,index)=>index===xIndex?{present:true,defined:true,value:old}:slot)};
  expect(observeConstructionStorageOracle(closure,existing,dy,charge).kind==='missing','reserved D.y is not present');
  /** @type {OracleState} */ let state={objects:[existing],activations:[]};
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'begin',id:'activation:D:1',object:'existing-U',projection},charge));
  expect(stepConstructionStorageOracle(closure,state,{kind:'end',activation:'activation:D:1'},charge).status==='rejected','normal end cannot skip definitions');
  expect(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'activation:D:1',field:'d.y',value:old},charge).status==='rejected','definition cursor is ordered');
  /** @type {OraclePayload} */ const reference={actualType:'ref:U',layoutIdentity:'layout:ref-U',bits:'',roots:['object:shared-reference']};
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'activation:D:1',field:'d.x',value:reference},charge));
  const own=observeConstructionStorageOracle(closure,state.objects[0],dx,charge),alias=observeConstructionStorageOracle(closure,state.objects[0],ux,charge);
  expect(own.kind==='value'&&alias.kind==='value'&&own.value.actualType==='ref:U'&&alias.value.roots[0]==='object:shared-reference','constructor overwrites the same property, including prior readonly declaration');
  expect(state.objects[0].id==='existing-U'&&state.objects[0].actualType==='U'&&state.objects[0].runtimeKey==='runtime:U','preserve receiver identity/tag');
  const active=activeConstructionStorageOracleLayouts(closure,state.objects[0],charge);
  expect(active?.length===1&&active[0].layoutIdentity==='layout:ref-U'&&active[0].roots[0]==='object:shared-reference','only active concrete reference layout supplies roots');
  expect(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'activation:D:1',field:'d.x',value:reference},charge).status==='rejected','cannot consume own-field right twice');
  const interrupted=accepted(stepConstructionStorageOracle(closure,state,{kind:'abrupt',activation:'activation:D:1'},charge));
  expect(observeConstructionStorageOracle(closure,interrupted.objects[0],ux,charge).kind==='value'&&observeConstructionStorageOracle(closure,interrupted.objects[0],dy,charge).kind==='missing','abrupt preserves prefix and absence');
  /** @type {OraclePayload} */ const undefinedValue={actualType:'undefined',layoutIdentity:'layout:undefined',bits:'',roots:[]};
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'activation:D:1',field:'d.y',value:undefinedValue},charge));
  state=accepted(stepConstructionStorageOracle(closure,state,{kind:'end',activation:'activation:D:1'},charge));
  const defined=observeConstructionStorageOracle(closure,state.objects[0],dy,charge);
  expect(defined.kind==='value'&&defined.present&&defined.value.actualType==='undefined','defined undefined remains present');
  expect(stepConstructionStorageOracle(closure,state,{kind:'define',activation:'activation:D:1',field:'d.y',value:undefinedValue},charge).status==='rejected','ended activation grants no rights');
  expect(validateConstructionStorageClosure(input,closure,charge).status==='complete','independent reconstruction validates exact closure');
  const altered={...closure,bodies:closure.bodies.map(row=>row.actualType==='U'?{...row,referenceCount:0}:row)};
  expect(validateConstructionStorageClosure(input,altered,charge).status==='rejected','reject forged root capacity');
  const unknown={...input,results:input.results.map(row=>row.construction==='B.ctor'?{...row,resultUpper:{...row.resultUpper,unknown:true}}:row)};
  expect(solveConstructionStorageClosure(unknown,charge).status==='open','unknown fixed result is OPEN');
  expect(solveConstructionStorageClosure({...input,views:[]},charge).status==='open','same names do not grant missing base view');
  const split={...input,properties:[...input.properties,{id:'forged:second-x',key:'verified-string-key:x'}]};
  expect(solveConstructionStorageClosure(split,charge).status==='rejected','one physical identity per verified key');
  const unavailable={...input,payloads:input.payloads.map(row=>row.id==='inline:Pair'?{...row,layoutIdentity:''}:row)};
  expect(solveConstructionStorageClosure(unavailable,charge).status==='open','root count alone cannot replace complete concrete layout');
  return {status:'passed'};
}

/** @returns {Input} */
export function constructionStorageCompositionFixture() {
  const base=constructionStorageFixture();
  return {...base,
    classes:[...base.classes.map(row=>row.id==='U'?{...row,fields:[...row.fields,'u.z']}:row),
      {id:'X',base:null,runtimeKey:'runtime:X',fields:['x.x','x.y'],construction:'X.ctor'},
      {id:'Y',base:null,runtimeKey:'runtime:Y',fields:['y.y'],construction:'Y.ctor'},
      {id:'Optional',base:null,runtimeKey:'runtime:Optional',fields:['optional.z'],construction:'Optional.ctor'},
      {id:'Empty',base:null,runtimeKey:'runtime:Empty',fields:[],construction:'Empty.ctor'},
      {id:'Unseeded',base:null,runtimeKey:'runtime:Unseeded',fields:['unseeded.y'],construction:'Unseeded.ctor'}],
    fields:[...base.fields,{id:'u.z',owner:'U',propertyIdentity:'property:z',readonly:false,upper:upper(['i32'])},
      {id:'x.x',owner:'X',propertyIdentity:'property:x',readonly:false,upper:upper(['i32','ref:U'])},
      {id:'x.y',owner:'X',propertyIdentity:'property:y',readonly:false,upper:upper(['i32','undefined'])},
      {id:'y.y',owner:'Y',propertyIdentity:'property:y',readonly:false,upper:upper(['inline:Triple'])},
      {id:'optional.z',owner:'Optional',propertyIdentity:'property:z',readonly:false,upper:upper(['i32','undefined'])},
      {id:'unseeded.y',owner:'Unseeded',propertyIdentity:'property:y',readonly:false,upper:upper(['i32'])}],
    properties:[...base.properties,{id:'property:z',key:'verified-string-key:z'}],
    constructions:[...base.constructions.map(row=>row.id==='U.ctor'?{...row,initializationFields:[...row.initializationFields,'u.z']}:row),
      {id:'X.ctor',owner:'X',initializationFields:['x.x','x.y']},{id:'Y.ctor',owner:'Y',initializationFields:['y.y']},
      {id:'Optional.ctor',owner:'Optional',initializationFields:['optional.z']},{id:'Empty.ctor',owner:'Empty',initializationFields:[]},
      {id:'Unseeded.ctor',owner:'Unseeded',initializationFields:['unseeded.y']}],
    // Reverse dependency order ensures actual fixedpoint iteration is required.
    selectedWitnesses:[{id:'selected:X-to-Y',sourceType:'X',targetType:'Y',fields:[{source:'x.y',target:'y.y'}]},
      {id:'selected:D-to-X',sourceType:'D',targetType:'X',fields:[{source:'d.x',target:'x.x'},{source:'d.y',target:'x.y'}]},
      {id:'selected:D-to-Optional',sourceType:'D',targetType:'Optional',fields:[{missing:true,target:'optional.z'}]},
      {id:'selected:Empty-to-Unseeded',sourceType:'Empty',targetType:'Unseeded',fields:[{missing:true,target:'unseeded.y'}]},
      {id:'selected:Y-to-X',sourceType:'Y',targetType:'X',fields:[{missing:true,target:'x.x'},{source:'y.y',target:'x.y'}]}],
    payloads:[...base.payloads,{id:'inline:Triple',kind:'inline',byteSize:32,alignment:8,referenceCount:3,layoutIdentity:'layout:nested-Triple-full-variants-and-children'}]};
}

/** @param {Charge} charge @returns {{status:'passed'}} */
export function checkConstructionStorageCompositionPureData(charge) {
  const input=constructionStorageCompositionFixture(),solved=solveConstructionStorageClosure(input,charge);
  expect(solved.status==='complete','construction M12 fixedpoint');const closure=solved.closure;
  const body=closure.bodies.find(row=>row.actualType==='U');expect(body,'actual U remains U');
  const inherited=body.routes.find(row=>row.viewType==='X'&&row.field==='x.x'),transitive=body.routes.find(row=>row.viewType==='Y'&&row.field==='y.y');
  expect(inherited&&transitive&&transitive.slot!==null,'D receiver fields traverse real selected D-to-X-to-Y pairs');
  expect(transitive.viaWitnesses.join('|')==='selected:D-to-X|selected:X-to-Y','retain original witness edge chain');
  const y=body.slots[transitive.slot];
  expect(y.fields.includes('d.y')&&y.fields.includes('x.y')&&y.fields.includes('y.y')&&y.referenceCount===3,'fixed alias payload upper expands actual U physical capacity');
  expect(y.alternatives.some(row=>row.actualType==='inline:Triple'&&row.layoutIdentity==='layout:nested-Triple-full-variants-and-children'),'keep full active concrete layout identity');
  expect(!body.routes.some(row=>row.viewType==='Unseeded'),'empty source field table is not an actual view seed');
  const optional=body.routes.findIndex(row=>row.viewType==='Optional'&&row.field==='optional.z');expect(optional>=0,'selected optional target route');
  const route=body.routes[optional],slot=route.slot;expect(slot!==null,'source-view missing does not erase existing actual U.z');
  const empty=emptyStorageOracleObject(closure,'U','existing-U',charge);expect(empty,'composed oracle object');
  /** @type {OraclePayload} */ const value={actualType:'i32',layoutIdentity:'layout:i32',bits:'09000000',roots:[]};
  const existing={...empty,slots:empty.slots.map((state,index)=>index===slot?{present:true,defined:true,value}:state)};
  const observed=observeConstructionStorageOracle(closure,existing,optional,charge);
  expect(observed.kind==='value'&&observed.value.bits==='09000000','optional source absence preserves actual property presence/value');
  const absent=observeConstructionStorageOracle(closure,empty,optional,charge);
  expect(absent.kind==='missing','reserved optional property still distinguishes actual absence');
  expect(validateConstructionStorageClosure(input,closure,charge).status==='complete','cold reconstruction includes original witness chain');
  const forged={...input,selectedWitnesses:input.selectedWitnesses.map(row=>row.id==='selected:D-to-X'?{...row,fields:[{source:'d.y',target:'x.x'},{source:'d.y',target:'x.y'}]}:row)};
  expect(solveConstructionStorageClosure(forged,charge).status==='rejected','witness pairs cannot cross verified property identities');
  const unknown={...input,fields:input.fields.map(row=>row.id==='y.y'?{...row,upper:{...row.upper,unknown:true}}:row)};
  expect(solveConstructionStorageClosure(unknown,charge).status==='open','unknown composed alias upper does not use narrow body results');
  return {status:'passed'};
}
