// SPDX-License-Identifier: MIT
import { canonical, sha256 } from './identity.mjs';
import { readGenericJson, preflightGenericJson, genericPackageIoJsonPolicy } from './generic-json.mjs';
import { normalizeIoRequest, normalizeIoResponse, ioFailure } from './generic-package-io-shape.mjs';
export { genericPackageIoFormat } from './generic-package-io-shape.mjs';

function encode(value) {
  const text = canonical(value), bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > genericPackageIoJsonPolicy.bytes) ioFailure('limit');
  preflightGenericJson(text, genericPackageIoJsonPolicy);
  return bytes;
}
function read(bytes) {
  const input = readGenericJson(bytes, genericPackageIoJsonPolicy);
  if (input.text !== canonical(input.value)) ioFailure('canonical');
  return input.value;
}
/** A framed request, explicitly not a domain-verified package or checking result. */
export function encodeGenericPackageRequest(input) {
  return encode(normalizeIoRequest(input));
}
/** Only top framing is accepted; nested domain failures have typed responses. */
export function decodeGenericPackageRequest(bytes) {
  return normalizeIoRequest(read(bytes));
}
function context(input) {
  if (input instanceof Uint8Array && input.byteLength > genericPackageIoJsonPolicy.bytes) ioFailure('limit');
  const bytes = input instanceof Uint8Array ? Uint8Array.from(input) : encodeGenericPackageRequest(input);
  const request = decodeGenericPackageRequest(bytes);
  return { request, requestId: sha256(Buffer.concat([
    Buffer.from('tsfg:generic-package-io-request:v1\n', 'utf8'), Buffer.from(bytes)])) };
}
export const genericPackageRequestId = input => context(input).requestId;
/** The request owns operation, requestId and every permitted diagnostic source. */
export function encodeGenericPackageResponse(input, request) {
  const checked = context(request);
  return encode(normalizeIoResponse(input, checked.request, checked.requestId));
}
export function decodeGenericPackageResponse(bytes, request) {
  const checked = context(request);
  return normalizeIoResponse(read(bytes), checked.request, checked.requestId);
}
