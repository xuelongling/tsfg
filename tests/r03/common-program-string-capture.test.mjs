// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,verifyCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonClosureHolding} from '../../compiler/common-program-borrow-observations.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {typedArrayStringUnits} from '../../compiler/typed-array-literals.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const names=['local-const','local-let','owner-write','sibling-write','sibling-early-write','ancestor','shadow','parameter','string-return','descriptor-only','owner-replaced'];
const packet=name=>JSON.parse(readFileSync(new URL('./testdata/common-string-capture/'+name+'.json',import.meta.url),'utf8'));
const facts=name=>readCommonProgramFacts(Buffer.from(canonical(packet(name))+'\n'));
for(const name of names)test('complete official String original capture to fixed Published and Core: '+name,()=>{
  const source=facts(name),hir=projectCommonProgram(source),types=new Map(hir.types.map(t=>[t.id,t])),
    slots=hir.environments.flatMap(e=>e.slots).filter(s=>types.get(s.type)?.kind==='string');
  assert.equal(slots.length,1);const slot=slots[0],binding=source.payload.functions.flatMap(f=>[...f.parameters,...f.bindings]).find(b=>b.id===slot.binding);
  assert.equal(binding.name,'text');assert.equal(slot.writable,!['local-const','shadow'].includes(name));assert.equal(slot.kind,['parameter','string-return'].includes(name)?'parameter':'local');
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  if(['descriptor-only','owner-replaced'].includes(name)){
    assert.throws(()=>emitCommonProgramCore(hir,publication,request),e=>e instanceof Error&&'code' in e&&e.code==='r03-common-program-borrow-pending');return;
  }
  const core=emitCommonProgramCore(hir,publication,request),physical=commonProgramPhysical(hir);
  assert.match(core,/tsfg_program.env_load/);assert.match(core,/tsfg_program.string/);assert.match(core,/tsfg_program.readspan/);
  assert.equal(physical.carriers.layout(slot.type).referenceCount,1);assert.equal(physical.carriers.layout(slot.type).byteSize,8);
  assert.equal(hir.functions.find(f=>f.name==='loopRead').body.some(s=>s.kind==='while'),true);
  if(name==='sibling-write'){
    const writer=hir.functions.find(f=>f.name==='replaceText'),upper=publication.contracts.find(r=>r.functionId===writer.id).upper.captures.find(r=>r.slot===slot.key);
    assert.equal(upper.write,true);assert.equal(upper.structural,false);
  }
});
for(const change of ['foreign-binding','foreign-owner','wrong-type','wrong-key','self-hashed-source'])test('cold String original identity rejects '+change,()=>{
  const value=packet('shadow'),reader=value.payload.functions.find(f=>f.name==='readOwned'&&f.captures.some(c=>value.payload.functions.find(owner=>owner.name==='forwardText').bindings.some(b=>b.id===c.binding))),owner=value.payload.functions.find(f=>f.name==='makeOwnedReader'),foreign=owner.bindings.find(b=>b.name==='text');
  if(change==='foreign-binding')reader.captures[0].binding=foreign.id;
  if(change==='foreign-owner')value.payload.functions.find(f=>f.name==='forwardText').bindings.find(b=>b.name==='text').lexicalOwner=owner.id;
  if(change==='wrong-type')value.payload.functions.find(f=>f.name==='forwardText').bindings.find(b=>b.name==='text').declaredType='i32';
  if(change==='wrong-key')reader.captures[0].occurrences[0].range.start+=1;
  if(change==='self-hashed-source'){
    const file=value.payload.files.find(f=>f.path==='/src/main.ts');file.content=file.content.replace('const current: string = text;','const current: string = seed;');file.hash=sha256(file.content);
  }
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(value.payload));
  assert.throws(()=>projectCommonProgram(readCommonProgramFacts(Buffer.from(canonical(value)+'\n'))));
});
for(const kind of ['scalar','string','array','readSpan','function','reference','value','union'])test('only scalar and immutable String capture writes cannot replace holding children: '+kind,()=>{
  const layout={id:'layout',parent:null,slots:[{key:'text-slot',type:'type',writable:true}]},upper={facets:{unknownHost:false,escape:false,await:false,lock:false},globals:{reads:[],writes:[]},hostResources:{reads:[],writes:[]},parameters:[],captures:[{slot:'text-slot',write:true,structural:false}]},
    model={spend:commonMeter(),types:new Map([['type',{kind}]]),environments:new Map([['layout',layout]]),functions:new Map([['reader',{lexicalEnvironment:'layout'}]])},records=new Map([['reader',{upper}]]),
    policy=commonClosureHolding({model,objects:new Map(),records,closedTarget:()=>true});
  assert.equal(policy.permitsCode('reader'),['scalar','string'].includes(kind));
  assert.equal(commonClosureHolding({model:{...model,functions:new Map([['reader',{lexicalEnvironment:null,activationEnvironment:'layout'}]])},objects:new Map(),records,closedTarget:()=>true}).permitsCode('reader'),['scalar','string'].includes(kind));
  for(const mutation of ['foreign-key','foreign-owner','structural','readonly']){
    const changed=structuredClone(upper),current=structuredClone(model.environments);
    if(mutation==='foreign-key')changed.captures[0].slot='foreign';if(mutation==='structural')changed.captures[0].structural=true;
    if(mutation==='readonly')current.get('layout').slots[0].writable=false;
    const functions=mutation==='foreign-owner'?new Map([['reader',{lexicalEnvironment:null}]]):model.functions;
    assert.equal(commonClosureHolding({model:{...model,environments:current,functions},objects:new Map(),records:new Map([['reader',{upper:changed}]]),closedTarget:()=>true}).permitsCode('reader'),false);
  }
});

