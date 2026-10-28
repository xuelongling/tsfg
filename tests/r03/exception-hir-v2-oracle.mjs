// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const oldSchema='sha256:af8317d8403ea2817e1eba2c47e1d4ef38090f7127897204b05e369ec545ddfd';
const schema='sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5';
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const jcs=value=>Array.isArray(value)?'['+value.map(jcs).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}':JSON.stringify(value);
// Independent expectation-only schema migration. Existing handwritten semantic
// graphs and their original pins remain checked. No Product projector/reader or
// v1 validator participates, and this helper supplies no new-node semantics.
export function createExceptionOracle(){
  const forward=new Map(),backward=new Map();
  function data(value,reverse=false){
    if(typeof value==='string')return (reverse?backward:forward).get(value)??value;
    if(Array.isArray(value))return value.map(item=>data(item,reverse));
    if(!value||typeof value!=='object')return value;
    const result=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
      key==='snapshot'||key==='inputIdentity'?structuredClone(item):data(item,reverse)]));
    if(result.family==='tsfg.exception-hir-candidate'){
      result.version=reverse?1:2;result.schemaHash=reverse?oldSchema:schema;
    }
    if(Array.isArray(result.types))result.types.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    return result;
  }
  function entity(kind,record){
    const domain='tsfg.exception-hir-candidate.'+kind+'.v1\0';
    const old=hash(domain+oldSchema+'\0'+jcs(data(record,true))),current=hash(domain+schema+'\0'+jcs(record));
    assert.ok(!forward.has(old)||forward.get(old)===current,'unambiguous handwritten identity preimage');
    forward.set(old,current);backward.set(current,old);return current;
  }
  return {entity,data,legacyHash:text=>hash(jcs(data(JSON.parse(text),true))+(text.endsWith('\n')?'\n':'')),
    preimages(rows){return rows.map(row=>{
      if(row.scalar!==undefined){assert.equal(hash(row.domain+'\0'+row.scalar),row.id);return structuredClone(row);}
      const record=data(row.record),kind=row.domain.slice('tsfg.exception-hir-candidate.'.length,-3);
      const id=entity(kind,record);assert.equal(backward.get(id),row.id);
      return {...row,record,id};
    });},
  };
}
