<!-- SPDX-License-Identifier: MIT -->

# Control flow and logical budget corpus

Ticket 07 adds 51 original MIT case records and 13 TS source files, validated alongside the 58 numeric cases through `validateCorpus`. Source is opaque input; no parser, interpreter, effect simulator or backend budget enforcer is added. All cases remain `not-executed`, with zero real product passes.

Initialized locals, assignment, branch/loop control, return, forward resolution and direct/mutual recursion inherit TypeScript 7.0.2 as adopted by [language contract sections 2–3](../../../../docs/r01-language-contract.md). Each record traces its small program by hand. No upstream code is copied and no engineering TypeScript package or JS execution supplies the oracle. Exact i32/bool values, ordered runtime traps and budgets follow sections 4.2 and 6 and [ADR-0010](../../../../docs/adr/0010-backend-independent-semantic-budget.md).

| Source / cases | Independent observation |
| --- | --- |
| `locals.ts` | Initialized const 3 and let; true assigns 7, false assigns 1; explicit return. |
| `loop.ts` | Input 0 returns 0 after two logical charges; input 2 returns 2 after four. |
| `compare.ts` | (2,3), (3,3), (4,3) select -1, 0, 1 using same-type comparisons. |
| `calls.ts` | Forward calls return 24; direct(2) returns 2; even(2) mutually recurses and returns true. |
| `short-circuit.ts` | Both skipped RHS paths return bool; required trapping RHS paths trap; evaluated RHS cases return true/false. |
| `ordered.ts` | Operand division precedes remainder; first argument remainder precedes division and callee entry. Constant division remains a runtime trap. Untaken branch/loop traps never occur. |
| `entry.ts`, `fuel-call.ts` | Exact/zero entry fuel, callee entry after arguments, logical charges retained under inlining. |
| `argument-before-entry.ts` | Argument division fails before either an unavailable callee fuel charge or excess depth check. |
| Invalid local/name/argument/return sources | Compile diagnostics at original UTF-16 anchors, with no execution events. |

Each `oracle.basis.derivation` gives the worked event trace: entry names, active depths, charges and first failure. Five budgets and Windows strict target/mode are explicit in every case. E1/E2/etc. are human review labels for logical events, not physical instructions or an executed trace. Trap anchors cover the offending expression or function declaration name/signature; while fuel anchors cover `while (count < n)`. Recursive entries reuse the declaration anchor; the derivation identifies the failing invocation. These authored primary spans do not prove a real diagnostic/trap producer exists.

For loop(2), E1 enters main, E2 checks 0<2, E3 checks 1<2, E4 checks 2<2. Each pays one unit **before** the event. Fuel 4 returns 2; fuel 3 fails before E4, even though that condition would be false. Loop(0) needs fuel 2; fuel 1 fails before its first condition. Direct(2) needs three active frames: limit 3 permits return 2; limit 2 fails before frame 3. Its fuel is 4, avoiding simultaneous exhaustion. Sequential completed calls restore depth 1; total entries are not active depth. Inlining must retain logical charges even if it removes physical calls.

`r01-t-fuel` and `r01-t-depth` are stable expectation identities, separate from arithmetic traps and compile diagnostics. Directory obligations bind exact fuel/depth boundary coverage to explicit budget values.

## Failure and deferred responsibilities

Normal return, semantic trap and physical Execution Abort have separate responsibilities. Physical-instruction, memory and host-time Abort gaps retain pending consumers and closure conditions. R01 cannot derive a portable physical exhaustion point from these source files. Physical limits are explicit conditions, not a promise of sufficient resources on every backend. An observed Abort never matches a semantic return/trap. Given-result comparison belongs to ticket 08; this ticket fabricates neither Abort oracles nor its result adapter. Request survival, effects and exception interactions need real consumers and are unverified.

Same-event fuel/depth priority, default-parameter budget/frame ordering and trap/Abort versus catch/finally have pending records, with no guessed deterministic expected results. Ordinary optional/default parameters, uninitialized let, compound assignment, increment and later condition forms are not permanently prohibited by this initial corpus.

## Records and validation

The record format remains version 6. The directory advances to `tsfg-r01-v4` for refined obligations and allocated codes. Numeric records advance their spec reference only: numeric sources, corpus revision, values, identities and derivations remain intact. The control catalog appends `tsfg-r01-control-v1` and correction revision `tsfg-r01-control-v2` to the numeric history. The correction fixes the first-argument trap occurrence, names its entry `orderedArguments`, and rebases later source offsets without changing semantics. To compose the collection, load both case arrays and assign that new corpus revision to the detached numeric records; keep their stored numeric-only corpus IDs. Build reverse rule `caseIds` from declared associations, then load each distinct source ID. Pass shared directory rules/capabilities, control catalog, combined cases and sources to `validateCorpus`. The shared `loadFoundation()` in `tests/r01/foundation-fixture.mjs` contains the ingestion example; assertions use the public entry.

Run `node --test tests/r01/control-corpus.test.mjs` with locked Node. The tests check complete scoped control/call/bool/evaluation/fuel/depth obligation coverage and 38 valid boundary withdrawals, preserving tombstones and checking the exact rule/obligation/target/mode gap. Wrong/missing budgets, first-trap source text, compilation channels and input immutability are also checked. This proves authoring/validator behavior, never source execution. Full-directory initial coverage stays incomplete: unrelated input/baseline work, physical Abort and pending interactions remain visible. W3–W6 and full R01 are not declared complete.
