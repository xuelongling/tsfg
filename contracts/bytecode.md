<!-- SPDX-License-Identifier: MIT -->

# tsfg.bytecode 0.10.0

Core0.10 / wire10 adds nominal managed String type14 and capability51. The complete
String operation, root and output contract is described in [formal String](../docs/r03-formal-string-runtime.md)
and the exact machine schema. Compiler/reader and ordinary compilation evidence remain
separate from formal guest execution and Runtime certification.

The binding-origin rules introduced in0.9 remain unchanged: ordinary globals use
`tsfg.global`; generated default expression bindings use the exact
`tsfg.default-export-binding.v1` recipe in the schema. Flags0/1/2 retain their
meaning and3/unknown flags reject. Display names grant no generated authority.

This exact, same-repository development format is the formal R04 compiler to
Zig Runtime seam. It has no published or supported older external consumer.
Producer, loader and registry change atomically; old wire/schema/Core identities
invalidate caches and are rejected. The registry owns version and JCS schema
hash. The JSON schema owns wire field order and bounds.

All integers use little endian. The 80-byte header is magic `TSFGTBC0`, u32 wire
version 10, raw 32-byte schema SHA256, u32 total length and raw 32-byte SHA256 of
the payload. UTF8 strings have a u32 length, no terminator or padding. The
checksum supplies integrity, not publisher authenticity. Target/triple and LLVM
DataLayout are fixed in the schema. LLVM derives i32 and pointer size/alignment; Zig checks
its actual target. Logical source paths preserve the leading root slash and
never cause a host file read. Colons are ordinary logical characters, including
within a path component; they never designate a host drive. Invalid UTF8, NUL,
empty/dot/parent components and backslashes reject. The primary source must end
in .ts and cannot be a declaration .d.ts; module source tables retain declaration
paths for host declarations. Exact path bytes remain in IDs and source maps.
Entity identity domains remain unchanged: SHA256 of
`tsfg.type\0<nominal type>`, `tsfg.signature\0(<comma-separated nominal type parameters>)-><scalar>` and
`tsfg.function\0<sourcePath>\0<name>\0<signatureHashHex>`.

Capability51 admits 1..512 nominal integer/bool/f32/f64/String functions, each with 0..64 typed parameters,
up to256 reachable blocks,4096 SSA registers and8192 instructions. Existing function/per-function bounds and execution budgets remain unchanged. Existing u16 function counts and low-u16 call targets represent512
without a record-layout change. Global
payload fields are target/triple/layout strings, i32 size/alignment u16, pointer bits/alignment u16,
capability u32, input/source hashes, logical source path, source length u32,
moduleMode u8 and function count u16. moduleMode0 always has its explicit zero
byte before the function count; it has no module tables. moduleMode1 inserts
sources, modules, globals, hosts, roots and initialization tables, in that order,
between mode and function count. Table counts/records and bounds are in the
registered machine schema. Module-mode functions add sourceIndex u16,
initializer u8 and reserved-zero u8 before the ordinary function descriptor.
Each function has FunctionId/signature/return-type hashes,
name string, source start/end u32, return type u8, parameter count u8 and
parameter types u8, followed by register/block/instruction counts u16 and its
block table and instruction sequences. Each block
has parameterCount u16, each parameter's register u16/type u8/reserved zero u8,
then instructionCount u16. Registers are globally unique in block order: block
parameters followed by typed results. Block arguments are phi values.

Global load/store opcodes29/30 carry a type code1..14, register, global index
and source range. The store initialization flag distinguishes its unique
initializer from later assignment; table binding origin controls write permission.
Opcode31 is the explicitly authorized i32 host call. Module, global, root and
initializer associations are verified before requests execute.

Scalar and return records retain their 16-byte layout: opcode/type u8, register
u16, payload u32, original UTF16 start/end u32. Existing opcodes 1..23 and their
typed scalar rules remain unchanged. Branch opcode24 has type/register0 and a
low-u16 target with high-u16 reserved0. Conditional branch25 has type2, a bool
condition register, true/false targets in low/high u16. A branch appends argument
count u16 and argument registers u16; conditional branches append true then
false argument lists. Arity and types match destination block parameters. Fuel
opcode26 has type/register0 and event u32:1 entry or2 while-condition.
Call opcode27 uses the result type/register and low-u16 target function index
with high-u16 reserved0; it appends argument count u16 and ordered argument
registers u16. Call source ranges belong to the caller. Every target signature,
argument arity/type and return type is checked before any request executes.
Type codes1/2 retain i32/bool. Codes3..11 are i8/i16/i64/u8/u16/u32/u64/isize/usize.
Codes12/13 are f32/f64. Float constants use opcode32 followed by canonical raw
u64 bits (zero extended for f32); unary plus uses opcode33. Strict arithmetic,
NaN transport and raw-hex requests follow docs/r03-float-vm.md.
Constant opcode28 has the standard scalar record with a zero u32 payload,
followed by u64 canonical zero extended low-width bits. Signed values use
two's complement low-width bits. High bits outside the concrete width reject
with `r04-integer-range`. Shifts require a concrete integer left operand and
an i32 count. Other arithmetic operands share the same nominal integer type.

