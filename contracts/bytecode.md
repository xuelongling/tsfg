<!-- SPDX-License-Identifier: MIT -->

# tsfg.bytecode 0.1.0

This exact development format is the formal R04 compiler-to-Zig VM seam. No
published format or supported external consumer predates it. Producer and
consumer change atomically in this product repository. A different version or
schema hash is incompatible and invalidates cached bytecode. The registry is
the sole version/hash authority; the JSON schema describes the binary layout.

All integers are explicitly little endian; no host struct is dumped. The header
is 80 bytes: magic `TSFGTBC0`, u32 version 1 (SemVer 0.1.0), raw 32-byte schema
SHA-256, u32 total byte length, and raw 32-byte SHA-256 of the remaining payload.
UTF-8 strings have a u32 byte length and no terminator. Schema field order is
wire order. No padding, duplicate fields, reserved data, or trailing bytes are
accepted. Limits are checked before allocation. The checksum proves integrity,
not publisher authenticity or authorization.

The current capability is one zero-parameter i32 function, one block and one
i32 register, with `const_i32 r0, immediate` followed by `return_i32 r0`.
Definition/use, instruction and register types, terminator, counts and all
references are verified before execution. Every instruction has an original
source UTF-16 half-open range, contained in the function range and source
length. Source path and content digest are separate from logical entity IDs.

TypeId is SHA-256 of UTF-8 `tsfg.type\0i32`; signature hash is SHA-256 of
`tsfg.signature\0()->i32`. FunctionId is SHA-256 of UTF-8
`tsfg.function\0<sourcePath>\0<functionName>\0<signatureHashHex>` (lowercase 64
hex digits, without `sha256:`). This keeps FunctionId stable when the function
body or source offsets change. Snapshot-local IDs are never emitted as these
identities. Input identity binds the complete checked frontend input, while
source hash binds the original source text.

Only the schema target/triple/DataLayout is currently supported. The C++
producer asks LLVM DataLayout for i32 allocation size and ABI alignment; the
Zig loader compares that result with its target i32 layout. Core IR remains
typed SSA owned by MLIR; this format is neither Core IR nor MLIR bytecode.

`runtime/root.zig` exposes load/unload and `eval_bytecode`. A loaded module owns
predecoded data behind an opaque VerifiedModule handle. Callers cannot mutate
the original input after verification to change execution. Evaluation accepts
that module, a logical FunctionId, a typed argument frame and a capability
table; both tables must currently be empty. No source, frontend, MLIR or LLVM
is present in the Runtime. The result is typed i32 or a structured request
failure with stable machine code, FunctionId and original source anchor.

Physical instruction, frame-memory and depth limits are request-local resource
limits, distinct from later Semantic Fuel. Runtime frees its frame on every
exit, runs no user cleanup callback, retains no request pointers in results,
and permits another request after failure. This slice has no language trap,
user finally, managed roots, borrow or side-effect operation; their later
contracts remain unchanged and are not claimed as verified here.

Load failures are `r04-*` with byte offset; untrusted metadata is not presented
as a source anchor. Request errors are `r05-request-function`,
`r05-request-arguments`, `r05-request-capability`, `r05-request-memory`,
`r05-request-depth`, `r05-execution-abort` and `r05-request-allocation`.
Unsupported source forms are `r03-d-capability` / `r01-ts-baseline`, distinct
from official frontend diagnostics or invalid owned facts (`r03-d-snapshot`).

Canonical serialization is the unique schema wire order. A load/serialize
round-trip preserves all bytes; a normalized textual view contains the same
logical identities, typed instructions and source anchors. Corruption,
truncation, wrong schema/version/target/layout, unknown instructions, wrong
instruction/register types, invalid identities and ranges fail closed.
