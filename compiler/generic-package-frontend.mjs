// SPDX-License-Identifier: MIT
import { runLockedFrontend } from './frontend-execution.mjs';
import { decodeGenericPackage, encodeGenericPackage } from './generic-package.mjs';
import { decodeGenericPackageRequest, encodeGenericPackageRequest, decodeGenericPackageResponse,
  genericPackageRequestId, genericPackageIoFormat } from './generic-package-io.mjs';
import { buildGenericHir, printGenericHir, readGenericHir } from './generic-hir.mjs';

/** @param {unknown} input */
function ownedRequest(input) {
  // The decoder owns raw bytes before checking them. Re-encoding the verified
  // canonical request gives subsequent identity checks one stable private copy.
  const request = decodeGenericPackageRequest(input);
  return { request, bytes: encodeGenericPackageRequest(request) };
}

/**
 * Production cold importer shared by live transport and persisted responses.
 * Candidate correspondence is separate from Source executable admission.
 * @param {unknown} requestBytes @param {unknown} responseBytes
 */
export function readGenericPackageFrontendResponse(requestBytes, responseBytes) {
  const input = ownedRequest(requestBytes);
  const response = decodeGenericPackageResponse(responseBytes, input.bytes);
  const requestId = response.requestId;
  if (response.status === 'error')
    return { status: 'error', requestId, diagnostic: response.diagnostic };
  if (input.request.operation === 'export')
    return { status: 'ok', requestId, packageBytes: encodeGenericPackage(response.value) };
  const packageBytes = encodeGenericPackage(input.request.package);
  const hir = buildGenericHir(packageBytes, response.value, input.request.roots);
  // Cross the exact cold reader too: the owned result has no live Source graph,
  // original source text or legacy Snapshot authority attached to it.
  return { status: 'ok', requestId,
    hir: readGenericHir(new TextEncoder().encode(printGenericHir(hir))) };
}

/**
 * One strict request through the real locked Source candidate command.
 * Successful protocol checking does not change the adopted Source lock.
 * @param {unknown} requestBytes @param {{executable?: string}} [options]
 */
export async function analyzeGenericPackage(requestBytes, { executable } = {}) {
  const input = ownedRequest(requestBytes);
  const requestId = genericPackageRequestId(input.bytes);
  const execution = await runLockedFrontend(input.bytes,
    { executable, mode: 'generic-package-io-candidate-v1' });
  if (execution.status !== 'ok')
    return { status: 'tool-error', requestId, message: execution.message };
  return { ...readGenericPackageFrontendResponse(input.bytes, execution.stdout),
    frontendSource: execution.frontendSource };
}

/**
 * Package compilation's frontend half. Only original package bytes and roots
 * enter Source; the candidate HIR is never passed to the registered Core 0.8.
 * @param {unknown} packageBytes @param {unknown} roots
 * @param {{frontend?: string}} [options]
 */
export async function compilePackageHir(packageBytes, roots, { frontend } = {}) {
  const pkg = decodeGenericPackage(packageBytes);
  const request = encodeGenericPackageRequest({ ...genericPackageIoFormat,
    operation: 'instantiate', package: pkg, roots });
  return analyzeGenericPackage(request, { executable: frontend });
}
