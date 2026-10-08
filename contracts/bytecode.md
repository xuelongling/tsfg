<!-- SPDX-License-Identifier: MIT -->

# tsfg.bytecode 0.10.0

Bare local initialization uses a zero payload and private counted i32 state
without changing public parameter masks. Nullish assignment tests the state
before RHS effects and merges both slots. Verified ordinary payload use requires
definite initialization and presence; every caller/callee/state/phi/transfer
slot is charged to the unchanged 16384-byte default request budget.

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
never cause a host file read. Empty/dot/parent components, backslashes and drive
colons reject. Entity identity domains remain unchanged: SHA256 of
`tsfg.type\0<scalar>`, `tsfg.signature\0(<comma-separated scalar parameters>)-><scalar>` and
`tsfg.function\0<sourcePath>\0<name>\0<signatureHashHex>`.

Capability52 admits 1..128 nominal integer/bool/f32/f64 functions, each with 0..64 logical parameters and at most128 physical payload/state parameters,
up to256 reachable blocks,4096 SSA registers and8192 instructions. Global
payload fields are target/triple/layout strings, i32 size/alignment u16, pointer bits/alignment u16,
capability u32, input/source hashes, logical source path, source length u32 and
function count u16. Each function has FunctionId/signature/return-type hashes,
name string, source start/end u32, return type u8, parameter count u8 and
physical parameter types u8, logical parameter count u8 and one presence mask
u8 per logical parameter, followed by register/block/instruction counts u16 and its
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
Core and the independent loader reject directly constant illegal state values,
disallowed absent members and directly nonzero absent payloads. This bounded
constant check does not claim abstract evaluation of arbitrary scalar SSA.
Computed states and payloads are validated at every real callee entrance,
before its defaults, effects or entry fuel; violations use `r05-presence-state`
at the caller's call anchor. Loader constant violations use `r04-presence-state`
with a byte offset. Legal absent payloads are always initialized to zero.
Type codes1/2 retain i32/bool. Codes3..11 are i8/i16/i64/u8/u16/u32/u64/isize/usize.
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
`eval_bytecode` takes a verified module, FunctionId, typed scalar argument and
capability tables and explicit request limits. Its public host accepts
`{type:"<concrete integer>",value:"<canonical in-range decimal>"}` and
`{type:"bool",value:true|false}` argument records; optional `signatureHash`
must match the selected function. Unsupported capabilities reject at preflight.
M10 also accepts logical `{type:"undefined",value:null}` and
`{type:"null",value:null}` records when the parameter permits that state.
Omission requires an optional/default parameter. Masks use bit0 undefined,
bit1 null, bit2 optional and bit3 default; optional requires undefined, and
default requires both optional and undefined. Nonzero masks append `@` plus
two lowercase hexadecimal digits to the logical signature's scalar name.
Every logical slot consumes its scalar payload and, when mask&3 is nonzero,
an i32 state. All consumers reconstruct and verify each physical position.
State0 is present, state1 undefined and state2 null; absent payload bits are
canonical zero and invalid states or payloads reject at the actual VM call
boundary. Defaults run only for state1, in callee parameter order after all
caller operands. The64 logical capacity and16384-byte default memory budget
remain; physical registers, states, phi transfers and every caller/callee
frame contribute to actual allocation accounting. Previous and mixed exchange
identities reject before execution.
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

M07 expands this exact-match development contract to the complete nominal integer family. See docs/r03-integer-vm.md and the registered schema for type codes, pointer DataLayout and wire9/capability20. Previous0.5 artifacts and mixed schema identities are rejected; no compatibility window is promised. Existing i32/bool identities, source anchors, complete verifier and logical/physical budget ordering remain in force.

M09 registers `minimal-conversions-v5` with 286 monomorphic ordinary TS function declarations: `checked_<target>_from_<source>`, `wrap_<target>_from_<source>` and `reinterpret_<target>_from_<source>`. The current numeric slice contains 144 checked, 100 integer wrap and 42 equal-width reinterpret entries. Bool remains available elsewhere; this numeric slice does not decide future bool conversion semantics. `as` continues to be excluded from numeric conversion.

Only the officially checked symbol with the exact admitted declaration bytes, range, signature and unique nominal brand symbols produces a conversion fact. Same-spelling valid user or shadow declarations use normal calls and execute their bodies. Owned origin facts carry declaration digest/path/range, entry ID, version and role-specific brand identifier ranges. Snapshot binds the complete VFS/config/library scope; HIR retains that independently owned `inputScope`, whose canonical SHA256 equals `inputIdentity`, and validates each origin against its admitted declaration. Backend operations retain no upstream AST or checker objects.

Core0.9/wire9/capability20 register op34 `convert_checked`, op35 `convert_wrap` and op36 `reinterpret`, preserving op29–31 reservations and op32–33 floats. Each 16-byte record contains opcode:u8, exact result nominal type:u8, result register:u16, operand register:u16, exact source nominal type:u8, reserved-zero:u8, UTF16 source start/end:u32. Producer and independent loader check the legal source/result pair, reserved bits, dominance/register use and original source range. Numeric reinterpret requires equal width; wrap requires two integer types. Old/mixed identities reject immediately.

Checked integer conversion compares exact mathematical range. Integer→float and float narrowing round directly to the target with nearest ties-even; finite input rounding to infinity traps. Float→integer first rejects NaN/infinity, then truncates toward zero before exact range checking, so negative fractions truncating to zero are valid unsigned inputs. Float→float preserves signed infinity and canonicalizes every NaN to target quiet NaN (`7fc00000` or `7ff8000000000000`), including checked same-width conversion. Integer wrap is modulo target width with signed target interpretation. Reinterpret transports every raw bit, including signaling NaN, sign, payload and signed zero.

Each conversion evaluates its one operand exactly once at the caller and is one scalar operation, without a conversion callee/frame/depth check or entry Fuel. Ordinary enclosing calls retain their existing depth/Fuel and left-to-right argument rules. Checked failures are `r01-t-conversion-nonfinite` or `r01-t-conversion-range`, Rule `r01-conversions`, anchored to the original conversion expression and executing FunctionId. Unused checked conversions retain traps; the first reached failure ends the request and the host releases it.
