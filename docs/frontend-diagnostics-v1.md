<!-- SPDX-License-Identifier: MIT -->

# Frontend diagnostics v1

The product analysis interface returns `status: "error"` with no snapshot for
blocking source, capability, prohibition, and input diagnostics. A process,
binary, or response protocol failure returns `status: "tool-error"` with
`inputIdentity` and no language diagnostic or snapshot. These codes are stable
machine identities and must not be reused for a different meaning.

| Code | Category | Phase | Rule | Meaning |
| --- | --- | --- | --- | --- |
| `r02b-d-input` | input | syntax | `r01-input-boundary` | Invalid or undeclared frontend input |
| `r02b-d-syntax` | error | syntax | `r01-ts-baseline` | TypeScript grammar error |
| `r02b-d-type` | error | types | `r01-ts-baseline` | TypeScript type error without a more specific tsfg code |
| `r02b-d-unsupported` | unsupported | capability | `r01-ts-baseline` | Valid structure outside the current frontend slice |
| `r02b-d-prohibited` | prohibited | types | `r01-input-boundary` | Architecture-forbidden dynamic feature |

The frontend also reuses `r01-d-scalar-type` for a bool scalar mismatch and
`r01-d-unresolved-name` for an unresolved source name. Upstream numeric codes
are retained only as provenance. Diagnostic order is logical source path,
UTF-16 start offset, machine code, then end offset. Primary source ranges are
half-open UTF-16 code-unit offsets with zero-based line and column values.

The current prohibition checks cover `any`, loose equality, `eval`,
`Function(string)`, `Proxy`, `delete`, indexed property writes, and direct
prototype mutation. An unresolved call uses the existing `r01-calls` rule;
other unresolved names use `r01-ts-baseline`.
