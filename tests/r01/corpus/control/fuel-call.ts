// SPDX-License-Identifier: MIT
export function main(): i32 { return callee(4); }
function callee(n: i32): i32 { return n + 1; }
