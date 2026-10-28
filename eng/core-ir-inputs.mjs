// SPDX-License-Identifier: MIT
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from '../compiler/identity.mjs';

/** Verify the manifest-owned source closure for the actual compiled command role.
 * This checks source freshness, not executable provenance or execution fitness.
 */
export async function verifyCoreIrInputs(manifest,productRoot,commandRole=manifest.coreCommandRole??manifest.buildIdentity?.options?.coreCommandRole??'native') {
  const declaredRole=manifest.buildIdentity?.options?.coreCommandRole??manifest.coreCommandRole??'native';
  if(!['static','native'].includes(commandRole)||commandRole!==declaredRole||
      (manifest.coreCommandRole!==undefined&&manifest.coreCommandRole!==commandRole))
    throw new TypeError('r03-tool-core: compiled command role differs');
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
  /** @type {unknown} */ const value=JSON.parse(raw.toString('utf8'));
  const invalid=()=>new TypeError('r03-tool-core: Core source directory differs');
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='common,native,static')throw invalid();
  const catalog=/** @type {Record<string,unknown>} */(value);
  const groups=['common','static','native'].map(role=>{
    const value=catalog[role];
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='externalHeaders,headers,sources')throw invalid();
    const group=/** @type {Record<string,unknown>} */(value);
    const sources=group.sources,headers=group.headers,external=group.externalHeaders;
    if(!Array.isArray(sources)||!sources.length||sources.some(n=>typeof n!=='string'||!/^[a-z0-9_-]+\.cpp$/.test(n))||
       !Array.isArray(headers)||headers.some(n=>typeof n!=='string'||!/^[a-z0-9_-]+\.h$/.test(n))||
       !Array.isArray(external)||external.some(n=>typeof n!=='string'||!/^runtime\/[a-z0-9_-]+\.h$/.test(n)))throw invalid();
    const names=[...sources,...headers,...external];
    if(new Set(names).size!==names.length)throw invalid();
    return {sources:/** @type {string[]} */(sources),headers:/** @type {string[]} */(headers),externalHeaders:/** @type {string[]} */(external)};
  });
  const common=groups[0],selected=groups[commandRole==='static'?1:2];
  const names=[...common.sources,...common.headers,...selected.sources,...selected.headers].map(n=>'compiler/core-ir/'+n)
    .concat(common.externalHeaders,selected.externalHeaders);
  if(new Set(names).size!==names.length)throw invalid();
  const required=['compiler/core-ir/CMakeLists.txt',manifestPath,'eng/core-ir-inputs.mjs',...names];
  for(const name of required)if(name!==manifestPath)verify(name,await readFile(path.join(productRoot,name)));
  return required;
}
