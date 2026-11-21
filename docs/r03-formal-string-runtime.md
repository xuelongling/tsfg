<!-- SPDX-License-Identifier: MIT -->

# Formal String Core and R04

The registered development exchange is Core 0.12 and R04 wire12 with
capability119. The managed String code14 was introduced in Core 0.10 and
wire10 alongside the existing scalar codes1–13. The
`tsfg.type`, `tsfg.signature` and `tsfg.function` identity algorithms remain
unchanged; String uses the name `string`. Ordinary scalar arithmetic and
equality operations do not accept String. The existing certified Counter
binding keeps its i32 signature and capability31.

`lowerFormalHir` revalidates the complete persisted String HIR and its exact
facts context, then builds every function through the shared SSA producer.
`compileOwnedHir` feeds that result through the existing admitted C++ compiler
and strict packet checks. Neither consumes private packet bytes or translates
private cold handles. Whole formal Core signatures, calls, globals, returns,
SSA definitions and typed CFG arguments use the existing complete verifier.

The six operations use UTF16 code-unit semantics: constant34, concat35,
length36 (usize), checked codeunit37 (u16), checked half-open slice38 and
lexicographic compare39 (i32 -1/0/1). The wire preserves the entire uint16
domain, including NUL and isolated surrogate units. UTF8 byte ordering or
byte slicing cannot replace these operations. Literal16384/package65536
code-unit budgets retain the accepted String input limits. Formal capacity
remains512 complete functions,64 parameters,4096 registers,256 blocks,
8192 instructions,8MiB Core text and1MiB packet; functions are never removed
to make an unsupported module pass.

The existing official String facts/HIR input currently supplies literal and
concat only. Length/codeunit/slice/compare are verified low-level Core
primitives. Their checked usize endpoints state an IR precondition; they do
not define ordinary TS `s[i]`, `charCodeAt` or `String.slice` behavior. Source
normalization for the applicable missing-value result, negative arguments,
numeric conversion and slice clamping still needs its official facts and
lowering connection. No new language bounds-trap policy or source API is
introduced here; these remaining paths keep parent M24 open.

The [registry](../contracts/registry.json) and [machine schema](../contracts/bytecode.schema.json)
define the exact accepted wire identity. The retained wire10 String packets
are historical goldens. The current CLI requires the registered wire12
format. The private reference candidate uses its own marker, profile and
verifier. `privateCoreExchangeFormat` records its version and schema identity.
The empty private reference profile accepts scalar codes1–13 and does not
publish R04 packets. Each route rejects Core carrying a mismatched marker or
schema.

## CLI String output

Runtime String values use managed owner/generation handles and typed roots
across frames, calls, CFG transfer, globals and results. The CLI writer holds
the source root and a bounded copy of the UTF-8 bytes until the synchronous
write returns. The byte view is valid only during that lease.

Set `stringOutput` on each request to `strict` or `lossy`. Omission selects
`strict`, which reports isolated UTF-16 surrogates as an error. Explicit
`lossy` replaces each isolated surrogate with U+FFFD.

A successful String outcome has `status: "returned"` and a `result` object
with `type: "string"`, the UTF-8 text in `value`, and the selected mode in
`encoding`. `byteLength` is a JSON integer counting the UTF-8 bytes after
conversion and before JSON escaping. For example, NUL counts as one byte and
U+FFFD counts as three bytes.

Failure to open the output lease has `status: "failed"` and keeps `functionId`,
`source`, `activeRequests`, `fuelRemaining`, and `fuelConsumed`.

| Cause | `code` | `category` | `ruleIds` |
| --- | --- | --- | --- |
| Invalid UTF-8 in strict mode | `r05-string-invalid-utf8` | `string-output` | `["r01-string"]` |
| Other lease failures, including allocation or output limits | `r05-execution-abort` | `execution-abort` | `[]` |

The `--module-requests` mode includes
[module status and Host counters](r03-module-aot.md#request-and-instance-lifetime).

Pure compiler/reader, byte gold, lifecycle components and ordinary compilation
are separate evidence from formal guest execution. Component or schema
success does not close M24/M27 or establish a new certified Runtime identity.
