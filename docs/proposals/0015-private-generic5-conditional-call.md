# ECP-0015: private generic5 conditional call

Status: accepted by Root under the Owner's 2026-10-17 instruction to proceed autonomously within reasonable R03 scope. This records the current delegation, not a fabricated earlier Owner vote. Implementation, review and new-identity build gates still apply.

Adopt the bounded private owned generic package5, tsfg-owned-scalar-generics-host-v5 and concrete HIR5. Its exact descriptor is RFC8785-safe-integer JCS6116 bytes, SHA256 da7eb72ae306eb88863a44c945df77d572a96443a005fefbd787267fe90658bf. Package identity uses the tsfg-owned-generic-package/v5 newline domain.

Capabilities are conditional-generic-call, conditional-signature, explicit-type-arguments, mapped-indexed-signature, number-add, scalar-generics, single-module, in that order. Whole predecessor1/2/3/4 and mixed claims are rejected; there is no version fallback.

The only added behavior is a conditional-signature function directly returning one explicit call to a matching conditional-signature leaf: one external type binder, one value parameter, one bound type-argument0, and parameter0 as the sole argument. The leaf directly returns parameter0. Parameter and return conditional structures must match completely. Conditional chains, self/mutual recursion, nested calls, concrete type arguments and mapped/indexed calls are outside this slice. Existing ordinary generic leaf calls and recursion remain supported.

Conditional types remain finite structural leaves. Actual fresh official Source checking and mapper facts supply bool/f64 results. Product checks owned structure and exact instance/callee/type/origin correspondence; consistent facts do not authenticate a Source executable. Original UTF16 anchors stay individually contained by the definition, including arguments outside the parent call anchor where the existing protocol permits them.

Formal Host ABI, Core0.9/wire9, FrontendSnapshot/registry, Source lock/admission, SDKv2, IO/request/command1, linkageAlgorithm1 and global budgets remain unchanged. Both changed Product production modules already belong to the164/165 Build Input Sets. This adoption adds or removes no member. Changed content still requires a new actual BI, exact per-input epoch and ordinary initial-false build.

Validation requires the same frozen public Source test to show causal RED then GREEN, relevant named public-Go checks, actual Source-produced cold records, current pure Node regression, full cold HIR/Core byte checks, type checking, and independent Spec/Standards review. The new four-function Core oracle is independently hand-worked. Reused historical three-family Core text has only independently calculated identity slots migrated; its historical C++ qualification does not become new v5 C++ execution evidence.

Source publication, executable admission, VM/generated-code/native execution, final Runtime/RF qualification and every existing cyber-policy STOP remain independent. This adoption does not authorize replay, repackaging, publication or model/tool substitution for any refused action.
