// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import oracle from './host-counter-semantic-oracle.json' with { type: 'json' };
import { retainVmBootstrapArtifacts, stageVmRuntimeSources } from '../../eng/vm-build.mjs';
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

test('M22 bootstrap retains compiled identity and full contract without resource authority', async () => {
  const stage = await mkdtemp(path.join(process.env.TMPDIR, 'counter-contract-retention-'));
  const product = path.join(stage,'product'), publish = path.join(stage,'publish');
  await mkdir(path.join(product,'runtime'),{recursive:true}); await mkdir(publish);
  await writeFile(path.join(stage,'ownership.json'),JSON.stringify({owner:'tsfg-vm-build',stage}));
  // Opaque retention fixtures are never executed or interpreted as a host.
  await writeFile(path.join(publish,'tsfg-vm.exe'),'retention-only-not-executable');
  await writeFile(path.join(publish,'tsfg-vm.pdb'),'retention-only-not-symbols');
  await writeFile(path.join(stage,'build-0.log'),'retention-only-log');
  await writeFile(path.join(product,'runtime','host_certificate.zig'),'pub const qualified = false;\n');
  const generated = path.join(product,'runtime','host_semantic_identity.zig');
  const contractFile = path.join(stage,'host-semantic-contract.json');
  await writeFile(generated,oracle.expectedGeneratedZig);
  await writeFile(contractFile,oracle.expectedCanonicalText);
  const result = await retainVmBootstrapArtifacts({stage,product,publish,identity:oracle.identity,
    sha256:hash,hostSemanticContract:oracle.expectedContract,objectRoots:[]});
  assert.equal(result.first,null); assert.equal(result.artifacts.length,6);
  assert.deepEqual(result.hostSemanticContract,oracle.expectedContract);
  for (const [source,wanted] of [[generated,oracle.expectedGeneratedZig],[contractFile,oracle.expectedCanonicalText]]) {
    const artifact=result.artifacts.find(value=>value.source===source);
    assert.ok(artifact); assert.equal(artifact.sha256,hash(wanted));
    assert.equal((await readFile(artifact.retained.path,'utf8')),wanted);
    assert.equal(artifact.sourceClosed,true); assert.equal(artifact.retained.fsync,true);
  }
  assert.equal(result.executionAuthority,false); assert.equal(result.resourceProof,null);
  assert.equal(result.phaseEntries,null); assert.equal(result.loadedGraph,null);
  assert.equal(result.compilerObjectLinkMembership,'unverified');
});

// Real source bytes and the production copy boundary; no compiler/VM launcher.
test('M22 production stage closes actual Runtime and String codec imports', async () => {
  const productRoot = fileURLToPath(new URL('../../',import.meta.url));
  const product = await mkdtemp(path.join(process.env.TMPDIR,'counter-runtime-stage-'));
  await mkdir(path.join(product,'runtime'));
  const declaration = JSON.parse(await readFile(path.join(productRoot,'eng/build-inputs.json'),'utf8'));
  const names = declaration.entries.filter(entry=>entry.path.startsWith('runtime/') && /\.(zig|c)$/.test(entry.path));
  const entries = await Promise.all(names.map(async entry=>({projectId:entry.projectId,
    repositoryRelativePath:entry.path,sha256:hash(await readFile(path.join(productRoot,entry.path)))})));
  await stageVmRuntimeSources({productRoot,product,identity:{buildInputSet:{entries}},sha256:hash});
  // This dependency is emitted later by the real build; the independent unit
  // identity is deliberately old and cannot claim current Runtime execution.
  await writeFile(path.join(product,'runtime/host_semantic_identity.zig'),oracle.expectedGeneratedZig);
  const codec = await readFile(path.join(product,'runtime/string-codec.zig'));
  assert.deepEqual(codec,await readFile(path.join(productRoot,'runtime/string-codec.zig')));
  const staged = await readdir(path.join(product,'runtime'));
  assert.ok(staged.includes('managed-heap.zig'));
  for (const name of staged.filter(name=>name.endsWith('.zig'))) {
    const text = await readFile(path.join(product,'runtime',name),'utf8');
    for (const match of text.matchAll(/@import\("([^"\n]+)"\)/g)) {
      // std/builtin are compiler modules; the resource certificate is generated
      // by the later native preparation boundary, separately from this issuer.
      if (['std','builtin','host_certificate.zig'].includes(match[1])) continue;
      assert.ok(staged.includes(match[1]),name+' missing staged import '+match[1]);
    }
  }
});
