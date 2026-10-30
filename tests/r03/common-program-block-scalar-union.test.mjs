// SPDX-License-Identifier: MIT
// Whole official Source packets combine existing logical types and block scopes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,verifyCommonProgramHir,readCommonProgramHir,printCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {canonical,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
const directory=new URL('./testdata/common-block-scalar-union/',import.meta.url),
  cases=[
    {name:'if-let',sha:'9d6b817efbbbdb3a135afb1439acbda2170a19211595a5a85b2ccc6047bd60dc',presence:[],written:['bool']},
    {name:'if-null',sha:'c9c9d877b5ba49a107fe897d23e437aa543eeaa2077582bf16fb93beae35c119',presence:['null'],written:['null']},
    {name:'if-undefined',sha:'79ab89b4edf99d6ba64089599c12cbc414ce95f9861c669bc8981b6dd8b9a7c2',presence:['undefined'],written:['undefined']},
    {name:'if-both',sha:'fd22e55f10da83b8e450c0187156e7092264e0c48f75a680a7788f2abaa758c6',presence:['null','undefined'],written:['null','undefined']}
  ],
  typeId=name=>scalarTypeIds[name]??sha256('tsfg.type\0'+name);
function originalStructure(rows){return rows.map(row=>({kind:row.kind,range:row.range,...(row.binding?{binding:row.binding}:{}),
  ...Object.fromEntries(['body','then','else'].filter(key=>row[key]).map(key=>[key,originalStructure(row[key])]))}));}

for(const row of cases)test('complete official block scalar-union shared slot: '+row.name,()=>{
  const bytes=readFileSync(new URL(row.name+'.json',directory));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha);
  const facts=readCommonProgramFacts(bytes),sourceOwner=facts.payload.functions.find(fn=>fn.name==='blockEntry'),
    cell=sourceOwner.bindings.find(binding=>binding.name==='cell'),sourceType=facts.payload.types.find(type=>type.id===cell.declaredType),
    hir=projectCommonProgram(facts),owner=hir.functions.find(fn=>fn.sourceBinding===sourceOwner.id),
    environment=hir.environments.find(env=>env.owner===owner.id),slots=environment.slots.filter(slot=>slot.binding===cell.id),
    types=new Map(hir.types.map(type=>[type.id,type])),members=['bool','i32',...row.presence].sort();
  assert.deepEqual(sourceType.members,members);assert.equal(slots.length,1);
  assert.equal(slots[0].writable,cell.writable);assert.equal(slots[0].writable,true);
  assert.deepEqual(types.get(slots[0].type).members,members.map(typeId).sort());
  assert.deepEqual(originalStructure(owner.body),originalStructure(sourceOwner.body));
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  const originalClosures=facts.payload.functions.filter(fn=>fn.captures.some(capture=>capture.binding===cell.id)),
    closures=hir.functions.filter(fn=>fn.captures.some(capture=>capture.binding===cell.id));
  assert.equal(closures.length,2);assert.equal(originalClosures.length,2);
  for(const fn of closures){const original=originalClosures.find(source=>source.id===fn.sourceBinding);
    assert.deepEqual(fn.captures,original.captures);assert.deepEqual(fn.declarationScope,original.declarationScope);
    assert.equal(fn.lexicalEnvironment,environment.id);assert.equal(fn.lexicalParent,owner.id);}
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(root=>root.kind==='kernel').map(root=>root.target).sort()},
    program=commonProgramCore(hir,publication,request,{borrowProof:true}),
    initializers=program.text.split('\n').filter(line=>line.includes('"tsfg_program.env_init"')&&line.includes(cell.id));
  assert.ok(program.borrowProof);assert.equal(initializers.length,1);
  assert.ok(initializers[0].includes('tsfg_source.start = '+cell.declarationRange.start+' : i64'));
  assert.ok(initializers[0].includes('tsfg_source.end = '+cell.declarationRange.end+' : i64'));
  const carrier=program.representation.bindings.find(binding=>binding.id===cell.id).carrier,
    domain=program.representation.domains.find(value=>value.id===carrier),actual=domain?.actualTypes??[carrier];
  assert.deepEqual(actual,['i32',...row.written].map(typeId).sort());
  if(domain){assert.equal(domain.referenceCount,0);if(actual.length>1)assert.equal(domain.tagBytes,2);}
  const changed=structuredClone(hir),slot=changed.environments.find(env=>env.id===environment.id).slots.find(value=>value.binding===cell.id);
  slot.type=scalarTypeIds.i32;
  assert.throws(()=>verifyCommonProgramHir(changed),error=>error instanceof Error&&'code'in error&&error.code==='r03-common-program-reconstruct');
  if(process.env.TSFG_BLOCK_SCALAR_UNION_CORE_ROOT){
    mkdirSync(process.env.TSFG_BLOCK_SCALAR_UNION_CORE_ROOT,{recursive:true});
    for(const [suffix,text]of [['.mlir',program.text],['.proof.json',canonical(program.borrowProof)+'\n'],['.owned.json',canonical({hir,publication,request})+'\n']]){
      const path=process.env.TSFG_BLOCK_SCALAR_UNION_CORE_ROOT+'/'+row.name+suffix;
      if(existsSync(path))assert.equal(readFileSync(path,'utf8'),text);else writeFileSync(path,text,{flag:'wx'});
    }
  }
});
