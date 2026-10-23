// SPDX-License-Identifier: MIT
// Exercise production copy/admission with data-only artifacts; no executable is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageMlirProductSources} from '../../eng/mlir-build.mjs';
import {verifiedConsumer} from '../../compiler/pipeline.mjs';
import {createMlirFixture} from './mlir-fixtures.mjs';
const productRoot=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const coreRoot=path.join(productRoot,'compiler/core-ir');
const cmake=await readFile(path.join(coreRoot,'CMakeLists.txt'),'utf8');
// This finite target declaration and its quoted local headers are the independent
// closure oracle. Do not execute or generally interpret CMake to discover inputs.
const common=/add_library\(tsfg-core-common OBJECT\s+([\s\S]*?)\)/.exec(cmake);
const native=/add_llvm_executable\(tsfg-core-ir\s+([\s\S]*?)\)/.exec(cmake);
const ordinary=/add_llvm_executable\(tsfg-core-static\s+([\s\S]*?)\)/.exec(cmake);
assert.ok(common);assert.ok(native);assert.ok(ordinary);
const ordinarySource=/^DISABLE_LLVM_LINK_LLVM_DYLIB\s+(static-main\.cpp)$/.exec(ordinary[1].trim());
assert.ok(ordinarySource);
const translationUnits=[common[1],native[1],ordinarySource[1]].flatMap(row=>row.trim().split(/\s+/));
assert.equal(translationUnits.length,98);
assert.equal(new Set(translationUnits).size,98);
for(const name of translationUnits)assert.match(name,/^[a-z0-9_-]+\.cpp$/);
const closure=new Set(['compiler/core-ir/CMakeLists.txt']),pending=translationUnits.map(name=>'compiler/core-ir/'+name);
while(pending.length){const name=pending.pop();if(closure.has(name))continue;closure.add(name);
 const text=await readFile(path.join(productRoot,name),'utf8');
 for(const match of text.matchAll(/^#include "([a-z0-9_-]+\.h|\.\.\/\.\.\/runtime\/aot-(?:instance|program)\.h)"/gm))
  pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1])));
}
const coreFiles=[...closure].sort();
assert.equal(coreFiles.length,156);
const declaration=JSON.parse(await readFile(path.join(productRoot,'eng/build-inputs.json'),'utf8'));
const entries=await Promise.all(declaration.entries.map(async entry=>({projectId:entry.projectId,
 repositoryRelativePath:entry.path,sha256:hash(await readFile(path.join(productRoot,entry.path)))})));
const identity={buildInputSet:{entries}};
for(const name of coreFiles)assert.equal(entries.filter(row=>row.repositoryRelativePath===name).length,1);
const stageFiles=[...coreFiles,'eng/mlir-python-policy.cmake','eng/mlir-compiler-launcher.mjs'];
const omitted='compiler/core-ir/array-publication.cpp';
async function fixture(label){return createMlirFixture('m14l-'+label+'-');}
async function allFiles(root,prefix=''){const result=[];
 for(const item of await readdir(path.join(root,prefix),{withFileTypes:true})){
  const name=prefix?prefix+'/'+item.name:item.name;
  if(item.isDirectory())result.push(...await allFiles(root,name));else result.push(name);
 }return result.sort();
}
function changedIdentity(name,replace){return {buildInputSet:{entries:entries.flatMap(row=>
 row.repositoryRelativePath!==name?[row]:replace? [{...row,sha256:'sha256:'+'0'.repeat(64)}]:[])}};}
async function inputFixture(label,changed){const root=await fixture(label);
 for(const name of stageFiles){if(changed===name)continue;await mkdir(path.dirname(path.join(root,name)),{recursive:true});
  await copyFile(path.join(productRoot,name),path.join(root,name));}
 return root;
}
test('production source copy stages the complete target and quoted include closure byte-exactly',async()=>{
 const product=await fixture('whole');await stageMlirProductSources({productRoot,product,identity});
 assert.deepEqual(await allFiles(product),stageFiles.sort());
 for(const name of stageFiles)assert.deepEqual(await readFile(path.join(product,name)),await readFile(path.join(productRoot,name)),name);
});
for(const [name,replace] of [['missing',false],['mismatch',true]])test('production source copy rejects '+name+' declared Core identity',async()=>{
 const product=await fixture(name);await assert.rejects(stageMlirProductSources({productRoot,product,identity:changedIdentity(omitted,replace)}),
 /input|identity|declared|changed/i);
});
test('production source copy rejects an absent source member',async()=>{
 const source=await inputFixture('source-missing',omitted),product=await fixture('source-missing-output');
 await assert.rejects(stageMlirProductSources({productRoot:source,product,identity}),/** @param {any} error */ error=>error.code==='ENOENT'||/input|changed/i.test(error.message));
});
test('production source copy rejects changed source bytes',async()=>{
 const source=await inputFixture('source-change'),product=await fixture('source-change-output');
 await writeFile(path.join(source,omitted),'// SPDX-License-Identifier: MIT\n// changed source data\n');
 await assert.rejects(stageMlirProductSources({productRoot:source,product,identity}),/input|changed|identity/i);
});
async function artifact(label,rows){const root=await fixture(label),file=path.join(root,'not-executed.artifact');
 const bytes=Buffer.from('data-only admission fixture; not a compiler result\n');await writeFile(file,bytes);
 await writeFile(path.join(root,'artifact-manifest.json'),JSON.stringify({coreCommandRole:'native',outputs:[{path:path.basename(file),sha256:hash(bytes)}],
 buildIdentity:{target:'windows-x86_64-msvc',profile:'debug'},buildInputSet:{entries:rows}}));return file;
}
test('actual Core consumer input gate admits a complete current data-only manifest',async()=>{
 const file=await artifact('manifest-whole',entries);assert.equal(await verifiedConsumer(file,'core'),file);
});
test('actual Core consumer gate rejects every missing source member, including formerly omitted families',async()=>{
 for(const name of coreFiles){const file=await artifact('manifest-missing',entries.filter(row=>row.repositoryRelativePath!==name));
  await assert.rejects(verifiedConsumer(file,'core'),/** @param {any} error */ error=>error.message.includes(name),name);}
});
test('actual Core consumer gate rejects every changed source member',async()=>{
 for(const name of coreFiles){const file=await artifact('manifest-changed',changedIdentity(name,true).buildInputSet.entries);
  await assert.rejects(verifiedConsumer(file,'core'),/** @param {any} error */ error=>error.message.includes(name),name);}
});
