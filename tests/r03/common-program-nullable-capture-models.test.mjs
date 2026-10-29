// SPDX-License-Identifier: MIT
// Normalized compiler data only; no Source, numeric, Guest or VM execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonEnvironments} from '../../compiler/common-program-environments.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {selectCommonCarriers} from '../../compiler/common-program-carriers.mjs';
import {commonClosureHolding} from '../../compiler/common-program-borrow-observations.mjs';
import {i32TypeId,sha256} from '../../compiler/identity.mjs';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {commonEffects} from '../../compiler/common-program-effects.mjs';
import {createCommonGraph} from '../../compiler/common-program-plan.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';

test('nullable original parameter shares its complete tagged slot across siblings',()=>{
  const binding={id:'held',name:'held',kind:'parameter',type:'nullable',writable:true},
    owner={id:'owner',lexicalParent:null,parameters:[binding],bindings:[],body:[],captures:[]},
    left={id:'left',lexicalParent:'owner',parameters:[],bindings:[],body:[],captures:[{binding:'held',read:true,write:false}]},
    right={...left,id:'right',captures:[{binding:'held',read:false,write:true}]},
    types=new Map([['nullable',{kind:'union',members:['i32','null','undefined']}],['i32',{kind:'scalar'}],['null',{kind:'null'}],['undefined',{kind:'undefined'}]]),
    result=commonEnvironments([owner,left,right],types,commonMeter());
  assert.equal(result.environments.length,1);
  assert.deepEqual(result.environments[0].slots,[result.slots.get('held')]);
  assert.equal(result.slots.get('held').type,'nullable');
  assert.equal(result.metadata(left).lexicalEnvironment,result.metadata(right).lexicalEnvironment);
  assert.equal(result.metadata(owner).activationEnvironment,result.metadata(left).lexicalEnvironment);
});

for(const kind of ['scalar','string','array','function','reference','value'])for(const absence of [['null'],['undefined'],['null','undefined']])for(const role of ['local','parameter'])
test('one '+kind+' payload with '+absence.join('/')+' retains original '+role+' slot',()=>{
  const binding={id:'held',name:'held',kind:role,type:'nullable',writable:role==='parameter'},
    owner={id:'owner',lexicalParent:null,parameters:role==='parameter'?[binding]:[],bindings:role==='local'?[binding]:[],
      body:role==='local'?[{kind:'constDeclaration',binding:'held',initializer:{kind:'nullLiteral'}}]:[],captures:[]},
    child={id:'child',lexicalParent:'owner',parameters:[],bindings:[],body:[],captures:[{binding:'held',read:true,write:false}]},
    types=new Map([['nullable',{kind:'union',members:['T',...absence]}],['T',{kind}]]);
  for(const kind of absence)types.set(kind,{kind});
  const result=commonEnvironments([owner,child],types,commonMeter());
  assert.equal(result.slots.get('held').type,'nullable');assert.equal(result.slots.get('held').kind,role);
  assert.equal(result.slots.get('held').writable,role==='parameter');
});

