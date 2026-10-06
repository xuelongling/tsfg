<!-- SPDX-License-Identifier: MIT -->

# Scalar arithmetic compiler and Runtime

This document records the M03 slice and its former 0.2.0/v2 format. The current
development chain includes [M04 linear locals](r03-locals-vm.md), with HIR and
R04 0.3.0/wire v3. The version and return-only limits below describe M03.

M03 extends the [constant-return chain](r03-constant-vm.md) with i32 arithmetic,
bitwise operations, shifts, comparison and bool. The official frontend checks
every source file; its owned facts become independent immutable HIR. The real
C++ MLIR consumer verifies typed SSA and emits versioned R04 v2. The formal Zig
Runtime admits that packet before executing any instruction. No JavaScript
interpreter, frontend AST backend access or fallback executes the source.

For example, `export function answer(): i32 { return 2147483647 + 1; }`
returns `{ "type": "i32", "value": "-2147483648" }`. A bool return uses a JSON
boolean, for example `{ "type": "bool", "value": true }`.

The HIR and R04 contracts are version 0.2.0 and older packets are rejected.
See [HIR](../contracts/hir.md) and [R04](../contracts/bytecode.md) for the complete
operation/type domains, physical limits, source anchors and identity rules.
The source/build commands and tool qualification requirements remain those in
the constant-return guide. Native manifests now describe the scalar capability.

The first failing divide, remainder or shift instruction returns its R01 Trap
and Rule identity, FunctionId and original UTF-16 source span. Native arithmetic
preconditions are checked before division or narrowing a shift count. A request
failure frees its frame and leaves the same Runtime available for the next
checked source module. `runRequestSequence` frames R04 packets for that same-host
acceptance; it does not add bytecode calls or general control flow.

Only the first return is reached in the current return-only source body. Later
scalar returns remain checked and owned without being emitted, so a later
division by zero causes no early trap. Official errors in those later expressions
still reject the source. There are no locals, parameters, calls, branches, AOT,
user catch/finally, borrow analysis, managed roots, arrays, spans or GPU execution
in this ticket. The accepted Q3–Q13 decisions remain prerequisites for those
later capabilities; this slice does not claim their full verification.

`arithmetic-vm.test.mjs` executes expressions using independently authored R01
numeric oracle values and literal mathematical expectations. Parameterized R01
cases are adapted into zero-argument scalar expressions using their specified
argument literals. This verifies their numeric results and traps, not the
original parameter/call programs or all of R01. `arithmetic-contract.test.mjs`
checks every registered operation's typed verifier and canonical read/write,
actual R04 corruption rejection, source spelling transformations and
full/incremental output equivalence. Structural tests are reported separately
from execution. Neither set substitutes for the entire R03 language acceptance.
