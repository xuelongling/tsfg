// SPDX-License-Identifier: MIT
// Official tsfg Standard Language Declarations (Windows x64 Product SDK Prelude).
// Describes fixed-width numerics, value/component/system/gpu_kernel/abi markers,
// dense arrays, Span/ReadSpan borrows, StringView, Handle<T>, and ECS Query types.

type i8 = number;
type i16 = number;
type i32 = number;
type i64 = number;
type isize = number;
type u8 = number;
type u16 = number;
type u32 = number;
type u64 = number;
type usize = number;
type f16 = number;
type f32 = number;
type f64 = number;
type bool = boolean;

interface ReadSpan<T> {
  readonly [n: number]: T;
  readonly length: u32;
}

interface Span<T> {
  [n: number]: T;
  readonly length: u32;
}

interface StringView {
  readonly byteLength: usize;
}

interface Handle<T> {
  readonly index: u32;
  readonly generation: u32;
}

interface Read<T> {
  readonly value: T;
}

interface Write<T> {
  value: T;
}

interface Query<T extends readonly unknown[]> {
  [Symbol.iterator](): Iterator<T>;
}

declare function readSpan<T>(owner: T[], start: u32, length: u32): ReadSpan<T>;
declare function mutSpan<T>(owner: T[], start: u32, length: u32): Span<T>;

declare function value<C>(target: C, context?: unknown): void;
declare function component<C>(target: C, context?: unknown): void;
declare function abi<C>(target: C, context?: unknown): void;
declare function system<F>(target: F, context?: unknown): void;
declare function gpu_kernel<F>(target: F, context?: unknown): void;
declare function tsfgValue<C>(target: C, context?: unknown): void;
declare function tsfgComponent<C>(target: C, context?: unknown): void;
