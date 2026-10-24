// SPDX-License-Identifier: MIT
import path from 'node:path';
import bytecodeSchema from '../contracts/bytecode.schema.json' with { type: 'json' };
import { capturedDeclarationProfiles } from './closure-common.mjs';
import { check, record, array, same, budget, canonical, sha256, origin, readJson, own, schemaHash, snapshotFormat, presenceSourceSchema, presenceSnapshotFormat, groupsSourceSchema, groupsSnapshotFormat,
  presenceBudget, presenceDomainBudget, presenceOrigin, presenceOwn, presenceRethrow, readPresenceJson } from './nullable-common.mjs';
import { verifyNullableFacts } from './nullable-facts.mjs';

// Explicit finite captured versions share complete input reconstruction; M19 and default3 stay independent.
function capturedInput(input, version = 3) {
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
  if (version >= 4) for (const name of [input.sourceRoot, input.rootFile, ...files.map(file => file.path), ...roots]) {
    check(typeof name === 'string' && name.isWellFormed() && !name.includes('\0') && !name.includes('\\')
      && name.startsWith('/') && path.posix.normalize(name) === name, 'input');
    check(Buffer.byteLength(name) <= 4096, 'limit');
  }
  return { ...input, files: files.map(file => ({ path: file.path, content: file.content })).sort((a,b) => Buffer.from(a.path).compare(Buffer.from(b.path))) };
}
function selectedContext(context) {
  presenceBudget(context); record(context, ['sourceVersion','sourceSchemaHash','expectedPackageId','expectedOrigin']);
  check((context.sourceVersion === 4 && context.sourceSchemaHash === presenceSourceSchema
    || context.sourceVersion === 5 && context.sourceSchemaHash === groupsSourceSchema)
    && typeof context.expectedPackageId === 'string' && /^sha256:[0-9a-f]{64}$/.test(context.expectedPackageId), 'context');
  presenceOrigin(context.expectedOrigin); return context;
}
function reconstruct(requestBytes, responseBytes, sourceOrigin, context = undefined) {
  const selected = context === undefined ? undefined : selectedContext(context), version = selected?.sourceVersion ?? 3;
  const sourceSchema = version === 5 ? groupsSourceSchema : version === 4 ? presenceSourceSchema : schemaHash;
  if (version >= 4) { presenceOrigin(sourceOrigin); check(same(sourceOrigin, selected.expectedOrigin), 'identity'); }
  else origin(sourceOrigin);
  const read = version >= 4 ? readPresenceJson : readJson;
  const request = read(requestBytes), response = read(responseBytes);
  // Selected channels prioritize exact envelopes; legacy3 keeps its original identity-first order.
  if (version >= 4) {
    record(request.value, ['family','version','schemaHash','input']);
    check(request.value.family === 'tsfg.nullable-facts-request-candidate' && request.value.version === version && request.value.schemaHash === sourceSchema, 'schema');
    record(response.value, ['family','version','schemaHash','requestId','packageId','payload']);
    check(response.value.family === 'tsfg.nullable-facts-package-candidate' && response.value.version === version && response.value.schemaHash === sourceSchema, 'schema');
    record(response.value.payload, ['inputIdentity','files','facts','exports']);
    record(response.value.payload.facts, ['status','inputs','functions','symbols']);
  }
  check(sha256(request.bytes) === sourceOrigin.requestSha256 && sha256(response.bytes) === sourceOrigin.responseSha256, 'identity');
  record(request.value, ['family','version','schemaHash','input']);
  check(request.value.family === 'tsfg.nullable-facts-request-candidate' && request.value.version === version && request.value.schemaHash === sourceSchema, 'schema');
  const input = request.value.input;
  if (version === 5) check(sourceOrigin.testedInputSetHash === sha256(canonical({ rootFile: input.rootFile, files: input.files })), 'identity');
  const identityInput = capturedInput(input, version), inputIdentity = sha256(canonical(identityInput));
  const value = response.value; record(value, ['family','version','schemaHash','requestId','packageId','payload']);
  check(value.family === 'tsfg.nullable-facts-package-candidate' && value.version === version && value.schemaHash === sourceSchema, 'schema');
  check(value.requestId === sha256('tsfg.nullable-facts.request.v' + version + '\0' + request.text), 'identity');
  record(value.payload, ['inputIdentity','files','facts','exports']);
  check(value.packageId === sha256('tsfg.nullable-facts.package.v' + version + '\0' + sourceSchema + '\0' + canonical(value.payload)), 'identity');
  if (version >= 4) check(value.packageId === selected.expectedPackageId, 'identity');
  const { facts, exports } = value.payload;
  if (version >= 4) record(facts, ['status','inputs','functions','symbols']);
  const files = identityInput.files.map(file => ({ path: file.path, digest: sha256(file.content), byteLength: Buffer.byteLength(file.content), length: file.content.length, positionUnit: 'utf16' }));
  check(value.payload.inputIdentity === inputIdentity && same(value.payload.files, files), 'identity');
  check(same(facts.inputs, files.map(file => file.path)), 'input');
  const source = { path: input.rootFile, content: input.files.find(file => file.path === input.rootFile).content };
  verifyNullableFacts(source, facts, exports, version);
  const format = version === 5 ? groupsSnapshotFormat : version === 4 ? presenceSnapshotFormat : snapshotFormat;
  const snapshotId = sha256('tsfg.frontend-nullable-candidate.snapshot.v' + version + '\0' + format.schemaHash + '\0' + canonical({ inputIdentity, sourceOrigin }));
  const snapshot = { format, snapshotId, sourceOrigin, inputIdentity, identityInput,
    source: { ...source, hash: sha256(source.content) }, target: input.target, inputs: files, functions: facts.functions, symbols: facts.symbols, exports,
    capture: { request: request.text, response: response.text } };
  if (version >= 4) presenceBudget(snapshot); return snapshot;
}
export function importNullableCapturedResponse(requestBytes, responseBytes, sourceOrigin, context = undefined) {
  try {
    const snapshot = reconstruct(requestBytes, responseBytes, sourceOrigin, context);
    if (context !== undefined) return presenceOwn({ status: 'ok', snapshot });
    budget(snapshot); return own({ status: 'ok', snapshot });
  } catch (error) { if (context !== undefined) presenceRethrow(error); throw error; }
}
export function nullableSnapshotFacts(snapshot, context = undefined) {
  try {
    if (context !== undefined) { selectedContext(context); presenceBudget(snapshot); presenceDomainBudget(snapshot); }
    else budget(snapshot);
    record(snapshot, ['format','snapshotId','sourceOrigin','inputIdentity','identityInput','source','target','inputs','functions','symbols','exports','capture']);
    check(same(snapshot.format, context === undefined ? snapshotFormat : context.sourceVersion === 5 ? groupsSnapshotFormat : presenceSnapshotFormat), 'schema'); record(snapshot.capture, ['request','response']);
    check(typeof snapshot.capture.request === 'string' && typeof snapshot.capture.response === 'string', 'input');
    const expected = reconstruct(Buffer.from(snapshot.capture.request), Buffer.from(snapshot.capture.response), snapshot.sourceOrigin, context);
    check(same(snapshot, expected), 'snapshot'); return context === undefined ? own(expected) : presenceOwn(expected);
  } catch (error) { if (context !== undefined) presenceRethrow(error); throw error; }
}
export function verifyNullableSnapshot(snapshot, context = undefined) {
  const verified = nullableSnapshotFacts(snapshot, context); let calls = 0;
  const visit = value => { if (!value || typeof value !== 'object') return; if (value.kind === 'call') calls++;
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else visit(child); };
  verified.functions.forEach(fn => visit(fn.body));
  return own({ snapshotId: verified.snapshotId, functions: verified.functions.length, calls });
}
export function matchesNullableSnapshot(snapshot, context = undefined) {
  try { verifyNullableSnapshot(snapshot, context); return true; } catch { return false; }
}
