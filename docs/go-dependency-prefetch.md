<!-- SPDX-License-Identifier: MIT -->

# Go dependency prefetch preparation

Status: partial ticket 03 implementation. The bounded native execution path is
implemented but its successful Windows isolation acceptance remains outstanding.
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

The target materializes a new directory under the caller's E: TEMP. It copies
fixed-commit Go source and explicit embedded resources (checking Git blob identity),
the verified tools and module proxy, and a private worker. It records every copied
file's SHA-256 and invokes the verified native helper once. Node and Go run within
that supervisor; the worker never recursively establishes another WFP boundary.
Staging, including the exact `launch.json` arguments/environment and native log,
is retained for diagnosis. The output and report must use absolute E: paths without
linked ancestors. Existing output is rejected. Only successful dependency results
are atomically published; execution does not modify the dependency/tool lock.

Setup failure returns exit 12 with the complete `preparation` record and native
exit status. A Go failure after the boundary probes returns exit 20 and records
its phase. Neither case falls through to R00 smoke. `intakeComplete=false` remains
explicit even after successful dependency resolution: this operation does not
prove AST/type consumption, generated-source maintenance or completed intake.
The operation is neither a Build Identity nor a verified Repo Workspace receipt.

The planned dependency operation uses readonly modules, disabled VCS/PGO,
trimpath, explicit windows/amd64/v2, CGO disabled, isolated GOENV/GOWORK and local
GOTOOLCHAIN. Debug supplies `-gcflags=all=-N -l`. Dependency listing does not link;
release detached symbols and compiler optimization acceptance remain unverified,
and this preparation makes no claim that Go implements the full release profile.
The locked tool's `src/cmd/go/alldocs.go` is the parameter reference; see also
[Go toolchain selection](https://go.dev/doc/toolchain).

The internal `--allowlisted-root` helper mode requires an owned E: staging root,
rejects path aliases/hardlinks and overlapping grants, and uses a fresh restricting
SID, disabled groups/privileges and low integrity. It grants that SID access to
declared inputs and a separate non-executable writable root, restricts inherited
handles, and waits for job descendants before normal WFP/ACL cleanup. The private
`--verify-restriction` operation observes the actual token and job; it explicitly
does not claim to attest WFP by itself. The worker also checks denied input writes,
undeclared reads, IPv4/IPv6 canaries, exact Go version and module resolution.

This does not create a service, account or general administrator broker. Do not
run the mutable Node controller elevated. A standard caller needs existing WFP
setup capability; without it the native attempt fails closed. A user-run native
acceptance operation must pin the generated helper/plan/input identities and use
only the recorded new E: staging root. Unique restricting SIDs can also block
Windows DLL/registry access: startup, write-DAC denial, subprocess network denial
and abnormal supervisor cleanup must be demonstrated before claiming acceptance.
No generic system SID is added to work around a failed startup.

`tests/r00/go-closure.test.mjs` exercises the public entry with a synthetic module.
Its fixed sums were independently checked using Go 1.26.8. These fixtures prove
prefetch behavior; they do not prove actual TypeScript dependency resolution,
network isolation, AST/type consumption, generated-source maintainability or
Source Intake completion.
