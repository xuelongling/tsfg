<!-- SPDX-License-Identifier: MIT -->
# R03 strict floating point family

M08 extends the official Go source producer, owned Snapshot/HIR, registered MLIR
Core, bytecode and Zig Runtime to f32 and f64. The current declaration set is
minimal-conversions-v5 (including minimal-floats-v4): f32 is nominal, f64 aliases number, an uncontextualized decimal
or exponent literal defaults to f64, and an integer literal still defaults to
i32. Explicit floating contexts convert the exact mathematical literal directly
to the declared IEEE format with round-to-nearest, ties-to-even. Finite overflow
is diagnosed at the literal. Already typed values receive no implicit numeric
conversion. Legacy v3 declaration tests retain their narrower applicability.

Literal defaults propagate through grouping, unary plus/minus and arithmetic
expressions. Explicit contexts and typed reference/call facts take precedence;
an already inferred local never changes type to satisfy a later return.

Both source and HIR independently derive literal bits from the exact token with
integer/rational arithmetic. There is no intermediate host double conversion.
HIR transports the declared type, exact token and canonical bits; Core constants
use builtin f32/f64 types and fixed-width lowercase hexadecimal StringAttrs.
The complete current contract is exact-match 0.9.0, wire 9 and capability 20.
Float type codes are 12/13, constant opcode 32 and unary plus opcode 33. Existing
numeric arithmetic, negation and comparisons accept matching float types;
bitwise operations, shifts and bitwise not remain integer-only. M08 alone did
not implement module/host records; the current M13 registered shape uses
opcodes29/30 for typed globals (including f32/f64) and31 for explicitly
authorized i32 host calls. See contracts/bytecode.md for their table layout.

Each arithmetic operation rounds separately to its declared width, without
fusion. Subnormals are preserved. Arithmetic NaNs, including unary arithmetic,
are canonical positive quiet NaNs 7fc00000/7ff8000000000000. Comparisons involving
NaN are false except inequality. Raw transport through parameters, locals,
branches, calls and returns preserves all bits, including signaling NaNs and
payloads. Signaling NaN transport performs no floating arithmetic.

Remainder uses a quotient truncated toward zero, matching fmod semantics rather
than the IEEE nearest-quotient remainder. A zero result keeps the dividend sign.
A zero divisor, infinite dividend or NaN operand produces the canonical NaN;
a finite dividend modulo infinity returns the dividend. Runtime remainder uses
integer bit arithmetic and introduces no libm dependency.

The Runtime establishes masked exceptions, round-to-nearest and gradual
underflow on the executing thread for each request. It restores the entire
caller MXCSR, including sticky flags, on success, trap and abort. The current
x86_64 arithmetic closure uses SSE; the native host probe compares the entire
x87 environment, status and control around actual source-produced requests.
The Runtime-internal FloatingEnvironment export exists for this probe, without
adding a source or request API. The probe and the formal VM CLI have distinct
roles and evidence. Request and result frames retain exactly two fields:
type f32/f64 and value containing 8/16 lowercase hexadecimal digits. Malformed
frames are rejected before depth, fuel or instruction events.

Product-local Core/wire/request delegation is subject to the finite ECP input
conditions. The separately authorized source fork is an independent repository
boundary supplying adapted Snapshot facts; it is not a product-local producer.
The existing LLVM MLIR source slice and pinned native SDK remain bounded inputs;
the Runtime has no LLVM dependency. M15 native 0.2 remains i32/bool-only. Current
required declarations, schemas and consumed-file lists determine capability;
historical descriptive build prose and the M07 integer document record earlier
versions and do not change these current contracts.

The literal fixture freezes 54 exact rational expectations before execution.
The canonical arithmetic fixture freezes 672 cases after the explicit NaN
engineering choice, and the corrected remainder fixture freezes 102 exact
truncating-quotient cases. Original pending-NaN and remainder metadata artifacts
remain workspace history. Fixture raw hashes are checked before product runs;
product output never supplies expected bits. Additional fixtures cover raw NaN
transport, separate rounding, malformed frames, verifier corruption, optimizer
and incremental equivalence, and actual altered caller FP state. Existing
V1/V3 reuse findings remain representative, non-exhaustive guidance; M08 adds no
extraction experiment or scenario quota. Gate and review results belong to the
workspace M08/M08a tickets; this document makes no acceptance claim.
