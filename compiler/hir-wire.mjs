// SPDX-License-Identifier: MIT
import { inspectGenericJson } from './generic-json.mjs';
import { readJson as readNullableJson } from './nullable-common.mjs';
import { readJson as readClosureJson } from './closure-common.mjs';
import { readExceptionHirJson } from './exception-hir-common.mjs';

// Classification uses only the old 16MiB envelope, never a candidate's narrower
// policy. Iterative scanning adds no depth limit to an already-valid old family.
const envelope = Object.freeze({ bytes: 16 * 1024 * 1024, depth: 16 * 1024 * 1024,
  jsonTokens: 16 * 1024 * 1024, stringBytes: 16 * 1024 * 1024,
  allowNul: true, rejectPrototypeKeys: false, safeNonnegativeIntegers: false });
export function readHirWire(bytes) {
  let input, ownedBytes;
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > envelope.bytes) throw new TypeError('HIR byte budget exceeded');
    ownedBytes = Uint8Array.from(bytes);
    input = inspectGenericJson(ownedBytes, envelope, ['format','family']);
  } catch (error) {
    if (error.jsonSelection?.kind === 'string' && error.jsonSelection.value === 'tsfg.exception-hir-candidate')
      return readExceptionHirJson(ownedBytes);
    throw new TypeError('r03-hir-invalid: HIR must contain valid UTF-8 JSON', { cause: error });
  }
  // The formal scalar/module HIR has contractVersion/schemaHash and no format.
  // A present candidate selector must be a string; absence keeps that old route.
  if (input.selection && input.selection.kind !== 'string')
    throw new TypeError('r03-hir-invalid: HIR requires a string root format family');
  const family = input.selection?.value;
  if (family === 'tsfg.exception-hir-candidate') return readExceptionHirJson(input.bytes);
  try {
    if (family === 'tsfg.closure-hir-candidate') return readClosureJson(input.bytes);
    if (family === 'tsfg.nullable-hir-candidate') return readNullableJson(input.bytes, false);
    if (input.selection) throw new TypeError('r03-hir-invalid: unknown root HIR family');
    return { text: input.text, value: JSON.parse(input.text) };
  } catch (error) { throw new TypeError('r03-hir-invalid: HIR must contain valid UTF-8 JSON', { cause: error }); }
}
