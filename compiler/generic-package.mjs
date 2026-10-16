// SPDX-License-Identifier: MIT
import { canonical } from "./identity.mjs";
import { genericPackageLimits, normalizeGenericPackage, packageFailure } from "./generic-package-shape.mjs";
import { readGenericJson, preflightGenericJson } from "./generic-json.mjs";
export { genericDefinitionKey, genericPackageId, genericPackageFormat, genericPackageLimits } from "./generic-package-shape.mjs";

/** Decode candidate-1 bytes to independent, deeply frozen protocol data. */
export function decodeGenericPackage(bytes) {
  const input = readGenericJson(bytes);
  const result = normalizeGenericPackage(input.value, true);
  const encoded = new TextEncoder().encode(canonical(result));
  if (encoded.length !== input.bytes.length || encoded.some((byte, index) => byte !== input.bytes[index]))
    packageFailure("canonical");
  return result;
}

/** Sort independent DTO arrays and validate claims; never repair wrong identities. */
export function encodeGenericPackage(input) {
  const result = normalizeGenericPackage(input);
  const bytes = new TextEncoder().encode(canonical(result));
  if (bytes.length > genericPackageLimits.bytes) packageFailure("limit");
  // Apply the same JSON depth/token budgets to the producer boundary.
  preflightGenericJson(new TextDecoder().decode(bytes));
  return bytes;
}
