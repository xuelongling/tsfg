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
  'locals-const': {hash:'sha256:762c1c1ee23174b046b00903af2e90ca7c7e08b54c4c970a1ba0d810b8be6fe6', originals:[['/original/main.ts','source.ts']]},
  'multiple-sources': {hash:'sha256:b49b569266659fb9aed15dfacf677687dd4e3b57bc1b0405b2e8dcc10604ae32', originals:[['/original/a-main.ts','a-main.source.ts'],['/original/z-base.ts','z-base.source.ts']]},
  'local-assignment-result': {hash:'sha256:f577d1cf1f157f6bf9b8ccd8ebe5d11d30ec40d4f8967ccc96adb11672919c09', originals:[['/original/main.ts','source.ts']]},
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
assert.deepEqual(cold, hir); assert.equal(cold.format.version, 4);
assert.equal(cold.format.semanticProfile, 'tsfg-owned-class-facts-candidate-v4');
for (const owner of cold.classes) assert.equal(owner.constructor.access, 'public');
const first = lowerHir(cold), second = lowerHir(readReferenceHir(Buffer.from(printReferenceHir(cold))));
assert.equal(first, second, 'independent cold lowering is byte deterministic');
const core = Buffer.from(first, 'utf8');
console.log('TSFG_REFERENCE_CORE_ARTIFACT_V1 ' + canonical({ bytes: core.length,
  sha256: sha256(core), coreBase64: core.toString('base64') }));
