// SPDX-License-Identifier: MIT
// Whole official Source packages combine existing payload types and block scopes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,readCommonProgramHir,printCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonSemanticIdentities} from '../../compiler/common-program-identities.mjs';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {canonical} from '../../compiler/identity.mjs';
const directory=new URL('./testdata/common-block-payload-capture/',import.meta.url),
  cases=JSON.parse(readFileSync(new URL('cases.json',directory),'utf8'));
assert.equal(cases.length,25);
for(const row of cases)test('complete official block existing payload shared slot: '+row.name,()=>{
  const bytes=readFileSync(new URL(row.name+'.json',directory));
  assert.equal(bytes.length,row.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
  const facts=readCommonProgramFacts(bytes),sourceOwner=facts.payload.functions.find(fn=>fn.name==='blockEntry'),
    cell=sourceOwner.bindings.find(binding=>binding.name==='cell'),sourceTypes=new Map(facts.payload.types.map(type=>[type.id,type])),
    declared=sourceTypes.get(cell.declaredType),members=declared.kind==='union'?declared.members.map(id=>sourceTypes.get(id)):[declared],
    presence=row.variant==='concrete'?[]:row.variant==='null'?['null']:row.variant==='undefined'?['undefined']:['null','undefined'],
    payload=members.filter(type=>!['null','undefined'].includes(type.kind));
  assert.equal(payload.length,1);assert.equal(payload[0].kind,row.kind);
  assert.deepEqual(members.filter(type=>['null','undefined'].includes(type.kind)).map(type=>type.kind).sort(),presence);
  assert.equal(cell.writable,row.variant!=='const-both');
  const identities=commonSemanticIdentities(facts.payload,commonMeter()),hir=projectCommonProgram(facts),
    owner=hir.functions.find(fn=>fn.sourceBinding===sourceOwner.id),environment=hir.environments.find(env=>env.owner===owner.id),
    slots=environment.slots.filter(slot=>slot.binding===cell.id),types=new Map(hir.types.map(type=>[type.id,type]));
  assert.equal(slots.length,1);const slot=slots[0];
  assert.equal(slot.type,identities.typeIds.get(cell.declaredType));assert.equal(slot.writable,cell.writable);
  assert.equal(owner.bindings.find(binding=>binding.id===cell.id).type,slot.type);
  const order=rows=>rows.map(({kind,range,binding})=>({kind,range,binding}));
  assert.deepEqual(order(owner.body),order(sourceOwner.body));
  assert.deepEqual(order(owner.body.find(statement=>statement.kind==='if').then),order(sourceOwner.body.find(statement=>statement.kind==='if').then));
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  const originalClosures=facts.payload.functions.filter(fn=>fn.captures.some(capture=>capture.binding===cell.id)),
    closures=hir.functions.filter(fn=>fn.captures.some(capture=>capture.binding===cell.id));
  assert.equal(closures.length,2);assert.equal(originalClosures.length,2);
  for(const fn of closures){const original=originalClosures.find(source=>source.id===fn.sourceBinding);
    assert.deepEqual(fn.captures,original.captures);assert.deepEqual(fn.declarationScope,original.declarationScope);
    assert.equal(fn.lexicalParent,owner.id);assert.equal(fn.lexicalEnvironment,environment.id);}
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(root=>root.kind==='kernel').map(root=>root.target).sort()},
    program=commonProgramCore(hir,publication,request,{borrowProof:true}),
    initializers=program.text.split('\n').filter(line=>line.includes('"tsfg_program.env_init"')&&line.includes(cell.id));
  assert.ok(program.borrowProof);assert.equal(initializers.length,1);
  assert.ok(initializers[0].includes('tsfg_source.start = '+cell.declarationRange.start+' : i64'));
  assert.ok(initializers[0].includes('tsfg_source.end = '+cell.declarationRange.end+' : i64'));
  const carrier=program.representation.bindings.find(binding=>binding.id===cell.id).carrier,
    domain=program.representation.domains.find(value=>value.id===carrier),actual=domain?.actualTypes??[carrier],
    expected=[payload[0].id,...(cell.writable?presence:[])].map(id=>identities.typeIds.get(id)).sort();
  assert.deepEqual(actual,expected);assert.equal(types.get(slot.type).kind,declared.kind);
  if(row.kind==='function'){
    const reader=closures.find(fn=>fn.name==='read'),call=reader.body.at(-1).value,
      selected=commonTargets(hir,commonMeter()).site(reader.id,call.range),
      expectedTargets=['leafLeft',...(cell.writable?['leafRight']:[])].map(name=>hir.functions.find(fn=>fn.name===name).id).sort();
    assert.equal(call.kind,'indirectCall');assert.deepEqual(selected,{top:false,functions:expectedTargets});
  }
  if(process.env.TSFG_BLOCK_PAYLOAD_CORE_ROOT){
    mkdirSync(process.env.TSFG_BLOCK_PAYLOAD_CORE_ROOT,{recursive:true});
    for(const [suffix,text]of [['.mlir',program.text],['.proof.json',canonical(program.borrowProof)+'\n'],['.owned.json',canonical({hir,publication,request})+'\n']]){
      const path=process.env.TSFG_BLOCK_PAYLOAD_CORE_ROOT+'/'+row.name+suffix;
      if(existsSync(path))assert.equal(readFileSync(path,'utf8'),text);else writeFileSync(path,text,{flag:'wx'});
    }
  }
});
