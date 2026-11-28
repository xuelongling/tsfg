<!-- SPDX-License-Identifier: MIT -->

# `tsfg.package` (`.tpkg`) Precompiled Package Contract

`tsfg.package` defines the canonical, content-addressed local precompiled package envelope
produced by `tsfgc build` (`tooling/r12-project-and-pkg.mjs:sealLocalPackage`) and consumed
detached from original `.ts` sources by `loadLocalPackage`.

## Invariants

1. Canonical JCS JSON envelope (`family = "tsfg.package"`, `version = 1`) sealed with `digest = sha256(payload)`.
2. Inner payload binds `name`, `version`, `target` (`windows-x86_64-msvc`), `contractSetId`, `abiHash`,
   base64-encoded `.tsfgabi`, `.tmeta`, and `TSFGR05B` `.tbc` bytecode, plus generated Zig ABI bindings
   and TypeScript `.d.ts` declarations.
3. Consumers MUST verify envelope digest, target match, `contractSetId` / `abiHash` compatibility,
   and inner `.tsfgabi` / `.tmeta` / `TSFGR05B` structural validity before admitting any symbol.
