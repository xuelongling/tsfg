# tsfg

## R00 Hermetic Build Entry

Ticket R00-05 exposes two engineering-control operations. `prefetch` is the
only operation in this slice that may use the network. It downloads Node.js
24.20.0 and pnpm 11.25.0 from the content-locked distributions in
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

Build Reports are versioned canonical JSON, written through a same-directory
temporary file and atomic rename. Human diagnostics go only to stderr. This
slice uses exit 2 for usage/configuration, 10 for workspace mismatch, and 11
for lock/cache integrity failure. It emits no telemetry.
