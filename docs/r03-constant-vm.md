<!-- SPDX-License-Identifier: MIT -->

# Constant-return compiler and Runtime

The first executable slice accepts one checked, zero-parameter function that
returns an i32 literal. The official Go frontend checks source, the compiler
owns a separate HIR, the C++ MLIR consumer verifies typed SSA and writes R04
bytecode, and the Zig Runtime loads that bytecode and executes typed register
instructions. The independently built executables carry Build Input identities.

Configure the existing locked Windows development tools and all writable
profiles/caches on E: as described in [Windows development](windows-development.md).
Build each formal component into a new independent E: output directory:

```text
node eng/tsfg-build.mjs build --dev --source-target mlir-core --target windows-x86_64-msvc --profile debug --out E:\task\core --report E:\task\core-report.json
node eng/tsfg-build.mjs build --dev --source-target tsfg-vm --target windows-x86_64-msvc --profile debug --out E:\task\vm --report E:\task\vm-report.json
```

These are local development builds. Their reports retain the existing
`publishable: false` state; they do not constitute certified release builds.

The CLI consumes the existing owned frontend input JSON with files, sourceRoot,
rootFile, the exact minimal-scalars-v2 declarations and strict checker config.
`sourceInput` in `compiler/pipeline.mjs` constructs that input for callers.
For example, `export function answer(): i32 { return 42; }` returns the typed
result `{ "type": "i32", "value": "42" }`.

```text
node tooling/tsfgc.mjs --input E:\task\input.json --frontend E:\task\tsfg-frontend.exe --emit hir
node tooling/tsfgc.mjs --input E:\task\input.json --frontend E:\task\tsfg-frontend.exe --core E:\task\core\tsfg-core-ir.exe --emit core
node tooling/tsfgc.mjs --input E:\task\input.json --frontend E:\task\tsfg-frontend.exe --core E:\task\core\tsfg-core-ir.exe --vm E:\task\vm\tsfg-vm.exe --emit run --requests "[{},{}]"
```

`--emit bytecode` writes binary R04 to stdout. The standalone `tsfg-vm.exe`
reads it from stdin and accepts `--inspect`, `--roundtrip`, or `--requests` with
a JSON array. Requests share one host; structured failure leaves the host
available for subsequent requests. The current argument and capability tables
must be empty. Instruction, memory and depth limits are physical request limits.

Official checker errors and unsupported checked capabilities use compiler exit
3 with structured diagnostics. Missing or inconsistent native compiler inputs
use exit 11. Invalid CLI options use exit 2. A VM load rejection uses exit 3
and an `r04-*` diagnostic on stderr; request outcomes are returned as JSON.
HIR and bytecode versions, stable logical identities, source anchors and machine
codes are specified in [HIR](../contracts/hir.md) and
[R04](../contracts/bytecode.md).

Applicable Node tests are discovered under `tests/r00`, `tests/r01`,
`tests/r02b` and `tests/r03`. Native checks require the actual locked frontend,
Core and VM executable paths (`TSFG_FRONTEND_EXE`, `TSFG_CORE_IR_EXE`,
`TSFG_VM_EXE`), two independent build directories for each native component
(`TSFG_MLIR_BUILD_A/B`, `TSFG_VM_BUILD_A/B`), the verified `TSFG_ZIG_EXE`,
and an owned E: `TSFG_MLIR_TEST_TEMP_ROOT`. Missing required native inputs fail
the R03 checks. Runtime tests cover malformed packets, typed results, allocation
cleanup and repeated requests; source tests cover canonical roundtrips, signed
boundaries, source metamorphisms and full/incremental output equivalence.
