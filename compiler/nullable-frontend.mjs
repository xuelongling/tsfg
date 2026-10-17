// SPDX-License-Identifier: MIT
import path from 'node:path';
import bytecodeSchema from '../contracts/bytecode.schema.json' with { type: 'json' };
import { capturedDeclarationProfiles } from './closure-common.mjs';
import { check, record, array, same, budget, canonical, sha256, origin, readJson, own, schemaHash, snapshotFormat } from './nullable-common.mjs';
import { verifyNullableFacts } from './nullable-facts.mjs';

// This narrow v3-only validator intentionally evolves independently from M19's
// multi-profile captured inputs. It adds complete consumption/private envelope
// requirements without widening or changing the legacy closure contract.
function capturedInput(input) {
  record(input, ['sourceRoot','rootFile','files','declarations','config','target']);
  record(input.declarations, ['version','paths']);
  check(input.declarations.version === 'minimal-integers-v3' && same(input.config, { strict: true, noEmit: true, allowJs: false })
    && same(input.target, { ...bytecodeSchema.target, pointerBits: '64' }), 'input');
  check(typeof input.sourceRoot === 'string' && input.sourceRoot.startsWith('/') && path.posix.normalize(input.sourceRoot) === input.sourceRoot, 'input');
  check(typeof input.rootFile === 'string' && input.rootFile.endsWith('.ts') && !input.rootFile.endsWith('.d.ts'), 'input');
  const files = array(input.files, 200000), names = new Set();
  for (const file of files) {
    record(file, ['path','content'], ['sha256']);
    check(typeof file.path === 'string' && file.path.startsWith(input.sourceRoot + '/') && path.posix.normalize(file.path) === file.path
      && (file.path === input.rootFile || file.path.endsWith('.d.ts')) && typeof file.content === 'string' && !names.has(file.path), 'input');
    if (file.sha256 !== undefined) check(file.sha256 === sha256(file.content), 'identity'); names.add(file.path);
  }
  const roots = array(input.declarations.paths, 200000);
  check(names.has(input.rootFile) && roots.length > 0 && files.length === roots.length + 1
    && roots[0] === input.sourceRoot + '/minimal-integers-v3.d.ts' && new Set(roots).size === roots.length
    && roots.every(name => names.has(name) && name.endsWith('.d.ts')), 'input');
  check(sha256(files.find(file => file.path === roots[0]).content) === capturedDeclarationProfiles['minimal-integers-v3'], 'identity');
  return { ...input, files: files.map(file => ({ path: file.path, content: file.content })).sort((a,b) => Buffer.from(a.path).compare(Buffer.from(b.path))) };
}
function reconstruct(requestBytes, responseBytes, sourceOrigin) {
  origin(sourceOrigin);
  const request = readJson(requestBytes), response = readJson(responseBytes);
  check(sha256(request.bytes) === sourceOrigin.requestSha256 && sha256(response.bytes) === sourceOrigin.responseSha256, 'identity');
  record(request.value, ['family','version','schemaHash','input']);
  check(request.value.family === 'tsfg.nullable-facts-request-candidate' && request.value.version === 2 && request.value.schemaHash === schemaHash, 'schema');
  const input = request.value.input, identityInput = capturedInput(input), inputIdentity = sha256(canonical(identityInput));
  const value = response.value; record(value, ['family','version','schemaHash','requestId','packageId','payload']);
  check(value.family === 'tsfg.nullable-facts-package-candidate' && value.version === 2 && value.schemaHash === schemaHash, 'schema');
  check(value.requestId === sha256('tsfg.nullable-facts.request.v2\0' + request.text), 'identity');
  record(value.payload, ['inputIdentity','files','facts','exports']);
  check(value.packageId === sha256('tsfg.nullable-facts.package.v2\0' + schemaHash + '\0' + canonical(value.payload)), 'identity');
  const { facts, exports } = value.payload;
  const files = identityInput.files.map(file => ({ path: file.path, digest: sha256(file.content), byteLength: Buffer.byteLength(file.content), length: file.content.length, positionUnit: 'utf16' }));
  check(value.payload.inputIdentity === inputIdentity && same(value.payload.files, files), 'identity');
  check(same(facts.inputs, files.map(file => file.path)), 'input');
  const source = { path: input.rootFile, content: input.files.find(file => file.path === input.rootFile).content };
  verifyNullableFacts(source, facts, exports);
  const snapshotId = sha256('tsfg.frontend-nullable-candidate.snapshot.v2\0' + schemaHash + '\0' + canonical({ inputIdentity, sourceOrigin }));
  return { format: snapshotFormat, snapshotId, sourceOrigin, inputIdentity, identityInput,
    source: { ...source, hash: sha256(source.content) }, target: input.target, inputs: files, functions: facts.functions, symbols: facts.symbols, exports,
    capture: { request: request.text, response: response.text } };
}
export function importNullableCapturedResponse(requestBytes, responseBytes, sourceOrigin) {
  const snapshot = reconstruct(requestBytes, responseBytes, sourceOrigin); budget(snapshot);
  return own({ status: 'ok', snapshot });
}
export function nullableSnapshotFacts(snapshot) {
  budget(snapshot); record(snapshot, ['format','snapshotId','sourceOrigin','inputIdentity','identityInput','source','target','inputs','functions','symbols','exports','capture']);
  check(same(snapshot.format, snapshotFormat), 'schema'); record(snapshot.capture, ['request','response']);
  check(typeof snapshot.capture.request === 'string' && typeof snapshot.capture.response === 'string', 'input');
  const expected = reconstruct(Buffer.from(snapshot.capture.request), Buffer.from(snapshot.capture.response), snapshot.sourceOrigin);
  check(same(snapshot, expected), 'snapshot'); return own(expected);
}
export function verifyNullableSnapshot(snapshot) {
  const verified = nullableSnapshotFacts(snapshot); let calls = 0;
  const visit = value => { if (!value || typeof value !== 'object') return; if (value.kind === 'call') calls++;
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else visit(child); };
  verified.functions.forEach(fn => visit(fn.body));
  return own({ snapshotId: verified.snapshotId, functions: verified.functions.length, calls });
}
export function matchesNullableSnapshot(snapshot) {
  try { verifyNullableSnapshot(snapshot); return true; } catch { return false; }
}
