# tsfg

## R00 Hermetic Build Entry and Linux debug smoke

`prefetch` is the only operation that may use the network. It downloads the
target's complete content-locked tool closure from
`eng/toolchains.lock.json`, verifies both archive and unpacked-tree identities,
binds the authoritative `pnpm-lock.yaml` digest into the target projection, and
atomically activates the completed cache.

On Windows:

```text
eng\tsfg-build.cmd prefetch --report out\prefetch-report.json
eng\tsfg-build.cmd verify-workspace ^
  --workspace <repo-workspace> ^
  --manifest-url https://github.com/xuelongling/manifests.git ^
  --manifest-revision <complete-manifest-commit-oid> ^
  --manifest bootstrap/r00.xml ^
  --report out\workspace-report.json
```

On Linux:

```text
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
```

After prefetch, both launchers execute the cached Node binary by absolute path;
the launcher verifies its pinned executable digest before first execution, and
the control plane then re-verifies the complete closure. They never fall back
to a `node` or `pnpm` found on `PATH`. Set
`TSFG_CACHE_DIR` before both operations to use a cache outside the repository.
`verify-workspace` is offline and read-only apart from its Build Report. It
checks the manifest repository identity and selected manifest, the exact
project set/paths/HEADs/remotes/clean state, and every manifest-managed Agent
Activation Surface link and pinned content identity.

The Linux debug closure contains the pinned archive extractor, CMake, Ninja,
LLVM/Clang/LLD, Debian sysroot, and Zig in addition to the Node.js control
plane. `build` invokes those tools only by verified closure paths under a
sanitized environment. It builds a private C++ smoke with assertions, `-O0`,
and debug information, plus an independent Zig Debug smoke. `test` executes
both artifacts and checks their fixed observable output. Neither smoke exposes
a product API or establishes a C/Zig ABI.

Build Reports are versioned canonical JSON, written through a same-directory
temporary file and atomic rename. Human diagnostics go only to stderr. This
slice uses exit 2 for usage/configuration, 10 for workspace mismatch, and 11
for lock/cache integrity failure, 20 for build failure, and 21 for test
failure. It emits no telemetry.
