<!-- SPDX-License-Identifier: MIT -->

# Go dependency prefetch preparation

Status: partial ticket 03 implementation. The default product toolchain is unchanged.
Native offline dependency resolution and its Build Profile acceptance are not implemented
or certified by this preparation support. `build --source-target` is rejected.

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

The proxy is content-addressed by the dependency declaration's full SHA-256 under
`go-proxies/sha256/`. Prefetch stages it, validates it, and atomically renames it into
place. Reuse verifies all declared contents and the marker, rejects extra files,
directories and links, and does not repair a corrupt completed cache. Only prefetch
downloads inputs. No Go executable is invoked by this preparation code.

`tests/r00/go-closure.test.mjs` exercises the public entry with a synthetic module.
Its fixed sums were independently checked using Go 1.26.8. These fixtures prove
prefetch behavior; they do not prove actual TypeScript dependency resolution,
network isolation, AST/type consumption, generated-source maintainability or
Source Intake completion.
