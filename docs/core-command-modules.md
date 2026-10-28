# Core command modules

The complete Core language has one command Implementation in
`compiler/core-ir/core-command.cpp`: dialect registration, parsing, identity
checks, complete verification, canonical printing, optimization, and existing
formal/private wire commands. Both executables compile the same common object
library. Language and protocol identities remain unchanged.

`tsfg-core-static.exe` exposes those ordinary Core commands.
`tsfg-core-ir.exe` retains the existing full compiler name and all Native/AOT
commands. Its small adapter receives a verified module and owns native output,
target initialization and instruction inspection. Native lowering and X86
libraries belong only to this full target. There is no alternative verifier,
interpreter, language profile, or duplicate IR implementation.

The static target binds AddLLVM's component selection in a local CMake function:
`LLVM_LINK_COMPONENTS` is `Support`, `USE_SHARED` is empty, and
`DISABLE_LLVM_LINK_LLVM_DYLIB` prevents the umbrella-library branch. Its complete
Core dependencies come from the common object's MLIR target interfaces. Caller
variables cannot add Native components to this target; the full Native target
keeps its existing variable scope. This declaration still requires actual
configuration and observed-consumption verification before SDK qualification.

Production selection is `--source-target mlir-core --core-command-role static`
or `native`; omission retains the full native target. The produced manifest
binds `coreCommandRole` to the build identity. Ordinary compilation accepts
either role; AOT requires the full native role. `compileOwnedStaticProgram`
can take `nativeCore` separately when `core` selects the ordinary tool.

`--mlir-build-phase plan` is an operational stop point for direct-source static
builds. The CLI and direct factory reject unknown phases, native planning and
SDK planning before source intake. After the existing configuration, actual
Ninja plan and precompile qualification, the factory rechecks source, Python,
product and tool identities, writes `planned-input-trace.json`, and returns
`status: planned` with `sourceBuild: not-run`. It starts no Core target build and
publishes no executable, PDB or artifact manifest. The result is planning
evidence; final compiler/link dependencies remain unqualified. Omission or
`--mlir-build-phase build` preserves the complete build workflow.

Configuration may itself invoke approved compiler ABI/feature checks and Python
probes. A planning-stage release must cover those ordinary configure actions;
the phase selector does not grant tool, source or execution permission. Actual
configure and target-build releases remain separate decisions. No real tools or
Core commands are credited by the data-only phase-interface tests.

SDKv2 membership remains complete and unchanged. The current authenticated SDK
intake actually reads the historical full compiler and every inventory body.
Consequently a static target does not itself qualify an independent SDK
consumption closure. A static SDK build stops before those reads with
`mlir-static-sdk-consumption`. Direct-source builds retain the existing
source/legal/trace gates. Static materialization additionally selects a finite
candidate from the existing pinned source, notice and provenance registrations
before reading upstream bodies. Each selected path must match its immutable Git
tree member and registered raw hash; unselected bodies are never read or copied.
Backend implementations are excluded; registered shared AArch64/ARM/PowerPC/RISCV
TableGen inputs remain available to TargetParser. Native source selection and
full SDK intake retain their contracts.

`TSFG_CORE_BUILD_ROLE=static` creates the complete common language and ordinary
tool while leaving the native target undeclared. The factory explicitly selects
no LLVM or experimental backend and checks those cache values after configure.
Its planned and final dependency checks reject native product implementations
and backend source/artifact edges before inspecting dependency bodies, including
CMake EVAL origins. The original native role still selects X86 and creates the
full compiler. Neither role changes common language semantics or source members.

Static configuration keeps `LLVM_INCLUDE_TOOLS=ON`: that directory admits MLIR
and the external Core project. It uses LLVM's supported per-tool build options
to skip optional tool directories named by the selected source inventory, while
explicitly retaining those two projects. `LLVM_INCLUDE_UTILS=OFF` skips optional
utilities; LLVM's early `utils/TableGen` entry and MLIR's required generators
remain. Every actual static role cache setting is checked before plan admission.
Native and SDK configuration keep their prior behavior.

These options reduce optional declarations; they do not close configuration's
source-presence requirements. The fixed MLIR source has no generic
`MLIR_INCLUDE_TOOLS` switch, and many libraries and MLIR tools are declared even
when the Core target does not compile them. Their missing `SOURCES` require
exact configuration metadata and ordinary source intake; a first-missing-file
diagnostic is neither a complete source list nor a compiler dependency trace.

The direct static factory stages the declared `mlir-configuration-sources.cmake`
helper and injects it through `CMAKE_PROJECT_INCLUDE`. An official deferred call
walks the configured directories and build-system targets before Generate,
writing `configuration-sources.json` in that stage. It records each target's
type, source/binary directories, and raw `SOURCES` and `INTERFACE_SOURCES`.
Generator expressions, path resolution and generated status remain unknown;
the helper reads no source bodies and changes no upstream targets. This allows
precise source-intake work even when Generate rejects absent declarations.
These declarations do not replace the actual Ninja or compiler dependency
checks and grant no permission to consume an unregistered source.

The finite candidate is not evidence of a complete CMake or link closure. LLVM
can declare sources for components outside the selected build target. Missing
configuration, generation or declaration members are absent from the staged
tree and fail locally; their exact identities require the existing registration
process before a future build can consume them. Only an actual qualified
configure, Ninja plan and final compilation/link trace can establish closure.
No real configure, compiler, linker, SDK or CLI execution is credited by these
data-only factory regressions.

R03 M14/M37 and M25 track removing this local HOLD: establish an authenticated
ordinary dependency closure (including configuration evaluation, source
licenses, headers, libraries, original provenance and observed inputs) without
consuming the held full compiler or LLVMX86Desc external table, then run the
ordinary production build and independent review. Preserve the full SDK lock
and original native intake; do not trim or relabel their membership. Existing
Native/AOT provenance restrictions remain independent. No link/CLI execution is
credited by this refactor.

The production control entry is now a bounded CLI coordinator. Its option,
identity, acquisition, workspace, isolation, build and delivery implementations
use static responsibility modules rather than sharing an 8,000-line scope.
[ADR 0009](adr/0009-separate-build-command-responsibilities.md) records the seams,
dependency direction and unchanged execution restrictions.
