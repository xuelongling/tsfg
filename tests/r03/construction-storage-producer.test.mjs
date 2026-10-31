// SPDX-License-Identifier: MIT
// Literal catalogue/observation DTOs only: no frontend, solver, Source Program,
// physical storage, fixed-publication consumption or Runtime execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonProposeConstructionStorage} from '../../compiler/common-program-construction-storage.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

const sample=(tags=[],unknown=false)=>({actualTypes:new Set(tags),unknown});
const observations=(complete=true)=>({fields:new Map(),results:new Map(),coverage:{complete,issues:[]}});
function catalogue(){
  return {types:[{id:'D',kind:'reference',base:'B',fields:[{id:'field:d'}],construction:{id:'ctor:d'}},
    {id:'V',kind:'value',fields:[{id:'field:v'}],construction:{id:'ctor:v'}},
    {id:'U',kind:'reference',fields:[{id:'field:u'}],construction:{id:'ctor:u'}},
    {id:'B',kind:'reference',fields:[{id:'field:b'}],construction:{id:'ctor:b'}},
    {id:'String',kind:'string'},{id:'Span',kind:'readSpan'},{id:'a',kind:'scalar'},{id:'Z',kind:'scalar'}]};
}
const field=(storage,id)=>{const row=storage.fields.find(row=>row.fieldId===id);assert.ok(row);return row;};
const result=(storage,construction,newTarget)=>{const row=storage.results.find(row=>row.construction===construction&&row.newTarget===newTarget);assert.ok(row);return row;};

test('construction storage producer: complete ordered fields and reference/value ancestor result pairs',()=>{
  const storage=commonProposeConstructionStorage(catalogue(),observations(),commonMeter());
  assert.deepEqual(storage.fields.map(row=>row.fieldId),['field:b','field:d','field:u','field:v']);
  assert.deepEqual(storage.results.map(row=>[row.construction,row.newTarget]),[
    ['ctor:b','B'],['ctor:b','D'],['ctor:d','D'],['ctor:u','U'],['ctor:v','V']]);
  assert.equal(storage.fields.every(row=>row.unknown&&row.actualTypes.length===0),true);
  assert.equal(storage.results.every(row=>row.unknown&&row.actualTypes.length===0),true);
  assert.deepEqual(Object.keys(storage),['fields','results']);
  assert.deepEqual(Object.keys(storage.fields[0]),['fieldId','actualTypes','unknown']);
  assert.deepEqual(Object.keys(storage.results[0]),['construction','newTarget','actualTypes','unknown']);
});

test('construction storage producer: missing observations stay unknown while explicit complete empty observations are Bottom',()=>{
  const input=observations();input.fields.set('field:b',sample());input.fields.set('field:d',sample(['U']));
  input.results.set('ctor:b/B',sample());
  const storage=commonProposeConstructionStorage(catalogue(),input,commonMeter());
  assert.deepEqual(field(storage,'field:b'),{fieldId:'field:b',actualTypes:[],unknown:false});
  assert.deepEqual(field(storage,'field:d'),{fieldId:'field:d',actualTypes:['U'],unknown:false});
  assert.equal(field(storage,'field:u').unknown,true);
  assert.deepEqual(result(storage,'ctor:b','B'),{construction:'ctor:b',newTarget:'B',actualTypes:[],unknown:false});
  assert.equal(result(storage,'ctor:b','D').unknown,true,'a complete global flag is not an unsampled constructor result');
});

test('construction storage producer: incomplete coverage makes every row unknown without discarding observed tags',()=>{
  const input=observations(false);input.coverage.issues.push('implicit-root','opaque-entry');
  input.fields.set('field:b',sample());input.fields.set('field:d',sample(['U']));input.results.set('ctor:b/D',sample(['U']));
  const storage=commonProposeConstructionStorage(catalogue(),input,commonMeter());
  assert.equal(storage.fields.every(row=>row.unknown),true);assert.equal(storage.results.every(row=>row.unknown),true);
  assert.deepEqual(field(storage,'field:d').actualTypes,['U']);assert.deepEqual(result(storage,'ctor:b','D').actualTypes,['U']);
  const noDiagnostics=observations(false);noDiagnostics.fields.set('field:b',sample());
  assert.equal(field(commonProposeConstructionStorage(catalogue(),noDiagnostics,commonMeter()),'field:b').unknown,true);
});

test('construction storage producer: actual replacement U keeps requested newTarget D and all owned field tags',()=>{
  const input=observations();input.results.set('ctor:b/D',sample(['U']));input.fields.set('field:d',sample(['a','U','Z','String','Span','U']));
  input.fields.set('field:u',sample(['V'],true));
  const storage=commonProposeConstructionStorage(catalogue(),input,commonMeter());
  assert.deepEqual(result(storage,'ctor:b','D'),{construction:'ctor:b',newTarget:'D',actualTypes:['U'],unknown:false});
  assert.deepEqual(field(storage,'field:d').actualTypes,['Span','String','U','Z','a']);
  assert.deepEqual(field(storage,'field:u'),{fieldId:'field:u',actualTypes:['V'],unknown:true});
  const foreign=observations();foreign.fields.set('field:b',sample(['unowned-tag']));
  assert.throws(()=>commonProposeConstructionStorage(catalogue(),foreign,commonMeter()),{code:'r03-common-program-construction-storage'});
});

test('construction storage producer: proposed raw rows own snapshots without mutating catalogue or observations',()=>{
  const hir=catalogue(),input=observations(),tags=sample(['U']);input.fields.set('field:d',tags);input.results.set('ctor:b/D',sample(['U']));
  const storage=commonProposeConstructionStorage(hir,input,commonMeter());
  tags.actualTypes.add('D');tags.unknown=true;input.coverage.complete=false;input.results.clear();
  const d=hir.types.find(type=>type.id==='D');assert.ok(d);assert.ok(d.fields);d.fields[0].id='later-field';
  assert.deepEqual(field(storage,'field:d'),{fieldId:'field:d',actualTypes:['U'],unknown:false});
  assert.deepEqual(result(storage,'ctor:b','D'),{construction:'ctor:b',newTarget:'D',actualTypes:['U'],unknown:false});
  field(storage,'field:d').actualTypes.push('V');assert.equal(tags.actualTypes.has('V'),false);
});

test('construction storage producer: shared budget rejects before copying an observed tag set',()=>{
  /** @extends {Set<string>} */
  class ProbeSet extends Set {
    iterations=0;
    [Symbol.iterator](){this.iterations++;return super[Symbol.iterator]();}
  }
  const tags=new ProbeSet(['U']),hir={types:[{id:'B',kind:'reference',fields:[{id:'f'}],construction:{id:'C'}},{id:'U',kind:'scalar'}]},
    input={fields:new Map([['f',{actualTypes:tags,unknown:false}]]),results:new Map(),coverage:{complete:true,issues:[]}};
  assert.throws(()=>commonProposeConstructionStorage(hir,input,commonMeter(20)),{code:'r03-common-program-limit'});
  assert.equal(tags.iterations,0,'the owned tag snapshot has not started when its prepaid cost fails');
  assert.equal(tags.has('U'),true);
});
