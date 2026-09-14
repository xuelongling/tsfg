<!-- SPDX-License-Identifier: MIT -->

# Source-built AST probe

Ticket R02a/04 uses the existing Hermetic Build Entry to compile the fork's
`tsc/cmd/tsfg-ast` target and read its committed TypeScript positive input. The
probe lives inside the upstream Go module so its imports obey Go's `internal`
boundary. It calls the official parser, traverses its actual nodes, and emits
only a small observation. It does not implement a parser, type projection,
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
`intakeComplete` stays false. Type queries, complete JS isolation, generator
replay, two-workspace reproducibility and final intake remain later tickets.

The high-level test is `node --test tests/r00/typescript-ast-cli.test.mjs`.
Set `TSFG_TEST_AST_ACCEPTANCE=1` and `TSFG_TEST_GO_CACHE` to run the actual
source build; omitted real-source prerequisites are explicitly skipped, never
reported as successful source intake.
