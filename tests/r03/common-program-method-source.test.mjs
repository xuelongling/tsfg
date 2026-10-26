// SPDX-License-Identifier: MIT
// Original complete official Source packets. Expectations were frozen from the
// TS before production; no partial packet is renamed or assembled here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildHir,printHir,readHir,lowerHir} from '../../compiler/hir.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {createCommonProgramPublication,analyzeCommonProgram} from '../../compiler/common-program-analysis.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {i32TypeId,sha256} from '../../compiler/identity.mjs';
const loaded=new Map();
async function program(name) {
  if(loaded.has(name))return loaded.get(name);
  const bytes=await fs.readFile(new URL('./common-program-method-'+name+'.json',import.meta.url)),facts=readCommonProgramFacts(bytes),
    context={family:'tsfg.common-program-context-candidate',version:1,factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok',JSON.stringify(built));const hir=built.hir,physical=commonProgramPhysical(hir),publication=createCommonProgramPublication(hir),analysis=analyzeCommonProgram(hir,publication);
  const result={bytes,facts,context,hir,physical,publication,analysis};loaded.set(name,result);return result;
}
const named=(hir,name)=>hir.functions.find(fn=>fn.name===name),type=(hir,name)=>hir.types.find(t=>t.name===name);
const method=(hir,owner)=>hir.functions.find(fn=>fn.ownerType===type(hir,owner).id&&fn.name==='m');
const instructions=plan=>plan.graph.blocks.flatMap(block=>block.instructions);
const rehash=publication=>{for(const row of publication.contracts){const {digest,...body}=row;row.digest=commonIdentity('published-contract',body);}
  publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});return publication;};

