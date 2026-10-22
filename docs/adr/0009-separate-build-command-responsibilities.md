# 0009: Separate build command responsibilities

R03 M14/M37 and M25 need ordinary Core verification and wire production to have
an honest consumption closure distinct from Native target lowering. The existing
control entry also contained more than 8,000 lines of acquisition, workspace
policy, process isolation, artifact identity, packaging and CLI logic. Adding a
new command selector to that file would preserve an unmaintainable dependency
hub and violate the workspace's 500-line rule.

The CLI now coordinates report-destination safety, runtime admission, Windows
delegation and command dispatch. Command handlers own their complete option,
result and failure classification. Static named imports connect them to the
existing implementations, now grouped by actual responsibility:

| Responsibility | Modules |
| --- | --- |
| Data, typed failures, reports and atomic publication | `build-data`, `build-errors`, `build-report`, `build-publication` |
| Options, build policy and producer identity | `build-options`, `build-policy`, `build-identity` |
| Tool selection, acquisition and archive formats | `build-toolchain`, `build-tool-closure`, `build-archive-readers`, `build-archive-extract`, `build-archive-writers` |
| Git, source policy, dependency provenance and workspace | `build-git`, `build-source-policy`, `build-dependency-policy`, `build-agent-policy`, `build-workspace-policy`, `build-workspace`, `build-product` |
| Process transport, isolation and binary normalization | `build-process`, `build-linux-sandbox`, `build-windows-sandbox`, `build-offline-boundary`, `build-normalization` |
| Native builds, runtime execution, checks and packaging | `build-linux`, `build-windows`, `build-runtime-execution`, `build-smoke`, `build-package` |
| Reproducibility and Source preparation | `build-repro-producer`, `build-repro`, `build-source-control`, `build-go-execution` |
| CLI command transactions | `build-command`, `build-delivery-commands` |

Each module retains the existing implementation and explicit dependencies. There
is no alternate language, duplicate build path, broad host-function bag, runtime
source loading, or compatibility shim. The original public preparation entry
points remain on the control entry. Repository-root resolution stays relative
to the same `eng` directory. Build input declaration retains its old members and
adds each new source member; SDKv2 membership and identity algorithms are intact.

Relocation also requires checking address semantics, beyond retaining function
text: the Windows supervisor must invoke the real `tsfg-build.mjs` dispatcher,
not the module implementing its transport. That fixed entry and command order
are tested through the actual pure argv Interface without running the supervisor.
Product-root and Go-worker relative URLs retain their original `eng` directory.

The refactor preserves original command ordering, exit classification, rollback,
publication checks, sandbox policy and identity validation. A module-size and
dependency-cycle check guards the new seams. Data-only tests exercise production
options, archive encoders/readers, canonical identity and explicit tool roles.
The two existing smoke callers share the runtime execution module. Tests can
replace that narrow module while retaining complete production case construction,
metadata checks, identity checks, exclusive file writes and cleanup.
Restricted factory, Native and SDK executions remain unrun; moving code grants
no execution or provenance qualification. The ordinary SDK consumption gap and
its concrete removal condition are recorded in `core-command-modules.md`.
