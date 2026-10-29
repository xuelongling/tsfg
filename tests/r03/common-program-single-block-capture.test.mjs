// SPDX-License-Identifier: MIT
// Complete Source packets retain the original block and checker binding IDs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,verifyCommonProgramHir,readCommonProgramHir,printCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const directory=new URL('./testdata/common-single-block-capture/',import.meta.url),
  names=readdirSync(directory).filter(name=>name.endsWith('.json')).map(name=>name.slice(0,-5)).sort(),
  packet=name=>readCommonProgramFacts(readFileSync(new URL(name+'.json',directory)));
function structure(rows){return rows.map(row=>({kind:row.kind,range:row.range,...(row.binding?{binding:row.binding}:{}),
  ...Object.fromEntries(['body','then','else'].filter(key=>row[key]).map(key=>[key,structure(row[key])]))}));}

for(const name of names)test('complete official single-entry block preserves original binding and initialization: '+name,()=>{
  const facts=packet(name),original=facts.payload.functions.find(fn=>fn.name==='blockEntry'),cells=original.bindings.filter(binding=>binding.name==='cell'),
    hir=projectCommonProgram(facts),owner=hir.functions.find(fn=>fn.sourceBinding===original.id),
    environment=hir.environments.find(env=>env.owner===owner.id);
  assert.ok(cells.length>0);assert.equal(new Set(hir.functions.map(fn=>fn.id)).size,hir.functions.length);
  assert.equal(new Set(environment.slots.map(slot=>slot.key)).size,environment.slots.length);
  assert.deepEqual(structure(owner.body),structure(original.body));
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(root=>root.kind==='kernel').map(root=>root.target).sort()},
    program=commonProgramCore(hir,publication,request,{borrowProof:true});
  assert.ok(program.borrowProof);
  for(const cell of cells){
    const slots=environment.slots.filter(slot=>slot.binding===cell.id),
      closures=hir.functions.filter(fn=>fn.captures.some(capture=>capture.binding===cell.id)),
      originalClosures=facts.payload.functions.filter(fn=>fn.captures.some(capture=>capture.binding===cell.id)),
      initializers=program.text.split('\n').filter(line=>line.includes('"tsfg_program.env_init"')&&line.includes(cell.id));
    assert.equal(slots.length,1);assert.equal(slots[0].writable,cell.writable);
    assert.equal(closures.length,originalClosures.length);assert.ok(closures.length>0);
    for(const fn of closures){const source=originalClosures.find(row=>row.id===fn.sourceBinding);
      assert.deepEqual(fn.captures,source.captures);assert.deepEqual(fn.declarationScope,source.declarationScope);
      assert.equal(fn.lexicalEnvironment,environment.id);}
    assert.equal(initializers.length,1);
    assert.ok(initializers[0].includes('tsfg_source.start = '+cell.declarationRange.start+' : i64'));
    assert.ok(initializers[0].includes('tsfg_source.end = '+cell.declarationRange.end+' : i64'));
  }
  if(process.env.TSFG_SINGLE_BLOCK_CORE_ROOT){
    mkdirSync(process.env.TSFG_SINGLE_BLOCK_CORE_ROOT,{recursive:true});
    for(const [suffix,text]of [['.mlir',program.text],['.proof.json',canonical(program.borrowProof)+'\n'],['.owned.json',canonical({hir,publication,request})+'\n']]){
      const path=process.env.TSFG_SINGLE_BLOCK_CORE_ROOT+'/'+name+suffix;
      if(existsSync(path))assert.equal(readFileSync(path,'utf8'),text);else writeFileSync(path,text,{flag:'wx'});
    }
  }
});

test('genuine offset changes preserve the original scope semantic identities',()=>{
  const views=['if-let','if-const'].map(name=>{
    const hir=projectCommonProgram(packet(name)),owner=hir.functions.find(fn=>fn.name==='blockEntry'),
      slot=hir.environments.find(env=>env.owner===owner.id).slots.find(slot=>owner.bindings.some(binding=>binding.id===slot.binding&&binding.name==='cell')),
      reader=hir.functions.find(fn=>fn.lexicalParent===owner.id&&fn.name==='read');
    return {owner:owner.id,key:slot.key,binding:slot.binding,reader:reader.id,writable:slot.writable};
  });
  assert.notEqual(views[0].binding,views[1].binding);assert.notEqual(views[0].writable,views[1].writable);
  assert.equal(views[0].owner,views[1].owner);assert.equal(views[0].key,views[1].key);assert.equal(views[0].reader,views[1].reader);
});

for(const change of ['owner','scope','const','sibling-binding','sibling-function','repeated-claim'])test('cold block Source rejects '+change,()=>{
  const value=structuredClone(packet(change==='const'?'if-const':change.startsWith('sibling')?'same-name-blocks':'if-let')),
    owner=value.payload.functions.find(fn=>fn.name==='blockEntry'),cells=owner.bindings.filter(binding=>binding.name==='cell'),
    child=value.payload.functions.find(fn=>fn.captures.some(capture=>capture.binding===cells[0].id));
  if(change==='owner')cells[0].lexicalOwner=child.id;
  if(change==='scope')child.declarationScope=structuredClone(owner.declarationScope);
  if(change==='const')cells[0].writable=true;
  if(change==='sibling-binding'){
    const reader=value.payload.functions.find(fn=>fn.name==='read'&&fn.captures.some(capture=>capture.binding===cells[0].id));
    reader.captures[0].binding=cells[1].id;reader.body[0].value.binding=cells[1].id;
  }
  if(change==='sibling-function'){
    const branches=owner.body.filter(row=>row.kind==='if'),calls=branches.map(branch=>branch.then.find(row=>row.kind==='constDeclaration').initializer);
    calls[0].callee=calls[1].callee;calls[0].signature=structuredClone(calls[1].signature);
  }
  if(change==='repeated-claim'){const row=owner.body[0];row.kind='while';row.body=row.then;delete row.then;delete row.else;}
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(value.payload));
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(value)+'\n')),error=>error instanceof Error&&'code'in error&&error.code===({
    owner:'r03-common-program-lexical',scope:'r03-common-program-lexical',const:'r03-common-program-binding',
    'sibling-binding':'r03-common-program-binding','sibling-function':'r03-common-program-scope','repeated-claim':'r03-common-program-capability'
  })[change]);
});

for(const change of ['key','owner','binding','type','scope-path','init-location'])test('cold scoped environment rejects '+change,()=>{
  const hir=structuredClone(projectCommonProgram(packet('same-name-blocks'))),owner=hir.functions.find(fn=>fn.name==='blockEntry'),
    env=hir.environments.find(env=>env.owner===owner.id),slot=env.slots[0];
  if(change==='key')slot.key='foreign-slot';if(change==='owner')env.owner='foreign-owner';
  if(change==='binding')slot.binding='foreign-binding';if(change==='type')slot.type='foreign-type';
  if(change==='scope-path')hir.functions.find(fn=>fn.lexicalParent===owner.id).declKey.path=[];
  if(change==='init-location'){const branch=owner.body.find(row=>row.kind==='if'),declaration=branch.then.shift();owner.body.unshift(declaration);}
  assert.throws(()=>verifyCommonProgramHir(hir),error=>error instanceof Error&&'code'in error&&error.code==='r03-common-program-reconstruct');
});
