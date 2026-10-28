<!-- SPDX-License-Identifier: MIT -->

# Formal String Core and R04

The current development exchange is Core0.10/R04 wire10, capability51. It
retains scalar codes1–13 and adds the nominal managed String code14. The
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

The registry and machine schema own the exact wire identity. Old unmarked
formal Core0.9 and old/mixed wire/schema identities are rejected. Independent
private candidate contracts remain Core0.9 with their own marker, schema,
profile and verifier; `privateCoreExchangeFormat` records that current private
contract metadata. It is not a formal compatibility route. An empty reference
candidate keeps its marker and runs its explicit private profile verifier,
which accepts only scalar1–13 and cannot publish an R04 packet. Forged markers
or formal0.10 modules mixed with private metadata cannot bypass either gate.

Runtime String values use actual managed owner/generation Handles and typed
roots across frames, calls, CFG transfer, globals and results. The existing
CLI result writer is the synchronous byte consumer. Its strict UTF8 choice
fails explicitly for isolated surrogates; loss replacement requires an
explicit choice. Its bounded lease owns stable copied bytes and retains the
source through the synchronous write. This does not promise zero-copy String
export or permit retaining a view after its lease.

Pure compiler/reader, byte gold, lifecycle components and ordinary compilation
are separate evidence from formal guest execution. Component or schema
success does not close M24/M27 or establish a new certified Runtime identity.
