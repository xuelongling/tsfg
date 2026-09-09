// SPDX-License-Identifier: MIT
export function main(): i32 { return callee(1 / 0); }
function callee(n: i32): i32 { return n; }
