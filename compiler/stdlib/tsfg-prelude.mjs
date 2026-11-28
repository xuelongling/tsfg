// SPDX-License-Identifier: MIT
// Embedded Official tsfg Core Prelude & Windows x64 Frontend Configuration.
// Removes any runtime dependency on `tests/r03/common-program-positive.json` so `tsfgc`
// operates cleanly inside standalone Windows x64 SDK distributions.
import { createHash } from 'node:crypto';
import { WINDOWS_X64_TARGET } from '../r04-identity.mjs';

export const TSFG_PRELUDE_VIRTUAL_PATH = '/src/minimal-arrays-v8.d.ts';

export const TSFG_PRELUDE_DTS = [
  '// SPDX-License-Identifier: MIT',
  'interface Object {}',
  'interface Function {}',
  'interface CallableFunction {}',
  'interface NewableFunction {}',
  'interface IArguments {}',
  'interface String {}',
  'interface Number {}',
  'interface Boolean {}',
  'interface RegExp {}',
  'interface Array<T> { [n: number]: T; length: number; }',
  'type i8 = number;',
  'type i16 = number;',
  'type i32 = number;',
  'type i64 = number;',
  'type isize = number;',
  'type u8 = number;',
  'type u16 = number;',
  'type u32 = number;',
  'type u64 = number;',
  'type usize = number;',
  'type f32 = number;',
  'type f64 = number;',
  'type bool = boolean;',
  'interface ReadSpan<T> { readonly [n: number]: T; readonly length: u32; }',
  'declare function readSpan<T>(owner: T[], start: u32, length: u32): ReadSpan<T>;',
  'interface ClassDecoratorContext<C> {',
  '  readonly kind: "class";',
  '  readonly name: string | undefined;',
  '  addInitializer(initializer: (this: C) => void): void;',
  '}',
  'declare function tsfgValue<C>(target: C, context: ClassDecoratorContext<C>): void;',
  'declare function tsfgComponent<C>(target: C, context: ClassDecoratorContext<C>): void;',
  '',
].join('\n');

export const TSFG_PRELUDE_SHA256 = createHash('sha256')
  .update(Buffer.from(TSFG_PRELUDE_DTS, 'utf8'))
  .digest('hex');

export const TSFG_FRONTEND_DECLARATIONS = Object.freeze({
  paths: [TSFG_PRELUDE_VIRTUAL_PATH],
  version: 'minimal-arrays-v8',
});

export const TSFG_FRONTEND_CONFIG = Object.freeze({
  allowJs: false,
  noEmit: true,
  strict: true,
});

export const TSFG_FRONTEND_TARGET = Object.freeze({
  llvmDataLayout: WINDOWS_X64_TARGET.llvmDataLayout,
  pointerBits: '64',
  target: WINDOWS_X64_TARGET.target,
  triple: WINDOWS_X64_TARGET.triple,
});