test('real whole method Program preserves original Source, all functions, roots and owned roundtrip',async()=>{
  const {facts,hir,context}=await program('dispatch'),source=facts.payload.files.find(file=>file.path==='/src/main.ts');
  assert.equal(sha256(source.content),'sha256:b6e5f5f7a8d3e2b414cb8a0504e21f82401bf702aae2abc82a7da98404a45c0c');
  assert.equal(Buffer.byteLength(source.content),1732);assert.equal(source.content.length,1730);
  assert.equal(hir.functions.length,17);assert.equal(hir.types.filter(t=>['value','reference'].includes(t.kind)).length,7);
  assert.equal(hir.globals.length,2);assert.equal(hir.closure.roots.length,9);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
});
test('real static Base member has the exact full nominal and M12 method table',async()=>{
  const {hir,physical}=await program('dispatch'),plan=physical.plans.find(p=>p.owner.id===named(hir,'callBase').id),op=instructions(plan).find(op=>op.name==='tsfg_program.invoke_method');
  assert.equal(op.properties.function_id,method(hir,'Base').id);assert.equal(op.operands.length,2);assert.equal(op.successors.length,2);
  const expected=[['Base','Base'],['Derived','Derived'],['Inherited','Middle'],['Middle','Middle'],['Peer','Peer']]
    .map(([receiver,target])=>({receiver_type:type(hir,receiver).id,target:method(hir,target).id,signature_hash:method(hir,target).signatureHash})).sort((a,b)=>a.receiver_type<b.receiver_type?-1:1);
  assert.deepEqual(op.properties.dispatch,expected);
});
test('real actual receivers select only their effective method and preserve language completion and identity',async()=>{
  const {hir,physical}=await program('dispatch'),contexts=[...physical.values.actual.contexts.values()],derived=type(hir,'Derived').id,inherited=type(hir,'Inherited').id,peer=type(hir,'Peer').id;
  for(const [actual,target,language]of /** @type {[string,string,boolean][]} */([[derived,method(hir,'Derived').id,true],[inherited,method(hir,'Middle').id,false],[peer,method(hir,'Peer').id,false]])){
    const calls=contexts.filter(c=>!c.root&&c.plan.owner.kind==='method'&&c.args[0].tags.has(actual));assert.ok(calls.length);
    for(const c of calls){assert.equal(c.plan.owner.id,target);assert.deepEqual([...c.args[0].tags],[actual]);assert.equal(c.language,language);
      assert.equal(c.normal,!language);for(const ref of c.args[0].refs)assert.equal(physical.values.actual.objects.get(ref).type,actual);}
  }
  const roots=contexts.filter(c=>c.root&&c.plan.owner.id===named(hir,'concreteDerived').id);assert.ok(roots.length);
  for(const c of roots){assert.equal(c.normal,true);assert.equal(c.language,false);assert.deepEqual([...c.returned.tags],[i32TypeId]);}
});
test('real receiver and argument Source expressions are each lowered once before finite method invoke',async()=>{
  const {hir,physical}=await program('dispatch'),ops=instructions(physical.plans.find(p=>p.owner.id===named(hir,'ordered').id)),
    receiver=ops.filter(op=>op.name==='tsfg_program.invoke'&&op.properties.function_id===named(hir,'makeReceiver').id),
    argument=ops.filter(op=>op.name==='tsfg_program.invoke'&&op.properties.function_id===named(hir,'makeArgument').id),call=ops.filter(op=>op.name==='tsfg_program.invoke_method');
  assert.equal(receiver.length,1);assert.equal(argument.length,1);assert.equal(call.length,1);
  assert.ok(ops.indexOf(receiver[0])<ops.indexOf(argument[0])&&ops.indexOf(argument[0])<ops.indexOf(call[0]));
});
test('real method callers consume every target fixed upper including global, Array and caught exception obligations',async()=>{
  const {hir,analysis,publication}=await program('dispatch'),call=analysis.functions.find(f=>f.functionId===named(hir,'callBase').id),entry=analysis.functions.find(f=>f.functionId===named(hir,'entryBase').id);
  const globals=hir.globals.map(g=>g.id).sort();assert.deepEqual(call.effective.globals,{reads:globals,writes:globals});
  assert.deepEqual(call.effective.parameters[1],{index:1,read:true,write:true,structural:true});
  assert.equal(call.effective.facets.mayThrow,true);assert.equal(call.effective.facets.ehControl,true);assert.equal(entry.effective.facets.mayThrow,false);
  assert.deepEqual(entry.effective.globals,call.effective.globals);
  const narrow=structuredClone(publication);narrow.contracts.find(c=>c.functionId===call.functionId).upper.globals.writes=[];
  assert.throws(()=>analyzeCommonProgram(hir,rehash(narrow)),/** @param {any} e */e=>e.code==='r03-common-program-contract');
  const broad=structuredClone(publication);broad.contracts.find(c=>c.functionId===method(hir,'Base').id).upper.facets.allocation=true;
  assert.throws(()=>analyzeCommonProgram(hir,rehash(broad)),/** @param {any} e */e=>e.code==='r03-common-program-contract');
});
test('real complete method Core uses private version 2 and retains all ordinary functions',async()=>{
  const {hir,context,publication}=await program('dispatch'),request={targets:hir.closure.roots.filter(root=>root.kind==='kernel').map(root=>root.target).sort()},text=lowerHir(hir,context,{publication,request});
  assert.equal((text.match(/func\.func @/g)??[]).length,18);assert.match(text,/version = 2 : i32/);
  assert.equal((text.match(/"tsfg_program\.invoke_method"/g)??[]).length,2);assert.match(text,/"tsfg_program\.catch_bind"/);
});
test('real structural fewer-parameter method keeps both argument effects and drops only the static void projection',async()=>{
  const {facts,hir,physical}=await program('adaptation'),source=facts.payload.files.find(file=>file.path==='/src/main.ts');
  assert.equal(sha256(source.content),'sha256:483691a454754cdb80b774fbb3066d637458013b84f2f4ef10219fec3755e270');assert.equal(hir.functions.length,10);
  const adapted=named(hir,'adapted'),plan=physical.plans.find(p=>p.owner.id===adapted.id),ops=instructions(plan),call=ops.find(op=>op.name==='tsfg_program.invoke_method'),
    array=ops.find(op=>op.name==='tsfg_program.invoke'&&op.properties.function_id===named(hir,'sideArray').id),scalar=ops.find(op=>op.name==='tsfg_program.invoke'&&op.properties.function_id===named(hir,'sideScalar').id);
  assert.ok(ops.indexOf(array)<ops.indexOf(scalar)&&ops.indexOf(scalar)<ops.indexOf(call));assert.equal(call.operands.length,3);
  assert.equal(plan.graph.blocks.find(block=>block.name===call.successors[0]).parameters.length,0);
  const target=method(hir,'Fewer'),contexts=[...physical.values.actual.contexts.values()].filter(c=>!c.root&&c.plan.owner.kind==='method');assert.ok(contexts.length);
  for(const c of contexts){assert.equal(c.plan.owner.id,target.id);assert.equal(c.args.length,1);assert.equal(c.normal,true);}
  for(const c of physical.values.actual.contexts.values())if(c.plan.owner.id===adapted.id){assert.equal(c.normal,true);assert.equal(c.returned.number,1);}
});
