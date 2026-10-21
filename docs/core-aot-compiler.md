<!-- SPDX-License-Identifier: MIT -->

# Core scalar compiler outputs

The Core CLI accepts `--emit-native-llvm` and `--emit-native-object` with a complete Core0.12 module on stdin. The first command prints ordinary LLVM IR; the second writes Windows x64 COFF bytes. Both run the existing complete Core parser, identity, target, SSA, CFG, signature and event checks before a separate whole-module capability check. Failed stages publish no stdout. New output I/O failures exit2; invalid or unsupported Core exits3.

The scalar ABI0.3 path supports one through512 complete functions with at most64 logical parameters each (128 physical payload/state parameters), all existing nominal integer/bool/f32/f64 function parameters/results and SSA/block arguments, explicit fuel/events, branches, direct calls including recursion, and the existing scalar operations. Complete module lifecycle/global/Host metadata uses the separate [ordinary instance ABI4](r03-module-aot.md), including its retained code universe, execution plan and actual Host admission gate. A complete package containing managed/private candidates, String values or an unsupported operation is rejected in full. Functions and metadata are never filtered to make a smaller eligible module. The512-function table does not change the caller's dynamic depth64 limit.

The lowering also consumes all286 checked/wrap/reinterpret entries and ordinary
compound assignments, prefix/postfix updates, defaults and optional parameters
through the shared SSA form. Conversion helpers use bounded integer IEEE decoding,
exact destination rounding and raw-bit transport; they contain no FP-to-int casts.
Checked failure callbacks distinguish nonfinite9 and range10 at the conversion
source span. Presence metadata validates physical carriers before wrapper invocation
or guest frame admission; invalid guest carriers use callback11.

The lowering preserves the existing callback order, first arithmetic trap, failure continuation, stackmap markers and fixed eight-byte scalar slot layout. The caller supplies the opaque state and event callback and owns outer frame admission. LLVM verification and the actual target machine layout check precede publication. The target remains the admitted Windows x64 profile without AVX.

These outputs contain no Native descriptor or Native artifact identity. The backend is a bounded extraction of the lowering/codegen from the independent M15 implementation at7a0f2f278b11a80ca47e46ab66cb0b0b83915e01. Native0.4, ABI0.2, Runtime loading/execution, machine-work certification, ResourceProof and RF remain outside this compiler slice. The parent M15 task remains open; no output here establishes those qualifications.

Integers preserve the existing Core typeCode, width, signedness and constant-bit rules. Arithmetic wraps at its nominal width. Signed and unsigned division/remainder, comparisons and right shifts keep that distinction. Shift counts remain Core i32: the unsigned count/width guard precedes any compiler-internal extension or truncation needed by LLVM. The arithmetic boundary bit adapters are internal LLVM operations. Source numeric conversions use the separately verified Core40–42 operations described above.

## Ordinary compiler ABI0.3

This same-repository development interface is unpublished. Outputs carry the actual externally visible read-only u32 symbol `tsfg_native_abi_version = 3` (major0/minor3), and export only the new wrapper symbol below. The old five-argument `tsfg_native_invoke` symbol is absent, so linking an old caller with a new object fails. This does not migrate the separately retained formal Native0.4/Core0.8/ABI0.2 producer, loader or Runtime. Formal Native0.5/Core0.11/ABI0.3 adoption and its resource/identity gates remain separate work.

```c
typedef struct { uint32_t low; uint32_t high; } TsfgScalarSlot;
typedef uint32_t (*TsfgEvent)(void *, uint32_t, uint32_t, uint32_t, uint32_t, uint64_t);
extern const uint32_t tsfg_native_abi_version;
uint32_t tsfg_native_invoke_v3(void *state, TsfgEvent event, uint32_t function_index,
    uint32_t argument_count, const uint8_t *argument_types, uint8_t result_type,
    const TsfgScalarSlot *arguments, TsfgScalarSlot *output);
```

The target C ABI is Windows x64. The caller provides a valid callback, live opaque state, a writable output slot, and (for nonzero argument_count) readable type and slot arrays of the declared length; it owns outer-frame admission and pointer validity. This interface does not probe arbitrary pointers. Zero-parameter functions do not read the argument arrays, which may be null. A selected function checks count and result type before reading the complete ordered nominal parameter typeCode table; all signature gates precede any slot load or function call. Codes1/2 are i32/bool, and3..11 retain the Core integer identities, including distinct i64/u64/isize/usize codes despite their equal widths. Wrong index, count, nominal signature or noncanonical argument returns0 and leaves output untouched, with no guest call or new callback event.

Each slot has size8 and alignment4, and all bytes are specified:

| Type | Canonical slot bytes in increasing address order |
| --- | --- |
| i32/u32 | Low32 bits in little endian at0..3; bytes4..7 zero |
| bool | Bytes0..3 zero; byte4 is0 or1; bytes5..7 zero |
| i8/u8/i16/u16 | Low nominal-width bits at0, zero extended through all remaining bytes |
| i64/u64/isize/usize | Complete64-bit little endian bit pattern |
| f32 | Raw IEEE low32 bits at0..3; bytes4..7 zero |
| f64 | Complete raw IEEE64-bit little endian bit pattern |

Signed values use their nominal-width two's-complement low bits; narrow signed values are zero extended in the slot. The wrapper loads/stores two aligned u32 halves for64-bit values, never an i64 at a possibly4-aligned slot. The actual LLVM target DataLayout must confirm both legacy i32/bool and two-word slot layouts, little endianness and pointer width/alignment before publication. Parameter slot high bits and bool canonicality are checked before the native call. After a guest return, the existing kind8 failure gate must succeed before either output half is cleared or written. Success clears both halves, stores the complete canonical result and returns1. A callback failure returns0 without modifying output. First-trap behavior, event order and source positions remain the existing semantics.

Floating parameters, constants, SSA edges, calls and result slots preserve raw bits,
including signaling NaNs. Private implementations in the same LLVM module perform
each arithmetic operation with constrained LLVM RNE at its declared width, without
fusion or intermediate extension. Arithmetic NaNs, including unary plus/minus,
become positive quiet7fc00000/7ff8000000000000. Comparisons use ordered predicates
except unordered inequality. Remainder uses bounded binary integer long division,
preserving dividend-signed zero and gradual underflow without a libm import.

Modules using floats save the full entry MXCSR and x87 control per native function
and wrapper. They establish masked RNE with FTZ/DAZ clear, restore the entry state
before external event callbacks, reestablish strict mode afterwards, and restore
the entry state on every return, including rejected wrappers and failure returns.
State lives in each native frame, so nested calls and reentrant callbacks do not
share mutable state. Integer-only modules keep their existing LLVM/COFF bytes.
The MSVC floating-use marker is defined as a coalescible read-only `_fltused`
COMDAT in the object, avoiding implicit CRT initialization. The existing source
CMake build links the locked LLVM X86AsmParser component to assemble x87 control
instructions; no library path or new tool source is embedded in product code.
Large wrappers retain the existing Windows `__chkstk` target-support obligation
already present in integer-only512-function objects. A standalone typed caller
link must explicitly supply that stack probe from its admitted compiler-support
library; stack probing is never disabled to make a link pass.

These compiler checks inspect real CLI LLVM/COFF output and compile typed callers.
Frozen mathematical expectations precede the implementation. They are not an IR
interpreter, a machine execution result or a VM cross-check; formal Native loading,
dynamic floating-environment proof and execution equivalence remain separate work.
