// SPDX-License-Identifier: MIT
// Genuine complete pair; current refusal is a capability gap, never executed values.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {canonical} from '../../compiler/identity.mjs';
const factsDirectory=new URL('../fixtures/r03/common-reference-cell/',import.meta.url),inputsDirectory=new URL('../fixtures/r03/common-reference-cell/',import.meta.url);
const sourcePins=[{"name":"reference-cell-held-safe","bytes":2207,"sha256":"5b48035b3fd89fc1206786ca937f32cc047d631e142385960d6f5e80383a7188","oracle":"reference-cell-held-safe-official-oracle.json"},{"name":"reference-cell-unheld-control","bytes":2172,"sha256":"041cb1d1e4807c178e17aed7ae316ad45164a49127788edcd32e6999504f813b","oracle":"reference-cell-unheld-control-official-oracle.json"},{"name":"reference-cell-held-unrelated","bytes":2212,"sha256":"2697a49064f76946c22cb35e0e1497f875d262ad423b7662f1bc8776593065f5","oracle":"reference-cell-held-unrelated-official-oracle.json"},{"name":"reference-cell-held-mutable","bytes":2205,"sha256":"8e73710c102f5affd2c0de52ba163bc1cc1597fce376008d8238e71913020c01","oracle":"reference-cell-held-mutable-official-oracle.json"},{"name":"reference-cell-held-resize","bytes":2224,"sha256":"f4f31f2a48fd6b96767a509b06d0169d0d0a522f0a99582b57a1179491ad7643","oracle":"reference-cell-held-resize-official-oracle.json"}];

