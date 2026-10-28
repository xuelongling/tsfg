// SPDX-License-Identifier: MIT
// Product source/identity staging only; this never creates compiler outputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageMlirProductSources} from '../../eng/mlir-build.mjs';
import {selectMlirCommandRole} from '../../eng/mlir-command.mjs';
import {assertMlirRoleDependency} from '../../eng/mlir-static-closure.mjs';
import {sha256} from '../../compiler/identity.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),storage=process.env.TSFG_TEST_STORAGE,
  command=selectMlirCommandRole(new Map([['--core-command-role','static']]));
if(!storage)throw new Error('TSFG_TEST_STORAGE must name the owned data-fixture root');
async function sourceIdentity(){
  const manifest=JSON.parse(await readFile(path.join(root,'compiler/core-ir/sources.json'),'utf8')),
    names=['compiler/core-ir/CMakeLists.txt','compiler/core-ir/sources.json','eng/core-ir-inputs.mjs',
      ...[...manifest.common.sources,...manifest.common.headers,...manifest.static.sources,...manifest.static.headers].map(n=>'compiler/core-ir/'+n),
      ...manifest.common.externalHeaders,...manifest.static.externalHeaders,'eng/mlir-python-policy.cmake',
      'eng/mlir-compiler-launcher.mjs','eng/mlir-configuration-sources.cmake'];
  const entries=await Promise.all(names.map(async name=>({projectId:'tsfg',repositoryRelativePath:name,sha256:sha256(await readFile(path.join(root,name)))})));
  return{names,identity:{buildIdentity:{options:{coreCommandRole:'static'}},buildInputSet:{entries}}};
}
test('actual Core source manifest and policy controls stage byte-exactly via production function',async()=>{
  const {names,identity}=await sourceIdentity(),product=path.join(storage,'current-product');
  const staged=await stageMlirProductSources({productRoot:root,product,identity,command});
  assert.deepEqual(staged,names);
  const manifest=JSON.parse(await readFile(path.join(root,'compiler/core-ir/sources.json'),'utf8'));
  assert.equal(names.length,manifest.common.sources.length+manifest.common.headers.length+manifest.static.sources.length+
    manifest.static.headers.length+manifest.common.externalHeaders.length+manifest.static.externalHeaders.length+6);
  const roots={source:path.join(storage,'upstream'),product,build:path.join(storage,'build'),productInputs:new Set(staged)};
  for(const name of names){
    assert.deepEqual(await readFile(path.join(product,name)),await readFile(path.join(root,name)));
    assert.doesNotThrow(()=>assertMlirRoleDependency(command,path.join(product,name),roots));
  }
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
for(const role of ['static','native'])test('role-selected '+role+' staging owns only its declared adapter and runtime header',async()=>{
  const productRoot=path.join(storage,role+'-input'),product=path.join(storage,role+'-output'),catalog={
    common:{sources:['shared.cpp'],headers:['shared.h'],externalHeaders:[]},
    static:{sources:['static-main.cpp'],headers:[],externalHeaders:[]},
    native:{sources:['main.cpp','native-adapter.cpp'],headers:[],externalHeaders:['runtime/private-core.h']}
  };
  const files=new Map([
    ['compiler/core-ir/sources.json',JSON.stringify(catalog)+'\n'],['compiler/core-ir/CMakeLists.txt','# controlled role declaration\n'],
    ['compiler/core-ir/shared.cpp','// controlled common source\n'],['compiler/core-ir/shared.h','// controlled common header\n']
  ]);
  if(role==='static')files.set('compiler/core-ir/static-main.cpp','// controlled static adapter\n');
  else{
    files.set('compiler/core-ir/main.cpp','// controlled native entry\n');
    files.set('compiler/core-ir/native-adapter.cpp','// controlled native adapter\n');
    files.set('runtime/private-core.h','// controlled private header\n');
  }
  for(const name of ['eng/core-ir-inputs.mjs','eng/mlir-python-policy.cmake','eng/mlir-compiler-launcher.mjs',...(role==='static'?['eng/mlir-configuration-sources.cmake']:[])])
    files.set(name,await readFile(path.join(root,name),'utf8'));
  for(const [name,bytes]of files){await mkdir(path.dirname(path.join(productRoot,name)),{recursive:true});await writeFile(path.join(productRoot,name),bytes,{flag:'wx'});}
  const identity={buildIdentity:{options:{coreCommandRole:role}},buildInputSet:{entries:[...files].map(([repositoryRelativePath,bytes])=>({projectId:'tsfg',repositoryRelativePath,sha256:sha256(bytes)}))}},
    selected=selectMlirCommandRole(new Map([['--core-command-role',role]]));
  const staged=await stageMlirProductSources({productRoot,product,identity,command:selected});
  assert.deepEqual([...staged].sort(),[...files.keys()].sort());
  for(const [name,bytes]of files)assert.equal((await readFile(path.join(product,name),'utf8')),bytes);
  if(role==='static'){
    assert.ok(!staged.includes('compiler/core-ir/native-adapter.cpp'));
    assert.ok(!staged.includes('runtime/private-core.h'));
    assert.deepEqual((await readdir(path.join(product,'compiler/core-ir'))).sort(),['CMakeLists.txt','shared.cpp','shared.h','sources.json','static-main.cpp']);
  }else assert.ok(staged.includes('runtime/private-core.h'));
});
