// SPDX-License-Identifier: MIT
import { canonical, own, sha256 } from './identity.mjs';
import { genericPackageFormat, genericPackageLimits, decodeGenericPackage } from './generic-package.mjs';
import { checkGenericJsonValueBudget, genericPackageIoJsonPolicy } from './generic-json.mjs';
import { validateGenericInstanceResult } from './generic-instance.mjs';
import { genericInputPathsDisjoint } from './generic-package-shape.mjs';

export const genericPackageIoFormat = own({ family: 'tsfg.generic-package-io-candidate', version: 1 });
export const ioFailure = category => { throw Object.assign(new TypeError(
  'generic-package-io-' + category + ': invalid package IO candidate'), { code: 'generic-package-io-' + category }); };
const check = (value, category = 'schema') => { if (!value) ioFailure(category); };
export function ioRecord(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  check(actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key)
    && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable));
}
function field(value, key) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  check(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable);
  return descriptor.value;
}
function array(value, maximum, minimum = 0) {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
  check(value.length >= minimum && value.length <= maximum, 'limit');
  const keys = Reflect.ownKeys(value);
  check(keys.length === value.length + 1 && keys.every(key => key === 'length'
    || typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
  return value;
}
function string(value, maximum = 1048576, nonempty = false, allowNul = false) {
  check(typeof value === 'string' && value.isWellFormed() && (allowNul || !value.includes('\0')));
  check(!nonempty || value.length > 0);
  check(Buffer.byteLength(value, 'utf8') <= maximum, 'limit');
  return value;
}
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const same = (a, b) => canonical(a) === canonical(b);
function path(value, declaration) {
  string(value, 4096, true);
  check(value.startsWith('/') && !value.includes('\\') && value.slice(1).split('/')
    .every(part => part && part !== '.' && part !== '..')
    && (declaration ? value.endsWith('.d.ts') : value.endsWith('.ts') && !value.endsWith('.d.ts')));
}
export function ioSourceMetadata(file) {
  const surrogateStarts = [];
  for (let index = 0; index < file.content.length; index++) {
    const code = file.content.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { surrogateStarts.push(index); index++; }
  }
  return { digest: sha256(file.content).slice(7), length: file.content.length,
    path: file.path, positionUnit: 'utf16', surrogateStarts };
}
function environment(value) {
  ioRecord(value, ['profile', 'files']);
  check(value.profile === genericPackageFormat.declarationProfile);
  array(value.files, 8, 1);
  const paths = new Set();
  for (const file of value.files) {
    ioRecord(file, ['path', 'content', 'digest']); path(file.path, true);
    string(file.content, 1048576, true); check(digest(file.digest));
    check(!paths.has(file.path), 'reference'); paths.add(file.path);
  }
}
function roots(value) {
  array(value, 256, 1);
  for (const root of value) {
    ioRecord(root, ['definition', 'typeArguments']); check(digest(root.definition));
    array(root.typeArguments, 16, 1);
    for (const argument of root.typeArguments) {
      ioRecord(argument, ['kind', 'parameter']);
      check(['boolean', 'number'].includes(argument.kind) && argument.parameter === 0 && !Object.is(argument.parameter, -0));
    }
  }
}
/** Only framing is established here; nested payload/domain success is not claimed. */
export function normalizeIoRequest(input) {
  checkGenericJsonValueBudget(input, genericPackageIoJsonPolicy);
  const operation = field(input, 'operation');
  check(['export', 'instantiate'].includes(operation));
  ioRecord(input, operation === 'export' ? ['family', 'version', 'operation', 'scope', 'source', 'environment']
    : ['family', 'version', 'operation', 'package', 'roots']);
  check(input.family === genericPackageIoFormat.family && input.version === 1, 'identity');
  return own(input);
}
function validateExportDomain(request) {
  string(request.scope, 256, true); environment(request.environment);
  ioRecord(request.source, ['path', 'content', 'digest']); path(request.source.path, false);
  string(request.source.content, 3145728, true, true);
  check(request.source.content.length <= genericPackageLimits.sourceUTF16, 'limit');
  check(digest(request.source.digest) && request.source.digest === sha256(request.source.content).slice(7), 'identity');
  check(genericInputPathsDisjoint([request.source.path, ...request.environment.files.map(file => file.path)]), 'input');
  check(request.environment.files.every(file => file.digest === sha256(file.content).slice(7)), 'identity');
}
function validatedPackage(value) {
  checkGenericJsonValueBudget(value);
  return decodeGenericPackage(new TextEncoder().encode(canonical(value)));
}
function ownedInputs(request) {
  try {
    if (request.operation === 'export') {
      validateExportDomain(request);
      return [ioSourceMetadata(request.source), ...request.environment.files.map(ioSourceMetadata)];
    }
    const pkg = validatedPackage(request.package);
    return [pkg.payload.source, ...pkg.payload.environment.files.map(ioSourceMetadata)];
  } catch { return []; }
}
function primary(value, request) {
  if (value === null) return;
  ioRecord(value, ['source', 'origin']);
  const owned = ownedInputs(request);
  check(owned.some(source => same(source, value.source)), 'origin');
  ioRecord(value.origin, ['start', 'end']);
  const { start, end } = value.origin, source = value.source;
  check(Number.isSafeInteger(start) && Number.isSafeInteger(end) && !Object.is(start, -0) && !Object.is(end, -0)
    && start >= 0 && start <= end && end <= source.length
    && source.surrogateStarts.every(position => start !== position + 1 && end !== position + 1), 'origin');
}
/** Match response ownership before accepting any producer claim. */
export function normalizeIoResponse(input, request, requestId) {
  checkGenericJsonValueBudget(input, genericPackageIoJsonPolicy);
  const status = field(input, 'status');
  check(['ok', 'error'].includes(status));
  ioRecord(input, status === 'ok' ? ['family', 'version', 'operation', 'requestId', 'status', 'value']
    : ['family', 'version', 'operation', 'requestId', 'status', 'diagnostic']);
  check(input.family === genericPackageIoFormat.family && input.version === 1
    && input.operation === request.operation && input.requestId === requestId, 'identity');
  if (status === 'error') {
    const diagnostic = input.diagnostic;
    ioRecord(diagnostic, ['kind', 'code', 'detail', 'primary']);
    string(diagnostic.kind, 1048576, true); string(diagnostic.detail);
    check(Number.isSafeInteger(diagnostic.code) && !Object.is(diagnostic.code, -0)
      && diagnostic.code >= 0 && diagnostic.code <= 2147483647);
    primary(diagnostic.primary, request);
  } else if (request.operation === 'export') {
    validateExportDomain(request);
    const pkg = validatedPackage(input.value);
    const files = [...request.environment.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    check(ownedInputs(request).length > 0 && pkg.payload.scope === request.scope
      && same(pkg.payload.source, ioSourceMetadata(request.source))
      && same(pkg.payload.environment, { profile: request.environment.profile, files }), 'identity');
  } else {
    roots(request.roots);
    const pkg = validatedPackage(request.package);
    const bytes = new TextEncoder().encode(canonical(pkg));
    validateGenericInstanceResult(bytes, input.value, request.roots);
  }
  return own(input);
}
