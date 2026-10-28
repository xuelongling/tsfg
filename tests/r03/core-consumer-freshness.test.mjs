// SPDX-License-Identifier: MIT
// Controlled source/identity data only: no executable or compiler result is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyCoreIrInputs} from '../../eng/core-ir-inputs.mjs';
import {assertMlirRoleDependency} from '../../eng/mlir-static-closure.mjs';
import {selectMlirCommandRole} from '../../eng/mlir-command.mjs';
import {sha256} from '../../compiler/identity.mjs';
const storage=process.env.TSFG_TEST_STORAGE;
if(!storage)throw new Error('TSFG_TEST_STORAGE must name the owned test root');
async function fixture(label,role='static'){
  const productRoot=path.join(storage,label),source={
    common:{sources:['added.cpp'],headers:['added.h'],externalHeaders:[]},
    static:{sources:['static-main.cpp'],headers:[],externalHeaders:[]},
    native:{sources:['main.cpp','native-adapter.cpp'],headers:[],externalHeaders:['runtime/private-core.h']}
  },
    files=new Map([
      ['compiler/core-ir/sources.json',JSON.stringify(source)+'\n'],
      ['compiler/core-ir/CMakeLists.txt','# controlled source list\n'],
      ['compiler/core-ir/added.cpp','// controlled added TU\n'],
      ['compiler/core-ir/added.h','// controlled added header\n'],
      ['eng/core-ir-inputs.mjs',await readFile(new URL('../../eng/core-ir-inputs.mjs',import.meta.url),'utf8')]
    ]);
  if(role==='static')files.set('compiler/core-ir/static-main.cpp','// controlled static entry\n');
  else{
    files.set('compiler/core-ir/main.cpp','// controlled native entry\n');
    files.set('compiler/core-ir/native-adapter.cpp','// controlled native adapter\n');
    files.set('runtime/private-core.h','// controlled cross-directory header\n');
  }
  for(const [name,bytes]of files){await mkdir(path.dirname(path.join(productRoot,name)),{recursive:true});await writeFile(path.join(productRoot,name),bytes,{flag:'wx'});}
  const manifest={coreCommandRole:role,buildIdentity:{options:{coreCommandRole:role}},
    buildInputSet:{entries:[...files].map(([repositoryRelativePath,bytes])=>({projectId:'tsfg',repositoryRelativePath,sha256:sha256(bytes)}))}};
  return{productRoot,manifest,source};
}
test('complete current manifest source declaration passes the real consumer source gate',async()=>{
  const {manifest,productRoot}=await fixture('complete');await verifyCoreIrInputs(manifest,productRoot);
});
test('member omitted by the old two-file list is required',async()=>{
  const {manifest,productRoot}=await fixture('omitted');manifest.buildInputSet.entries=manifest.buildInputSet.entries.filter(r=>!r.repositoryRelativePath.endsWith('added.h'));
  await assert.rejects(verifyCoreIrInputs(manifest,productRoot),/compiled input differs.*added.h/);
});
test('changed added TU fails current compiled source identity',async()=>{
  const {manifest,productRoot}=await fixture('changed');await writeFile(path.join(productRoot,'compiler/core-ir/added.cpp'),'// changed\n');
  await assert.rejects(verifyCoreIrInputs(manifest,productRoot),/compiled input differs.*added.cpp/);
});
test('source manifest itself must be included in compiled identity',async()=>{
  const {manifest,productRoot}=await fixture('manifest-missing');manifest.buildInputSet.entries=manifest.buildInputSet.entries.filter(r=>!r.repositoryRelativePath.endsWith('sources.json'));
  await assert.rejects(verifyCoreIrInputs(manifest,productRoot),/compiled input differs.*sources.json/);
});
test('duplicate compiled member identity fails instead of selecting the first row',async()=>{
  const {manifest,productRoot}=await fixture('duplicate');manifest.buildInputSet.entries.push({...manifest.buildInputSet.entries.find(r=>r.repositoryRelativePath.endsWith('added.h'))});
  await assert.rejects(verifyCoreIrInputs(manifest,productRoot),/compiled input differs.*added.h/);
});
test('manifest member cannot escape the exact Core source directory',async()=>{
  const {manifest,productRoot,source}=await fixture('escape');source.common.sources.push('../outside.cpp');
  const bytes=JSON.stringify(source)+'\n';await writeFile(path.join(productRoot,'compiler/core-ir/sources.json'),bytes);
  manifest.buildInputSet.entries.find(r=>r.repositoryRelativePath.endsWith('sources.json')).sha256=sha256(bytes);
  await assert.rejects(verifyCoreIrInputs(manifest,productRoot),/Core source directory differs/);
});
test('role-owned catalog checks only the selected actual product root and its private headers',async()=>{
  const {manifest,productRoot}=await fixture('role-static'),
    native=await fixture('role-native','native');
  const staticNames=await verifyCoreIrInputs(manifest,productRoot),nativeNames=await verifyCoreIrInputs(native.manifest,native.productRoot);
  assert.ok(staticNames.includes('compiler/core-ir/added.h'));
  assert.ok(staticNames.includes('compiler/core-ir/static-main.cpp'));
  assert.ok(!staticNames.includes('compiler/core-ir/native-adapter.cpp'));
  assert.ok(!staticNames.includes('runtime/private-core.h'));
  assert.ok(nativeNames.includes('runtime/private-core.h'));
  const command=selectMlirCommandRole(new Map([['--core-command-role','static']])),
    roots={source:path.join(productRoot,'source'),product:productRoot,build:path.join(productRoot,'build'),productInputs:new Set(staticNames)};
  for(const name of ['compiler/core-ir/added.cpp','compiler/core-ir/added.h','compiler/core-ir/static-main.cpp'])
    assert.doesNotThrow(()=>assertMlirRoleDependency(command,path.join(productRoot,name),roots));
  for(const name of ['compiler/core-ir/native-adapter.cpp','runtime/private-core.h'])
    assert.throws(()=>assertMlirRoleDependency(command,path.join(productRoot,name),roots),{issueCode:'mlir-source-integrity'});
  await writeFile(path.join(native.productRoot,'runtime/private-core.h'),'// changed private header\n');
  await assert.rejects(verifyCoreIrInputs(native.manifest,native.productRoot),/compiled input differs.*runtime\/private-core.h/);
  await writeFile(path.join(native.productRoot,'runtime/private-core.h'),'// controlled cross-directory header\n');
  native.manifest.buildInputSet.entries=native.manifest.buildInputSet.entries.filter(r=>r.repositoryRelativePath!=='runtime/private-core.h');
  await assert.rejects(verifyCoreIrInputs(native.manifest,native.productRoot),/compiled input differs.*runtime\/private-core.h/);
  await verifyCoreIrInputs(manifest,productRoot);
});
test('selected command role must match the compiled role before source access',async()=>{
  const {manifest,productRoot}=await fixture('wrong-role');
  await assert.rejects(verifyCoreIrInputs(manifest,productRoot,'native'),/compiled command role differs/);
  manifest.coreCommandRole='native';
  await assert.rejects(verifyCoreIrInputs(manifest,productRoot),/compiled command role differs/);
});
test('cross-directory header cannot escape the owned runtime header directory',async()=>{
  const {manifest,productRoot,source}=await fixture('header-escape');source.native.externalHeaders=['runtime/../outside.h'];
  const bytes=JSON.stringify(source)+'\n';await writeFile(path.join(productRoot,'compiler/core-ir/sources.json'),bytes);
  manifest.buildInputSet.entries.find(r=>r.repositoryRelativePath.endsWith('sources.json')).sha256=sha256(bytes);
  await assert.rejects(verifyCoreIrInputs(manifest,productRoot),/Core source directory differs/);
});
