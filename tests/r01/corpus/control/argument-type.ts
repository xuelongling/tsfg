// SPDX-License-Identifier: MIT
export function main(): i32 { return callee(true); }
function callee(n: i32): i32 { return n; }
