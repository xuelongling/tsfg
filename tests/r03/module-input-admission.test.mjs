// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { admittedConversionScope, admittedInputScope } from '../../compiler/conversions.mjs';
import { canonical, sha256 } from '../../compiler/identity.mjs';
import bytecodeSchema from '../../contracts/bytecode.schema.json' with { type: 'json' };

const declaration = await readFile(new URL('../../compiler/minimal-conversions-v5.d.ts', import.meta.url), 'utf8');
function moduleInput(files = []) {
  return {
    config: { allowJs: false, noEmit: true, strict: true },
    declarations: { paths: ['/src/minimal-conversions-v5.d.ts'], version: 'minimal-conversions-v5' },
    files: [
      { path: '/src/main.ts', content: 'import {leaf} from "./leaf"; export function entry(x:f64):i8 { return checked_i8_from_f64(leaf(x)); }' },
      { path: '/src/leaf.ts', content: 'export function leaf(x:f64):f64 { return x; }' },
      { path: '/src/minimal-conversions-v5.d.ts', content: declaration },
      ...files,
    ].sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path))),
    rootFile: '/src/main.ts', sourceRoot: '/src',
    target: { ...bytecodeSchema.target, pointerBits: '64' },
    compilationClosure: { roots: [{ kind: 'application', sourcePath: '/src/main.ts', name: 'entry' }], requiredRoots: [] },
  };
}
const identity = scope => sha256(canonical(scope));
// These are VFS admission checks, not official checker facts or Source admission.

test('normalized module input retains the complete Source universe at conversion admission', () => {
  const scope = moduleInput([{ path: '/src/unselected.ts', content: 'export const unused = 1 < 2;' }]);
  assert.equal(admittedInputScope(scope, identity(scope)), true);
  assert.equal(admittedConversionScope(scope, identity(scope)), true);
});

test('comparison initializers cannot hide a later global conversion-brand declaration', () => {
  const ordinary = moduleInput([{ path: '/src/unselected.ts', content: 'const ordinary = 1 < 2, unrelated = 0;' }]);
  assert.equal(admittedConversionScope(ordinary, identity(ordinary)), true);
  const collision = moduleInput([{ path: '/src/unselected.ts', content: 'const ordinary = 1 < 2, __tsfg_i8 = 0;' }]);
  assert.equal(admittedInputScope(collision, identity(collision)), true);
  assert.equal(admittedConversionScope(collision, identity(collision)), false);
  for (const content of [
    'const ordinary = (1 < 2), __tsfg_i8 = 0;',
    'const ordinary: Array<number> = [], __tsfg_i8 = 0;',
    'const ordinary = 1 < 2, safe: Array<number> = [], __tsfg_i8 = 0;',
  ]) {
    const scope = moduleInput([{ path: '/src/unselected.ts', content }]);
    assert.equal(admittedConversionScope(scope, identity(scope)), false, content);
  }
});

test('binding pattern defaults cannot hide a later global conversion-brand declaration', () => {
  const ordinary = moduleInput([{ path: '/src/unselected.ts', content: 'const {safe = 1 < 2} = {}, unrelated = 0;' }]);
  assert.equal(admittedConversionScope(ordinary, identity(ordinary)), true);
  const collision = moduleInput([{ path: '/src/unselected.ts', content: 'const {safe = 1 < 2} = {}, __tsfg_i8 = 0;' }]);
  assert.equal(admittedInputScope(collision, identity(collision)), true);
  assert.equal(admittedConversionScope(collision, identity(collision)), false);
});

test('module admission rejects rehashed malformed roots, files, target and declaration identities', () => {
  const changes = [
    scope => scope.files.reverse(),
    scope => scope.files.push({ ...scope.files[0] }),
    scope => { scope.files[0].path = '/outside/leaf.ts'; },
    scope => { scope.files[0].path = '/src/../leaf.ts'; },
    scope => { scope.files[0].path = '/src/leaf.tsx'; },
    scope => { scope.rootFile = '/src/missing.ts'; },
    scope => scope.declarations.paths.push('/src/leaf.ts'),
    scope => scope.declarations.paths.push('/src/missing.d.ts'),
    scope => { scope.target.pointerBits = '32'; },
    scope => { scope.config.strict = false; },
    scope => scope.compilationClosure.roots.push({ ...scope.compilationClosure.roots[0] }),
    scope => { scope.compilationClosure.roots[0].sourcePath = '/src/missing.ts'; },
    scope => { scope.compilationClosure.roots[0].sourcePath = '/src/minimal-conversions-v5.d.ts'; },
    scope => { scope.compilationClosure.roots[0].name = ''; },
    scope => { scope.compilationClosure.roots[0].kind = 'arbitrary'; },
  ];
  for (const [index, change] of changes.entries()) {
    const scope = moduleInput(); change(scope);
    assert.equal(admittedInputScope(scope, identity(scope)), false, `mutation ${index}`);
  }
  const scope = moduleInput();
  assert.equal(admittedInputScope(scope, 'sha256:' + '0'.repeat(64)), false);
  const reorderedRoots = { ...scope, compilationClosure: { roots: [
    { kind: 'hot-function', sourcePath: '/src/leaf.ts', name: 'leaf' },
    ...scope.compilationClosure.roots,
  ], requiredRoots: [] } };
  assert.equal(admittedInputScope(reorderedRoots, identity(reorderedRoots)), false);
  const alteredDeclaration = moduleInput();
  alteredDeclaration.files.find(file => file.path.endsWith('minimal-conversions-v5.d.ts')).content += '\ndeclare const forged:i32;';
  assert.equal(admittedInputScope(alteredDeclaration, identity(alteredDeclaration)), true);
  assert.equal(admittedConversionScope(alteredDeclaration, identity(alteredDeclaration)), false);
});

