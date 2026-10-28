// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeReferenceFacts } from '../../compiler/reference-facts.mjs';
import { buildReferenceHir, printReferenceHir, readReferenceHir } from '../../compiler/reference-hir.mjs';
import { lowerHir } from '../../compiler/hir.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';

// Public, actual cold input -> deterministic Core artifact on stdout only.
// Root captures the sentinel record; this script never writes repository files.
/** @type {Record<string, {hash:string, originals:[string,string][]}>} */
const captures = {
  'locals-const': {hash:'sha256:32b102d37534052fc90d305ee8d4a1092696f32c6b072520f7a0de43683cfaf5', originals:[['/original/main.ts','source.ts']]},
  'multiple-sources': {hash:'sha256:593093a1772fff01f8c6c82802e50edf44b24f29042c2e3ace494957e6a93db7', originals:[['/original/a-main.ts','a-main.source.ts'],['/original/z-base.ts','z-base.source.ts']]},
  'local-assignment-result': {hash:'sha256:2510da5b02fb93613ebcf4fbd3e43fb64436f144b3be7df1ce2602795dfb4552', originals:[['/original/main.ts','source.ts']]},
};
const name = process.argv[2] ?? 'locals-const', capture = captures[name];
assert.ok(capture, 'only explicit actual Source captures are admitted');
const fixture = suffix => new URL('./fixtures/reference-source/'+name+'.'+suffix, import.meta.url);
const [bytes, bindingText] = await Promise.all([readFile(fixture('facts.json')), readFile(fixture('binding.json'), 'utf8')]);
assert.equal(sha256(bytes), capture.hash);
const binding = JSON.parse(bindingText);
assert.equal(binding.sources.filter(value => !value.declaration).length, capture.originals.length);
for (const [path, suffix] of capture.originals) {
  const source = await readFile(fixture(suffix), 'utf8'), origin = binding.sources.find(value => value.path === path && !value.declaration);
  assert.ok(origin); assert.equal(sha256(source), origin.sha256); assert.equal(source.length, origin.utf16Length);
}
const hir = buildReferenceHir(decodeReferenceFacts(bytes, binding));
const cold = readReferenceHir(Buffer.from(printReferenceHir(hir)));
assert.deepEqual(cold, hir); assert.equal(cold.format.version, 5);
assert.equal(cold.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v5');
for (const owner of cold.classes) assert.equal(owner.constructor.access, 'public');
const first = lowerHir(cold), second = lowerHir(readReferenceHir(Buffer.from(printReferenceHir(cold))));
assert.equal(first, second, 'independent cold lowering is byte deterministic');
const core = Buffer.from(first, 'utf8');
console.log('TSFG_REFERENCE_CORE_ARTIFACT_V1 ' + canonical({ bytes: core.length,
  sha256: sha256(core), coreBase64: core.toString('base64') }));
