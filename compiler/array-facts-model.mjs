// SPDX-License-Identifier: MIT
// Complete cold package ownership. Official type and symbol proof stays with Source.
import { sha256 } from './identity.mjs';
import { arrayCheck, arrayRecord, list, logicalPath, equal, originIdentity, window } from './array-facts-common.mjs';
import { validateArrayFunctions } from './array-facts-functions.mjs';
export { arrayFactsLimits, arrayFactsFailure, arrayCheck, arrayRecord, arrayIndexDecimal } from './array-facts-common.mjs';

function sources(payload) {
  logicalPath(payload.sourceRoot); logicalPath(payload.rootFile);
  const dtsPath = payload.sourceRoot + '/minimal-arrays-v2.d.ts';
  arrayCheck(payload.rootFile.startsWith(payload.sourceRoot + '/') && payload.rootFile.endsWith('.ts')
    && !payload.rootFile.endsWith('.d.ts'), 'input');
  arrayRecord(payload.config, ['strict', 'noEmit', 'allowJs']);
  arrayCheck(payload.config.strict === true && payload.config.noEmit === true && payload.config.allowJs === false, 'input');
  arrayRecord(payload.declarations, ['version', 'paths']);
  arrayCheck(payload.declarations.version === 'minimal-arrays-v2'
    && equal(payload.declarations.paths, [dtsPath]), 'input');
  const files = list(payload.files, 2, 2), seen = new Set();
  let previous;
  for (const file of files) {
    arrayRecord(file, ['path', 'content', 'sha256', 'byteLength', 'utf16Length']);
    logicalPath(file.path);
    arrayCheck(!seen.has(file.path) && [payload.rootFile, dtsPath].includes(file.path), 'input');
    if (previous !== undefined) arrayCheck(Buffer.compare(Buffer.from(previous), Buffer.from(file.path)) < 0, 'input');
    previous = file.path; seen.add(file.path);
    arrayCheck(typeof file.content === 'string' && file.content.isWellFormed(), 'input');
    const size = Buffer.byteLength(file.content, 'utf8');
    arrayCheck(size <= 65536 && file.content.length <= 65536, 'limit');
    arrayCheck(file.byteLength === size && file.utf16Length === file.content.length, 'input');
    arrayCheck(/^[0-9a-f]{64}$/.test(file.sha256) && file.sha256 === sha256(file.content).slice(7), 'identity');
  }
  const declaration = files.find(file => file.path === dtsPath);
  arrayCheck(declaration && declaration.byteLength === 331
    && declaration.sha256 === '6420493372913f019f64b094e181d1346afcca79e720ea85dc5e5026e03ba01e', 'input');
  const source = files.find(file => file.path === payload.rootFile);
  arrayCheck(source, 'input'); return { source, declaration };
}
function types(rows, declaration) {
  list(rows, 3, 3);
  const content = declaration.content;
  const at = token => ({ start: content.indexOf(token), end: content.indexOf(token) + token.length });
  const f64 = { id: 'f64', kind: 'scalar', sourcePath: declaration.path,
    declarationRange: at('type f64 = number;'), nameRange: at('f64') };
  const array = { id: 'array.f64', kind: 'array', elementType: 'f64', sourcePath: declaration.path,
    declarationRange: at('interface Array<T> { [n: number]: T; length: number; }'),
    nameRange: at('Array'), indexSignatureRange: at('[n: number]: T;') };
  const u32 = { id: 'u32', kind: 'scalar', sourcePath: declaration.path,
    declarationRange: at('type u32 = number;'), nameRange: at('u32') };
  arrayCheck(equal(rows, [f64, array, u32]), 'input');
}
function lengthProperty(value, declaration) {
  const expected = { id: originIdentity('tsfg.array-facts.binding.v1', declaration.path, {start:275,end:281}, 'nameRange'),
    kind: 'property', name: 'length', ownerType: 'array.f64', officialType: 'number', writeType: 'u32',
    sourcePath: declaration.path, declarationRange: {start:275,end:290}, nameRange: {start:275,end:281},
    typeRange: {start:283,end:289} };
  arrayCheck(equal(value, expected), 'input');
}
export function validateArrayFactsPayload(payload) {
  arrayRecord(payload, ['sourceRoot','rootFile','positionUnit','config','declarations','files','types','arrayLength','functions','exports','diagnostics']);
  arrayCheck(payload.positionUnit === 'utf16', 'input');
  const { source, declaration } = sources(payload); types(payload.types, declaration);
  lengthProperty(payload.arrayLength, declaration); list(payload.diagnostics, 0, 0);
  const functions = validateArrayFunctions(payload, source), exports = list(payload.exports, 1, 16);
  const expected = functions.filter(fn => /^export\s+function\s+$/.test(window(source.content, fn.declarationRange.start, fn.nameRange.start)))
    .map(fn => ({name:fn.name,functionId:fn.id}))
    .sort((a,b) => Buffer.compare(Buffer.from(a.name),Buffer.from(b.name)));
  arrayCheck(equal(exports, expected), 'identity');
}
