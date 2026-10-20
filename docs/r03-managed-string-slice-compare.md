<!-- SPDX-License-Identifier: MIT -->

# Managed String storage slice and comparison

This finite Runtime component extends the existing sole ManagedHeap, payload ownership and canonical WTF8 codec. It does not provide language Source/HIR/Core operations, VM execution or a StringView/Host ABI. R01 Q10 and ADR0019 retain unsigned UTF16 code-unit semantics and forbid Unicode normalization.

`sliceString(handle, start: usize, end: usize, lifetime)` creates an independent owned String for the exact half-open range `[start,end)`. The storage precondition is `0 <= start <= end <= length`; violations return `IndexOutOfBounds` without publishing a result. Empty and full slices also have independent object ownership. An endpoint may split a surrogate pair: the selected half remains that exact isolated u16 and is encoded as canonical WTF8. This primitive does not interpret language-level optional/negative/non-integer arguments or clamp them; a future real Source/Core adapter must implement its established method semantics before calling it.

`compareStrings(left,right)` returns `std.math.Order` by unsigned UTF16 lexicographic order, with a shorter equal prefix first. It allocates nothing and mutates neither operand. WTF8 byte order is unsuitable: U+10000 begins with u16 D800 and precedes BMP E000 even though its UTF8 lead byte is larger. Both full byte encodings are validated before an early comparison can return.

The codec scans complete canonical encodings with finite linear work. Slice uses a sizing pass and a write pass, copying complete encoded sequences and re-encoding only a cut pair half. It allocates exactly the output bytes, without an intermediate u16 array. Payload owns those bytes; ManagedHeap retains its existing fallible-before-publication construction, scopes, handles and moving collector. No borrowed payload address escapes.

Independent literal vectors cover code units, exact bytes and comparison order. Real component checks cover pair cuts, empty/NUL/non-normalization, full input preservation, independent results, scopes/edges/mixed f64 Array roots, stale/foreign/type/range errors, allocation-free comparisons and all observed slice OOM points. Old concat/String/heap/Array regressions remain separate. The fault-injection suites intentionally retain independent finite fixtures and expected outcomes rather than introducing a generic test engine that couples these distinct operations.

All original failures and current results are recorded once in workspace ticket 24i and its single summary. Full M24, M27, formal Runtime/VM/ABI and all actual platform refusal boundaries remain open or stopped as applicable.
