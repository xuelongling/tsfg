<!-- SPDX-License-Identifier: MIT -->

# tsfg.bytecode 0.5.0

This exact, same-repository development format is the formal R04 compiler to
Zig Runtime seam. It has no published or supported older external consumer.
Producer, loader and registry change atomically; old wire/schema/Core identities
invalidate caches and are rejected. The registry owns version and JCS schema
hash. The JSON schema owns wire field order and bounds.

All integers use little endian. The 80-byte header is magic `TSFGTBC0`, u32 wire
version 5, raw 32-byte schema SHA256, u32 total length and raw 32-byte SHA256 of
the payload. UTF8 strings have a u32 length, no terminator or padding. The
checksum supplies integrity, not publisher authenticity. Target/triple and LLVM
DataLayout are fixed in the schema. LLVM derives i32 size/alignment; Zig checks
its actual target. Logical source paths preserve the leading root slash and
never cause a host file read. Empty/dot/parent components, backslashes and drive
colons reject. Entity identity domains remain unchanged: SHA256 of
`tsfg.type\0<scalar>`, `tsfg.signature\0(<comma-separated scalar parameters>)-><scalar>` and
`tsfg.function\0<sourcePath>\0<name>\0<signatureHashHex>`.

Capability16 admits 1..128 i32/bool functions, each with 0..64 i32/bool parameters,
up to256 reachable blocks,4096 SSA registers and8192 instructions. Global
payload fields are target/triple/layout strings, i32 size/alignment u16,
capability u32, input/source hashes, logical source path, source length u32 and
function count u16. Each function has FunctionId/signature/return-type hashes,
name string, source start/end u32, return type u8, parameter count u8 and
parameter types u8, followed by register/block/instruction counts u16 and its
block table and instruction sequences. Each block
has parameterCount u16, each parameter's register u16/type u8/reserved zero u8,
then instructionCount u16. Registers are globally unique in block order: block
parameters followed by scalar results. Block arguments are phi values.

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
`eval_bytecode` takes a verified module, FunctionId, typed scalar argument and
capability tables and explicit request limits. Its public host accepts
`{type:"i32",value:"<canonical signed decimal>"}` and
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
runs no user catch/finally or callbacks and promises no rollback. Managed roots,
borrows, user exceptions and side effects remain later capability obligations.

Load failures carry `r04-*` and byte offsets, never untrusted source attribution.
Request preflight errors keep `r05-request-function`, `r05-request-arguments`
and `r05-request-capability`; a signature mismatch is `r05-request-signature`.
Physical failure uses `r05-execution-abort`.
The `TSFGREQ1` transport remains u32 count plus length-delimited R04 packets,
1..128 matching requests and total1MiB/no trailing bytes, served by one Runtime.
It adds no language semantics.
