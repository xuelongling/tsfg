// SPDX-License-Identifier: MIT
export function operands(): i32 { return (1 / 0) + (2 % 0); }
export function arguments(): i32 { return pair(2 % 0, 1 / 0); }
function pair(a: i32, c: i32): i32 { return a + c; }
export function folded(): i32 { return 1 / 0; }
export function branch(flag: bool): i32 { if (flag) { return 9; } else { return 1 / 0; } }
export function loop(): i32 { while (false) { return 2 % 0; } return 8; }
