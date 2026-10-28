// SPDX-License-Identifier: MIT
import path from 'node:path';
import { prepareExceptionAggregateInput } from './exception-aggregate-input.mjs';
import { prepareExceptionModuleInput } from './exception-module-input.mjs';
import { exceptionProfile, exceptionDeclarationValues } from './exception-types.mjs';
import { check, record, array, text, same, sha256, canonical, declarationDigests, targetShape, wireLimits } from './exception-common.mjs';

// Ordinary inputs own one source and the complete pinned declaration closure.
// Module closures remain a separate capability.
export function prepareExceptionInput(input) {
  record(input, ['sourceRoot','rootFile','files','declarations','config'], ['target','compilationClosure']);
  record(input.declarations, ['version','paths'], ['markerProfile']);
  const profile = exceptionProfile(input.declarations.version);
  const hasMarker = Object.hasOwn(input.declarations, 'markerProfile');
  check(!profile.marker || hasMarker, 'capability', 'conversion profile currently requires actual aggregate marker input');
  if (!hasMarker) check(same(input.config, { strict: true, noEmit: true, allowJs: false }), 'input');
  check(profile.target ? same(input.target, targetShape) : !Object.hasOwn(input, 'target'), 'input', 'declaration profile target differs');
  const canonicalPath = value => {
    text(value); check(value.startsWith('/') && value !== '/' && path.posix.normalize(value) === value
      && !value.endsWith('/') && !value.includes('\\'), 'input', 'noncanonical logical path');
  };
  canonicalPath(input.sourceRoot); canonicalPath(input.rootFile);
  check(input.rootFile.startsWith(input.sourceRoot + '/') && input.rootFile.endsWith('.ts')
    && !input.rootFile.endsWith('.d.ts'), 'input');
  const supplied = array(input.files, wireLimits.files, 1), seen = new Set();
  for (const file of supplied) {
    record(file, ['path','content'], ['sha256']); canonicalPath(file.path);
    check(file.path.startsWith(input.sourceRoot + '/') && !seen.has(file.path)
      && typeof file.content === 'string' && file.content.isWellFormed(), 'input');
    if (Object.hasOwn(file, 'sha256')) check(file.sha256 === sha256(file.content), 'identity');
    seen.add(file.path);
  }
  const primary = input.sourceRoot + '/' + profile.primary;
  const moduleInput = prepareExceptionModuleInput(input, supplied, profile);
  const aggregateInput = prepareExceptionAggregateInput(input, supplied), declarationPaths = aggregateInput?.paths ?? [primary];
  check(same(input.declarations.paths, declarationPaths) && (moduleInput !== null || supplied.length === declarationPaths.length + 1)
    && declarationPaths.every(file => seen.has(file)) && seen.has(input.rootFile), 'input', 'complete supplied input closure differs');
  const declaration = supplied.find(file => file.path === primary);
  check(sha256(declaration.content) === declarationDigests[profile.primary], 'identity');
  const declarationValues = aggregateInput
    ? new Set([...aggregateInput.globals].filter(([, kind]) => kind === 'const').map(([name]) => name))
    : exceptionDeclarationValues(declaration.content);
  const files = supplied.map(file => ({ path: file.path, content: file.content }))
    .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  const identityInput = { ...structuredClone(input), files };
  const manifest = files.map(file => ({ path: file.path, digest: sha256(file.content), byteLength: Buffer.byteLength(file.content),
    length: file.content.length, positionUnit: 'utf16' }));
  const sources = files.filter(file => !file.path.endsWith('.d.ts')).map(file => ({ ...file, hash: sha256(file.content),
    length: file.content.length, positionUnit: 'utf16' }));
  return { identityInput, inputIdentity: sha256(canonical(identityInput)), files: manifest, sources, profile, declarationValues, aggregateInput, moduleInput, target: profile.target ? structuredClone(input.target) : null };
}