function original(name,mode){
  const held=mode!=='unheld';
  const bytes=readFileSync(new URL(name+'-package.json',factsDirectory)),
    requestBytes=readFileSync(new URL(name+'-request.json',factsDirectory)),
    sourceBytes=readFileSync(new URL(name+'.source.txt',inputsDirectory)),sourceText=sourceBytes.toString('utf8'),
    packet=JSON.parse(bytes.toString('utf8')),request=JSON.parse(requestBytes.toString('utf8')),
    source=packet.payload.files.find(row=>row.path==='/src/main.ts');
  const pinned=sourcePins.find(row=>row.name===name);assert.equal(sourceBytes.length,pinned.bytes);
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'),pinned.sha256);
  assert.equal(packet.schemaHash,'sha256:6f6af231a779d6c8e55a4d0acde8fa6e5af5d7c7c2f5b54e6aa5487b34bedb78');
  assert.equal(source.content,sourceText);assert.equal(source.byteLength,sourceBytes.length);
  assert.equal(source.sha256,createHash('sha256').update(sourceBytes).digest('hex'));
  assert.equal(request.schemaHash,packet.schemaHash);assert.equal(request.input.files.find(row=>row.path==='/src/main.ts').content,sourceText);
  assert.equal(packet.payload.functions.length,16);assert.equal(packet.payload.globals.length,2);assert.equal(packet.payload.modules.length,1);
  assert.equal(packet.payload.closure.roots.length,9);assert.equal(packet.payload.closure.requiredRoots.length,2);
  const maker=packet.payload.functions.find(fn=>fn.name==='makeOwnedReader'),
    reader=packet.payload.functions.find(fn=>fn.name==='readOwned'),a=maker.bindings.find(b=>b.name==='a'),
    r=maker.bindings.find(b=>b.name==='r'),seed=maker.parameters.find(b=>b.name==='seed'),
    aDeclaration=maker.body.find(row=>row.binding===a.id),rDeclaration=maker.body.find(row=>row.binding===r.id),
    assignment=reader.body[0].value,returned=reader.body.at(-1).value;
  assert.equal(reader.lexicalParent,maker.id);assert.equal(a.lexicalOwner,maker.id);assert.equal(r.lexicalOwner,maker.id);
  assert.equal(a.declaredType,'array<i32>');assert.equal(r.declaredType,'readSpan<i32>');
  assert.equal(a.writable,true);assert.equal(r.writable,false);assert.equal(aDeclaration.kind,'letDeclaration');
  assert.equal(aDeclaration.initializer.kind,'arrayLiteral');assert.equal(aDeclaration.initializer.elements[0].binding,seed.id);
  assert.equal(rDeclaration.kind,'constDeclaration');assert.equal(rDeclaration.initializer.kind,'call');
  assert.equal(rDeclaration.initializer.arguments[0].binding,a.id);
  assert.equal(assignment.kind,'bindingAssignment');assert.equal(assignment.operator,'=');assert.equal(assignment.target.binding,a.id);
  assert.equal(assignment.value.kind,'arrayLiteral');assert.equal(assignment.value.elements[0].kind,'binary');
  assert.equal(assignment.value.elements[0].operator,'+');assert.equal(assignment.value.elements[0].left.binding,seed.id);
  assert.equal(assignment.value.elements[0].right.token,'1');
  assert.notEqual(aDeclaration.initializer.allocationSite,assignment.value.allocationSite);
  assert.ok(assignment.range.end<=reader.body.at(-1).range.start,'the new Array write must precede old-span consumption');
  assert.deepEqual(reader.captures.filter(c=>c.binding===a.id).map(c=>[c.read,c.write]),[[false,true]]);
  assert.deepEqual(reader.captures.filter(c=>c.binding===r.id).map(c=>[c.read,c.write]),[[true,false]]);
  assert.equal(sourceText.slice(a.nameRange.start,a.nameRange.end),'a');assert.equal(sourceText.slice(r.nameRange.start,r.nameRange.end),'r');
  let holding=null;
  if(held){
    holding=maker.bindings.find(b=>b.name==='held');const declaration=maker.body.find(row=>row.binding===holding.id);
    assert.notEqual(holding.id,a.id);assert.equal(holding.lexicalOwner,maker.id);assert.equal(holding.writable,mode==='mutable');
    assert.equal(holding.declaredType,a.declaredType);assert.equal(declaration.kind,mode==='mutable'?'letDeclaration':'constDeclaration');
    if(mode==='unrelated'){assert.equal(declaration.initializer.kind,'arrayLiteral');
      assert.notEqual(declaration.initializer.allocationSite,aDeclaration.initializer.allocationSite);assert.equal(declaration.initializer.elements[0].binding,seed.id);}
    else{assert.equal(declaration.initializer.kind,'bindingReference');assert.equal(declaration.initializer.binding,a.id);}
    assert.ok(aDeclaration.range.end<declaration.range.start&&declaration.range.end<rDeclaration.range.start);
    assert.equal(sourceText.slice(holding.nameRange.start,holding.nameRange.end),'held');
    assert.deepEqual(reader.captures.filter(c=>c.binding===holding.id).map(c=>[c.read,c.write]),[[true,false]]);
    assert.equal(returned.kind,'binary');assert.equal(returned.operator,'+');
    assert.equal(returned.left.kind,'checkedElementAccess');assert.equal(returned.left.receiver.binding,r.id);
    assert.equal(returned.right.kind,'checkedElementAccess');assert.equal(returned.right.receiver.binding,holding.id);
    assert.equal(returned.left.index.token,'0');assert.equal(returned.right.index.token,'0');
  }else{
    assert.equal(maker.bindings.some(b=>b.name==='held'),false);
    assert.equal(returned.kind,'checkedElementAccess');assert.equal(returned.receiver.binding,r.id);assert.equal(returned.index.token,'0');
  }
  if(mode==='resize'){const mutation=reader.body[1].value;assert.equal(reader.body.length,3);
    assert.equal(mutation.kind,'lengthAssignment');assert.equal(mutation.operator,'=');assert.equal(mutation.target.receiver.binding,holding.id);
    assert.equal(mutation.value.token,'0');assert.ok(mutation.range.end<reader.body.at(-1).range.start);}
  const oracle=JSON.parse(readFileSync(new URL(pinned.oracle,factsDirectory),'utf8'));
  assert.equal(oracle.SourceSHA,pinned.sha256);assert.deepEqual(oracle.Diagnostics,[0,0,0,0]);
  assert.equal(maker.id,oracle.OwnerID);assert.equal(reader.id,oracle.ReaderID);
  for(const expected of Object.values(oracle.Bindings)){const actual=[...maker.parameters,...maker.bindings].find(row=>row.id===expected.ID);
    assert.ok(actual);assert.deepEqual(actual.nameRange,expected.NameRange);assert.deepEqual(actual.declarationRange,expected.DeclarationRange);assert.equal(actual.writable,expected.Writable);}
  assert.deepEqual([...reader.captures].sort((a,b)=>a.binding.localeCompare(b.binding)),[...oracle.Captures].sort((a,b)=>a.binding.localeCompare(b.binding)));
  const hir=projectCommonProgram(readCommonProgramFacts(bytes)),owner=hir.functions.find(fn=>fn.sourceBinding===maker.id),
    callable=hir.functions.find(fn=>fn.sourceBinding===reader.id),layout=hir.environments.find(env=>env.slots.some(slot=>slot.binding===a.id));
  assert.ok(layout);assert.equal(layout.owner,owner.id);assert.equal(callable.lexicalEnvironment,layout.id);
  const changing=layout.slots.find(slot=>slot.binding===a.id),span=layout.slots.find(slot=>slot.binding===r.id);
  assert.equal(changing.writable,true);assert.equal(hir.types.find(t=>t.id===changing.type).kind,'array');
  assert.equal(span.writable,false);assert.equal(hir.types.find(t=>t.id===span.type).kind,'readSpan');
  if(held){const stable=layout.slots.find(slot=>slot.binding===holding.id);
    assert.ok(stable);assert.equal(stable.writable,mode==='mutable');assert.equal(stable.type,changing.type);assert.notEqual(stable.key,changing.key);}
  const publication=createCommonProgramPublication(hir),record=publication.contracts.find(row=>row.functionId===callable.id),
    write=record.upper.captures.find(row=>row.slot===changing.key);
  assert.ok(write);assert.equal(write.write,true);assert.equal(write.structural,false,'reference Cell assignment is not old-buffer structural mutation');
  if(held){const stable=layout.slots.find(slot=>slot.binding===holding.id),access=record.upper.captures.find(row=>row.slot===stable.key);
    assert.ok(access);assert.equal(access.read,true);assert.equal(access.write,mode==='resize');assert.equal(access.structural,mode==='resize');}
  const targets=hir.closure.requiredRoots.filter(root=>root.kind==='kernel').map(root=>root.target).sort();assert.equal(targets.length,2);
  return {hir,publication,request:{targets}};
}