The loader verifies the complete identity/integrity/bounds, known opcodes,
reserved fields, typed definitions/uses, dominance, successor references and
phi types before execution. Every block ends exactly once in return/branch/
conditional branch; no unreachable blocks or entry predecessors are accepted.
Entry fuel is first and unique. Removing blocks with while events must leave an
acyclic CFG, preventing unmetered cycles. All instruction anchors are nonempty,
contained in the function and original source length; individual return ranges
do not constrain unrelated branches. Unknown/truncated/trailing inputs reject.

A verified module owns immutable bytes and predecoded instructions behind an
opaque handle. Edge arguments are read into temporary values before destination
phi registers are written, preserving parallel transfer even for loop swaps.
`eval_bytecode` takes a verified module, FunctionId, typed argument and
capability tables and explicit request limits. Its public host accepts
`{type:"<concrete integer>",value:"<canonical in-range decimal>"}` and
`{type:"bool",value:true|false}` argument records; optional `signatureHash`
must match the selected function. Unsupported capabilities reject at preflight.
Runtime contains no source
parser, JavaScript fallback, frontend, MLIR or LLVM. Canonical serialize returns
identical verified bytes; inspect prints typed CFG and original source anchors.

Request `semanticFuel` defaults to4097, independently of `instructionBudget`
(default4097). Function entry and each while condition attempt consume1,
including initial and final-false checks. Insufficient fuel traps before that
event with `r01-t-fuel`, category `trap`, Rule `r01-fuel` and the event's
source range. Outcome fields `fuelRemaining` and `fuelConsumed` are decimal
strings. Invalid request identity/arguments/capabilities reject before events.
Active depth defaults1; depth0 traps before entering a frame/event as
`r01-t-depth`, Rule `r01-depth`. At a fuel event, semantic failure takes
priority over coincident physical instruction exhaustion. After successful
logical debit, the physical bound applies. Frame memory (default16384 bytes),
physical instruction exhaustion and allocation failure are Execution Abort,
separate from semantic traps. A call checks active depth against the limit
before allocating its callee frame or attempting callee entry fuel. Both
failures use the callee FunctionId and declaration range. Argument expressions
evaluate left to right first and retain caller operation anchors. The VM uses
an explicit frame stack, one physical instruction balance per request and
active frame memory accounting. Returns free the callee before resuming the
caller; depth counts active frames rather than cumulative calls.

Integer arithmetic wraps, guarded division/remainder and shift traps keep their
R01 codes, Rules and operation anchors. The first actual trap ends the request;
unreached branches/short-circuit operands cannot fail early. Runtime frees its
frame, activeRequests returns0 and the same host accepts later requests. It
runs no user catch/finally or callbacks and promises no rollback. String roots and result ownership use the managed Handle lifecycle. Other managed
domains and user exceptions retain their separate capability obligations.

Load failures carry `r04-*` and byte offsets, never untrusted source attribution.
Request preflight errors keep `r05-request-function`, `r05-request-arguments`
and `r05-request-capability`; a signature mismatch is `r05-request-signature`.
Physical failure uses `r05-execution-abort`.
The `TSFGREQ1` transport remains u32 count plus length-delimited R04 packets,
1..128 matching requests and total1MiB/no trailing bytes, served by one Runtime.
It adds no language semantics.

The current formal development producer/reader requires Core0.10, wire10 and
capability51. FrontendSnapshot remains0.8; HIR retains its independent version.
Private marked profiles retain their own exact Core0.9 metadata and verifiers;
they are never accepted as formal packets. Old unmarked formal0.9, old wire9,
wrong schema hashes and mixed identities reject. Scalar identities, original
source anchors, complete verification and logical/physical ordering remain.

Historically, the0.8 global operation type-range registration corrected an omitted
description of already implemented f32/f64 support. At that earlier correction,
Contract SemVer0.8.0 and wire8 remained unchanged; its JCS schema hash and derived
Contract Set ID changed atomically across producer, loader and fixtures under
accepted ECP-0002. That historical correction did not establish formal Runtime
acceptance. The subsequent0.9 candidate used wire9; current0.10 uses wire10 with its own exact schema.

Historically, the0.9 producer/reader rejected wire8 and Core0.8; current0.10 also rejects wire9 and unmarked formal0.9. The generic owned-HIR candidate still proves its own package/instance linkage before emitting the same concrete Core0.10 scalar operations; Runtime receives no generic definitions or Source session. Source package/IO/HIR family adoption and Source executable admission remain separate.
