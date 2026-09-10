<!-- SPDX-License-Identifier: MIT -->

# Go dependency prefetch preparation

Status: partial ticket 03 implementation. Native offline execution remains blocked.
The opt-in `eng/go-toolchains.lock.json` and adjacent `go-dependencies.lock.json`
prepare Go 1.26.8 Windows amd64 and the fixed parser/checker module candidates.
The separate lock is a temporary preparation input: it preserves the existing R00
default while the new target lacks execution acceptance. Its complete tool entries
are independently content-locked; changes to the default do not update it implicitly.

The existing `tsfg-build prefetch --lock <file> --cache <directory> --platform <target>
--report <file>` can prepare declared Go module inputs alongside its tools. There is no
additional public command. A toolchain lock can contain:

```json
{"goDependencies":{"path":"go-dependencies.lock.json","sha256":"sha256:<full digest>"}}
```

The dependency file is adjacent to the toolchain lock. Its exact SHA-256 must also
appear in `dependencyLocks` as project `tsfg`, path `eng/go-dependencies.lock.json`,
so it participates in the existing Toolchain Closure projection.

The version-1 dependency file contains `schemaVersion: "1"`, a Go module `proxy` URL,
and a nonempty `modules` array. Each entry supplies `path`, an exact `version`,
the authoritative `sum` and `goModSum` in Go's `h1:` format. Obtain these sums from
the approved fixed source's `go.sum`; a downloaded file does not establish its own
trusted expected identity. This initial implementation accepts lowercase module
paths; unsupported spelling and unsafe paths fail rather than being rewritten.

Prefetch fetches only the declared `.mod` and `.zip` objects, validates their Go
content sums, and supplies minimal `.info` metadata containing the exact `Version`.
It invents no release timestamp or Git provenance. The report also records observed
archive and go.mod SHA-256 values. Module license/source metadata must be reviewed
before selecting a real consumer; a successful download is not source admission.
When a module declares `licenseEvidence`, prefetch checks its archive path and
SHA-256 against the actual archive bytes. Source-target declarations require
these records, an exact selected Go 1.26 patch, fixed source/OID/module hashes,
the Windows target and the parser/checker package pair.

The proxy is content-addressed by the dependency declaration's full SHA-256 under
`go-proxies/sha256/`. Prefetch stages it, validates it, and atomically renames it into
place. Reuse verifies all declared contents and the marker, rejects extra files,
directories and links, and does not repair a corrupt completed cache. Only prefetch
downloads inputs. No Go executable is invoked by this preparation code.

`build --source-target typescript-dependencies --target windows-x86_64-msvc
--profile debug --dev --out <E: output> --report <E: report>` performs preparation
using the explicitly selected Go runtime lock/cache. It verifies the module proxy
again without fetching, the sibling fork's root/HEAD/remote/clean state and
approved ancestry, and fixed `go.mod`/`go.sum` bytes. Unsupported source targets,
missing Go and ambient Go overrides fail. Safe `local`/`off` settings are accepted.
For this preparation, invoke the versioned `eng/tsfg-build.mjs` with a verified
Node executable and explicit `TSFG_RUNTIME_LOCK`, `TSFG_RUNTIME_CACHE`,
`TSFG_RUNTIME_PLATFORM` and `TSFG_GIT`. The existing native launchers still select
the R00 default closure; they do not admit this opt-in preparation lock.
Absent offline proxy objects return exit 12; existing corrupt objects return 11.

The target emits a **failure**, exit 12, with a structured `preparation` record
when inputs are ready but the restricted executor is unavailable. It never falls
through to R00 smoke or labels its preparation as a successful build. The record
contains the proposed real `go list -deps -json` arguments, tool/dependency/source
identities and explicit `execution.status=not-run`, `intakeComplete=false`.
It is neither a Build Identity nor a verified Repo Workspace receipt.

The planned dependency operation uses readonly modules, disabled VCS/PGO,
trimpath, explicit windows/amd64/v2, CGO disabled, isolated GOENV/GOWORK and local
GOTOOLCHAIN. Debug supplies `-gcflags=all=-N -l`. Dependency listing does not link;
release detached symbols and compiler optimization acceptance remain unverified,
and this preparation makes no claim that Go implements the full release profile.
The locked tool's `src/cmd/go/alldocs.go` is the parameter reference; see also
[Go toolchain selection](https://go.dev/doc/toolchain).

Current Windows helper limitations prevent promoting this plan to execution:
its outer network-only mode inherits caller identity, nested restricted helpers
conflict, and read grants are not an input allowlist. A scoped executor revision
needs explicit review of the existing isolation authority before deployment.
No flag enables a bypass. Do not run the mutable Node control plane elevated.

`tests/r00/go-closure.test.mjs` exercises the public entry with a synthetic module.
Its fixed sums were independently checked using Go 1.26.8. These fixtures prove
prefetch behavior; they do not prove actual TypeScript dependency resolution,
network isolation, AST/type consumption, generated-source maintainability or
Source Intake completion.