test('complete unheld reference Cell overwrite cannot retain the old span owner',()=>{
  const {hir,publication,request}=original('reference-cell-unheld-control','unheld');
  assert.throws(()=>commonProgramCore(hir,publication,request,{borrowProof:true}),error=>
    error instanceof Error&&'code' in error&&error.code==='r03-common-program-borrow-pending');
});

test('complete independent const held retains the original owner across another reference Cell write',()=>{
  const {hir,publication,request}=original('reference-cell-held-safe','safe'),program=commonProgramCore(hir,publication,request,{borrowProof:true});
  assert.ok(program.borrowProof);assert.ok(program.text.includes('tsfg_program.env_store'));assert.ok(program.text.includes('tsfg_program.array_read'));
  if(process.env.TSFG_REFERENCE_CELL_CORE_ROOT){
    mkdirSync(process.env.TSFG_REFERENCE_CELL_CORE_ROOT,{recursive:true});
    for(const [suffix,value]of [['.mlir',program.text],['.owned.json',canonical({hir,publication,request})+'\n'],['.proof.json',canonical(program.borrowProof)+'\n']])
      writeFileSync(process.env.TSFG_REFERENCE_CELL_CORE_ROOT+'/reference-cell-held-safe'+suffix,value,{flag:'wx'});
  }
});

for(const [name,mode]of [['reference-cell-held-unrelated','unrelated'],['reference-cell-held-mutable','mutable'],['reference-cell-held-resize','resize']])
test('complete reference Cell holding rejects '+mode,()=>{
  const {hir,publication,request}=original(name,mode);
  // Escape obligations precede liveness effects in the existing verifier. A
  // structurally writing reader is still outside the holding permission domain.
  assert.throws(()=>commonProgramCore(hir,publication,request,{borrowProof:true}),error=>
    error instanceof Error&&'code' in error&&error.code==='r03-common-program-borrow-pending');
});
