// SPDX-License-Identifier: MIT
export function main(a: i32, c: i32): i32 { return pair(left(a), right(c)); }
function left(a: i32): i32 { return a + 1; }
function right(c: i32): i32 { return c + 2; }
function pair(a: i32, c: i32): i32 { return a * 10 + c; }
export function direct(n: i32): i32 { if (n === 0) { return 0; } else { return 1 + direct(n - 1); } }
export function even(n: i32): bool { if (n === 0) { return true; } else { return odd(n - 1); } }
function odd(n: i32): bool { if (n === 0) { return false; } else { return even(n - 1); } }
