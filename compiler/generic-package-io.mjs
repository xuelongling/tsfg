// SPDX-License-Identifier: MIT
import { isUint8Array } from 'node:util/types';
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
  return input;
}
/** A framed request, explicitly not a domain-verified package or checking result. */
export function encodeGenericPackageRequest(input) {
  return encode(normalizeIoRequest(input));
}
/** Only top framing is accepted; nested domain failures have typed responses. */
export function decodeGenericPackageRequest(bytes) {
  return normalizeIoRequest(read(bytes).value);
}
function context(input) {
  const { bytes, value } = read(isUint8Array(input) ? input : encodeGenericPackageRequest(input));
  const request = normalizeIoRequest(value);
  return { request, requestId: sha256(Buffer.concat([
    Buffer.from('tsfg:generic-package-io-request:v1\n', 'utf8'), bytes])) };
}
export const genericPackageRequestId = input => context(input).requestId;
/** The request owns operation, requestId and every permitted diagnostic source. */
export function encodeGenericPackageResponse(input, request) {
  const checked = context(request);
  return encode(normalizeIoResponse(input, checked.request, checked.requestId));
}
export function decodeGenericPackageResponse(bytes, request) {
  const checked = context(request);
  return normalizeIoResponse(read(bytes).value, checked.request, checked.requestId);
}
