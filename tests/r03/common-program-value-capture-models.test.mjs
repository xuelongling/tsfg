// SPDX-License-Identifier: MIT
// Compiler data models only; no Source, numeric, Guest, VM or GC execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {commonEffects} from '../../compiler/common-program-effects.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonRegions} from '../../compiler/common-program-regions.mjs';
import {commonClosureHolding} from '../../compiler/common-program-borrow-observations.mjs';
test('normalized fixed effects retain writes through a const scalar value capture',()=>{
  const hir=structuredClone(projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./testdata/common-value-capture/copy-scalar.json',import.meta.url))))),
    owner=hir.functions.find(f=>f.name==='makeOwnedReader'),reader=hir.functions.find(f=>f.name==='readOwned'),
    mutation=owner.body.find(r=>r.kind==='expression'&&r.value.kind==='fieldAssignment');
  assert.ok(mutation);reader.body=[mutation];
  const effects=commonEffects(hir,commonMeter()),upper=effects.derived().get(reader.id);
  assert.equal(hir.environments.flatMap(e=>e.slots).find(s=>s.binding===reader.captures[0].binding).writable,false);
  assert.equal(upper.captures.find(c=>c.read).write,true);
});
for(const kind of ['value','reference','array','readSpan','function'])test('fixed capture holding cannot grant childless writes to '+kind,()=>{
  const slot={key:'held',type:'T',writable:true},layout={id:'E',parent:null,slots:[slot]},
    model={spend:commonMeter(),types:new Map([['T',{kind}]]),environments:new Map([['E',layout]]),functions:new Map([['reader',{lexicalEnvironment:'E'}]])},
    upper={facets:{unknownHost:false,escape:false,await:false,lock:false},globals:{reads:[],writes:[]},hostResources:{reads:[],writes:[]},parameters:[],captures:[{slot:'held',read:true,write:true,structural:false}]};
  assert.equal(commonClosureHolding({model,objects:new Map(),records:new Map([['reader',{upper}]]),closedTarget:()=>true}).permitsCode('reader'),false);
});
function valueGraph(mode){
  const r=commonRegions(commonMeter()),heap=new Map(),scope=r.scope('factory','activation'),
    types=new Map([['I',{kind:'scalar'}],['A',{kind:'array',elementType:'I'}],['R',{kind:'readSpan',elementType:'I'}],
      ['V',{id:'V',kind:'value',fields:[{id:'a',type:'A',readonly:false},{id:'r',type:'R',readonly:true}]}]]),
    layout={id:'E',parent:null,slots:[{key:'held',type:'V',writable:mode==='writable-slot'}]},
    env=r.allocate(scope,'act','env','env:E',heap),value=r.allocate(scope,'act','value','V',heap),
    array=r.allocate(scope,'act','array','A',heap),span=r.allocate(scope,'act','span','R',heap);
  r.store(array,'length',r.number(1),heap);r.store(array,'element/0',r.number(7),heap);
  r.store(span,'owner',array,heap);r.store(span,'start',r.number(0),heap);r.store(span,'length',r.number(1),heap);
  r.store(value,'field/a',array,heap);r.store(value,'field/r',span,heap);r.store(env,'slot/held',value,heap);
  if(mode==='missing')heap.get([...value.roots][0]).delete('field/a');
  if(mode==='opaque')r.store(value,'field/a',{...array,opaque:true},heap);
  if(mode==='wrong-owner')r.store(span,'owner',r.allocate(scope,'act','other','A',heap),heap);
  if(mode==='foreign-scope')r.nodes.get([...array.roots][0]).scope=r.scope('other','activation');
  if(mode==='hard')r.hardRaw(new Set(['array']));
  return r.ownedReturnHolds(env,heap,'span','array',scope,types,new Map([['E',layout]]));
}
for(const mode of ['plain','writable-slot'])test('current inline value fields retain their original managed owner: '+mode,()=>assert.equal(valueGraph(mode),true));
for(const mode of ['missing','opaque','wrong-owner','foreign-scope','hard'])test('current value owning proof rejects '+mode,()=>assert.equal(valueGraph(mode),false));
