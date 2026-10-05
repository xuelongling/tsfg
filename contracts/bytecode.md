<!-- SPDX-License-Identifier: MIT -->

# tsfg.bytecode 0.2.0

This exact development format is the formal R04 compiler-to-Zig VM seam. No
published format or supported external consumer predates it. Producer and
consumer change atomically in this product repository. A different version or
schema hash is incompatible and invalidates cached bytecode. The registry is
the sole version/hash authority; the JSON schema describes the binary layout.

All integers are explicitly little endian; no host struct is dumped. The header
is 80 bytes: magic `TSFGTBC0`, u32 version 2 (SemVer 0.2.0), raw 32-byte schema
SHA-256, u32 total byte length, and raw 32-byte SHA-256 of the remaining payload.
UTF-8 strings have a u32 byte length and no terminator. Schema field order is
wire order. No padding, duplicate fields, reserved data, or trailing bytes are
accepted. Limits are checked before allocation. The checksum proves integrity,
not publisher authenticity or authorization.

Capability bit 2 admits one zero-parameter i32/bool function, one block and
1..4096 sequentially defined typed registers. Constants and scalar operations
are followed by a final matching typed return. There is one instruction per
definition, plus the return. Each instruction is exactly 16 bytes: opcode u8,
type u8 (1 i32, 2 bool), destination/return register u16, payload u32, start u32
and end u32. Binary payloads contain prior left/right u16 registers; unary
payloads contain a prior left u16 and a reserved zero u16. Constants contain
i32 bits or canonical bool 0/1. The return payload is zero.

Opcodes are constant i32 1, return 2, constant bool 3, add 4, subtract 5,
multiply 6, divide 7, remainder 8, left shift 9, arithmetic right shift 10,
logical right shift 11, bitwise and/or/xor 12..14, negate 15, complement 16,
boolean not 17, equality/inequality 18..19, and less/less-equal/greater/greater-equal
20..23. Arithmetic, shifts and bitwise operations require i32; comparisons
produce bool. Equality accepts two matching i32 or bool operands. Boolean not
requires bool. The JSON inspector uses `return_i32` or `return_bool` for opcode 2.
Definition/use, instruction and register types, terminator, counts and all
references are verified before execution. Every instruction has an original
source UTF-16 half-open range, contained in the function range and source
length. Source path and content digest are separate from logical entity IDs.
The path is a normalized logical UTF-8 source path; the official frontend's
leading logical-root slash is preserved. It never causes a host file read.
Empty/dot/parent components, backslashes and drive colons are rejected.

TypeId is SHA-256 of UTF-8 `tsfg.type\0<scalar>` for i32 or bool; signature hash
is SHA-256 of `tsfg.signature\0()-><scalar>`. FunctionId is SHA-256 of UTF-8
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
is present in the Runtime. The result is typed i32/bool or a structured request
failure with stable machine code, FunctionId and original source anchor.

Physical instruction, frame-memory and depth limits are request-local resource
limits, distinct from later Semantic Fuel. Runtime frees its frame on every
exit, runs no user cleanup callback, retains no request pointers in results,
and permits another request after failure. Add/subtract/multiply/negate wrap
at 32 bits. Division truncates toward zero; MIN/-1 returns MIN and its remainder
is zero. Runtime checks zero divisors before native division/remainder and
signed shift counts 0..31 before narrowing or shifting. Traps are
`r01-t-divide-zero`, `r01-t-remainder-zero` (Rule `r01-division`) and
`r01-t-shift-count` (Rule `r01-shifts`), with the failing operation's original
UTF-16 anchor. The first trap terminates its request and later instructions do
not execute. It does not kill the host, roll back effects or enter user cleanup.
This slice has no user finally, managed roots, borrow or side-effect operation; their later
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

The host CLI also accepts `--request-sequence` with `TSFGREQ1` transport frames:
u32 count followed by u32 byte lengths and complete R04 packets. There must be
1..128 matching JSON requests, a total input at most 1 MiB, and no trailing
bytes. One Runtime serves the sequence. This transport does not extend R04
instructions, add calls, or change request termination semantics.
