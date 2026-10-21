<!-- SPDX-License-Identifier: MIT -->

# Core scalar compiler outputs

The Core CLI accepts `--emit-native-llvm` and `--emit-native-object` with a complete Core0.9 module on stdin. The first command prints ordinary LLVM IR; the second writes Windows x64 COFF bytes. Both run the existing complete Core parser, identity, target, SSA, CFG, signature and event checks before a separate whole-module capability check. Failed stages publish no stdout. New output I/O failures exit2; invalid or unsupported Core exits3.

The supported profile is one through128 complete functions with at most64 parameters each, i32/bool function parameters/results and existing nominal integer internal SSA/block arguments, explicit fuel/events, branches, direct calls including recursion, and the existing integer operations. A module containing module lifecycle/global/Host metadata, managed/private candidates, floats, wider function signatures or an unsupported operation is rejected in full. Functions and metadata are never filtered to make a smaller eligible module.

The lowering preserves the existing callback order, first arithmetic trap, failure continuation, stackmap markers and fixed eight-byte scalar slot layout. The caller supplies the opaque state and event callback and owns outer frame admission. LLVM verification and the actual target machine layout check precede publication. The target remains the admitted Windows x64 profile without AVX.

These outputs contain no Native descriptor or Native artifact identity. The backend is a bounded extraction of the lowering/codegen from the independent M15 implementation at7a0f2f278b11a80ca47e46ab66cb0b0b83915e01. Native0.4, ABI0.2, Runtime loading/execution, machine-work certification, ResourceProof and RF remain outside this compiler slice. The parent M15 task remains open; no output here establishes those qualifications.

Internal integers preserve the existing Core typeCode, width, signedness and constant-bit rules. Arithmetic wraps at its nominal width. Signed and unsigned division/remainder, comparisons and right shifts keep that distinction. Shift counts remain Core i32: the unsigned count/width guard precedes any compiler-internal extension or truncation needed by LLVM. No public Core numeric conversion, wide calling convention or new descriptor format is introduced.
