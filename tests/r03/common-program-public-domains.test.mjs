// SPDX-License-Identifier: MIT
// Nonserialized constructor analysis must not leave physical domain declarations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.env.TSFG_PUB3_IMPLEMENTATION_ROOT??fileURLToPath(new URL('../..',import.meta.url));
const load=name=>import(pathToFileURL(root+'/compiler/'+name).href);
const [{readCommonProgramFacts},{buildCommonProgramHir},{createCommonProgramPublication},{commonProgramCore},{canonical}]=await Promise.all([
  load('common-program-facts.mjs'),load('common-program-hir.mjs'),load('common-program-analysis.mjs'),load('common-program-core.mjs'),load('common-program-common.mjs')
]);

test('conditional super Core declares only domains referenced by serialized storage, ABI or SSA',async()=>{
  const bytes=await fs.readFile(new URL('./testdata/constructor-return-origin/conditional-super-bool.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'5bdfe8390e2046b61a03f53dfc9ef39c3b8a4217760d6a88fd3d5058b482bc9c');
  const facts=readCommonProgramFacts(bytes),context={family:'tsfg.common-program-context-candidate',version:facts.version,factsBytes:bytes,expectedPackageId:facts.packageId};
  const hir=buildCommonProgramHir(facts,context),publication=createCommonProgramPublication(hir);
  assert.ok(hir.types.some(type=>type.base),'fixture must retain real nominal inheritance');
  const built=commonProgramCore(hir,publication,{targets:[]},{borrowProof:false});
  const {domains,bindings,functions,internalConstructors}=built.representation;
  assert.ok(domains.length>0,'fixture must exercise a physical actual-domain declaration');
  const boundary=built.text.indexOf('} {\n');assert.ok(boundary>=0);
  const body=built.text.slice(boundary+4),metadata=canonical({bindings,functions,internalConstructors});
  // Read the public output, independently of the carrier selector's private
  // inventory. C++ still checks every declared layout and actual capacity.
  for(const domain of domains)assert.ok(body.includes(domain.id)||metadata.includes(domain.id),
    'physical domain has no serialized reference: '+domain.id);
  assert.equal(built.borrowProof,null);
});
