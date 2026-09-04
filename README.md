<!-- SPDX-License-Identifier: MIT -->

# tsfg

## R00 Hermetic Build Entry and Tier 1 smoke profiles

`prefetch` is the only operation that may use the network. It downloads the
target's complete content-locked tool closure from
`eng/toolchains.lock.json`, verifies both archive and unpacked-tree identities,
binds the authoritative `pnpm-lock.yaml` digest into the target projection, and
atomically activates the completed cache.

On Windows:

```text
set TSFG_BOOTSTRAP_NODE=C:\absolute\path\to\reviewed-bootstrap-node.exe
set TSFG_BOOTSTRAP_NODE_SHA256=<full-lowercase-sha256>
set TSFG_BOOTSTRAP_GIT=C:\absolute\path\to\reviewed-git.exe
set TSFG_BOOTSTRAP_GIT_SHA256=<full-lowercase-sha256>
eng\tsfg-build.cmd prefetch --report out\prefetch-report.json
eng\tsfg-build.cmd verify-workspace ^
  --workspace <repo-workspace> ^
  --manifest-url https://github.com/xuelongling/manifests.git ^
  --manifest-revision <complete-manifest-commit-oid> ^
  --manifest bootstrap/r00.xml ^
  --report out\workspace-report.json
eng\tsfg-build.cmd build ^
  --target windows-x86_64-msvc ^
  --profile release ^
  --workspace . ^
  --out out\windows-release ^
  --report out\windows-release-build-report.json
```

On Linux:

```text
export TSFG_BOOTSTRAP_NODE=/absolute/path/to/reviewed-bootstrap-node
export TSFG_BOOTSTRAP_NODE_SHA256=<full-lowercase-sha256>
eng/tsfg-build prefetch --report out/prefetch-report.json
eng/tsfg-build verify-workspace \
  --workspace <repo-workspace> \
  --manifest-url https://github.com/xuelongling/manifests.git \
  --manifest-revision <complete-manifest-commit-oid> \
  --manifest bootstrap/r00.xml \
  --report out/workspace-report.json
eng/tsfg-build build \
  --target linux-x86_64-gnu \
  --profile debug \
  --out out/linux-debug \
  --report out/build-report.json
eng/tsfg-build test \
  --target linux-x86_64-gnu \
  --profile debug \
  --out out/linux-debug \
  --report out/test-report.json
eng/tsfg-build test \
  --target linux-x86_64-gnu \
  --compatibility-baseline /absolute/path/to/baseline-artifact.json \
  --compatibility-candidate /absolute/path/to/candidate-artifact.json \
  --report out/compatibility-report.json
eng/tsfg-build package \
  --target linux-x86_64-gnu \
  --profile debug \
  --input out/linux-debug \
  --out out/linux-package \
  --report out/package-report.json
eng/tsfg-build repro-check \
  --target linux-x86_64-gnu \
  --profile debug \
  --producer-a /absolute/path/to/producer-a-package \
  --producer-b /different/absolute/path/to/producer-b-package \
  --workspace /absolute/path/to/clean-comparator-checkout \
  --report out/repro-report.json
```

Both Tier 1 targets accept `--profile debug` and `--profile release` on
`build`, `test`, and `package`. Debug maps to C/C++ `-O0` (or `/Od`) and Zig
Debug; release maps to C/C++ `-O2` (or `/O2`) and Zig ReleaseSafe. Both retain
assertions, safety checks, and full debug information. Packages contain
detached `.debug` or PDB symbols. The Build Report, build metadata, and package
Artifact Manifest carry the same canonical build-policy evidence.

Every normative payload is compiled for `x86-64-v2` with generic tuning. LTO,
PGO, fast-math, native tuning, and static higher-SIMD injection are rejected
from ambient build flags and declared smoke build descriptions. The optional
payload setting `--simd-dispatch runtime-detected|baseline-only` is part of
Build Identity and defaults to `runtime-detected`. In that mode the C++ smoke
can select its isolated AVX2 implementation only after CPUID and OS state
checks. `test --cpu-fixture x86-64-v2` forces and verifies the safe baseline
fallback without changing Build Identity.