test('conversion exclusivity covers unselected scripts and global augmentations but permits module locals', () => {
  /** @type {Array<[string, boolean]>} */
  const cases = [
    ['declare function checked_i8_from_f64(value:f64):i8;', false],
    ['export {}; declare global { function checked_i8_from_f64(value:f64):i8; }', false],
    ['declare const __tsfg_\\u00698:unique symbol;', false],
    ['export declare function checked_i8_from_f64(value:f64):i8;', true],
    ['export const __tsfg_i8 = 0;', true],
    ['import {leaf as checked_i8_from_f64} from "./leaf"; export {};', true],
    ['const text="declare function checked_i8_from_f64()"; /* type f64=never; */', true],
  ];
  for (const [content, expected] of cases) {
    const scope = moduleInput([{ path: '/src/unselected.ts', content }]);
    assert.equal(admittedConversionScope(scope, identity(scope)), expected, content);
  }
  for (const [content, expected] of /** @type {Array<[string, boolean]>} */ ([
    ['declare const __tsfg_i8:unique symbol;', false],
    ['export {}; declare global { interface f64 {} }', false],
    ['declare const hidden:boolean;', true],
    ['import "./missing";', false],
  ])) {
    const scope = moduleInput([{ path: '/src/unselected.d.ts', content }]);
    assert.equal(admittedConversionScope(scope, identity(scope)), expected, content);
  }
});

test('normalized Host inputs keep the fixed declaration source and capability shape', () => {
  const base = moduleInput([{ path: '/src/host.d.ts', content: 'declare function tally(x:i32):i32; declare function tick(x:i32):i32;' }]);
  base.declarations.paths.push('/src/host.d.ts');
  const scope = { ...base, hostImports: ['tally', 'tick'].map(name => ({
    sourcePath: '/src/host.d.ts', name, capabilityId: 31, parameterTypes: ['i32'], returnType: 'i32',
  })) };
  assert.equal(admittedConversionScope(scope, identity(scope)), true);
  for (const change of [
    value => value.hostImports.reverse(),
    value => value.hostImports.push({ ...value.hostImports[0] }),
    value => { value.hostImports[0].sourcePath = '/src/missing.d.ts'; },
    value => { value.hostImports[0].sourcePath = '/src/main.ts'; },
    value => { value.hostImports[0].capabilityId = 32; },
    value => { value.hostImports[0].parameterTypes = ['f64']; },
    value => { value.hostImports[0].returnType = 'f64'; },
    value => { value.hostImports[0].name = ''; },
  ]) {
    const changed = structuredClone(scope); change(changed);
    assert.equal(admittedInputScope(changed, identity(changed)), false);
  }
  assert.equal(admittedInputScope({ ...scope, hostImports: {} }, identity({ ...scope, hostImports: {} })), false);
});

test('single-source admission preserves its original file and input-key restrictions', () => {
  const { compilationClosure, ...base } = moduleInput();
  const scope = { ...base, files: base.files.filter(file => file.path !== '/src/leaf.ts').map(file =>
    file.path === '/src/main.ts' ? { ...file, content: 'export function entry(x:f64):i8 { return checked_i8_from_f64(x); }' } : file) };
  assert.equal(admittedConversionScope(scope, identity(scope)), true);
  assert.equal(admittedInputScope({ ...scope, hostImports: [] }, identity({ ...scope, hostImports: [] })), false);
  const extraSource = { ...scope, files: [...scope.files, { path: '/src/unselected.ts', content: 'export {};' }] };
  assert.equal(admittedInputScope(extraSource, identity(extraSource)), false);
  const unusedDeclaration = { ...scope, files: [...scope.files, { path: '/src/unselected.d.ts', content: 'declare const __tsfg_i8:unique symbol;' }] };
  assert.equal(admittedConversionScope(unusedDeclaration, identity(unusedDeclaration)), true);
  unusedDeclaration.declarations = { ...scope.declarations, paths: [...scope.declarations.paths, '/src/unselected.d.ts'] };
  assert.equal(admittedConversionScope(unusedDeclaration, identity(unusedDeclaration)), false);
});