test('fixed Published String capture write permission remains authoritative',()=>{
  const hir=projectCommonProgram(facts('sibling-write')),publication=structuredClone(createCommonProgramPublication(hir)),writer=hir.functions.find(f=>f.name==='replaceText'),contract=publication.contracts.find(row=>row.functionId===writer.id);
  contract.upper.captures.find(row=>row.write).write=false;
  const {digest,...body}=contract;contract.digest=commonIdentity('published-contract',body);
  publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});
  assert.throws(()=>emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),e=>e instanceof Error&&'code' in e&&e.code==='r03-common-program-contract');
});
for(const [token,expected] of [['"\\u0000"',[0]],['"\\uD800"',[55296]],['"\\uDC00"',[56320]],['"\\uD800\\uDC00"',[55296,56320]],['"\\x00"',[0]]])test('terminal fixed Unicode escape preserves literal codeUnits '+token,()=>assert.deepEqual(typedArrayStringUnits(token),expected));
for(const token of ['"\\uD80"','"\\uD80G"','"\\x0"','"\\u{D800"','"\\uD800','"\\uD800\\"','"\\uD800x'])test('malformed Unicode token remains rejected '+token,()=>assert.throws(()=>typedArrayStringUnits(token)));
for(const change of ['key','owner','type','binding','activation','parent'])test('cold owned String environment rejects foreign '+change,()=>{
  const hir=structuredClone(projectCommonProgram(facts('local-let'))),env=hir.environments.find(e=>e.slots.some(s=>hir.types.find(t=>t.id===s.type)?.kind==='string')),slot=env.slots.find(s=>hir.types.find(t=>t.id===s.type)?.kind==='string');
  if(change==='key')slot.key='foreign-slot';if(change==='owner')env.owner=hir.functions.find(f=>f.name==='left').id;
  if(change==='activation')hir.functions.find(f=>f.name==='readText').activationEnvironment=env.id;if(change==='parent')env.parent='foreign-layout';
  if(change==='type')slot.type=hir.types.find(t=>t.kind==='scalar').id;if(change==='binding')slot.binding=hir.functions.find(f=>f.name==='left').parameters[0].id;
  assert.throws(()=>verifyCommonProgramHir(hir));
});