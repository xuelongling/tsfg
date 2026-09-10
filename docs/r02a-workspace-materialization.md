<!-- SPDX-License-Identifier: MIT -->

# TypeScript workspace materialization

The first real source candidate uses the `xuelongling/TypeScript` fork of
`microsoft/TypeScript`. The language baseline is TypeScript **7.0.2** and the
upstream base is `1e4744d68260a7cb91b62b12edc3f6a2187faaf1`. The fork's
`tsfg-r02a-intake` branch adds only `UPSTREAM.toml`; its initial provenance
commit is `2c3d2d793a208fd15e6e20fd5dfdd687ce2d7223`. Neither the engineering
TypeScript dependency nor a downloaded release binary supplies this source.

The Manifest Repository versions `candidates/tsfg-v0.2.0.xml` and its source
sidecar. Initialize using the full manifest commit, selected filename and
canonical URL, following that repository's verified repo 2.65 Bootstrap
instructions. Every project revision is a complete OID. The candidate filename
does not change Product Version and does not designate Stable Integration.

`eng/source-admissions.json` must exactly match the selected manifest's committed
sidecar. Version 2 extends the original admission mapping only to preserve exact
upstream ASCII paths and explicitly unmaterialized gitlinks. Regular files retain
their SHA-256 byte identities and text/binary classification. Original text may
retain its upstream line endings; non-UTF-8 content is identified as binary and
is not treated as decoded source text. This mapping is a workspace inventory,
not permission to compile or distribute every upstream file.

Version 2 permits mapped paths up to 4096 characters and components up to 255
characters. It still rejects non-ASCII, traversal, Windows forbidden characters
and reserved names, trailing dots/spaces, case collisions and repository links.
First-party rules and version 1 source rules are unchanged. A gitlink records its
full OID and must remain absent or an empty directory: no recursive submodule
fetch, source consumption or sub-source admission is implied. The fixed upstream
contains `tsc/_submodules/TypeScript` at
`4d4f005c8541e0255a9d8791205fdce326e462bc`; generation/test consumption of this
source is outside this materialization step.

Run the existing Hermetic Build Entry after real repo init/sync:

```powershell
node eng/tsfg-build.mjs verify-workspace --workspace $workspace `
  --manifest-url https://github.com/xuelongling/manifests.git `
  --manifest-revision $manifestOid --manifest candidates/tsfg-v0.2.0.xml `
  --report $workspaceReport
```

Use the verified launcher or its pinned Node/Git environment; direct Node
invocation requires an absolute `TSFG_GIT`. Consume this report with both
`product-pr-ci.mjs identity` and Manifest Repository
`manifest-ci.mjs gate --workspace-report`. Source policy success records
`intakeComplete: false`; generation, build, interface, JS isolation and
reproducibility stay `not-run`.

The real-source integration test accepts `TSFG_TYPESCRIPT_WORKSPACE`,
`TSFG_TYPESCRIPT_MANIFEST_REVISION` and `TSFG_TYPESCRIPT_EVIDENCE`. Supply an
isolated, genuinely materialized candidate and an evidence directory outside
its tree, then run `node --test tests/r00/typescript-workspace.integration.test.mjs`.
Without explicit real inputs it reports a conditional skip, never a source pass.
The ordinary source policy fixtures exercise tool behavior separately.

When using local object transport, record the actual seed repositories and
commits alongside canonical configured remotes. Local materialization proves
those objects were checked out and verified, not that their candidate commits
were published remotely. Preserve the user's development trees and immutable
bootstrap/snapshot/tag history. Final acceptance records belong in the local
ticket evidence, with actual manifest/product/fork commits and command results.
