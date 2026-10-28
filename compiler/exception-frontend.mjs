// SPDX-License-Identifier: MIT
import { check, record, budget, readJson, same, own, sha256, canonical, sourceOrigin, schemaHash,
  snapshotFormat, snapshotLimits } from './exception-common.mjs';
import { prepareExceptionInput } from './exception-input.mjs';
import { verifyExceptionFacts } from './exception-facts.mjs';

// Custody identifies exact inputs. It never supplies checker authority or grants
// admission to an executable; the bounded semantic checks own acceptance here.
function reconstruct(requestBytes, responseBytes, origin) {
  const custody = sourceOrigin(origin), request = readJson(requestBytes), response = readJson(responseBytes);
  check(custody.requestSha256 === sha256(request.bytes) && custody.responseSha256 === sha256(response.bytes), 'identity');
  record(request.value, ['family','version','schemaHash','input']);
  check(request.value.family === 'tsfg.exception-facts-request-candidate' && request.value.version === 1
    && request.value.schemaHash === schemaHash, 'schema');
  record(response.value, ['family','version','schemaHash','requestId','packageId','payload']);
  check(response.value.family === 'tsfg.exception-facts-package-candidate' && response.value.version === 1
    && response.value.schemaHash === schemaHash, 'schema');
  check(response.value.requestId === sha256('tsfg.exception-facts.request.v1\0' + request.text), 'identity');
  const payload = response.value.payload;
  record(payload, ['inputIdentity','files','facts','exports']);
  check(response.value.packageId === sha256('tsfg.exception-facts.package.v1\0' + schemaHash + '\0' + canonical(payload)), 'identity');
  const prepared = prepareExceptionInput(request.value.input);
  check(payload.inputIdentity === prepared.inputIdentity && same(payload.files, prepared.files), 'identity');
  const verification = verifyExceptionFacts(prepared, payload.facts, payload.exports);
  const snapshot = { format: snapshotFormat,
    snapshotId: sha256('tsfg.frontend-exception-candidate.snapshot.v1\0' + schemaHash + '\0'
      + canonical({ inputIdentity: prepared.inputIdentity, sourceOrigin: custody })),
    sourceOrigin: custody, inputIdentity: prepared.inputIdentity, identityInput: prepared.identityInput,
    sources: prepared.sources, target: prepared.target, facts: payload.facts, exports: payload.exports,
    capture: { request: request.text, response: response.text } };
  // Verification metadata stays beside the snapshot, outside its identity.
  snapshotBudget(snapshot); return { snapshot, verification };
}
function snapshotBudget(snapshot) {
  budget(snapshot, snapshotLimits);
  record(snapshot, ['format','snapshotId','sourceOrigin','inputIdentity','identityInput','sources','target','facts','exports','capture']);
  record(snapshot.capture, ['request','response']);
  check(typeof snapshot.capture.request === 'string' && typeof snapshot.capture.response === 'string', 'schema');
  const { capture, ...model } = snapshot;
  budget(model, { ...snapshotLimits, stringBytes: snapshotLimits.embeddedModelStringBytes });
}

// This public dispatcher adapter has one owned result shape. The shared caller
// translates failures into frontend diagnostics without invoking legacy readers.
export function importExceptionCapturedResponse(requestBytes, responseBytes, origin) {
  const { snapshot } = reconstruct(requestBytes, responseBytes, origin);
  return own({ status: 'ok', snapshot });
}

// A cold JSON object has no trusted cache or inherited identity. Reconstruct all
// ten fields from exact retained frames each time, including optional presence.
function coldSnapshot(snapshot) {
  snapshotBudget(snapshot); check(same(snapshot.format, snapshotFormat), 'schema');
  const { snapshot: rebuilt, verification } = reconstruct(Buffer.from(snapshot.capture.request, 'utf8'), Buffer.from(snapshot.capture.response, 'utf8'), snapshot.sourceOrigin);
  check(same(snapshot, rebuilt), 'snapshot', 'complete cold snapshot differs from retained capture');
  return { snapshot: rebuilt, verification };
}
export function ownedExceptionSnapshot(snapshot) {
  return own(coldSnapshot(snapshot).snapshot);
}
export function verifyExceptionSnapshot(snapshot) {
  const { snapshot: rebuilt, verification } = coldSnapshot(snapshot);
  return own({ snapshotId: rebuilt.snapshotId, functions: verification.functions, calls: verification.calls });
}
