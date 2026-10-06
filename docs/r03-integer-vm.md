<!-- SPDX-License-Identifier: MIT -->
# R03 integer family

M07 extends the official Go frontend, owned Snapshot/HIR, registered MLIR Core,
R04 packet and formal Zig Runtime to i8/i16/i32/i64/u8/u16/u32/u64/isize/usize.
Uncontextualized integer literals default to i32. Explicit integer contexts
type exact mathematical tokens without host f64. Direct unary minus over a
literal checks the complete mathematical value, so every signed MIN is legal;
already typed values remain nominal and receive no implicit numeric conversion.

Arithmetic wraps modulo2^width. Signed division truncates toward zero; remainder
has the dividend's sign. MIN/-1 returnsMIN and MIN%-1 returns0. Zero division and
remainder retain their separate R01 traps. Shift counts are i32 and must be
within0..width-1; signed >> sign extends, unsigned >> and >>> zero fill.

isize/usize retain distinct type/signature/function identities even when their
width equals i64/u64. The Core producer reads address-space0 pointer width and
ABI alignment from the exact LLVM target DataLayout; Zig checks native usize
width/alignment before loading the module. The supported Windows x86_64 target
is64bits with8-byte pointer alignment. Incorrect targets/layouts are rejected.

Snapshot/HIR/Core/bytecode use exact-match0.6.0 with wire6 and capability17.
Existing i32/bool type codes1/2, stable IDs and opcodes1..27 are preserved.
Codes3..11 identify the other nominal integers. Registered custom MLIR types
use !tsfg_core.integer<"name">; persisted custom integer constants contain
canonical decimal strings independently checked by C++ APInt. Opcode28 carries
canonical zero extended low-width bits. The Runtime independently validates
complete function signatures, typed SSA/CFG, dominance, source anchors, layout,
all call edges, and canonical constant bits before any request, including
functions the request never enters. Public Runtime requests use concrete typed
Zig values; transport integers are canonical decimal strings and bool isJSONbool.

Fuel, depth, caller argument order and cleanup remain the M06 semantics. The
physical frame stores64-bit words and accounts actual allocation sizes; no
physical allocation priority is inferred beyond the attempted instruction
boundary. Trap/abort ends the request and cleans Runtime state without guest
finally or rollback. Subsequent requests can use the same host.

Tests in tests/r03/integer-vm.test.mjs and integer-core.test.mjs cover each type's
independent mathematical boundaries, exact literals, wrap/div/rem/shifts/MIN,
nominal/context/range negatives, public verify/print/read/lower/roundtrip,
corrupt identities/layout/highbits, calls/CFG and incremental/optimized
equivalence. Formal immutable source/build/review evidence is recorded in the
workspace ticket07; this document itself does not assert those gates passed.
