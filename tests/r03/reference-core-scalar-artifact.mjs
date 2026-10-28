// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lowerHir } from '../../compiler/hir.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
import { scalarCoreFixtures } from '../../eng/scalar-core-emitter-fixtures.mjs';
import schema from '../../contracts/core-reference-candidate.schema.json' with { type: 'json' };
import registry from '../../contracts/registry.json' with { type: 'json' };

// Core representation positive control, not successful Source/checker facts.
// The existing public scalar HIR fixture supplies the whole unchanged program.
const hir = scalarCoreFixtures()[0].hir, scalar = lowerHir(hir);
const binding = JSON.parse(await readFile(new URL('./fixtures/reference-source/locals-const.binding.json', import.meta.url), 'utf8'));
const profile = schema.semanticProfile, scope = 'core-scalar-positive';
assert.equal(schema.version, 6); assert.equal(profile, 'tsfg-owned-class-facts-candidate-v5');
const sources = [{ path: hir.source.path, sha256: hir.source.hash, utf16Length: hir.source.content.length,
  declaration: false, surrogateStarts: [] }];
const preimage = canonical({ profile, scope, sources, options: binding.options });
const extension = { family: schema.family, version: schema.version, schema: sha256(canonical(schema)), profile, scope,
  input: hir.inputIdentity, environment: sha256('tsfg.candidate.class-environment.v2\0' + preimage), environment_preimage: preimage,
  sources: sources.map(source => ({ path: source.path, hash: source.sha256, length: source.utf16Length,
    declaration: source.declaration, surrogates: source.surrogateStarts })), classes: [], types: [], views: [] };
const quote = text => '"' + [...text].map(character => {
  const code = character.codePointAt(0);
  return character === '"' || character === '\\' ? '\\' + character
    : code < 32 || code === 127 ? '\\' + code.toString(16).padStart(2, '0') : character;
}).join('') + '"';
const attr = value => typeof value === 'string' ? quote(value) : typeof value === 'number' ? value + ' : i64'
  : typeof value === 'boolean' ? String(value) : Array.isArray(value) ? '[' + value.map(attr).join(', ') + ']'
  : '{' + Object.keys(value).sort().map(key => key + ' = ' + attr(value[key])).join(', ') + '}';
// Keep the independent private profile's original metadata. This fixture does
// not make old unmarked Core eligible for the formal producer.
assert.match(scalar, /tsfg_core.version = "0.12.0"/);
const privateScalar = scalar.replace('tsfg_core.version = "0.12.0"', 'tsfg_core.version = "0.9.0"')
  .replace(registry['tsfg.bytecode'].schemaHash, 'sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6');
const boundary = privateScalar.indexOf('} {');
assert.ok(boundary >= 0);
const extended = privateScalar.slice(0, boundary) + ', tsfg_core.reference = ' + attr(extension) + privateScalar.slice(boundary);
const artifact = text => { const bytes = Buffer.from(text); return { bytes: bytes.length, sha256: sha256(bytes), coreBase64: bytes.toString('base64') }; };
console.log('TSFG_REFERENCE_CORE_SCALAR_V1 ' + canonical({ scalar: artifact(scalar), extended: artifact(extended) }));
