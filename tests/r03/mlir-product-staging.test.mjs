// SPDX-License-Identifier: MIT
// Product source/identity staging only; this never creates compiler outputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageMlirProductSources} from '../../eng/mlir-build.mjs';
import {selectMlirCommandRole} from '../../eng/mlir-command.mjs';
import {sha256} from '../../compiler/identity.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),storage=process.env.TSFG_TEST_STORAGE,
  command=selectMlirCommandRole(new Map([['--core-command-role','static']]));
if(!storage)throw new Error('TSFG_TEST_STORAGE must name the owned data-fixture root');
async function sourceIdentity(){
  const manifest=JSON.parse(await readFile(path.join(root,'compiler/core-ir/sources.json'),'utf8')),
    names=['compiler/core-ir/CMakeLists.txt','compiler/core-ir/sources.json','eng/core-ir-inputs.mjs',
      ...[...manifest.sources,...manifest.headers].map(n=>'compiler/core-ir/'+n),'eng/mlir-python-policy.cmake',
      'eng/mlir-compiler-launcher.mjs','eng/mlir-configuration-sources.cmake'];
  const entries=await Promise.all(names.map(async name=>({projectId:'tsfg',repositoryRelativePath:name,sha256:sha256(await readFile(path.join(root,name)))})));
  return{names,identity:{buildInputSet:{entries}}};
}
test('actual manifest49CPP23H and policy controls stage byte-exactly via production function',async()=>{
  const {names,identity}=await sourceIdentity(),product=path.join(storage,'current-product');
  await stageMlirProductSources({productRoot:root,product,identity,command});
  assert.equal(names.length,78);
  for(const name of names)assert.deepEqual(await readFile(path.join(product,name)),await readFile(path.join(root,name)));
});
for(const missing of ['compiler/core-ir/common-program-header.h','eng/mlir-configuration-sources.cmake'])
  test('missing declared '+missing+' refuses before copying',async()=>{
    const {identity}=await sourceIdentity(),product=path.join(storage,'missing-'+path.basename(missing));
    await mkdir(product,{recursive:true});identity.buildInputSet.entries=identity.buildInputSet.entries.filter(r=>r.repositoryRelativePath!==missing);
    await assert.rejects(stageMlirProductSources({productRoot:root,product,identity,command}),/absent|differs/);
    assert.deepEqual(await readdir(product),[]);
  });
test('changed declared Core member refuses before copying',async()=>{
  const {identity}=await sourceIdentity(),product=path.join(storage,'changed-product');await mkdir(product,{recursive:true});
  identity.buildInputSet.entries.find(r=>r.repositoryRelativePath.endsWith('common-program-header.h')).sha256='sha256:'+'0'.repeat(64);
  await assert.rejects(stageMlirProductSources({productRoot:root,product,identity,command}),/differs/);assert.deepEqual(await readdir(product),[]);
});
