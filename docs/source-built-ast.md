<!-- SPDX-License-Identifier: MIT -->

# Source-built AST, type and diagnostic probes

Tickets R02a/04–05 use the existing Hermetic Build Entry to compile the fork's
`tsc/cmd/tsfg-ast` target and read its committed TypeScript positive input. The
probe lives inside the upstream Go module so its imports obey Go's `internal`
boundary. It calls the official Program/parser/checker, traverses actual nodes,
and emits small type and primary diagnostic observations. It does not implement a parser, full type projection,
FrontendSnapshot, HIR or game runtime.

Use the pinned Node and an absolute `TSFG_GIT`, with TEMP, TMP, TMPDIR, HOME,
USERPROFILE, APPDATA and LOCALAPPDATA pointing to private E: directories:

```text
node eng/tsfg-build.mjs prefetch --dev --lock eng/go-ast-toolchains.lock.json --cache E:/ast-cache --platform windows-x86_64-msvc --report E:/ast-prefetch.json
```

Then set `TSFG_RUNTIME_LOCK` to the absolute AST toolchain lock,
`TSFG_RUNTIME_CACHE` to that verified cache and `TSFG_RUNTIME_PLATFORM` to
`windows-x86_64-msvc`:

```text
node eng/tsfg-build.mjs build --dev --source-target typescript-ast --workspace E:/workspace/tcfg --intake-plan E:/workspace/tcfg/eng/intake-declarations/typescript-ast.json --target windows-x86_64-msvc --profile debug --out E:/fresh-ast-output --report E:/ast-build.json
```

Use `test` instead of `build` with the same options and a fresh output directory
to execute the same source reconstruction and required probe checks. The
`typescript-ast` target name remains the existing consumption seam.

The sibling TypeScript checkout must have the exact admitted fork OID and
canonical remote. Its working files must match that commit. The source
admission must match the control repository's committed authority. Explicit
file declarations remain distinct from source admission and automatic discovery.

The private execution stages resolve actual Go dependencies, reconcile their
source files and embedded data against the exact Intake Ledger, and only then
compile and execute the probe. The fixed `.ts` input is audited as build-only;
compiler code is compiler-payload. No game-runtime consumption is claimed.

`prefetch --dev` prepares ordinary development tools without provisioning the
Windows native isolation/publication helpers. Default prefetch retains its
existing behavior. Both development reports explicitly say
`isolation: "not-enforced"`; this is not an OS offline proof or a release mode.

The result keeps source, tool, consumption and output identities. The executable
and observation are separate artifacts; the ledger is audit evidence. Committed
generated source may compile, but `generation.status` stays `not-run` and
`intakeComplete` stays false. Complete JS isolation, generator
replay, two-workspace reproducibility and final intake remain later tickets.

The current explicit approval contains 260 TypeScript source/legal/probe inputs.
Go's actual dependency metadata is reconciled against it before compilation;
removing a required file from the approval fails even though that file remains
admitted in the fork's much larger source inventory. A separate 767-file
declaration records the selected Go SDK, compiler programs, standard library,
Node controller and external module inputs with their own locked identities and
licenses. They are not attributed to the TypeScript source repository.

Build Input Set entries use the existing canonical digest algorithm and regular
Git modes. The 02b ledger supplies payload-affecting source entries; the actual
controller files are also included. Complete project OIDs are retained as
provenance outside that digest. Tool bytes are bound by Toolchain Closure.
Legal material, the fixed probe input and declaration explanations remain audit
inputs when they do not affect the compiled payload. Their hashes and the AST
observation remain visible separately. The report also preserves the actual
dirty state, including documentation overlays; it does not assert release
cleanliness.

The high-level test is `node --test tests/r00/typescript-ast-cli.test.mjs`.
Set `TSFG_TEST_AST_ACCEPTANCE=1` and `TSFG_TEST_GO_CACHE` to run the actual
source build; omitted real-source prerequisites are explicitly skipped, never
reported as successful source intake.

`tests/r00/typescript-ast-governance.test.mjs` uses an isolated working copy of
the exact real fork and the same public build entry's intake-ledger target for
corruption checks. Its positive case validates the governance path only. AST
execution evidence comes from the AST target test and the workspace-local
ticket 04 acceptance runner, which additionally compares an audit-only change
and rejects an actually discovered parser input omitted from approval.

## Required typed probes

`eng/probes/typescript.json` holds the fixed inputs and independent expectations.
The runner in `eng/typescript-probes.mjs` requires all three cases; there is no
skip mode. Both build and test reconstruct and run the real fork target:

| Case | Input | Required observation |
| --- | --- | --- |
| positive | Reused fork `tsc/cmd/tsfg-ast/testdata/positive.ts` | Real AST and `answer: number`; no syntax, semantic, program or global errors |
| syntax-error | Product `eng/probes/syntax-error.ts` | Official 1109, `Expression expected.`, source range `[62, 63)` |
| type-error | Product `eng/probes/type-error.ts` | Official 2322, boolean is not assignable to number, range `[69, 70)`; `n: number` query |

The type-error input adapts the assignment-error intent of the existing MIT R01
`tests/r01/corpus/control/invalid-local.ts`, using ordinary `number` to avoid
implementing tsfg's special scalars. No third-party corpus was copied. Syntax
and type diagnostics are separate arrays with official code, category, English
message and primary source span. These small ASCII cases use upstream byte
offsets; this is not a complete diagnostic or Unicode position API.

Three exact upstream declaration files (`lib.es5.d.ts`, `lib.decorators.d.ts`,
`lib.decorators.legacy.d.ts`) are explicit build-only Intake Ledger inputs.
The Program uses a read-only filesystem rooted at the staged module, explicit
declarations, `NoLib`, `NoEmit`, strict checking and ESNext syntax. Types are
queried only after the actual Program SourceFiles exactly match the primary
input and those three declarations. Each probe records the sorted actual list;
an additional referenced source fails before any type query. Types are
converted to strings while the file's Checker is exclusively borrowed, and the
borrow is released before process termination. No Type object crosses Checkers
or escapes to a later consumer. Necessary compiler/printer/transformer package
files are recorded; full JS capability isolation remains ticket 06.

The product's fixed inputs, expectation file and MIT license are checked against
committed regular-file bytes and recorded in `probes.inputLedger`, separately
from the fork's ledger and toolchain input declaration. They are audited test
inputs, not executable payload inputs; controller code remains in Build Input
Set. `inputIdentity.probes`, per-case source hashes and `probeObservationSha256`
bind the semantic evidence. `probes.json` is published alongside `ast.json`.

Missing or invalid required input reports `not-run`; an executed expectation
mismatch reports `failed` (exit 21); only a complete match reports `passed`.
Failures publish no successful source-build directory. The opt-in high-level
tests exercise both build/test, missing probe source, an omitted required case,
an undeclared required upstream declaration and an extra referenced declaration.
Skipping opt-in tests is not
typed-source acceptance. These probes prove source intake usability, not full
tsfg Program Conformance Corpus acceptance or completed R02a intake.
