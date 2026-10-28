// SPDX-License-Identifier: MIT
import { check } from './exception-common.mjs';
import { exceptionIdentifierName } from './exception-identifiers.mjs';

const integers = ['i8','i16','i32','i64','u8','u16','u32','u64','isize','usize'];
const profiles = Object.freeze({
  'minimal-scalars-v2': Object.freeze({ primary: 'minimal-scalars-v2.d.ts', target: false, scalars: Object.freeze(['bool','i32','f64']) }),
  'minimal-integers-v3': Object.freeze({ primary: 'minimal-integers-v3.d.ts', target: true, scalars: Object.freeze(['bool', ...integers]) }),
  'minimal-floats-v4': Object.freeze({ primary: 'minimal-floats-v4.d.ts', target: true, scalars: Object.freeze(['bool', ...integers, 'f32','f64']) }),
  'minimal-conversions-v5': Object.freeze({ primary: 'minimal-conversions-v5.d.ts', target: true, marker: true, scalars: Object.freeze(['bool', ...integers, 'f32','f64']) }),
});
export function exceptionProfile(version) {
  check(typeof version === 'string' && Object.hasOwn(profiles, version), 'capability', 'exception declaration profile is not implemented');
  return profiles[version];
}
export function exceptionScalar(type, profile) {
  check(profile.scalars.includes(type), 'capability', 'scalar payload is not implemented for this declaration profile');
}
export function exceptionValueType(type, profile, aggregate = null) {
  if (type !== 'unknown' && !aggregate?.byType.has(type)) exceptionScalar(type, profile);
}
export function exceptionAnnotation(grammar, index, type, profile, allowUnknown = false) {
  if (type === 'unknown') check(allowUnknown, 'capability', 'unknown is not a callable parameter or result type');
  else exceptionScalar(type, profile);
  const spelling = grammar.spelling(index), decoded = ({ boolean: 'bool', number: 'f64' })[spelling] ?? spelling;
  check(decoded === type, 'type', 'source annotation differs from its declared payload type');
  return index + 1;
}
export function exceptionAssignmentType(target, value) {
  check(target === 'unknown' || target === value, 'type', 'assignment payload differs from the declared target');
}

// Read only the actual value declarations of the already digest-validated DTS.
// These three pinned profiles use ambient unique-symbol const declarations;
// interface/type names occupy the type namespace and do not conflict here.
export function exceptionDeclarationValues(content) {
  const values = new Set();
  for (const occurrence of content.matchAll(/\bdeclare\b/g)) {
    const declaration = /^declare\s+const\s+([$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*)\s*:\s*unique\s+symbol\s*;/u.exec(content.slice(occurrence.index));
    check(declaration, 'capability', 'pinned DTS value declaration grammar is not implemented');
    const name = exceptionIdentifierName(declaration[1]);
    check(!values.has(name), 'input', 'duplicate pinned DTS value declaration'); values.add(name);
  }
  return values;
}

// Source Checker installs these intrinsic values independently of pinned DTS:
// initializeChecker rejects script globalThis; addUndefinedToGlobalsOrErrorOnRedeclaration
// rejects non-type undefined declarations. Other checker-local special symbols
// are not script global declarations and must not become a guessed deny-list.
const intrinsicScriptValues = new Set(['undefined','globalThis']);
export function verifyExceptionScriptGlobal(name, declarationValues) {
  check(!intrinsicScriptValues.has(name), 'scope', 'script function conflicts with a language intrinsic global value');
  check(!declarationValues.has(name), 'scope', 'script function conflicts with an actual pinned DTS value binding');
}
