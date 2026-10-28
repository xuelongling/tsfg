<!-- SPDX-License-Identifier: MIT -->

# Query CPU LLVM candidate

The private Query compiler can lower the independently checked standard CPU
batch to the LLVM dialect and export real LLVM IR. It uses the official
SCF-to-ControlFlow, Arith/MemRef/Func/ControlFlow-to-LLVM conversions and
unrealized-cast reconciliation, followed by the LLVM dialect translation and
LLVM module verifier. It registers only the builtin-module structural and LLVM
dialect translations, with no all-dialect translator or target/engine registration.

The target triple and data layout come from the existing owned Core header:
`x86_64-pc-windows-msvc` with 64-bit pointers/indexes. No TargetMachine, native
backend, object writer, JIT or execution engine is involved.

## Production surfaces

`compileSystemQuery(bytes, context, {core, cpuLLVM: 'dialect' | 'ir'})` returns
the selected text in `cpuLLVM`. The current factory manifest and original
Query context checks remain the owning public entry boundary. The CLI exposes
`--emit query-llvm` and `--emit query-llvm-ir` with the original `--query-request`.

The static Core consumer accepts `--system-query --cpu-llvm` and `--llvm-ir`
from complete owned Query Core or checked standard batch. LLVM dialect output
also accepts the existing canonical/effects consumers. LLVM IR has a separate
`--system-query --canonicalize-llvm-ir` cold reader using the official LLVM
assembly parser and verifier.

## Source and ABI binding

LLVM dialect version 1 stores the complete checked standard batch in
`tsfg.cpu_llvm_source`. The batch already retains original whole Source,
request/identity, component layouts, effects and tuple permissions. Custom
Source attributes are removed only from the conversion work copy; the exact
original remains in this proof envelope. LLVM IR carries that same batch and
version in `!tsfg.query.cpu` named metadata.

Neither representation trusts the snapshot as a claim of correctness. Cold
consumption independently verifies the complete Source/batch, reruns the
official conversions/export, verifies the actual low-level module, and compares
canonical operations, SSA/arguments, addresses, layout, calls and metadata.
Only LLVM's parser buffer ModuleID comment is normalized. Target layout,
`source_filename`, instructions and proof content remain checked.

The original byte-column memref descriptors, row/stride/field-offset arithmetic,
same-buffer aliases and helper view arguments use official memref/function ABI
conversion. These are descriptors with allocated/aligned pointers, offsets,
sizes and strides; the output is not a newly authorized bare-pointer entry.
The compiler adds no fast-math, contraction, reassociation or no-alias grants.
The original ordered f32 operations and helper calls remain part of the cold
Source binding. Text input/output retains the existing 8 MiB bound.

Object emission and machine/numeric execution are separate dependencies.
Actual `.tmeta`, FunctionCell/loader, Store batch session, Runtime invocation and
JobSystem scheduling remain unqualified by these static candidate artifacts.