The compatibility form of `test` accepts two canonical, test-only synthetic
artifacts and executes baseline/baseline, candidate/baseline,
baseline/candidate, and candidate/candidate producer/consumer combinations.
Only serialized payloads cross the seam. The report binds both artifact
digests and product commit OIDs, derives the product Contract Set from the
empty registry, and records every combination and version gate. Synthetic
families remain outside `contracts/registry.json`, the Build Input Set, and
release packages. Product SemVer and synthetic Contract SemVer are reported
separately and never substitute for one another.

The bootstrap Node is an explicit acquisition prerequisite: its absolute path
and complete SHA-256 must be supplied for `prefetch`. Windows offline commands
also require an absolute Bootstrap Git path and complete SHA-256. The launchers
never select either bootstrap executable from `PATH`.

After prefetch, both launchers execute the cached Node binary by absolute path;
the launcher verifies its pinned executable digest before first execution, and
the control plane then re-verifies the complete closure. They never fall back
to a `node` or `pnpm` found on `PATH`. Set
`TSFG_CACHE_DIR` before both operations to use a cache outside the repository.
`verify-workspace` is offline and read-only apart from its Build Report. It
checks the manifest repository identity and selected manifest, the exact
project set/paths/HEADs/remotes/clean state, and every manifest-managed Agent
Activation Surface link and pinned content identity.

The Linux closure contains the pinned archive extractor, CMake, Ninja,
LLVM/Clang/LLD, Debian sysroot, and Zig in addition to the Node.js control
plane. `build` invokes those tools only by verified closure paths under a
sanitized environment. It builds private C++ and Zig smoke programs according
to the selected safe profile. `test` executes both artifacts and checks their
fixed observable output. `package` validates
the build's identity and payload digests, splits debug symbols with the locked
LLVM tools, and emits a deterministic `tar.zst`, an Artifact Manifest, and an
external checksums file. It also emits `producer-attestation.json` as an
external sidecar. The attestation records the producer's absolute workspace,
fresh private compilation-state root, build execution identity, and complete
Toolchain Closure object verification; none of those host-specific fields
enter the archive or checksums.

`repro-check` is the build-free third comparator. It requires two package
directories from different absolute workspaces and build executions, verifies
that neither producer shared or warmed incremental state, independently
recomputes Build Input Set, Build Identity, Contract Set, member, Artifact
Manifest, archive, and external checksum digests, and then compares their
canonical Reproducibility Sets byte for byte. Signatures, trusted timestamps,
Build Reports, logs, and external attestations are classified sidecars and are
excluded; unclassified bundle files fail closed. A difference returns exit 23
and reports the first payload member and byte offset that can localize it.
Neither smoke exposes a product API or establishes a C/Zig ABI.

Linux result-producing commands require a loopback-only network namespace and
refuse to start while any non-loopback route remains. The build creates a
static sandbox runner with the locked Zig compiler. The runner creates fresh
user, mount, and network namespaces for build, test, and package subprocesses,
then pivots into a tmpfs root exposing only the materialized Build Input Set,
the verified Toolchain Closure, and explicit working/output roots. Its ptrace
supervisor audits path syscalls, fails even ignored undeclared reads or writes
to read-only roots, and owns statuses 123, 124, and 125 for network boundary,
undeclared-input, and setup failures. Colliding child statuses are remapped, so
stable report categories never depend on tool cooperation or human stderr.

Build Reports are versioned canonical JSON, written through a same-directory
temporary file and atomic rename. Human diagnostics go only to stderr. This
slice uses exit 2 for usage/configuration, 10 for workspace mismatch, and 11
for lock/cache integrity failure, 12 for offline or sandbox input-boundary
failure, 20 for build failure, 21 for test/compatibility failure, and 22 for
package failure.
It uses 23 for a reproducibility mismatch. It emits no telemetry.
