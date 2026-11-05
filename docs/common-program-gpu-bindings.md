<!-- SPDX-License-Identifier: MIT -->

# Static logical GPU bindings

`createCommonGpuBindingPlan` consumes the complete owned Common Program, its
original fixed publication and the existing two-to-32 kernel request. It first
runs the existing whole-Program Core and borrow consumer. Ordinary functions,
initializers, Source identity, fixed effects, call-chain diagnostics and borrowing
remain checked even when the GPU request selects only one kernel from the group.

The independent unpublished request version 1 has these exact fields:

```json
{"family":"tsfg.gpu-logical-binding-request","version":1,"target":"vulkan","kernels":["<FunctionId>"],"bindings":[{"kind":"global","id":"<GlobalId>","kernel":null,"set":0,"binding":0,"access":"read-write"}]}
```

`kernels` is a nonempty ordered unique subset of the original verified group.
Each binding is either a global (`kernel: null`) or a parameter (`kernel` is its
selected FunctionId and `id` is the original owned parameter binding identity).
The descriptor set and binding are uint32 logical names. The table contains at
most 4096 rows, ordered uniquely by set then binding; a resource appears once.
These bounds describe compiler data and do not claim device limits.

Version 1 supports i32 scalar globals and i32 value parameters, with i32 or void
returns and no receiver. Every selected parameter requires a read binding.
Every global in the selected fixed read/write upper requires exactly one binding
with the same combined access. Missing, extra, foreign, duplicate or incorrectly
permissioned resources are rejected. Other types or mutable parameter effects
produce an explicit capability error; their implementation remains part of the
parent GPU task. A narrower current body never replaces its supplied upper.

The version 1 plan retains the original input, HIR, scope and publication
identities, complete group targets, selected kernel and resource Source anchors,
and SHA-256 digests of the canonical kernel proof, borrow proof and request.
Each digest covers canonical JSON plus one LF. `verifyCommonGpuBindingPlan`,
`printCommonGpuBindingPlan` and `readCommonGpuBindingPlan` recompute this data;
an asserted plan cannot supply authority. Plan scope is `static-logical`.

The independent C++ command is `--common-program --gpu-binding-plan`. Standard
input is canonical JSON plus one LF with exact fields `family`, `version`,
`core`, `request`, `plan`. Family is `tsfg.gpu-logical-binding-input`, version is
1, `core` is complete existing Common Core text and `request` is the request
above. `plan: null` produces the plan; a non-null plan must equal the independently
reconstructed result. The command verifies complete Source/Core, actual values,
borrowing and the original kernel proof before producing canonical plan JSON.

This interface emits no shader, SPIR-V or physical resource layout. It does not
infer GPU ABI from CPU DataLayout, adopt Vulkan tools, invoke an API/device or
define numeric, dispatch, synchronization, failure or recovery behavior. Existing
Common/Graph/wire identities are unchanged. Software-device execution and the
rest of task 39 remain unverified.
