// SPDX-License-Identifier: MIT
export function main(a: bool, c: bool): bool { return a && c; }
export function or(a: bool, c: bool): bool { return a || c; }
export function andTrap(a: bool): bool { return a && (1 / 0 === 0); }
export function orTrap(a: bool): bool { return a || (2 % 0 === 0); }
