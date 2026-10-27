// SPDX-License-Identifier: MIT
// Controlled source/identity data only: no executable or compiler result is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyCoreIrInputs} from '../../eng/core-ir-inputs.mjs';
import {sha256} from '../../compiler/identity.mjs';
const storage=process.env.TSFG_TEST_STORAGE;
if(!storage)throw new Error('TSFG_TEST_STORAGE must name the owned test root');
async function fixture(label){
  const productRoot=path.join(storage,label),source={sources:['main.cpp','added.cpp'],headers:['added.h']},
    files=new Map([
      ['compiler/core-ir/sources.json',JSON.stringify(source)+'\n'],
      ['compiler/core-ir/CMakeLists.txt','# controlled source list\n'],
      ['compiler/core-ir/main.cpp','// controlled original\n'],
      ['compiler/core-ir/added.cpp','// controlled added TU\n'],
      ['compiler/core-ir/added.h','// controlled added header\n'],
      ['eng/core-ir-inputs.mjs',await readFile(new URL('../../eng/core-ir-inputs.mjs',import.meta.url),'utf8')]
    ]);
  for(const [name,bytes]of files){await mkdir(path.dirname(path.join(productRoot,name)),{recursive:true});await writeFile(path.join(productRoot,name),bytes,{flag:'wx'});}
  const manifest={buildInputSet:{entries:[...files].map(([repositoryRelativePath,bytes])=>({projectId:'tsfg',repositoryRelativePath,sha256:sha256(bytes)}))}};
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
  const {manifest,productRoot,source}=await fixture('escape');source.sources.push('../outside.cpp');
  const bytes=JSON.stringify(source)+'\n';await writeFile(path.join(productRoot,'compiler/core-ir/sources.json'),bytes);
  manifest.buildInputSet.entries.find(r=>r.repositoryRelativePath.endsWith('sources.json')).sha256=sha256(bytes);
  await assert.rejects(verifyCoreIrInputs(manifest,productRoot),/Core source directory differs/);
});
