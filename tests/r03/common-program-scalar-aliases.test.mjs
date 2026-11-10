// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts,verifyCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';

const fixtures=[{name:'plain',rawName:'Num',pins:[
  '0a6640aa82b5e40edc307e3406969091b9d272facb78fb784afd43abd74344bb',
  '4f069bcc5794c559c91a0efef72e36a4dcb1a5e6ae835feaea4a6ef7ab5b4e5b',
  '08dd91169f5fc55ba693d59435356d7fdfee4c97287183c3149095c96ee1acaa'
]},{name:'escaped',rawName:'\\u004Eum',pins:[
  '9cd0b30879f6b50f740097baf57aff51bf7cd2e4ffd49ec31ec448b2afcddc00',
  'a260dfe0449014d82c28b0d187886a0dfb6a9a0d76ed375e3163485bfb2b9af1',
  'f12b76a788f1048764c26d3037f2b8f989c117dbc8ea1d7376ac8fc0b27e9a3b'
]}];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reportRoot=process.env.TSFG_SCALAR_ALIAS_REPORTS;
const reports=reportRoot?JSON.parse(await fs.readFile(path.join(reportRoot,'index.json'),'utf8')):null;
for(const fixture of fixtures){
  /** @type {{core:string,inputIdentity:string,functions:string[]}|undefined} */
  let generated;
  test('complete official '+fixture.name+' scalar alias keeps original Symbol and i32 identity',async()=>{
  const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/common-program-scalar-aliases-v3/'+fixture.name+'/'+name,import.meta.url))));
  raw.forEach((bytes,index)=>assert.equal(sha(bytes),fixture.pins[index]));
  const oracle=JSON.parse(raw[1].toString('utf8')),source=raw[2].toString('utf8');
  assert.deepEqual(oracle.diagnostics,[]);assert.equal(oracle.sourceSha256,sha(raw[2]));assert.deepEqual(oracle.sourceRange,{start:0,end:source.length});
  const facts=readCommonProgramFacts(raw[0]);
  assert.equal(facts.payload.files.length,2);assert.equal(facts.payload.functions.length,3);assert.equal(facts.payload.closure.roots.length,4);
  assert.equal(facts.payload.typeAliases.length,1);const alias=facts.payload.typeAliases[0];
  assert.deepEqual(alias,oracle.aliases[0].declaration);assert.equal(alias.name,'Num');assert.equal(alias.type,'i32');
  assert.equal(source.slice(alias.nameRange.start,alias.nameRange.end),fixture.rawName);
  assert.equal(source.slice(alias.annotationRange.start,alias.annotationRange.end),'i32');
  for(const annotation of oracle.annotations){assert.equal(annotation.aliasId,alias.id);assert.equal(annotation.cookedName,'Num');assert.equal(source.slice(annotation.range.start,annotation.range.end),fixture.rawName);}
  const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:facts.version,factsBytes:raw[0],expectedPackageId:facts.packageId});
  assert.equal(hir.functions.length,3);assert.equal(hir.sources.length,2);assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,source);
  assert.ok(hir.types.every(type=>type.name!=='Num'),'alias adds no carrier type');
  for(const original of oracle.functions){
    const fn=hir.functions.find(row=>row.sourceBinding===original.id);assert.ok(fn);assert.deepEqual(fn.range,original.range);
    assert.equal(fn.parameters.length,1);assert.equal(fn.parameters[0].sourceBinding,original.parameterId);assert.deepEqual(fn.parameters[0].range,original.parameterRange);
    const parameterType=hir.types.find(type=>type.id===fn.parameters[0].type),returnType=hir.types.find(type=>type.id===fn.returnType);
    assert.equal(parameterType.kind,'scalar');assert.equal(parameterType.name,'i32');assert.equal(returnType.id,parameterType.id);
    const returned=fn.body.find(row=>row.kind==='return');assert.ok(returned);assert.deepEqual(returned.range,original.return);assert.deepEqual(returned.value.range,original.expression);
  }
  const publication=createCommonProgramPublication(hir);assert.equal(publication.contracts.length,3);
  const request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};assert.equal(request.targets.length,2);
  const core=commonProgramCore(hir,publication,request,{borrowProof:true});assert.ok(core.borrowProof);assert.ok(core.text.includes(hir.inputIdentity));
  generated={core:core.text,inputIdentity:hir.inputIdentity,functions:hir.functions.map(fn=>fn.id)};
  if(process.env.TSFG_SCALAR_ALIAS_CORE){const directory=process.env.TSFG_SCALAR_ALIAS_CORE;assert.ok(path.isAbsolute(directory));await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,fixture.name+'.mlir'),core.text,{flag:'wx'});}
  });
  test('actual C++ canonical reader retains complete '+fixture.name+' scalar alias input',
    {skip:reportRoot?false:'TSFG_SCALAR_ALIAS_REPORTS is not supplied'},async()=>{
      assert.ok(generated);assert.ok(path.isAbsolute(reportRoot));const directory=reports[fixture.name];assert.ok(path.isAbsolute(directory));
      const observed=JSON.parse(await fs.readFile(path.join(directory,'observed.json'),'utf8')),child=JSON.parse(await fs.readFile(path.join(directory,'child.json'),'utf8'));
      assert.equal(observed.qualified,true);assert.deepEqual(observed.first,[]);assert.equal(observed.exit.code,0);assert.equal(observed.close.code,0);
      assert.equal(child.qualified,true);assert.deepEqual(child.first,[]);assert.equal(child.exit.code,0);assert.equal(child.close.code,0);
      assert.ok(Number.isSafeInteger(child.pid)&&child.pid>0);assert.deepEqual(child.args,['--common-program','--canonicalize']);assert.deepEqual(child.inputBefore,child.inputAfter);
      assert.equal(sha(await fs.readFile(child.input)),sha(generated.core));
      const stdout=await fs.readFile(path.join(directory,'raw/stdout.bin'),'utf8');assert.equal(await fs.readFile(path.join(directory,'raw/stderr.bin'),'utf8'),'');
      assert.ok(stdout.includes(generated.inputIdentity));for(const id of generated.functions)assert.ok(stdout.includes('program_'+id.slice(7)));
    });
}

test('public facts reject untrusted scalar alias target, original ranges and Source identity',async()=>{
  const bytes=await fs.readFile(new URL('./testdata/common-program-scalar-aliases-v3/plain/package.json',import.meta.url));
  const original=JSON.parse(bytes.toString('utf8'));readCommonProgramFacts(bytes);
  for(const [field,value,code]of [['type','u32','source'],['type',original.payload.typeAliases[0].id,'type-alias'],['sourcePath','/src/minimal-arrays-v8.d.ts','type-alias'],['name','Other','source']]){
    const untrusted=structuredClone(original);untrusted.payload.typeAliases[0][field]=value;
    assert.throws(()=>verifyCommonProgramFacts(untrusted),{code:'r03-common-program-'+code},field+' preserves its original validation layer');
  }
  const untrusted=structuredClone(original);untrusted.payload.typeAliases[0].annotationRange.end--;
  assert.throws(()=>verifyCommonProgramFacts(untrusted),{code:'r03-common-program-source'});
});
