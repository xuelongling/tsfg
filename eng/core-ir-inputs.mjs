// SPDX-License-Identifier: MIT
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from '../compiler/identity.mjs';

/** Verify the actual manifest-driven production Core closure before use.
 * This checks source freshness, not executable provenance or execution fitness.
 */
export async function verifyCoreIrInputs(manifest,productRoot) {
  const entries=manifest.buildInputSet?.entries;
  if(!Array.isArray(entries))throw new TypeError('r03-tool-core: compiled source identity is missing');
  const declared=entries.filter(row=>row?.projectId==='tsfg').reduce((index,row)=>{
    index.set(row.repositoryRelativePath,index.has(row.repositoryRelativePath)?null:row.sha256);return index;
  },new Map());
  const verify=(name,bytes)=>{
    if(declared.get(name)!==sha256(bytes))
      throw new TypeError('r03-tool-core: compiled input differs from current '+name);
  };
  const manifestPath='compiler/core-ir/sources.json',raw=await readFile(path.join(productRoot,manifestPath));
  verify(manifestPath,raw);
  const source=JSON.parse(raw.toString('utf8'));
  if(Object.keys(source).sort().join(',')!=='headers,sources'||!Array.isArray(source.sources)||!source.sources.length||!Array.isArray(source.headers)||
    source.sources.some(name=>typeof name!=='string'||!/^[a-z0-9_-]+\.cpp$/.test(name))||
    source.headers.some(name=>typeof name!=='string'||!/^[a-z0-9_-]+\.h$/.test(name)))
    throw new TypeError('r03-tool-core: Core source directory differs');
  const names=[...source.sources,...source.headers];
  if(new Set(names).size!==names.length||!source.sources.includes('main.cpp'))
    throw new TypeError('r03-tool-core: Core source directory differs');
  const required=['compiler/core-ir/CMakeLists.txt',manifestPath,'eng/core-ir-inputs.mjs',...names.map(name=>'compiler/core-ir/'+name)];
  for(const name of required)if(name!==manifestPath)verify(name,await readFile(path.join(productRoot,name)));
  return required;
}