for(const members of [['null','undefined'],['T','Other','null'],['Span','null'],['Unknown','undefined'],['Void','null']])
test('unsupported nullable capture keeps its owning capability: '+members.join('/'),()=>{
  const binding={id:'held',name:'held',kind:'parameter',type:'nullable',writable:true},
    owner={id:'owner',lexicalParent:null,parameters:[binding],bindings:[],body:[],captures:[]},
    child={id:'child',lexicalParent:'owner',parameters:[],bindings:[],body:[],captures:[{binding:'held',read:true,write:false}]},
    types=new Map([['nullable',{kind:'union',members}],['T',{kind:'scalar'}],['Other',{kind:'string'}],['Span',{kind:'readSpan'}],
      ['Unknown',{kind:'unknown'}],['Void',{kind:'void'}],['null',{kind:'null'}],['undefined',{kind:'undefined'}]]);
  assert.throws(()=>commonEnvironments([owner,child],types,commonMeter()),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-capability');
});

for(const kind of ['scalar','string','array','function','reference','value'])test('nullable '+kind+' does not inherit scalar/String childless write authority',()=>{
  const layout={id:'E',parent:null,slots:[{key:'held',type:'nullable',writable:true}]},
    model={spend:commonMeter(),types:new Map([['nullable',{kind:'union',members:['T','null']}],['T',{kind}]]),
      environments:new Map([['E',layout]]),functions:new Map([['reader',{lexicalEnvironment:'E'}]])},
    upper={facets:{unknownHost:false,escape:false,await:false,lock:false},globals:{reads:[],writes:[]},hostResources:{reads:[],writes:[]},parameters:[],
      captures:[{slot:'held',read:true,write:true,structural:false}]};
  assert.equal(commonClosureHolding({model,objects:new Map(),records:new Map([['reader',{upper}]]),closedTarget:()=>true}).permitsCode('reader'),false);
});

for(const kind of ['scalar','string','array','function','reference','value'])test('conditional '+kind+' carrier retains two absence tags and its active payload layout',()=>{
  const absent=[sha256('tsfg.type\0null'),sha256('tsfg.type\0undefined')],payload=kind==='scalar'?i32TypeId:'T',
    rows=[{id:payload,kind,...(kind==='scalar'?{name:'i32'}:{}),fields:[]},...absent.map((id,index)=>({id,kind:index?'undefined':'null'}))],
    types=new Map(rows.map(row=>[row.id,row])),model={types,bindings:new Map([['held',{id:'held',role:'parameter',type:'nullable'}]]),
      spend:commonMeter(),payload:'payload:unit',environments:new Map()},a=commonAbstract(model),observed=a.empty();
  for(const id of [payload,...absent])a.merge(observed,a.literal(id));
  const carriers=selectCommonCarriers({model,plans:[]},{abstract:a,fieldSeeds:new Map(),globalSeeds:new Map(),elementSeeds:new Map(),
    capacity:{observed:new Map([['binding/held',observed]]),contexts:new Map()}}),carrier=carriers.bindings.get('held'),domain=carriers.domains.get(carrier);
  assert.deepEqual(domain.actualTypes,[payload,...absent].sort());assert.equal(domain.representation,'finite-union');assert.equal(domain.tagBytes,2);
  const expected=kind==='scalar'?{byteSize:8,alignment:4,referenceCount:0}:kind==='value'?{byteSize:2,alignment:2,referenceCount:0}
    :kind==='function'?{byteSize:48,alignment:8,referenceCount:1}:{byteSize:16,alignment:8,referenceCount:1};
  assert.deepEqual(carriers.layout(carrier),expected);
  for(const id of absent)assert.deepEqual(carriers.layout(id),{byteSize:0,alignment:1,referenceCount:0});
});

test('normalized nullable const value field mutation retains the captured slot authority',()=>{
  const hir=structuredClone(projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./testdata/common-value-capture/copy-scalar.json',import.meta.url))))),
    owner=hir.functions.find(f=>f.name==='makeOwnedReader'),reader=hir.functions.find(f=>f.name==='readOwned'),
    mutation=owner.body.find(r=>r.kind==='expression'&&r.value.kind==='fieldAssignment'),
    slot=hir.environments.flatMap(e=>e.slots).find(s=>s.binding===reader.captures[0].binding);
  const nullType=sha256('tsfg.type\0null');
  if(!hir.types.some(t=>t.id===nullType))hir.types.push({id:nullType,sourceType:'null',kind:'null',name:'null',semanticLabel:'unit',semanticShape:'unit'});
  hir.types.push({id:'nullable-value-model',sourceType:'nullable-value-model',kind:'union',name:'union',semanticLabel:'unit',semanticShape:'unit',members:[slot.type,nullType].sort()});
  slot.type='nullable-value-model';reader.body=[mutation];
  assert.equal(slot.writable,false);
  const effects=commonEffects(hir,commonMeter()).derived().get(reader.id);
  assert.equal(effects.captures.find(c=>c.read).write,true);
});

test('a boolean view and carrier adapter cannot manufacture an actual boolean condition',()=>{
  const bool=sha256('tsfg.type\0bool'),rows=[{id:i32TypeId,kind:'scalar',name:'i32'},{id:bool,kind:'scalar',name:'bool'}],
    owner={id:'entry',returnType:i32TypeId,parameters:[],sourcePath:'/actual-bool-model.ts'},
    model={types:new Map(rows.map(row=>[row.id,row])),functions:new Map([['entry',owner]]),fields:new Map(),bindings:new Map(),globals:new Map(),
      environments:new Map(),spend:commonMeter(),payload:'payload:unit',
      hir:{types:rows,functions:[{...owner,sourceBinding:'entry'}],globals:[],snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}},closure:{roots:[{kind:'application',target:'entry'}]}}},
    graph=createCommonGraph(model,owner),entry=graph.newBlock(),yes=graph.newBlock(),no=graph.newBlock(),range={start:0,end:1},
    number=graph.emit(entry,'constant',[],i32TypeId,{decimal:'1',token:'1'},range),
    view=graph.emit(entry,'view',[number],bool,{target:bool},range),adapted=graph.emit(entry,'carrier_cast',[view],bool,{carrier:bool},range);
  graph.conditional(entry,adapted,yes,no,range);for(const block of [yes,no])graph.terminal(block,'func.return',[number],[],{},range);
  assert.throws(()=>analyzeCommonGraphs({model,plans:[{owner,graph,entry,parameters:[],returnType:i32TypeId}]}),
    e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-capability'&&e.message.includes('condition has no proved boolean actual value'));
});

test('generic unknown single callable keeps the original function carrier',()=>{
  const model={types:new Map([['F',{id:'F',kind:'function'}]]),bindings:new Map([['held',{id:'held',role:'parameter',type:'F'}]]),
    spend:commonMeter(),payload:'payload:unit',environments:new Map()},a=commonAbstract(model),value=a.literal('F');
  value.unknown=true;
  const carriers=selectCommonCarriers({model,plans:[]},{abstract:a,fieldSeeds:new Map(),globalSeeds:new Map(),elementSeeds:new Map(),
    capacity:{observed:new Map([['binding/held',value]]),contexts:new Map()}});
  assert.equal(carriers.bindings.get('held'),'F');assert.equal(carriers.bindingValues.get('held').unknown,true);
  assert.deepEqual([...carriers.bindingValues.get('held').tags],['F']);
});
