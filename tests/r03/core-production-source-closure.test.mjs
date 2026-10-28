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
// The finite role catalog is the CMake source declaration. Follow every local
// quoted include independently, including declared public interface headers.
const catalog=JSON.parse(await readFile(path.join(productRoot,'compiler/core-ir/sources.json'),'utf8'));
assert.deepEqual(Object.keys(catalog).sort(),['common','native','static']);
const declaration=JSON.parse(await readFile(path.join(productRoot,'eng/build-inputs.json'),'utf8'));
const entries=await Promise.all(declaration.entries.map(async entry=>({projectId:entry.projectId,
 repositoryRelativePath:entry.path,sha256:hash(await readFile(path.join(productRoot,entry.path)))})));
for(const role of ['static','native']){
 const command={role},groups=[catalog.common,catalog[role]];
 const translationUnits=groups.flatMap(group=>group.sources);
 assert.ok(translationUnits.length>0);assert.equal(new Set(translationUnits).size,translationUnits.length);
 for(const name of translationUnits)assert.match(name,/^[a-z0-9_-]+\.cpp$/);
 const declaredFiles=groups.flatMap(group=>[...group.sources,...group.headers].map(name=>'compiler/core-ir/'+name).concat(group.externalHeaders));
 const closure=new Set(['compiler/core-ir/CMakeLists.txt','compiler/core-ir/sources.json','eng/core-ir-inputs.mjs']),pending=[...declaredFiles];
 while(pending.length){const name=pending.pop();if(closure.has(name))continue;closure.add(name);
  const text=await readFile(path.join(productRoot,name),'utf8');
  for(const match of text.matchAll(/^#include "([a-z0-9_-]+\.h|\.\.\/\.\.\/runtime\/aot-(?:instance|program)\.h)"/gm))
   pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1])));
 }
 const coreFiles=[...closure].sort();
 const identity={coreCommandRole:role,buildInputSet:{entries}};
 for(const name of coreFiles)assert.equal(entries.filter(row=>row.repositoryRelativePath===name).length,1);
 const stageFiles=[...coreFiles,'eng/mlir-python-policy.cmake','eng/mlir-compiler-launcher.mjs',...(role==='static'?['eng/mlir-configuration-sources.cmake']:[])];
const omitted='compiler/core-ir/array-publication.cpp';
async function fixture(label){return createMlirFixture('m14l-'+role+'-'+label+'-');}
async function allFiles(root,prefix=''){const result=[];
 for(const item of await readdir(path.join(root,prefix),{withFileTypes:true})){
  const name=prefix?prefix+'/'+item.name:item.name;
  if(item.isDirectory())result.push(...await allFiles(root,name));else result.push(name);
 }return result.sort();
}
function changedIdentity(name,replace){return {...identity,buildInputSet:{entries:entries.flatMap(row=>
 row.repositoryRelativePath!==name?[row]:replace? [{...row,sha256:'sha256:'+'0'.repeat(64)}]:[])}};}
async function inputFixture(label,changed){const root=await fixture(label);
 for(const name of stageFiles){if(changed===name)continue;await mkdir(path.dirname(path.join(root,name)),{recursive:true});
  await copyFile(path.join(productRoot,name),path.join(root,name));}
 return root;
}
test(role+' production source copy stages the complete target and quoted include closure byte-exactly',async()=>{
 const product=await fixture('whole');await stageMlirProductSources({productRoot,product,identity,command});
 assert.deepEqual(await allFiles(product),stageFiles.sort());
 for(const name of stageFiles)assert.deepEqual(await readFile(path.join(product,name)),await readFile(path.join(productRoot,name)),name);
});
for(const [name,replace] of [['missing',false],['mismatch',true]])test(role+' production source copy rejects '+name+' declared Core identity',async()=>{
 const product=await fixture(name);await assert.rejects(stageMlirProductSources({productRoot,product,identity:changedIdentity(omitted,replace),command}),
 /input|identity|declared|changed/i);
});
test(role+' production source copy rejects an absent source member',async()=>{
 const source=await inputFixture('source-missing',omitted),product=await fixture('source-missing-output');
 await assert.rejects(stageMlirProductSources({productRoot:source,product,identity,command}),error=>error instanceof Error&&('code' in error&&error.code==='ENOENT'||/input|changed/i.test(error.message)));
});
test(role+' production source copy rejects changed source bytes',async()=>{
 const source=await inputFixture('source-change'),product=await fixture('source-change-output');
 await writeFile(path.join(source,omitted),'// SPDX-License-Identifier: MIT\n// changed source data\n');
 await assert.rejects(stageMlirProductSources({productRoot:source,product,identity,command}),/input|changed|identity/i);
});
async function artifact(label,rows){const root=await fixture(label),file=path.join(root,'not-executed.artifact');
 const bytes=Buffer.from('data-only admission fixture; not a compiler result\n');await writeFile(file,bytes);
 await writeFile(path.join(root,'artifact-manifest.json'),JSON.stringify({coreCommandRole:role,outputs:[{path:path.basename(file),sha256:hash(bytes)}],
 buildIdentity:{target:'windows-x86_64-msvc',profile:'debug',options:{coreCommandRole:role}},buildInputSet:{entries:rows}}));return file;
}
test(role+' actual Core consumer input gate admits a complete current data-only manifest',async()=>{
 const file=await artifact('manifest-whole',entries);assert.equal(await verifiedConsumer(file,'core'),file);
});
test(role+' actual Core consumer gate rejects every missing source member, including formerly omitted families',async()=>{
 for(const name of coreFiles){const file=await artifact('manifest-missing',entries.filter(row=>row.repositoryRelativePath!==name));
  await assert.rejects(verifiedConsumer(file,'core'),error=>error instanceof Error&&error.message.includes(name),name);}
});
test(role+' actual Core consumer gate rejects every changed source member',async()=>{
 for(const name of coreFiles){const file=await artifact('manifest-changed',changedIdentity(name,true).buildInputSet.entries);
  await assert.rejects(verifiedConsumer(file,'core'),error=>error instanceof Error&&error.message.includes(name),name);}
});

}
